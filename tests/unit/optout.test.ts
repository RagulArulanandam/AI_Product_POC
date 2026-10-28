import { describe, expect, it } from "vitest";
import { isStopMessage } from "@/engine/optout";

describe("isStopMessage", () => {
  it.each(["STOP", "stop", "Stop", "  stop  ", "STOPALL", "Unsubscribe", "CANCEL", "end", "QUIT", "stop.", "STOP!", "Stop\n"])(
    "treats %j as an opt-out",
    (text) => {
      expect(isStopMessage(text)).toBe(true);
    },
  );

  it.each([
    "please don't stop by",
    "stop the car",
    "cancel my appointment",
    "I want to end this call",
    "stops",
    "quit smoking advice please",
    "",
    "   ",
    "yes",
    "STOP STOP",
  ])("treats %j as an ordinary message", (text) => {
    expect(isStopMessage(text)).toBe(false);
  });
});
