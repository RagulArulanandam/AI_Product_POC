import { describe, expect, it } from "vitest";
import { listProducts } from "@/products/registry";
import { serviceClient } from "../helpers/db";

// The registry (code) is the source of truth; the `products` table is seeded by a migration.
// If they drift, a product could be listed in one place and missing in the other.
describe("products table matches the registry", () => {
  it("has exactly the registered products with the same name, description and status", async () => {
    const { data, error } = await serviceClient()
      .from("products")
      .select("key, name, description, status")
      .order("key");
    expect(error).toBeNull();

    const expected = listProducts()
      .map((p) => ({ key: p.key, name: p.name, description: p.description, status: p.status }))
      .sort((a, b) => a.key.localeCompare(b.key));
    expect(data).toEqual(expected);
  });
});
