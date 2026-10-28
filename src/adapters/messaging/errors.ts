import { AdapterError, type AdapterErrorCode } from "@/lib/errors";

/**
 * Twilio error codes we recognise (see Twilio's error code reference). Anything else falls back
 * to the HTTP status. Retryability comes from AdapterError: only rate limits, provider outages
 * and unknown errors are retried.
 */
const BY_TWILIO_CODE: Record<number, AdapterErrorCode> = {
  20003: "auth", // authentication failed
  20429: "rate_limited",
  21211: "invalid_request", // invalid 'To' number
  21212: "invalid_request", // invalid 'From' number
  21614: "unreachable_recipient", // 'To' is not a mobile number
  63003: "unreachable_recipient", // channel could not find the To address
  63015: "unreachable_recipient", // sandbox: recipient has not joined
  63016: "outside_window", // free-form message outside the 24 hour window
};

export function mapTwilioError(error: unknown): AdapterError {
  const e = (error ?? {}) as { status?: number; code?: number; message?: string };
  const message = e.message ?? "Twilio request failed";

  const byCode = typeof e.code === "number" ? BY_TWILIO_CODE[e.code] : undefined;
  if (byCode) return new AdapterError(byCode, `${message} (Twilio ${e.code})`, { cause: error });

  if (e.status === 401 || e.status === 403) return new AdapterError("auth", message, { cause: error });
  if (e.status === 429) return new AdapterError("rate_limited", message, { cause: error });
  if (e.status === 404) return new AdapterError("not_found", message, { cause: error });
  if (typeof e.status === "number" && e.status >= 400 && e.status < 500) {
    return new AdapterError("invalid_request", message, { cause: error });
  }
  if (typeof e.status === "number" && e.status >= 500) {
    return new AdapterError("provider_unavailable", message, { cause: error });
  }
  // No HTTP status usually means a network failure: worth retrying.
  return new AdapterError("provider_unavailable", message, { cause: error });
}
