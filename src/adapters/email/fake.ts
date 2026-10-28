import type { AdapterError } from "@/lib/errors";
import type { EmailAdapter } from "./interface";
import { assertValidEmailInput } from "./validate";

export interface SentEmail {
  to: string;
  subject: string;
  text: string;
  html?: string;
  providerId: string;
}

/** In-memory email for tests and `EMAIL_ADAPTER=fake`. Records sends; failures can be scripted. */
export class FakeEmailAdapter implements EmailAdapter {
  sent: SentEmail[] = [];
  private counter = 0;
  private failures: AdapterError[] = [];

  failNext(error: AdapterError, times = 1): void {
    for (let i = 0; i < times; i += 1) this.failures.push(error);
  }

  reset(): void {
    this.sent = [];
    this.failures = [];
    this.counter = 0;
  }

  async send(input: { to: string; subject: string; text: string; html?: string }): Promise<{ providerId: string }> {
    assertValidEmailInput(input);
    const failure = this.failures.shift();
    if (failure) throw failure;

    this.counter += 1;
    const providerId = `email-fake-${this.counter}`;
    this.sent.push({ ...input, providerId });
    return { providerId };
  }
}
