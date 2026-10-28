import { randomUUID } from "node:crypto";
import { z } from "zod";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { enqueueAction } from "@/engine/queue";
import type { EngineDeps } from "@/engine/runner";
import { runDueActions } from "@/engine/worker";
import type { Admin, HandlerResult } from "@/engine/types";
import { POST } from "@/app/api/worker/route";
import type { ProductManifest } from "@/products/types";
import { serviceClient } from "../helpers/db";
import { missedCallProductId } from "../helpers/tenant-tables";
import { cleanupTenants, createTenant, type Tenant } from "../helpers/tenants";

const admin = serviceClient() as unknown as Admin;
const results: Record<string, HandlerResult | Error> = {};
const order: string[] = [];

const fakeProduct: ProductManifest = {
  key: "missed-call",
  name: "Fake",
  description: "Fake product for worker tests",
  status: "available",
  configSchema: z.object({}),
  defaultConfig: {},
  handledEvents: [],
  handlers: {
    work: async (ctx) => {
      const label = String((ctx.action.payload as Record<string, unknown>).label);
      order.push(label);
      const outcome = results[label] ?? "done";
      if (outcome instanceof Error) throw outcome;
      return outcome;
    },
  },
};

const deps: EngineDeps = { admin, products: [fakeProduct], now: () => new Date(), services: {} };

let tenant: Tenant;

async function enqueue(label: string, minutesAgo = 1) {
  await enqueueAction(admin, {
    businessId: tenant.businessId,
    type: "work",
    productKey: "missed-call",
    payload: { label },
    dedupeKey: `w-${randomUUID()}`,
    runAt: new Date(Date.now() - minutesAgo * 60_000),
  });
}

beforeAll(async () => {
  tenant = await createTenant("worker");
  await admin
    .from("business_products")
    .insert({ business_id: tenant.businessId, product_id: await missedCallProductId(admin), enabled: true });
});

beforeEach(async () => {
  order.length = 0;
  for (const k of Object.keys(results)) delete results[k];
  await admin.from("scheduled_actions").update({ status: "cancelled" }).in("status", ["pending", "processing"]);
});

afterAll(cleanupTenants);

describe("runDueActions", () => {
  it("does nothing when nothing is due", async () => {
    expect(await runDueActions(deps)).toEqual({ claimed: 0, done: 0, retried: 0, failed: 0, skipped: 0 });
  });

  it("runs every due action in run_at order and counts the outcomes", async () => {
    results.ok = "done";
    results.skipme = { skip: "nope" };
    results.failme = { fail: "bad" };
    results.retryme = new Error("flaky");
    await enqueue("retryme", 1);
    await enqueue("ok", 5);
    await enqueue("failme", 3);
    await enqueue("skipme", 4);

    const summary = await runDueActions(deps);
    expect(order).toEqual(["ok", "skipme", "failme", "retryme"]);
    expect(summary).toEqual({ claimed: 4, done: 1, retried: 1, failed: 1, skipped: 1 });
  });

  it("leaves future actions alone", async () => {
    await enqueue("later", -60);
    expect((await runDueActions(deps)).claimed).toBe(0);
    expect(order).toEqual([]);
  });

  it("stops at the action cap and picks up the rest next time", async () => {
    for (const label of ["a", "b", "c"]) await enqueue(label);
    expect((await runDueActions(deps, { maxActions: 2 })).claimed).toBe(2);
    expect((await runDueActions(deps, { maxActions: 2 })).claimed).toBe(1);
  });

  it("stops claiming when the time budget is spent", async () => {
    await enqueue("a");
    expect((await runDueActions(deps, { budgetMs: 0 })).claimed).toBe(0);
    expect((await runDueActions(deps)).claimed).toBe(1);
  });

  it("gives each action to exactly one of several concurrent workers", async () => {
    for (const label of ["a", "b", "c", "d", "e", "f"]) await enqueue(label);
    const summaries = await Promise.all([runDueActions(deps), runDueActions(deps), runDueActions(deps)]);
    expect(summaries.reduce((n, s) => n + s.claimed, 0)).toBe(6);
    expect([...order].sort()).toEqual(["a", "b", "c", "d", "e", "f"]);
  });

  it("re-runs a retried action once its backoff has passed, then fails it for good", async () => {
    results.flaky = new Error("still broken");
    await enqueue("flaky");
    expect((await runDueActions(deps)).retried).toBe(1);
    // Not due yet (backoff), so the next call finds nothing.
    expect((await runDueActions(deps)).claimed).toBe(0);

    for (const expected of ["retried", "failed"] as const) {
      await admin.from("scheduled_actions").update({ run_at: new Date(Date.now() - 1000).toISOString() }).eq("status", "pending");
      const summary = await runDueActions(deps);
      expect(summary[expected]).toBe(1);
    }
    expect(order).toEqual(["flaky", "flaky", "flaky"]);
  });
});

describe("POST /api/worker", () => {
  const url = "http://localhost/api/worker";
  const secret = () => process.env.WORKER_SECRET!;

  it("rejects requests without a valid bearer token", async () => {
    const headerSets: Record<string, string>[] = [
      {},
      { authorization: "Bearer wrong" },
      { authorization: secret() },
      { authorization: "Basic abc" },
    ];
    for (const headers of headerSets) {
      const res = await POST(new Request(url, { method: "POST", headers }));
      expect(res.status).toBe(401);
      expect(await res.json()).toEqual({ error: "unauthorized" });
    }
  });

  it("does not run anything for an unauthorised caller", async () => {
    await enqueue("guarded");
    await POST(new Request(url, { method: "POST", headers: { authorization: "Bearer wrong" } }));
    expect(order).toEqual([]);
    const { count } = await admin.from("scheduled_actions").select("*", { count: "exact", head: true }).eq("status", "pending");
    expect(count).toBe(1);
  });

  it("processes due work and returns a summary for the right token", async () => {
    // The route uses the real product registry, whose Product 1 has no handlers yet, so the
    // action is skipped with `no_handler`. That still proves auth, claiming and bookkeeping.
    await enqueue("real-registry");
    const res = await POST(new Request(url, { method: "POST", headers: { authorization: `Bearer ${secret()}` } }));
    expect(res.status).toBe(200);
    expect(res.headers.get("cache-control")).toBe("no-store");
    expect(await res.json()).toEqual({ claimed: 1, done: 0, retried: 0, failed: 0, skipped: 1 });
  });

  it("refuses everyone when the server has no secret configured", async () => {
    const saved = process.env.WORKER_SECRET;
    delete process.env.WORKER_SECRET;
    try {
      const res = await POST(new Request(url, { method: "POST", headers: { authorization: "Bearer " } }));
      expect(res.status).toBe(500);
      expect(await res.json()).toEqual({ error: "worker_not_configured" });
    } finally {
      process.env.WORKER_SECRET = saved;
    }
  });
});
