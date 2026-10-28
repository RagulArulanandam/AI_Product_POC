/**
 * STOP wording (security-privacy.md section 9). A message that is, trimmed and ignoring case,
 * exactly one of these words opts the sender out. Exact match only, so "please don't stop by"
 * or "cancel my appointment" are ordinary messages.
 */
const STOP_WORDS = new Set(["stop", "stopall", "unsubscribe", "cancel", "end", "quit"]);

export function isStopMessage(body: string): boolean {
  return STOP_WORDS.has(body.trim().toLowerCase().replace(/[.!]+$/, ""));
}
