/** Messaging and voice provider boundary (integrations.md section 2). Numbers are E.164. */

export interface InboundMessage {
  providerSid: string;
  from: string;
  body: string;
  hasMedia: boolean;
}

export interface MessageStatusUpdate {
  providerSid: string;
  status: "sent" | "delivered" | "failed";
  errorCode?: string;
}

export interface VoiceCall {
  callSid: string;
  /** null when the caller's number is withheld or not a usable E.164 number. */
  from: string | null;
  to: string;
}

export interface MessagingAdapter {
  /** Sends a free-form WhatsApp message. Throws AdapterError. */
  sendMessage(input: { to: string; body: string }): Promise<{ providerSid: string }>;

  /** Checks the provider signature over the public URL the provider called. */
  validateWebhook(input: { url: string; params: Record<string, string>; signature: string | null }): boolean;

  parseInboundMessage(params: Record<string, string>): InboundMessage | null;
  /** null for in-flight statuses (queued, sending) that need no action. */
  parseMessageStatus(params: Record<string, string>): MessageStatusUpdate | null;
  parseVoice(params: Record<string, string>): VoiceCall | null;

  /** What to answer an incoming call with: reject it, so nothing is billed. */
  voiceResponse(): string;
}
