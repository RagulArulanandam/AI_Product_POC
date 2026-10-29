import { logStep } from "@/engine/log";
import { requeueFailedAction } from "@/engine/queue";
import type { Admin } from "@/engine/types";
import type { Json } from "@/lib/database.types";
import { getProduct, listProducts } from "@/products/registry";

/**
 * Platform admin queries and actions (auth.md section 6). They use the service-role client, so
 * they are only ever called from src/app/admin after requireAdmin(). Every state change writes
 * an `admin_action` row to automation_logs with the admin's user id.
 */

const DAY_MS = 86_400_000;

/** Full numbers are not needed in admin tables: keep the country code and the last three digits. */
export function maskPhone(e164: string): string {
  return e164.length <= 7 ? e164 : `${e164.slice(0, 3)}•••••${e164.slice(-3)}`;
}

export type AdminResult = { ok: true; message: string } | { ok: false; message: string };
const ok = (message: string): AdminResult => ({ ok: true, message });
const fail = (message: string): AdminResult => ({ ok: false, message });

async function audit(admin: Admin, adminUserId: string, businessId: string, action: string, details: Record<string, unknown>) {
  await logStep(admin, {
    businessId,
    eventType: "admin_action",
    step: "system",
    status: "ok",
    reason: action,
    details: { admin_user_id: adminUserId, ...details },
  });
}

async function count(query: PromiseLike<{ count: number | null; error: { message: string } | null }>, label: string): Promise<number> {
  const { count: n, error } = await query;
  if (error) throw new Error(`${label} failed: ${error.message}`);
  return n ?? 0;
}

export interface BusinessOverview {
  id: string;
  name: string;
  phoneMasked: string;
  timezone: string;
  status: "active" | "disabled";
  createdAt: string;
  subscription: { status: string; plan: string } | null;
  products: { key: string; name: string }[];
  integrations: { provider: string; status: string }[];
  /** Counts for the last 30 days, except failedActions which is everything not yet retried. */
  stats: { conversations: number; escalations: number; failedActions: number };
}

/** Every business with its subscription, switched-on products, integration health and usage. */
export async function listBusinessOverviews(admin: Admin, now: Date): Promise<BusinessOverview[]> {
  const since = new Date(now.getTime() - 30 * DAY_MS).toISOString();

  const [businesses, subscriptions, products, integrations] = await Promise.all([
    admin.from("businesses").select("id, name, phone_e164, timezone, status, created_at").order("created_at", { ascending: false }),
    admin.from("subscriptions").select("business_id, status, plan"),
    admin.from("business_products").select("business_id, product:products(key)").eq("enabled", true),
    admin.from("integrations").select("business_id, provider, status"),
  ]);
  for (const [label, res] of [["businesses", businesses], ["subscriptions", subscriptions], ["products", products], ["integrations", integrations]] as const) {
    if (res.error) throw new Error(`listBusinessOverviews ${label} failed: ${res.error.message}`);
  }

  return Promise.all(
    (businesses.data ?? []).map(async (b) => {
      const [conversations, escalations, failedActions] = await Promise.all([
        count(admin.from("conversations").select("*", { count: "exact", head: true }).eq("business_id", b.id).gte("started_at", since), "conversations"),
        count(
          admin.from("conversations").select("*", { count: "exact", head: true }).eq("business_id", b.id).gte("started_at", since).not("escalation_reason", "is", null),
          "escalations",
        ),
        count(admin.from("scheduled_actions").select("*", { count: "exact", head: true }).eq("business_id", b.id).eq("status", "failed"), "failed actions"),
      ]);
      const sub = (subscriptions.data ?? []).find((s) => s.business_id === b.id);
      return {
        id: b.id,
        name: b.name,
        phoneMasked: maskPhone(b.phone_e164),
        timezone: b.timezone,
        status: b.status as "active" | "disabled",
        createdAt: b.created_at,
        subscription: sub ? { status: sub.status, plan: sub.plan } : null,
        products: (products.data ?? [])
          .filter((p) => p.business_id === b.id && p.product)
          .map((p) => ({ key: p.product!.key, name: getProduct(p.product!.key)?.name ?? p.product!.key })),
        integrations: (integrations.data ?? []).filter((i) => i.business_id === b.id).map((i) => ({ provider: i.provider, status: i.status })),
        stats: { conversations, escalations, failedActions },
      };
    }),
  );
}

export interface PlatformMetrics {
  businesses: number;
  activeBusinesses: number;
  conversations: number;
  bookings: number;
  escalations: number;
  failedActions: number;
  errorsLast24h: number;
}

