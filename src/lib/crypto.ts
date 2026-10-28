import { createCipheriv, createDecipheriv, randomBytes } from "node:crypto";
import { getEncryptionEnv } from "@/lib/env";

/**
 * AES-256-GCM for secrets we must store (calendar tokens). The stored text is
 * `v1.<iv>.<tag>.<data>`, all base64url. GCM authenticates, so a wrong key or a changed value
 * fails loudly instead of returning garbage. Server-only (security-privacy.md section 3).
 */
const VERSION = "v1";
const IV_BYTES = 12;

export function encryptWithKey(plaintext: string, key: Buffer): string {
  const iv = randomBytes(IV_BYTES);
  const cipher = createCipheriv("aes-256-gcm", key, iv);
  const data = Buffer.concat([cipher.update(plaintext, "utf8"), cipher.final()]);
  return [VERSION, iv.toString("base64url"), cipher.getAuthTag().toString("base64url"), data.toString("base64url")].join(".");
}

/** Tries each key in turn, so a rotated-out key can still read old values. */
export function decryptWithKeys(stored: string, keys: Buffer[]): string {
  const [version, iv, tag, data] = stored.split(".");
  if (version !== VERSION || !iv || !tag || !data) throw new Error("Unrecognised secret format");

  for (const key of keys) {
    try {
      const decipher = createDecipheriv("aes-256-gcm", key, Buffer.from(iv, "base64url"));
      decipher.setAuthTag(Buffer.from(tag, "base64url"));
      return Buffer.concat([decipher.update(Buffer.from(data, "base64url")), decipher.final()]).toString("utf8");
    } catch {
      // Wrong key or tampered value: try the next key.
    }
  }
  throw new Error("Could not decrypt secret");
}

export function encryptSecret(plaintext: string): string {
  return encryptWithKey(plaintext, getEncryptionEnv().current);
}

export function decryptSecret(stored: string): string {
  const { current, previous } = getEncryptionEnv();
  return decryptWithKeys(stored, previous ? [current, previous] : [current]);
}
