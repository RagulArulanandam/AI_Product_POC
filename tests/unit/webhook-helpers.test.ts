import { afterEach, describe, expect, it } from "vitest";
import { buildPublicUrl, readWebhookParams } from "@/engine/webhooks";
import { getPublicBaseUrl } from "@/lib/env";

describe("buildPublicUrl", () => {
  it("replaces the host with the public base, keeping path and query", () => {
    expect(buildPublicUrl("https://tunnel.example.com", "http://localhost:3000/api/webhooks/voice")).toBe(
      "https://tunnel.example.com/api/webhooks/voice",
    );
    expect(buildPublicUrl("https://tunnel.example.com", "http://localhost:3000/api/webhooks/whatsapp?x=1&y=2")).toBe(
      "https://tunnel.example.com/api/webhooks/whatsapp?x=1&y=2",
    );
  });

  it("copes with trailing slashes on the base", () => {
    expect(buildPublicUrl("https://tunnel.example.com/", "http://127.0.0.1:3000/a")).toBe("https://tunnel.example.com/a");
    expect(buildPublicUrl("https://tunnel.example.com///", "http://127.0.0.1:3000/a")).toBe("https://tunnel.example.com/a");
  });

  it("ignores whatever Host the request arrived with", () => {
    const a = buildPublicUrl("https://t.example.com", "http://evil.example/api/x");
    const b = buildPublicUrl("https://t.example.com", "http://localhost:3000/api/x");
    expect(a).toBe(b);
  });
});

describe("readWebhookParams", () => {
  it("reads form-encoded bodies (what Twilio sends)", async () => {
    const request = new Request("http://localhost/x", {
      method: "POST",
      headers: { "content-type": "application/x-www-form-urlencoded" },
      body: "CallSid=CA123&From=%2B447911123456&Empty=",
    });
    expect(await readWebhookParams(request)).toEqual({ CallSid: "CA123", From: "+447911123456", Empty: "" });
  });

  it("reads JSON bodies and stringifies non-strings", async () => {
    const request = new Request("http://localhost/x", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ a: "1", n: 5, nested: { b: 2 } }),
    });
    expect(await readWebhookParams(request)).toEqual({ a: "1", n: "5", nested: '{"b":2}' });
  });

  it("returns an empty map for unreadable or empty bodies", async () => {
    const bad = new Request("http://localhost/x", { method: "POST", headers: { "content-type": "application/json" }, body: "{not json" });
    expect(await readWebhookParams(bad)).toEqual({});
    expect(await readWebhookParams(new Request("http://localhost/x", { method: "POST" }))).toEqual({});
  });
});

describe("getPublicBaseUrl", () => {
  const saved = process.env.PUBLIC_BASE_URL;
  afterEach(() => {
    if (saved === undefined) delete process.env.PUBLIC_BASE_URL;
    else process.env.PUBLIC_BASE_URL = saved;
  });

  it("requires a valid URL", () => {
    delete process.env.PUBLIC_BASE_URL;
    expect(() => getPublicBaseUrl()).toThrow();
    process.env.PUBLIC_BASE_URL = "not a url";
    expect(() => getPublicBaseUrl()).toThrow();
    process.env.PUBLIC_BASE_URL = "https://tunnel.example.com";
    expect(getPublicBaseUrl()).toBe("https://tunnel.example.com");
  });
});
