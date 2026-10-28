// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { BusinessHoursEditor } from "@/components/forms/business-hours-editor";
import { DEFAULT_BUSINESS_HOURS } from "@/lib/validation/hours";

afterEach(cleanup);

function setup(overrides: Partial<Parameters<typeof BusinessHoursEditor>[0]> = {}) {
  const onChange = vi.fn();
  render(<BusinessHoursEditor value={DEFAULT_BUSINESS_HOURS} onChange={onChange} {...overrides} />);
  return onChange;
}

describe("BusinessHoursEditor", () => {
  it("shows the week: open days with times, closed days as Closed", () => {
    setup();
    expect(screen.getByLabelText("Monday opens")).toHaveValue("09:00");
    expect(screen.getByLabelText("Monday closes")).toHaveValue("17:00");
    expect(screen.getByLabelText("Monday open")).toBeChecked();
    expect(screen.getByLabelText("Saturday open")).not.toBeChecked();
    expect(screen.getAllByText("Closed")).toHaveLength(2); // Saturday and Sunday
    expect(screen.queryByLabelText("Saturday opens")).not.toBeInTheDocument();
  });

  it("opens a closed day with the default hours", () => {
    const onChange = setup();
    fireEvent.click(screen.getByLabelText("Saturday open"));
    expect(onChange).toHaveBeenCalledWith({ ...DEFAULT_BUSINESS_HOURS, sat: { open: "09:00", close: "17:00" } });
  });

  it("closes an open day", () => {
    const onChange = setup();
    fireEvent.click(screen.getByLabelText("Monday open"));
    expect(onChange).toHaveBeenCalledWith({ ...DEFAULT_BUSINESS_HOURS, mon: null });
  });

  it("changes opening and closing times of one day only", () => {
    const onChange = setup();
    fireEvent.change(screen.getByLabelText("Tuesday opens"), { target: { value: "10:30" } });
    expect(onChange).toHaveBeenLastCalledWith({ ...DEFAULT_BUSINESS_HOURS, tue: { open: "10:30", close: "17:00" } });
    fireEvent.change(screen.getByLabelText("Tuesday closes"), { target: { value: "18:00" } });
    expect(onChange).toHaveBeenLastCalledWith({ ...DEFAULT_BUSINESS_HOURS, tue: { open: "09:00", close: "18:00" } });
  });

  it("copies Monday to Tuesday through Friday", () => {
    const onChange = setup({
      value: { ...DEFAULT_BUSINESS_HOURS, mon: { open: "08:00", close: "12:00" }, thu: null },
    });
    fireEvent.click(screen.getByRole("button", { name: /copy monday/i }));
    const monday = { open: "08:00", close: "12:00" };
    expect(onChange).toHaveBeenCalledWith(expect.objectContaining({ mon: monday, tue: monday, wed: monday, thu: monday, fri: monday, sat: null, sun: null }));
  });

  it("shows a day's error message", () => {
    setup({ errors: { "business_hours.mon": "Closing time must be after opening time" } });
    expect(screen.getByRole("alert")).toHaveTextContent("Closing time must be after opening time");
  });

  it("finds errors under a custom prefix", () => {
    setup({ errors: { "hours.fri.close": "Use HH:MM" }, errorPrefix: "hours" });
    expect(screen.getByRole("alert")).toHaveTextContent("Use HH:MM");
  });
});
