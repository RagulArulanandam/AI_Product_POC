export type Role = "owner" | "staff";

export type Action =
  | "business.update"
  | "product.toggle"
  | "product.configure"
  | "integration.manage"
  | "conversation.view"
  | "metrics.view"
  | "billing.view";

export const ACTIONS: readonly Action[] = [
  "business.update",
  "product.toggle",
  "product.configure",
  "integration.manage",
  "conversation.view",
  "metrics.view",
  "billing.view",
];

/**
 * The one place app code decides who may do what (auth.md section 5).
 * Staff rules are undecided, so every member may do everything for now.
 * When that changes, change this and the SQL helper `can_write()` together.
 */
export function can(role: Role, action: Action): boolean {
  void role;
  void action;
  return true;
}
