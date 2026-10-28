/**
 * In Twilio trial template mode a sent message's stored text starts with a marker saying a fixed
 * template went out instead (see send.ts). People should see the intended text plus a note.
 */
const TEMPLATE_MARKER = /^\[trial template HX[0-9a-f]+\]\s*/i;

export function displayBody(stored: string): { text: string; sentAsTemplate: boolean } {
  const sentAsTemplate = TEMPLATE_MARKER.test(stored);
  return { text: stored.replace(TEMPLATE_MARKER, ""), sentAsTemplate };
}

export function deliveryLabel(status: string): { label: string; failed: boolean } | null {
  switch (status) {
    case "delivered":
      return { label: "Delivered", failed: false };
    case "sent":
      return { label: "Sent", failed: false };
    case "failed":
      return { label: "Not delivered", failed: true };
    case "queued":
      return { label: "Sending", failed: false };
    default:
      return null; // received messages have no delivery state
  }
}

/** A link that opens a WhatsApp chat with the number (wa.me wants digits only). */
export function whatsappLink(e164: string): string {
  return `https://wa.me/${e164.replace(/\D/g, "")}`;
}
