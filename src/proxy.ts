import { NextResponse, type NextRequest } from "next/server";
import { decideRoute } from "@/lib/auth/route-rules";
import { updateSession } from "@/lib/supabase/session";

export async function proxy(request: NextRequest) {
  const { response, user } = await updateSession(request);
  const decision = decideRoute(
    { pathname: request.nextUrl.pathname, search: request.nextUrl.search },
    user !== null,
  );

  if (decision.action === "redirect") {
    const redirect = NextResponse.redirect(new URL(decision.to, request.url));
    // Keep any refreshed auth cookies on the redirect.
    for (const cookie of response.cookies.getAll()) redirect.cookies.set(cookie);
    return redirect;
  }
  return response;
}

export const config = {
  matcher: ["/((?!_next/static|_next/image|favicon.ico|.*\\.(?:svg|png|jpg|jpeg|gif|webp|ico)$).*)"],
};
