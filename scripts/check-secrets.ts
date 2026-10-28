import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";

/** Patterns that look like real credentials (security-privacy.md section 2). */
const PATTERNS: { name: string; regex: RegExp }[] = [
  { name: "OpenAI key", regex: /\bsk-[A-Za-z0-9_-]{20,}/ },
  { name: "Twilio account SID", regex: /\bAC[0-9a-f]{32}\b/ },
  { name: "Supabase secret key", regex: /\bsb_secret_[A-Za-z0-9_-]{16,}/ },
  { name: "Private key block", regex: /-----BEGIN (?:RSA |EC |OPENSSH )?PRIVATE KEY-----/ },
  { name: "Google client secret", regex: /\bGOCSPX-[A-Za-z0-9_-]{20,}/ },
];

export function scanText(text: string): string[] {
  return PATTERNS.filter((p) => p.regex.test(text)).map((p) => p.name);
}

// Files that legitimately contain the patterns (this scanner and its tests).
const SKIP = [
  /^package-lock\.json$/,
  /^scripts\/check-secrets\.ts$/,
  /^tests\/unit\/check-secrets\.test\.ts$/,
  /^tests\/unit\/redact\.test\.ts$/, // feeds fake key-looking strings to the redactor
];

function listFiles(): string[] {
  const out = execFileSync("git", ["ls-files", "-co", "--exclude-standard"], { encoding: "utf8" });
  return out.split("\n").filter(Boolean);
}

function main(): void {
  const files = listFiles();
  const problems: string[] = [];

  if (files.some((f) => /(^|\/)\.env(\..+)?$/.test(f) && !f.endsWith(".env.example"))) {
    problems.push("An .env file other than .env.example is tracked or not ignored.");
  }

  for (const file of files) {
    if (SKIP.some((re) => re.test(file))) continue;
    let text: string;
    try {
      text = readFileSync(file, "utf8");
    } catch {
      continue; // deleted or binary
    }
    for (const hit of scanText(text)) problems.push(`${file}: looks like a ${hit}`);
  }

  if (problems.length > 0) {
    console.error("check:secrets failed:\n" + problems.map((p) => `  - ${p}`).join("\n"));
    process.exit(1);
  }
  console.log(`check:secrets ok (${files.length} files scanned)`);
}

if (process.argv[1] && /check-secrets\.ts$/.test(process.argv[1].replace(/\\/g, "/"))) main();
