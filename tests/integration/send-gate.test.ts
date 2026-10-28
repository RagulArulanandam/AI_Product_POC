import { randomUUID } from "node:crypto";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { FakeMessagingAdapter } from "@/adapters/messaging/fake";
import { sendToCustomer, type SendDeps, type SendInput } from "@/engine/send";
import type { Admin } from "@/engine/types";
import { AdapterError } from "@/lib/errors";
import { serviceClient } from "../helpers/db";
import { ensureConversation } from "../helpers/tenant-tables";
import { cleanupTenants, createTenant, type Tenant } from "../helpers/tenants";

const admin = serviceClient() as unknown as Admin;
const fake = new FakeMessagingAdapter();
const NOW = new Date();
const HOUR = 3_600_000;
const PHONE = "+447700900201"; // the customer ensureConversation creates

let tenant: Tenant;
let conversationId: string;
let customerId: string;

const deps = (limits?: SendDeps["limits"]): SendDeps => ({ admin, messaging: fake, limits });

function input(overrides: Partial<SendInput> = {}): SendInput {
  return {
    businessId: tenant.businessId,
    conversationId,
    customerId,
    to: PHONE,
    body: "Hi, this is Test Clinic. Sorry we missed your call.",
    kind: "first",
    now: NOW,
    ...overrides,
  };
}

async function outboundRows() {
  const { data } = await admin.from("messages").select("*").eq("conversation_id", conversationId).eq("direction", "outbound");
  return data ?? [];
}

async function reset() {
  fake.reset();
  await admin.from("messages").delete().eq("business_id", tenant.businessId);
  await admin.from("opt_outs").delete().eq("phone_e164", PHONE);
  await admin.from("businesses").update({ status: "active" }).eq("id", tenant.businessId);
  await admin.from("conversations").update({ last_inbound_at: null, last_outbound_at: null }).eq("id", conversationId);
}

beforeAll(async () => {
  tenant = await createTenant("send");
  conversationId = await ensureConversation(admin, tenant.businessId);
  const { data } = await admin.from("conversations").select("customer_id").eq("id", conversationId).single();
  customerId = data!.customer_id;
});

beforeEach(reset);

afterAll(async () => {
  await admin.from("opt_outs").delete().eq("phone_e164", PHONE);
  await cleanupTenants();
});

describe("sendToCustomer: sending", () => {
  it("sends, records the message and updates the conversation and customer", async () => {
    const result = await sendToCustomer(deps(), input());
    expect(result).toMatchObject({ status: "sent", duplicate: false });
    expect(fake.sent).toHaveLength(1);
    expect(fake.sent[0]).toMatchObject({ to: PHONE, body: input().body });

    const [row] = await outboundRows();
    expect(row).toMatchObject({ status: "sent", sender: "system", provider_sid: fake.sent[0].providerSid, error: null });

    const { data: convo } = await admin.from("conversations").select("last_outbound_at").eq("id", conversationId).single();
    expect(new Date(convo!.last_outbound_at!).getTime()).toBe(NOW.getTime());
    const { data: customer } = await admin.from("customers").select("last_contacted_at").eq("id", customerId).single();
    expect(customer?.last_contacted_at).not.toBeNull();
  });

  it("does not send twice when the same first message is attempted again", async () => {
    const first = await sendToCustomer(deps(), input());
    const again = await sendToCustomer(deps(), input());
    expect(again).toMatchObject({ status: "sent", duplicate: true });
    expect(again.status === "sent" && again.messageId).toBe(first.status === "sent" && first.messageId);
    expect(fake.sent).toHaveLength(1);
    expect(await outboundRows()).toHaveLength(1);
  });

  it("reuses the same row when a failed attempt is retried, and sends exactly once", async () => {
    fake.failNext(new AdapterError("rate_limited", "slow down"));
    await expect(sendToCustomer(deps(), input())).rejects.toMatchObject({ code: "rate_limited" });

    let rows = await outboundRows();
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({ status: "failed", provider_sid: null });
    expect(rows[0].error).toContain("slow down");

    const retry = await sendToCustomer(deps(), input());
    expect(retry.status).toBe("sent");
    rows = await outboundRows();
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({ status: "sent", error: null });
    expect(fake.sent).toHaveLength(1);
  });

  it("redacts secrets and numbers in the stored error", async () => {
    fake.failNext(new AdapterError("unknown", "failed for +447700900201 with Bearer abc123token"));
    await expect(sendToCustomer(deps(), input())).rejects.toBeInstanceOf(AdapterError);
    const [row] = await outboundRows();
    expect(row.error).not.toContain("+447700900201");
    expect(row.error).not.toContain("abc123token");
  });

  it("lets a reply reuse a specific earlier attempt by message id", async () => {
    await admin.from("conversations").update({ last_inbound_at: new Date(NOW.getTime() - HOUR).toISOString() }).eq("id", conversationId);
    fake.failNext(new AdapterError("provider_unavailable", "down"));
    await expect(sendToCustomer(deps(), input({ kind: "reply", body: "Thursday works" }))).rejects.toBeDefined();
    const [failed] = await outboundRows();

    const retry = await sendToCustomer(deps(), input({ kind: "reply", body: "Thursday works", messageId: failed.id }));
    expect(retry).toMatchObject({ status: "sent", messageId: failed.id });
    expect(await outboundRows()).toHaveLength(1);
    expect(fake.sent).toHaveLength(1);
  });

  it("marks replies from the AI as sender ai", async () => {
    await admin.from("conversations").update({ last_inbound_at: NOW.toISOString() }).eq("id", conversationId);
    await sendToCustomer(deps(), input({ kind: "reply", body: "Sure!" }));
    expect((await outboundRows())[0].sender).toBe("ai");
  });
});

