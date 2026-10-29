import { randomUUID } from "node:crypto";
import { z } from "zod";
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import type { EngineDeps } from "@/engine/runner";
import { runDueActions } from "@/engine/worker";
import {
  handleWebhook,
  MAX_WEBHOOK_BODY_BYTES,
  ingestWebhookEvent,
  type NormalisedEvent,
  type WebhookDeps,
  type WebhookProvider,
} from "@/engine/webhooks";
import type { Admin, HandlerContext } from "@/engine/types";
import type { ProductManifest } from "@/products/types";
import { serviceClient } from "../helpers/db";
import { missedCallProductId } from "../helpers/tenant-tables";
import { cleanupTenants, createTenant, type Tenant } from "../helpers/tenants";

const admin = serviceClient() as unknown as Admin;
const PUBLIC_BASE = "https://tunnel.example.com";
let tenant: Tenant;

const handled: HandlerContext[] = [];
const fakeProduct: ProductManifest = {
  key: "missed-call",
  name: "Fake",
  description: "Fake product for webhook tests",
  status: "available",
  configSchema: z.object({}),
  defaultConfig: {},
  handledEvents: ["test.ping"],
  handlers: {
    "test.ping": async (ctx) => {
      handled.push(ctx);
      await ctx.log.step({ step: "event", status: "ok", reason: "ping_handled" });
      return "done";
    },
  },
};
const engineDeps: EngineDeps = { admin, products: [fakeProduct], now: () => new Date(), services: {} };

function newEvent(overrides: Partial<NormalisedEvent> = {}): NormalisedEvent {
  return {
    eventId: `evt-${randomUUID()}`,
    type: "test.ping",
    data: { hello: "world" },
    businessId: tenant.businessId,
    ...overrides,
  };
}

async function counts(eventId: string) {
  const { data: events } = await admin.from("webhook_events").select("id").eq("provider", "test").eq("provider_event_id", eventId);
  const ids = (events ?? []).map((e) => e.id);
  const { count: actions } = await admin
    .from("scheduled_actions")
    .select("*", { count: "exact", head: true })
    .in("dedupe_key", ids.map((id) => `evt:${id}`));
  return { events: ids.length, actions: actions ?? 0 };
}

beforeAll(async () => {
  tenant = await createTenant("hook");
  await admin
    .from("business_products")
    .insert({ business_id: tenant.businessId, product_id: await missedCallProductId(admin), enabled: true });
});

beforeEach(async () => {
  handled.length = 0;
  await admin.from("scheduled_actions").update({ status: "cancelled" }).in("status", ["pending", "processing"]);
});

afterAll(cleanupTenants);

describe("ingestWebhookEvent", () => {
  it("stores the event and queues one handle_event action", async () => {
    const event = newEvent();
    const result = await ingestWebhookEvent(admin, "test", event);
    expect(result.status).toBe("accepted");

    const { data: stored } = await admin.from("webhook_events").select("*").eq("id", result.webhookEventId).single();
    expect(stored).toMatchObject({ provider: "test", provider_event_id: event.eventId, status: "received", business_id: tenant.businessId });
    expect(stored?.payload).toEqual({ type: "test.ping", data: { hello: "world" } });

    const { data: action } = await admin.from("scheduled_actions").select("*").eq("dedupe_key", `evt:${result.webhookEventId}`).single();
    expect(action).toMatchObject({ type: "handle_event", status: "pending", business_id: tenant.businessId });
    expect(action?.payload).toEqual({ webhook_event_id: result.webhookEventId });
  });

  it("ignores a repeat delivery of the same provider event", async () => {
    const event = newEvent();
    const first = await ingestWebhookEvent(admin, "test", event);
    const again = await ingestWebhookEvent(admin, "test", event);
    const third = await ingestWebhookEvent(admin, "test", event);

    expect(again).toEqual({ status: "duplicate", webhookEventId: first.webhookEventId });
    expect(third.status).toBe("duplicate");
    expect(await counts(event.eventId)).toEqual({ events: 1, actions: 1 });
  });

  it("treats the same event id from a different provider as a different event", async () => {
    const event = newEvent();
    await ingestWebhookEvent(admin, "test", event);
    const other = await ingestWebhookEvent(admin, "other-provider", event);
    expect(other.status).toBe("accepted");
    await admin.from("webhook_events").delete().eq("provider", "other-provider");
  });

  it("re-queues work for an event that was stored but never queued (crash recovery)", async () => {
    const event = newEvent();
    const { data: orphan } = await admin
      .from("webhook_events")
      .insert({ provider: "test", provider_event_id: event.eventId, business_id: tenant.businessId, payload: { type: "test.ping", data: {} } })
      .select("id")
      .single();
    expect(await counts(event.eventId)).toEqual({ events: 1, actions: 0 });

    expect((await ingestWebhookEvent(admin, "test", event)).status).toBe("duplicate");
    expect(await counts(event.eventId)).toEqual({ events: 1, actions: 1 });
    // And a further retry still does not add another.
    await ingestWebhookEvent(admin, "test", event);
    expect(await counts(event.eventId)).toEqual({ events: 1, actions: 1 });
    expect(orphan).not.toBeNull();
  });

  it("records an event whose business could not be resolved, but queues nothing", async () => {
    const event = newEvent({ businessId: null });
    const result = await ingestWebhookEvent(admin, "test", event);
    expect(result.status).toBe("unresolved");

    const { data: stored } = await admin.from("webhook_events").select("status, business_id, processed_at").eq("id", result.webhookEventId).single();
    expect(stored).toMatchObject({ status: "skipped", business_id: null });
    expect(stored?.processed_at).not.toBeNull();
    expect(await counts(event.eventId)).toEqual({ events: 1, actions: 0 });
  });
});

