import { AdapterError } from "@/lib/errors";

const EMAIL = /^[^\s@<>"]+@[^\s@<>"]+\.[^\s@<>"]+$/;

/** Shared input checks, so every implementation rejects the same bad input the same way. */
export function assertValidEmailInput(input: { to: string; subject: string; text: string }): void {
  if (!EMAIL.test(input.to)) throw new AdapterError("invalid_request", "Recipient is not a valid email address");
  // Line breaks in headers would let text smuggle in extra headers.
  if (/[\r\n]/.test(input.to) || /[\r\n]/.test(input.subject)) {
    throw new AdapterError("invalid_request", "Recipient and subject must be a single line");
  }
  if (!input.subject.trim()) throw new AdapterError("invalid_request", "Subject is empty");
  if (!input.text.trim()) throw new AdapterError("invalid_request", "Body is empty");
}
