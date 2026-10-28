import { bookingEventId } from "@/adapters/calendar/interface";
import type { HandlerContext } from "@/engine/types";
import { AdapterError } from "@/lib/errors";
import { formatPhone } from "@/lib/phone";
import type { AiReply } from "../ai/contract";
import { bookingConfirmedReply, OFFER_AGAIN_OPENING, OFFER_OPENING, offerSlotsReply, SLOT_TAKEN_OPENING } from "../ai/replies";
import type { EscalationReason } from "../escalation-email";
import { parseHours } from "../hours";
import { computeSlots, formatSlot, HORIZON_DAYS, isSlotAvailable, localDate, type Slot, type SlotInput } from "../slots";
import { configOf, requireCalendar } from "./shared";

const DAY_MS = 24 * 60 * 60_000;
const MINUTE_MS = 60_000;

export interface BookingConversation {
  id: string;
  offered_slots: unknown;
  booking_service: string | null;
  booking_event_id: string | null;
  customer: { phone_e164: string; name: string | null };
}

export interface CalendarIntegration {
  id: string;
  status: string;
}

/** What the booking step wants done. The caller sends the reply and saves the update. */
export type BookingOutcome =
  | { kind: "escalate"; reason: Extract<EscalationReason, "calendar_error" | "no_availability"> }
  | { kind: "reply"; reply: string; state: "offering_slots" | "booked"; update: Record<string, unknown> };

/** The slots stored when times were offered. Anything malformed counts as nothing offered. */
export function parseOffered(value: unknown): Slot[] {
  if (!Array.isArray(value)) return [];
  const slots: Slot[] = [];
  for (const item of value) {
    const start = new Date((item as { start?: string })?.start ?? "");
    const end = new Date((item as { end?: string })?.end ?? "");
    if (Number.isNaN(start.getTime()) || Number.isNaN(end.getTime())) return [];
    slots.push({ start, end });
  }
  return slots;
}

/** Another conversation of this business already booked this time (the calendar may lag behind). */
async function takenInDatabase(ctx: HandlerContext, slot: Slot, conversationId: string): Promise<boolean> {
  const { data } = await ctx.admin
    .from("conversations")
    .select("id")
    .eq("business_id", ctx.business.id)
    .eq("state", "booked")
    .neq("id", conversationId)
    .lt("booking_start", slot.end.toISOString())
    .gt("booking_end", slot.start.toISOString())
    .limit(1);
  return (data ?? []).length > 0;
}

/**
 * Offers real times and books the one the customer picks (product-missed-call.md, "Booking").
 * Times come from the calendar and the opening hours, never from the model. A time is booked
 * only after the customer picked it and a fresh check says it is still free.
 */
export async function runBooking(
  ctx: HandlerContext,
  conversation: BookingConversation,
  ai: AiReply,
  integration: CalendarIntegration,
): Promise<BookingOutcome> {
  if (integration.status !== "connected") return { kind: "escalate", reason: "calendar_error" };

  const config = configOf(ctx);
  const timezone = ctx.business.timezone;
  const base = {
    hours: parseHours(config.business_hours ?? ctx.business.business_hours),
    timezone,
    now: ctx.now,
    durationMinutes: config.appointment_duration_minutes,
    bufferMinutes: config.buffer_minutes,
  };
  const buffer = config.buffer_minutes * MINUTE_MS;
  const service = ai.extracted.service?.trim().slice(0, 100) || conversation.booking_service;
  const offered = parseOffered(conversation.offered_slots);

  try {
    const calendar = requireCalendar(ctx, integration.id);
    let opening = offered.length > 0 ? OFFER_AGAIN_OPENING : OFFER_OPENING;
    let preferredDate = ai.extracted.preferred_date;
    let preferredTime = ai.extracted.preferred_time;

    const choice = ai.chosen_slot;
    if (offered.length > 0 && choice !== null && Number.isInteger(choice) && choice >= 1 && choice <= offered.length) {
      const slot = offered[choice - 1];
      const busy = await calendar.getFreeBusy({
        timeMin: new Date(slot.start.getTime() - buffer),
        timeMax: new Date(slot.end.getTime() + buffer),
      });
      // A retry after an earlier attempt got as far as claiming this time: its own event now makes
      // the time look busy, so it is not checked again. Creating the event is idempotent.
      const eventId = bookingEventId(conversation.id, slot.start);
      const resuming = conversation.booking_event_id === eventId;
      const free = resuming || (isSlotAvailable(slot, { ...base, busy }) && !(await takenInDatabase(ctx, slot, conversation.id)));

      if (free) {
        if (!resuming) {
          await ctx.admin
            .from("conversations")
            .update({ booking_event_id: eventId, booking_start: slot.start.toISOString(), booking_end: slot.end.toISOString() })
            .eq("id", conversation.id);
        }
        const who = conversation.customer.name ?? formatPhone(conversation.customer.phone_e164);
        await calendar.createEvent({
          eventId,
          start: slot.start,
          end: slot.end,
          summary: `${service ?? "Appointment"} - ${who}`,
          description: [
            "Booked by your WhatsApp assistant after a missed call.",
            `Customer: ${conversation.customer.name ?? "name not given"}, ${formatPhone(conversation.customer.phone_e164)}`,
            service ? `Service: ${service}` : "",
          ]
            .filter(Boolean)
            .join("\n"),
        });
        await ctx.log.step({ step: "action", status: "ok", reason: "booking_created", details: { start: slot.start.toISOString() } });
        return {
          kind: "reply",
          reply: bookingConfirmedReply(ctx.business.name, formatSlot(slot, timezone)),
          state: "booked",
          update: {
            booking_event_id: eventId,
            booking_start: slot.start.toISOString(),
            booking_end: slot.end.toISOString(),
            booking_service: service,
            offered_slots: [],
          },
        };
      }

      // Taken while the customer was deciding: offer other times near the one they wanted.
      opening = SLOT_TAKEN_OPENING;
      preferredDate = localDate(slot.start, timezone);
      preferredTime = null;
    }

    const busy = await calendar.getFreeBusy({ timeMin: ctx.now, timeMax: new Date(ctx.now.getTime() + (HORIZON_DAYS + 1) * DAY_MS) });
    const input: SlotInput = { ...base, busy, preferredDate, preferredTime };
    const slots = computeSlots(input);
    if (slots.length === 0) return { kind: "escalate", reason: "no_availability" };

    return {
      kind: "reply",
      reply: offerSlotsReply(slots.map((s) => formatSlot(s, timezone)), opening),
      state: "offering_slots",
      update: {
        offered_slots: slots.map((s) => ({ start: s.start.toISOString(), end: s.end.toISOString() })),
        booking_service: service,
      },
    };
  } catch (error) {
    // Rate limits and outages are retried by the engine; a refused or revoked calendar, or the
    // last attempt, hands the customer to a person instead of leaving them waiting.
    if (error instanceof AdapterError) {
      const final = ctx.action.attempts >= ctx.action.max_attempts || !error.retryable;
      await ctx.log.step({ step: "action", status: "error", reason: `calendar_${error.code}`, details: { retrying: !final } });
      if (!final) throw error;
      return { kind: "escalate", reason: "calendar_error" };
    }
    throw error;
  }
}
