import Link from "next/link";
import { ArrowRight, MessagesSquare } from "lucide-react";
import { EmptyState } from "@/components/app/empty-state";
import { StatusBadge } from "@/components/app/status-badge";
import { buttonVariants } from "@/components/ui/button";
import { timeAgo } from "@/lib/format";
import { formatPhone } from "@/lib/phone";
import { conversationStatus, escalationReason, intentLabel } from "@/lib/ui/status";
import type { ConversationSummary } from "@/services/dashboard";

export function RecentConversations({
  conversations,
  timezone,
  now,
}: {
  conversations: ConversationSummary[];
  timezone: string;
  now: Date;
}) {
  return (
    <section className="rounded-2xl border bg-card p-6 shadow-sm">
      <div className="mb-4 flex items-center justify-between gap-3">
        <h2 className="text-lg font-semibold tracking-tight">Recent conversations</h2>
        <Link href="/conversations" className="text-sm font-medium text-primary hover:underline">
          View all
        </Link>
      </div>

      {conversations.length === 0 ? (
        <EmptyState
          icon={MessagesSquare}
          title="No conversations yet"
          description="When your assistant picks up a missed call, the conversation will show here."
          action={
            <Link href="/products" className={buttonVariants({ size: "sm" })}>
              Switch on the assistant <ArrowRight aria-hidden />
            </Link>
          }
        />
      ) : (
        <ul className="divide-y">
          {conversations.map((c) => {
            const status = conversationStatus(c.state);
            const note = c.state === "escalated" ? escalationReason(c.escalationReason) : intentLabel(c.lastIntent);
            return (
              <li key={c.id}>
                <Link
                  href={`/conversations/${c.id}`}
                  className="-mx-3 flex items-center gap-4 rounded-xl px-3 py-3.5 transition-colors hover:bg-muted/60"
                >
                  <span
                    className="flex size-10 shrink-0 items-center justify-center rounded-full bg-primary/10 text-sm font-semibold text-primary"
                    aria-hidden
                  >
                    {(c.customer.name ?? "#").slice(0, 1).toUpperCase()}
                  </span>
                  <div className="min-w-0 flex-1">
                    <p className="truncate text-sm font-medium">{c.customer.name ?? formatPhone(c.customer.phone)}</p>
                    <p className="truncate text-sm text-muted-foreground">
                      {note ? `${note} · ` : ""}
                      {timeAgo(c.startedAt, now, timezone)}
                    </p>
                  </div>
                  <StatusBadge tone={status.tone}>{status.label}</StatusBadge>
                </Link>
              </li>
            );
          })}
        </ul>
      )}
    </section>
  );
}
