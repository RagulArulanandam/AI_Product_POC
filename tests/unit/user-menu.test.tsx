// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

const { logout } = vi.hoisted(() => ({ logout: vi.fn() }));
vi.mock("@/app/(auth)/actions", () => ({ logoutAction: logout }));

import { UserMenu } from "@/components/app/user-menu";

afterEach(() => {
  cleanup();
  logout.mockReset();
});

/** Base UI opens a menu on pointer down, so a bare click is not enough in jsdom. */
function openMenu() {
  const trigger = screen.getByRole("button", { name: "Account menu" });
  fireEvent.pointerDown(trigger, { button: 0, pointerType: "mouse" });
  fireEvent.mouseDown(trigger, { button: 0 });
  fireEvent.pointerUp(trigger, { button: 0, pointerType: "mouse" });
  fireEvent.click(trigger, { button: 0 });
}

describe("UserMenu", () => {
  it("opens without crashing and shows who is signed in", async () => {
    render(<UserMenu email="owner@example.com" role="owner" />);
    openMenu();

    expect(await screen.findByText("Log out")).toBeInTheDocument();
    expect(screen.getAllByText("owner@example.com").length).toBeGreaterThan(0);
    expect(screen.getByText("owner")).toBeInTheDocument();
  });

  it("logs out when Log out is chosen", async () => {
    render(<UserMenu email="owner@example.com" role="owner" />);
    openMenu();
    fireEvent.click(await screen.findByText("Log out"));

    await waitFor(() => expect(logout).toHaveBeenCalledTimes(1));
  });
});
