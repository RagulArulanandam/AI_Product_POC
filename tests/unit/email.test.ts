import { describe, expect, it, vi } from "vitest";
import { getEmail, getFakeEmail } from "@/adapters/email";
import { FakeEmailAdapter } from "@/adapters/email/fake";
import type { EmailAdapter } from "@/adapters/email/interface";
import { mapResendError, ResendEmailAdapter, type ResendLikeClient } from "@/adapters/email/resend";
import { AdapterError } from "@/lib/errors";
import { buildEscalationEmail, REASON_LABELS, type EscalationReason } from "@/products/missed-call/escalation-email";

type Send = ResendLikeClient["emails"]["send"];

function resendWith(send: Send) {
  return new ResendEmailAdapter({ apiKey: "re_test", from: "onboarding@resend.dev" }, { emails: { send } });
}
const ok = () => vi.fn<Send>(async () => ({ data: { id: "resend-id-1" }, error: null }));
const mail = { to: "owner@example.com", subject: "Hello", text: "Body" };

const implementations: [string, () => EmailAdapter][] = [
  ["fake", () => new FakeEmailAdapter()],
  ["resend (stubbed client)", () => resendWith(ok())],
];

describe.each(implementations)("email adapter contract: %s", (_name, make) => {
  it("sends and returns a provider id", async () => {
    expect((await make().send(mail)).providerId).toBeTruthy();
  });

  it.each([
    ["a bad address", { ...mail, to: "not-an-email" }],
    ["an address with a line break", { ...mail, to: "a@b.co\r\nBcc: x@y.z" }],
    ["a subject with a line break", { ...mail, subject: "Hi\r\nBcc: x@y.z" }],
    ["an empty subject", { ...mail, subject: "  " }],
    ["an empty body", { ...mail, text: "" }],
  ])("rejects %s without retrying", async (_label, input) => {
    const error = await make().send(input).catch((e) => e);
    expect(error).toBeInstanceOf(AdapterError);
    expect(error).toMatchObject({ code: "invalid_request", retryable: false });
  });
});

describe("ResendEmailAdapter", () => {
  it("sends from the configured address and includes html only when given", async () => {
    const send = ok();
    const adapter = resendWith(send);
    await adapter.send(mail);
    await adapter.send({ ...mail, html: "<p>Hi</p>" });
    expect(send.mock.calls[0][0]).toEqual({ from: "onboarding@resend.dev", to: "owner@example.com", subject: "Hello", text: "Body" });
    expect(send.mock.calls[1][0]).toMatchObject({ html: "<p>Hi</p>" });
  });

  it("maps API errors, and treats a thrown network error as retryable", async () => {
    const failing = resendWith(vi.fn<Send>(async () => ({ data: null, error: { name: "rate_limit_exceeded", message: "slow", statusCode: 429 } })));
    await expect(failing.send(mail)).rejects.toMatchObject({ code: "rate_limited", retryable: true });

    const thrown = resendWith(vi.fn<Send>(async () => { throw new Error("socket hang up"); }));
    await expect(thrown.send(mail)).rejects.toMatchObject({ code: "provider_unavailable", retryable: true });
  });

  it("fails when Resend answers with neither data nor an error", async () => {
    const empty = resendWith(vi.fn<Send>(async () => ({ data: null, error: null })));
    await expect(empty.send(mail)).rejects.toMatchObject({ code: "provider_unavailable" });
  });
});

describe("mapResendError", () => {
  it.each([
    [{ name: "rate_limit_exceeded", message: "x", statusCode: 429 }, "rate_limited", true],
    [{ name: "restricted_api_key", message: "x", statusCode: 401 }, "auth", false],
    [{ name: "invalid_api_key", message: "x", statusCode: 403 }, "auth", false],
    [{ name: "missing_api_key", message: "x", statusCode: 401 }, "auth", false],
    // Sending to anyone but the account owner from onboarding@resend.dev:
    [{ name: "validation_error", message: "You can only send testing emails to your own email address", statusCode: 403 }, "invalid_request", false],
    [{ name: "invalid_parameter", message: "x", statusCode: 422 }, "invalid_request", false],
    [{ name: "not_found", message: "x", statusCode: 404 }, "not_found", false],
    [{ name: "application_error", message: "x", statusCode: 500 }, "provider_unavailable", true],
    [{ message: "x" }, "provider_unavailable", true],
  ])("maps %j to %s (retryable: %s)", (input, code, retryable) => {
    const error = mapResendError(input);
    expect(error.code).toBe(code);
    expect(error.retryable).toBe(retryable);
  });

  it("copes with a missing error", () => {
    expect(mapResendError(undefined).code).toBe("provider_unavailable");
    expect(mapResendError(null).code).toBe("provider_unavailable");
  });
});

