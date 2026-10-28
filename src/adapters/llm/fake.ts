import type { ZodType } from "zod";
import { AdapterError } from "@/lib/errors";
import type { LlmAdapter, LlmMessage, LlmUsage } from "./interface";

export interface LlmCall {
  system: string;
  messages: LlmMessage[];
  schemaName: string;
}

/**
 * Scripted model for tests and `LLM_ADAPTER=fake`. Queue answers (or errors) in order; each call
 * takes the next one and validates it against the requested schema, so a scripted answer that
 * does not fit behaves like a bad model answer (`invalid_output`).
 */
export class FakeLlmAdapter implements LlmAdapter {
  calls: LlmCall[] = [];
  private queue: unknown[] = [];

  /** Queues answers. An Error instance is thrown instead of returned. */
  enqueue(...items: unknown[]): void {
    this.queue.push(...items);
  }

  reset(): void {
    this.calls = [];
    this.queue = [];
  }

  async completeJson<T>(input: {
    system: string;
    messages: LlmMessage[];
    schema: ZodType<T>;
    schemaName: string;
  }): Promise<{ data: T; usage: LlmUsage }> {
    this.calls.push({ system: input.system, messages: input.messages, schemaName: input.schemaName });

    if (this.queue.length === 0) throw new AdapterError("unknown", "FakeLlmAdapter has no scripted answer");
    const item = this.queue.shift();
    if (item instanceof Error) throw item;

    const parsed = input.schema.safeParse(item);
    if (!parsed.success) throw new AdapterError("invalid_output", "Scripted answer does not match the schema");
    return { data: parsed.data, usage: { inputTokens: 0, outputTokens: 0 } };
  }
}
