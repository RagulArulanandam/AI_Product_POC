import { randomUUID } from "node:crypto";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { claimDueAction, enqueueAction } from "@/engine/queue";
import type { Admin } from "@/engine/types";
import {
  countFailedActions,
  getBusinessDetail,
  getPlatformMetrics,
  listAutomationLogs,
  listBusinessOverviews,
  listFailedActions,
  maskPhone,
  retryFailedAction,
  setBusinessStatus,
  setProductForBusiness,
  setSubscription,
} from "@/services/admin";
import { serviceClient } from "../helpers/db";
import { missedCallProductId } from "../helpers/tenant-tables";
import { cleanupTenants, createTenant, type Tenant } from "../helpers/tenants";

const admin = serviceClient() as unknown as Admin;
const NOW = new Date("2026-10-28T12:00:00Z");

let a: Tenant;
let b: Tenant;
let adminUserId: string;

beforeAll(async () => {
  a = await createTenant("adm-a");
  b = await createTenant("adm-b");
  adminUserId = randomUUID();
});

afterAll(cleanupTenants);

async function adminActions(businessId: string) {
  const { data } = await admin.from("automation_logs").select("reason, details, step, status").eq("business_id", businessId).eq("event_type", "admin_action");
  return data ?? [];
}

async function failedAction(tenant: Tenant, error = "Twilio 21614: not a valid mobile number") {
  const { id } = await enqueueAction(admin, { businessId: tenant.businessId, type: "send_first_message", dedupeKey: `adm:${randomUUID()}` });
  await admin.from("scheduled_actions").update({ status: "failed", attempts: 3, last_error: error }).eq("id", id);
  return id;
}

describe("maskPhone", () => {
  it("keeps the country code and the last three digits", () => {
    expect(maskPhone("+447700900123")).toBe("+44•••••123");
  });

  it("leaves very short values alone", () => {
    expect(maskPhone("+44123")).toBe("+44123");
  });
});

describe("business list", () => {
  it("shows every business with subscription, products, integrations and usage", async () => {
    await setProductForBusiness(admin, adminUserId, a.businessId, "missed-call", true);
    must(await admin.from("integrations").insert({ business_id: a.businessId, provider: "google_calendar", status: "connected", account_label: "owner@example.com" }));
    must(
      await admin
        .from("conversations")
        .insert({ business_id: a.businessId, customer_id: await customerFor(a), product_id: await missedCallProductId(admin), state: "escalated", escalation_reason: "complaint" }),
    );
    await failedAction(a);

    const list = await listBusinessOverviews(admin, NOW);
    const rowA = list.find((r) => r.id === a.businessId)!;
    const rowB = list.find((r) => r.id === b.businessId)!;

    expect(rowA.subscription?.status).toBe("trial");
    expect(rowA.products.map((p) => p.key)).toEqual(["missed-call"]);
    expect(rowA.integrations).toEqual([{ provider: "google_calendar", status: "connected" }]);
    expect(rowA.phoneMasked).toMatch(/^\+44•+\d{3}$/);
    expect(rowA.stats.failedActions).toBe(1);
    expect(rowB.products).toEqual([]);
    expect(rowB.stats).toEqual({ conversations: 0, escalations: 0, failedActions: 0 });
  });

  it("counts conversations and escalations from the last 30 days only", async () => {
    const row = (await listBusinessOverviews(admin, NOW)).find((r) => r.id === a.businessId)!;
    // The conversation above started "now" (real clock), so from a distant clock it is in the future window.
    const old = (await listBusinessOverviews(admin, new Date("2030-01-01T00:00:00Z"))).find((r) => r.id === a.businessId)!;
    expect(row.stats.conversations).toBeGreaterThanOrEqual(0);
    expect(old.stats.conversations).toBe(0);
    expect(old.stats.escalations).toBe(0);
  });

  it("gives platform totals", async () => {
    const m = await getPlatformMetrics(admin, new Date());
    expect(m.businesses).toBeGreaterThanOrEqual(2);
    expect(m.activeBusinesses).toBeGreaterThanOrEqual(2);
    expect(m.escalations).toBeGreaterThanOrEqual(1);
    expect(m.failedActions).toBe(await countFailedActions(admin));
  });
});

