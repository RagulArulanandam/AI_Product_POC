import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";

const { afterTasks } = vi.hoisted(() => ({ afterTasks: [] as (() => Promise<unknown>)[] }));
vi.mock("next/server", async (importOriginal) => {
  const actual = await importOriginal<typeof import("next/server")>();
  return { ...actual, after: (task: () => Promise<unknown>) => void afterTasks.push(task) };
});

import { randomUUID } from "node:crypto";
import { POST } from "@/app/api/dev/simulate-missed-call/route";
import { getFakeMessaging } from "@/adapters/messaging";
import type { EngineDeps } from "@/engine/runner";
import type { Admin } from "@/engine/types";
import { runDueActions } from "@/engine/worker";
import { getProduct } from "@/products/registry";
import { serviceClient } from "../helpers/db";
import { missedCallProductId } from "../helpers/tenant-tables";
import { cleanupTenants, createTenant, type Tenant } from "../helpers/tenants";

const admin = serviceClient() as unknown as Admin;
const fake = getFakeMessaging();
const URL = "http://localhost/api/dev/simulate-missed-call";
const FROM = "+447700900451";

let tenant: Tenant;
const saved = { flag: process.env.ENABLE_DEV_ENDPOINTS, secret: process.env.WORKER_SECRET };

function call(body: unknown, headers: Record<string, string> = { authorization: `Bearer ${process.env.WORKER_SECRET}` }) {
  return POST(new Request(URL, { method: "POST", headers: { "content-type": "application/json", ...headers }, body: JSON.stringify(body) }));
}

beforeAll(async () => {
  process.env.ENABLE_DEV_ENDPOINTS = "true";
  tenant = await createTenant("sim");
  await admin
    .from("business_products")
    .insert({ business_id: tenant.businessId, product_id: await missedCallProductId(admin), enabled: true, config: { delay_minutes: 0 } });
});

beforeEach(() => {
  afterTasks.length = 0;
  fake.reset();
  process.env.ENABLE_DEV_ENDPOINTS = "true";
  vi.unstubAllEnvs();
});

afterAll(async () => {
  if (saved.flag === undefined) delete process.env.ENABLE_DEV_ENDPOINTS;
  else process.env.ENABLE_DEV_ENDPOINTS = saved.flag;
  await cleanupTenants();
});

describe("POST /api/dev/simulate-missed-call: access control", () => {
  it("does not exist (404) unless ENABLE_DEV_ENDPOINTS is true", async () => {
    for (const value of [undefined, "false", "1", "TRUE"]) {
      if (value === undefined) delete process.env.ENABLE_DEV_ENDPOINTS;
      else process.env.ENABLE_DEV_ENDPOINTS = value;
      const res = await call({ businessId: tenant.businessId, from: FROM });
      expect(res.status, String(value)).toBe(404);
    }
  });

  it("does not exist in a production build, even with the flag on", async () => {
    vi.stubEnv("NODE_ENV", "production");
    expect((await call({ businessId: tenant.businessId, from: FROM })).status).toBe(404);
  });

  it("answers 404 before looking at credentials when disabled", async () => {
    delete process.env.ENABLE_DEV_ENDPOINTS;
    expect((await call({ businessId: tenant.businessId, from: FROM }, {})).status).toBe(404);
  });

  it("needs the worker secret when enabled", async () => {
    const headerSets: Record<string, string>[] = [
      {},
      { authorization: "Bearer wrong" },
      { authorization: process.env.WORKER_SECRET! },
    ];
    for (const headers of headerSets) {
      const res = await call({ businessId: tenant.businessId, from: FROM }, headers);
      expect(res.status).toBe(401);
    }
    expect(afterTasks).toHaveLength(0);
  });
});

describe("POST /api/dev/simulate-missed-call: behaviour", () => {
  it.each([
    ["a missing business", { from: FROM }],
    ["a business id that is not a UUID", { businessId: "nope", from: FROM }],
    ["a phone that is not E.164", { businessId: randomUUID(), from: "07700 900451" }],
    ["no phone", { businessId: randomUUID() }],
  ])("answers 400 for %s", async (_label, body) => {
    expect((await call(body)).status).toBe(400);
  });

  it("answers 404 for a business that does not exist", async () => {
    const res = await call({ businessId: randomUUID(), from: FROM });
    expect(res.status).toBe(404);
    expect(await res.json()).toEqual({ error: "business_not_found" });
  });

  it("queues a simulated call.missed event for the business and runs the worker after responding", async () => {
    const res = await call({ businessId: tenant.businessId, from: FROM });
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body).toMatchObject({ ok: true, status: "accepted" });

    const { data: event } = await admin.from("webhook_events").select("*").eq("id", body.webhookEventId).single();
    expect(event).toMatchObject({ provider: "simulated", business_id: tenant.businessId });
    expect(event?.payload).toMatchObject({ type: "call.missed", data: { from: FROM, simulated: true, skip_dedupe: true } });
    expect(afterTasks).toHaveLength(1);
  });

  it("only asks to bypass the dedupe window when skipDedupe is true (the default)", async () => {
    const strict = await (await call({ businessId: tenant.businessId, from: FROM, skipDedupe: false })).json();
    const { data: event } = await admin.from("webhook_events").select("payload").eq("id", strict.webhookEventId).single();
    expect(JSON.stringify(event?.payload)).not.toContain("skip_dedupe");
  });

  it("drives the real Product 1 flow end to end: call, conversation, delayed message", async () => {
    const deps: EngineDeps = {
      admin,
      products: [getProduct("missed-call")!],
      now: () => new Date(),
      services: { messaging: () => fake },
    };
    // Start clean: earlier tests in this file left queued events behind.
    for (const table of ["scheduled_actions", "webhook_events", "conversations"] as const) {
      await admin.from(table).delete().eq("business_id", tenant.businessId);
    }

    await call({ businessId: tenant.businessId, from: FROM });
    await runDueActions(deps); // the call.missed handler runs and schedules the send (delay 0)
    await admin
      .from("scheduled_actions")
      .update({ run_at: "2000-01-01T00:00:00Z" })
      .eq("business_id", tenant.businessId)
      .eq("status", "pending");
    await runDueActions(deps); // the send runs

    const { data: convo } = await admin.from("conversations").select("state").eq("business_id", tenant.businessId).single();
    expect(convo?.state).toBe("awaiting_reply");
    expect(fake.sent).toHaveLength(1);
    expect(fake.sent[0].to).toBe(FROM);
  });
});
