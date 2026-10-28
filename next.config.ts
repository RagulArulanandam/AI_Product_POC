import type { NextConfig } from "next";

const nextConfig: NextConfig = {
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
