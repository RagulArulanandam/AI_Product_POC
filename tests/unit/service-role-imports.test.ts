import { readdirSync, readFileSync, statSync } from "node:fs";
import path from "node:path";
import { describe, expect, it, vi } from "vitest";

// These walk the whole source tree, which can take longer than the default 5 seconds when the full suite is busy.
vi.setConfig({ testTimeout: 30_000 });

// architecture.md section 6 / security-privacy.md section 5: the service-role client may only
// be imported from these places.
const ALLOWED = [
  "src/engine/",
  "src/app/api/webhooks/",
  "src/app/api/worker/",
  "src/app/api/dev/",
  "src/app/admin/",
  "src/lib/auth/guards.ts",
  "src/lib/supabase/admin.ts",
  "src/services/admin.ts",
  "src/services/calendar-connection.ts",
];

function walk(dir: string): string[] {
  return readdirSync(dir).flatMap((name) => {
    const full = path.join(dir, name);
    return statSync(full).isDirectory() ? walk(full) : [full];
  });
}

function sourceFiles(): string[] {
  return walk("src")
    .map((f) => f.split(path.sep).join("/"))
    .filter((f) => /\.(ts|tsx)$/.test(f));
}

describe("service-role client imports", () => {
  it("are limited to the allowlisted folders", () => {
    const offenders = sourceFiles()
      .filter((f) => /from\s+["']@\/lib\/supabase\/admin["']/.test(readFileSync(f, "utf8")))
      .filter((f) => !ALLOWED.some((allowed) => f === allowed || f.startsWith(allowed)));
    expect(offenders).toEqual([]);
  });

  it("never appears in client components", () => {
    const offenders = sourceFiles().filter((f) => {
      const text = readFileSync(f, "utf8");
      return /^\s*["']use client["']/.test(text) && /supabase\/admin|SUPABASE_SERVICE_ROLE_KEY/.test(text);
    });
    expect(offenders).toEqual([]);
  });
});
