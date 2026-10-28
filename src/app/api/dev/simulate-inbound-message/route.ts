import { z } from "zod";
import { guardDevEndpoint } from "@/engine/dev-guard";
import { resolveOpenConversation } from "@/engine/providers/twilio";
import { createWebhookDeps } from "@/engine/webhook-deps";
import { ingestWebhookEvent } from "@/engine/webhooks";

const bodySchema = z.object({
  /** The customer's number, as it would arrive from WhatsApp. */
  from: z.string().regex(/^\+[1-9]\d{6,14}$/, "from must be an E.164 number"),
  body: z.string().min(1).max(1000),
});

/**
 * Dev only: a customer's WhatsApp message, as the real inbound webhook would deliver it after
 * signature checking. Lets the AI conversation be tried without Twilio. Same guards as the other
 * dev endpoints. The number must have an open conversation (start one with simulate-missed-call).
 */
export async function POST(request: Request): Promise<Response> {
  const refused = guardDevEndpoint(request);
  if (refused) return refused;

  const parsed = bodySchema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) {
    return Response.json({ error: "bad_request", issues: parsed.error.issues.map((i) => i.message) }, { status: 400 });
  }
  const { from, body } = parsed.data;

  const deps = createWebhookDeps();
  const open = await resolveOpenConversation(deps.admin, from);
  if (!open) return Response.json({ error: "no_open_conversation" }, { status: 404 });

  const result = await ingestWebhookEvent(deps.admin, "simulated", {
    eventId: `sim-in-${crypto.randomUUID()}`,
    type: "message.inbound",
    data: { from, body, hasMedia: false, simulated: true },
    businessId: open.businessId,
    conversationId: open.conversationId,
  });
  if (result.status === "accepted") deps.schedule(deps.runWorker);

  return Response.json({ ok: true, conversationId: open.conversationId, ...result });
}
