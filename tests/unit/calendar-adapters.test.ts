import { describe, expect, it, vi } from "vitest";
import { FakeCalendarAdapter } from "@/adapters/calendar/fake";
import { GoogleCalendarAdapter, mapCalendarError, type TokenStore } from "@/adapters/calendar/google";
import { buildAuthUrl, exchangeCode, GOOGLE_SCOPES, refreshAccessToken, revokeToken, type TokenSet } from "@/adapters/calendar/google-oauth";
import { bookingEventId } from "@/adapters/calendar/interface";
import { AdapterError } from "@/lib/errors";

const client = { clientId: "client-id-1234", clientSecret: "client-secret-1234", redirectUri: "http://localhost:3000/api/integrations/google/callback" };
const NOW = new Date("2026-10-28T10:00:00Z");

function json(status: number, body: unknown): Response {
  return new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } });
}

function memoryStore(tokens: TokenSet) {
  const state = { tokens, broken: null as string | null };
  const store: TokenStore = {
    load: async () => state.tokens,
    save: async (t) => {
      state.tokens = t;
    },
    markBroken: async (m) => {
      state.broken = m;
    },
  };
  return { store, state };
}

const fresh: TokenSet = { accessToken: "access-1", refreshToken: "refresh-1", expiresAt: NOW.getTime() + 3_600_000 };
const expired: TokenSet = { accessToken: "old", refreshToken: "refresh-1", expiresAt: NOW.getTime() - 1000 };

describe("bookingEventId", () => {
  it("is the same for the same conversation and slot, and different otherwise", () => {
    const start = new Date("2026-10-29T10:00:00Z");
    expect(bookingEventId("c1", start)).toBe(bookingEventId("c1", new Date(start)));
    expect(bookingEventId("c1", start)).not.toBe(bookingEventId("c2", start));
    expect(bookingEventId("c1", start)).not.toBe(bookingEventId("c1", new Date("2026-10-29T10:30:00Z")));
  });

  it("only uses characters Google allows in an event id (a-v, 0-9)", () => {
    expect(bookingEventId("c1", NOW)).toMatch(/^[0-9a-v]{32}$/);
  });
});

describe("buildAuthUrl", () => {
  const url = new URL(buildAuthUrl(client, "nonce-123"));

  it("asks for offline access with consent, so a refresh token is issued", () => {
    expect(url.searchParams.get("access_type")).toBe("offline");
    expect(url.searchParams.get("prompt")).toBe("consent");
    expect(url.searchParams.get("response_type")).toBe("code");
    expect(url.searchParams.get("state")).toBe("nonce-123");
    expect(url.searchParams.get("redirect_uri")).toBe(client.redirectUri);
  });

  it("asks only for the narrow calendar scopes", () => {
    const scopes = url.searchParams.get("scope")!.split(" ");
    expect(scopes).toEqual([...GOOGLE_SCOPES]);
    expect(scopes).not.toContain("https://www.googleapis.com/auth/calendar");
    expect(scopes).not.toContain("https://www.googleapis.com/auth/calendar.events");
  });
});

describe("exchangeCode", () => {
  const granted = GOOGLE_SCOPES.join(" ");

  it("returns tokens and the account email", async () => {
    const fetchFn = vi.fn(async (url: string | URL | Request) =>
      String(url).includes("userinfo")
        ? json(200, { email: "owner@example.com" })
        : json(200, { access_token: "a", refresh_token: "r", expires_in: 3600, scope: granted }),
    ) as unknown as typeof fetch;
    const result = await exchangeCode(client, "code", NOW, fetchFn);
    expect(result.tokens).toEqual({ accessToken: "a", refreshToken: "r", expiresAt: NOW.getTime() + 3_600_000 });
    expect(result.email).toBe("owner@example.com");
  });

  it("refuses when no refresh token comes back", async () => {
    const fetchFn = vi.fn(async () => json(200, { access_token: "a", expires_in: 3600, scope: granted })) as unknown as typeof fetch;
    await expect(exchangeCode(client, "code", NOW, fetchFn)).rejects.toThrow("refresh token");
  });

  it("refuses when the user unticked calendar access", async () => {
    const fetchFn = vi.fn(async () => json(200, { access_token: "a", refresh_token: "r", scope: "openid email" })) as unknown as typeof fetch;
    await expect(exchangeCode(client, "code", NOW, fetchFn)).rejects.toMatchObject({ code: "auth", retryable: false });
  });

  it("maps a rejected code to a non-retryable auth error", async () => {
    const fetchFn = vi.fn(async () => json(400, { error: "invalid_grant" })) as unknown as typeof fetch;
    await expect(exchangeCode(client, "bad", NOW, fetchFn)).rejects.toMatchObject({ code: "auth", retryable: false });
  });
});

