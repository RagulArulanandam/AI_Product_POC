import { describe, expect, it } from "vitest";
import { flattenIssues } from "@/lib/forms/field-errors";
import { missedCallConfigSchema } from "@/products/missed-call/config";

describe("flattenIssues", () => {
  it("joins paths with dots and keeps the first message per field", () => {
    expect(
      flattenIssues([
        { path: ["delay_minutes"], message: "Too big" },
        { path: ["delay_minutes"], message: "Second message" },
        { path: ["business_hours", "mon", "close"], message: "Bad time" },
        { path: [], message: "Whole form" },
      ]),
    ).toEqual({ delay_minutes: "Too big", "business_hours.mon.close": "Bad time", form: "Whole form" });
  });

  it("returns an empty object for no issues", () => {
    expect(flattenIssues([])).toEqual({});
  });

  it("works with real Zod errors from the Product 1 schema", () => {
    const result = missedCallConfigSchema.safeParse({ delay_minutes: -1, escalation_email: "x", escalate_on: { complaint: "yes" } });
    expect(result.success).toBe(false);
    if (!result.success) {
      const errors = flattenIssues(result.error.issues);
      expect(Object.keys(errors)).toEqual(expect.arrayContaining(["delay_minutes", "escalation_email", "escalate_on.complaint"]));
    }
  });
});
