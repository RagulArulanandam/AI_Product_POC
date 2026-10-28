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
