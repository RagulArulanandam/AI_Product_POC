import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "@/lib/database.types";
import { getProductSettings } from "./products";
import type { MissedCallConfig } from "@/products/missed-call/config";

type Db = SupabaseClient<Database>;

export interface Metrics {
  /** Missed calls the assistant picked up (each opens a conversation). */
  missedCalls: number;
  /** Conversations where the customer wrote back. */
  conversations: number;
  bookings: number;
  /** Conversations handed to a person. */
  escalations: number;
}

/** Headline numbers for a period, counted straight from conversations (there is no metrics table). */
export async function getMetrics(supabase: Db, businessId: string, since: Date): Promise<Metrics> {
  const base = () =>
    supabase
      .from("conversations")
      .select("*", { count: "exact", head: true })
      .eq("business_id", businessId)
      .gte("started_at", since.toISOString());

  const [calls, replied, booked, escalated] = await Promise.all([
    base(),
    base().not("last_inbound_at", "is", null),
    base().eq("state", "booked"),
    base().not("escalation_reason", "is", null),
  ]);

  for (const result of [calls, replied, booked, escalated]) {
    if (result.error) throw new Error(`getMetrics failed: ${result.error.message}`);
  }
  return {
    missedCalls: calls.count ?? 0,
    conversations: replied.count ?? 0,
    bookings: booked.count ?? 0,
    escalations: escalated.count ?? 0,
  };
}

export interface ChecklistItem {
  key: string;
  title: string;
  description: string;
  done: boolean;
  href: string;
  cta: string;
  /** Optional items do not count towards "ready". */
  optional?: boolean;
}

export interface Checklist {
  items: ChecklistItem[];
  done: number;
  total: number;
}

/** What is left to do before the assistant can handle real calls. Driven by real data. */
export async function getSetupChecklist(supabase: Db, businessId: string): Promise<Checklist> {
  const settings = await getProductSettings(supabase, businessId, "missed-call");
  const config = settings?.config as MissedCallConfig | undefined;

  const { data: integrations } = await supabase
    .from("integrations")
    .select("provider, status, metadata")
    .eq("business_id", businessId);
  const telephony = integrations?.find((i) => i.provider === "telephony");
  const calendar = integrations?.find((i) => i.provider === "google_calendar");
  const forwarding = (telephony?.metadata as { forwarding_confirmed?: boolean } | null)?.forwarding_confirmed === true;

  const items: ChecklistItem[] = [
    {
      key: "profile",
      title: "Create your business profile",
      description: "Name, phone number and timezone.",
      done: true,
      href: "/settings",
      cta: "Review",
    },
    {
      key: "product",
      title: "Switch on the Missed Call assistant",
      description: "It messages customers when you miss their call.",
      done: settings?.enabled === true,
      href: "/products",
      cta: "Go to products",
    },
    {
      key: "messages",
      title: "Tell the assistant about your business",
      description: "Add a short description so it can answer questions accurately.",
      done: (config?.business_blurb ?? "").trim().length > 0,
      href: "/products/missed-call",
      cta: "Add details",
    },
    {
      key: "forwarding",
      title: "Forward your missed calls",
      description: "Set your phone to pass unanswered calls to your assistant number.",
      done: forwarding,
      href: "/integrations",
      cta: "See how",
    },
    {
      key: "calendar",
      title: "Connect Google Calendar",
      description: "Needed to book appointments automatically.",
      done: calendar?.status === "connected",
      href: "/integrations",
      cta: "Connect",
      optional: true,
    },
  ];

  const required = items.filter((i) => !i.optional);
  return { items, done: required.filter((i) => i.done).length, total: required.length };
}

export interface ConversationSummary {
  id: string;
  state: string;
  startedAt: string;
  lastIntent: string | null;
  escalationReason: string | null;
  customer: { phone: string; name: string | null };
}

/** The most recent conversations, newest first. */
export async function listRecentConversations(supabase: Db, businessId: string, limit = 5): Promise<ConversationSummary[]> {
  const { data, error } = await supabase
    .from("conversations")
    .select("id, state, started_at, last_intent, escalation_reason, customer:customers(phone_e164, name)")
    .eq("business_id", businessId)
    .order("started_at", { ascending: false })
    .limit(limit);
  if (error) throw new Error(`listRecentConversations failed: ${error.message}`);

  return (data ?? []).map((row) => ({
    id: row.id,
    state: row.state,
    startedAt: row.started_at,
    lastIntent: row.last_intent,
    escalationReason: row.escalation_reason,
    customer: { phone: row.customer?.phone_e164 ?? "", name: row.customer?.name ?? null },
  }));
}