describe("refreshAccessToken / revokeToken", () => {
  it("keeps the refresh token and sets a new expiry", async () => {
    const fetchFn = vi.fn(async () => json(200, { access_token: "new", expires_in: 1800 })) as unknown as typeof fetch;
    expect(await refreshAccessToken(client, expired, NOW, fetchFn)).toEqual({
      accessToken: "new",
      refreshToken: "refresh-1",
      expiresAt: NOW.getTime() + 1_800_000,
    });
  });

  it("revoke reports success or failure without throwing", async () => {
    expect(await revokeToken("t", vi.fn(async () => json(200, {})) as unknown as typeof fetch)).toBe(true);
    expect(await revokeToken("t", vi.fn(async () => json(400, {})) as unknown as typeof fetch)).toBe(false);
    expect(await revokeToken("t", vi.fn(async () => { throw new Error("offline"); }) as unknown as typeof fetch)).toBe(false);
  });
});

describe("GoogleCalendarAdapter", () => {
  const start = new Date("2026-10-29T10:00:00Z");
  const end = new Date("2026-10-29T10:30:00Z");
  const event = { eventId: "abc12345", start, end, summary: "Check-up", description: "Booked by the assistant" };

  function adapter(tokens: TokenSet, fetchFn: typeof fetch) {
    const { store, state } = memoryStore(tokens);
    return { adapter: new GoogleCalendarAdapter(client, store, fetchFn, () => NOW), state };
  }

  it("reads busy intervals from the primary calendar", async () => {
    const fetchFn = vi.fn(async (_url: string | URL | Request, init?: RequestInit) => {
      expect((init?.headers as Record<string, string>).authorization).toBe("Bearer access-1");
      expect(JSON.parse(String(init?.body)).items).toEqual([{ id: "primary" }]);
      return json(200, { calendars: { primary: { busy: [{ start: "2026-10-29T09:00:00Z", end: "2026-10-29T09:30:00Z" }] } } });
    }) as unknown as typeof fetch;
    const { adapter: a } = adapter(fresh, fetchFn);
    expect(await a.getFreeBusy({ timeMin: start, timeMax: end })).toEqual([
      { start: new Date("2026-10-29T09:00:00Z"), end: new Date("2026-10-29T09:30:00Z") },
    ]);
  });

  it("does not treat an answer with calendar errors as 'free'", async () => {
    const fetchFn = vi.fn(async () => json(200, { calendars: { primary: { busy: [], errors: [{ reason: "notFound" }] } } })) as unknown as typeof fetch;
    await expect(adapter(fresh, fetchFn).adapter.getFreeBusy({ timeMin: start, timeMax: end })).rejects.toMatchObject({ code: "provider_unavailable" });
  });

  it("refreshes an expired access token first and saves the new one", async () => {
    const calls: string[] = [];
    const fetchFn = vi.fn(async (url: string | URL | Request) => {
      calls.push(String(url));
      return String(url).includes("oauth2.googleapis.com/token")
        ? json(200, { access_token: "new-token", expires_in: 3600 })
        : json(200, { calendars: { primary: { busy: [] } } });
    }) as unknown as typeof fetch;
    const { adapter: a, state } = adapter(expired, fetchFn);
    await a.getFreeBusy({ timeMin: start, timeMax: end });
    expect(calls[0]).toContain("oauth2.googleapis.com/token");
    expect(state.tokens.accessToken).toBe("new-token");
    expect(state.tokens.refreshToken).toBe("refresh-1");
  });

  it("marks the integration as broken when Google rejects the refresh token", async () => {
    const fetchFn = vi.fn(async () => json(400, { error: "invalid_grant" })) as unknown as typeof fetch;
    const { adapter: a, state } = adapter(expired, fetchFn);
    await expect(a.getFreeBusy({ timeMin: start, timeMax: end })).rejects.toMatchObject({ code: "auth", retryable: false });
    expect(state.broken).toContain("Reconnect");
  });

  it("creates an event with the deterministic id", async () => {
    let sent: Record<string, unknown> = {};
    const fetchFn = vi.fn(async (_url: string | URL | Request, init?: RequestInit) => {
      sent = JSON.parse(String(init?.body));
      return json(200, { id: "abc12345" });
    }) as unknown as typeof fetch;
    const result = await adapter(fresh, fetchFn).adapter.createEvent(event);
    expect(result).toEqual({ eventId: "abc12345", created: true });
    expect(sent).toMatchObject({ id: "abc12345", summary: "Check-up", start: { dateTime: start.toISOString() }, end: { dateTime: end.toISOString() } });
  });

  it("treats a 409 conflict as success: the booking already exists", async () => {
    const fetchFn = vi.fn(async () => json(409, { error: { message: "The requested identifier already exists." } })) as unknown as typeof fetch;
    expect(await adapter(fresh, fetchFn).adapter.createEvent(event)).toEqual({ eventId: "abc12345", created: false });
  });

  it("marks the integration broken when Google says access is not allowed", async () => {
    const fetchFn = vi.fn(async () => json(403, { error: { message: "Forbidden", errors: [{ reason: "forbidden" }] } })) as unknown as typeof fetch;
    const { adapter: a, state } = adapter(fresh, fetchFn);
    await expect(a.createEvent(event)).rejects.toMatchObject({ code: "auth" });
    expect(state.broken).not.toBeNull();
  });

  it("reports a network failure as a retryable provider error", async () => {
    const fetchFn = vi.fn(async () => {
      throw new Error("ECONNRESET");
    }) as unknown as typeof fetch;
    await expect(adapter(fresh, fetchFn).adapter.getFreeBusy({ timeMin: start, timeMax: end })).rejects.toMatchObject({
      code: "provider_unavailable",
      retryable: true,
    });
  });
});

