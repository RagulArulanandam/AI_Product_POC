import { enqueueAction } from "@/engine/queue";
import type { ProductHandler } from "@/engine/types";
import {
  DEDUPE_WINDOW_MINUTES,
  PRODUCT_KEY,
  configOf,
  eventData,
  isOpenNow,
  productId,
} from "./shared";

const UNIQUE_VIOLATION = "23505";

/**
 * A call arrived on the business's forwarding number, so it was missed (product-missed-call.md,
 * "Conditions before the first message"). Checks the conditions, opens a conversation and
 * schedules the first WhatsApp message after the configured delay.
 */
export const callMissed: ProductHandler = async (ctx) => {
  const { admin, business, event, now } = ctx;
  const config = configOf(ctx);
  const data = eventData(ctx);

  const from = typeof data.from === "string" ? data.from : null;
  if (!from) return { skip: "no_caller_id" };

  // A retry of this same call may already have created its conversation: carry on from there.
  const callSid = event?.provider_event_id ?? null;
  let conversationId: string | null = null;
  if (callSid) {
    const { data: existing } = await admin
      .from("conversations")
      .select("id")
      .eq("business_id", business.id)
      .eq("trigger_call_sid", callSid)
      .maybeSingle();
    conversationId = existing?.id ?? null;
  }

  if (!conversationId) {
    // Opt-out is platform-wide: any business's STOP counts.
    const { data: optOut } = await admin.from("opt_outs").select("id").eq("phone_e164", from).maybeSingle();
    if (optOut) return { skip: "opted_out" };

    const { data: customer, error: customerError } = await admin
      .from("customers")
      .upsert({ business_id: business.id, phone_e164: from }, { onConflict: "business_id,phone_e164" })
      .select("id")
      .single();
    if (customerError || !customer) throw new Error(`customer upsert failed: ${customerError?.message}`);

    // Only the dev simulate endpoint may bypass the dedupe window (for repeat demos).
    const bypassDedupe = event?.provider === "simulated" && data.skip_dedupe === true;
    if (!bypassDedupe) {
      const cutoff = new Date(now.getTime() - DEDUPE_WINDOW_MINUTES * 60_000).toISOString();
      const { count } = await admin
        .from("conversations")
        .select("*", { count: "exact", head: true })
        .eq("customer_id", customer.id)
        .gte("started_at", cutoff);
      if ((count ?? 0) > 0) return { skip: "duplicate_in_window" };
    }

    if (!isOpenNow(ctx) && !config.send_outside_hours) return { skip: "outside_hours_disabled" };

    const { data: created, error } = await admin
      .from("conversations")
      .insert({
        business_id: business.id,
        customer_id: customer.id,
        product_id: await productId(ctx),
        state: "pending_send",
        trigger_call_sid: callSid,
        started_at: now.toISOString(),
      })
      .select("id")
      .single();

    if (error?.code === UNIQUE_VIOLATION && callSid) {
      const { data: raced } = await admin
        .from("conversations")
        .select("id")
        .eq("business_id", business.id)
        .eq("trigger_call_sid", callSid)
        .single();
      conversationId = raced?.id ?? null;
    } else if (error || !created) {
      throw new Error(`conversation insert failed: ${error?.message}`);
    } else {
      conversationId = created.id;
    }
  }
  if (!conversationId) throw new Error("conversation could not be created");

  const runAt = new Date(now.getTime() + config.delay_minutes * 60_000);
  const queued = await enqueueAction(admin, {
    businessId: business.id,
    conversationId,
    type: "send_first_message",
    productKey: PRODUCT_KEY,
    runAt,
    dedupeKey: `first:${conversationId}`,
  });

  await ctx.log.step({
    step: "action",
    status: "ok",
    reason: "first_message_scheduled",
    details: { conversationId, runAt, delayMinutes: config.delay_minutes, alreadyScheduled: !queued.created },
  });
  return "done";
};
