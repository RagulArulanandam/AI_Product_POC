import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "@/lib/database.types";
import type { ConversationSummary } from "./dashboard";

type Db = SupabaseClient<Database>;

export const FILTERS = ["all", "needs-you", "active", "booked", "closed"] as const;
export type ConversationFilter = (typeof FILTERS)[number];

export const FILTER_LABELS: Record<ConversationFilter, string> = {
  all: "All",
  "needs-you": "Needs you",
  active: "Active",
  booked: "Booked",
  closed: "Closed",
};

const STATES_BY_FILTER: Record<Exclude<ConversationFilter, "all">, string[]> = {
  "needs-you": ["escalated"],
  active: ["pending_send", "awaiting_reply", "in_conversation", "offering_slots"],
  booked: ["booked"],
  closed: ["enquiry_logged", "opted_out", "expired", "failed"],
};

/** Reads the `?filter=` value from the address bar, falling back to "all" for anything unknown. */
export function parseFilter(value: string | string[] | undefined): ConversationFilter {
  const v = Array.isArray(value) ? value[0] : value;
  return (FILTERS as readonly string[]).includes(v ?? "") ? (v as ConversationFilter) : "all";
}

export const PAGE_SIZE = 25;

export interface ConversationPage {
  items: ConversationSummary[];
  /** Pass as `before` to get the next (older) page, or null when this is the last one. */
  nextBefore: string | null;
}

/** Characters allowed in a search: enough for names and phone numbers, nothing that changes the query. */
function cleanSearch(q: string): string {
  return q.replace(/[^\p{L}\p{N}\s+'.-]/gu, "").trim().slice(0, 60);
}

/**
 * A page of conversations, newest first. Filter by group of states, search by customer name or
 * number, and page back in time with `before` (the `started_at` of the last row seen).
 */
export async function listConversations(
  supabase: Db,
  businessId: string,
  options: { filter?: ConversationFilter; q?: string; before?: string; limit?: number } = {},
): Promise<ConversationPage> {
  const limit = options.limit ?? PAGE_SIZE;
  const filter = options.filter ?? "all";

  let customerIds: string[] | null = null;
  const q = options.q ? cleanSearch(options.q) : "";
  if (q) {
    const digits = q.replace(/[^\d+]/g, "");
    const clauses = [`name.ilike.%${q.replace(/[,()%]/g, " ")}%`];
    if (digits.length >= 3) clauses.push(`phone_e164.ilike.%${digits.replace(/^0/, "")}%`);
    const { data } = await supabase.from("customers").select("id").eq("business_id", businessId).or(clauses.join(","));
    customerIds = (data ?? []).map((c) => c.id);
    if (customerIds.length === 0) return { items: [], nextBefore: null };
  }

  let query = supabase
    .from("conversations")
    .select("id, state, started_at, last_intent, escalation_reason, customer:customers(phone_e164, name)")
    .eq("business_id", businessId)
    .order("started_at", { ascending: false })
    .limit(limit + 1);

  if (filter !== "all") query = query.in("state", STATES_BY_FILTER[filter]);
  if (customerIds) query = query.in("customer_id", customerIds);
  if (options.before) query = query.lt("started_at", options.before);

  const { data, error } = await query;
  if (error) throw new Error(`listConversations failed: ${error.message}`);

  const rows = data ?? [];
  const page = rows.slice(0, limit);
  return {
    items: page.map((row) => ({
      id: row.id,
      state: row.state,
      startedAt: row.started_at,
      lastIntent: row.last_intent,
      escalationReason: row.escalation_reason,
      customer: { phone: row.customer?.phone_e164 ?? "", name: row.customer?.name ?? null },
    })),
    nextBefore: rows.length > limit ? page[page.length - 1].started_at : null,
  };
}

export interface ThreadMessage {
  id: string;
  direction: "inbound" | "outbound";
  sender: "customer" | "ai" | "system";
  body: string;
  status: string;
  intent: string | null;
  createdAt: string;
}

export interface ConversationDetail {
  id: string;
  state: string;
  startedAt: string;
  lastInboundAt: string | null;
  lastOutboundAt: string | null;
  expiresAt: string | null;
  turnCount: number;
  lastIntent: string | null;
  escalationReason: string | null;
  escalatedAt: string | null;
  customer: { phone: string; name: string | null };
  messages: ThreadMessage[];
}

/** One conversation with its messages in order, or null when it is not this business's. */
export async function getConversation(supabase: Db, businessId: string, id: string): Promise<ConversationDetail | null> {
  const { data: convo } = await supabase
    .from("conversations")
    .select(
      "id, state, started_at, last_inbound_at, last_outbound_at, expires_at, turn_count, last_intent, escalation_reason, escalated_at, customer:customers(phone_e164, name)",
    )
    .eq("id", id)
    .eq("business_id", businessId)
    .maybeSingle();
  if (!convo) return null;

  const { data: messages } = await supabase
    .from("messages")
    .select("id, direction, sender, body, status, intent, created_at")
    .eq("conversation_id", id)
    .order("created_at", { ascending: true });

  return {
    id: convo.id,
    state: convo.state,
    startedAt: convo.started_at,
    lastInboundAt: convo.last_inbound_at,
    lastOutboundAt: convo.last_outbound_at,
    expiresAt: convo.expires_at,
    turnCount: convo.turn_count,
    lastIntent: convo.last_intent,
    escalationReason: convo.escalation_reason,
    escalatedAt: convo.escalated_at,
    customer: { phone: convo.customer?.phone_e164 ?? "", name: convo.customer?.name ?? null },
    messages: (messages ?? []).map((m) => ({
      id: m.id,
      direction: m.direction as "inbound" | "outbound",
      sender: m.sender as "customer" | "ai" | "system",
      body: m.body,
      status: m.status,
      intent: m.intent,
      createdAt: m.created_at,
    })),
  };
}
