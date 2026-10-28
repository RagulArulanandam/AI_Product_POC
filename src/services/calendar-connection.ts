import { exchangeCode, revokeToken, type GoogleClient } from "@/adapters/calendar/google-oauth";
import { parseTokens, serializeTokens } from "@/adapters/calendar/store";
import type { Admin } from "@/engine/types";
import { createAdminClient } from "@/lib/supabase/admin";

/**
 * Connecting and disconnecting a business's Google Calendar (integrations.md section 6). Uses the
 * service role because tenants may not read or write `integration_secrets`; callers check the
 * person's permission first. Tokens are stored encrypted and never returned. The service-role
 * client is created here (this file is on the allowlist), and tests pass their own.
 */

export type ConnectResult = { ok: true; email: string | null } | { ok: false; reason: "no_access" | "failed" };

async function saveConnection(admin: Admin, businessId: string, label: string | null, ciphertext: string): Promise<void> {
  const { data: integration, error } = await admin
    .from("integrations")
    .upsert(
      { business_id: businessId, provider: "google_calendar", status: "connected", account_label: label, last_error: null },
      { onConflict: "business_id,provider" },
    )
    .select("id")
    .single();
  if (error || !integration) throw new Error(`Could not save the calendar connection: ${error?.message}`);

  const { error: secretError } = await admin
    .from("integration_secrets")
    .upsert({ integration_id: integration.id, business_id: businessId, ciphertext }, { onConflict: "integration_id" });
  if (secretError) throw new Error(`Could not save the calendar access: ${secretError.message}`);
}

/** Finishes the OAuth flow: swaps the code for tokens, encrypts and stores them. */
export async function connectGoogleCalendar(
  client: GoogleClient,
  businessId: string,
  code: string,
  now: Date,
  { admin = createAdminClient(), fetchFn = fetch }: { admin?: Admin; fetchFn?: typeof fetch } = {},
): Promise<ConnectResult> {
  let exchanged;
  try {
    exchanged = await exchangeCode(client, code, now, fetchFn);
  } catch (error) {
    return { ok: false, reason: (error as { code?: string }).code === "auth" ? "no_access" : "failed" };
  }
  await saveConnection(admin, businessId, exchanged.email, serializeTokens(exchanged.tokens));
  return { ok: true, email: exchanged.email };
}

/** Local demos without a Google project (`CALENDAR_ADAPTER=fake`): a connected calendar that holds no real access. */
export async function connectDemoCalendar(businessId: string, now: Date, admin: Admin = createAdminClient()): Promise<void> {
  const tokens = { accessToken: "demo", refreshToken: "demo", expiresAt: now.getTime() + 3_600_000 };
  await saveConnection(admin, businessId, "demo calendar", serializeTokens(tokens));
}

/**
 * Removes the connection: Google is told to revoke the access (best effort), the stored tokens are
 * deleted and the integration is marked disconnected. Always completes on our side.
 */
export async function disconnectGoogleCalendar(
  businessId: string,
  { admin = createAdminClient(), fetchFn = fetch }: { admin?: Admin; fetchFn?: typeof fetch } = {},
): Promise<{ revoked: boolean }> {
  const { data: integration } = await admin
    .from("integrations")
    .select("id")
    .eq("business_id", businessId)
    .eq("provider", "google_calendar")
    .maybeSingle();
  if (!integration) return { revoked: false };

  let revoked = false;
  const { data: secret } = await admin.from("integration_secrets").select("ciphertext").eq("integration_id", integration.id).maybeSingle();
  if (secret) {
    try {
      revoked = await revokeToken(parseTokens(secret.ciphertext).refreshToken, fetchFn);
    } catch {
      // Unreadable tokens cannot be revoked; they are deleted below either way.
    }
  }

  await admin.from("integration_secrets").delete().eq("integration_id", integration.id);
  await admin
    .from("integrations")
    .update({ status: "disconnected", account_label: null, last_error: null })
    .eq("id", integration.id);
  return { revoked };
}