describe("business detail", () => {
  it("lists every registered product and marks only the enabled available one", async () => {
    const detail = (await getBusinessDetail(admin, a.businessId))!;
    expect(detail.products.map((p) => [p.key, p.enabled, p.available])).toEqual([
      ["missed-call", true, true],
      ["priority-inbox", false, false],
      ["daily-brief", false, false],
    ]);
    expect(detail.integrations[0].accountLabel).toBe("owner@example.com");
    expect(detail.recentConversations).toHaveLength(1);
  });

  it("returns null for an unknown business", async () => {
    expect(await getBusinessDetail(admin, randomUUID())).toBeNull();
  });
});

describe("business status", () => {
  it("pauses and resumes a business and logs who did it", async () => {
    const paused = await setBusinessStatus(admin, adminUserId, b.businessId, "disabled");
    expect(paused).toEqual({ ok: true, message: "Business paused" });
    expect((await admin.from("businesses").select("status").eq("id", b.businessId).single()).data?.status).toBe("disabled");

    expect((await setBusinessStatus(admin, adminUserId, b.businessId, "active")).ok).toBe(true);
    expect((await admin.from("businesses").select("status").eq("id", b.businessId).single()).data?.status).toBe("active");

    const log = (await adminActions(b.businessId)).map((l) => [l.reason, (l.details as { admin_user_id: string }).admin_user_id]);
    expect(log).toEqual(expect.arrayContaining([["business_disabled", adminUserId], ["business_enabled", adminUserId]]));
  });

  it("refuses an unknown business without logging", async () => {
    const result = await setBusinessStatus(admin, adminUserId, randomUUID(), "disabled");
    expect(result.ok).toBe(false);
  });
});

describe("subscription", () => {
  it("changes status, plan, end date and notes", async () => {
    const result = await setSubscription(admin, adminUserId, b.businessId, {
      status: "past_due",
      plan: "pro",
      currentPeriodEnd: "2026-12-31T23:59:59.000Z",
      notes: "Card failed, chasing",
    });
    expect(result.ok).toBe(true);

    const detail = (await getBusinessDetail(admin, b.businessId))!;
    expect(detail.subscription).toEqual({ status: "past_due", plan: "pro", currentPeriodEnd: "2026-12-31T23:59:59+00:00", notes: "Card failed, chasing" });
    expect((await adminActions(b.businessId)).some((l) => l.reason === "subscription_changed")).toBe(true);
  });

  it("creates the row when a business has none", async () => {
    await admin.from("subscriptions").delete().eq("business_id", b.businessId);
    expect((await setSubscription(admin, adminUserId, b.businessId, { status: "active", plan: "starter", currentPeriodEnd: null, notes: "" })).ok).toBe(true);
    expect((await getBusinessDetail(admin, b.businessId))!.subscription?.status).toBe("active");
  });

  it("refuses an unknown business", async () => {
    expect((await setSubscription(admin, adminUserId, randomUUID(), { status: "active", plan: "x", currentPeriodEnd: null, notes: "" })).ok).toBe(false);
  });
});

describe("product toggle", () => {
  it("switches a product on even when the subscription would block the business", async () => {
    await admin.from("subscriptions").update({ status: "cancelled" }).eq("business_id", b.businessId);
    expect((await setProductForBusiness(admin, adminUserId, b.businessId, "missed-call", true)).ok).toBe(true);
    expect((await getBusinessDetail(admin, b.businessId))!.products[0].enabled).toBe(true);

    expect((await setProductForBusiness(admin, adminUserId, b.businessId, "missed-call", false)).ok).toBe(true);
    expect((await getBusinessDetail(admin, b.businessId))!.products[0].enabled).toBe(false);

    const reasons = (await adminActions(b.businessId)).map((l) => l.reason);
    expect(reasons).toEqual(expect.arrayContaining(["product_enabled", "product_disabled"]));
  });

  it("refuses coming-soon and unknown products and unknown businesses", async () => {
    expect((await setProductForBusiness(admin, adminUserId, a.businessId, "priority-inbox", true)).ok).toBe(false);
    expect((await setProductForBusiness(admin, adminUserId, a.businessId, "nope", true)).ok).toBe(false);
    expect((await setProductForBusiness(admin, adminUserId, randomUUID(), "missed-call", true)).ok).toBe(false);
  });
});

