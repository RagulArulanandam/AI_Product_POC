import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import type { NextRequest } from "next/server";
import { requireBusiness } from "@/lib/auth/guards";
import { can } from "@/lib/auth/permissions";
import { getGoogleEnv } from "@/lib/env";
import { OAUTH_STATE_COOKIE, verifyOAuthState } from "@/lib/oauth-state";
import { connectGoogleCalendar } from "@/services/calendar-connection";

/** Where Google sends the owner back. Nothing is saved unless the state matches. */
export async function GET(request: NextRequest) {
  const { business, role } = await requireBusiness();
  if (!can(role, "integration.manage")) redirect("/integrations?calendar=forbidden");

  const jar = await cookies();
  const cookie = jar.get(OAUTH_STATE_COOKIE)?.value;
  jar.delete({ name: OAUTH_STATE_COOKIE, path: "/api/integrations/google" });

  const params = request.nextUrl.searchParams;
  if (!verifyOAuthState(cookie, params.get("state"), business.id)) redirect("/integrations?calendar=failed");
  if (params.get("error")) redirect("/integrations?calendar=denied");

  const code = params.get("code");
  if (!code) redirect("/integrations?calendar=failed");

  const env = getGoogleEnv();
  const result = await connectGoogleCalendar(
    { clientId: env.GOOGLE_CLIENT_ID, clientSecret: env.GOOGLE_CLIENT_SECRET, redirectUri: env.GOOGLE_REDIRECT_URI },
    business.id,
    code,
    new Date(),
  );
  redirect(result.ok ? "/integrations?calendar=connected" : `/integrations?calendar=${result.reason}`);
}