describe("sendToCustomer: blocks (nothing is sent or recorded)", () => {
  async function expectBlocked(reason: string, overrides: Partial<SendInput> = {}, limits?: SendDeps["limits"]) {
    const result = await sendToCustomer(deps(limits), input(overrides));
    expect(result).toEqual({ status: "blocked", reason });
    expect(fake.sent).toHaveLength(0);
    expect(await outboundRows()).toHaveLength(0);
  }

  it("blocks opted-out numbers, including opt-outs recorded by another business", async () => {
    const other = await createTenant("send-other");
    await admin.from("opt_outs").insert({ phone_e164: PHONE, source_business_id: other.businessId });
    await expectBlocked("opted_out");
  });

  it("blocks when the business is not active", async () => {
    await admin.from("businesses").update({ status: "disabled" }).eq("id", tenant.businessId);
    await expectBlocked("business_inactive");
  });

  it("blocks a reply when the customer has never written", async () => {
    await expectBlocked("outside_window", { kind: "reply" });
  });

  it("blocks a reply when the customer last wrote more than 24 hours ago", async () => {
    await admin.from("conversations").update({ last_inbound_at: new Date(NOW.getTime() - 25 * HOUR).toISOString() }).eq("id", conversationId);
    await expectBlocked("outside_window", { kind: "reply" });
  });

  it("allows a reply inside the window, and a first message regardless of it", async () => {
    await admin.from("conversations").update({ last_inbound_at: new Date(NOW.getTime() - 23 * HOUR).toISOString() }).eq("id", conversationId);
    expect((await sendToCustomer(deps(), input({ kind: "reply", body: "inside" }))).status).toBe("sent");
    await reset();
    expect((await sendToCustomer(deps(), input({ kind: "first" }))).status).toBe("sent");
  });

  it("blocks once a customer has received the hourly limit", async () => {
    const rows = Array.from({ length: 3 }, () => ({
      business_id: tenant.businessId, conversation_id: conversationId, direction: "outbound", sender: "ai", status: "sent", body: "x",
      created_at: new Date(NOW.getTime() - 10 * 60_000).toISOString(),
    }));
    await admin.from("messages").insert(rows);
    const result = await sendToCustomer(deps({ customerPerHour: 3 }), input({ kind: "reply", messageId: undefined }));
    expect(result).toMatchObject({ status: "blocked" });
  });

  it("does not count old or failed messages towards the hourly limit", async () => {
    const old = { business_id: tenant.businessId, conversation_id: conversationId, direction: "outbound", sender: "ai", body: "x" };
    await admin.from("messages").insert([
      { ...old, status: "sent", created_at: new Date(NOW.getTime() - 2 * HOUR).toISOString() },
      { ...old, status: "failed", created_at: new Date(NOW.getTime() - 5 * 60_000).toISOString() },
    ]);
    await admin.from("conversations").update({ last_inbound_at: NOW.toISOString() }).eq("id", conversationId);
    const result = await sendToCustomer(deps({ customerPerHour: 1 }), input({ kind: "reply" }));
    expect(result.status).toBe("sent");
  });

  it("blocks once a business has sent its daily limit", async () => {
    const other = await admin
      .from("customers")
      .insert({ business_id: tenant.businessId, phone_e164: "+447700900202" })
      .select("id")
      .single();
    const { data: otherConvo } = await admin
      .from("conversations")
      .insert({ business_id: tenant.businessId, customer_id: other.data!.id, product_id: (await admin.from("products").select("id").eq("key", "missed-call").single()).data!.id })
      .select("id")
      .single();
    await admin.from("messages").insert(
      Array.from({ length: 2 }, () => ({
        business_id: tenant.businessId, conversation_id: otherConvo!.id, direction: "outbound", sender: "ai", status: "sent", body: "x",
        created_at: new Date(NOW.getTime() - 5 * HOUR).toISOString(),
      })),
    );
    const result = await sendToCustomer(deps({ businessPerDay: 2 }), input());
    expect(result).toEqual({ status: "blocked", reason: "business_cap" });
    expect(fake.sent).toHaveLength(0);
  });

  it("does not let another business's traffic use up this business's limits", async () => {
    const other = await createTenant("send-cap-other");
    const otherConvo = await ensureConversation(admin, other.businessId);
    await admin.from("messages").insert(
      Array.from({ length: 5 }, () => ({
        business_id: other.businessId, conversation_id: otherConvo, direction: "outbound", sender: "ai", status: "sent", body: "x",
        created_at: new Date(NOW.getTime() - 5 * 60_000).toISOString(),
      })),
    );
    expect((await sendToCustomer(deps({ businessPerDay: 2, customerPerHour: 2 }), input())).status).toBe("sent");
  });
});

describe("sendToCustomer: failures", () => {
  it("rethrows non-retryable adapter errors and leaves a failed row", async () => {
    fake.failNext(new AdapterError("unreachable_recipient", "not on WhatsApp"));
    await expect(sendToCustomer(deps(), input())).rejects.toMatchObject({ code: "unreachable_recipient", retryable: false });
    expect((await outboundRows())[0]).toMatchObject({ status: "failed", provider_sid: null });
    expect(randomUUID()).toBeTruthy();
  });
});
