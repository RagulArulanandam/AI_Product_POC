/** How states are shown to people: a plain label and a colour tone. Pure, so it is easy to test. */

export type Tone = "success" | "warning" | "danger" | "neutral" | "info";

export interface StatusDisplay {
  label: string;
  tone: Tone;
}

const CONVERSATION: Record<string, StatusDisplay> = {
  pending_send: { label: "Sending soon", tone: "info" },
  awaiting_reply: { label: "Waiting for reply", tone: "info" },
  in_conversation: { label: "In conversation", tone: "info" },
  offering_slots: { label: "Offering times", tone: "info" },
  booked: { label: "Booked", tone: "success" },
  enquiry_logged: { label: "Enquiry logged", tone: "success" },
  escalated: { label: "Needs you", tone: "danger" },
  opted_out: { label: "Opted out", tone: "neutral" },
  expired: { label: "No reply", tone: "neutral" },
  failed: { label: "Failed", tone: "warning" },
};

export function conversationStatus(state: string): StatusDisplay {
  return CONVERSATION[state] ?? { label: state.replace(/_/g, " "), tone: "neutral" };
}

const INTEGRATION: Record<string, StatusDisplay> = {
  connected: { label: "Connected", tone: "success" },
  disconnected: { label: "Not connected", tone: "neutral" },
  error: { label: "Needs attention", tone: "danger" },
};

export function integrationStatus(status: string | null | undefined): StatusDisplay {
  return INTEGRATION[status ?? "disconnected"] ?? INTEGRATION.disconnected;
}

const SUBSCRIPTION: Record<string, StatusDisplay> = {
  trial: { label: "Free trial", tone: "info" },
  active: { label: "Active", tone: "success" },
  past_due: { label: "Payment overdue", tone: "warning" },
  cancelled: { label: "Cancelled", tone: "danger" },
};

export function subscriptionStatus(status: string): StatusDisplay {
  return SUBSCRIPTION[status] ?? { label: status, tone: "neutral" };
}

const REASONS: Record<string, string> = {
  complaint: "Complaint",
  wants_human: "Asked for a person",
  low_confidence: "Assistant unsure",
  urgent: "Urgent",
  medical_advice: "Health or safety question",
  turn_cap: "Long conversation",
  invalid_model_output: "Assistant error",
  ai_unavailable: "Assistant unavailable",
  model_requested: "Assistant asked for a person",
  calendar_error: "Calendar problem",
};

export function escalationReason(reason: string | null | undefined): string {
  if (!reason) return "";
  return REASONS[reason] ?? reason.replace(/_/g, " ");
}

const INTENTS: Record<string, string> = {
  book_appointment: "Booking",
  enquiry: "Enquiry",
  complaint: "Complaint",
  other: "Other",
  needs_human: "Wants a person",
  opt_out: "Opt-out",
  media: "Picture",
  none: "",
};

export function intentLabel(intent: string | null | undefined): string {
  if (!intent) return "";
  return INTENTS[intent] ?? intent.replace(/_/g, " ");
}
