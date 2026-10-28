import OpenAI from "openai";
import { z } from "zod";
import { AdapterError } from "@/lib/errors";
import type { LlmAdapter, LlmMessage, LlmUsage } from "./interface";

export interface OpenAiConfig {
  apiKey: string;
  /** From OPENAI_MODEL, never hard-coded. */
  model: string;
  timeoutMs?: number;
  maxOutputTokens?: number;
}

/** The slice of the OpenAI client we use, so tests can pass a stub. */
export interface OpenAiLikeClient {
  chat: {
    completions: {
      create(
        body: {
          model: string;
          messages: { role: "system" | "user" | "assistant"; content: string }[];
          response_format: {
            type: "json_schema";
            json_schema: { name: string; strict: true; schema: Record<string, unknown> };
          };
          temperature: number;
          max_tokens: number;
        },
        options: { timeout: number },
      ): Promise<{
        choices: { message: { content: string | null; refusal?: string | null }; finish_reason?: string | null }[];
        usage?: { prompt_tokens?: number; completion_tokens?: number } | null;
      }>;
    };
  };
}

/** Maps OpenAI failures to AdapterError. No prompt text is ever put in a message. */
export function mapOpenAiError(error: unknown): AdapterError {
  const e = (error ?? {}) as { status?: number; code?: string; message?: string };
  const message = e.message ?? "OpenAI request failed";

  if (e.code === "insufficient_quota") {
    return new AdapterError("auth", "OpenAI quota exhausted or billing not set up", { cause: error });
  }
  if (e.status === 401 || e.status === 403) return new AdapterError("auth", message, { cause: error });
  if (e.status === 429) return new AdapterError("rate_limited", message, { cause: error });
  if (e.status === 404) return new AdapterError("not_found", message, { cause: error });
  if (typeof e.status === "number" && e.status >= 400 && e.status < 500) {
    return new AdapterError("invalid_request", message, { cause: error });
  }
  // 5xx, timeouts and network failures have no useful status: worth retrying.
  return new AdapterError("provider_unavailable", message, { cause: error });
}

export class OpenAiLlmAdapter implements LlmAdapter {
  constructor(
    private readonly config: OpenAiConfig,
    private readonly client: OpenAiLikeClient = new OpenAI({ apiKey: config.apiKey }) as unknown as OpenAiLikeClient,
  ) {}

  async completeJson<T>(input: {
    system: string;
    messages: LlmMessage[];
    schema: z.ZodType<T>;
    schemaName: string;
  }): Promise<{ data: T; usage: LlmUsage }> {
    // The model is given the schema (structured outputs); we still validate what comes back.
    const jsonSchema = z.toJSONSchema(input.schema) as Record<string, unknown>;
    delete jsonSchema.$schema;

    let response;
    try {
      response = await this.client.chat.completions.create(
        {
          model: this.config.model,
          messages: [{ role: "system", content: input.system }, ...input.messages],
          response_format: { type: "json_schema", json_schema: { name: input.schemaName, strict: true, schema: jsonSchema } },
          temperature: 0.2,
          max_tokens: this.config.maxOutputTokens ?? 700,
        },
        { timeout: this.config.timeoutMs ?? 20_000 },
      );
    } catch (error) {
      throw mapOpenAiError(error);
    }

    const choice = response.choices[0];
    if (!choice) throw new AdapterError("invalid_output", "The model returned no answer");
    if (choice.message.refusal) throw new AdapterError("invalid_output", "The model refused to answer");
    if (choice.finish_reason === "length") throw new AdapterError("invalid_output", "The model's answer was cut off");
    if (!choice.message.content) throw new AdapterError("invalid_output", "The model's answer was empty");

    let raw: unknown;
    try {
      raw = JSON.parse(choice.message.content);
    } catch {
      throw new AdapterError("invalid_output", "The model's answer was not valid JSON");
    }

    const parsed = input.schema.safeParse(raw);
    if (!parsed.success) {
      // Field paths only: the model's text may contain customer details.
      const paths = parsed.error.issues.map((i) => i.path.join(".") || "(root)").join(", ");
      throw new AdapterError("invalid_output", `The model's answer did not match the schema (${paths})`);
    }

    return {
      data: parsed.data,
      usage: {
        inputTokens: response.usage?.prompt_tokens ?? 0,
        outputTokens: response.usage?.completion_tokens ?? 0,
      },
    };
  }
}
