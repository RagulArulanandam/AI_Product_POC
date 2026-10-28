// @vitest-environment jsdom
import { cleanup, render, screen, within } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";
import { ConversationList } from "@/components/conversations/conversation-list";
import { MessageThread } from "@/components/conversations/message-thread";
import { deliveryLabel, displayBody, whatsappLink } from "@/lib/ui/message";
import type { ConversationSummary } from "@/services/dashboard";
import type { ThreadMessage } from "@/services/conversations";

afterEach(cleanup);

describe("message helpers", () => {
  it("hides the trial template marker and says a template was sent", () => {
    expect(displayBody("[trial template HXfe5ab5f00277942d4d4200328b4d403c] Hi, this is us.")).toEqual({ text: "Hi, this is us.", sentAsTemplate: true });
    expect(displayBody("Just a normal message")).toEqual({ text: "Just a normal message", sentAsTemplate: false });
    expect(displayBody("Mentions [trial template] in the middle").sentAsTemplate).toBe(false);
  });

  it("describes delivery states", () => {
    expect(deliveryLabel("delivered")).toEqual({ label: "Delivered", failed: false });
    expect(deliveryLabel("sent")).toEqual({ label: "Sent", failed: false });
    expect(deliveryLabel("failed")).toEqual({ label: "Not delivered", failed: true });
    expect(deliveryLabel("queued")).toEqual({ label: "Sending", failed: false });
    expect(deliveryLabel("received")).toBeNull();
  });

  it("builds a WhatsApp link from digits only", () => {
    expect(whatsappLink("+447911123456")).toBe("https://wa.me/447911123456");
  });
});

const msg = (overrides: Partial<ThreadMessage>): ThreadMessage => ({
  id: Math.random().toString(36),
  direction: "outbound",
  sender: "system",
  body: "Hello",
  status: "delivered",
  intent: null,
  createdAt: "2026-10-28T10:00:00Z",
  ...overrides,
});

describe("MessageThread", () => {
  it("says so when there are no messages", () => {
    render(<MessageThread messages={[]} timezone="Europe/London" />);
    expect(screen.getByText("No messages yet.")).toBeInTheDocument();
  });

  it("shows each message with its time, who sent it, and delivery state", () => {
    render(
      <MessageThread
        timezone="Europe/London"
        messages={[
          msg({ sender: "system", body: "Hi, this is Bright Smile Dental." }),
          msg({ direction: "inbound", sender: "customer", body: "What time do you open?", status: "received", intent: "enquiry", createdAt: "2026-10-28T10:05:00Z" }),
          msg({ sender: "ai", body: "We open at nine.", status: "sent", createdAt: "2026-10-28T10:06:00Z" }),
        ]}
      />,
    );
    const items = within(screen.getByRole("list", { name: "Messages" })).getAllByRole("listitem");
    expect(items).toHaveLength(3);
    expect(screen.getByText("Automatic message")).toBeInTheDocument();
    expect(screen.getByText("Assistant")).toBeInTheDocument();
    expect(screen.getByText("What time do you open?")).toBeInTheDocument();
    expect(screen.getByText("Enquiry")).toBeInTheDocument();
    expect(screen.getByText("· Delivered")).toBeInTheDocument();
    expect(screen.getByText("· Sent")).toBeInTheDocument();
    expect(screen.getByText("10:05")).toBeInTheDocument();
  });

  it("shows times in the business timezone", () => {
    render(<MessageThread timezone="Europe/Paris" messages={[msg({ createdAt: "2026-10-28T10:00:00Z" })]} />);
    expect(screen.getByText("11:00")).toBeInTheDocument();
  });

  it("puts a date heading only where the day changes", () => {
    render(
      <MessageThread
        timezone="Europe/London"
        messages={[
          msg({ createdAt: "2026-10-28T10:00:00Z" }),
          msg({ createdAt: "2026-10-28T10:30:00Z" }),
          msg({ createdAt: "2026-10-29T09:00:00Z" }),
        ]}
      />,
    );
    expect(screen.getAllByText(/2026/)).toHaveLength(2);
    expect(screen.getByText(/^Wednesday,? 28 October 2026$/)).toBeInTheDocument();
    expect(screen.getByText(/^Thursday,? 29 October 2026$/)).toBeInTheDocument();
  });

  it("flags a message that was not delivered", () => {
    render(<MessageThread timezone="Europe/London" messages={[msg({ status: "failed" })]} />);
    expect(screen.getByText("· Not delivered")).toHaveClass("text-destructive");
  });

  it("shows the intended text and a note for a message sent as a trial template", () => {
    render(<MessageThread timezone="Europe/London" messages={[msg({ body: "[trial template HXfe5ab5f00277942d4d4200328b4d403c] Hi from us" })]} />);
    expect(screen.getByText("Hi from us")).toBeInTheDocument();
    expect(screen.getByText(/Sent as a standard template during testing/)).toBeInTheDocument();
    expect(screen.queryByText(/HXfe5ab5/)).not.toBeInTheDocument();
  });

  it("shows message text as plain text, never as HTML", () => {
    render(<MessageThread timezone="Europe/London" messages={[msg({ direction: "inbound", sender: "customer", status: "received", body: '<img src=x onerror="alert(1)">' })]} />);
    expect(screen.getByText('<img src=x onerror="alert(1)">')).toBeInTheDocument();
    expect(document.querySelector("img")).toBeNull();
  });
});

const row = (overrides: Partial<ConversationSummary> = {}): ConversationSummary => ({
  id: "c1",
  state: "awaiting_reply",
  startedAt: "2026-10-28T10:00:00Z",
  lastIntent: null,
  escalationReason: null,
  customer: { phone: "+447911123456", name: null },
  ...overrides,
});

describe("ConversationList", () => {
  it("explains an empty list, differently when a search or filter is active", () => {
    const { rerender } = render(<ConversationList conversations={[]} timezone="Europe/London" searching={false} />);
    expect(screen.getByText("No conversations here yet")).toBeInTheDocument();
    rerender(<ConversationList conversations={[]} timezone="Europe/London" searching />);
    expect(screen.getByText("No conversations found")).toBeInTheDocument();
  });

  it("lists conversations with name or number, status, what they wanted and when", () => {
    render(
      <ConversationList
        timezone="Europe/London"
        searching={false}
        conversations={[
          row({ id: "a", state: "escalated", escalationReason: "complaint", customer: { phone: "+447911123456", name: "Sam" } }),
          row({ id: "b", state: "booked", lastIntent: "book_appointment" }),
        ]}
      />,
    );
    expect(screen.getAllByText("Sam").length).toBeGreaterThan(0);
    expect(screen.getAllByText("Needs you").length).toBeGreaterThan(0);
    expect(screen.getAllByText("Complaint").length).toBeGreaterThan(0);
    expect(screen.getAllByText("Booked").length).toBeGreaterThan(0);
    expect(screen.getAllByText("Booking").length).toBeGreaterThan(0);
    expect(screen.getAllByText("28 Oct 2026, 10:00").length).toBeGreaterThan(0);
    const links = screen.getAllByRole("link").map((l) => l.getAttribute("href"));
    expect(links).toEqual(expect.arrayContaining(["/conversations/a", "/conversations/b"]));
  });

  it("shows the UK-format number when there is no name", () => {
    render(<ConversationList conversations={[row()]} timezone="Europe/London" searching={false} />);
    expect(screen.getAllByText("07911 123456").length).toBeGreaterThan(0);
  });
});
