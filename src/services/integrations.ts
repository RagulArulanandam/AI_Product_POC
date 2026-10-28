import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "@/lib/database.types";

type Db = SupabaseClient<Database>;

export interface IntegrationsOverview {
  /** The Twilio number the business forwards missed calls to (assigned by the platform), if any. */
  assistantNumber: string | null;
  telephony: { status: "connected" | "disconnected" | "error"; forwardingConfirmed: boolean };
  calendar: { status: "connected" | "disconnected" | "error"; accountLabel: string | null; lastError: string | null };
}

const asStatus = (value: string | undefined): "connected" | "disconnected" | "error" =>
  value === "connected" || value === "error" ? value : "disconnected";

/** What the Integrations page shows. Secrets are never readable here (tenants have no access). */
export async function getIntegrationsOverview(supabase: Db, businessId: string): Promise<IntegrationsOverview> {
  const [{ data: numbers }, { data: integrations }] = await Promise.all([
    supabase.from("phone_numbers").select("e164").eq("business_id", businessId).order("created_at", { ascending: true }).limit(1),
    supabase.from("integrations").select("provider, status, account_label, last_error, metadata").eq("business_id", businessId),
  ]);

  const telephony = integrations?.find((i) => i.provider === "telephony");
  const calendar = integrations?.find((i) => i.provider === "google_calendar");
  const metadata = (telephony?.metadata ?? {}) as { forwarding_confirmed?: boolean };

  return {
    assistantNumber: numbers?.[0]?.e164 ?? null,
    telephony: { status: asStatus(telephony?.status), forwardingConfirmed: metadata.forwarding_confirmed === true },
    calendar: {
      status: asStatus(calendar?.status),
      accountLabel: calendar?.account_label ?? null,
      lastError: calendar?.last_error ?? null,
    },
  };
}

export type ForwardingResult = { ok: true } | { ok: false; message: string };

/** Records that the owner has (or has not) set up call forwarding. Goes through a narrow database function. */
export async function setForwardingConfirmed(supabase: Db, businessId: string, confirmed: boolean): Promise<ForwardingResult> {
  const { error } = await supabase.rpc("set_forwarding_confirmed", { p_business: businessId, p_confirmed: confirmed });
  if (!error) return { ok: true };
  if (error.message.includes("no_number")) {
    return { ok: false, message: "No assistant number has been assigned to your business yet. Please contact support." };
  }
  if (error.message.includes("forbidden")) return { ok: false, message: "You don't have permission to do that." };
  return { ok: false, message: "Something went wrong. Please try again." };
}

/**
 * Carrier codes that forward unanswered calls to the assistant number. They are standard on UK
 * networks but not universal: some carriers use app settings instead.
 */
export function forwardingCodes(number: string): { label: string; description: string; code: string }[] {
  return [
    { label: "When you don't answer", description: "Forward calls nobody picks up", code: `**61*${number}#` },
    { label: "When you're busy", description: "Forward calls when you are on another call", code: `**67*${number}#` },
    { label: "When your phone is off", description: "Forward calls when you have no signal", code: `**62*${number}#` },
    { label: "Turn forwarding off", description: "Cancel all of the above", code: "##002#" },
  ];
}
