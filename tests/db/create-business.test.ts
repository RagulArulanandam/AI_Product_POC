import { afterAll, describe, expect, it } from "vitest";
import { anonClient, serviceClient } from "../helpers/db";
import { cleanupTenants, createUser, trackBusiness } from "../helpers/tenants";

const admin = serviceClient();

afterAll(cleanupTenants);

const valid = { p_name: "  Bright Smile Dental ", p_phone: "+447911123456", p_timezone: "Europe/London" };

describe("create_business RPC", () => {
  it("creates the business, owner membership and trial subscription together", async () => {
    const user = await createUser("cb-ok");
    const { data: id, error } = await user.client.rpc("create_business", valid);
    expect(error).toBeNull();
    expect(typeof id).toBe("string");
    trackBusiness(id as string);

    const { data: business } = await admin.from("businesses").select("*").eq("id", id).single();
    expect(business).toMatchObject({
      name: "Bright Smile Dental",
      phone_e164: "+447911123456",
      timezone: "Europe/London",
      status: "active",
    });
    expect(business?.business_hours.mon).toEqual({ open: "09:00", close: "17:00" });
    expect(business?.business_hours.sat).toBeNull();

    const { data: membership } = await admin.from("memberships").select("role, user_id").eq("business_id", id);
    expect(membership).toEqual([{ role: "owner", user_id: user.id }]);

    const { data: subscription } = await admin.from("subscriptions").select("status, plan").eq("business_id", id);
    expect(subscription).toEqual([{ status: "trial", plan: "trial" }]);

    // The new owner can read their own business through RLS.
    const own = await user.client.from("businesses").select("id").eq("id", id);
    expect(own.data).toHaveLength(1);
  });

  it("rejects a second business for the same user", async () => {
    const user = await createUser("cb-twice");
    const first = await user.client.rpc("create_business", valid);
    expect(first.error).toBeNull();
    trackBusiness(first.data as string);

    const second = await user.client.rpc("create_business", { ...valid, p_name: "Second" });
    expect(second.error?.message).toContain("already_owner");

    const { count } = await admin
      .from("memberships")
      .select("*", { count: "exact", head: true })
      .eq("user_id", user.id);
    expect(count).toBe(1);
  });

  it.each([
    ["a blank name", { ...valid, p_name: "   " }, "invalid_name"],
    ["a name that is too long", { ...valid, p_name: "x".repeat(121) }, "invalid_name"],
    ["a phone not in E.164", { ...valid, p_phone: "07911 123456" }, "invalid_phone"],
    ["an unknown timezone", { ...valid, p_timezone: "Mars/Base" }, "invalid_timezone"],
  ])("rejects %s and creates nothing", async (_label, args, expected) => {
    const user = await createUser("cb-bad");
    const { error } = await user.client.rpc("create_business", args);
    expect(error?.message).toContain(expected);

    const { count } = await admin
      .from("memberships")
      .select("*", { count: "exact", head: true })
      .eq("user_id", user.id);
    expect(count).toBe(0);
  });

  it("rejects callers who are not signed in", async () => {
    const { error } = await anonClient().rpc("create_business", valid);
    expect(error).not.toBeNull();
  });
});
