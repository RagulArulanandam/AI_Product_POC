import { getDevEndpointsEnabled, getWorkerSecret } from "@/lib/env";
import { isAuthorized } from "./worker-auth";

/**
 * Shared access control for dev-only endpoints. Returns a response to send back when the request
 * must be refused, or null when it may proceed. A 404 (not 401) when dev endpoints are off, so
 * their existence is not revealed.
 */
export function guardDevEndpoint(request: Request): Response | null {
  if (!getDevEndpointsEnabled()) return new Response("Not found", { status: 404 });

  let secret: string;
  try {
    secret = getWorkerSecret();
  } catch {
    return Response.json({ error: "worker_not_configured" }, { status: 500 });
  }
  if (!isAuthorized(request.headers.get("authorization"), secret)) {
    return Response.json({ error: "unauthorized" }, { status: 401 });
  }
  return null;
}
