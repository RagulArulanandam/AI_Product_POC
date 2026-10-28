/** Turns Zod issues into `{ "business_hours.mon.close": "message" }`, keeping the first message per field. */
export function flattenIssues(issues: readonly { path: readonly PropertyKey[]; message: string }[]): Record<string, string> {
  const out: Record<string, string> = {};
  for (const issue of issues) {
    const key = issue.path.map(String).join(".") || "form";
    if (!(key in out)) out[key] = issue.message;
  }
  return out;
}
