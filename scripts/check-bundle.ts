import { existsSync, readdirSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";
import { config } from "dotenv";

/**
 * Fails if a secret's name or value appears in the browser bundle (security-privacy.md section 7).
 *   NEXT_DIST_DIR=.next-build npx next build
 *   npm run check:bundle -- .next-build
 * Only `static/` is scanned: that is what browsers download. Server chunks may hold secret names.
 */
export const SECRET_NAMES = [
  "SUPABASE_SERVICE_ROLE_KEY",
  "OPENAI_API_KEY",
  "RESEND_API_KEY",
  "TWILIO_AUTH_TOKEN",
  "GOOGLE_CLIENT_SECRET",
  "ENCRYPTION_KEY",
  "ENCRYPTION_KEY_PREVIOUS",
  "WORKER_SECRET",
];

export interface Leak {
  file: string;
  what: string;
}

/** Pure so it can be tested. `secrets` maps names to their real values (empty or short values are skipped). */
export function findLeaks(files: { path: string; text: string }[], secrets: Record<string, string | undefined>): Leak[] {
  const leaks: Leak[] = [];
  for (const file of files) {
    for (const name of SECRET_NAMES) {
      if (file.text.includes(name)) leaks.push({ file: file.path, what: `secret name ${name}` });
    }
    for (const [name, value] of Object.entries(secrets)) {
      if (value && value.length >= 8 && file.text.includes(value)) leaks.push({ file: file.path, what: `value of ${name}` });
    }
  }
  return leaks;
}

function walk(dir: string): string[] {
  return readdirSync(dir).flatMap((entry) => {
    const full = join(dir, entry);
    return statSync(full).isDirectory() ? walk(full) : [full];
  });
}

function main(): void {
  config({ path: ".env.local", quiet: true });
  const distDir = process.argv.slice(2).find((a) => !a.startsWith("-")) ?? ".next";
  const staticDir = join(distDir, "static");
  if (!existsSync(staticDir)) {
    console.error(`No build found at ${staticDir}. Build first: NEXT_DIST_DIR=${distDir} npx next build`);
    process.exit(2);
  }

  const files = walk(staticDir)
    .filter((p) => /\.(js|css|html|json|map|txt)$/.test(p))
    .map((path) => ({ path, text: readFileSync(path, "utf8") }));
  const secrets = Object.fromEntries(SECRET_NAMES.map((n) => [n, process.env[n]]));
  const leaks = findLeaks(files, secrets);

  if (leaks.length > 0) {
    for (const leak of leaks) console.error(`LEAK  ${leak.file}: ${leak.what}`);
    process.exit(1);
  }
  console.log(`check:bundle ok (${files.length} client files scanned in ${staticDir})`);
}

if (process.argv[1]?.includes("check-bundle")) main();
