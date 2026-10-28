import { getAdapterMode, getOpenAiEnv } from "@/lib/env";
import { FakeLlmAdapter } from "./fake";
import type { LlmAdapter } from "./interface";
import { OpenAiLlmAdapter } from "./openai";

let fake: FakeLlmAdapter | undefined;

/** One shared fake so tests can script answers and inspect what the code asked. */
export function getFakeLlm(): FakeLlmAdapter {
  fake ??= new FakeLlmAdapter();
  return fake;
}

/** The language model for this process: the fake in tests and `LLM_ADAPTER=fake`, else OpenAI. */
export function getLlm(): LlmAdapter {
  if (process.env.NODE_ENV === "test" || getAdapterMode("llm") === "fake") return getFakeLlm();
  const env = getOpenAiEnv();
  return new OpenAiLlmAdapter({ apiKey: env.OPENAI_API_KEY, model: env.OPENAI_MODEL });
}

export type { LlmAdapter } from "./interface";
