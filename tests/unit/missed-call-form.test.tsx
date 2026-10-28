// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const { save, refresh, toastSuccess, toastError } = vi.hoisted(() => ({
  save: vi.fn(),
  refresh: vi.fn(),
  toastSuccess: vi.fn(),
  toastError: vi.fn(),
}));
vi.mock("@/app/(app)/products/actions", () => ({ saveProductConfigAction: save, toggleProductAction: vi.fn() }));
vi.mock("next/navigation", () => ({ useRouter: () => ({ refresh }) }));
vi.mock("sonner", () => ({ toast: { success: toastSuccess, error: toastError } }));

import { missedCallConfigSchema } from "@/products/missed-call/config";
import { draftToConfig, MissedCallForm, toDraft } from "@/products/missed-call/form";
import { DEFAULT_BUSINESS_HOURS } from "@/lib/validation/hours";

afterEach(cleanup);
beforeEach(() => {
  for (const fn of [save, refresh, toastSuccess, toastError]) fn.mockReset();
  window.HTMLElement.prototype.scrollIntoView = vi.fn();
});

const defaults = missedCallConfigSchema.parse({});

function renderForm(config = defaults) {
  return render(<MissedCallForm initial={config} businessName="Bright Smile Dental" profileHours={DEFAULT_BUSINESS_HOURS} timezone="Europe/London" />);
}

describe("draft conversion", () => {
  it("round-trips the defaults into a config the schema accepts unchanged", () => {
    const sent = draftToConfig(toDraft(defaults), null);
    expect(missedCallConfigSchema.parse(sent)).toEqual(defaults);
  });

  it("sends nothing for an empty number box, so the default applies instead of 0", () => {
    const draft = { ...toDraft(defaults), delay_minutes: "  " };
    const sent = draftToConfig(draft, null);
    expect(sent.delay_minutes).toBeUndefined();
    expect(missedCallConfigSchema.parse(sent).delay_minutes).toBe(2);
  });

  it("sends the product's own hours only in custom mode", () => {
    const custom = { ...toDraft(defaults), hoursMode: "custom" as const };
    expect(draftToConfig(custom, null).business_hours).toEqual(DEFAULT_BUSINESS_HOURS);
    expect(draftToConfig({ ...custom, hoursMode: "profile" }, null).business_hours).toBeNull();
  });

  it("turns an empty or padded escalation email into null or a trimmed address", () => {
    expect(draftToConfig({ ...toDraft(defaults), escalation_email: "  " }, null).escalation_email).toBeNull();
    expect(draftToConfig({ ...toDraft(defaults), escalation_email: " me@example.com " }, null).escalation_email).toBe("me@example.com");
  });

  it("starts in custom mode when the saved config has its own hours", () => {
    expect(toDraft({ ...defaults, business_hours: DEFAULT_BUSINESS_HOURS }).hoursMode).toBe("custom");
    expect(toDraft(defaults).hoursMode).toBe("profile");
  });

  it("keeps the connected calendar id", () => {
    expect(draftToConfig(toDraft(defaults), "11111111-1111-4111-8111-111111111111").calendar_integration_id).toBe("11111111-1111-4111-8111-111111111111");
  });
});

describe("MissedCallForm", () => {
  it("starts with everything saved and the buttons disabled", () => {
    renderForm();
    expect(screen.getByText("All changes saved")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /save changes/i })).toBeDisabled();
    expect(screen.getByRole("button", { name: /discard/i })).toBeDisabled();
  });

  it("shows the saved values and a preview with the business name filled in", () => {
    renderForm();
    expect(screen.getByLabelText("Wait before the first message")).toHaveValue(2);
    expect(screen.getByText("Hi, this is Bright Smile Dental. Sorry we missed your call. How can we help?")).toBeInTheDocument();
  });

  it("updates the preview as the message is edited", () => {
    renderForm();
    fireEvent.change(screen.getByLabelText("First message (during opening hours)"), { target: { value: "Hello from {{business_name}}!" } });
    expect(screen.getByText("Hello from Bright Smile Dental!")).toBeInTheDocument();
    expect(screen.getByText("You have unsaved changes")).toBeInTheDocument();
  });

  it("enables saving after a change and sends the new settings as JSON", async () => {
    save.mockResolvedValue({ ok: true });
    renderForm();
    fireEvent.change(screen.getByLabelText("Wait before the first message"), { target: { value: "7" } });
    fireEvent.click(screen.getByRole("button", { name: /save changes/i }));

    await waitFor(() => expect(save).toHaveBeenCalledTimes(1));
    const [key, json] = save.mock.calls[0];
    expect(key).toBe("missed-call");
    expect(JSON.parse(json)).toMatchObject({ delay_minutes: 7, send_outside_hours: true, business_hours: null });

    await waitFor(() => expect(toastSuccess).toHaveBeenCalledWith("Settings saved"));
    expect(refresh).toHaveBeenCalled();
    expect(screen.getByText("All changes saved")).toBeInTheDocument();
  });

  it("shows the server's message next to the field it belongs to, and keeps the changes", async () => {
    save.mockResolvedValue({
      ok: false,
      code: "invalid",
      message: "Please fix the highlighted fields.",
      fieldErrors: { delay_minutes: "Too big", escalation_email: "Enter a valid email address" },
    });
    renderForm();
    fireEvent.change(screen.getByLabelText("Wait before the first message"), { target: { value: "500" } });
    fireEvent.click(screen.getByRole("button", { name: /save changes/i }));

    await waitFor(() => expect(toastError).toHaveBeenCalledWith("Please fix the highlighted fields."));
    expect(screen.getByText("Too big")).toBeInTheDocument();
    expect(screen.getByText("Enter a valid email address")).toBeInTheDocument();
    expect(screen.getByLabelText("Wait before the first message")).toHaveValue(500);
    expect(screen.getByText("You have unsaved changes")).toBeInTheDocument();
    expect(refresh).not.toHaveBeenCalled();
  });

  it("discards changes back to what was saved", () => {
    renderForm();
    const delay = screen.getByLabelText("Wait before the first message");
    fireEvent.change(delay, { target: { value: "30" } });
    fireEvent.click(screen.getByRole("button", { name: /discard/i }));
    expect(delay).toHaveValue(2);
    expect(screen.getByText("All changes saved")).toBeInTheDocument();
  });

  it("switches between the business's hours and custom hours", () => {
    renderForm();
    expect(screen.queryByLabelText("Monday opens")).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Custom for this product" }));
    expect(screen.getByLabelText("Monday opens")).toHaveValue("09:00");
    fireEvent.click(screen.getByRole("button", { name: "Same as my business" }));
    expect(screen.queryByLabelText("Monday opens")).not.toBeInTheDocument();
  });

  it("sends the escalation switches and email", async () => {
    save.mockResolvedValue({ ok: true });
    renderForm();
    fireEvent.change(screen.getByLabelText("Send alerts to"), { target: { value: "boss@example.com" } });
    fireEvent.click(screen.getByLabelText("Alert me about complaints"));
    fireEvent.click(screen.getByRole("button", { name: /save changes/i }));

    await waitFor(() => expect(save).toHaveBeenCalled());
    expect(JSON.parse(save.mock.calls[0][1])).toMatchObject({
      escalation_email: "boss@example.com",
      escalate_on: { complaint: false, wants_human: true, low_confidence: true },
    });
  });

  it("counts the characters in the business description", () => {
    renderForm();
    fireEvent.change(screen.getByLabelText("What should the assistant know?"), { target: { value: "Family dentist." } });
    expect(screen.getByText("15 / 1000")).toBeInTheDocument();
  });
});
