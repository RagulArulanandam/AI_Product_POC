import { readdirSync, readFileSync, statSync } from "node:fs";
import path from "node:path";
import { describe, expect, it, vi } from "vitest";

// These walk the whole source tree, which can take longer than the default 5 seconds when the full suite is busy.
vi.setConfig({ testTimeout: 30_000 });

// security-privacy.md section 9: customer messages leave through one choke point, so opt-out,
// send caps and the 24 hour window cannot be bypassed.
const ALLOWED = ["src/engine/send.ts", "src/adapters/"];

function walk(dir: string): string[] {
  return readdirSync(dir).flatMap((name) => {
    const full = path.join(dir, name);
    return statSync(full).isDirectory() ? walk(full) : [full];
  });
}

describe("customer message sending", () => {
  it("only happens in the send gate (sendToCustomer)", () => {
    const offenders = walk("src")
      .map((f) => f.split(path.sep).join("/"))
      .filter((f) => /\.(ts|tsx)$/.test(f))
      .filter((f) => /\.sendMessage\s*\(/.test(readFileSync(f, "utf8")))
      .filter((f) => !ALLOWED.some((allowed) => f === allowed || f.startsWith(allowed)));
    expect(offenders).toEqual([]);
  });
});
