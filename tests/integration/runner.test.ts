import { randomUUID } from "node:crypto";
import { z } from "zod";
import { afterAll, beforeEach, describe, expect, it } from "vitest";
import { nextRunAt } from "@/engine/backoff";
import { claimDueAction, enqueueAction, requeueFailedAction } from "@/engine/queue";
import { runAction, type EngineDeps } from "@/engine/runner";
import { HANDLE_EVENT, type Admin, type HandlerContext, type HandlerResult, type ScheduledAction } from "@/engine/types";
import { AdapterError } from "@/lib/errors";
import type { ProductManifest } from "@/products/types";
import { serviceClient } from "../helpers/db";
import { missedCallProductId } from "../helpers/tenant-tables";
import { cleanupTenants, createTenant, type Tenant } from "../helpers/tenants";

const admin = serviceClient() as unknown as Admin;
const NOW = new Date("2026-10-28T12:00:00Z");

// A fake product that reuses the seeded `missed-call` key so enablement rows exist.
const calls: HandlerContext[] = [];
let handlerImpl: (ctx: HandlerContext) => Promise<HandlerResult> = async () => "done";

const fakeProduct: ProductManifest = {
  key: "missed-call",
  name: "Fake",
  description: "Fake product for engine tests",
  status: "available",
  configSchema: z.object({ delay: z.number().default(1) }),
  defaultConfig: { delay: 1 },
  handledEvents: ["test.event"],
  handlers: {
    "test.event": (ctx) => {
      calls.push(ctx);
      return handlerImpl(ctx);
    },
    do_work: (ctx) => {
      calls.push(ctx);
      return handlerImpl(ctx);
    },
  },
};

const deps: EngineDeps = { admin, products: [fakeProduct], now: () => NOW, services: {} };

interface Setup {
  enabled?: boolean;
  subscription?: string;
  status?: string;
  config?: Record<string, unknown>;
}

async function makeBusiness(setup: Setup = {}): Promise<Tenant> {
  const t = await createTenant("run");
  const productId = await missedCallProductId(admin);
  if (setup.enabled !== false) {
    await admin
      .from("business_products")
      .insert({ business_id: t.businessId, product_id: productId, enabled: true, config: (setup.config ?? {}) as never });
  }
  if (setup.subscription) await admin.from("subscriptions").update({ status: setup.subscription }).eq("business_id", t.businessId);
  if (setup.status) await admin.from("businesses").update({ status: setup.status }).eq("id", t.businessId);
  return t;
}

async function enqueueWork(t: Tenant, extra: Partial<Parameters<typeof enqueueAction>[1]> = {}) {
  await enqueueAction(admin, {
    businessId: t.businessId,
    type: "do_work",
    productKey: "missed-call",
    dedupeKey: `run-${randomUUID()}`,
    runAt: new Date(Date.now() - 60_000),
    ...extra,
  });
  const claimed = await claimDueAction(admin);
  if (!claimed) throw new Error("expected a due action");
  return claimed;
}

async function reload(id: string): Promise<ScheduledAction> {
  const { data } = await admin.from("scheduled_actions").select("*").eq("id", id).single();
  return data!;
}

async function logsFor(actionId: string) {
  const { data } = await admin.from("automation_logs").select("*").eq("scheduled_action_id", actionId).order("created_at");
  return data ?? [];
}

beforeEach(async () => {
  calls.length = 0;
  handlerImpl = async () => "done";
  await admin.from("scheduled_actions").update({ status: "cancelled" }).in("status", ["pending", "processing"]);
});

afterAll(cleanupTenants);

describe("enqueueAction", () => {
  it("creates an action once per dedupe key", async () => {
    const t = await makeBusiness();
    const input = { businessId: t.businessId, type: "do_work", productKey: "missed-call", dedupeKey: `dd-${randomUUID()}` };
    const first = await enqueueAction(admin, input);
    const second = await enqueueAction(admin, input);
    expect(first.created).toBe(true);
    expect(second).toEqual({ created: false, id: first.id });
    const { count } = await admin.from("scheduled_actions").select("*", { count: "exact", head: true }).eq("dedupe_key", input.dedupeKey);
    expect(count).toBe(1);
  });

  it("stores the product key in the payload and defaults to pending, due now", async () => {
    const t = await makeBusiness();
    const { id } = await enqueueAction(admin, { businessId: t.businessId, type: "do_work", productKey: "missed-call", payload: { a: 1 }, dedupeKey: `p-${randomUUID()}` });
    const row = await reload(id);
    expect(row.status).toBe("pending");
    expect(row.payload).toEqual({ a: 1, product_key: "missed-call" });
    expect(new Date(row.run_at).getTime()).toBeLessThanOrEqual(Date.now() + 1000);
  });
});

