// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const { update, refresh, toastSuccess, toastError } = vi.hoisted(() => ({
  update: vi.fn(),
  refresh: vi.fn(),
  toastSuccess: vi.fn(),
  toastError: vi.fn(),
}));
vi.mock("@/app/(app)/settings/actions", () => ({ updateBusinessAction: update }));
vi.mock("next/navigation", () => ({ useRouter: () => ({ refresh }) }));
vi.mock("sonner", () => ({ toast: { success: toastSuccess, error: toastError } }));

import { BusinessSettingsForm } from "@/components/settings/business-settings-form";
import { DEFAULT_BUSINESS_HOURS } from "@/lib/validation/hours";

afterEach(cleanup);
beforeEach(() => {
  for (const fn of [update, refresh, toastSuccess, toastError]) fn.mockReset();
  window.HTMLElement.prototype.scrollIntoView = vi.fn();
});

const initial = { name: "Bright Smile Dental", phone: "07911 123456", timezone: "Europe/London", business_hours: DEFAULT_BUSINESS_HOURS };
const timezones = ["Europe/London", "Europe/Paris", "America/New_York"];

describe("BusinessSettingsForm", () => {
  it("shows the saved details with nothing to save yet", () => {
    render(<BusinessSettingsForm initial={initial} timezones={timezones} />);
    expect(screen.getByLabelText("Business name")).toHaveValue("Bright Smile Dental");
    expect(screen.getByLabelText("Business phone number")).toHaveValue("07911 123456");
    expect(screen.getByLabelText("Timezone")).toHaveValue("Europe/London");
    expect(screen.getByLabelText("Monday opens")).toHaveValue("09:00");
    expect(screen.getByRole("button", { name: /save changes/i })).toBeDisabled();
    expect(screen.getByText("All changes saved")).toBeInTheDocument();
  });

  it("saves the edited details as JSON and confirms", async () => {
    update.mockResolvedValue({ ok: true });
    render(<BusinessSettingsForm initial={initial} timezones={timezones} />);
    fireEvent.change(screen.getByLabelText("Business name"), { target: { value: "Bright Smile Dental Ltd" } });
    fireEvent.change(screen.getByLabelText("Timezone"), { target: { value: "Europe/Paris" } });
    fireEvent.click(screen.getByLabelText("Saturday open"));
    fireEvent.click(screen.getByRole("button", { name: /save changes/i }));

    await waitFor(() => expect(update).toHaveBeenCalledTimes(1));
    expect(JSON.parse(update.mock.calls[0][0])).toMatchObject({
      name: "Bright Smile Dental Ltd",
      phone: "07911 123456",
      timezone: "Europe/Paris",
      business_hours: { sat: { open: "09:00", close: "17:00" }, mon: { open: "09:00", close: "17:00" } },
    });
    await waitFor(() => expect(toastSuccess).toHaveBeenCalledWith("Business details saved"));
    expect(refresh).toHaveBeenCalled();
    expect(screen.getByText("All changes saved")).toBeInTheDocument();
  });

  it("shows each field's error and keeps the edits when saving fails", async () => {
    update.mockResolvedValue({
      ok: false,
      message: "Please fix the highlighted fields.",
      fieldErrors: { phone: "Enter a valid phone number", "business_hours.mon": "Closing time must be after opening time" },
    });
    render(<BusinessSettingsForm initial={initial} timezones={timezones} />);
    fireEvent.change(screen.getByLabelText("Business phone number"), { target: { value: "123" } });
    fireEvent.click(screen.getByRole("button", { name: /save changes/i }));

    await waitFor(() => expect(toastError).toHaveBeenCalledWith("Please fix the highlighted fields."));
    expect(screen.getByText("Enter a valid phone number")).toBeInTheDocument();
    expect(screen.getByText("Closing time must be after opening time")).toBeInTheDocument();
    expect(screen.getByLabelText("Business phone number")).toHaveValue("123");
    expect(refresh).not.toHaveBeenCalled();
  });

  it("discards edits back to the saved details", () => {
    render(<BusinessSettingsForm initial={initial} timezones={timezones} />);
    const name = screen.getByLabelText("Business name");
    fireEvent.change(name, { target: { value: "Something else" } });
    expect(screen.getByText("You have unsaved changes")).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: /discard/i }));
    expect(name).toHaveValue("Bright Smile Dental");
  });
});
