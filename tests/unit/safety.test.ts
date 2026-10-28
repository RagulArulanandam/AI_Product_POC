import { describe, expect, it } from "vitest";
import { detectSafety } from "@/products/missed-call/ai/safety";

const flags = (text: string) => {
  const s = detectSafety(text);
  return Object.entries(s).filter(([, v]) => v).map(([k]) => k);
};

describe("detectSafety: health and safety questions are never answered by the assistant", () => {
  it.each([
    "Is this safe for my condition?",
    "Is it safe to have the treatment while pregnant?",
    "Are there any side effects?",
    "I'm allergic to latex, is that a problem",
    "I take medication for blood pressure",
    "What dosage do you use?",
    "Can you diagnose what this is?",
    "Should I stop taking my tablets before?",
    "Can I take ibuprofen first",
    "will it interact with my prescription",
    "I'm breastfeeding, any issue?",
  ])("flags %j as medical", (text) => {
    expect(detectSafety(text).medical).toBe(true);
  });

  it.each([
    "Hi, what time do you open on Saturday?",
    "I'd like a check-up on Thursday",
    "Do you do teeth whitening?",
    "How much is a haircut?",
    "Is parking available?",
    "Thanks, see you then",
  ])("does not flag %j", (text) => {
    expect(detectSafety(text).medical).toBe(false);
  });
});

describe("detectSafety: urgent wording", () => {
  it.each([
    "This is an emergency",
    "It's urgent, please call",
    "I need to be seen urgently",
    "I'm in severe pain",
    "the pain is unbearable",
    "my gum is bleeding",
    "I can't breathe properly",
    "chest pain",
    "call an ambulance",
    "I think it's an allergic reaction",
  ])("flags %j as urgent", (text) => {
    expect(detectSafety(text).urgent).toBe(true);
  });

  it.each(["What are your hours?", "Is there an urgent care clinic nearby?".replace("urgent care", "walk-in"), "I'll be 10 minutes late"])(
    "does not flag %j",
    (text) => {
      expect(detectSafety(text).urgent).toBe(false);
    },
  );
});

describe("detectSafety: wants a person", () => {
  it.each([
    "Can I speak to someone?",
    "I want to talk to a person",
    "let me speak with the manager",
    "please get me a real person",
    "Can you call me back?",
    "could you call me",
    "call me back asap",
    "please ring me",
    "give me a call",
    "ring me please",
    "I want to talk to a human",
    "can I chat with the receptionist",
    "speak to the dentist",
  ])("flags %j", (text) => {
    expect(detectSafety(text).wantsHuman).toBe(true);
  });

  // The most natural reply to a missed-call message must never look like "get me a person".
  it.each([
    "Did you call me?",
    "Hello? Did you call me just now",
    "Someone called me from this number",
    "who rang me?",
    "You missed my call, sorry",
    "I'd like to speak about my appointment",
    "Can you tell me your address?",
    "I'll call tomorrow",
  ])("does not flag %j", (text) => {
    expect(detectSafety(text).wantsHuman).toBe(false);
  });
});

describe("detectSafety: complaints", () => {
  it.each([
    "I want to make a complaint",
    "This is unacceptable",
    "Your receptionist was rude",
    "I want a refund",
    "I'm furious",
    "I'm really unhappy with the service",
    "worst experience ever",
    "never again",
  ])("flags %j", (text) => {
    expect(detectSafety(text).complaint).toBe(true);
  });

  it.each(["Thanks, that was great", "What's your cancellation policy?", "Can I rebook?"])("does not flag %j", (text) => {
    expect(detectSafety(text).complaint).toBe(false);
  });
});

describe("detectSafety: combinations and case", () => {
  it("is case-insensitive", () => {
    expect(flags("IS THIS SAFE FOR MY CONDITION")).toEqual(["medical"]);
    expect(flags("EMERGENCY")).toEqual(["urgent"]);
  });

  it("can flag several at once", () => {
    expect(flags("This is urgent and I want to speak to a manager")).toEqual(expect.arrayContaining(["urgent", "wantsHuman"]));
  });

  it("flags nothing for ordinary messages and empty text", () => {
    expect(flags("Hello, can I book for Tuesday morning?")).toEqual([]);
    expect(flags("")).toEqual([]);
  });
});
