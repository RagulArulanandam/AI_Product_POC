// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const { toggle, toastSuccess, toastError } = vi.hoisted(() => ({ toggle: vi.fn(), toastSuccess: vi.fn(), toastError: vi.fn() }));
vi.mock("@/app/(app)/products/actions", () => ({ toggleProductAction: toggle, saveProductConfigAction: vi.fn() }));
vi.mock("sonner", () => ({ toast: { success: toastSuccess, error: toastError } }));

import { ProductCard } from "@/components/products/product-card";
import type { ProductView } from "@/services/products";

afterEach(cleanup);
beforeEach(() => {
  toggle.mockReset();
  toastSuccess.mockReset();
  toastError.mockReset();
});

const base: ProductView = {
  key: "missed-call",
  name: "Missed Call to WhatsApp Assistant",
  description: "Texts customers after a missed call.",
  status: "available",
  enabled: false,
};

describe("ProductCard", () => {
  it("shows an available product as switched off with a working switch and a Configure link", () => {
    render(<ProductCard product={base} />);
    expect(screen.getByText("Missed Call to WhatsApp Assistant")).toBeInTheDocument();
    expect(screen.getByText("Switched off")).toBeInTheDocument();
    expect(screen.getByRole("switch")).not.toBeChecked();
    expect(screen.getByRole("link", { name: /configure/i })).toHaveAttribute("href", "/products/missed-call");
  });

  it("shows an enabled product as running with the switch on", () => {
    render(<ProductCard product={{ ...base, enabled: true }} />);
    expect(screen.getByText("Running")).toBeInTheDocument();
    expect(screen.getByRole("switch")).toBeChecked();
  });

  it("shows a coming soon product with no switch and no Configure link", () => {
    render(<ProductCard product={{ ...base, key: "daily-brief", name: "Daily Brief", status: "coming_soon" }} />);
    expect(screen.getByText("Coming soon")).toBeInTheDocument();
    expect(screen.queryByRole("switch")).not.toBeInTheDocument();
    expect(screen.queryByRole("link", { name: /configure/i })).not.toBeInTheDocument();
  });

  it("turns the product on, and confirms it", async () => {
    toggle.mockResolvedValue({ ok: true, enabled: true });
    render(<ProductCard product={base} />);
    fireEvent.click(screen.getByRole("switch"));

    await waitFor(() => expect(toastSuccess).toHaveBeenCalledWith("Missed Call to WhatsApp Assistant is on"));
    expect(toggle).toHaveBeenCalledWith("missed-call", true);
    expect(screen.getByRole("switch")).toBeChecked();
  });

  it("puts the switch back and explains why when switching on is refused", async () => {
    toggle.mockResolvedValue({ ok: false, code: "subscription", message: "Your subscription is not active." });
    render(<ProductCard product={base} />);
    fireEvent.click(screen.getByRole("switch"));

    await waitFor(() => expect(toastError).toHaveBeenCalledWith("Your subscription is not active."));
    expect(screen.getByRole("switch")).not.toBeChecked();
    expect(toastSuccess).not.toHaveBeenCalled();
  });

  it("turns a running product off", async () => {
    toggle.mockResolvedValue({ ok: true, enabled: false });
    render(<ProductCard product={{ ...base, enabled: true }} />);
    fireEvent.click(screen.getByRole("switch"));
    await waitFor(() => expect(toggle).toHaveBeenCalledWith("missed-call", false));
    await waitFor(() => expect(toastSuccess).toHaveBeenCalledWith("Missed Call to WhatsApp Assistant is off"));
  });
});
