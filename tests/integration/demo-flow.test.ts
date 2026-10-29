import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";

const { afterTasks } = vi.hoisted(() => ({ afterTasks: [] as (() => Promise<unknown>)[] }));
vi.mock("next/server", async (importOriginal) => {
  const actual = await importOriginal<typeof import("next/server")>();
  return { ...actual, after: (task: () => Promise<unknown>) => void afterTasks.push(task) };
});

import { randomUUID } from "node:crypto";
import { POST as simulateInbound } from "@/app/api/dev/simulate-inbound-message/route";
import { POST as simulateMissedCall } from "@/app/api/dev/simulate-missed-call/route";
import { getFakeEmail } from "@/adapters/email";
import { getFakeLlm } from "@/adapters/llm";
import { getFakeMessaging } from "@/adapters/messaging";
import { enqueueAction } from "@/engine/queue";
import type { EngineDeps } from "@/engine/runner";
import type { Admin } from "@/engine/types";
import { runDueActions } from "@/engine/worker";
import { getProduct } from "@/products/registry";
import { listFailedActions, retryFailedAction } from "@/services/admin";
import { serviceClient } from "../helpers/db";
import { missedCallProductId } from "../helpers/tenant-tables";
import { cleanupTenants, createTenant, type Tenant } from "../helpers/tenants";

/**
 * The demo in docs/demo-script.md, run three times in a row on one business without clearing
 * anything in between ("done when" of Phase 8). Each run uses new customer numbers and must end
 * the same way as the first.
 */
const admin = serviceClient() as unknown as Admin;
const messaging = getFakeMessaging();
const llm = getFakeLlm();
const email = getFakeEmail();
const saved = { flag: process.env.ENABLE_DEV_ENDPOINTS };
const usedPhones: string[] = [];

let tenant: Tenant;
let adminUserId: string;

const deps = (): EngineDeps => ({
  admin,
  products: [getProduct("missed-call")!],
  now: () => new Date(),
  services: { messaging: () => messaging, llm: () => llm, email: () => email },
});

function post(handler: typeof simulateMissedCall, body: unknown) {
  return handler(
    new Request("http://localhost/api/dev", {
      method: "POST",
      headers: { "content-type": "application/json", authorization: `Bearer ${process.env.WORKER_SECRET}` },
      body: JSON.stringify(body),
    }),
  );
}

/** Ofcom drama range numbers (07700 900000 to 900999) that no earlier run of this test used. */
function newPhone(): string {
  for (;;) {
    const phone = `+447700900${String(Math.floor(Math.random() * 1000)).padStart(3, "0")}`;
    if (!usedPhones.includes(phone)) {
      usedPhones.push(phone);
      return phone;
    }
  }
}

/** Runs the worker until nothing of this business is due. Other test files may leave their own actions in the queue. */
async function drain() {
  while (afterTasks.length) await afterTasks.shift()!();
  for (let i = 0; i < 40; i++) {
    await runDueActions(deps());
    const { count } = await admin
      .from("scheduled_actions")
      .select("*", { count: "exact", head: true })
      .eq("business_id", tenant.businessId)
      .eq("status", "pending")
      .lte("run_at", new Date().toISOString());
    if (!count) return;
  }
  throw new Error("the worker did not finish this business's actions");
}

async function conversationState(phone: string): Promise<string | undefined> {
  const { data: customer } = await admin.from("customers").select("id").eq("business_id", tenant.businessId).eq("phone_e164", phone).maybeSingle();
  if (!customer) return undefined;
  const { data } = await admin.from("conversations").select("state").eq("customer_id", customer.id).maybeSingle();
  return data?.state;
}

beforeAll(async () => {
  process.env.ENABLE_DEV_ENDPOINTS = "true";
  tenant = await createTenant("demo");
  adminUserId = randomUUID();
  await admin
    .from("business_products")
    .insert({ business_id: tenant.businessId, product_id: await missedCallProductId(admin), enabled: true, config: { delay_minutes: 0 } });
});

beforeEach(() => {
  afterTasks.length = 0;
  llm.reset();
});

afterAll(async () => {
  if (saved.flag === undefined) delete process.env.ENABLE_DEV_ENDPOINTS;
  else process.env.ENABLE_DEV_ENDPOINTS = saved.flag;
  await admin.from("opt_outs").delete().in("phone_e164", usedPhones);
  await cleanupTenants();
});

describe("the demo, three runs in a row", () => {
  it.each([1, 2, 3])("run %i: missed call, first message, complaint escalation, STOP, admin retry", async () => {
    const complainer = newPhone();
    const stopper = newPhone();

    // A missed call opens a conversation and the first message goes out.
    const sentBefore = messaging.sent.length;
    for (const from of [complainer, stopper]) {
      expect((await post(simulateMissedCall, { businessId: tenant.businessId, from })).status).toBe(200);
    }
    await drain();
    expect(messaging.sent.slice(sentBefore).map((m) => m.to).sort()).toEqual([complainer, stopper].sort());
    expect(await conversationState(complainer)).toBe("awaiting_reply");

    // A complaint is handed to a person and the owner is emailed once.
    const emailsBefore = email.sent.length;
    llm.enqueue({
      intent: "complaint", confidence: 0.95, next_action: "escalate", chosen_slot: null, reply: "I'm sorry to hear that.",
      extracted: { name: null, service: null, preferred_date: null, preferred_time: null },
    });
    expect((await post(simulateInbound, { from: complainer, body: "I want to make a complaint" })).status).toBe(200);
    await drain();
    expect(await conversationState(complainer)).toBe("escalated");
    expect(email.sent.length - emailsBefore).toBe(1);

    // STOP opts the customer out and nothing further is sent to them.
    expect((await post(simulateInbound, { from: stopper, body: "STOP" })).status).toBe(200);
    await drain();
    expect(await conversationState(stopper)).toBe("opted_out");
    const afterStop = messaging.sent.length;
    await drain();
    expect(messaging.sent.length).toBe(afterStop);

    // An admin finds a failed automation and retries it.
    const { id } = await enqueueAction(admin, { businessId: tenant.businessId, type: "send_first_message", dedupeKey: `demo:${randomUUID()}` });
    await admin.from("scheduled_actions").update({ status: "failed", attempts: 3, last_error: "demo failure" }).eq("id", id);
    expect((await listFailedActions(admin)).some((f) => f.id === id)).toBe(true);
    expect((await retryFailedAction(admin, adminUserId, id, new Date())).ok).toBe(true);
    expect((await listFailedActions(admin)).some((f) => f.id === id)).toBe(false);
  });
});
