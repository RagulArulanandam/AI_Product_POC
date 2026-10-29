import type { NextConfig } from "next";

/** Headers every response carries (security-privacy.md section 7). No CSP yet: the POC has not mapped every script source. */
export const SECURITY_HEADERS = [
  { key: "X-Content-Type-Options", value: "nosniff" },
  { key: "X-Frame-Options", value: "DENY" },
  { key: "Referrer-Policy", value: "strict-origin-when-cross-origin" },
  { key: "Permissions-Policy", value: "camera=(), microphone=(), geolocation=()" },
  { key: "Strict-Transport-Security", value: "max-age=63072000; includeSubDomains" },
];

const nextConfig: NextConfig = {
  async headers() {
    return [{ source: "/:path*", headers: SECURITY_HEADERS }];
  },
  // Lets a production build go to its own folder (NEXT_DIST_DIR=.next-build) without disturbing `next dev`.
  distDir: process.env.NEXT_DIST_DIR || ".next",
  // Cache Components is off: every page here is per-user and dynamic, so the default
  // request-time rendering is simpler than wrapping each page in Suspense.
  turbopack: {
    rules: {
      "*.css": {
        loaders: ["@tailwindcss/turbopack"],
        as: "*.css",
      },
    },
  },
};

export default nextConfig;
