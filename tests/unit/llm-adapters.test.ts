import { describe, expect, it, vi } from "vitest";
import { z } from "zod";
import { getFakeLlm, getLlm } from "@/adapters/llm";
import { FakeLlmAdapter } from "@/adapters/llm/fake";
import { mapOpenAiError, OpenAiLlmAdapter, type OpenAiLikeClient } from "@/adapters/llm/openai";
import { AdapterError } from "@/lib/errors";

const schema = z.object({
  intent: z.enum(["enquiry", "other"]),
  confidence: z.number().refine((n) => n >= 0 && n <= 1),
  reply: z.string().max(100),
});
const GOOD = { intent: "enquiry", confidence: 0.9, reply: "We open at nine." };

type Create = OpenAiLikeClient["chat"]["completions"]["create"];
type Response = Awaited<ReturnType<Create>>;

function adapterReturning(content: string | null, extra: Partial<Response["choices"][0]> = {}, usage?: Response["usage"]) {
  const create = vi.fn<Create>(async () => ({
    choices: [{ message: { content, refusal: null }, finish_reason: "stop", ...extra }],
    usage: usage === undefined ? { prompt_tokens: 12, completion_tokens: 7 } : usage,
  }));
  const adapter = new OpenAiLlmAdapter({ apiKey: "k".repeat(30), model: "test-model-x" }, { chat: { completions: { create } } });
  return { adapter, create };
}

const call = (adapter: OpenAiLlmAdapter) =>
  adapter.completeJson({
    system: "You are a receptionist.",
    messages: [{ role: "user", content: "What time do you open?" }],
    schema,
    schemaName: "test_reply",
  });

describe("OpenAiLlmAdapter", () => {
  it("returns validated data and token usage", async () => {
    const { adapter } = adapterReturning(JSON.stringify(GOOD));
    expect(await call(adapter)).toEqual({ data: GOOD, usage: { inputTokens: 12, outputTokens: 7 } });
  });

  it("sends the configured model, the system prompt first, then the conversation", async () => {
    const { adapter, create } = adapterReturning(JSON.stringify(GOOD));
    await call(adapter);
    const [body, options] = create.mock.calls[0];
    expect(body.model).toBe("test-model-x");
    expect(body.messages).toEqual([
      { role: "system", content: "You are a receptionist." },
      { role: "user", content: "What time do you open?" },
    ]);
    expect(body.temperature).toBeLessThanOrEqual(0.3);
    expect(options.timeout).toBe(20_000);
  });

  it("asks for strict structured output built from the Zod schema", async () => {
    const { adapter, create } = adapterReturning(JSON.stringify(GOOD));
    await call(adapter);
    const format = create.mock.calls[0][0].response_format;
    expect(format.type).toBe("json_schema");
    expect(format.json_schema.name).toBe("test_reply");
    expect(format.json_schema.strict).toBe(true);
    const sent = format.json_schema.schema;
    expect(sent).not.toHaveProperty("$schema");
    expect(sent).toMatchObject({ type: "object", additionalProperties: false, required: ["intent", "confidence", "reply"] });
  });

  it("works without usage information", async () => {
    const { adapter } = adapterReturning(JSON.stringify(GOOD), {}, null);
    expect((await call(adapter)).usage).toEqual({ inputTokens: 0, outputTokens: 0 });
  });

  it.each([
    ["not JSON", "I think we open at nine", {}],
    ["empty", null, {}],
    ["a refusal", null, { message: { content: null, refusal: "I cannot help with that" } }],
    ["cut off", JSON.stringify(GOOD).slice(0, 20), { finish_reason: "length" }],
    ["JSON of the wrong shape", JSON.stringify({ intent: "enquiry" }), {}],
    ["an out-of-range value", JSON.stringify({ ...GOOD, confidence: 7 }), {}],
    ["an unknown intent", JSON.stringify({ ...GOOD, intent: "chitchat" }), {}],
    ["a reply that is too long", JSON.stringify({ ...GOOD, reply: "x".repeat(101) }), {}],
  ])("reports %s as invalid_output, which is not retried", async (_label, content, extra) => {
    const { adapter } = adapterReturning(content, extra);
    const error = await call(adapter).catch((e) => e);
    expect(error).toBeInstanceOf(AdapterError);
    expect(error).toMatchObject({ code: "invalid_output", retryable: false });
  });

  it("reports no choices as invalid_output", async () => {
    const create = vi.fn<Create>(async () => ({ choices: [] }));
    const adapter = new OpenAiLlmAdapter({ apiKey: "k".repeat(30), model: "m" }, { chat: { completions: { create } } });
    await expect(call(adapter)).rejects.toMatchObject({ code: "invalid_output" });
  });

  it("never puts the model's text or the customer's words in an error message", async () => {
    const secret = "my phone is +447911123456";
    const { adapter } = adapterReturning(JSON.stringify({ intent: "enquiry", confidence: 0.5, reply: secret + "x".repeat(200) }));
    const error = await call(adapter).catch((e) => e);
    expect(error.message).not.toContain("447911123456");
    expect(error.message).toContain("reply");
  });

  it("maps request failures to AdapterError", async () => {
    const create = vi.fn<Create>(async () => {
      throw Object.assign(new Error("Rate limit reached"), { status: 429 });
    });
    const adapter = new OpenAiLlmAdapter({ apiKey: "k".repeat(30), model: "m" }, { chat: { completions: { create } } });
    await expect(call(adapter)).rejects.toMatchObject({ code: "rate_limited", retryable: true });
  });
});

