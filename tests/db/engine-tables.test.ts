import { randomUUID } from "node:crypto";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { anonClient, serviceClient } from "../helpers/db";
import { ensureConversation, missedCallProductId } from "../helpers/tenant-tables";
import { cleanupTenants, createTenant, type Tenant } from "../helpers/tenants";

const admin = serviceClient();
let a: Tenant;
let conversationId: string;
let productId: string;

interface ClaimedRow {
  id: string;
  status: string;
  attempts: number;
  locked_at: string | null;
}

async function claim(batch = 1): Promise<{ data: ClaimedRow[] | null; error: { message: string } | null }> {
  const res = await admin.rpc("claim_due_actions", { batch });
  return { data: res.data as ClaimedRow[] | null, error: res.error };
}

async function enqueue(overrides: Record<string, unknown> = {}) {
  const { data, error } = await admin
    .from("scheduled_actions")
    .insert({
      business_id: a.businessId,
      type: "test",
      dedupe_key: `t-${randomUUID()}`,
      run_at: new Date(Date.now() - 60_000).toISOString(),
      ...overrides,
    })
    .select("*")
    .single();
  if (error) throw new Error(error.message);
  return data;
}

// opt_outs are platform-wide and survive business deletion by design, so tests clean up their own.
const OPT_OUT_PHONES = ["+447700900302", "+447700900303"];
const clearOptOuts = async () => {
  await admin.from("opt_outs").delete().in("phone_e164", OPT_OUT_PHONES);
};

beforeAll(async () => {
  await clearOptOuts();
  a = await createTenant("eng-a");
  productId = await missedCallProductId(admin);
  conversationId = await ensureConversation(admin, a.businessId);
});

afterAll(async () => {
  await cleanupTenants();
  await clearOptOuts();
});

// The queue claims across all businesses, so start every queue test from an empty queue.
async function clearQueue() {
  await admin.from("scheduled_actions").update({ status: "cancelled" }).in("status", ["pending", "processing"]);
}

describe("constraints", () => {
  it("allows one customer row per business and phone", async () => {
    const phone = "+447700900301";
    expect((await admin.from("customers").insert({ business_id: a.businessId, phone_e164: phone })).error).toBeNull();
    expect((await admin.from("customers").insert({ business_id: a.businessId, phone_e164: phone })).error).not.toBeNull();
  });

  it("rejects non-E.164 phone numbers", async () => {
    expect((await admin.from("customers").insert({ business_id: a.businessId, phone_e164: "07700 900301" })).error).not.toBeNull();
    expect((await admin.from("opt_outs").insert({ phone_e164: "nope" })).error).not.toBeNull();
  });

  it("keeps one opt-out per phone number platform-wide", async () => {
    const phone = "+447700900302";
    expect((await admin.from("opt_outs").insert({ phone_e164: phone, source_business_id: a.businessId })).error).toBeNull();
    expect((await admin.from("opt_outs").insert({ phone_e164: phone })).error).not.toBeNull();
  });

  it("validates conversation state and keeps trigger_call_sid unique per business", async () => {
    const { data: customer } = await admin.from("customers").select("id").eq("business_id", a.businessId).limit(1).single();
    const base = { business_id: a.businessId, customer_id: customer!.id, product_id: productId };
    expect((await admin.from("conversations").insert({ ...base, state: "daydreaming" })).error).not.toBeNull();

    const sid = `CA${randomUUID().replace(/-/g, "")}`;
    expect((await admin.from("conversations").insert({ ...base, trigger_call_sid: sid })).error).toBeNull();
    expect((await admin.from("conversations").insert({ ...base, trigger_call_sid: sid })).error).not.toBeNull();
    // Conversations without a call SID (for example inbound-first) are not limited.
    expect((await admin.from("conversations").insert(base)).error).toBeNull();
    expect((await admin.from("conversations").insert(base)).error).toBeNull();
  });

  it("stores an inbound provider message only once", async () => {
    const sid = `SM${randomUUID().replace(/-/g, "")}`;
    const msg = {
      business_id: a.businessId,
      conversation_id: conversationId,
      direction: "inbound",
      sender: "customer",
      status: "received",
      provider_sid: sid,
    };
    expect((await admin.from("messages").insert(msg)).error).toBeNull();
    expect((await admin.from("messages").insert(msg)).error).not.toBeNull();
    // Messages without a provider SID (queued outbound) can repeat.
    const queued = { ...msg, provider_sid: null, direction: "outbound", sender: "ai", status: "queued" };
    expect((await admin.from("messages").insert(queued)).error).toBeNull();
    expect((await admin.from("messages").insert(queued)).error).toBeNull();
  });

  it("validates message fields and confidence range", async () => {
    const base = { business_id: a.businessId, conversation_id: conversationId, direction: "inbound", sender: "customer", status: "received" };
    expect((await admin.from("messages").insert({ ...base, direction: "sideways" })).error).not.toBeNull();
    expect((await admin.from("messages").insert({ ...base, confidence: 1.5 })).error).not.toBeNull();
  });

  it("dedupes scheduled actions by key and bounds attempts", async () => {
    const key = `dup-${randomUUID()}`;
    const row = { business_id: a.businessId, type: "x", dedupe_key: key };
    expect((await admin.from("scheduled_actions").insert(row)).error).toBeNull();
    expect((await admin.from("scheduled_actions").insert(row)).error).not.toBeNull();
    expect(
      (await admin.from("scheduled_actions").insert({ ...row, dedupe_key: `${key}-2`, attempts: 4, max_attempts: 3 })).error,
    ).not.toBeNull();
  });

  it("stores a webhook event once per provider event id", async () => {
    const row = { provider: "test", provider_event_id: `e-${randomUUID()}`, business_id: a.businessId };
    expect((await admin.from("webhook_events").insert(row)).error).toBeNull();
    expect((await admin.from("webhook_events").insert(row)).error).not.toBeNull();
    // Same event id from a different provider is a different event.
    expect((await admin.from("webhook_events").insert({ ...row, provider: "other" })).error).toBeNull();
  });
});