describe("handleWebhook", () => {
  let verifyCalls: { url: string; params: Record<string, string>; signature: string | null }[];
  let scheduled: (() => Promise<unknown>)[];
  const validSignature = "good-signature";

  const provider: WebhookProvider = {
    name: "test",
    signatureHeader: "x-test-signature",
    verify: (input) => {
      verifyCalls.push(input);
      return input.signature === validSignature;
    },
    parse: (params) =>
      params.id ? { eventId: params.id, type: params.type ?? "test.ping", data: { note: params.note ?? "" }, businessId: params.business ?? null } : null,
  };

  const deps = (): WebhookDeps => ({
    admin,
    publicBaseUrl: PUBLIC_BASE,
    schedule: (task) => {
      scheduled.push(task);
    },
    runWorker: () => runDueActions(engineDeps),
  });

  function post(params: Record<string, string>, signature: string | null = validSignature, path = "/api/webhooks/test?src=1") {
    return new Request(`http://localhost:3000${path}`, {
      method: "POST",
      headers: { "content-type": "application/x-www-form-urlencoded", ...(signature ? { "x-test-signature": signature } : {}) },
      body: new URLSearchParams(params).toString(),
    });
  }

  beforeEach(() => {
    verifyCalls = [];
    scheduled = [];
  });

  it("rejects an invalid signature with 403 and stores nothing", async () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    const id = `forged-${randomUUID()}`;
    const res = await handleWebhook(post({ id, business: tenant.businessId, note: "secret text" }, "forged"), provider, deps());

    expect(res.status).toBe(403);
    expect(await res.json()).toEqual({ error: "invalid_signature" });
    expect(await counts(id)).toEqual({ events: 0, actions: 0 });
    expect(scheduled).toHaveLength(0);

    // One structured log line, and it must not contain the payload.
    expect(warn).toHaveBeenCalledTimes(1);
    const line = String(warn.mock.calls[0][0]);
    expect(JSON.parse(line)).toEqual({ event: "webhook_rejected", provider: "test", reason: "invalid_signature" });
    expect(line).not.toContain("secret text");
    warn.mockRestore();
  });

  it("rejects a request with no signature header", async () => {
    vi.spyOn(console, "warn").mockImplementation(() => {});
    const res = await handleWebhook(post({ id: "x", business: tenant.businessId }, null), provider, deps());
    expect(res.status).toBe(403);
    vi.restoreAllMocks();
  });

  it("refuses an oversized body with 413 before reading it or checking anything", async () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    const id = `big-${randomUUID()}`;
    const big = new Request("http://localhost:3000/api/webhooks/test", {
      method: "POST",
      headers: { "content-type": "application/x-www-form-urlencoded", "x-test-signature": validSignature },
      body: new URLSearchParams({ id, business: tenant.businessId, note: "x".repeat(MAX_WEBHOOK_BODY_BYTES + 1) }).toString(),
    });
    // Node fills content-length for string bodies sent through fetch, but a Request does not: declare it.
    big.headers.set("content-length", String(MAX_WEBHOOK_BODY_BYTES + 1));

    const res = await handleWebhook(big, provider, deps());
    expect(res.status).toBe(413);
    expect(verifyCalls).toHaveLength(0);
    expect(await counts(id)).toEqual({ events: 0, actions: 0 });
    expect(JSON.parse(String(warn.mock.calls[0][0]))).toMatchObject({ reason: "body_too_large" });
    warn.mockRestore();
  });

  it("verifies against PUBLIC_BASE_URL plus path and query, not the request host", async () => {
    await handleWebhook(post({ id: `u-${randomUUID()}`, business: tenant.businessId }), provider, deps());
    expect(verifyCalls).toHaveLength(1);
    expect(verifyCalls[0].url).toBe("https://tunnel.example.com/api/webhooks/test?src=1");
    expect(verifyCalls[0].params.id).toMatch(/^u-/);
  });

  it("answers 400 for a verified but unusable payload, storing nothing", async () => {
    const res = await handleWebhook(post({ note: "no id" }), provider, deps());
    expect(res.status).toBe(400);
    expect(scheduled).toHaveLength(0);
  });

  it("accepts a valid event: 200, one event, one action, and the worker scheduled once", async () => {
    const id = `ok-${randomUUID()}`;
    const res = await handleWebhook(post({ id, business: tenant.businessId }), provider, deps());
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ ok: true });
    expect(await counts(id)).toEqual({ events: 1, actions: 1 });
    expect(scheduled).toHaveLength(1);
  });

  it("stays idempotent when the provider retries: one event, one action, no second worker run", async () => {
    const id = `retry-${randomUUID()}`;
    const params = { id, business: tenant.businessId };
    expect((await handleWebhook(post(params), provider, deps())).status).toBe(200);
    expect((await handleWebhook(post(params), provider, deps())).status).toBe(200);
    expect((await handleWebhook(post(params), provider, deps())).status).toBe(200);

    expect(await counts(id)).toEqual({ events: 1, actions: 1 });
    expect(scheduled).toHaveLength(1);
  });

  it("acknowledges an event with no resolvable business and does not run the worker", async () => {
    vi.spyOn(console, "warn").mockImplementation(() => {});
    const id = `nobody-${randomUUID()}`;
    const res = await handleWebhook(post({ id }), provider, deps());
    expect(res.status).toBe(200);
    expect(await counts(id)).toEqual({ events: 1, actions: 0 });
    expect(scheduled).toHaveLength(0);
    vi.restoreAllMocks();
  });

  it("lets a provider shape the response (for example TwiML)", async () => {
    const withBody: WebhookProvider = { ...provider, respond: () => new Response("<Response/>", { headers: { "content-type": "text/xml" } }) };
    const res = await handleWebhook(post({ id: `twiml-${randomUUID()}`, business: tenant.businessId }), withBody, deps());
    expect(await res.text()).toBe("<Response/>");
    expect(res.headers.get("content-type")).toBe("text/xml");
  });
});

