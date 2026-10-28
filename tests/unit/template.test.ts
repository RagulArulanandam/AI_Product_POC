import { describe, expect, it } from "vitest";
import { DEFAULT_FIRST_MESSAGE, DEFAULT_OUTSIDE_HOURS_MESSAGE } from "@/products/missed-call/config";
import { renderTemplate } from "@/products/missed-call/template";

describe("renderTemplate", () => {
  it("fills the business name in the default templates", () => {
    expect(renderTemplate(DEFAULT_FIRST_MESSAGE, { business_name: "Bright Smile Dental" })).toBe(
      "Hi, this is Bright Smile Dental. Sorry we missed your call. How can we help?",
    );
    expect(renderTemplate(DEFAULT_OUTSIDE_HOURS_MESSAGE, { business_name: "Glow" })).toContain("Hi, this is Glow.");
  });

  it("allows spaces inside the braces and repeated placeholders", () => {
    expect(renderTemplate("{{ business_name }} / {{business_name}}", { business_name: "X" })).toBe("X / X");
  });

  it("is case-insensitive about placeholder names", () => {
    expect(renderTemplate("{{BUSINESS_NAME}}", { business_name: "X" })).toBe("X");
  });

  it("turns unknown placeholders into nothing, never literal braces", () => {
    expect(renderTemplate("Hi {{nope}}there", { business_name: "X" })).toBe("Hi there");
  });

  it("does not interpret the business name as a template", () => {
    expect(renderTemplate("Hi, {{business_name}}", { business_name: "{{business_name}}" })).toBe("Hi, {{business_name}}");
  });

  it("trims and collapses runs of spaces", () => {
    expect(renderTemplate("  Hello   {{business_name}}  ", { business_name: "X" })).toBe("Hello X");
  });
});
