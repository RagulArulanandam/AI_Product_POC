// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const { toastSuccess, toastError, setProduct } = vi.hoisted(() => ({ toastSuccess: vi.fn(), toastError: vi.fn(), setProduct: vi.fn() }));
vi.mock("sonner", () => ({ toast: { success: toastSuccess, error: toastError } }));
vi.mock("@/app/admin/actions", () => ({ setProductAction: setProduct, saveSubscriptionAction: vi.fn() }));
vi.mock("next/navigation", () => ({ usePathname: () => "/admin" }));

import { AdminProductToggle } from "@/components/admin/admin-product-toggle";
import { isAdminActive } from "@/components/admin/admin-nav";
import { ConfirmActionButton } from "@/components/admin/confirm-action-button";
import { LogFilter, LogsTable, summariseDetails } from "@/components/admin/logs-table";
import { integrationProviderLabel, logStatus } from "@/lib/ui/status";
import { subscriptionSchema } from "@/lib/validation/admin";

afterEach(cleanup);
beforeEach(() => {
  for (const fn of [toastSuccess, toastError, setProduct]) fn.mockReset();
});

describe("ConfirmActionButton", () => {
  it("asks first, then runs the action and shows its message", async () => {
    const action = vi.fn().mockResolvedValue({ ok: true, message: "Queued to run again." });
    render(<ConfirmActionButton action={action} label="Retry" confirmLabel="Yes, retry" />);

    fireEvent.click(screen.getByRole("button", { name: "Retry" }));
    expect(action).not.toHaveBeenCalled();
    fireEvent.click(screen.getByRole("button", { name: "Yes, retry" }));

    await waitFor(() => expect(toastSuccess).toHaveBeenCalledWith("Queued to run again."));
    expect(action).toHaveBeenCalledTimes(1);
    expect(screen.getByRole("button", { name: "Retry" })).toBeInTheDocument();
  });

  it("does nothing when cancelled and shows a refusal as an error", async () => {
    const action = vi.fn().mockResolvedValue({ ok: false, message: "That action is no longer failed." });
    render(<ConfirmActionButton action={action} label="Retry" confirmLabel="Yes, retry" />);

    fireEvent.click(screen.getByRole("button", { name: "Retry" }));
    fireEvent.click(screen.getByRole("button", { name: "Cancel" }));
    expect(action).not.toHaveBeenCalled();

    fireEvent.click(screen.getByRole("button", { name: "Retry" }));
    fireEvent.click(screen.getByRole("button", { name: "Yes, retry" }));
    await waitFor(() => expect(toastError).toHaveBeenCalledWith("That action is no longer failed."));
  });
});

describe("AdminProductToggle", () => {
  it("switches on and reports it", async () => {
    setProduct.mockResolvedValue({ ok: true, message: "Missed Call switched on" });
    render(<AdminProductToggle businessId="b1" productKey="missed-call" enabled={false} label="Missed Call" />);

    fireEvent.click(screen.getByRole("switch", { name: "Missed Call on or off" }));
    await waitFor(() => expect(toastSuccess).toHaveBeenCalledWith("Missed Call switched on"));
    expect(setProduct).toHaveBeenCalledWith("b1", "missed-call", true);
    expect(screen.getByRole("switch")).toBeChecked();
  });

  it("puts the switch back when refused", async () => {
    setProduct.mockResolvedValue({ ok: false, message: "Could not update the product." });
    render(<AdminProductToggle businessId="b1" productKey="missed-call" enabled={false} label="Missed Call" />);

    fireEvent.click(screen.getByRole("switch"));
    await waitFor(() => expect(toastError).toHaveBeenCalledWith("Could not update the product."));
    expect(screen.getByRole("switch")).not.toBeChecked();
  });
});

describe("logs", () => {
  const row = (over: Partial<Parameters<typeof LogsTable>[0]["rows"][number]> = {}) => ({
    id: "1",
    businessId: "b",
    businessName: "Bright Smile",
    eventType: "call_missed",
    step: "action",
    status: "error",
    reason: "send_failed",
    details: { error: "Twilio 21614" },
    createdAt: "2026-10-28T12:00:00Z",
    ...over,
  });

  it("shows status, reason and the short error", () => {
    render(<LogsTable rows={[row()]} />);
    expect(screen.getByText("Error")).toBeInTheDocument();
    expect(screen.getByText("send_failed: Twilio 21614")).toBeInTheDocument();
    expect(screen.getByText("call missed")).toBeInTheDocument();
  });

  it("says so when nothing matches", () => {
    render(<LogsTable rows={[]} />);
    expect(screen.getByText("No log entries")).toBeInTheDocument();
  });

  it("filters are plain links and mark the active one", () => {
    render(<LogFilter basePath="/admin/businesses/x" active="error" />);
    expect(screen.getByRole("link", { name: "All" })).toHaveAttribute("href", "/admin/businesses/x");
    expect(screen.getByRole("link", { name: "Error" })).toHaveAttribute("href", "/admin/businesses/x?status=error");
    expect(screen.getByRole("link", { name: "Error" })).toHaveAttribute("aria-current", "true");
  });

  it("summarises details without dumping the payload", () => {
    expect(summariseDetails({ error: "boom", secret: "x" })).toBe("boom");
    expect(summariseDetails({ product: "missed-call" })).toBe("missed-call");
    expect(summariseDetails({ nested: { a: 1 } })).toBe("");
    expect(summariseDetails(null)).toBe("");
  });
});

describe("helpers", () => {
  it("keeps Businesses highlighted on a business page, Failures only on its own", () => {
    expect(isAdminActive("/admin", "/admin")).toBe(true);
    expect(isAdminActive("/admin/businesses/abc", "/admin")).toBe(true);
    expect(isAdminActive("/admin/failures", "/admin")).toBe(false);
    expect(isAdminActive("/admin/failures", "/admin/failures")).toBe(true);
  });

  it("labels log statuses and providers", () => {
    expect(logStatus("ok")).toEqual({ label: "OK", tone: "success" });
    expect(logStatus("error").tone).toBe("danger");
    expect(logStatus("weird")).toEqual({ label: "weird", tone: "neutral" });
    expect(integrationProviderLabel("google_calendar")).toBe("Google Calendar");
    expect(integrationProviderLabel("some_thing")).toBe("some thing");
  });

  it("validates the subscription form", () => {
    const ok = subscriptionSchema.safeParse({ status: "active", plan: " pro ", currentPeriodEnd: "2026-12-31", notes: "" });
    expect(ok.success && ok.data).toEqual({ status: "active", plan: "pro", currentPeriodEnd: "2026-12-31T23:59:59.000Z", notes: "" });
    expect(subscriptionSchema.safeParse({ status: "active", plan: "pro", currentPeriodEnd: "", notes: "" }).data?.currentPeriodEnd).toBeNull();
    expect(subscriptionSchema.safeParse({ status: "gold", plan: "pro", currentPeriodEnd: "", notes: "" }).success).toBe(false);
    expect(subscriptionSchema.safeParse({ status: "active", plan: "", currentPeriodEnd: "", notes: "" }).success).toBe(false);
    expect(subscriptionSchema.safeParse({ status: "active", plan: "pro", currentPeriodEnd: "31/12/2026", notes: "" }).success).toBe(false);
  });
});