describe("end to end: webhook -> queue -> handler -> log", () => {
  it("passes a test event through the whole engine, and ignores its duplicate", async () => {
    const provider: WebhookProvider = {
      name: "test",
      signatureHeader: "x-test-signature",
      verify: () => true,
      parse: (params) => ({ eventId: params.id, type: "test.ping", data: { n: 1 }, businessId: params.business }),
    };
    const deps: WebhookDeps = {
      admin,
      publicBaseUrl: PUBLIC_BASE,
      schedule: () => {},
      runWorker: () => runDueActions(engineDeps),
    };
    const id = `e2e-${randomUUID()}`;
    const request = () =>
      new Request("http://localhost:3000/api/webhooks/test", {
        method: "POST",
        headers: { "content-type": "application/x-www-form-urlencoded", "x-test-signature": "x" },
        body: new URLSearchParams({ id, business: tenant.businessId }).toString(),
      });

    expect((await handleWebhook(request(), provider, deps)).status).toBe(200);
    expect((await handleWebhook(request(), provider, deps)).status).toBe(200); // provider retry

    const summary = await runDueActions(engineDeps);
    expect(summary).toEqual({ claimed: 1, done: 1, retried: 0, failed: 0, skipped: 0 });

    // The handler ran exactly once with the stored event.
    expect(handled).toHaveLength(1);
    expect(handled[0].event?.provider_event_id).toBe(id);
    expect(handled[0].event?.payload).toEqual({ type: "test.ping", data: { n: 1 } });

    // The event is processed and every step is in the log.
    const { data: stored } = await admin.from("webhook_events").select("id, status").eq("provider_event_id", id).single();
    expect(stored?.status).toBe("processed");
    const { data: action } = await admin.from("scheduled_actions").select("id, status").eq("dedupe_key", `evt:${stored!.id}`).single();
    expect(action?.status).toBe("done");
    const { data: logs } = await admin.from("automation_logs").select("step, status, reason").eq("scheduled_action_id", action!.id).order("created_at");
    expect(logs).toEqual([
      { step: "condition", status: "ok", reason: "conditions_passed" },
      { step: "event", status: "ok", reason: "ping_handled" },
      { step: "system", status: "ok", reason: "action_done" },
    ]);

    // Nothing left to do after the duplicate.
    expect((await runDueActions(engineDeps)).claimed).toBe(0);
  });
});
