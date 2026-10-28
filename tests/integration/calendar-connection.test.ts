import { randomBytes } from "node:crypto";
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { GOOGLE_SCOPES } from "@/adapters/calendar/google-oauth";
import { parseTokens, serializeTokens, SupabaseTokenStore } from "@/adapters/calendar/store";
import type { Admin } from "@/engine/types";
import { connectDemoCalendar, connectGoogleCalendar, disconnectGoogleCalendar } from "@/services/calendar-connection";
import { serviceClient } from "../helpers/db";
import { cleanupTenants, createTenant, type Tenant } from "../helpers/tenants";

// Connecting, using and removing a business's Google Calendar (integrations.md section 6) against
// the real database, with a stubbed Google.

const admin = serviceClient() as unknown as Admin;
const client = { clientId: "client-id-1234", clientSecret: "client-secret-1234", redirectUri: "http://localhost:3000/api/integrations/google/callback" };
const NOW = new Date("2030-01-07T10:00:00Z");

let tenant: Tenant;
let other: Tenant;
let savedKey: string | undefined;

function json(status: number, body: unknown): Response {
  return new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } });
}

/** A Google that issues tokens, knows the account email and accepts revocations. */
function googleStub(overrides: { token?: Record<string, unknown>; tokenStatus?: number } = {}) {
  const calls: { url: string; body: string }[] = [];
  const fetchFn = vi.fn(async (url: string | URL | Request, init?: RequestInit) => {
    const target = String(url);
    calls.push({ url: target, body: String(init?.body ?? "") });
    if (target.includes("oauth2.googleapis.com/token")) {
      return json(overrides.tokenStatus ?? 200, overrides.token ?? { access_token: "ACCESS-SECRET-1", refresh_token: "REFRESH-SECRET-1", expires_in: 3600, scope: GOOGLE_SCOPES.join(" ") });
    }
    if (target.includes("userinfo")) return json(200, { email: "owner@example.com" });
    if (target.includes("revoke")) return json(200, {});
    return json(404, {});
  }) as unknown as typeof fetch;
  return { fetchFn, calls };
}

async function integrationRow(businessId = tenant.businessId) {
  const { data } = await admin.from("integrations").select("*").eq("business_id", businessId).eq("provider", "google_calendar").maybeSingle();
  return data;
}
async function secretRow(integrationId: string) {
  const { data } = await admin.from("integration_secrets").select("*").eq("integration_id", integrationId).maybeSingle();
  return data;
}

beforeAll(async () => {
  savedKey = process.env.ENCRYPTION_KEY;
  process.env.ENCRYPTION_KEY = randomBytes(32).toString("base64");
  tenant = await createTenant("gcal");
  other = await createTenant("gcal-other");
});

beforeEach(async () => {
  await admin.from("integrations").delete().eq("business_id", tenant.businessId);
  await admin.from("integrations").delete().eq("business_id", other.businessId);
});

afterAll(async () => {
  if (savedKey === undefined) delete process.env.ENCRYPTION_KEY;
  else process.env.ENCRYPTION_KEY = savedKey;
  await cleanupTenants();
});