describe("FakeEmailAdapter", () => {
  it("records sends, numbers them, and can be told to fail", async () => {
    const fake = new FakeEmailAdapter();
    expect((await fake.send(mail)).providerId).toBe("email-fake-1");
    fake.failNext(new AdapterError("rate_limited", "slow"));
    await expect(fake.send(mail)).rejects.toMatchObject({ code: "rate_limited" });
    await fake.send({ ...mail, subject: "Second" });
    expect(fake.sent.map((m) => m.subject)).toEqual(["Hello", "Second"]);
    fake.reset();
    expect(fake.sent).toEqual([]);
  });

  it("is what getEmail returns under test", () => {
    expect(getEmail()).toBe(getFakeEmail());
  });
});

describe("buildEscalationEmail", () => {
  const base = {
    businessName: "Bright Smile Dental",
    reason: "complaint" as EscalationReason,
    customerPhone: "+447911123456",
    conversationUrl: "http://localhost:3000/conversations/abc",
    at: new Date("2026-10-28T14:30:00Z"),
    timezone: "Europe/London",
  };

  it("says why, who, when, and links to the conversation", () => {
    const email = buildEscalationEmail({ ...base, lastMessage: "I am very unhappy", customerName: "Sam" });
    expect(email.subject).toBe("Needs your attention: The customer made a complaint (Bright Smile Dental)");
    expect(email.text).toContain("Why: The customer made a complaint");
    expect(email.text).toContain("Customer: Sam (+********3456)");
    expect(email.text).toContain('Their last message: "I am very unhappy"');
    expect(email.text).toContain("When: 28 Oct 2026, 14:30 (Europe/London)");
    expect(email.text).toContain("http://localhost:3000/conversations/abc");
    expect(email.html).toContain('<a href="http://localhost:3000/conversations/abc">');
  });

  it("masks the customer's number everywhere", () => {
    const email = buildEscalationEmail(base);
    for (const body of [email.subject, email.text, email.html]) expect(body).not.toContain("447911123456");
    expect(email.text).toContain("+********3456");
  });

  it("uses the business timezone for the time", () => {
    const summer = buildEscalationEmail({ ...base, at: new Date("2026-07-01T12:00:00Z") });
    expect(summer.text).toContain("13:00"); // BST
  });

  it("escapes HTML in everything the customer or business typed", () => {
    const email = buildEscalationEmail({
      ...base,
      businessName: 'Evil <script>alert(1)</script> & "Co"',
      customerName: "<b>Bob</b>",
      lastMessage: '<img src=x onerror="steal()">',
    });
    expect(email.html).not.toContain("<script>");
    expect(email.html).not.toContain("<img");
    expect(email.html).not.toContain("<b>Bob");
    expect(email.html).toContain("&lt;script&gt;");
    expect(email.html).toContain("&amp; &quot;Co&quot;");
  });

  it("keeps the subject on a single line, even with line breaks in the business name", () => {
    const email = buildEscalationEmail({ ...base, businessName: "Line one\r\nBcc: attacker@example.com" });
    expect(email.subject).not.toMatch(/[\r\n]/);
  });

  it("shortens a long last message and omits the line when there is none", () => {
    const long = buildEscalationEmail({ ...base, lastMessage: "word ".repeat(100) });
    const quoted = /Their last message: "(.*)"/.exec(long.text)![1];
    expect(quoted.length).toBeLessThanOrEqual(201);
    expect(quoted.endsWith("…")).toBe(true);
    expect(buildEscalationEmail(base).text).not.toContain("Their last message");
  });

  it("has a label for every reason", () => {
    for (const reason of Object.keys(REASON_LABELS) as EscalationReason[]) {
      expect(buildEscalationEmail({ ...base, reason }).subject).toContain(REASON_LABELS[reason]);
    }
  });
});
