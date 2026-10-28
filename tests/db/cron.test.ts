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
  it("is scheduled every minute", async () => {
    const { rows } = await pg.query("select schedule, command, active from cron.job where jobname = 'worker-tick'");
    expect(rows).toEqual([{ schedule: "* * * * *", command: "select public.call_worker()", active: true }]);
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
