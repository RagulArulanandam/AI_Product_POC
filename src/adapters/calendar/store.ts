import { decryptSecret, encryptSecret } from "@/lib/crypto";
import { AdapterError } from "@/lib/errors";
import type { Admin } from "@/engine/types";
import type { TokenSet } from "./google-oauth";
import type { TokenStore } from "./google";

/** What is encrypted and stored per integration. Only ever read with the service role. */
export function serializeTokens(tokens: TokenSet): string {
  return encryptSecret(JSON.stringify(tokens));
}

export function parseTokens(stored: string): TokenSet {
  const value = JSON.parse(decryptSecret(stored)) as Partial<TokenSet>;
  if (typeof value.accessToken !== "string" || typeof value.refreshToken !== "string" || typeof value.expiresAt !== "number") {
    throw new Error("Stored calendar tokens are malformed");
  }
  return { accessToken: value.accessToken, refreshToken: value.refreshToken, expiresAt: value.expiresAt };
}

/** Encrypted tokens in `integration_secrets`; a rejected token marks the integration as needing a reconnect. */
export class SupabaseTokenStore implements TokenStore {
  constructor(
    private readonly admin: Admin,
    private readonly integrationId: string,
  ) {}

  async load(): Promise<TokenSet> {
    const { data: integration } = await this.admin
      .from("integrations")
      .select("status")
      .eq("id", this.integrationId)
      .maybeSingle();
    if (!integration || integration.status !== "connected") {
      throw new AdapterError("auth", "The calendar is not connected", { retryable: false });
    }

    const { data } = await this.admin
      .from("integration_secrets")
      .select("ciphertext")
      .eq("integration_id", this.integrationId)
      .maybeSingle();
    if (!data) throw new AdapterError("auth", "The calendar has no saved access", { retryable: false });
    try {
      return parseTokens(data.ciphertext);
    } catch (error) {
      throw new AdapterError("auth", "The saved calendar access could not be read", { cause: error, retryable: false });
    }
  }

  async save(tokens: TokenSet): Promise<void> {
    const { error } = await this.admin
      .from("integration_secrets")
      .update({ ciphertext: serializeTokens(tokens) })
      .eq("integration_id", this.integrationId);
    if (error) throw new Error(`Could not save refreshed calendar tokens: ${error.message}`);
  }

  async markBroken(message: string): Promise<void> {
    await this.admin.from("integrations").update({ status: "error", last_error: message }).eq("id", this.integrationId);
  }
}
