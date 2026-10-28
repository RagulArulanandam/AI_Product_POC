import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";

const { afterTasks } = vi.hoisted(() => ({ afterTasks: [] as (() => Promise<unknown>)[] }));
vi.mock("next/server", async (importOriginal) => {
  const actual = await importOriginal<typeof import("next/server")>();
  return { ...actual, after: (task: () => Promise<unknown>) => void afterTasks.push(task) };
});

import { POST } from "@/app/api/dev/simulate-inbound-message/route";
import { getFakeEmail } from "@/adapters/email";
import { getFakeLlm } from "@/adapters/llm";
import { getFakeMessaging } from "@/adapters/messaging";
import type { EngineDeps } from "@/engine/runner";
import type { Admin } from "@/engine/types";
import { runDueActions } from "@/engine/worker";
import { getProduct } from "@/products/registry";
import { serviceClient } from "../helpers/db";
import { missedCallProductId } from "../helpers/tenant-tables";
import { cleanupTenants, createTenant, type Tenant } from "../helpers/tenants";

const admin = serviceClient() as unknown as Admin;
const fakeMessaging = getFakeMessaging();
const fakeLlm = getFakeLlm();
const fakeEmail = getFakeEmail();
const URL = "http://localhost/api/dev/simulate-inbound-message";
const PHONE = "+447700900701";
const saved = { flag: process.env.ENABLE_DEV_ENDPOINTS };

let tenant: Tenant;
let conversationId: string;

function call(body: unknown, headers: Record<string, string> = { authorization: `Bearer ${process.env.WORKER_SECRET}` }) {
  return POST(new Request(URL, { method: "POST", headers: { "content-type": "application/json", ...headers }, body: JSON.stringify(body) }));
}

beforeAll(async () => {
  process.env.ENABLE_DEV_ENDPOINTS = "true";
  tenant = await createTenant("siminbound");
  const productId = await missedCallProductId(admin);
  await admin.from("business_products").insert({ business_id: tenant.businessId, product_id: productId, enabled: true, config: {} });
});

beforeEach(async () => {
  afterTasks.length = 0;
  fakeMessaging.reset();
  fakeLlm.reset();
  fakeEmail.reset();
  process.env.ENABLE_DEV_ENDPOINTS = "true";
  vi.unstubAllEnvs();
  for (const table of ["scheduled_actions", "webhook_events", "conversations", "customers"] as const) {
    await admin.from(table).delete().eq("business_id", tenant.businessId);
  }
  const { data: customer } = await admin.from("customers").insert({ business_id: tenant.businessId, phone_e164: PHONE }).select("id").single();
  const { data } = await admin
    .from("conversations")
    .insert({ business_id: tenant.businessId, customer_id: customer!.id, product_id: productId(), state: "awaiting_reply" })
    .select("id")
    .single();
  conversationId = data!.id;
});

let cachedProduct = "";
function productId() {
  return cachedProduct;
}
beforeAll(async () => {
  cachedProduct = await missedCallProductId(admin);
});

afterAll(async () => {
  if (saved.flag === undefined) delete process.env.ENABLE_DEV_ENDPOINTS;
  else process.env.ENABLE_DEV_ENDPOINTS = saved.flag;
  await cleanupTenants();
});

describe("POST /api/dev/simulate-inbound-message: access control", () => {
  it("does not exist unless dev endpoints are on, and not in production", async () => {
    delete process.env.ENABLE_DEV_ENDPOINTS;
    expect((await call({ from: PHONE, body: "hi" })).status).toBe(404);
    process.env.ENABLE_DEV_ENDPOINTS = "true";
    vi.stubEnv("NODE_ENV", "production");
    expect((await call({ from: PHONE, body: "hi" })).status).toBe(404);
  });

  it("needs the worker secret", async () => {
    const headerSets: Record<string, string>[] = [{}, { authorization: "Bearer wrong" }, { authorization: process.env.WORKER_SECRET! }];
    for (const headers of headerSets) expect((await call({ from: PHONE, body: "hi" }, headers)).status).toBe(401);
    expect(afterTasks).toHaveLength(0);
  });
});

describe("POST /api/dev/simulate-inbound-message: behaviour", () => {
  it.each([
    ["no body", { from: PHONE }],
    ["an empty message", { from: PHONE, body: "" }],
    ["a message that is too long", { from: PHONE, body: "x".repeat(1001) }],
    ["a phone that is not E.164", { from: "07700 900701", body: "hi" }],
  ])("answers 400 for %s", async (_label, body) => {
    expect((await call(body)).status).toBe(400);
  });

  it("answers 404 when the number has no open conversation", async () => {
    const res = await call({ from: "+447700900799", body: "hi" });
    expect(res.status).toBe(404);
    expect(await res.json()).toEqual({ error: "no_open_conversation" });
  });

  it("queues a message.inbound event for the open conversation and runs the worker after responding", async () => {
    const res = await call({ from: PHONE, body: "What time do you open?" });
    expect(res.status).toBe(200);
    const json = await res.json();
    expect(json).toMatchObject({ ok: true, status: "accepted", conversationId });

    const { data: event } = await admin.from("webhook_events").select("*").eq("id", json.webhookEventId).single();
    expect(event).toMatchObject({ provider: "simulated", business_id: tenant.businessId });
    expect(event?.payload).toMatchObject({ type: "message.inbound", data: { from: PHONE, body: "What time do you open?" }, conversation_id: conversationId });
    expect(afterTasks).toHaveLength(1);
  });

  it("drives the real conversation: the model answers and the reply is stored", async () => {
    const deps: EngineDeps = {
      admin,
      products: [getProduct("missed-call")!],
      now: () => new Date(),
      services: { messaging: () => fakeMessaging, llm: () => fakeLlm, email: () => fakeEmail },
    };
    fakeLlm.enqueue({
      intent: "enquiry", confidence: 0.9, next_action: "ask_question", reply: "We open at nine.",
      extracted: { name: null, service: null, preferred_date: null, preferred_time: null },
    });
    await call({ from: PHONE, body: "What time do you open?" });
    await runDueActions(deps);

    expect(fakeMessaging.sent.map((m) => m.body)).toEqual(["We open at nine."]);
    const { data } = await admin.from("conversations").select("state, turn_count").eq("id", conversationId).single();
    expect(data).toEqual({ state: "in_conversation", turn_count: 1 });
  });
});
