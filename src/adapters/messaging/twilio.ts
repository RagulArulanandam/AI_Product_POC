import twilio, { validateRequest } from "twilio";
import { AdapterError } from "@/lib/errors";
import { mapTwilioError } from "./errors";
import type { MessagingAdapter } from "./interface";
import { isE164, parseInboundMessage, parseMessageStatus, parseVoice, VOICE_REJECT_TWIML } from "./parse";

export interface TwilioConfig {
  accountSid: string;
  authToken: string;
  /** e.g. `whatsapp:+447460077297` (the shared sandbox sender in the POC). */
  whatsappFrom: string;
  /** Public tunnel URL. Delivery status callbacks are pointed at it per message. */
  publicBaseUrl: string;
  /**
   * Trial accounts using the Console's "Try out WhatsApp" can only send Twilio's pre-approved
   * templates (error 21654 otherwise). When set, every send uses this template (an `HX...` SID)
   * and the message text is ignored. Leave unset on a full account or the legacy sandbox.
   */
  trialContentSid?: string;
}

/** The slice of the Twilio client we use, so tests can pass a stub. */
export interface TwilioLikeClient {
  messages: {
    create(args: {
      from: string;
      to: string;
      body?: string;
      contentSid?: string;
      statusCallback: string;
    }): Promise<{ sid: string }>;
  };
}

export class TwilioMessagingAdapter implements MessagingAdapter {
  constructor(
    private readonly config: TwilioConfig,
    private readonly client: TwilioLikeClient = twilio(config.accountSid, config.authToken),
  ) {}

  async sendMessage(input: { to: string; body: string }): Promise<{ providerSid: string; templateSid?: string }> {
    if (!isE164(input.to)) throw new AdapterError("invalid_request", "Recipient is not an E.164 number");
    if (!input.body.trim()) throw new AdapterError("invalid_request", "Message body is empty");

    const templateSid = this.config.trialContentSid;
    try {
      const message = await this.client.messages.create({
        from: this.config.whatsappFrom,
        to: `whatsapp:${input.to}`,
        ...(templateSid ? { contentSid: templateSid } : { body: input.body }),
        // Set per message, so a changed tunnel URL needs no Twilio console change.
        statusCallback: `${this.config.publicBaseUrl.replace(/\/+$/, "")}/api/webhooks/whatsapp/status`,
      });
      return { providerSid: message.sid, ...(templateSid ? { templateSid } : {}) };
    } catch (error) {
      throw mapTwilioError(error);
    }
  }

  validateWebhook(input: { url: string; params: Record<string, string>; signature: string | null }): boolean {
    if (!input.signature) return false;
    try {
      return validateRequest(this.config.authToken, input.signature, input.url, input.params);
    } catch {
      return false;
    }
  }

  parseInboundMessage = parseInboundMessage;
  parseMessageStatus = parseMessageStatus;
  parseVoice = parseVoice;

  voiceResponse(): string {
    return VOICE_REJECT_TWIML;
  }
}
