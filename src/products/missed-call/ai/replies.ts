/** Fixed customer-facing texts. These never come from the model. */

export const ESCALATION_ACK =
  "Thanks for your message. I've passed this to the team and someone will be in touch with you shortly.";

export const OPT_OUT_ACK = "You've been unsubscribed and won't receive any more messages from us. Thank you.";

export const MEDIA_REPLY = "Sorry, I can only read text messages. Could you type what you need?";

export const FALLBACK_REPLY = "Thanks for your message. The team will follow up with you shortly.";

/** Used for booking requests when no calendar is connected: the team confirms a time. */
export const BOOKING_PENDING_REPLY =
  "Thanks! I've noted your request and passed it to the team. They'll get back to you to confirm a time.";

export const SLOT_TAKEN_PREFIX = "Sorry, that time has just been taken.";

/** Offered times, always worked out by code from the calendar. `times` are already formatted. */
export function offerSlotsReply(times: string[], opening: string): string {
  const lines = times.map((t, i) => `${i + 1}. ${t}`);
  return [opening, ...lines, "Reply with the number you'd like, or tell me another day that suits you."].join("\n");
}

export const OFFER_OPENING = "Here are the next available times:";
export const OFFER_AGAIN_OPENING = "Here are some other times:";
export const SLOT_TAKEN_OPENING = `${SLOT_TAKEN_PREFIX} Here are some other times:`;

export function bookingConfirmedReply(businessName: string, when: string): string {
  return `You're booked in at ${businessName} on ${when}. We'll see you then! If you need to change it, just reply here.`;
}
