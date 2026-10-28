/**
 * Validates a post-login redirect target: same-origin paths only, so `?next=` cannot be used
 * as an open redirect (auth.md section 8).
 */
export function safeNextPath(input: string | null | undefined, fallback = "/dashboard"): string {
  if (!input || typeof input !== "string") return fallback;
  if (!input.startsWith("/") || input.startsWith("//") || input.includes("\\")) return fallback;
  if (/[\u0000-\u001f\u007f]/.test(input)) return fallback;

  try {
    const url = new URL(input, "http://placeholder.invalid");
    if (url.origin !== "http://placeholder.invalid") return fallback;
    const path = url.pathname + url.search;
    return path === "/login" || path === "/signup" ? fallback : path;
  } catch {
    return fallback;
  }
}
