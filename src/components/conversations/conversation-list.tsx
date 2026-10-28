import Link from "next/link";
import { ChevronRight, MessagesSquare, SearchX } from "lucide-react";
import { EmptyState } from "@/components/app/empty-state";
import { StatusBadge } from "@/components/app/status-badge";
import { formatDateTime } from "@/lib/format";
import { formatPhone } from "@/lib/phone";
import { conversationStatus, escalationReason, intentLabel } from "@/lib/ui/status";
import type { ConversationSummary } from "@/services/dashboard";

/** Desktop shows a table; small screens show the same rows as cards. */
export function ConversationList({
  conversations,
  timezone,
  searching,
}: {
  conversations: ConversationSummary[];
  timezone: string;
  searching: boolean;
}) {
  if (conversations.length === 0) {
    return searching ? (
      <EmptyState icon={SearchX} title="No conversations found" description="Try a different name or number, or clear the filter." />
    ) : (
      <EmptyState
        icon={MessagesSquare}
        title="No conversations here yet"
        description="When your assistant picks up a missed call, the conversation will appear in this list."
      />
    );
  }

  return (
    <div className="overflow-hidden rounded-2xl border bg-card shadow-sm">
      <table className="hidden w-full text-left text-sm md:table">
        <thead className="border-b bg-muted/40 text-xs font-medium uppercase tracking-wider text-muted-foreground">
          <tr>
            <th className="px-5 py-3">Customer</th>
            <th className="px-5 py-3">Status</th>
            <th className="px-5 py-3">What they wanted</th>
            <th className="px-5 py-3">Started</th>
            <th className="w-10 px-5 py-3">
              <span className="sr-only">Open</span>
            </th>
          </tr>
        </thead>
        <tbody className="divide-y">
          {conversations.map((c) => {
            const status = conversationStatus(c.state);
            const wanted = c.state === "escalated" ? escalationReason(c.escalationReason) : intentLabel(c.lastIntent);
            return (
              <tr key={c.id} className="transition-colors hover:bg-muted/40">
                <td className="px-5 py-4">
                  <Link href={`/conversations/${c.id}`} className="block font-medium after:absolute after:inset-0 md:after:hidden">
                    {c.customer.name ?? formatPhone(c.customer.phone)}
                  </Link>
                  {c.customer.name ? <span className="text-muted-foreground">{formatPhone(c.customer.phone)}</span> : null}
                </td>
                <td className="px-5 py-4">
                  <StatusBadge tone={status.tone}>{status.label}</StatusBadge>
                </td>
                <td className="px-5 py-4 text-muted-foreground">{wanted || "—"}</td>
                <td className="px-5 py-4 text-muted-foreground">{formatDateTime(c.startedAt, timezone)}</td>
                <td className="px-5 py-4 text-right">
                  <Link href={`/conversations/${c.id}`} aria-label={`Open conversation with ${c.customer.name ?? formatPhone(c.customer.phone)}`}>
                    <ChevronRight className="size-4 text-muted-foreground" aria-hidden />
                  </Link>
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>

      <ul className="divide-y md:hidden">
        {conversations.map((c) => {
          const status = conversationStatus(c.state);
          const wanted = c.state === "escalated" ? escalationReason(c.escalationReason) : intentLabel(c.lastIntent);
          return (
            <li key={c.id}>
              <Link href={`/conversations/${c.id}`} className="flex items-center gap-3 px-4 py-4 hover:bg-muted/40">
                <div className="min-w-0 flex-1">
                  <p className="truncate text-sm font-medium">{c.customer.name ?? formatPhone(c.customer.phone)}</p>
                  <p className="truncate text-sm text-muted-foreground">
                    {wanted ? `${wanted} · ` : ""}
                    {formatDateTime(c.startedAt, timezone)}
                  </p>
                </div>
                <StatusBadge tone={status.tone}>{status.label}</StatusBadge>
              </Link>
            </li>
          );
        })}
      </ul>
    </div>
  );
}
