/** Outgoing email boundary (integrations.md section 5). */
export interface EmailAdapter {
  /** Sends one email. Throws AdapterError. */
  send(input: { to: string; subject: string; text: string; html?: string }): Promise<{ providerId: string }>;
}