/** Headline numbers across all businesses (conversations, bookings and escalations: last 30 days). */
export async function getPlatformMetrics(admin: Admin, now: Date): Promise<PlatformMetrics> {
  const since = new Date(now.getTime() - 30 * DAY_MS).toISOString();
  const dayAgo = new Date(now.getTime() - DAY_MS).toISOString();
  const head = { count: "exact" as const, head: true };

  const [businesses, active, conversations, bookings, escalations, failedActions, errorsLast24h] = await Promise.all([
    count(admin.from("businesses").select("*", head), "businesses"),
    count(admin.from("businesses").select("*", head).eq("status", "active"), "active businesses"),
    count(admin.from("conversations").select("*", head).gte("started_at", since), "conversations"),
    count(admin.from("conversations").select("*", head).gte("started_at", since).eq("state", "booked"), "bookings"),
    count(admin.from("conversations").select("*", head).gte("started_at", since).not("escalation_reason", "is", null), "escalations"),
    count(admin.from("scheduled_actions").select("*", head).eq("status", "failed"), "failed actions"),
    count(admin.from("automation_logs").select("*", head).eq("status", "error").gte("created_at", dayAgo), "error logs"),
  ]);
  return { businesses, activeBusinesses: active, conversations, bookings, escalations, failedActions, errorsLast24h };
}

export interface BusinessDetail {
  id: string;
  name: string;
  phoneMasked: string;
  timezone: string;
  status: "active" | "disabled";
  createdAt: string;
  subscription: { status: string; plan: string; currentPeriodEnd: string | null; notes: string } | null;
  products: { key: string; name: string; description: string; available: boolean; enabled: boolean }[];
  integrations: { provider: string; status: string; accountLabel: string | null; lastError: string | null }[];
  recentConversations: { id: string; state: string; startedAt: string; escalationReason: string | null }[];
}

export async function getBusinessDetail(admin: Admin, businessId: string): Promise<BusinessDetail | null> {
  const { data: b, error } = await admin
    .from("businesses")
    .select("id, name, phone_e164, timezone, status, created_at")
    .eq("id", businessId)
    .maybeSingle();
  if (error) throw new Error(`getBusinessDetail failed: ${error.message}`);
  if (!b) return null;

  const [sub, enabledProducts, integrations, conversations] = await Promise.all([
    admin.from("subscriptions").select("status, plan, current_period_end, notes").eq("business_id", businessId).maybeSingle(),
    admin.from("business_products").select("enabled, product:products(key)").eq("business_id", businessId),
    admin.from("integrations").select("provider, status, account_label, last_error").eq("business_id", businessId),
    admin.from("conversations").select("id, state, started_at, escalation_reason").eq("business_id", businessId).order("started_at", { ascending: false }).limit(8),
  ]);
  for (const res of [sub, enabledProducts, integrations, conversations]) {
    if (res.error) throw new Error(`getBusinessDetail failed: ${res.error.message}`);
  }

  const on = new Set((enabledProducts.data ?? []).filter((p) => p.enabled && p.product).map((p) => p.product!.key));
  return {
    id: b.id,
    name: b.name,
    phoneMasked: maskPhone(b.phone_e164),
    timezone: b.timezone,
    status: b.status as "active" | "disabled",
    createdAt: b.created_at,
    subscription: sub.data
      ? { status: sub.data.status, plan: sub.data.plan, currentPeriodEnd: sub.data.current_period_end, notes: sub.data.notes }
      : null,
    products: listProducts().map((p) => ({
      key: p.key,
      name: p.name,
      description: p.description,
      available: p.status === "available",
      enabled: p.status === "available" && on.has(p.key),
    })),
    integrations: (integrations.data ?? []).map((i) => ({
      provider: i.provider,
      status: i.status,
      accountLabel: i.account_label,
      lastError: i.last_error,
    })),
    recentConversations: (conversations.data ?? []).map((c) => ({
      id: c.id,
      state: c.state,
      startedAt: c.started_at,
      escalationReason: c.escalation_reason,
    })),
  };
}

export interface LogRow {
  id: string;
  businessId: string;
  businessName: string;
  eventType: string;
  step: string;
  status: string;
  reason: string | null;
  details: Json;
  createdAt: string;
}

export const LOG_STATUSES = ["ok", "skipped", "error"] as const;
export type LogStatusFilter = (typeof LOG_STATUSES)[number];

/** Newest automation log rows, optionally for one business and/or one status. */
export async function listAutomationLogs(
  admin: Admin,
  filter: { businessId?: string; status?: LogStatusFilter; limit?: number } = {},
): Promise<LogRow[]> {
  let query = admin
    .from("automation_logs")
    .select("id, business_id, event_type, step, status, reason, details, created_at, business:businesses(name)")
    .order("created_at", { ascending: false })
    .limit(filter.limit ?? 50);
  if (filter.businessId) query = query.eq("business_id", filter.businessId);
  if (filter.status) query = query.eq("status", filter.status);

  const { data, error } = await query;
  if (error) throw new Error(`listAutomationLogs failed: ${error.message}`);
  return (data ?? []).map((r) => ({
    id: r.id,
    businessId: r.business_id,
    businessName: r.business?.name ?? "Unknown",
    eventType: r.event_type,
    step: r.step,
    status: r.status,
    reason: r.reason,
    details: r.details,
    createdAt: r.created_at,
  }));
}

