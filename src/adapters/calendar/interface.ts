import { createHash } from "node:crypto";

export interface BusyInterval {
  start: Date;
  end: Date;
}

export interface NewEvent {
  /** Deterministic, so booking twice is harmless (see bookingEventId). */
  eventId: string;
  start: Date;
  end: Date;
  summary: string;
  description: string;
}

/** Calendar boundary (integrations.md section 6). Only free/busy and event creation. Throws AdapterError. */
export interface CalendarAdapter {
  getFreeBusy(input: { timeMin: Date; timeMax: Date }): Promise<BusyInterval[]>;
  /** `created` is false when the event already existed (the same booking was made earlier). */
  createEvent(input: NewEvent): Promise<{ eventId: string; created: boolean }>;
}

/**
 * Google event ids allow lowercase letters a-v and digits, 5 to 1024 characters. Lowercase hex
 * fits, and the same conversation and slot always give the same id.
 */
export function bookingEventId(conversationId: string, start: Date): string {
  return createHash("sha256").update(`${conversationId}|${start.toISOString()}`).digest("hex").slice(0, 32);
}