describe("mapCalendarError", () => {
  it("maps statuses and reasons", () => {
    expect(mapCalendarError(429, null).code).toBe("rate_limited");
    expect(mapCalendarError(403, { error: { errors: [{ reason: "rateLimitExceeded" }] } }).code).toBe("rate_limited");
    expect(mapCalendarError(403, null)).toMatchObject({ code: "auth", retryable: false });
    expect(mapCalendarError(401, null).code).toBe("auth");
    expect(mapCalendarError(404, null).code).toBe("not_found");
    expect(mapCalendarError(503, null)).toMatchObject({ code: "provider_unavailable", retryable: true });
    expect(mapCalendarError(400, null).code).toBe("invalid_request");
  });
});

describe("FakeCalendarAdapter", () => {
  const start = new Date("2026-10-29T10:00:00Z");
  const end = new Date("2026-10-29T10:30:00Z");

  it("counts created events as busy and ignores a repeat of the same event id", async () => {
    const fake = new FakeCalendarAdapter();
    const event = { eventId: "e1", start, end, summary: "s", description: "d" };
    expect(await fake.createEvent(event)).toEqual({ eventId: "e1", created: true });
    expect(await fake.createEvent(event)).toEqual({ eventId: "e1", created: false });
    expect(fake.events).toHaveLength(1);
    expect(await fake.getFreeBusy({ timeMin: start, timeMax: end })).toHaveLength(1);
    expect(await fake.getFreeBusy({ timeMin: end, timeMax: new Date("2026-10-29T12:00:00Z") })).toHaveLength(0);
  });

  it("fails on demand, once", async () => {
    const fake = new FakeCalendarAdapter();
    fake.failNext("freebusy", new AdapterError("auth", "gone"));
    await expect(fake.getFreeBusy({ timeMin: start, timeMax: end })).rejects.toMatchObject({ code: "auth" });
    await expect(fake.getFreeBusy({ timeMin: start, timeMax: end })).resolves.toEqual([]);
  });
});
