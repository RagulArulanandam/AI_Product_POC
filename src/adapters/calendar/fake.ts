import type { AdapterError } from "@/lib/errors";
import type { BusyInterval, CalendarAdapter, NewEvent } from "./interface";

/**
 * In-memory calendar for tests and `CALENDAR_ADAPTER=fake`. Events it creates count as busy, so a
 * second booking of the same time really is blocked. Failures can be scripted.
 */
export class FakeCalendarAdapter implements CalendarAdapter {
  busy: BusyInterval[] = [];
  events: NewEvent[] = [];
  private failures: { on: "freebusy" | "create"; error: AdapterError }[] = [];

  failNext(on: "freebusy" | "create", error: AdapterError, times = 1): void {
    for (let i = 0; i < times; i += 1) this.failures.push({ on, error });
  }

  reset(): void {
    this.busy = [];
    this.events = [];
    this.failures = [];
  }

  private takeFailure(on: "freebusy" | "create"): AdapterError | undefined {
    const index = this.failures.findIndex((f) => f.on === on);
    if (index === -1) return undefined;
    return this.failures.splice(index, 1)[0].error;
  }

  async getFreeBusy(input: { timeMin: Date; timeMax: Date }): Promise<BusyInterval[]> {
    const failure = this.takeFailure("freebusy");
    if (failure) throw failure;
    const all = [...this.busy, ...this.events.map((e) => ({ start: e.start, end: e.end }))];
    return all.filter((b) => b.start < input.timeMax && b.end > input.timeMin);
  }

  async createEvent(input: NewEvent): Promise<{ eventId: string; created: boolean }> {
    const failure = this.takeFailure("create");
    if (failure) throw failure;
    if (this.events.some((e) => e.eventId === input.eventId)) return { eventId: input.eventId, created: false };
    this.events.push(input);
    return { eventId: input.eventId, created: true };
  }
}
