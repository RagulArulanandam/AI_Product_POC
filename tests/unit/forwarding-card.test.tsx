// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const { confirm, toastSuccess, toastError } = vi.hoisted(() => ({ confirm: vi.fn(), toastSuccess: vi.fn(), toastError: vi.fn() }));
vi.mock("@/app/(app)/integrations/actions", () => ({ confirmForwardingAction: confirm }));
vi.mock("sonner", () => ({ toast: { success: toastSuccess, error: toastError } }));

import { CopyButton } from "@/components/integrations/copy-button";
import { ForwardingCard } from "@/components/integrations/forwarding-card";

afterEach(cleanup);
beforeEach(() => {
  for (const fn of [confirm, toastSuccess, toastError]) fn.mockReset();
});

describe("ForwardingCard", () => {
  it("explains that a number is needed when none is assigned, and offers no confirm button", () => {
    render(<ForwardingCard assistantNumber={null} confirmed={false} />);
    expect(screen.getByText("Number needed")).toBeInTheDocument();
    expect(screen.getByText(/has not been assigned yet/)).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /set up forwarding/i })).not.toBeInTheDocument();
  });

  it("shows the number and the carrier codes for it", () => {
    render(<ForwardingCard assistantNumber="+447460041934" confirmed={false} />);
    expect(screen.getByText("Set up needed")).toBeInTheDocument();
    expect(screen.getByText("07460 041934")).toBeInTheDocument();
    expect(screen.getByText("**61*+447460041934#")).toBeInTheDocument();
    expect(screen.getByText("**67*+447460041934#")).toBeInTheDocument();
    expect(screen.getByText("**62*+447460041934#")).toBeInTheDocument();
    expect(screen.getByText("##002#")).toBeInTheDocument();
  });

  it("confirms forwarding and switches to the connected state", async () => {
    confirm.mockResolvedValue({ ok: true });
    render(<ForwardingCard assistantNumber="+447460041934" confirmed={false} />);
    fireEvent.click(screen.getByRole("button", { name: /i have set up forwarding/i }));

    await waitFor(() => expect(confirm).toHaveBeenCalledWith(true));
    await waitFor(() => expect(toastSuccess).toHaveBeenCalledWith("Call forwarding confirmed"));
    expect(screen.getByText("Connected")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /mark as not set up/i })).toBeInTheDocument();
  });

  it("can be marked as not set up again", async () => {
    confirm.mockResolvedValue({ ok: true });
    render(<ForwardingCard assistantNumber="+447460041934" confirmed />);
    expect(screen.getByText("Connected")).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: /mark as not set up/i }));
    await waitFor(() => expect(confirm).toHaveBeenCalledWith(false));
    await waitFor(() => expect(screen.getByText("Set up needed")).toBeInTheDocument());
  });

  it("stays as it was, and says why, when confirming is refused", async () => {
    confirm.mockResolvedValue({ ok: false, message: "No assistant number has been assigned to your business yet." });
    render(<ForwardingCard assistantNumber="+447460041934" confirmed={false} />);
    fireEvent.click(screen.getByRole("button", { name: /i have set up forwarding/i }));
    await waitFor(() => expect(toastError).toHaveBeenCalledWith("No assistant number has been assigned to your business yet."));
    expect(screen.getByText("Set up needed")).toBeInTheDocument();
  });
});

describe("CopyButton", () => {
  it("copies the text and shows Copied", async () => {
    const writeText = vi.fn().mockResolvedValue(undefined);
    Object.assign(navigator, { clipboard: { writeText } });
    render(<CopyButton text="**61*+447460041934#" label="no-answer code" />);
    fireEvent.click(screen.getByRole("button", { name: "Copy no-answer code" }));
    await waitFor(() => expect(writeText).toHaveBeenCalledWith("**61*+447460041934#"));
    await waitFor(() => expect(screen.getByText("Copied")).toBeInTheDocument());
  });

  it("tells the user when copying is not possible", async () => {
    Object.assign(navigator, { clipboard: { writeText: vi.fn().mockRejectedValue(new Error("denied")) } });
    render(<CopyButton text="x" label="thing" />);
    fireEvent.click(screen.getByRole("button", { name: "Copy thing" }));
    await waitFor(() => expect(toastError).toHaveBeenCalled());
    expect(screen.queryByText("Copied")).not.toBeInTheDocument();
  });
});
