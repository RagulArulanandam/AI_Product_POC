import type { Json } from "@/lib/database.types";
import { redact } from "@/lib/redact";
import type { Admin } from "./types";

export type LogStep = "event" | "condition" | "ai" | "action" | "system";
export type LogStatus = "ok" | "skipped" | "error";

export interface LogEntry {
  businessId: string;
  conversationId?: string | null;
  actionId?: string | null;
  eventType: string;
  step: LogStep;
  status: LogStatus;
  reason?: string;
  details?: unknown;
}

/**
 * Writes one automation_logs row. Details are redacted first. Never throws: a failed log
 * write goes to the console and must not fail the action (automation-engine.md section 8).
 */
export async function logStep(admin: Admin, entry: LogEntry): Promise<void> {
  try {
    const { error } = await admin.from("automation_logs").insert({
      business_id: entry.businessId,
      conversation_id: entry.conversationId ?? null,
      scheduled_action_id: entry.actionId ?? null,
      event_type: entry.eventType,
      step: entry.step,
      status: entry.status,
      reason: entry.reason ?? null,
      details: (redact(entry.details ?? {}) ?? {}) as Record<string, Json | undefined>,
    });
    if (error) console.error("automation log write failed:", error.message);
  } catch (error) {
    console.error("automation log write threw:", error instanceof Error ? error.message : "unknown error");
  }
}

export interface StepLogger {
  step(entry: { step: LogStep; status: LogStatus; reason?: string; details?: unknown }): Promise<void>;
}

/** A logger bound to one business, conversation, action and event type. */
export function createStepLogger(
  admin: Admin,
  base: { businessId: string; conversationId?: string | null; actionId?: string | null; eventType: string },
): StepLogger {
  return { step: (entry) => logStep(admin, { ...base, ...entry }) };
}
