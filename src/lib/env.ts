import { z } from "zod";

/**
 * The only place that reads process.env (architecture.md section 7).
 * Groups are validated lazily so earlier phases run without later keys.
 * NEXT_PUBLIC_* values must be referenced literally so Next can inline them.
 */

const publicSchema = z.object({
  NEXT_PUBLIC_SUPABASE_URL: z.string().url(),
  NEXT_PUBLIC_SUPABASE_ANON_KEY: z.string().min(1),
});

const supabaseServerSchema = z.object({
  SUPABASE_SERVICE_ROLE_KEY: z.string().min(1),
});

const appSchema = z.object({
  APP_BASE_URL: z.string().url().default("http://localhost:3000"),
});

const workerSchema = z.object({
  WORKER_SECRET: z.string().min(16, "WORKER_SECRET must be at least 16 characters"),
});

export type PublicEnv = z.infer<typeof publicSchema>;
export type ServerEnv = z.infer<typeof supabaseServerSchema> & z.infer<typeof appSchema>;

export function getPublicEnv(): PublicEnv {
  return publicSchema.parse({
    NEXT_PUBLIC_SUPABASE_URL: process.env.NEXT_PUBLIC_SUPABASE_URL,
    NEXT_PUBLIC_SUPABASE_ANON_KEY: process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY,
  });
}

/** Server-only values. Never call from client components. */
export function getServerEnv(): ServerEnv {
  return {
    ...supabaseServerSchema.parse({
      SUPABASE_SERVICE_ROLE_KEY: process.env.SUPABASE_SERVICE_ROLE_KEY,
    }),
    ...appSchema.parse({ APP_BASE_URL: process.env.APP_BASE_URL || undefined }),
  };
}

/** Shared secret that protects /api/worker (and the dev endpoints). Server-only. */
export function getWorkerSecret(): string {
  return workerSchema.parse({ WORKER_SECRET: process.env.WORKER_SECRET }).WORKER_SECRET;
}

/** Public tunnel URL that providers call. Signatures are checked against it, never the Host header. */
export function getPublicBaseUrl(): string {
  return z.object({ PUBLIC_BASE_URL: z.string().url() }).parse({ PUBLIC_BASE_URL: process.env.PUBLIC_BASE_URL })
    .PUBLIC_BASE_URL;
}

/** `fake` makes adapters return in-memory fakes (no vendor calls). Tests always use fakes. */
export function getAdapterMode(): "real" | "fake" {
  return z.enum(["real", "fake"]).default("real").parse(process.env.ADAPTER_MODE || undefined);
}

const twilioSchema = z.object({
  TWILIO_ACCOUNT_SID: z.string().regex(/^AC[0-9a-f]{32}$/, "TWILIO_ACCOUNT_SID looks wrong"),
  TWILIO_AUTH_TOKEN: z.string().min(16),
  TWILIO_WHATSAPP_FROM: z.string().regex(/^whatsapp:\+[1-9]\d{6,14}$/, "Use the form whatsapp:+447..."),
  TWILIO_VOICE_NUMBER: z.string().regex(/^\+[1-9]\d{6,14}$/, "Use E.164, e.g. +447..."),
  /** Trial accounts only: the pre-approved template to send instead of free text. */
  TWILIO_TRIAL_CONTENT_SID: z
    .string()
    .regex(/^HX[0-9a-f]{32}$/, "TWILIO_TRIAL_CONTENT_SID looks wrong")
    .optional(),
});

/** Twilio credentials and numbers. Only needed when the messaging adapter runs in `real` mode. */
export function getTwilioEnv() {
  return twilioSchema.parse({
    TWILIO_ACCOUNT_SID: process.env.TWILIO_ACCOUNT_SID,
    TWILIO_AUTH_TOKEN: process.env.TWILIO_AUTH_TOKEN,
    TWILIO_WHATSAPP_FROM: process.env.TWILIO_WHATSAPP_FROM,
    TWILIO_VOICE_NUMBER: process.env.TWILIO_VOICE_NUMBER,
    TWILIO_TRIAL_CONTENT_SID: process.env.TWILIO_TRIAL_CONTENT_SID || undefined,
  });
}

/** Dev-only endpoints (such as simulate-missed-call) need the flag and a non-production build. */
export function getDevEndpointsEnabled(): boolean {
  return process.env.ENABLE_DEV_ENDPOINTS === "true" && process.env.NODE_ENV !== "production";
}
