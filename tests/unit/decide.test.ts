import { describe, expect, it } from "vitest";
import type { AiReply } from "@/products/missed-call/ai/contract";
import { CONFIDENCE_THRESHOLD, TURN_CAP } from "@/products/missed-call/ai/contract";
import { decide, sanitizeReply, type DecisionInput, type EscalateOn } from "@/products/missed-call/ai/decide";
import { BOOKING_PENDING_REPLY, FALLBACK_REPLY } from "@/products/missed-call/ai/replies";
import type { Safety } from "@/products/missed-call/ai/safety";

const NONE: Safety = { urgent: false, medical: false, wantsHuman: false, complaint: false };
const ALL_ON: EscalateOn = { complaint: true, wants_human: true, low_confidence: true };

const ai = (overrides: Partial<AiReply> = {}): AiReply => ({
  intent: "enquiry",
  confidence: 0.9,
  extracted: { name: null, service: null, preferred_date: null, preferred_time: null },
  next_action: "ask_question",
  reply: "We open at nine.",
  ...overrides,
});

const run = (overrides: Partial<DecisionInput> = {}) =>
  decide({ ai: ai(), safety: NONE, escalateOn: ALL_ON, turnCount: 1, ...overrides });

describe("decide: ordinary conversation", () => {
  it("sends the model's reply and keeps the conversation open", () => {
    expect(run()).toEqual({ kind: "reply", reply: "We open at nine.", state: "in_conversation" });
  });

  it("ends an enquiry when the model says it is complete", () => {
    expect(run({ ai: ai({ next_action: "close", reply: "Thanks, the team will be in touch." }) })).toEqual({
      kind: "reply",
      reply: "Thanks, the team will be in touch.",
      state: "enquiry_logged",
    });
  });

  it("treats `other` like an enquiry", () => {
    expect(run({ ai: ai({ intent: "other" }) }).kind).toBe("reply");
  });
});

describe("decide: always escalated, whatever the settings", () => {
  const off: EscalateOn = { complaint: false, wants_human: false, low_confidence: false };

  it("escalates urgent wording even with everything switched off and a confident answer", () => {
    expect(run({ safety: { ...NONE, urgent: true }, escalateOn: off })).toEqual({ kind: "escalate", reason: "urgent" });
  });

  it("escalates health and safety questions", () => {
    expect(run({ safety: { ...NONE, medical: true }, escalateOn: off })).toEqual({ kind: "escalate", reason: "medical_advice" });
  });

  it("escalates urgent and medical without the model being asked at all", () => {
    expect(run({ ai: null, safety: { ...NONE, urgent: true } })).toEqual({ kind: "escalate", reason: "urgent" });
    expect(run({ ai: null, safety: { ...NONE, medical: true } })).toEqual({ kind: "escalate", reason: "medical_advice" });
  });

  it("puts urgent ahead of medical and of everything the model said", () => {
    expect(run({ safety: { ...NONE, urgent: true, medical: true }, ai: ai({ intent: "opt_out" }) })).toEqual({ kind: "escalate", reason: "urgent" });
  });

  it("escalates at the turn cap, and not before", () => {
    expect(run({ turnCount: TURN_CAP - 1 }).kind).toBe("reply");
    expect(run({ turnCount: TURN_CAP })).toEqual({ kind: "escalate", reason: "turn_cap" });
    expect(run({ turnCount: TURN_CAP + 5, escalateOn: off })).toEqual({ kind: "escalate", reason: "turn_cap" });
  });

  it("escalates when there is no usable model answer", () => {
    expect(run({ ai: null })).toEqual({ kind: "escalate", reason: "invalid_model_output" });
  });
});

describe("decide: opt-out", () => {
  it("honours the model reading a message as an opt-out", () => {
    expect(run({ ai: ai({ intent: "opt_out" }) })).toEqual({ kind: "opt_out" });
  });
});

