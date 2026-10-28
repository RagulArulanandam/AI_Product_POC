/** Date and time formatting for people: UK style, in the business's own timezone. */

export function formatDateTime(iso: string | Date, timezone: string): string {
  return new Intl.DateTimeFormat("en-GB", { dateStyle: "medium", timeStyle: "short", timeZone: timezone }).format(new Date(iso));
}

export function formatDate(iso: string | Date, timezone: string): string {
  return new Intl.DateTimeFormat("en-GB", { dateStyle: "long", timeZone: timezone }).format(new Date(iso));
}

/** "just now", "5 minutes ago", "3 hours ago", "yesterday", then a date. */
export function timeAgo(iso: string | Date, now: Date, timezone: string): string {
  const seconds = Math.round((now.getTime() - new Date(iso).getTime()) / 1000);
  if (seconds < 45) return "just now";
  const minutes = Math.round(seconds / 60);
  if (minutes < 60) return `${minutes} minute${minutes === 1 ? "" : "s"} ago`;
  const hours = Math.round(minutes / 60);
  if (hours < 24) return `${hours} hour${hours === 1 ? "" : "s"} ago`;
  const days = Math.round(hours / 24);
  if (days === 1) return "yesterday";
  if (days < 7) return `${days} days ago`;
  return formatDate(iso, timezone);
}
