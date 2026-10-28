import { describe, expect, it } from "vitest";
import { missedCallConfigSchema } from "@/products/missed-call/config";
import { getProduct, listProducts } from "@/products/registry";

describe("product registry", () => {
  it("has unique, kebab-case keys and complete manifests", () => {
    const keys = listProducts().map((p) => p.key);
    expect(new Set(keys).size).toBe(keys.length);
    for (const p of listProducts()) {
      expect(p.key).toMatch(/^[a-z]+(-[a-z]+)*$/);
      expect(p.name.length).toBeGreaterThan(0);
      expect(p.description.length).toBeGreaterThan(0);
    }
  });

  it("lists Product 1 as available and Products 2 and 3 as coming soon", () => {
    expect(getProduct("missed-call")?.status).toBe("available");
    expect(getProduct("priority-inbox")?.status).toBe("coming_soon");
    expect(getProduct("daily-brief")?.status).toBe("coming_soon");
  });

  it("returns undefined for an unknown key", () => {
    expect(getProduct("nope")).toBeUndefined();
  });

  it("makes every default config valid under its own schema", () => {
    for (const p of listProducts()) {
      expect(p.configSchema.safeParse(p.defaultConfig).success, p.key).toBe(true);
    }
  });

  it("only gives events to available products", () => {
    for (const p of listProducts()) {
      if (p.status === "coming_soon") expect(p.handledEvents, p.key).toEqual([]);
    }
    expect(getProduct("missed-call")?.handledEvents).toEqual(["call.missed", "message.inbound", "message.status"]);
  });
});

describe("missed-call config schema", () => {
  it("applies the documented defaults (product-missed-call.md)", () => {
    expect(missedCallConfigSchema.parse({})).toEqual({
      delay_minutes: 2,
      first_message_template: "Hi, this is {{business_name}}. Sorry we missed your call. How can we help?",
      outside_hours_template:
        "Hi, this is {{business_name}}. We missed your call and are closed now. How can we help? We'll reply when we reopen.",
      send_outside_hours: true,
      business_hours: null,
      booking_enabled: false,
      appointment_duration_minutes: 30,
      buffer_minutes: 0,
      calendar_integration_id: null,
      escalation_email: null,
      escalate_on: { complaint: true, wants_human: true, low_confidence: true },
      business_blurb: "",
    });
  });

  it("keeps explicit values and fills the rest", () => {
    const parsed = missedCallConfigSchema.parse({ delay_minutes: 10, booking_enabled: true });
    expect(parsed.delay_minutes).toBe(10);
    expect(parsed.booking_enabled).toBe(true);
    expect(parsed.appointment_duration_minutes).toBe(30);
  });

  it.each([
    ["negative delay", { delay_minutes: -1 }],
    ["fractional delay", { delay_minutes: 1.5 }],
    ["delay over an hour", { delay_minutes: 61 }],
    ["empty template", { first_message_template: "   " }],
    ["zero duration", { appointment_duration_minutes: 0 }],
    ["negative buffer", { buffer_minutes: -5 }],
    ["bad escalation email", { escalation_email: "not-an-email" }],
    ["bad calendar id", { calendar_integration_id: "abc" }],
    ["bad hours", { business_hours: { mon: { open: "17:00", close: "09:00" } } }],
    ["blurb too long", { business_blurb: "x".repeat(1001) }],
  ])("rejects %s", (_label, input) => {
    expect(missedCallConfigSchema.safeParse(input).success).toBe(false);
  });
});
