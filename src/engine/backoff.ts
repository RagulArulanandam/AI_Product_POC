/** Minutes to wait after the 1st, 2nd and 3rd failed attempt (automation-engine.md section 5). */
export const BACKOFF_MINUTES = [1, 5, 15] as const;

/** When to retry, given how many attempts have been made so far (1-based). Pure, for testing. */
export function nextRunAt(attemptsMade: number, now: Date): Date {
  const index = Math.min(Math.max(attemptsMade, 1), BACKOFF_MINUTES.length) - 1;
  return new Date(now.getTime() + BACKOFF_MINUTES[index] * 60_000);
}
