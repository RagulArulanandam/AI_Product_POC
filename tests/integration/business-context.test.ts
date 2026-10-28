import type { SupabaseClient } from "@supabase/supabase-js";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { isPlatformAdmin, resolveBusinessContext } from "@/lib/auth/context";
import type { Database } from "@/lib/database.types";
import { createBusiness } from "@/services/businesses";
import { serviceClient } from "../helpers/db";
import { addStaff, cleanupTenants, createTenant, createUser, trackBusiness, type TestUser, type Tenant } from "../helpers/tenants";

// What the server guards (requireBusiness, requireAdmin) decide, tested against the real database.

const typed = (c: SupabaseClient) => c as unknown as SupabaseClient<Database>;
const admin = serviceClient();

let a: Tenant;
let b: Tenant;
let staffA: TestUser;
let drifter: TestUser; // signed up, no business yet

beforeAll(async () => {
  a = await createTenant("ctx-a");
  b = await createTenant("ctx-b");
  staffA = await addStaff(a);
  drifter = await createUser("ctx-drifter");
});

afterAll(async () => {
  await admin.from("platform_admins").delete().eq("user_id", a.owner.id);
  await cleanupTenants();
});

describe("resolveBusinessContext", () => {
  it("reports no_business for a user without a membership (guard sends them to onboarding)", async () => {
    expect(await resolveBusinessContext(typed(drifter.client), drifter.id)).toEqual({ kind: "no_business" });
  });

  it("returns the owner's own business", async () => {
    const ctx = await resolveBusinessContext(typed(a.owner.client), a.owner.id);
    expect(ctx.kind).toBe("ok");
    if (ctx.kind === "ok") {
      expect(ctx.role).toBe("owner");
      expect(ctx.business.id).toBe(a.businessId);
    }
  });

  it("returns the staff role for a staff member", async () => {
    const ctx = await resolveBusinessContext(typed(staffA.client), staffA.id);
    expect(ctx.kind === "ok" && ctx.role).toBe("staff");
  });

  it("never resolves another tenant's business", async () => {
    const ctx = await resolveBusinessContext(typed(a.owner.client), a.owner.id);
    expect(ctx.kind === "ok" && ctx.business.id).not.toBe(b.businessId);
    // Asking for B's user id through A's session finds nothing (RLS hides B's memberships).
    expect(await resolveBusinessContext(typed(a.owner.client), b.owner.id)).toEqual({ kind: "no_business" });
  });

  it("reports disabled businesses (guard shows the notice)", async () => {
    const t = await createTenant("ctx-disabled");
    await admin.from("businesses").update({ status: "disabled" }).eq("id", t.businessId);
    const ctx = await resolveBusinessContext(typed(t.owner.client), t.owner.id);
    expect(ctx.kind).toBe("disabled");
  });
});

describe("isPlatformAdmin", () => {
  it("is false for ordinary users and true for listed admins", async () => {
    expect(await isPlatformAdmin(typed(admin), a.owner.id)).toBe(false);
    await admin.from("platform_admins").insert({ user_id: a.owner.id });
    expect(await isPlatformAdmin(typed(admin), a.owner.id)).toBe(true);
    expect(await isPlatformAdmin(typed(admin), b.owner.id)).toBe(false);
  });

  it("does not make an admin a member of any business", async () => {
    const t = await createTenant("ctx-admin");
    await admin.from("platform_admins").insert({ user_id: t.owner.id });
    // t.owner is also an owner of their own business, but sees nothing of B through RLS.
    const { data } = await t.owner.client.from("businesses").select("id").eq("id", b.businessId);
    expect(data ?? []).toHaveLength(0);
  });

  it("is invisible to tenant clients", async () => {
    const res = await a.owner.client.from("platform_admins").select("*");
    expect(res.data ?? []).toHaveLength(0);
  });
});

describe("createBusiness service", () => {
  it("creates a business for a signed-in user", async () => {
    const result = await createBusiness(typed(drifter.client), {
      name: "Glow Beauty",
      phone: "+447911123457",
      timezone: "Europe/London",
    });
    expect(result.ok).toBe(true);
    if (result.ok) trackBusiness(result.businessId);

    const ctx = await resolveBusinessContext(typed(drifter.client), drifter.id);
    expect(ctx.kind).toBe("ok");
  });

  it("maps a second attempt to already_owner", async () => {
    const result = await createBusiness(typed(drifter.client), {
      name: "Another",
      phone: "+447911123458",
      timezone: "Europe/London",
    });
    expect(result).toMatchObject({ ok: false, code: "already_owner" });
  });

  it("maps invalid details to invalid", async () => {
    const user = await createUser("ctx-invalid");
    const result = await createBusiness(typed(user.client), {
      name: "Bad Phone",
      phone: "not-e164",
      timezone: "Europe/London",
    });
    expect(result).toMatchObject({ ok: false, code: "invalid" });
  });
});
