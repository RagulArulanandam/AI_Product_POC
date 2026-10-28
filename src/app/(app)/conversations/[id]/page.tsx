import Link from "next/link";
import { notFound } from "next/navigation";
import { ArrowLeft, MessageCircle, Phone, TriangleAlert } from "lucide-react";
import { StatusBadge } from "@/components/app/status-badge";
import { MessageThread } from "@/components/conversations/message-thread";
import { buttonVariants } from "@/components/ui/button";
import { requireBusiness } from "@/lib/auth/guards";
import { formatDateTime } from "@/lib/format";
import { formatPhone } from "@/lib/phone";
import { whatsappLink } from "@/lib/ui/message";
import { conversationStatus, escalationReason, intentLabel } from "@/lib/ui/status";
import { getConversation } from "@/services/conversations";

export const metadata = { title: "Conversation" };

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

export default async function ConversationPage(props: PageProps<"/conversations/[id]">) {
  const { id } = await props.params;
  if (!UUID.test(id)) notFound();

  const { supabase, business } = await requireBusiness();
  const convo = await getConversation(supabase, business.id, id);
  if (!convo) notFound();

  const status = conversationStatus(convo.state);
  const who = convo.customer.name ?? formatPhone(convo.customer.phone);
  const tz = business.timezone;

  const details: [string, string][] = [
    ["Started", formatDateTime(convo.startedAt, tz)],
    ["Customer's last message", convo.lastInboundAt ? formatDateTime(convo.lastInboundAt, tz) : "No reply yet"],
    ["Messages from customer", String(convo.turnCount)],
    ["What they wanted", intentLabel(convo.lastIntent) || "Not clear yet"],
  ];
  if (convo.expiresAt && ["awaiting_reply", "in_conversation", "offering_slots"].includes(convo.state)) {
    details.push(["Closes automatically", formatDateTime(convo.expiresAt, tz)]);
  }

  return (
    <div className="space-y-6">
      <Link href="/conversations" className="inline-flex items-center gap-1.5 text-sm font-medium text-muted-foreground hover:text-foreground">
        <ArrowLeft className="size-4" aria-hidden /> All conversations
      </Link>

      <div className="flex flex-wrap items-center gap-3">
        <h1 className="text-2xl font-semibold tracking-tight sm:text-3xl">{who}</h1>
        <StatusBadge tone={status.tone}>{status.label}</StatusBadge>
      </div>

      {convo.state === "escalated" ? (
        <div className="flex gap-4 rounded-2xl border border-destructive/25 bg-destructive/5 p-5" role="alert">
          <span className="flex size-10 shrink-0 items-center justify-center rounded-xl bg-destructive/10 text-destructive">
            <TriangleAlert className="size-5" aria-hidden />
          </span>
          <div className="space-y-1">
            <p className="font-semibold">This conversation needs you</p>
            <p className="text-sm text-muted-foreground">
              {escalationReason(convo.escalationReason) || "A person is needed"}
              {convo.escalatedAt ? ` · handed over ${formatDateTime(convo.escalatedAt, tz)}` : ""}. Your assistant has stopped replying, so please contact the
              customer yourself.
            </p>
          </div>
        </div>
      ) : null}

      <div className="grid gap-6 lg:grid-cols-[1fr_20rem]">
        <section className="rounded-2xl border bg-muted/30 p-4 shadow-sm sm:p-6" aria-label="Conversation">
          <MessageThread messages={convo.messages} timezone={tz} />
        </section>

        <aside className="space-y-4">
          <section className="rounded-2xl border bg-card p-5 shadow-sm">
            <h2 className="text-sm font-semibold">Customer</h2>
            <p className="mt-3 text-lg font-semibold tracking-tight">{who}</p>
            {convo.customer.name ? <p className="text-sm text-muted-foreground">{formatPhone(convo.customer.phone)}</p> : null}
            <div className="mt-4 flex flex-wrap gap-2">
              <a href={`tel:${convo.customer.phone}`} className={buttonVariants({ variant: "outline", size: "sm" })}>
                <Phone aria-hidden /> Call
              </a>
              <a href={whatsappLink(convo.customer.phone)} target="_blank" rel="noopener noreferrer" className={buttonVariants({ variant: "outline", size: "sm" })}>
                <MessageCircle aria-hidden /> WhatsApp
              </a>
            </div>
          </section>

          <section className="rounded-2xl border bg-card p-5 shadow-sm">
            <h2 className="text-sm font-semibold">Details</h2>
            <dl className="mt-3 divide-y text-sm">
              {details.map(([label, value]) => (
                <div key={label} className="flex items-start justify-between gap-4 py-2.5">
                  <dt className="text-muted-foreground">{label}</dt>
                  <dd className="text-right font-medium">{value}</dd>
                </div>
              ))}
            </dl>
          </section>
        </aside>
      </div>
    </div>
  );
}