describe("deleting a customer removes everything about them (security-privacy.md section 11)", () => {
  it("cascades to conversations, messages, actions and logs, but keeps the opt-out", async () => {
    const phone = "+447700900303";
    const { data: customer } = await admin.from("customers").insert({ business_id: a.businessId, phone_e164: phone }).select("id").single();
    const { data: convo } = await admin
      .from("conversations")
      .insert({ business_id: a.businessId, customer_id: customer!.id, product_id: productId })
      .select("id")
      .single();
    await admin.from("messages").insert({
      business_id: a.businessId, conversation_id: convo!.id, direction: "inbound", sender: "customer", status: "received",
    });
    const { data: action } = await admin
      .from("scheduled_actions")
      .insert({ business_id: a.businessId, conversation_id: convo!.id, type: "x", dedupe_key: `c-${randomUUID()}`, run_at: "2999-01-01T00:00:00Z" })
      .select("id")
      .single();
    await admin.from("automation_logs").insert({
      business_id: a.businessId, conversation_id: convo!.id, scheduled_action_id: action!.id, event_type: "x", step: "event", status: "ok",
    });
    await admin.from("opt_outs").upsert({ phone_e164: phone }, { onConflict: "phone_e164" });

    await admin.from("customers").delete().eq("id", customer!.id);

    const { count: convoCount } = await admin.from("conversations").select("*", { count: "exact", head: true }).eq("id", convo!.id);
    expect(convoCount).toBe(0);
    for (const table of ["messages", "scheduled_actions", "automation_logs"]) {
      const { count } = await admin.from(table).select("*", { count: "exact", head: true }).eq("conversation_id", convo!.id);
      expect(count, table).toBe(0);
    }
    const { count: optOuts } = await admin.from("opt_outs").select("*", { count: "exact", head: true }).eq("phone_e164", phone);
    expect(optOuts).toBe(1);
  });

  it("keeps log rows when only the action is deleted", async () => {
    const action = await enqueue({ run_at: "2999-01-01T00:00:00Z" });
    const { data: log } = await admin
      .from("automation_logs")
      .insert({ business_id: a.businessId, scheduled_action_id: action.id, event_type: "x", step: "system", status: "ok" })
      .select("id")
      .single();
    await admin.from("scheduled_actions").delete().eq("id", action.id);
    const { data } = await admin.from("automation_logs").select("scheduled_action_id").eq("id", log!.id).single();
    expect(data?.scheduled_action_id).toBeNull();
  });
});

