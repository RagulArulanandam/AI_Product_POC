import type { SupabaseClient } from "@supabase/supabase-js";

/**
 * Every table with tenant data. The meta-test in tests/db/schema.test.ts compares this list
 * with the database, so a new tenant table without an entry here fails the build
 * (testing.md section 3).
 */
export interface TenantTableSpec {
  table: string;
  /** Column that scopes a row to a business (`id` for businesses itself). */
  scopeColumn: "id" | "business_id";
  /** Whether members may read their own rows. False for tables tenants never see. */
  tenantReadable: boolean;
  /** A change tests try to make to another tenant's row. Never a real change. */
  tamper: Record<string, unknown>;
  /** An insert as tenant A that points at tenant B, which must be refused. */
  crossTenantInsert: (ctx: {
    victimBusinessId: string;
    attackerUserId: string;
    productId: string;
  }) => Record<string, unknown> | null;
  /** Make sure the business has at least one row in this table. */
  ensureRow: (admin: SupabaseClient, businessId: string) => Promise<void>;
}

const noop = async () => {};
const NIL_UUID = "00000000-0000-0000-0000-000000000000";

function check<T>(label: string, res: { data: T; error: { message: string } | null }): NonNullable<T> {
  if (res.error || res.data === null || res.data === undefined) throw new Error(`${label} failed: ${res.error?.message}`);
  return res.data as NonNullable<T>;
}

async function ensureIntegration(admin: SupabaseClient, businessId: string): Promise<string> {
  const row = check(
    "ensureIntegration",
    await admin
      .from("integrations")
      .upsert({ business_id: businessId, provider: "google_calendar" }, { onConflict: "business_id,provider" })
      .select("id")
      .single(),
  );
  return row.id;
}

export async function missedCallProductId(admin: SupabaseClient): Promise<string> {
  return check("missedCallProductId", await admin.from("products").select("id").eq("key", "missed-call").single()).id;
}

async function ensureCustomer(admin: SupabaseClient, businessId: string): Promise<string> {
  const row = check(
    "ensureCustomer",
    await admin
      .from("customers")
      .upsert({ business_id: businessId, phone_e164: "+447700900201" }, { onConflict: "business_id,phone_e164" })
      .select("id")
      .single(),
  );
  return row.id;
}

/** Returns the id of the business's first conversation, creating one if needed. */
export async function ensureConversation(admin: SupabaseClient, businessId: string): Promise<string> {
  const existing = await admin.from("conversations").select("id").eq("business_id", businessId).limit(1);
  if (existing.data && existing.data.length > 0) return existing.data[0].id;
  const row = check(
    "ensureConversation",
    await admin
      .from("conversations")
      .insert({
        business_id: businessId,
        customer_id: await ensureCustomer(admin, businessId),
        product_id: await missedCallProductId(admin),
      })
      .select("id")
      .single(),
  );
  return row.id;
}

