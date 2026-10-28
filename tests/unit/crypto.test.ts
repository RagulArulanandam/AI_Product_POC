import { randomBytes } from "node:crypto";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { decryptSecret, decryptWithKeys, encryptSecret, encryptWithKey } from "@/lib/crypto";
import { getEncryptionEnv } from "@/lib/env";

const keyA = randomBytes(32);
const keyB = randomBytes(32);

describe("encryptWithKey / decryptWithKeys", () => {
  it("round-trips text, including non-ASCII", () => {
    const text = JSON.stringify({ refresh_token: "1//abc", note: "café ☕" });
    expect(decryptWithKeys(encryptWithKey(text, keyA), [keyA])).toBe(text);
  });

  it("gives a different stored value each time (random IV) and never contains the plaintext", () => {
    const one = encryptWithKey("secret-token", keyA);
    const two = encryptWithKey("secret-token", keyA);
    expect(one).not.toBe(two);
    expect(one).not.toContain("secret-token");
    expect(one.startsWith("v1.")).toBe(true);
  });

  it("fails with the wrong key", () => {
    expect(() => decryptWithKeys(encryptWithKey("x", keyA), [keyB])).toThrow("Could not decrypt");
  });

  it("detects a changed value", () => {
    const parts = encryptWithKey("hello world", keyA).split(".");
    const data = Buffer.from(parts[3], "base64url");
    data[0] ^= 1;
    parts[3] = data.toString("base64url");
    expect(() => decryptWithKeys(parts.join("."), [keyA])).toThrow("Could not decrypt");
  });

  it("rejects text that is not in the stored format", () => {
    expect(() => decryptWithKeys("plain text", [keyA])).toThrow("Unrecognised");
    expect(() => decryptWithKeys("v2.a.b.c", [keyA])).toThrow("Unrecognised");
  });

  it("reads values written with an older key when it is listed", () => {
    const old = encryptWithKey("old value", keyB);
    expect(decryptWithKeys(old, [keyA, keyB])).toBe("old value");
  });
});

describe("with keys from the environment", () => {
  const saved = { key: process.env.ENCRYPTION_KEY, prev: process.env.ENCRYPTION_KEY_PREVIOUS };

  beforeEach(() => {
    process.env.ENCRYPTION_KEY = keyA.toString("base64");
    delete process.env.ENCRYPTION_KEY_PREVIOUS;
  });
  afterEach(() => {
    if (saved.key === undefined) delete process.env.ENCRYPTION_KEY;
    else process.env.ENCRYPTION_KEY = saved.key;
    if (saved.prev === undefined) delete process.env.ENCRYPTION_KEY_PREVIOUS;
    else process.env.ENCRYPTION_KEY_PREVIOUS = saved.prev;
  });

  it("encrypts and decrypts with ENCRYPTION_KEY", () => {
    expect(decryptSecret(encryptSecret("token"))).toBe("token");
  });

  it("still reads old values after the key is rotated, using ENCRYPTION_KEY_PREVIOUS", () => {
    const stored = encryptSecret("token");
    process.env.ENCRYPTION_KEY = keyB.toString("base64");
    expect(() => decryptSecret(stored)).toThrow();
    process.env.ENCRYPTION_KEY_PREVIOUS = keyA.toString("base64");
    expect(decryptSecret(stored)).toBe("token");
  });

  it("refuses a missing or wrongly sized key", () => {
    delete process.env.ENCRYPTION_KEY;
    expect(() => getEncryptionEnv()).toThrow();
    process.env.ENCRYPTION_KEY = Buffer.from("too short").toString("base64");
    expect(() => getEncryptionEnv()).toThrow(/32 bytes/);
  });
});
