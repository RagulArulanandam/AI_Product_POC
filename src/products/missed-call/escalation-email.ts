import { maskPhone } from "@/lib/redact";

/** Why a conversation was handed to a person. */
export type EscalationReason =
  | "complaint"
  | "wants_human"
  | "low_confidence"
  | "urgent"
  | "medical_advice"
  | "turn_cap"
  | "invalid_model_output"
  | "ai_unavailable"
  | "model_requested"
  | "calendar_error";

export const REASON_LABELS: Record<EscalationReason, string> = {
  complaint: "The customer made a complaint",
  wants_human: "The customer asked to speak to a person",
  low_confidence: "The assistant was not confident how to answer",
  urgent: "The message sounded urgent",
  medical_advice: "The customer asked something the assistant must not answer (health or safety)",
  turn_cap: "The conversation went on longer than the assistant should handle",
  invalid_model_output: "The assistant could not produce a usable answer",
  ai_unavailable: "The assistant was unavailable",
  model_requested: "The assistant asked for a person to take over",
  calendar_error: "The calendar could not be used to book",
};

const MAX_EXCERPT = 200;

function oneLine(value: string): string {
  return value.replace(/[\r\n\t]+/g, " ").replace(/\s{2,}/g, " ").trim();
}

function escapeHtml(value: string): string {
  return value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

export interface EscalationEmailInput {
  businessName: string;
  reason: EscalationReason;
  customerPhone: string;
  customerName?: string | null;
  /** The customer's latest message, shown shortened. */
  lastMessage?: string | null;
  conversationUrl: string;
  at: Date;
  timezone: string;
}

/**
 * The email the owner gets when a conversation needs a person (product-missed-call.md,
 * "Escalation"): why, who (number masked; the link shows the full conversation), a short excerpt
 * and a link. Plain text and HTML, with everything escaped.
 */
export function buildEscalationEmail(input: EscalationEmailInput): { subject: string; text: string; html: string } {
  const label = REASON_LABELS[input.reason];
  const business = oneLine(input.businessName);
  const customer = input.customerName ? `${oneLine(input.customerName)} (${maskPhone(input.customerPhone)})` : maskPhone(input.customerPhone);
  const when = new Intl.DateTimeFormat("en-GB", { dateStyle: "medium", timeStyle: "short", timeZone: input.timezone }).format(input.at);

  let excerpt = input.lastMessage ? oneLine(input.lastMessage) : "";
  if (excerpt.length > MAX_EXCERPT) excerpt = `${excerpt.slice(0, MAX_EXCERPT)}…`;

  const subject = `Needs your attention: ${label} (${business})`.slice(0, 200);

  const lines = [
    `A conversation for ${business} needs a person.`,
    "",
    `Why: ${label}`,
    `Customer: ${customer}`,
    `When: ${when} (${input.timezone})`,
    ...(excerpt ? [`Their last message: "${excerpt}"`] : []),
    "",
    `Open the conversation: ${input.conversationUrl}`,
    "",
    "The assistant has told the customer that the team will be in touch and has stopped replying.",
  ];

  const html = [
    `<p>A conversation for <strong>${escapeHtml(business)}</strong> needs a person.</p>`,
    "<ul>",
    `<li><strong>Why:</strong> ${escapeHtml(label)}</li>`,
    `<li><strong>Customer:</strong> ${escapeHtml(customer)}</li>`,
    `<li><strong>When:</strong> ${escapeHtml(when)} (${escapeHtml(input.timezone)})</li>`,
    ...(excerpt ? [`<li><strong>Their last message:</strong> &ldquo;${escapeHtml(excerpt)}&rdquo;</li>`] : []),
    "</ul>",
    `<p><a href="${escapeHtml(input.conversationUrl)}">Open the conversation</a></p>`,
    "<p>The assistant has told the customer that the team will be in touch and has stopped replying.</p>",
  ].join("\n");

  return { subject, text: lines.join("\n"), html };
}
