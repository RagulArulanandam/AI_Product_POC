import type { NextConfig } from "next";

const nextConfig: NextConfig = {
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
