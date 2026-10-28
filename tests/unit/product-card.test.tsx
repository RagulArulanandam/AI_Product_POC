// @vitest-environment jsdom
import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";
import { ProductCard } from "@/components/products/product-card";
import type { ProductView } from "@/services/products";

afterEach(cleanup);

const base: ProductView = {
  key: "missed-call",
  name: "Missed Call to WhatsApp Assistant",
  description: "Texts customers after a missed call.",
  status: "available",
  enabled: false,
};

describe("ProductCard", () => {
  it("shows an available product as Off until the business enables it", () => {
    render(<ProductCard product={base} />);
    expect(screen.getByText("Missed Call to WhatsApp Assistant")).toBeInTheDocument();
    expect(screen.getByText("Off")).toBeInTheDocument();
    expect(screen.queryByText("Coming soon")).not.toBeInTheDocument();
  });

  it("shows an enabled product as On", () => {
    render(<ProductCard product={{ ...base, enabled: true }} />);
    expect(screen.getByText("On")).toBeInTheDocument();
  });

  it("shows a coming soon product without an on/off state", () => {
    render(<ProductCard product={{ ...base, key: "daily-brief", name: "Daily Brief", status: "coming_soon" }} />);
    expect(screen.getByText("Coming soon")).toBeInTheDocument();
    expect(screen.queryByText("On")).not.toBeInTheDocument();
    expect(screen.queryByText("Off")).not.toBeInTheDocument();
  });
});
