import { config } from "dotenv";

// Local Supabase keys and URLs for DB tests. Real values live in the gitignored .env.local.
config({ path: ".env.local", quiet: true });
