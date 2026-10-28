import { describe, expect, it } from "vitest";
import { ACTIONS, can, type Role } from "@/lib/auth/permissions";

// Staff permissions are undecided, so every role may do every action for now.
// When the rules are decided, replace this with the real matrix (auth.md section 5).
describe("can()", () => {
  const roles: Role[] = ["owner", "staff"];

  for (const role of roles) {
    for (const action of ACTIONS) {
      it(`${role} may ${action} (placeholder)`, () => {
        expect(can(role, action)).toBe(true);
      });
    }
  }
});