describe("mapOpenAiError", () => {
  it.each([
    [{ status: 401 }, "auth", false],
    [{ status: 403 }, "auth", false],
    [{ status: 429, code: "insufficient_quota" }, "auth", false],
    [{ status: 429 }, "rate_limited", true],
    [{ status: 404 }, "not_found", false],
    [{ status: 400 }, "invalid_request", false],
    [{ status: 422 }, "invalid_request", false],
    [{ status: 500 }, "provider_unavailable", true],
    [{ status: 503 }, "provider_unavailable", true],
    [{}, "provider_unavailable", true],
  ])("maps %j to %s (retryable: %s)", (input, code, retryable) => {
    const error = mapOpenAiError(Object.assign(new Error("boom"), input));
    expect(error.code).toBe(code);
    expect(error.retryable).toBe(retryable);
  });

  it("copes with odd values and keeps the cause", () => {
    expect(mapOpenAiError(undefined).code).toBe("provider_unavailable");
    const cause = new Error("x");
    expect(mapOpenAiError(cause).cause).toBe(cause);
  });
});

describe("FakeLlmAdapter", () => {
  it("returns scripted answers in order, validated, and records the calls", async () => {
    const fake = new FakeLlmAdapter();
    fake.enqueue(GOOD, { ...GOOD, reply: "second" });
    const input = { system: "s", messages: [{ role: "user" as const, content: "hi" }], schema, schemaName: "n" };

    expect((await fake.completeJson(input)).data.reply).toBe("We open at nine.");
    expect((await fake.completeJson(input)).data.reply).toBe("second");
    expect(fake.calls).toHaveLength(2);
    expect(fake.calls[0]).toEqual({ system: "s", messages: input.messages, schemaName: "n" });
  });

  it("behaves like a bad model when a scripted answer does not fit the schema", async () => {
    const fake = new FakeLlmAdapter();
    fake.enqueue({ nonsense: true });
    const error = await fake.completeJson({ system: "s", messages: [], schema, schemaName: "n" }).catch((e) => e);
    expect(error).toMatchObject({ code: "invalid_output", retryable: false });
  });

  it("throws scripted errors, and complains when nothing is scripted", async () => {
    const fake = new FakeLlmAdapter();
    fake.enqueue(new AdapterError("rate_limited", "slow"));
    const input = { system: "s", messages: [], schema, schemaName: "n" };
    await expect(fake.completeJson(input)).rejects.toMatchObject({ code: "rate_limited" });
    await expect(fake.completeJson(input)).rejects.toThrow(/no scripted answer/);
  });

  it("clears its script and history on reset", async () => {
    const fake = new FakeLlmAdapter();
    fake.enqueue(GOOD);
    await fake.completeJson({ system: "s", messages: [], schema, schemaName: "n" });
    fake.enqueue(GOOD);
    fake.reset();
    expect(fake.calls).toEqual([]);
    await expect(fake.completeJson({ system: "s", messages: [], schema, schemaName: "n" })).rejects.toThrow();
  });
});

describe("getLlm", () => {
  it("returns the shared fake under test", () => {
    expect(getLlm()).toBe(getFakeLlm());
  });
});
