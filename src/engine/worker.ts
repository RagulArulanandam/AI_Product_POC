import { claimDueAction } from "./queue";
import { runAction, type EngineDeps, type RunOutcome } from "./runner";

export interface WorkerSummary {
  claimed: number;
  done: number;
  retried: number;
  failed: number;
  skipped: number;
}

export interface WorkerOptions {
  /** Stop claiming new actions after this long (the route allows 60 seconds in total). */
  budgetMs?: number;
  /** Hard cap on actions per call, so one call cannot run forever. */
  maxActions?: number;
}

const DEFAULT_BUDGET_MS = 50_000;
const DEFAULT_MAX_ACTIONS = 50;

/**
 * Claims and runs due actions one at a time until none are left, the budget is spent or the
 * cap is reached (automation-engine.md section 5). Safe to call from several places at once:
 * the claim query hands each action to exactly one caller.
 */
export async function runDueActions(deps: EngineDeps, options: WorkerOptions = {}): Promise<WorkerSummary> {
  const budgetMs = options.budgetMs ?? DEFAULT_BUDGET_MS;
  const maxActions = options.maxActions ?? DEFAULT_MAX_ACTIONS;
  const started = Date.now();
  const summary: WorkerSummary = { claimed: 0, done: 0, retried: 0, failed: 0, skipped: 0 };

  while (summary.claimed < maxActions && Date.now() - started < budgetMs) {
    const action = await claimDueAction(deps.admin);
    if (!action) break;

    summary.claimed += 1;
    const outcome: RunOutcome = await runAction(deps, action);
    summary[outcome] += 1;
  }
  return summary;
}
