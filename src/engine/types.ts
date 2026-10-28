import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "@/lib/database.types";
import type { EmailAdapter } from "@/adapters/email/interface";
import type { LlmAdapter } from "@/adapters/llm/interface";
import type { MessagingAdapter } from "@/adapters/messaging/interface";
import type { StepLogger } from "./log";

export type Admin = SupabaseClient<Database>;
export type ScheduledAction = Database["public"]["Tables"]["scheduled_actions"]["Row"];
export type WebhookEvent = Database["public"]["Tables"]["webhook_events"]["Row"];
export type BusinessRow = Database["public"]["Tables"]["businesses"]["Row"];

/** What a product handler returns (automation-engine.md section 3). */
export type HandlerResult =
  | "done"
  | { skip: string }
  | { fail: string }
  | { retryAt: Date; reason?: string };

export interface HandlerContext {
  admin: Admin;
  business: BusinessRow;
  /** Already validated by the product's Zod schema, defaults applied. */
  config: unknown;
  action: ScheduledAction;
  event?: WebhookEvent;
  /** Injected adapters and services, so tests can pass fakes. Filled in from Phase 3. */
  services: Services;
  log: StepLogger;
  /** Injected clock: handlers never call Date.now() themselves. */
  now: Date;
}

export type ProductHandler = (ctx: HandlerContext) => Promise<HandlerResult>;

/**
 * Handlers are keyed by the event type (for example `call.missed`) or the action type
 * (for example `send_first_message`) they process.
 */
export type ProductHandlers = Record<string, ProductHandler>;

/**
 * Adapters handlers may use. Lazy factories, so a missing vendor key only breaks the actions
 * that actually need that vendor. Tests pass fakes.
 */
export interface Services {
  messaging?: () => MessagingAdapter;
  llm?: () => LlmAdapter;
  email?: () => EmailAdapter;
}

export const HANDLE_EVENT = "handle_event";
