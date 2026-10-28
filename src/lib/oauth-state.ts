import { randomBytes, timingSafeEqual } from "node:crypto";

/**
 * The OAuth `state` check that stops a stranger's Google login being attached to our business
 * (integrations.md section 6). A random nonce goes to Google and, with the business id, into an
 * httpOnly cookie. The callback only continues when both match and the person is still in that
 * business.
 */
export const OAUTH_STATE_COOKIE = "gcal_oauth_state";
export const OAUTH_STATE_MAX_AGE_SECONDS = 600;

export function createOAuthState(businessId: string): { nonce: string; cookie: string } {
  const nonce = randomBytes(24).toString("base64url");
  return { nonce, cookie: JSON.stringify({ nonce, businessId }) };
}

function same(a: string, b: string): boolean {
  const left = Buffer.from(a);
  const right = Buffer.from(b);
  return left.length === right.length && timingSafeEqual(left, right);
}

/** True only when the cookie, the `state` from Google and the signed-in business all agree. */
export function verifyOAuthState(cookie: string | undefined, state: string | null, businessId: string): boolean {
  if (!cookie || !state) return false;
  try {
    const parsed = JSON.parse(cookie) as { nonce?: unknown; businessId?: unknown };
    return typeof parsed.nonce === "string" && typeof parsed.businessId === "string" && same(parsed.nonce, state) && parsed.businessId === businessId;
  } catch {
    return false;
  }
}