describe("claim_due_actions", () => {
  beforeAll(clearQueue);

  it("claims a due action, locks it and counts the attempt", async () => {
    await clearQueue();
    const row = await enqueue();
    const { data, error } = await claim();
    expect(error).toBeNull();
    expect(data).toHaveLength(1);
    expect(data![0]).toMatchObject({ id: row.id, status: "processing", attempts: 1 });
    expect(data![0].locked_at).not.toBeNull();
  });

  it("does not claim future, cancelled or already processing actions", async () => {
    await clearQueue();
    await enqueue({ run_at: new Date(Date.now() + 3_600_000).toISOString() });
    await enqueue({ status: "cancelled" });
    await enqueue({ status: "processing", locked_at: new Date().toISOString(), attempts: 1 });
    const { data } = await claim(5);
    expect(data).toHaveLength(0);
  });

  it("claims in run_at order and respects the batch size", async () => {
    await clearQueue();
    const late = await enqueue({ run_at: new Date(Date.now() - 1_000).toISOString() });
    const early = await enqueue({ run_at: new Date(Date.now() - 120_000).toISOString() });
    const { data } = await claim(1);
    expect(data!.map((r) => r.id)).toEqual([early.id]);
    const { data: next } = await claim(1);
    expect(next!.map((r) => r.id)).toEqual([late.id]);
  });

  it("never hands the same action to two concurrent workers", async () => {
    await clearQueue();
    const ids = new Set((await Promise.all(Array.from({ length: 8 }, () => enqueue()))).map((r) => r.id));
    const results = await Promise.all(Array.from({ length: 8 }, () => claim(1)));
    const claimed = results.flatMap((r) => (r.data ?? []).map((x) => x.id));
    // Under contention a claim can come back empty (see claimDueAction), so drain the rest.
    for (;;) {
      const more = await claim(1);
      if (!more.data || more.data.length === 0) break;
      claimed.push(...more.data.map((x) => x.id));
    }
    // The point: no action is ever handed out twice, and none is lost.
    expect(claimed).toHaveLength(8);
    expect(new Set(claimed).size).toBe(8);
    expect(new Set(claimed)).toEqual(ids);
  });

  it("does not run two actions of one conversation at the same time", async () => {
    await clearQueue();
    await enqueue({ conversation_id: conversationId });
    await enqueue({ conversation_id: conversationId });
    const first = await claim(1);
    expect(first.data).toHaveLength(1);
    const second = await claim(1);
    expect(second.data).toHaveLength(0);

    // Once the first is finished, the second can run.
    await admin.from("scheduled_actions").update({ status: "done" }).eq("id", first.data![0].id);
    const third = await claim(1);
    expect(third.data).toHaveLength(1);
  });

  it("reclaims a stuck action and fails one with no attempts left", async () => {
    await clearQueue();
    const stuckAt = new Date(Date.now() - 10 * 60_000).toISOString();
    const retryable = await enqueue({ status: "processing", locked_at: stuckAt, attempts: 1 });
    const exhausted = await enqueue({ status: "processing", locked_at: stuckAt, attempts: 3 });

    const { data } = await claim(5);
    expect(data!.map((r) => r.id)).toEqual([retryable.id]);
    expect(data![0].attempts).toBe(2);

    const { data: failed } = await admin.from("scheduled_actions").select("status, last_error").eq("id", exhausted.id).single();
    expect(failed?.status).toBe("failed");
    expect(failed?.last_error).toContain("no attempts left");
  });

  it("is not callable by tenants or anon", async () => {
    const tenantCall = await a.owner.client.rpc("claim_due_actions", { batch: 1 });
    expect(tenantCall.error).not.toBeNull();
    const anonCall = await anonClient().rpc("claim_due_actions", { batch: 1 });
    expect(anonCall.error).not.toBeNull();
  });

  afterAll(clearQueue);
});

describe("tenant visibility of engine data", () => {
  it("lets an owner read their conversations, messages and logs but not the queue or webhook events", async () => {
    await admin.from("automation_logs").insert({ business_id: a.businessId, event_type: "x", step: "event", status: "ok" });
    const convos = await a.owner.client.from("conversations").select("id").eq("business_id", a.businessId);
    expect((convos.data ?? []).length).toBeGreaterThan(0);
    const logs = await a.owner.client.from("automation_logs").select("id").eq("business_id", a.businessId);
    expect((logs.data ?? []).length).toBeGreaterThan(0);

    const queue = await a.owner.client.from("scheduled_actions").select("id");
    expect(queue.data ?? []).toHaveLength(0);
    const events = await a.owner.client.from("webhook_events").select("id");
    expect(events.data ?? []).toHaveLength(0);
  });
});
