import type { ZodType } from "zod";

export interface LlmMessage {
  role: "user" | "assistant";
  content: string;
}

export interface LlmUsage {
  inputTokens: number;
  outputTokens: number;
}

/** Language model boundary (integrations.md section 4). The model returns JSON we validate. */
export interface LlmAdapter {
  /**
   * Asks the model for JSON matching `schema`. The result is validated against the schema, so a
   * resolved promise always holds well-formed data. Throws AdapterError; output that is refused,
   * cut off, not JSON or off-schema is `invalid_output`.
   */
  completeJson<T>(input: {
    system: string;
    messages: LlmMessage[];
    schema: ZodType<T>;
    /** Short identifier for the schema, e.g. `missed_call_reply`. */
    schemaName: string;
  }): Promise<{ data: T; usage: LlmUsage }>;
}
