import { AdapterError } from "@/lib/errors";
import { redact } from "@/lib/redact";
import type { ProductManifest } from "@/products/types";
import { nextRunAt } from "./backoff";
import { createStepLogger, type StepLogger } from "./log";
import { cancelAction, completeAction, failAction, retryActionAt } from "./queue";
import {
  HANDLE_EVENT,
  type Admin,
  type BusinessRow,
  type HandlerResult,
  type ScheduledAction,
  type Services,
  type WebhookEvent,
} from "./types";

export interface EngineDeps {
  admin: Admin;
  products: readonly ProductManifest[];
  now: () => Date;
  /** Adapters and services handlers may use (injected so tests can pass fakes). */
  services: Services;
}

export type RunOutcome = "done" | "skipped" | "retried" | "failed";

/**
 * Runs one claimed action: finds the product, checks the generic conditions, calls the handler
 * and records the result (EVENT -> CONDITION -> ... -> LOG RESULT). Never throws.
 */
export async function runAction(deps: EngineDeps, action: ScheduledAction): Promise<RunOutcome> {
  const base = {
    businessId: action.business_id,
    conversationId: action.conversation_id,
    actionId: action.id,
    eventType: action.type,
  };
  const log = createStepLogger(deps.admin, base);
  let event: WebhookEvent | undefined;

  try {
    const loaded = await dispatch(deps, action, log);
    event = loaded.event;
    return await applyResult(deps, action, event, loaded.result, log);
  } catch (error) {
    return await applyError(deps, action, event, error, log);
  }
}

async function dispatch(
  deps: EngineDeps,
  action: ScheduledAction,
  log: StepLogger,
): Promise<{ result: HandlerResult; event?: WebhookEvent }> {
  const payload = (action.payload ?? {}) as Record<string, unknown>;
  let event: WebhookEvent | undefined;
  let handlerKey = action.type;
  let product: ProductManifest | undefined;

  if (action.type === HANDLE_EVENT) {
    const eventId = typeof payload.webhook_event_id === "string" ? payload.webhook_event_id : null;
    const { data } = eventId
      ? await deps.admin.from("webhook_events").select("*").eq("id", eventId).maybeSingle()
      : { data: null };
    if (!data) return { result: { skip: "event_not_found" } };
    event = data;

    const eventPayload = (event.payload ?? {}) as Record<string, unknown>;
    const type = typeof eventPayload.type === "string" ? eventPayload.type : "";
    handlerKey = type;
    product = deps.products.find((p) => p.status === "available" && p.handledEvents.includes(type));
    if (!product) return { event, result: { skip: "unhandled_event_type" } };
  } else {
    const key = typeof payload.product_key === "string" ? payload.product_key : "";
    product = deps.products.find((p) => p.key === key && p.status === "available");
    if (!product) return { result: { skip: "unknown_product" } };
  }

  // Generic conditions every product shares.
  const { data: business } = await deps.admin.from("businesses").select("*").eq("id", action.business_id).maybeSingle();
  if (!business || business.status !== "active") return { event, result: { skip: "business_inactive" } };

  const { data: enablement } = await deps.admin
    .from("business_products")
    .select("enabled, config, product:products!inner(key)")
    .eq("business_id", business.id)
    .eq("product.key", product.key)
    .maybeSingle();
  if (!enablement || !enablement.enabled) return { event, result: { skip: "product_disabled" } };

  const { data: subscription } = await deps.admin
    .from("subscriptions")
    .select("status")
    .eq("business_id", business.id)
    .maybeSingle();
  if (!subscription || !["trial", "active"].includes(subscription.status)) {
    return { event, result: { skip: "subscription_blocked" } };
  }

  const handler = product.handlers[handlerKey];
  if (!handler) return { event, result: { skip: "no_handler" } };

  const config = product.configSchema.safeParse(enablement.config);
  if (!config.success) return { event, result: { fail: "invalid_config" } };

  await log.step({ step: "condition", status: "ok", reason: "conditions_passed", details: { product: product.key } });
  const result = await handler({
    admin: deps.admin,
    business: business as BusinessRow,
    config: config.data,
    action,
    event,
    services: deps.services,
    log,
    now: deps.now(),
  });
  return { event, result };
}

async function setEventStatus(
  deps: EngineDeps,
  event: WebhookEvent | undefined,
  status: "processed" | "skipped" | "failed",
): Promise<void> {
  if (!event) return;
  await deps.admin
    .from("webhook_events")
    .update({ status, processed_at: deps.now().toISOString(), business_id: event.business_id ?? undefined })
    .eq("id", event.id);
}

async function applyResult(
  deps: EngineDeps,
  action: ScheduledAction,
  event: WebhookEvent | undefined,
  result: HandlerResult,
  log: StepLogger,
): Promise<RunOutcome> {
  if (result === "done") {
    await completeAction(deps.admin, action.id);
    await setEventStatus(deps, event, "processed");
    await log.step({ step: "system", status: "ok", reason: "action_done" });
    return "done";
  }

  if ("skip" in result) {
    await cancelAction(deps.admin, action.id, result.skip);
    await setEventStatus(deps, event, "skipped");
    await log.step({ step: "condition", status: "skipped", reason: result.skip });
    return "skipped";
  }

  if ("fail" in result) {
    await failAction(deps.admin, action.id, result.fail);
    await setEventStatus(deps, event, "failed");
    await log.step({ step: "action", status: "error", reason: result.fail });
    return "failed";
  }

  return scheduleRetry(deps, action, event, result.retryAt, result.reason ?? "retry_requested", log);
}

async function scheduleRetry(
  deps: EngineDeps,
  action: ScheduledAction,
  event: WebhookEvent | undefined,
  retryAt: Date,
  reason: string,
  log: StepLogger,
): Promise<RunOutcome> {
  // `attempts` was already incremented when the action was claimed.
  if (action.attempts >= action.max_attempts) {
    await failAction(deps.admin, action.id, reason);
    await setEventStatus(deps, event, "failed");
    await log.step({ step: "action", status: "error", reason: "max_attempts_reached", details: { last: reason } });
    return "failed";
  }
  await retryActionAt(deps.admin, action.id, retryAt, reason);
  await log.step({
    step: "action",
    status: "error",
    reason: "retry_scheduled",
    details: { attempt: action.attempts, retryAt, last: reason },
  });
  return "retried";
}

async function applyError(
  deps: EngineDeps,
  action: ScheduledAction,
  event: WebhookEvent | undefined,
  error: unknown,
  log: StepLogger,
): Promise<RunOutcome> {
  const message = error instanceof Error ? error.message : "unknown error";
  const safeMessage = String(redact(message));

  try {
    if (error instanceof AdapterError && !error.retryable) {
      await failAction(deps.admin, action.id, `${error.code}: ${safeMessage}`);
      await setEventStatus(deps, event, "failed");
      await log.step({ step: "action", status: "error", reason: error.code, details: { message: safeMessage } });
      return "failed";
    }
    return await scheduleRetry(deps, action, event, nextRunAt(action.attempts, deps.now()), safeMessage, log);
  } catch (inner) {
    // The bookkeeping itself failed (for example the database is down). The stale-lock
    // recovery in claim_due_actions picks the action up again.
    console.error("runner bookkeeping failed:", inner instanceof Error ? inner.message : "unknown error");
    return "failed";
  }
}
