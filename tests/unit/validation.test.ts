import { describe, expect, it } from "vitest";
import { loginSchema, signupSchema } from "@/lib/validation/auth";
import { createBusinessSchema } from "@/lib/validation/business";
import { businessHoursSchema, DEFAULT_BUSINESS_HOURS } from "@/lib/validation/hours";

describe("auth schemas", () => {
  it("normalises the email and enforces an 8 character password on signup", () => {
    const ok = signupSchema.parse({ email: "  Owner@Example.COM ", password: "longenough" });
    expect(ok.email).toBe("owner@example.com");
    expect(signupSchema.safeParse({ email: "owner@example.com", password: "short" }).success).toBe(false);
    expect(signupSchema.safeParse({ email: "not-an-email", password: "longenough" }).success).toBe(false);
  });

  it("only requires a password on login", () => {
    expect(loginSchema.safeParse({ email: "a@b.co", password: "x" }).success).toBe(true);
    expect(loginSchema.safeParse({ email: "a@b.co", password: "" }).success).toBe(false);
  });
});

describe("createBusinessSchema", () => {
  const valid = { name: "  Bright Smile Dental ", phone: "07911 123456", timezone: "Europe/London" };

  it("trims the name and converts the phone to E.164", () => {
    const parsed = createBusinessSchema.parse(valid);
    expect(parsed).toEqual({ name: "Bright Smile Dental", phone: "+447911123456", timezone: "Europe/London" });
  });

  it("reports field errors", () => {
    const res = createBusinessSchema.safeParse({ name: "", phone: "123", timezone: "Mars/Base" });
    expect(res.success).toBe(false);
    if (!res.success) {
      const fields = res.error.issues.map((i) => i.path[0]);
      expect(fields).toEqual(expect.arrayContaining(["name", "phone", "timezone"]));
    }
  });
});

describe("businessHoursSchema", () => {
  it("accepts the default hours", () => {
    expect(businessHoursSchema.safeParse(DEFAULT_BUSINESS_HOURS).success).toBe(true);
  });

  it("rejects closing before opening and bad times", () => {
    const bad = { ...DEFAULT_BUSINESS_HOURS, mon: { open: "17:00", close: "09:00" } };
    expect(businessHoursSchema.safeParse(bad).success).toBe(false);
    const badFormat = { ...DEFAULT_BUSINESS_HOURS, tue: { open: "9am", close: "17:00" } };
    expect(businessHoursSchema.safeParse(badFormat).success).toBe(false);
  });
});