describe("connectGoogleCalendar", () => {
  it("stores the connection with the account email and the tokens encrypted", async () => {
    const { fetchFn } = googleStub();
    const result = await connectGoogleCalendar(client, tenant.businessId, "auth-code", NOW, { admin, fetchFn });
    expect(result).toEqual({ ok: true, email: "owner@example.com" });

    const integration = await integrationRow();
    expect(integration).toMatchObject({ status: "connected", account_label: "owner@example.com", last_error: null });

    const secret = await secretRow(integration!.id);
    expect(secret!.business_id).toBe(tenant.businessId);
    expect(secret!.ciphertext).not.toContain("ACCESS-SECRET-1");
    expect(secret!.ciphertext).not.toContain("REFRESH-SECRET-1");
    expect(parseTokens(secret!.ciphertext)).toEqual({ accessToken: "ACCESS-SECRET-1", refreshToken: "REFRESH-SECRET-1", expiresAt: NOW.getTime() + 3_600_000 });
  });

  it("sends Google the code and our client details, and nothing is saved on failure", async () => {
    const { fetchFn, calls } = googleStub({ token: { error: "invalid_grant" }, tokenStatus: 400 });
    const result = await connectGoogleCalendar(client, tenant.businessId, "bad-code", NOW, { admin, fetchFn });
    expect(result).toEqual({ ok: false, reason: "no_access" });
    expect(calls[0].body).toContain("code=bad-code");
    expect(calls[0].body).toContain("grant_type=authorization_code");
    expect(await integrationRow()).toBeNull();
  });

  it("does not connect when calendar access was not granted", async () => {
    const { fetchFn } = googleStub({ token: { access_token: "a", refresh_token: "r", scope: "openid email" } });
    expect(await connectGoogleCalendar(client, tenant.businessId, "code", NOW, { admin, fetchFn })).toEqual({ ok: false, reason: "no_access" });
    expect(await integrationRow()).toBeNull();
  });

  it("reports a Google outage as a failure", async () => {
    const { fetchFn } = googleStub({ token: {}, tokenStatus: 503 });
    expect(await connectGoogleCalendar(client, tenant.businessId, "code", NOW, { admin, fetchFn })).toEqual({ ok: false, reason: "failed" });
  });

  it("reconnecting replaces the old tokens and clears an earlier error", async () => {
    await connectGoogleCalendar(client, tenant.businessId, "code-1", NOW, { admin, fetchFn: googleStub().fetchFn });
    const first = await integrationRow();
    await admin.from("integrations").update({ status: "error", last_error: "Google rejected the saved access." }).eq("id", first!.id);

    const second = googleStub({ token: { access_token: "ACCESS-2", refresh_token: "REFRESH-2", expires_in: 3600, scope: GOOGLE_SCOPES.join(" ") } });
    await connectGoogleCalendar(client, tenant.businessId, "code-2", NOW, { admin, fetchFn: second.fetchFn });

    const again = await integrationRow();
    expect(again).toMatchObject({ id: first!.id, status: "connected", last_error: null });
    expect(parseTokens((await secretRow(again!.id))!.ciphertext).refreshToken).toBe("REFRESH-2");
    const { count } = await admin.from("integration_secrets").select("id", { count: "exact", head: true }).eq("business_id", tenant.businessId);
    expect(count).toBe(1);
  });

  it("keeps each business's connection separate", async () => {
    await connectGoogleCalendar(client, tenant.businessId, "code", NOW, { admin, fetchFn: googleStub().fetchFn });
    expect(await integrationRow(other.businessId)).toBeNull();
  });
});

describe("tenants and the stored tokens", () => {
  it("an owner can see that the calendar is connected but can never read the tokens", async () => {
    await connectGoogleCalendar(client, tenant.businessId, "code", NOW, { admin, fetchFn: googleStub().fetchFn });

    const { data: visible } = await tenant.owner.client.from("integrations").select("*").eq("provider", "google_calendar");
    expect(visible).toHaveLength(1);
    expect(JSON.stringify(visible)).not.toContain("SECRET");

    const secrets = await tenant.owner.client.from("integration_secrets").select("*");
    expect(secrets.data ?? []).toEqual([]);
  });

  it("another business's owner sees nothing of it", async () => {
    await connectGoogleCalendar(client, tenant.businessId, "code", NOW, { admin, fetchFn: googleStub().fetchFn });
    const { data } = await other.owner.client.from("integrations").select("*").eq("provider", "google_calendar");
    expect(data).toEqual([]);
  });

  it("an owner cannot mark their own calendar connected or write tokens", async () => {
    const insert = await tenant.owner.client.from("integrations").insert({ business_id: tenant.businessId, provider: "google_calendar", status: "connected" });
    expect(insert.error).not.toBeNull();
    await connectGoogleCalendar(client, tenant.businessId, "code", NOW, { admin, fetchFn: googleStub().fetchFn });
    const update = await tenant.owner.client.from("integration_secrets").update({ ciphertext: "x" }).eq("business_id", tenant.businessId).select();
    expect(update.data ?? []).toEqual([]);
    const integration = await integrationRow();
    expect(parseTokens((await secretRow(integration!.id))!.ciphertext).accessToken).toBe("ACCESS-SECRET-1");
  });
});

