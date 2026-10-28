// @vitest-environment jsdom
import { cleanup, render, screen, within } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";
import { RecentConversations } from "@/components/app/recent-conversations";
import { SetupChecklist } from "@/components/app/setup-checklist";
import type { Checklist, ConversationSummary } from "@/services/dashboard";

afterEach(cleanup);

const item = (key: string, done: boolean, extra: Record<string, unknown> = {}) => ({
  key,
  title: `Step ${key}`,
  description: `About ${key}`,
  done,
  href: `/${key}`,
  cta: `Do ${key}`,
  ...extra,
});

describe("SetupChecklist", () => {
  it("shows progress, and a button only for steps still to do", () => {
    const checklist: Checklist = { items: [item("a", true), item("b", false), item("c", false)], done: 1, total: 3 };
    render(<SetupChecklist checklist={checklist} />);

    expect(screen.getByText("Get set up")).toBeInTheDocument();
    expect(screen.getByText("1 of 3 steps done")).toBeInTheDocument();
    expect(screen.getByText("33%")).toBeInTheDocument();
    expect(screen.getByRole("progressbar")).toHaveAttribute("aria-valuenow", "33");

    expect(screen.queryByRole("link", { name: /do a/i })).not.toBeInTheDocument();
    expect(screen.getByRole("link", { name: /do b/i })).toHaveAttribute("href", "/b");
    expect(screen.getByRole("link", { name: /do c/i })).toHaveAttribute("href", "/c");
  });

  it("celebrates when everything required is done", () => {
    render(<SetupChecklist checklist={{ items: [item("a", true)], done: 1, total: 1 }} />);
    expect(screen.getByText("You are all set")).toBeInTheDocument();
    expect(screen.getByText("100%")).toBeInTheDocument();
  });

  it("marks optional steps", () => {
    render(<SetupChecklist checklist={{ items: [item("a", true), item("cal", false, { optional: true })], done: 1, total: 1 }} />);
    expect(screen.getByText("Optional")).toBeInTheDocument();
  });

  it("copes with an empty list", () => {
    render(<SetupChecklist checklist={{ items: [], done: 0, total: 0 }} />);
    expect(screen.getByText("100%")).toBeInTheDocument();
  });
});

const NOW = new Date("2026-10-28T12:00:00Z");
const convo = (overrides: Partial<ConversationSummary> = {}): ConversationSummary => ({
  id: "c1",
  state: "awaiting_reply",
  startedAt: "2026-10-28T11:30:00Z",
  lastIntent: null,
  escalationReason: null,
  customer: { phone: "+447911123456", name: null },
  ...overrides,
});

describe("RecentConversations", () => {
  it("explains what will appear when there are none, and points to the products", () => {
    render(<RecentConversations conversations={[]} timezone="Europe/London" now={NOW} />);
    expect(screen.getByText("No conversations yet")).toBeInTheDocument();
    expect(screen.getByRole("link", { name: /switch on the assistant/i })).toHaveAttribute("href", "/products");
  });

  it("lists conversations with a status, the customer's number in UK format and the time", () => {
    render(<RecentConversations conversations={[convo()]} timezone="Europe/London" now={NOW} />);
    const link = screen.getByRole("link", { name: /07911 123456/ });
    expect(link).toHaveAttribute("href", "/conversations/c1");
    expect(within(link).getByText("Waiting for reply")).toBeInTheDocument();
    expect(within(link).getByText("30 minutes ago")).toBeInTheDocument();
  });

  it("prefers the customer's name, and explains why a conversation needs the owner", () => {
    render(
      <RecentConversations
        conversations={[convo({ state: "escalated", escalationReason: "complaint", customer: { phone: "+447911123456", name: "Sam" } })]}
        timezone="Europe/London"
        now={NOW}
      />,
    );
    expect(screen.getByText("Sam")).toBeInTheDocument();
    expect(screen.getByText("Needs you")).toBeInTheDocument();
    expect(screen.getByText(/Complaint · /)).toBeInTheDocument();
  });

  it("shows what the customer wanted for ordinary conversations", () => {
    render(<RecentConversations conversations={[convo({ state: "booked", lastIntent: "book_appointment" })]} timezone="Europe/London" now={NOW} />);
    expect(screen.getByText(/Booking · /)).toBeInTheDocument();
    expect(screen.getByText("Booked")).toBeInTheDocument();
  });

  it("links to the full list", () => {
    render(<RecentConversations conversations={[convo()]} timezone="Europe/London" now={NOW} />);
    expect(screen.getByRole("link", { name: "View all" })).toHaveAttribute("href", "/conversations");
  });
});
