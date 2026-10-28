import { describe, expect, it } from "vitest";
import { decideRoute } from "@/lib/auth/route-rules";

describe("decideRoute", () => {
  it("sends signed-out visitors to login with a next parameter", () => {
    expect(decideRoute({ pathname: "/dashboard" }, false)).toEqual({
      action: "redirect",
      to: "/login?next=%2Fdashboard",
    });
    expect(decideRoute({ pathname: "/conversations/abc", search: "?x=1" }, false)).toEqual({
      action: "redirect",
      to: "/login?next=%2Fconversations%2Fabc%3Fx%3D1",
    });
  });

  it("protects every business and admin area", () => {
    const paths = ["/onboarding", "/products", "/integrations", "/billing", "/settings", "/admin", "/admin/failures", "/disabled"];
    for (const path of paths) {
      expect(decideRoute({ pathname: path }, false).action, path).toBe("redirect");
    }
  });

  it("lets signed-out visitors reach login and signup", () => {
    expect(decideRoute({ pathname: "/login" }, false)).toEqual({ action: "next" });
    expect(decideRoute({ pathname: "/signup" }, false)).toEqual({ action: "next" });
  });

  it("sends signed-in users away from login and signup", () => {
    expect(decideRoute({ pathname: "/login" }, true)).toEqual({ action: "redirect", to: "/dashboard" });
    expect(decideRoute({ pathname: "/signup" }, true)).toEqual({ action: "redirect", to: "/dashboard" });
  });

  it("routes the root by authentication", () => {
    expect(decideRoute({ pathname: "/" }, false)).toEqual({ action: "redirect", to: "/login" });
    expect(decideRoute({ pathname: "/" }, true)).toEqual({ action: "redirect", to: "/dashboard" });
  });

  it("does not touch API routes (they authenticate themselves)", () => {
    for (const path of ["/api/webhooks/voice", "/api/worker", "/api/dev/simulate-missed-call"]) {
      expect(decideRoute({ pathname: path }, false)).toEqual({ action: "next" });
    }
  });

  it("does not match lookalike prefixes", () => {
    expect(decideRoute({ pathname: "/dashboards-info" }, false)).toEqual({ action: "next" });
  });
});