describe("runAction: success path", () => {
  it("runs the handler with config defaults and logs each step", async () => {
    const t = await makeBusiness();
    const action = await enqueueWork(t);
    expect(await runAction(deps, action)).toBe("done");

    expect(calls).toHaveLength(1);
    expect(calls[0].business.id).toBe(t.businessId);
    expect(calls[0].config).toEqual({ delay: 1 });
    expect(calls[0].now).toEqual(NOW);

    const row = await reload(action.id);
    expect(row.status).toBe("done");
    const logs = await logsFor(action.id);
    expect(logs.map((l) => [l.step, l.status, l.reason])).toEqual([
      ["condition", "ok", "conditions_passed"],
      ["system", "ok", "action_done"],
    ]);
  });

  it("routes a webhook event to the product that handles its type", async () => {
    const t = await makeBusiness();
    const { data: event } = await admin
      .from("webhook_events")
      .insert({ provider: "test", provider_event_id: `e-${randomUUID()}`, business_id: t.businessId, payload: { type: "test.event", data: { x: 1 } } })
      .select("*")
      .single();
    const action = await enqueueWork(t, { type: HANDLE_EVENT, productKey: undefined, payload: { webhook_event_id: event!.id } });

    expect(await runAction(deps, action)).toBe("done");
    expect(calls[0].event?.id).toBe(event!.id);
    const { data: after } = await admin.from("webhook_events").select("status, processed_at").eq("id", event!.id).single();
    expect(after?.status).toBe("processed");
    expect(after?.processed_at).not.toBeNull();
  });
});

describe("runAction: skips (logged, never deleted)", () => {
  it.each([
    ["a disabled business", { status: "disabled" }, "business_inactive"],
    ["a product that is not enabled", { enabled: false }, "product_disabled"],
    ["a cancelled subscription", { subscription: "cancelled" }, "subscription_blocked"],
    ["a past-due subscription", { subscription: "past_due" }, "subscription_blocked"],
  ])("skips for %s", async (_label, setup, reason) => {
    const t = await makeBusiness(setup);
    const action = await enqueueWork(t);
    expect(await runAction(deps, action)).toBe("skipped");

    expect(calls).toHaveLength(0);
    const row = await reload(action.id);
    expect(row).toMatchObject({ status: "cancelled", last_error: reason });
    const logs = await logsFor(action.id);
    expect(logs.map((l) => [l.step, l.status, l.reason])).toEqual([["condition", "skipped", reason]]);
  });

  it("skips an unknown product, a missing handler and an unhandled event type", async () => {
    const t = await makeBusiness();
    const unknown = await enqueueWork(t, { productKey: "ghost" });
    expect(await runAction(deps, unknown)).toBe("skipped");
    expect((await reload(unknown.id)).last_error).toBe("unknown_product");

    const noHandler = await enqueueWork(t, { type: "never_registered" });
    expect(await runAction(deps, noHandler)).toBe("skipped");
    expect((await reload(noHandler.id)).last_error).toBe("no_handler");

    const { data: event } = await admin
      .from("webhook_events")
      .insert({ provider: "test", provider_event_id: `e-${randomUUID()}`, business_id: t.businessId, payload: { type: "mystery.event" } })
      .select("id")
      .single();
    const unhandled = await enqueueWork(t, { type: HANDLE_EVENT, productKey: undefined, payload: { webhook_event_id: event!.id } });
    expect(await runAction(deps, unhandled)).toBe("skipped");
    expect((await reload(unhandled.id)).last_error).toBe("unhandled_event_type");
    const { data: after } = await admin.from("webhook_events").select("status").eq("id", event!.id).single();
    expect(after?.status).toBe("skipped");
  });

  it("skips when the event row is missing", async () => {
    const t = await makeBusiness();
    const action = await enqueueWork(t, { type: HANDLE_EVENT, productKey: undefined, payload: { webhook_event_id: randomUUID() } });
    expect(await runAction(deps, action)).toBe("skipped");
    expect((await reload(action.id)).last_error).toBe("event_not_found");
  });

  it("records a skip the handler asks for", async () => {
    handlerImpl = async () => ({ skip: "duplicate_in_window" });
    const t = await makeBusiness();
    const action = await enqueueWork(t);
    expect(await runAction(deps, action)).toBe("skipped");
    expect((await reload(action.id)).last_error).toBe("duplicate_in_window");
  });
});

