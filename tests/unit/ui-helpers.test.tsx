// @vitest-environment jsdom
import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { StatusBadge } from "@/components/app/status-badge";
import { EmptyState } from "@/components/app/empty-state";
import { StatCard } from "@/components/app/stat-card";
import { PageHeader } from "@/components/app/page-header";
import { isActive } from "@/components/app/nav-links";
import { initialsOf } from "@/components/app/user-menu";
import { conversationStatus, escalationReason, integrationStatus, intentLabel, subscriptionStatus } from "@/lib/ui/status";
import { MessagesSquare } from "lucide-react";

vi.mock("@/app/(auth)/actions", () => ({ logoutAction: async () => {} }));

afterEach(cleanup);

describe("status labels", () => {
  it("gives every conversation state a plain label and a tone", () => {
    const states = ["pending_send", "awaiting_reply", "in_conversation", "offering_slots", "booked", "enquiry_logged", "escalated", "opted_out", "expired", "failed"];
    for (const state of states) {
      const { label, tone } = conversationStatus(state);
      expect(label.length, state).toBeGreaterThan(0);
      expect(label, state).not.toContain("_");
      expect(["success", "warning", "danger", "neutral", "info"]).toContain(tone);
    }
  });

  it("makes escalated conversations stand out and booked ones look good", () => {
    expect(conversationStatus("escalated")).toEqual({ label: "Needs you", tone: "danger" });
    expect(conversationStatus("booked").tone).toBe("success");
    expect(conversationStatus("opted_out").tone).toBe("neutral");
  });

  it("falls back to a readable label for unknown states", () => {
    expect(conversationStatus("something_new")).toEqual({ label: "something new", tone: "neutral" });
  });

  it("describes integrations and subscriptions", () => {
    expect(integrationStatus("connected").tone).toBe("success");
    expect(integrationStatus("error").label).toBe("Needs attention");
    expect(integrationStatus(null).label).toBe("Not connected");
    expect(integrationStatus("weird").label).toBe("Not connected");
    expect(subscriptionStatus("trial").label).toBe("Free trial");
    expect(subscriptionStatus("past_due").tone).toBe("warning");
    expect(subscriptionStatus("odd").label).toBe("odd");
  });

  it("explains escalation reasons and intents in plain English", () => {
    expect(escalationReason("medical_advice")).toBe("Health or safety question");
    expect(escalationReason("wants_human")).toBe("Asked for a person");
    expect(escalationReason(null)).toBe("");
    expect(escalationReason("brand_new")).toBe("brand new");
    expect(intentLabel("book_appointment")).toBe("Booking");
    expect(intentLabel("none")).toBe("");
    expect(intentLabel(undefined)).toBe("");
  });
});

describe("navigation", () => {
  it("is active on its own page and beneath it, but not on lookalikes", () => {
    expect(isActive("/products", "/products")).toBe(true);
    expect(isActive("/products/missed-call", "/products")).toBe(true);
    expect(isActive("/products-old", "/products")).toBe(false);
    expect(isActive("/dashboard", "/products")).toBe(false);
  });
});

describe("initialsOf", () => {
  it.each([
    ["sam.jones@example.com", "SJ"],
    ["owner-a@poc.local", "OA"],
    ["alex@example.com", "AL"],
    ["x@y.z", "X"],
    ["", "?"],
  ])("turns %j into %j", (email, expected) => {
    expect(initialsOf(email)).toBe(expected);
  });
});

describe("small components", () => {
  it("renders a status badge with its text", () => {
    render(<StatusBadge tone="success">Connected</StatusBadge>);
    expect(screen.getByText("Connected")).toBeInTheDocument();
  });

  it("renders a stat card with label, value and hint", () => {
    render(<StatCard label="Conversations" value={12} hint="Last 30 days" icon={MessagesSquare} />);
    expect(screen.getByText("Conversations")).toBeInTheDocument();
    expect(screen.getByText("12")).toBeInTheDocument();
    expect(screen.getByText("Last 30 days")).toBeInTheDocument();
  });

  it("renders an empty state with its action", () => {
    render(<EmptyState icon={MessagesSquare} title="No conversations yet" description="Enable Missed Call." action={<button>Go</button>} />);
    expect(screen.getByText("No conversations yet")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Go" })).toBeInTheDocument();
  });

  it("renders a page header with title, description and actions", () => {
    render(<PageHeader title="Products" description="Switch things on" actions={<button>Add</button>} />);
    expect(screen.getByRole("heading", { name: "Products" })).toBeInTheDocument();
    expect(screen.getByText("Switch things on")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Add" })).toBeInTheDocument();
  });
});
