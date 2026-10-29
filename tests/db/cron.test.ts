import type { Client } from "pg";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { anonClient } from "../helpers/db";
import { cleanupTenants, createUser } from "../helpers/tenants";
import { pgClient } from "../helpers/db";

let pg: Client;

beforeAll(async () => {
  pg = await pgClient();
});

afterAll(async () => {
  await pg.end();
  await cleanupTenants();
});

describe("worker cron job", () => {
  // The job is paused while DB tests run (tests/helpers/cron-pause.ts), so `active` is not checked here.
  it("is scheduled every minute", async () => {
    const { rows } = await pg.query("select schedule, command from cron.job where jobname = 'worker-tick'");
    expect(rows).toEqual([{ schedule: "* * * * *", command: "select public.call_worker()" }]);
  });

  it("keeps the URL and secret out of the migration and the job definition", async () => {
    const { rows } = await pg.query("select command from cron.job where jobname = 'worker-tick'");
    expect(rows[0].command).not.toMatch(/http|Bearer|secret/i);
  });

  it("does nothing, without error, when the worker is not configured", async () => {
    await pg.query("begin");
    try {
      await pg.query("delete from vault.secrets where name in ('worker_url', 'worker_secret')");
      await expect(pg.query("select public.call_worker()")).resolves.toBeDefined();
    } finally {
      await pg.query("rollback");
    }
  });

  it("is not callable by tenants or anon", async () => {
    const user = await createUser("cron");
    expect((await user.client.rpc("call_worker")).error).not.toBeNull();
    expect((await anonClient().rpc("call_worker")).error).not.toBeNull();
  });
});

describe("webhook payload retention", () => {
  it("is scheduled daily", async () => {
    const { rows } = await pg.query("select schedule, command from cron.job where jobname = 'purge-webhook-payloads'");
    expect(rows).toEqual([{ schedule: "15 3 * * *", command: "select public.purge_webhook_payloads()" }]);
  });

  it("empties payloads older than 30 days and keeps the row, leaving newer ones alone", async () => {
    await pg.query("begin");
    try {
      await pg.query(
        `insert into public.webhook_events (provider, provider_event_id, payload, received_at) values
           ('retention-test', 'old', '{"data":{"from":"+447700900111"}}', now() - interval '31 days'),
           ('retention-test', 'recent', '{"data":{"from":"+447700900222"}}', now() - interval '29 days')`,
      );
      const { rows: purged } = await pg.query("select public.purge_webhook_payloads() as n");
      expect(purged[0].n).toBeGreaterThanOrEqual(1);

      const { rows } = await pg.query(
        "select provider_event_id, payload from public.webhook_events where provider = 'retention-test' order by provider_event_id",
      );
      expect(rows).toEqual([
        { provider_event_id: "old", payload: {} },
        { provider_event_id: "recent", payload: { data: { from: "+447700900222" } } },
      ]);
    } finally {
      await pg.query("rollback");
    }
  });

  it("is not callable by tenants or anon", async () => {
    const user = await createUser("retention");
    expect((await user.client.rpc("purge_webhook_payloads")).error).not.toBeNull();
    expect((await anonClient().rpc("purge_webhook_payloads")).error).not.toBeNull();
  });
});