describe("disconnectGoogleCalendar", () => {
  it("revokes the access at Google, deletes the tokens and marks the calendar disconnected", async () => {
    await connectGoogleCalendar(client, tenant.businessId, "code", NOW, { admin, fetchFn: googleStub().fetchFn });
    const before = await integrationRow();

    const { fetchFn, calls } = googleStub();
    expect(await disconnectGoogleCalendar(tenant.businessId, { admin, fetchFn })).toEqual({ revoked: true });
    expect(calls).toHaveLength(1);
    expect(calls[0].url).toContain("revoke");
    expect(calls[0].body).toContain("token=REFRESH-SECRET-1");

    expect(await secretRow(before!.id)).toBeNull();
    expect(await integrationRow()).toMatchObject({ id: before!.id, status: "disconnected", account_label: null, last_error: null });
  });

  it("still disconnects when Google cannot be reached", async () => {
    await connectGoogleCalendar(client, tenant.businessId, "code", NOW, { admin, fetchFn: googleStub().fetchFn });
    const offline = vi.fn(async () => {
      throw new Error("offline");
    }) as unknown as typeof fetch;
    expect(await disconnectGoogleCalendar(tenant.businessId, { admin, fetchFn: offline })).toEqual({ revoked: false });
    expect(await integrationRow()).toMatchObject({ status: "disconnected" });
  });

  it("still disconnects when the stored tokens cannot be read", async () => {
    await connectGoogleCalendar(client, tenant.businessId, "code", NOW, { admin, fetchFn: googleStub().fetchFn });
    const integration = await integrationRow();
    await admin.from("integration_secrets").update({ ciphertext: "garbage" }).eq("integration_id", integration!.id);
    const { fetchFn, calls } = googleStub();
    await disconnectGoogleCalendar(tenant.businessId, { admin, fetchFn });
    expect(calls).toHaveLength(0);
    expect(await secretRow(integration!.id)).toBeNull();
    expect(await integrationRow()).toMatchObject({ status: "disconnected" });
  });

  it("does nothing, and does not fail, when no calendar was ever connected", async () => {
    expect(await disconnectGoogleCalendar(tenant.businessId, { admin, fetchFn: googleStub().fetchFn })).toEqual({ revoked: false });
  });

  it("only touches the business it was asked about", async () => {
    await connectGoogleCalendar(client, tenant.businessId, "code", NOW, { admin, fetchFn: googleStub().fetchFn });
    await connectGoogleCalendar(client, other.businessId, "code", NOW, { admin, fetchFn: googleStub().fetchFn });
    await disconnectGoogleCalendar(tenant.businessId, { admin, fetchFn: googleStub().fetchFn });
    expect(await integrationRow(other.businessId)).toMatchObject({ status: "connected" });
    expect(await secretRow((await integrationRow(other.businessId))!.id)).not.toBeNull();
  });
});

describe("connectDemoCalendar", () => {
  it("connects a demo calendar that holds no real access", async () => {
    await connectDemoCalendar(tenant.businessId, NOW, admin);
    expect(await integrationRow()).toMatchObject({ status: "connected", account_label: "demo calendar" });
  });
});

describe("SupabaseTokenStore", () => {
  async function connected() {
    await connectGoogleCalendar(client, tenant.businessId, "code", NOW, { admin, fetchFn: googleStub().fetchFn });
    const integration = (await integrationRow())!;
    return { integration, store: new SupabaseTokenStore(admin, integration.id) };
  }

  it("loads the decrypted tokens", async () => {
    const { store } = await connected();
    expect(await store.load()).toMatchObject({ accessToken: "ACCESS-SECRET-1", refreshToken: "REFRESH-SECRET-1" });
  });

  it("saves refreshed tokens encrypted", async () => {
    const { integration, store } = await connected();
    await store.save({ accessToken: "ACCESS-NEW", refreshToken: "REFRESH-SECRET-1", expiresAt: NOW.getTime() + 1000 });
    const stored = (await secretRow(integration.id))!.ciphertext;
    expect(stored).not.toContain("ACCESS-NEW");
    expect((await store.load()).accessToken).toBe("ACCESS-NEW");
  });

  it("marks the integration as needing a reconnect, and then refuses to load", async () => {
    const { integration, store } = await connected();
    await store.markBroken("Google rejected the saved access. Reconnect your calendar.");
    expect(await integrationRow()).toMatchObject({ status: "error", last_error: "Google rejected the saved access. Reconnect your calendar." });
    await expect(new SupabaseTokenStore(admin, integration.id).load()).rejects.toMatchObject({ code: "auth", retryable: false });
  });

  it("refuses to load for a disconnected calendar", async () => {
    const { integration, store } = await connected();
    await disconnectGoogleCalendar(tenant.businessId, { admin, fetchFn: googleStub().fetchFn });
    await expect(store.load()).rejects.toMatchObject({ code: "auth" });
    expect(integration.id).toBeTruthy();
  });

  it("refuses to load tokens that cannot be decrypted", async () => {
    const { integration, store } = await connected();
    await admin.from("integration_secrets").update({ ciphertext: serializeTokens({ accessToken: "a", refreshToken: "b", expiresAt: 1 }).replace(/[^.]+$/, "AAAA") }).eq("integration_id", integration.id);
    await expect(store.load()).rejects.toMatchObject({ code: "auth", retryable: false });
  });
});
