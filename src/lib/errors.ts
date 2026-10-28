/** Expected failures that services raise (architecture.md section 10). */
export class AppError extends Error {
  constructor(
    public readonly code: string,
    message: string,
    public readonly status = 400,
  ) {
    super(message);
    this.name = "AppError";
  }
}

export type AdapterErrorCode =
  | "auth"
  | "rate_limited"
  | "invalid_request"
  | "not_found"
  | "provider_unavailable"
  | "invalid_output"
  | "unreachable_recipient"
  | "outside_window"
  | "unknown";

/** Codes the engine retries with backoff; anything else fails the action at once. */
const RETRYABLE: ReadonlySet<AdapterErrorCode> = new Set(["rate_limited", "provider_unavailable", "unknown"]);

/** What every vendor adapter throws (integrations.md section 1). */
export class AdapterError extends Error {
  readonly retryable: boolean;

  constructor(
    public readonly code: AdapterErrorCode,
    message: string,
    options: { cause?: unknown; retryable?: boolean } = {},
  ) {
    super(message, { cause: options.cause });
    this.name = "AdapterError";
    this.retryable = options.retryable ?? RETRYABLE.has(code);
  }
}
