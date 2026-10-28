import path from "node:path";
import { defineConfig } from "vitest/config";

const root = import.meta.dirname;

export default defineConfig({
  oxc: { jsx: { runtime: "automatic" } },
  resolve: {
    tsconfigPaths: true,
    alias: {
      // `server-only` throws outside React Server Components; tests run in plain Node.
      "server-only": path.join(root, "tests/helpers/empty.ts"),
    },
  },
  test: {
    projects: [
      {
        extends: true,
        test: {
          name: "unit",
          environment: "node",
          include: ["tests/unit/**/*.test.{ts,tsx}"],
          setupFiles: ["tests/helpers/setup-dom.ts"],
        },
      },
      {
        extends: true,
        test: {
          name: "db",
          environment: "node",
          include: ["tests/db/**/*.test.ts", "tests/integration/**/*.test.ts"],
          setupFiles: ["tests/helpers/load-env.ts"],
          globalSetup: ["tests/helpers/cron-pause.ts"],
          fileParallelism: false,
          testTimeout: 30_000,
          hookTimeout: 60_000,
        },
      },
    ],
  },
});
