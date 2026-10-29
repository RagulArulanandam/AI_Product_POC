import { describe, expect, it } from "vitest";
import { findLeaks } from "../../scripts/check-bundle";

const file = (text: string) => [{ path: "static/chunks/app.js", text }];

describe("findLeaks", () => {
  it("passes a bundle that only has public values", () => {
    const text = 'const url="http://127.0.0.1:54321";const anon="sb_publishable_abc";NEXT_PUBLIC_SUPABASE_URL';
    expect(findLeaks(file(text), { OPENAI_API_KEY: "sk-proj-realvalue12345" })).toEqual([]);
  });

  it("catches a secret value, naming which one", () => {
    const leaks = findLeaks(file('fetch("x",{headers:{a:"sk-proj-realvalue12345"}})'), { OPENAI_API_KEY: "sk-proj-realvalue12345" });
    expect(leaks).toEqual([{ file: "static/chunks/app.js", what: "value of OPENAI_API_KEY" }]);
  });

  it("catches a secret variable name even without its value", () => {
    const leaks = findLeaks(file("process.env.SUPABASE_SERVICE_ROLE_KEY"), {});
    expect(leaks).toEqual([{ file: "static/chunks/app.js", what: "secret name SUPABASE_SERVICE_ROLE_KEY" }]);
  });

  it("ignores empty or very short values so they cannot match everything", () => {
    expect(findLeaks(file("abc"), { WORKER_SECRET: "", RESEND_API_KEY: "abc", ENCRYPTION_KEY: undefined })).toEqual([]);
  });
});
