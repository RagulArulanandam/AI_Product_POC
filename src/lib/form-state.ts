/** Result of a form server action, shown by the form (architecture.md section 10). */
export type FormState =
  | undefined
  | {
      ok: false;
      error?: string;
      fieldErrors?: Record<string, string[] | undefined>;
    };

export function zodFieldErrors(issues: { path: PropertyKey[]; message: string }[]): Record<string, string[]> {
  const out: Record<string, string[]> = {};
  for (const issue of issues) {
    const key = String(issue.path[0] ?? "form");
    (out[key] ??= []).push(issue.message);
  }
  return out;
}
