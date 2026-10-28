import { enqueueAction } from "./queue";
import { HANDLE_EVENT, type Admin } from "./types";

/**
 * A provider event after the route has verified and normalised it
 * (automation-engine.md section 2, security-privacy.md section 4).
 */
export interface NormalisedEvent {
  /** Idempotency key from the provider: CallSid, MessageSid, or MessageSid:status. */
  eventId: string;
  /** Platform event type the products declare in `handledEvents`, e.g. `call.missed`. */
  type: string;
  data: Record<string, unknown>;
  /** The business the event belongs to, when the route could resolve it. */
  businessId: string | null;
}

export type IngestResult =
  | { status: "accepted"; webhookEventId: string; actionId: string }
  | { status: "duplicate"; webhookEventId: string }
  | { status: "unresolved"; webhookEventId: string };

const UNIQUE_VIOLATION = "23505";

/**
 * Stores the event once and queues one `handle_event` action for it. Safe to call again for
 * the same provider event (provider retries): nothing is stored or queued twice.
 */
export async function ingestWebhookEvent(
  admin: Admin,
  provider: string,
  event: NormalisedEvent,
): Promise<IngestResult> {
  const { data, error } = await admin
    .from("webhook_events")
    .insert({
      provider,
      provider_event_id: event.eventId,
      business_id: event.businessId,
      payload: { type: event.type, data: event.data } as never,
    })
    .select("id")
    .single();

  if (error) {
    if (error.code !== UNIQUE_VIOLATION) throw new Error(`webhook_events insert failed: ${error.message}`);

    const { data: existing, error: lookupError } = await admin
      .from("webhook_events")
      .select("id, business_id, status")
      .eq("provider", provider)
      .eq("provider_event_id", event.eventId)
      .single();
    if (lookupError || !existing) throw new Error(`webhook_events lookup failed: ${lookupError?.message}`);

    // A crash between the insert and the enqueue would leave the event without work. The
    // dedupe key makes re-queueing a no-op when the action already exists.
    if (existing.business_id && existing.status === "received") {
      await enqueueAction(admin, {
        businessId: existing.business_id,
        type: HANDLE_EVENT,
        payload: { webhook_event_id: existing.id },
        dedupeKey: `evt:${existing.id}`,
      });
    }
    return { status: "duplicate", webhookEventId: existing.id };
  }

  if (!event.businessId) {
    await admin
      .from("webhook_events")
      .update({ status: "skipped", processed_at: new Date().toISOString() })
      .eq("id", data.id);
    return { status: "unresolved", webhookEventId: data.id };
  }

  const queued = await enqueueAction(admin, {
    businessId: event.businessId,
    type: HANDLE_EVENT,
    payload: { webhook_event_id: data.id },
    dedupeKey: `evt:${data.id}`,
  });
  return { status: "accepted", webhookEventId: data.id, actionId: queued.id };
}

/** The URL the provider signed: the public base (tunnel) plus the request's path and query. */
export function buildPublicUrl(publicBaseUrl: string, requestUrl: string): string {
  const incoming = new URL(requestUrl);
  return `${publicBaseUrl.replace(/\/+$/, "")}${incoming.pathname}${incoming.search}`;
}

/** Reads form-encoded or JSON bodies into a flat string map (Twilio sends form-encoded). */
export async function readWebhookParams(request: Request): Promise<Record<string, string>> {
  const type = request.headers.get("content-type") ?? "";
  if (type.includes("application/json")) {
    const body: unknown = await request.json().catch(() => ({}));
    const out: Record<string, string> = {};
    if (body && typeof body === "object") {
      for (const [k, v] of Object.entries(body)) out[k] = typeof v === "string" ? v : JSON.stringify(v);
    }
    return out;
  }
  const form = await request.formData().catch(() => null);
  const out: Record<string, string> = {};
  if (form) for (const [k, v] of form.entries()) if (typeof v === "string") out[k] = v;
  return out;
}

export interface WebhookProvider {
  /** Stored in webhook_events.provider. */
  name: string;
  /** Provider signature check. `url` is the public URL the provider signed. */
  verify(input: { url: string; params: Record<string, string>; signature: string | null }): boolean;
  /** Which header carries the signature. */
  signatureHeader: string;
  /** Turns verified params into an event; null means the payload is unusable. */
  parse(params: Record<string, string>, admin: Admin): Promise<NormalisedEvent | null> | NormalisedEvent | null;
  /** Body returned to the provider (for example TwiML). Defaults to JSON `{ ok: true }`. */
  respond?(result: IngestResult): Response;
}

export interface WebhookDeps {
  admin: Admin;
  publicBaseUrl: string;
  /** Runs a task after the response is sent (Next's `after`). Injected so tests can observe it. */
  schedule: (task: () => Promise<unknown>) => void;
  /** Processes due actions; called after a newly accepted event so replies are not delayed. */
  runWorker: () => Promise<unknown>;
}

/**
 * The shared shape of every webhook route: verify the signature, store the event idempotently,
 * queue the work, answer quickly. Real work happens in the worker, not here.
 */
export async function handleWebhook(
  request: Request,
  provider: WebhookProvider,
  deps: WebhookDeps,
): Promise<Response> {
  const params = await readWebhookParams(request);
  const url = buildPublicUrl(deps.publicBaseUrl, request.url);

  const valid = provider.verify({ url, params, signature: request.headers.get(provider.signatureHeader) });
  if (!valid) {
    // Nothing is stored for a forged request, and the payload is not logged.
    console.warn(JSON.stringify({ event: "webhook_rejected", provider: provider.name, reason: "invalid_signature" }));
    return Response.json({ error: "invalid_signature" }, { status: 403 });
  }

  const event = await provider.parse(params, deps.admin);
  if (!event) return Response.json({ error: "bad_request" }, { status: 400 });

  const result = await ingestWebhookEvent(deps.admin, provider.name, event);
  if (result.status === "unresolved") {
    console.warn(JSON.stringify({ event: "webhook_unresolved", provider: provider.name, type: event.type }));
  }
  if (result.status === "accepted") deps.schedule(deps.runWorker);

  return provider.respond ? provider.respond(result) : Response.json({ ok: true });
}
