import { z } from "zod";
import { guardDevEndpoint } from "@/engine/dev-guard";
import { createWebhookDeps } from "@/engine/webhook-deps";
import { ingestWebhookEvent } from "@/engine/webhooks";

const bodySchema = z.object({
  businessId: z.uuid(),
  /** The caller, in E.164. For a real WhatsApp test this is a phone that has joined the sandbox. */
  from: z.string().regex(/^\+[1-9]\d{6,14}$/, "from must be an E.164 number"),
  /** Repeat demos from one phone are allowed unless this is explicitly false. */
  skipDedupe: z.boolean().default(true),
});

/**
 * Dev only: behaves exactly like the voice webhook after signature checking, so the whole
 * Product 1 flow can be tried without a forwarded call. Disabled unless ENABLE_DEV_ENDPOINTS
 * is true and the build is not production, and always needs the worker secret.
 */
export async function POST(request: Request): Promise<Response> {
  const refused = guardDevEndpoint(request);
  if (refused) return refused;

  const parsed = bodySchema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) {
    return Response.json({ error: "bad_request", issues: parsed.error.issues.map((i) => i.message) }, { status: 400 });
  }
  const { businessId, from, skipDedupe } = parsed.data;

  const deps = createWebhookDeps();
  const { data: business } = await deps.admin.from("businesses").select("id, status").eq("id", businessId).maybeSingle();
  if (!business) return Response.json({ error: "business_not_found" }, { status: 404 });

  const { data: number } = await deps.admin.from("phone_numbers").select("e164").eq("business_id", businessId).limit(1).maybeSingle();

  const result = await ingestWebhookEvent(deps.admin, "simulated", {
    eventId: `sim-${crypto.randomUUID()}`,
    type: "call.missed",
    data: { from, to: number?.e164 ?? null, simulated: true, ...(skipDedupe ? { skip_dedupe: true } : {}) },
    businessId,
  });
  if (result.status === "accepted") deps.schedule(deps.runWorker);

  return Response.json({ ok: true, ...result });
}
