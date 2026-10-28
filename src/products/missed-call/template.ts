/**
 * Fills `{{name}}` placeholders in a message template. Unknown placeholders become empty,
 * so a typo never sends literal braces to a customer.
 */
export function renderTemplate(template: string, variables: Record<string, string>): string {
  return template
    .replace(/\{\{\s*([a-z_]+)\s*\}\}/gi, (_match, name: string) => variables[name.toLowerCase()] ?? "")
    .replace(/[ \t]{2,}/g, " ")
    .trim();
}
