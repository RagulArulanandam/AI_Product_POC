import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import { buildAuthUrl } from "@/adapters/calendar/google-oauth";
import { requireBusiness } from "@/lib/auth/guards";
import { can } from "@/lib/auth/permissions";
import { getAdapterMode, getGoogleEnv, isGoogleConfigured } from "@/lib/env";
import { createOAuthState, OAUTH_STATE_COOKIE, OAUTH_STATE_MAX_AGE_SECONDS } from "@/lib/oauth-state";
import { connectDemoCalendar } from "@/services/calendar-connection";

/** Starts connecting Google Calendar: remembers a one-time state, then sends the owner to Google. */
export async function GET() {
  const { business, role } = await requireBusiness();
  if (!can(role, "integration.manage")) redirect("/integrations?calendar=forbidden");
  if (!isGoogleConfigured()) redirect("/integrations?calendar=not_configured");

  if (getAdapterMode("calendar") === "fake") {
    await connectDemoCalendar(business.id, new Date());
    redirect("/integrations?calendar=connected");
  }

  const { nonce, cookie } = createOAuthState(business.id);
  (await cookies()).set(OAUTH_STATE_COOKIE, cookie, {
    httpOnly: true,
    sameSite: "lax",
    secure: process.env.NODE_ENV === "production",
    path: "/api/integrations/google",
    maxAge: OAUTH_STATE_MAX_AGE_SECONDS,
  });

  const env = getGoogleEnv();
  redirect(buildAuthUrl({ clientId: env.GOOGLE_CLIENT_ID, clientSecret: env.GOOGLE_CLIENT_SECRET, redirectUri: env.GOOGLE_REDIRECT_URI }, nonce));
}
