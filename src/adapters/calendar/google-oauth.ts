import { AdapterError } from "@/lib/errors";

/**
 * Google OAuth for the calendar. Scopes are the narrowest that do the job (checked against
 * https://developers.google.com/workspace/calendar/api/auth in Oct 2026): availability only, and
 * events on calendars the user owns. `openid email` only tells us which account connected.
 */
export const GOOGLE_SCOPES = [
  "openid",
  "email",
  "https://www.googleapis.com/auth/calendar.events.freebusy",
  "https://www.googleapis.com/auth/calendar.events.owned",
] as const;

const AUTH_URL = "https://accounts.google.com/o/oauth2/v2/auth";
const TOKEN_URL = "https://oauth2.googleapis.com/token";
const REVOKE_URL = "https://oauth2.googleapis.com/revoke";
const USERINFO_URL = "https://openidconnect.googleapis.com/v1/userinfo";

export interface GoogleClient {
  clientId: string;
  clientSecret: string;
  redirectUri: string;
}

export interface TokenSet {
  accessToken: string;
  refreshToken: string;
  /** Milliseconds since the epoch. */
  expiresAt: number;
}

type Fetch = typeof fetch;

/** `access_type=offline` and `prompt=consent` so Google always issues a refresh token. */
export function buildAuthUrl(client: GoogleClient, state: string): string {
  const params = new URLSearchParams({
    client_id: client.clientId,
    redirect_uri: client.redirectUri,
    response_type: "code",
    scope: GOOGLE_SCOPES.join(" "),
    access_type: "offline",
    prompt: "consent",
    include_granted_scopes: "false",
    state,
  });
  return `${AUTH_URL}?${params.toString()}`;
}

async function readJson(response: Response): Promise<Record<string, unknown>> {
  try {
    return (await response.json()) as Record<string, unknown>;
  } catch {
    return {};
  }
}

/** Token endpoint failures. `invalid_grant` means the user revoked access or the token expired. */
function tokenError(status: number, body: Record<string, unknown>): AdapterError {
  const code = typeof body.error === "string" ? body.error : "";
  const message = typeof body.error_description === "string" ? body.error_description : code || `Google token request failed (${status})`;
  if (code === "invalid_grant" || code === "invalid_client" || code === "unauthorized_client" || status === 401) {
    return new AdapterError("auth", message, { retryable: false });
  }
  if (status === 429) return new AdapterError("rate_limited", message);
  if (status >= 500) return new AdapterError("provider_unavailable", message);
  return new AdapterError("invalid_request", message);
}

async function tokenRequest(form: Record<string, string>, fetchFn: Fetch): Promise<Record<string, unknown>> {
  let response: Response;
  try {
    response = await fetchFn(TOKEN_URL, {
      method: "POST",
      headers: { "content-type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams(form),
    });
  } catch (error) {
    throw new AdapterError("provider_unavailable", "Could not reach Google", { cause: error });
  }
  const body = await readJson(response);
  if (!response.ok) throw tokenError(response.status, body);
  return body;
}

export async function exchangeCode(
  client: GoogleClient,
  code: string,
  now: Date,
  fetchFn: Fetch = fetch,
): Promise<{ tokens: TokenSet; email: string | null }> {
  const body = await tokenRequest(
    {
      code,
      client_id: client.clientId,
      client_secret: client.clientSecret,
      redirect_uri: client.redirectUri,
      grant_type: "authorization_code",
    },
    fetchFn,
  );

  const accessToken = typeof body.access_token === "string" ? body.access_token : "";
  const refreshToken = typeof body.refresh_token === "string" ? body.refresh_token : "";
  if (!accessToken) throw new AdapterError("invalid_request", "Google did not return an access token");
  if (!refreshToken) throw new AdapterError("invalid_request", "Google did not return a refresh token", { retryable: false });

  const scopes = typeof body.scope === "string" ? body.scope.split(" ") : [];
  for (const needed of GOOGLE_SCOPES.filter((s) => s.startsWith("https://"))) {
    if (!scopes.includes(needed)) throw new AdapterError("auth", "Calendar access was not granted", { retryable: false });
  }

  const expiresIn = typeof body.expires_in === "number" ? body.expires_in : 3600;
  return {
    tokens: { accessToken, refreshToken, expiresAt: now.getTime() + expiresIn * 1000 },
    email: await fetchEmail(accessToken, fetchFn),
  };
}

async function fetchEmail(accessToken: string, fetchFn: Fetch): Promise<string | null> {
  try {
    const response = await fetchFn(USERINFO_URL, { headers: { authorization: `Bearer ${accessToken}` } });
    if (!response.ok) return null;
    const body = await readJson(response);
    return typeof body.email === "string" ? body.email : null;
  } catch {
    return null;
  }
}

/** A new access token from the refresh token. Google does not send a new refresh token here. */
export async function refreshAccessToken(
  client: GoogleClient,
  tokens: TokenSet,
  now: Date,
  fetchFn: Fetch = fetch,
): Promise<TokenSet> {
  const body = await tokenRequest(
    {
      refresh_token: tokens.refreshToken,
      client_id: client.clientId,
      client_secret: client.clientSecret,
      grant_type: "refresh_token",
    },
    fetchFn,
  );
  const accessToken = typeof body.access_token === "string" ? body.access_token : "";
  if (!accessToken) throw new AdapterError("provider_unavailable", "Google did not return an access token");
  const expiresIn = typeof body.expires_in === "number" ? body.expires_in : 3600;
  return { accessToken, refreshToken: tokens.refreshToken, expiresAt: now.getTime() + expiresIn * 1000 };
}

/** Best effort: the connection is removed on our side whether or not Google answers. */
export async function revokeToken(token: string, fetchFn: Fetch = fetch): Promise<boolean> {
  try {
    const response = await fetchFn(REVOKE_URL, {
      method: "POST",
      headers: { "content-type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({ token }),
    });
    return response.ok;
  } catch {
    return false;
  }
}