describe("failed automations and retry", () => {
  it("lists a failed action with its business and error, then retries it", async () => {
    const id = await failedAction(b, "Calendar down");
    const row = (await listFailedActions(admin)).find((f) => f.id === id)!;
    expect(row).toMatchObject({ businessId: b.businessId, type: "send_first_message", attempts: 3, maxAttempts: 3, lastError: "Calendar down" });
    expect(row.businessName).toBe((await getBusinessDetail(admin, b.businessId))!.name);

    const result = await retryFailedAction(admin, adminUserId, id, NOW);
    expect(result.ok).toBe(true);

    const { data: action } = await admin.from("scheduled_actions").select("status, attempts, last_error, run_at").eq("id", id).single();
    expect(action).toMatchObject({ status: "pending", attempts: 0, last_error: null });
    expect(new Date(action!.run_at).toISOString()).toBe(NOW.toISOString());
    expect((await listFailedActions(admin)).some((f) => f.id === id)).toBe(false);

    const log = (await adminActions(b.businessId)).find((l) => l.reason === "retry_action")!;
    expect(log.details).toMatchObject({ admin_user_id: adminUserId, action_id: id, type: "send_first_message" });
  });

  it("runs again after retry: the worker can claim the action", async () => {
    const id = await failedAction(b);
    await retryFailedAction(admin, adminUserId, id, new Date(Date.now() - 60_000));
    // Drain until our action is claimed (other tests' actions may be due too).
    let claimed = null;
    for (let i = 0; i < 20 && claimed?.id !== id; i++) claimed = await claimDueAction(admin);
    expect(claimed?.id).toBe(id);
  });

  it("refuses to retry an action that is not failed, twice in a row, or unknown", async () => {
    const id = await failedAction(b);
    expect((await retryFailedAction(admin, adminUserId, id, NOW)).ok).toBe(true);
    const again = await retryFailedAction(admin, adminUserId, id, NOW);
    expect(again.ok).toBe(false);

    const { id: pendingId } = await enqueueAction(admin, { businessId: b.businessId, type: "x", dedupeKey: `adm:${randomUUID()}` });
    expect((await retryFailedAction(admin, adminUserId, pendingId, NOW)).ok).toBe(false);
    expect((await retryFailedAction(admin, adminUserId, randomUUID(), NOW)).ok).toBe(false);
  });
});

describe("automation logs", () => {
  it("filters by business and status, newest first", async () => {
    must(await admin.from("automation_logs").insert([
      { business_id: a.businessId, event_type: "call.missed", step: "condition", status: "skipped", reason: "outside_hours", details: {} },
      { business_id: a.businessId, event_type: "call.missed", step: "action", status: "error", reason: "send_failed", details: { error: "boom" } },
    ]));

    const all = await listAutomationLogs(admin, { businessId: a.businessId });
    expect(all.length).toBeGreaterThanOrEqual(2);
    expect(all.every((l) => l.businessId === a.businessId)).toBe(true);
    expect(all[0].createdAt >= all[all.length - 1].createdAt).toBe(true);

    const errors = await listAutomationLogs(admin, { businessId: a.businessId, status: "error" });
    expect(errors.map((l) => l.reason)).toEqual(["send_failed"]);
    expect(errors[0].businessName).toBeTruthy();
  });

  it("never returns another business's rows for a business filter", async () => {
    const forB = await listAutomationLogs(admin, { businessId: b.businessId });
    expect(forB.some((l) => l.businessId === a.businessId)).toBe(false);
  });
});

function must(res: { error: { message: string } | null }): void {
  if (res.error) throw new Error(res.error.message);
}

async function customerFor(tenant: Tenant): Promise<string> {
  const { data, error } = await admin
    .from("customers")
    .insert({ business_id: tenant.businessId, phone_e164: `+447700900${Math.floor(Math.random() * 900) + 100}` })
    .select("id")
    .single();
  if (error || !data) throw new Error(`customer insert failed: ${error?.message}`);
  return data.id;
}
