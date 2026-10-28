import { Resend } from "resend";
import { AdapterError } from "@/lib/errors";
import type { EmailAdapter } from "./interface";
import { assertValidEmailInput } from "./validate";

export interface ResendConfig {
  apiKey: string;
  /** e.g. `onboarding@resend.dev`, or `Name <you@your-domain.com>` once a domain is verified. */
  from: string;
}

interface ResendError {
  name?: string;
  message: string;
  statusCode?: number | null;
}

/** The slice of the Resend client we use, so tests can pass a stub. */
export interface ResendLikeClient {
  emails: {
    send(args: {
      from: string;
      to: string;
      subject: string;
      text: string;
      html?: string;
    }): Promise<{ data: { id: string } | null; error: ResendError | null }>;
  };
}

/** Maps Resend failures to AdapterError. Only rate limits and outages are retried. */
export function mapResendError(error: ResendError | undefined | null): AdapterError {
  const name = error?.name ?? "";
  const status = error?.statusCode ?? undefined;
  const message = error?.message ?? "Resend request failed";

  if (name === "rate_limit_exceeded" || status === 429) return new AdapterError("rate_limited", message);
  if (["invalid_api_key", "missing_api_key", "restricted_api_key"].includes(name) || status === 401) {
    return new AdapterError("auth", message);
  }
  // Includes "you can only send testing emails to your own address" (403 validation_error).
  if (name.includes("validation") || name.startsWith("invalid_") || status === 403 || status === 422) {
    return new AdapterError("invalid_request", message);
  }
  if (status === 404) return new AdapterError("not_found", message);
  if (typeof status === "number" && status >= 400 && status < 500) return new AdapterError("invalid_request", message);
  return new AdapterError("provider_unavailable", message);
}

export class ResendEmailAdapter implements EmailAdapter {
  constructor(
    private readonly config: ResendConfig,
    private readonly client: ResendLikeClient = new Resend(config.apiKey) as unknown as ResendLikeClient,
  ) {}

  async send(input: { to: string; subject: string; text: string; html?: string }): Promise<{ providerId: string }> {
    assertValidEmailInput(input);

    let result;
    try {
      result = await this.client.emails.send({
        from: this.config.from,
        to: input.to,
        subject: input.subject,
        text: input.text,
        ...(input.html ? { html: input.html } : {}),
      });
    } catch (error) {
      throw new AdapterError("provider_unavailable", error instanceof Error ? error.message : "Resend request failed", {
        cause: error,
      });
    }

    if (result.error) throw mapResendError(result.error);
    if (!result.data?.id) throw new AdapterError("provider_unavailable", "Resend returned no email id");
    return { providerId: result.data.id };
  }
}
