// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const { disconnect, toastSuccess, toastError, save, refresh } = vi.hoisted(() => ({
  disconnect: vi.fn(),
  toastSuccess: vi.fn(),
  toastError: vi.fn(),
  save: vi.fn(),
  refresh: vi.fn(),
}));
vi.mock("@/app/(app)/integrations/actions", () => ({ disconnectCalendarAction: disconnect, confirmForwardingAction: vi.fn() }));
vi.mock("@/app/(app)/products/actions", () => ({ saveProductConfigAction: save, toggleProductAction: vi.fn() }));
vi.mock("next/navigation", () => ({ useRouter: () => ({ refresh }) }));
vi.mock("sonner", () => ({ toast: { success: toastSuccess, error: toastError } }));

import { CalendarCard } from "@/components/integrations/calendar-card";
import { DEFAULT_BUSINESS_HOURS } from "@/lib/validation/hours";
import { calendarFlash } from "@/lib/ui/calendar-flash";
import { missedCallConfigSchema } from "@/products/missed-call/config";
import { MissedCallForm } from "@/products/missed-call/form";

afterEach(cleanup);
beforeEach(() => {
  for (const fn of [disconnect, toastSuccess, toastError, save, refresh]) fn.mockReset();
});

describe("CalendarCard", () => {
  it("offers a Connect link to the sign-in route when disconnected", () => {
    render(<CalendarCard status="disconnected" accountLabel={null} lastError={null} available />);
    expect(screen.getByText("Not connected")).toBeInTheDocument();
    expect(screen.getByRole("link", { name: "Connect Google Calendar" })).toHaveAttribute("href", "/api/integrations/google/connect");
  });

  it("explains, and disables the button, when the platform has no Google details yet", () => {
    render(<CalendarCard status="disconnected" accountLabel={null} lastError={null} available={false} />);
    expect(screen.getByText(/Google details are missing/)).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Connect Google Calendar" })).toBeDisabled();
    expect(screen.queryByRole("link", { name: /connect google calendar/i })).not.toBeInTheDocument();
  });

  it("shows the connected account and asks before disconnecting", async () => {
    disconnect.mockResolvedValue({ ok: true, message: "Calendar disconnected" });
    render(<CalendarCard status="connected" accountLabel="owner@example.com" lastError={null} available />);
    expect(screen.getByText("owner@example.com")).toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: "Disconnect" }));
    expect(disconnect).not.toHaveBeenCalled();
    fireEvent.click(screen.getByRole("button", { name: "Keep connected" }));
    expect(screen.getByRole("button", { name: "Disconnect" })).toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: "Disconnect" }));
    fireEvent.click(screen.getByRole("button", { name: "Yes, disconnect" }));
    await waitFor(() => expect(disconnect).toHaveBeenCalledTimes(1));
    await waitFor(() => expect(toastSuccess).toHaveBeenCalledWith("Calendar disconnected"));
  });

  it("shows the problem and a Reconnect link when Google stopped allowing access", () => {
    render(<CalendarCard status="error" accountLabel={null} lastError="Google rejected the saved access. Reconnect your calendar." available />);
    expect(screen.getByRole("alert")).toHaveTextContent("needs reconnecting");
    expect(screen.getByRole("alert")).toHaveTextContent("Google rejected the saved access");
    expect(screen.getByRole("link", { name: "Reconnect Google Calendar" })).toHaveAttribute("href", "/api/integrations/google/connect");
  });

  it("reports a failed disconnect", async () => {
    disconnect.mockResolvedValue({ ok: false, message: "You do not have permission to do that." });
    render(<CalendarCard status="connected" accountLabel="a@b.c" lastError={null} available />);
    fireEvent.click(screen.getByRole("button", { name: "Disconnect" }));
    fireEvent.click(screen.getByRole("button", { name: "Yes, disconnect" }));
    await waitFor(() => expect(toastError).toHaveBeenCalledWith("You do not have permission to do that."));
  });
});

describe("calendarFlash", () => {
  it("has a message for every outcome the routes can send", () => {
    for (const key of ["connected", "denied", "no_access", "failed", "not_configured", "forbidden"]) {
      expect(calendarFlash(key)?.title).toBeTruthy();
    }
    expect(calendarFlash("connected")?.tone).toBe("success");
    expect(calendarFlash("failed")?.tone).toBe("danger");
  });

  it("ignores anything else, including names from the object prototype", () => {
    expect(calendarFlash(undefined)).toBeNull();
    expect(calendarFlash("")).toBeNull();
    expect(calendarFlash("<script>")).toBeNull();
    expect(calendarFlash("constructor")).toBeNull();
    expect(calendarFlash("toString")).toBeNull();
  });

  it("uses the first value when the parameter is repeated", () => {
    expect(calendarFlash(["denied", "connected"])?.title).toBe("Calendar not connected");
  });
});

describe("MissedCallForm booking section", () => {
  const config = (booking_enabled: boolean) => missedCallConfigSchema.parse({ booking_enabled });
  const renderForm = (booking: boolean, calendarStatus?: "connected" | "disconnected" | "error") =>
    render(
      <MissedCallForm initial={config(booking)} businessName="Bright Smile Dental" profileHours={DEFAULT_BUSINESS_HOURS} timezone="Europe/London" calendarStatus={calendarStatus} />,
    );

  it("says real times will be offered when the calendar is connected", () => {
    renderForm(true, "connected");
    expect(screen.getByText(/offers times that are free in your Google Calendar/)).toBeInTheDocument();
    expect(screen.queryByText(/No calendar connected yet/)).not.toBeInTheDocument();
  });

  it("points to Integrations when booking is on but there is no calendar", () => {
    renderForm(true, "disconnected");
    expect(screen.getByText(/No calendar connected yet/)).toBeInTheDocument();
    expect(screen.getByRole("link", { name: "Connect Google Calendar" })).toHaveAttribute("href", "/integrations");
  });

  it("warns that bookings are passed to the owner while the calendar needs reconnecting", () => {
    renderForm(true, "error");
    expect(screen.getByText(/needs reconnecting/)).toBeInTheDocument();
    expect(screen.getByRole("link", { name: "Reconnect it" })).toBeInTheDocument();
  });

  it("stays quiet about the calendar when booking is off", () => {
    renderForm(false, "disconnected");
    expect(screen.queryByText(/No calendar connected yet/)).not.toBeInTheDocument();
  });
});
