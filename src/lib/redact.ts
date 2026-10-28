/**
 * Strips secrets and masks phone numbers before anything is logged or written to
 * automation_logs (security-privacy.md section 6).
 */
const SENSITIVE_KEY = /authorization|token|secret|password|signature|api[-_]?key|cookie|credential/i;
const PHONE = /\+[1-9]\d{6,14}/g;
const BEARER = /Bearer\s+[A-Za-z0-9._~+/=-]+/gi;
const KEY_LIKE = /\b(?:sk-|sb_secret_|GOCSPX-)[A-Za-z0-9_-]{10,}/g;

const MAX_STRING = 500;
const MAX_DEPTH = 6;

export function maskPhone(phone: string): string {
  return `+${"*".repeat(Math.max(phone.length - 5, 0))}${phone.slice(-4)}`;
}

function redactString(value: string): string {
  const cleaned = value
    .replace(BEARER, "Bearer [redacted]")
    .replace(KEY_LIKE, "[redacted]")
    .replace(PHONE, (m) => maskPhone(m));
  return cleaned.length > MAX_STRING ? `${cleaned.slice(0, MAX_STRING)}…` : cleaned;
}

export function redact(value: unknown, depth = 0): unknown {
  if (value === null || value === undefined) return value;
  if (typeof value === "string") return redactString(value);
  if (typeof value === "number" || typeof value === "boolean") return value;
  if (value instanceof Date) return value.toISOString();
  if (value instanceof Error) return { name: value.name, message: redactString(value.message) };
  if (depth >= MAX_DEPTH) return "[truncated]";
  if (Array.isArray(value)) return value.map((item) => redact(item, depth + 1));
  if (typeof value === "object") {
    const out: Record<string, unknown> = {};
    for (const [key, v] of Object.entries(value as Record<string, unknown>)) {
      out[key] = SENSITIVE_KEY.test(key) ? "[redacted]" : redact(v, depth + 1);
    }
    return out;
  }
  return String(value);
}
