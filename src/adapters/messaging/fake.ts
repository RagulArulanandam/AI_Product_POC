import { AdapterError } from "@/lib/errors";
import type { MessagingAdapter } from "./interface";
import { isE164, parseInboundMessage, parseMessageStatus, parseVoice, VOICE_REJECT_TWIML } from "./parse";

export interface SentMessage {
  to: string;
  body: string;
  providerSid: string;
}

/** In-memory messaging for tests and `ADAPTER_MODE=fake`. Records sends; failures can be scripted. */
export class FakeMessagingAdapter implements MessagingAdapter {
  sent: SentMessage[] = [];
  /** Set to simulate trial template mode: sends report this template and ignore the text. */
  templateSid: string | undefined;
  /** The signature value validateWebhook accepts. */
  validSignature = "fake-valid";
  private counter = 0;
  private failures: AdapterError[] = [];

  /** Makes the next `times` sends throw `error`. */
  failNext(error: AdapterError, times = 1): void {
    for (let i = 0; i < times; i += 1) this.failures.push(error);
  }

  reset(): void {
    this.sent = [];
    this.failures = [];
    this.counter = 0;
    this.templateSid = undefined;
  }

  async sendMessage(input: { to: string; body: string }): Promise<{ providerSid: string; templateSid?: string }> {
    if (!isE164(input.to)) throw new AdapterError("invalid_request", "Recipient is not an E.164 number");
    if (!input.body.trim()) throw new AdapterError("invalid_request", "Message body is empty");
    const failure = this.failures.shift();
    if (failure) throw failure;

    this.counter += 1;
    const providerSid = `SMfake${String(this.counter).padStart(6, "0")}`;
    this.sent.push({ to: input.to, body: input.body, providerSid });
    return { providerSid, ...(this.templateSid ? { templateSid: this.templateSid } : {}) };
  }

  validateWebhook(input: { url: string; params: Record<string, string>; signature: string | null }): boolean {
    return input.signature === this.validSignature;
  }

  parseInboundMessage = parseInboundMessage;
  parseMessageStatus = parseMessageStatus;
  parseVoice = parseVoice;

  voiceResponse(): string {
    return VOICE_REJECT_TWIML;
  }
}
