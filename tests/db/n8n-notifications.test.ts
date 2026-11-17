import type { Client } from "pg";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { anonClient, pgClient } from "../helpers/db";
import { cleanupTenants, createUser } from "../helpers/tenants";

let pg: Client;

beforeAll(async () => {
  pg = await pgClient();
});

afterAll(async () => {
  await pg.end();
  await cleanupTenants();
});

/** Runs `fn` inside a transaction that is always rolled back, with the n8n settings stored in Vault. */
async function withN8n<T>(fn: () => Promise<T>, configured = true): Promise<T> {
  await pg.query("begin");
  try {
    await pg.query("delete from vault.secrets where name in ('n8n_webhook_url', 'n8n_webhook_secret')");
    if (configured) {
      await pg.query("select vault.create_secret('http://127.0.0.1:9/hook', 'n8n_webhook_url')");
      await pg.query("select vault.create_secret('test-secret-value', 'n8n_webhook_secret')");
    }
    return await fn();
  } finally {
    await pg.query("rollback");
  }
}

interface Queued {
  url: string;
  headers: Record<string, string>;
  body: Record<string, unknown>;
}

async function queued(): Promise<Queued[]> {
  const { rows } = await pg.query(
    "select url, headers, convert_from(body, 'UTF8')::jsonb as body from net.http_request_queue where url = 'http://127.0.0.1:9/hook' order by id",
  );
  return rows;
}

async function newBusiness(name = "N8n Test Clinic"): Promise<string> {
  const { rows } = await pg.query("insert into public.businesses (name, phone_e164) values ($1, '+442079460958') returning id", [name]);
  return rows[0].id;
}

function log(businessId: string, reason: string, status = "ok", details: object = {}) {
  return pg.query(
    "insert into public.automation_logs (business_id, event_type, step, status, reason, details) values ($1, 'call.missed', 'action', $2, $3, $4::jsonb)",
    [businessId, status, reason, JSON.stringify(details)],
  );
}

describe("n8n notifications", () => {
  it("sends nothing, and does not fail, when n8n is not configured", async () => {
    await withN8n(async () => {
      const id = await newBusiness();
      await expect(log(id, "escalated", "ok", { reason: "complaint" })).resolves.toBeDefined();
      expect(await queued()).toHaveLength(0);
    }, false);
  });

  it.each([
    ["first_message_scheduled", "ok", "missed_call"],
    ["escalated", "ok", "escalated"],
    ["booking_created", "ok", "booked"],
    ["opted_out", "ok", "opted_out"],
    ["send_failed", "error", "error"],
  ])("sends one message for %s (%s) as type %s", async (reason, status, type) => {
    await withN8n(async () => {
      const id = await newBusiness();
      await log(id, reason, status);
      const sent = await queued();
      expect(sent).toHaveLength(1);
      expect(sent[0].body).toMatchObject({ type, business_id: id, business_name: "N8n Test Clinic", reason, status });
    });
  });

  it("sends the shared secret in a header, never in the body", async () => {
    await withN8n(async () => {
      await log(await newBusiness(), "escalated");
      const [message] = await queued();
      expect(message.headers["X-Webhook-Secret"]).toBe("test-secret-value");
      expect(JSON.stringify(message.body)).not.toContain("test-secret-value");
    });
  });

  it("carries only the safe detail: the escalation reason or the booked time", async () => {
    await withN8n(async () => {
      const id = await newBusiness();
      await log(id, "escalated", "ok", { reason: "complaint", customerPhone: "+447700900123", text: "private words" });
      await log(id, "booking_created", "ok", { start: "2026-11-18T10:00:00.000Z", eventId: "secret-event" });
      const [escalated, booked] = await queued();
      expect(escalated.body.detail).toBe("complaint");
      expect(booked.body.detail).toBe("2026-11-18T10:00:00.000Z");
      const text = JSON.stringify([escalated.body, booked.body]);
      for (const leaked of ["+447700900123", "private words", "secret-event"]) expect(text).not.toContain(leaked);
    });
  });

  it("stays quiet for routine log rows", async () => {
    await withN8n(async () => {
      const id = await newBusiness();
      for (const reason of ["action_done", "conditions_passed", "escalation_email_sent"]) await log(id, reason);
      expect(await queued()).toHaveLength(0);
    });
  });

  it("sends a daily summary with each business's last-24-hour counts", async () => {
    await withN8n(async () => {
      const id = await newBusiness("Summary Clinic");
      const { rows: product } = await pg.query("select id from public.products where key = 'missed-call'");
      for (const [state, reason] of [["booked", null], ["escalated", "complaint"], ["awaiting_reply", null]] as const) {
        const { rows: c } = await pg.query(
          "insert into public.customers (business_id, phone_e164) values ($1, $2) returning id",
          [id, `+4477009002${Math.floor(Math.random() * 90) + 10}`],
        );
        await pg.query(
          "insert into public.conversations (business_id, customer_id, product_id, state, escalation_reason) values ($1, $2, $3, $4, $5)",
          [id, c[0].id, product[0].id, state, reason],
        );
      }

      await pg.query("select public.send_daily_summary()");
      const summary = (await queued()).find((m) => m.body.type === "daily_summary")!;
      const row = (summary.body.businesses as { name: string; calls: number; bookings: number; handed_over: number }[]).find((b) => b.name === "Summary Clinic");
      expect(row).toEqual({ name: "Summary Clinic", calls: 3, bookings: 1, handed_over: 1 });
      expect(typeof summary.body.failed_actions).toBe("number");
    });
  });

  it("is scheduled daily", async () => {
    const { rows } = await pg.query("select schedule, command from cron.job where jobname = 'daily-summary'");
    expect(rows).toEqual([{ schedule: "0 8 * * *", command: "select public.send_daily_summary()" }]);
  });

  it("cannot be called by tenants or anon", async () => {
    const user = await createUser("n8n");
    for (const fn of ["notify_n8n", "send_daily_summary"]) {
      const args = fn === "notify_n8n" ? { payload: {} } : undefined;
      expect((await user.client.rpc(fn, args)).error, fn).not.toBeNull();
      expect((await anonClient().rpc(fn, args)).error, fn).not.toBeNull();
    }
  });
});
