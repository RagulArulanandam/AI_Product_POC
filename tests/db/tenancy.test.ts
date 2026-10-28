import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { serviceClient } from "../helpers/db";
import { addStaff, cleanupTenants, createTenant, type TestUser, type Tenant } from "../helpers/tenants";

let a: Tenant;
let staffA: TestUser;
const admin = serviceClient();

beforeAll(async () => {
  a = await createTenant("ten-a");
  staffA = await addStaff(a);
});

afterAll(cleanupTenants);

describe("tenancy core", () => {
  it("lets a member edit profile fields of their business", async () => {
    const { data, error } = await a.owner.client
      .from("businesses")
      .update({ name: "Renamed Clinic", timezone: "Europe/Paris" })
      .eq("id", a.businessId)
      .select("name, timezone")
      .single();
    expect(error).toBeNull();
    expect(data).toEqual({ name: "Renamed Clinic", timezone: "Europe/Paris" });
  });

  it("stops tenants from changing businesses.status", async () => {
    const res = await a.owner.client.from("businesses").update({ status: "disabled" }).eq("id", a.businessId).select();
    expect(res.error).not.toBeNull();

    const { data } = await admin.from("businesses").select("status").eq("id", a.businessId).single();
    expect(data?.status).toBe("active");
  });

  it("rejects invalid phone numbers", async () => {
    const { error } = await admin.from("businesses").insert({ name: "Bad phone", phone_e164: "07700 900123" });
    expect(error).not.toBeNull();
  });

  it("rejects an unknown status and an unknown role", async () => {
    const bad = await admin
      .from("businesses")
      .insert({ name: "Bad status", phone_e164: "+447700900111", status: "paused" });
    expect(bad.error).not.toBeNull();

    const badRole = await admin
      .from("memberships")
      .insert({ business_id: a.businessId, user_id: staffA.id, role: "boss" });
    expect(badRole.error).not.toBeNull();
  });

  it("enforces one membership per user per business", async () => {
    const { error } = await admin
      .from("memberships")
      .insert({ business_id: a.businessId, user_id: staffA.id, role: "staff" });
    expect(error).not.toBeNull();
  });

  it("lets members see all memberships of their own business", async () => {
    const { data } = await staffA.client.from("memberships").select("user_id").eq("business_id", a.businessId);
    expect((data ?? []).map((r) => r.user_id).sort()).toEqual([a.owner.id, staffA.id].sort());
  });

  it("sets updated_at on update", async () => {
    const { data: before } = await admin.from("businesses").select("updated_at").eq("id", a.businessId).single();
    await new Promise((r) => setTimeout(r, 20));
    await admin.from("businesses").update({ name: "Touched" }).eq("id", a.businessId);
    const { data: after } = await admin.from("businesses").select("updated_at").eq("id", a.businessId).single();
    expect(new Date(after!.updated_at).getTime()).toBeGreaterThan(new Date(before!.updated_at).getTime());
  });
});
