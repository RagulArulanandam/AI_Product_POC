import type { Json } from "@/lib/database.types";
import type { Admin, ScheduledAction } from "./types";

export interface EnqueueInput {
  businessId: string;
  conversationId?: string | null;
  type: string;
  /** Which product handles a product action. Not needed for `handle_event`. */
  productKey?: string;
  payload?: Record<string, unknown>;
  runAt?: Date;
  /** Same key twice means the same logical action, so the second call is a no-op. */
  dedupeKey: string;
  maxAttempts?: number;
}

const UNIQUE_VIOLATION = "23505";

export async function enqueueAction(admin: Admin, input: EnqueueInput): Promise<{ created: boolean; id: string }> {
  const payload = { ...(input.payload ?? {}), ...(input.productKey ? { product_key: input.productKey } : {}) };
  const { data, error } = await admin
    .from("scheduled_actions")
    .insert({
      business_id: input.businessId,
      conversation_id: input.conversationId ?? null,
      type: input.type,
      payload: payload as Record<string, Json | undefined>,
      run_at: (input.runAt ?? new Date()).toISOString(),
      dedupe_key: input.dedupeKey,
      ...(input.maxAttempts ? { max_attempts: input.maxAttempts } : {}),
    })
    .select("id")
    .single();

  if (!error && data) return { created: true, id: data.id };
  if (error?.code === UNIQUE_VIOLATION) {
    const { data: existing, error: lookupError } = await admin
      .from("scheduled_actions")
      .select("id")
      .eq("dedupe_key", input.dedupeKey)
      .single();
    if (lookupError || !existing) throw new Error(`enqueueAction lookup failed: ${lookupError?.message}`);
    return { created: false, id: existing.id };
  }
  throw new Error(`enqueueAction failed: ${error?.message}`);
}

/** Claims at most one due action (database.md section 8), or null when nothing is due. */
export async function claimDueAction(admin: Admin): Promise<ScheduledAction | null> {
  const { data, error } = await admin.rpc("claim_due_actions", { batch: 1 });
  if (error) throw new Error(`claim_due_actions failed: ${error.message}`);
  return data && data.length > 0 ? data[0] : null;
}

async function update(admin: Admin, id: string, values: Partial<ScheduledAction>): Promise<void> {
  const { error } = await admin.from("scheduled_actions").update(values).eq("id", id);
  if (error) throw new Error(`scheduled_actions update failed: ${error.message}`);
}

export function completeAction(admin: Admin, id: string): Promise<void> {
  return update(admin, id, { status: "done", locked_at: null, last_error: null });
}

export function cancelAction(admin: Admin, id: string, reason: string): Promise<void> {
  return update(admin, id, { status: "cancelled", locked_at: null, last_error: reason });
}

export function failAction(admin: Admin, id: string, error: string): Promise<void> {
  return update(admin, id, { status: "failed", locked_at: null, last_error: error });
}

export function retryActionAt(admin: Admin, id: string, runAt: Date, error: string): Promise<void> {
  return update(admin, id, { status: "pending", locked_at: null, run_at: runAt.toISOString(), last_error: error });
}

/** Admin retry (Phase 7): puts a failed action back in the queue with a fresh attempt budget. */
export async function requeueFailedAction(admin: Admin, id: string, now: Date): Promise<boolean> {
  const { data, error } = await admin
    .from("scheduled_actions")
    .update({ status: "pending", attempts: 0, run_at: now.toISOString(), locked_at: null, last_error: null })
    .eq("id", id)
    .eq("status", "failed")
    .select("id");
  if (error) throw new Error(`requeueFailedAction failed: ${error.message}`);
  return (data ?? []).length === 1;
}