export const TENANT_TABLES: TenantTableSpec[] = [
  {
    table: "businesses",
    scopeColumn: "id",
    tenantReadable: true,
    tamper: { name: "hacked" },
    crossTenantInsert: () => ({ name: "Injected", phone_e164: "+447700900999" }),
    ensureRow: noop, // created with the tenant
  },
  {
    table: "memberships",
    scopeColumn: "business_id",
    tenantReadable: true,
    tamper: { role: "staff" },
    crossTenantInsert: ({ victimBusinessId, attackerUserId }) => ({
      business_id: victimBusinessId,
      user_id: attackerUserId,
      role: "owner",
    }),
    ensureRow: noop, // owner membership is created with the tenant
  },
  {
    table: "subscriptions",
    scopeColumn: "business_id",
    tenantReadable: true,
    tamper: { status: "active" },
    crossTenantInsert: ({ victimBusinessId }) => ({ business_id: victimBusinessId, plan: "free-forever" }),
    ensureRow: noop, // trial subscription is created with the tenant
  },
  {
    table: "business_products",
    scopeColumn: "business_id",
    tenantReadable: true,
    tamper: { enabled: true },
    crossTenantInsert: ({ victimBusinessId, productId }) => ({
      business_id: victimBusinessId,
      product_id: productId,
      enabled: false,
    }),
    ensureRow: async (admin, businessId) => {
      check(
        "ensureRow business_products",
        await admin
          .from("business_products")
          .upsert(
            { business_id: businessId, product_id: await missedCallProductId(admin), enabled: false },
            { onConflict: "business_id,product_id" },
          )
          .select("id")
          .single(),
      );
    },
  },
  {
    table: "integrations",
    scopeColumn: "business_id",
    tenantReadable: true,
    tamper: { status: "connected" },
    crossTenantInsert: ({ victimBusinessId }) => ({ business_id: victimBusinessId, provider: "telephony" }),
    ensureRow: async (admin, businessId) => {
      await ensureIntegration(admin, businessId);
    },
  },
  {
    table: "integration_secrets",
    scopeColumn: "business_id",
    tenantReadable: false,
    tamper: { ciphertext: "stolen" },
    crossTenantInsert: ({ victimBusinessId }) => ({
      business_id: victimBusinessId,
      integration_id: NIL_UUID,
      ciphertext: "x",
    }),
    ensureRow: async (admin, businessId) => {
      const integrationId = await ensureIntegration(admin, businessId);
      check(
        "ensureRow integration_secrets",
        await admin
          .from("integration_secrets")
          .upsert(
            { integration_id: integrationId, business_id: businessId, ciphertext: "v1.test.ciphertext.tag" },
            { onConflict: "integration_id" },
          )
          .select("id")
          .single(),
      );
    },
  },
  {
    table: "phone_numbers",
    scopeColumn: "business_id",
    tenantReadable: true,
    tamper: { e164: "+447700900998" },
    crossTenantInsert: ({ victimBusinessId }) => ({ business_id: victimBusinessId, e164: "+447700900997" }),
    ensureRow: async (admin, businessId) => {
      const existing = await admin.from("phone_numbers").select("id").eq("business_id", businessId).limit(1);
      if (existing.data && existing.data.length > 0) return;
      check(
        "ensureRow phone_numbers",
        await admin
          .from("phone_numbers")
          .insert({ business_id: businessId, e164: `+447700900${Math.floor(Math.random() * 800) + 100}` })
          .select("id")
          .single(),
      );
    },
  },
  {
    table: "customers",
    scopeColumn: "business_id",
    tenantReadable: true,
    tamper: { name: "hacked" },
    crossTenantInsert: ({ victimBusinessId }) => ({ business_id: victimBusinessId, phone_e164: "+447700900299" }),
    ensureRow: async (admin, businessId) => {
      await ensureCustomer(admin, businessId);
    },
  },
  {
    table: "conversations",
    scopeColumn: "business_id",
    tenantReadable: true,
    tamper: { state: "booked" },
    crossTenantInsert: ({ victimBusinessId, productId }) => ({
      business_id: victimBusinessId,
      customer_id: NIL_UUID,
      product_id: productId,
    }),
    ensureRow: async (admin, businessId) => {
      await ensureConversation(admin, businessId);
    },
  },
  {
    table: "messages",
    scopeColumn: "business_id",
    tenantReadable: true,
    tamper: { body: "hacked" },
    crossTenantInsert: ({ victimBusinessId }) => ({
      business_id: victimBusinessId,
      conversation_id: NIL_UUID,
      direction: "inbound",
      sender: "customer",
      status: "received",
    }),
    ensureRow: async (admin, businessId) => {
      const existing = await admin.from("messages").select("id").eq("business_id", businessId).limit(1);
      if (existing.data && existing.data.length > 0) return;
      check(
        "ensureRow messages",
        await admin
          .from("messages")
          .insert({
            business_id: businessId,
            conversation_id: await ensureConversation(admin, businessId),
            direction: "inbound",
            sender: "customer",
            body: "hello",
            status: "received",
          })
          .select("id")
          .single(),
      );
    },
  },
  {
    table: "scheduled_actions",
    scopeColumn: "business_id",
    tenantReadable: false,
    tamper: { status: "done" },
    crossTenantInsert: ({ victimBusinessId }) => ({
      business_id: victimBusinessId,
      type: "evil",
      dedupe_key: `evil-${victimBusinessId}`,
    }),
    ensureRow: async (admin, businessId) => {
      check(
        "ensureRow scheduled_actions",
        await admin
          .from("scheduled_actions")
          .upsert(
            // Far future so tests of the queue never pick it up.
            {
              business_id: businessId,
              type: "iso-test",
              dedupe_key: `iso-${businessId}`,
              run_at: "2999-01-01T00:00:00Z",
            },
            { onConflict: "dedupe_key" },
          )
          .select("id")
          .single(),
      );
    },
  },
  {
    table: "automation_logs",
    scopeColumn: "business_id",
    tenantReadable: true,
    tamper: { reason: "hacked" },
    crossTenantInsert: ({ victimBusinessId }) => ({
      business_id: victimBusinessId,
      event_type: "evil",
      step: "event",
      status: "ok",
    }),
    ensureRow: async (admin, businessId) => {
      const existing = await admin.from("automation_logs").select("id").eq("business_id", businessId).limit(1);
      if (existing.data && existing.data.length > 0) return;
      check(
        "ensureRow automation_logs",
        await admin
          .from("automation_logs")
          .insert({ business_id: businessId, event_type: "iso-test", step: "event", status: "ok", reason: "seed" })
          .select("id")
          .single(),
      );
    },
  },
  {
    table: "webhook_events",
    scopeColumn: "business_id",
    tenantReadable: false,
    tamper: { status: "processed" },
    crossTenantInsert: ({ victimBusinessId }) => ({
      provider: "evil",
      provider_event_id: `evil-${victimBusinessId}`,
      business_id: victimBusinessId,
    }),
    ensureRow: async (admin, businessId) => {
      check(
        "ensureRow webhook_events",
        await admin
          .from("webhook_events")
          .upsert(
            { provider: "test", provider_event_id: `iso-${businessId}`, business_id: businessId },
            { onConflict: "provider,provider_event_id" },
          )
          .select("id")
          .single(),
      );
    },
  },
];

/** Tables that no tenant may read or write at all. */
export const NO_TENANT_ACCESS_TABLES = ["platform_admins", "opt_outs"];
