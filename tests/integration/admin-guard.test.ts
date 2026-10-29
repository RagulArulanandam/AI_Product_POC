import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { serviceClient } from "../helpers/db";
import { cleanupTenants, createTenant, createUser, type TestUser } from "../helpers/tenants";

// The guards read the signed-in user from cookies; here the "request" is whoever `current` points at.
const state = vi.hoisted(() => ({ current: null as null | { client: unknown } }));

vi.mock("server-only", () => ({}));
vi.mock("react", async (importOriginal) => ({ ...(await importOriginal<typeof import("react")>()), cache: <T>(fn: T) => fn }));
vi.mock("next/navigation", () => ({
  notFound: () => {
    throw new Error("NEXT_NOT_FOUND");
  },
  redirect: (to: string) => {
    throw new Error(`NEXT_REDIRECT:${to}`);
  },
}));
vi.mock("@/lib/supabase/server", () => ({ createClient: async () => state.current!.client }));

import { requireAdmin, requireBusiness } from "@/lib/auth/guards";

const admin = serviceClient();
let owner: TestUser;
let platformAdmin: TestUser;

beforeAll(async () => {
  const tenant = await createTenant("guard");
  owner = tenant.owner;
  platformAdmin = await createUser("guard-admin");
  await admin.from("platform_admins").insert({ user_id: platformAdmin.id });
});

afterAll(async () => {
  await admin.from("platform_admins").delete().eq("user_id", platformAdmin.id);
  await cleanupTenants();
});

beforeEach(() => {
  state.current = null;
});

describe("requireAdmin", () => {
  it("gives a business owner a 404, so the admin area is not revealed", async () => {
    state.current = owner;
    await expect(requireAdmin()).rejects.toThrow("NEXT_NOT_FOUND");
  });

  it("gives a user with no business a 404 too", async () => {
    state.current = await createUser("guard-nobody");
    await expect(requireAdmin()).rejects.toThrow("NEXT_NOT_FOUND");
  });

  it("lets a platform admin through with a service-role client", async () => {
    state.current = platformAdmin;
    const { user, admin: client } = await requireAdmin();
    expect(user.id).toBe(platformAdmin.id);
    expect((await client.from("businesses").select("id").limit(2)).data!.length).toBeGreaterThan(0);
  });
});

describe("requireBusiness for admins", () => {
  it("sends a platform admin (who has no business) to the admin panel, not onboarding", async () => {
    state.current = platformAdmin;
    await expect(requireBusiness()).rejects.toThrow("NEXT_REDIRECT:/admin");
  });

  it("still sends an ordinary user without a business to onboarding", async () => {
    state.current = await createUser("guard-new");
    await expect(requireBusiness()).rejects.toThrow("NEXT_REDIRECT:/onboarding");
  });

  it("lets a business owner into their business", async () => {
    state.current = owner;
    const { business } = await requireBusiness();
    expect(business.name).toMatch(/^Test /);
  });
});
