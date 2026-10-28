export type RouteDecision = { action: "next" } | { action: "redirect"; to: string };

const AUTH_PAGES = ["/login", "/signup"];
const PROTECTED_PREFIXES = [
  "/dashboard",
  "/products",
  "/integrations",
  "/conversations",
  "/billing",
  "/settings",
  "/onboarding",
  "/disabled",
  "/admin",
];

function isProtected(pathname: string): boolean {
  return PROTECTED_PREFIXES.some((p) => pathname === p || pathname.startsWith(`${p}/`));
}

/**
 * Authentication-only routing used by proxy.ts (auth.md section 4). Authorisation
 * (membership, admin, disabled business) is checked by the server guards, not here.
 */
export function decideRoute(
  request: { pathname: string; search?: string },
  isAuthenticated: boolean,
): RouteDecision {
  const { pathname, search = "" } = request;

  // API routes authenticate themselves (webhook signatures, worker secret, dev flags).
  if (pathname === "/api" || pathname.startsWith("/api/")) return { action: "next" };

  if (pathname === "/") {
    return { action: "redirect", to: isAuthenticated ? "/dashboard" : "/login" };
  }

  if (!isAuthenticated && isProtected(pathname)) {
    return { action: "redirect", to: `/login?next=${encodeURIComponent(pathname + search)}` };
  }

  if (isAuthenticated && AUTH_PAGES.includes(pathname)) {
    return { action: "redirect", to: "/dashboard" };
  }

  return { action: "next" };
}