describe("decide: wants a person", () => {
  it("escalates on the keyword net even when the model carries on happily", () => {
    expect(run({ safety: { ...NONE, wantsHuman: true } })).toEqual({ kind: "escalate", reason: "wants_human" });
  });

  it("escalates when the model says needs_human", () => {
    expect(run({ ai: ai({ intent: "needs_human", next_action: "escalate" }) })).toEqual({ kind: "escalate", reason: "wants_human" });
  });

  it("answers normally when the owner switched that off, even if the model asked to escalate", () => {
    const result = run({
      ai: ai({ intent: "needs_human", next_action: "escalate", reply: "I'll note that." }),
      escalateOn: { ...ALL_ON, wants_human: false },
    });
    expect(result).toEqual({ kind: "reply", reply: "I'll note that.", state: "in_conversation" });
  });
});

describe("decide: complaints", () => {
  it("escalates on the keyword net and on the model's intent", () => {
    expect(run({ safety: { ...NONE, complaint: true } })).toEqual({ kind: "escalate", reason: "complaint" });
    expect(run({ ai: ai({ intent: "complaint", next_action: "escalate" }) })).toEqual({ kind: "escalate", reason: "complaint" });
  });

  it("answers normally when the owner switched complaints off", () => {
    const result = run({ ai: ai({ intent: "complaint", next_action: "escalate" }), escalateOn: { ...ALL_ON, complaint: false } });
    expect(result.kind).toBe("reply");
  });

  it("puts a request for a person ahead of a complaint", () => {
    expect(run({ safety: { ...NONE, wantsHuman: true, complaint: true } })).toEqual({ kind: "escalate", reason: "wants_human" });
  });
});

describe("decide: the model asking for a person", () => {
  it("escalates when it asks to escalate for no listed reason", () => {
    expect(run({ ai: ai({ next_action: "escalate" }) })).toEqual({ kind: "escalate", reason: "model_requested" });
  });
});

describe("decide: confidence", () => {
  it("escalates below the threshold, but not at it", () => {
    expect(run({ ai: ai({ confidence: CONFIDENCE_THRESHOLD - 0.01 }) })).toEqual({ kind: "escalate", reason: "low_confidence" });
    expect(run({ ai: ai({ confidence: CONFIDENCE_THRESHOLD }) }).kind).toBe("reply");
    expect(run({ ai: ai({ confidence: 0 }) }).kind).toBe("escalate");
  });

  it("ignores low confidence when the owner switched that off", () => {
    expect(run({ ai: ai({ confidence: 0.1 }), escalateOn: { ...ALL_ON, low_confidence: false } }).kind).toBe("reply");
  });
});

describe("decide: booking requests (until calendar booking exists)", () => {
  it.each([
    ["a booking intent", ai({ intent: "book_appointment", reply: "Thursday 3pm is confirmed!" })],
    ["offering slots", ai({ next_action: "offer_slots", reply: "I can do Tue 10am or Wed 2pm." })],
    ["confirming a booking", ai({ next_action: "confirm_booking", reply: "You're booked in." })],
  ])("replies with a fixed holding message for %s, never the model's promise", (_label, answer) => {
    expect(run({ ai: answer })).toEqual({ kind: "reply", reply: BOOKING_PENDING_REPLY, state: "enquiry_logged" });
  });
});

describe("sanitizeReply and reply text", () => {
  it("removes control characters and tidies whitespace", () => {
    expect(sanitizeReply("Hello\u0000 \u0007there\u001b   friend\n\n\n\nBye  ")).toBe("Hello there friend\n\nBye");
  });

  it("keeps ordinary punctuation, newlines and emoji", () => {
    expect(sanitizeReply("Hi 👋\nSee you soon!")).toBe("Hi 👋\nSee you soon!");
  });

  it("limits the length", () => {
    const out = sanitizeReply("x".repeat(5000));
    expect(out.length).toBe(1000);
    expect(out.endsWith("…")).toBe(true);
  });

  it("falls back to a safe line when the model's reply is empty or only junk", () => {
    expect(run({ ai: ai({ reply: "" }) })).toEqual({ kind: "reply", reply: FALLBACK_REPLY, state: "in_conversation" });
    expect(run({ ai: ai({ reply: " \u0000 \n " }) })).toEqual({ kind: "reply", reply: FALLBACK_REPLY, state: "in_conversation" });
  });
});