describe("runAction: failures and retries", () => {
  it("retries a thrown error with 1 then 5 minute backoff, then fails on the third attempt", async () => {
    handlerImpl = async () => {
      throw new Error("provider exploded");
    };
    const t = await makeBusiness();

    const first = await enqueueWork(t);
    expect(first.attempts).toBe(1);
    expect(await runAction(deps, first)).toBe("retried");
    let row = await reload(first.id);
    expect(row.status).toBe("pending");
    expect(new Date(row.run_at).toISOString()).toBe(nextRunAt(1, NOW).toISOString());
    expect(row.last_error).toBe("provider exploded");

    // Make it due again and run the second attempt.
    await admin.from("scheduled_actions").update({ run_at: new Date(Date.now() - 1000).toISOString() }).eq("id", first.id);
    const second = (await claimDueAction(admin))!;
    expect(second.attempts).toBe(2);
    expect(await runAction(deps, second)).toBe("retried");
    row = await reload(first.id);
    expect(new Date(row.run_at).toISOString()).toBe(nextRunAt(2, NOW).toISOString());

    await admin.from("scheduled_actions").update({ run_at: new Date(Date.now() - 1000).toISOString() }).eq("id", first.id);
    const third = (await claimDueAction(admin))!;
    expect(third.attempts).toBe(3);
    expect(await runAction(deps, third)).toBe("failed");
    row = await reload(first.id);
    expect(row.status).toBe("failed");

    const logs = await logsFor(first.id);
    const errors = logs.filter((l) => l.status === "error").map((l) => l.reason);
    expect(errors).toEqual(["retry_scheduled", "retry_scheduled", "max_attempts_reached"]);
  });

  it("fails at once on a non-retryable adapter error", async () => {
    handlerImpl = async () => {
      throw new AdapterError("unreachable_recipient", "number is not on WhatsApp");
    };
    const t = await makeBusiness();
    const action = await enqueueWork(t);
    expect(await runAction(deps, action)).toBe("failed");
    const row = await reload(action.id);
    expect(row.status).toBe("failed");
    expect(row.last_error).toContain("unreachable_recipient");
    expect(row.attempts).toBe(1);
  });

  it("retries a retryable adapter error", async () => {
    handlerImpl = async () => {
      throw new AdapterError("rate_limited", "slow down");
    };
    const t = await makeBusiness();
    const action = await enqueueWork(t);
    expect(await runAction(deps, action)).toBe("retried");
    expect((await reload(action.id)).status).toBe("pending");
  });

  it("honours a handler-chosen retry time", async () => {
    const retryAt = new Date("2026-10-28T18:00:00Z");
    handlerImpl = async () => ({ retryAt, reason: "calendar busy" });
    const t = await makeBusiness();
    const action = await enqueueWork(t);
    expect(await runAction(deps, action)).toBe("retried");
    const row = await reload(action.id);
    expect(new Date(row.run_at).toISOString()).toBe(retryAt.toISOString());
    expect(row.last_error).toBe("calendar busy");
  });

  it("fails when the handler says fail, and marks the event failed", async () => {
    handlerImpl = async () => ({ fail: "bad data" });
    const t = await makeBusiness();
    const { data: event } = await admin
      .from("webhook_events")
      .insert({ provider: "test", provider_event_id: `e-${randomUUID()}`, business_id: t.businessId, payload: { type: "test.event" } })
      .select("id")
      .single();
    const action = await enqueueWork(t, { type: HANDLE_EVENT, productKey: undefined, payload: { webhook_event_id: event!.id } });
    expect(await runAction(deps, action)).toBe("failed");
    expect((await reload(action.id)).last_error).toBe("bad data");
    const { data: after } = await admin.from("webhook_events").select("status").eq("id", event!.id).single();
    expect(after?.status).toBe("failed");
  });

  it("fails without calling the handler when the saved config is invalid", async () => {
    const t = await makeBusiness({ config: { delay: "soon" } });
    const action = await enqueueWork(t);
    expect(await runAction(deps, action)).toBe("failed");
    expect(calls).toHaveLength(0);
    expect((await reload(action.id)).last_error).toBe("invalid_config");
  });

  it("redacts secrets and phone numbers in error messages", async () => {
    handlerImpl = async () => {
      throw new Error("send to +447911123456 failed with Bearer abc123token");
    };
    const t = await makeBusiness();
    const action = await enqueueWork(t);
    await runAction(deps, action);
    const row = await reload(action.id);
    expect(row.last_error).not.toContain("+447911123456");
    expect(row.last_error).not.toContain("abc123token");
    expect(row.last_error).toContain("3456");
  });
});

describe("step logger via handlers", () => {
  it("writes handler log steps with redacted details", async () => {
    handlerImpl = async (ctx) => {
      await ctx.log.step({ step: "action", status: "ok", reason: "sent", details: { to: "+447911123456", token: "abc", id: 7 } });
      return "done";
    };
    const t = await makeBusiness();
    const action = await enqueueWork(t);
    await runAction(deps, action);
    const logs = await logsFor(action.id);
    const sent = logs.find((l) => l.reason === "sent")!;
    expect(sent.details).toEqual({ to: "+********3456", token: "[redacted]", id: 7 });
  });
});

describe("requeueFailedAction (admin retry)", () => {
  it("puts a failed action back with a fresh attempt budget, and only failed ones", async () => {
    handlerImpl = async () => ({ fail: "boom" });
    const t = await makeBusiness();
    const action = await enqueueWork(t);
    await runAction(deps, action);
    expect((await reload(action.id)).status).toBe("failed");

    expect(await requeueFailedAction(admin, action.id, NOW)).toBe(true);
    const row = await reload(action.id);
    expect(row).toMatchObject({ status: "pending", attempts: 0, last_error: null });
    // Not failed any more, so a second requeue does nothing.
    expect(await requeueFailedAction(admin, action.id, NOW)).toBe(false);
  });
});
