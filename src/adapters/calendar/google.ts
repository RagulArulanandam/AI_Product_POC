import { AdapterError } from "@/lib/errors";
import type { BusyInterval, CalendarAdapter, NewEvent } from "./interface";
import { refreshAccessToken, type GoogleClient, type TokenSet } from "./google-oauth";

const API = "https://www.googleapis.com/calendar/v3";
/** Refresh a little early so a token never expires mid-request. */
const EXPIRY_MARGIN_MS = 60_000;

/** Where the adapter reads and saves its tokens (encrypted by the caller). */
export interface TokenStore {
  load(): Promise<TokenSet>;
  save(tokens: TokenSet): Promise<void>;
  /** Called when Google rejects the refresh token: the owner has to reconnect. */
  markBroken(message: string): Promise<void>;
}

/** Maps a Google Calendar API failure to AdapterError. */
export function mapCalendarError(status: number, body: unknown): AdapterError {
  const error = (body as { error?: { message?: string; errors?: { reason?: string }[] } } | null)?.error;
  const message = error?.message ?? `Google Calendar request failed (${status})`;
  const reason = error?.errors?.[0]?.reason ?? "";

  if (status === 429 || ["rateLimitExceeded", "userRateLimitExceeded", "quotaExceeded"].includes(reason)) {
    return new AdapterError("rate_limited", message);
  }
  if (status === 401 || status === 403) return new AdapterError("auth", message, { retryable: false });
  if (status === 404) return new AdapterError("not_found", message);
  if (status >= 500) return new AdapterError("provider_unavailable", message);
  return new AdapterError("invalid_request", message);
}

/** The primary calendar of the connected Google account. Fetch is injectable for tests. */
export class GoogleCalendarAdapter implements CalendarAdapter {
  constructor(
    private readonly client: GoogleClient,
    private readonly store: TokenStore,
    private readonly fetchFn: typeof fetch = fetch,
    private readonly now: () => Date = () => new Date(),
  ) {}

  private async accessToken(): Promise<string> {
    const tokens = await this.store.load();
    if (tokens.expiresAt - EXPIRY_MARGIN_MS > this.now().getTime()) return tokens.accessToken;

    try {
      const fresh = await refreshAccessToken(this.client, tokens, this.now(), this.fetchFn);
      await this.store.save(fresh);
      return fresh.accessToken;
    } catch (error) {
      if (error instanceof AdapterError && error.code === "auth") {
        await this.store.markBroken("Google rejected the saved access. Reconnect your calendar.");
      }
      throw error;
    }
  }

  private async call(path: string, init: { method: "GET" | "POST"; body?: unknown }): Promise<{ status: number; body: unknown }> {
    const token = await this.accessToken();
    let response: Response;
    try {
      response = await this.fetchFn(`${API}${path}`, {
        method: init.method,
        headers: { authorization: `Bearer ${token}`, "content-type": "application/json" },
        body: init.body === undefined ? undefined : JSON.stringify(init.body),
      });
    } catch (error) {
      throw new AdapterError("provider_unavailable", "Could not reach Google Calendar", { cause: error });
    }
    const body = await response.json().catch(() => null);
    return { status: response.status, body };
  }

  async getFreeBusy(input: { timeMin: Date; timeMax: Date }): Promise<BusyInterval[]> {
    const { status, body } = await this.call("/freeBusy", {
      method: "POST",
      body: { timeMin: input.timeMin.toISOString(), timeMax: input.timeMax.toISOString(), items: [{ id: "primary" }] },
    });
    if (status !== 200) {
      const error = mapCalendarError(status, body);
      if (error.code === "auth") await this.store.markBroken("Google did not allow the calendar to be read. Reconnect your calendar.");
      throw error;
    }

    const calendar = (body as { calendars?: Record<string, { busy?: { start: string; end: string }[]; errors?: unknown[] }> }).calendars?.primary;
    if (!calendar || (calendar.errors && calendar.errors.length > 0)) {
      throw new AdapterError("provider_unavailable", "Google could not report availability for the calendar");
    }
    return (calendar.busy ?? []).map((b) => ({ start: new Date(b.start), end: new Date(b.end) }));
  }

  async createEvent(input: NewEvent): Promise<{ eventId: string; created: boolean }> {
    const { status, body } = await this.call("/calendars/primary/events", {
      method: "POST",
      body: {
        id: input.eventId,
        summary: input.summary,
        description: input.description,
        start: { dateTime: input.start.toISOString() },
        end: { dateTime: input.end.toISOString() },
      },
    });

    // 409: an event with this id exists, so this exact booking was already made.
    if (status === 409) return { eventId: input.eventId, created: false };
    if (status !== 200) {
      const error = mapCalendarError(status, body);
      if (error.code === "auth") await this.store.markBroken("Google did not allow events to be added. Reconnect your calendar.");
      throw error;
    }
    return { eventId: (body as { id?: string }).id ?? input.eventId, created: true };
  }
}
