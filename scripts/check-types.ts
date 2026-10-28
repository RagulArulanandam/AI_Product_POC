import { execSync } from "node:child_process";
import { readFileSync } from "node:fs";

/** Fails when src/lib/database.types.ts no longer matches the local database schema. */
function normalise(text: string): string {
  return text.replace(/\r\n/g, "\n").trim();
}

const generated = execSync("supabase gen types typescript --local", {
  encoding: "utf8",
  stdio: ["ignore", "pipe", "ignore"],
});
const committed = readFileSync("src/lib/database.types.ts", "utf8");

if (normalise(generated) !== normalise(committed)) {
  console.error("check:types failed: src/lib/database.types.ts is stale. Run `npm run db:types` and commit it.");
  process.exit(1);
}
console.log("check:types ok");
