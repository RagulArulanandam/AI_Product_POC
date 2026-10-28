import { createHash, timingSafeEqual } from "node:crypto";

/**
 * Checks an `Authorization: Bearer <secret>` header in constant time (auth.md section 4).
 * Both sides are hashed first so the comparison length never depends on the guess.
 */
export function isAuthorized(header: string | null | undefined, secret: string): boolean {
  if (!header || !secret) return false;
  const match = /^Bearer (.+)$/.exec(header);
  if (!match) return false;

  const given = createHash("sha256").update(match[1]).digest();
  const expected = createHash("sha256").update(secret).digest();
  return timingSafeEqual(given, expected);
}
