import type { MessagingAdapter } from "@/adapters/messaging/interface";
import type { HandlerContext } from "@/engine/types";
import { AppError } from "@/lib/errors";
import type { MissedCallConfig } from "../config";
import { isOpenAt, parseHours } from "../hours";

export const PRODUCT_KEY = "missed-call";

/** Customers who do not reply within this long are marked expired (also the WhatsApp window). */
export const CONVERSATION_WINDOW_HOURS = 24;
/** A second missed call from the same number inside this window joins the first conversation. */
export const DEDUPE_WINDOW_MINUTES = 30;

export const OPEN_STATES = ["pending_send", "awaiting_reply", "in_conversation", "offering_slots"] as const;
/** States where a customer may still reply, so the expiry clock applies. */
export const REPLYABLE_STATES = ["awaiting_reply", "in_conversation", "offering_slots"] as const;

export function configOf(ctx: HandlerContext): MissedCallConfig {
  return ctx.config as MissedCallConfig;
}

export function requireMessaging(ctx: HandlerContext): MessagingAdapter {
  if (!ctx.services.messaging) throw new AppError("messaging_unavailable", "No messaging adapter is configured", 500);
  return ctx.services.messaging();
}

/** Whether the business is open now, using the product's own hours or else the business profile's. */
export function isOpenNow(ctx: HandlerContext): boolean {
  const hours = parseHours(configOf(ctx).business_hours ?? ctx.business.business_hours);
  return isOpenAt(hours, ctx.business.timezone, ctx.now);
}

export async function productId(ctx: HandlerContext): Promise<string> {
  const { data, error } = await ctx.admin.from("products").select("id").eq("key", PRODUCT_KEY).single();
  if (error || !data) throw new AppError("product_missing", `Product ${PRODUCT_KEY} is not seeded`, 500);
  return data.id;
}

export function eventData(ctx: HandlerContext): Record<string, unknown> {
  const payload = (ctx.event?.payload ?? {}) as { data?: Record<string, unknown> };
  return payload.data ?? {};
}
