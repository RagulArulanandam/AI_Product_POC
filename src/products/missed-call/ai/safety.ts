/**
 * A keyword safety net that runs in code, whatever the model says (product-missed-call.md,
 * "Guardrails"). It errs on the side of handing the conversation to a person: a false alarm
 * costs the owner a glance, a miss could mean bad advice sent to a customer.
 */

const URGENT =
  /\b(emergenc(?:y|ies)|urgent(?:ly)?|severe pain|unbearable|bleeding|(?:can'?t|cannot|can not) breathe|chest pain|ambulance|999|overdose|anaphyla\w*|allergic reaction|suicid\w*)\b/i;

const MEDICAL =
  /\b(is (?:it|this|that) safe|safe (?:for|to|during)|side[- ]effects?|allerg(?:y|ic|ies)|pregnan(?:t|cy)|breast ?feeding|medication|medicine|prescription|dosage|dose|diagnos(?:e|is|ed)|contra-?indicat\w*|interact(?:s|ion)? with|should i (?:take|stop|use|continue)|can i (?:take|use|have|mix)|my condition|treat my|cure for)\b/i;

const WANTS_HUMAN =
  /\b(?:speak|talk|chat|connect me) (?:to|with) (?:a |an |the |your )?(?:real )?(?:person|human|someone|somebody|manager|receptionist|owner|staff|team|dentist|doctor)\b|\b(?:call|ring|phone) me (?:back|please|pls|asap)\b|\b(?:can|could|would|will) you (?:please )?(?:call|ring|phone) me\b|\bplease (?:call|ring|phone) me\b|\bgive me a (?:call|ring)\b|\breal (?:person|human)\b|\ba human\b/i;

const COMPLAINT =
  /\b(complain(?:t|ing)?|unacceptable|disgusting|rude|refund|furious|angry|livid|appalled|disappointed|awful|terrible|worst|ripped off|never again|unhappy)\b/i;

export interface Safety {
  urgent: boolean;
  medical: boolean;
  wantsHuman: boolean;
  complaint: boolean;
}

export function detectSafety(text: string): Safety {
  return {
    urgent: URGENT.test(text),
    medical: MEDICAL.test(text),
    wantsHuman: WANTS_HUMAN.test(text),
    complaint: COMPLAINT.test(text),
  };
}