export interface FailedAction {
  id: string;
  businessId: string;
  businessName: string;
  type: string;
  attempts: number;
  maxAttempts: number;
  lastError: string | null;
  failedAt: string;
}

/** Actions that ran out of attempts, newest first. */
export async function listFailedActions(admin: Admin, limit = 100): Promise<FailedAction[]> {
  const { data, error } = await admin
    .from("scheduled_actions")
    .select("id, business_id, type, attempts, max_attempts, last_error, updated_at, business:businesses(name)")
    .eq("status", "failed")
    .order("updated_at", { ascending: false })
    .limit(limit);
  if (error) throw new Error(`listFailedActions failed: ${error.message}`);
  return (data ?? []).map((a) => ({
    id: a.id,
    businessId: a.business_id,
    businessName: a.business?.name ?? "Unknown",
    type: a.type,
    attempts: a.attempts,
    maxAttempts: a.max_attempts,
    lastError: a.last_error,
    failedAt: a.updated_at,
  }));
}

/** Pause or resume a business. A paused business's users see the notice and the engine skips its events. */
export async function setBusinessStatus(admin: Admin, adminUserId: string, businessId: string, status: "active" | "disabled"): Promise<AdminResult> {
  const { data, error } = await admin.from("businesses").update({ status }).eq("id", businessId).select("id");
  if (error) return fail("Could not update the business.");
  if (!data || data.length === 0) return fail("That business could not be found.");
  await audit(admin, adminUserId, businessId, status === "disabled" ? "business_disabled" : "business_enabled", { status });
  return ok(status === "disabled" ? "Business paused" : "Business resumed");
}

export interface SubscriptionInput {
  status: "trial" | "active" | "past_due" | "cancelled";
  plan: string;
  currentPeriodEnd: string | null;
  notes: string;
}

export async function setSubscription(admin: Admin, adminUserId: string, businessId: string, input: SubscriptionInput): Promise<AdminResult> {
  const { data: business } = await admin.from("businesses").select("id").eq("id", businessId).maybeSingle();
  if (!business) return fail("That business could not be found.");

  const { error } = await admin.from("subscriptions").upsert(
    {
      business_id: businessId,
      status: input.status,
      plan: input.plan,
      current_period_end: input.currentPeriodEnd,
      notes: input.notes,
    },
    { onConflict: "business_id" },
  );
  if (error) return fail("Could not save the subscription.");
  await audit(admin, adminUserId, businessId, "subscription_changed", { status: input.status, plan: input.plan });
  return ok("Subscription saved");
}

/** Switch a product on or off for a business. Admins may enable regardless of subscription status. */
export async function setProductForBusiness(admin: Admin, adminUserId: string, businessId: string, key: string, enabled: boolean): Promise<AdminResult> {
  const product = getProduct(key);
  if (!product) return fail("That product could not be found.");
  if (enabled && product.status !== "available") return fail("This product is not available yet.");

  const { data: business } = await admin.from("businesses").select("id").eq("id", businessId).maybeSingle();
  if (!business) return fail("That business could not be found.");
  const { data: row } = await admin.from("products").select("id").eq("key", key).maybeSingle();
  if (!row) return fail("That product could not be found.");

  const { data: existing } = await admin.from("business_products").select("id").eq("business_id", businessId).eq("product_id", row.id).maybeSingle();
  const write = existing
    ? await admin.from("business_products").update({ enabled }).eq("id", existing.id).select("id")
    : await admin
        .from("business_products")
        .insert({ business_id: businessId, product_id: row.id, enabled, config: product.defaultConfig as Record<string, Json | undefined> })
        .select("id");
  if (write.error || !write.data || write.data.length === 0) return fail("Could not update the product.");

  await audit(admin, adminUserId, businessId, enabled ? "product_enabled" : "product_disabled", { product: key });
  return ok(enabled ? `${product.name} switched on` : `${product.name} switched off`);
}

/** Put a failed action back in the queue with a fresh attempt budget (automation-engine.md section 5). */
export async function retryFailedAction(admin: Admin, adminUserId: string, actionId: string, now: Date): Promise<AdminResult> {
  const { data: action } = await admin.from("scheduled_actions").select("id, business_id, type, status").eq("id", actionId).maybeSingle();
  if (!action) return fail("That action could not be found.");
  if (action.status !== "failed") return fail("That action is no longer failed, so there is nothing to retry.");

  const requeued = await requeueFailedAction(admin, actionId, now);
  if (!requeued) return fail("That action is no longer failed, so there is nothing to retry.");

  await audit(admin, adminUserId, action.business_id, "retry_action", { action_id: actionId, type: action.type });
  return ok("Queued to run again. The worker picks it up within a minute.");
}

/** For the badge on the Failures link. */
export function countFailedActions(admin: Admin): Promise<number> {
  return count(admin.from("scheduled_actions").select("*", { count: "exact", head: true }).eq("status", "failed"), "failed actions");
}
