import { Bot, Info } from "lucide-react";
import { cn } from "@/lib/utils";
import { deliveryLabel, displayBody } from "@/lib/ui/message";
import { intentLabel } from "@/lib/ui/status";
import type { ThreadMessage } from "@/services/conversations";

function dayKey(iso: string, timezone: string): string {
  return new Intl.DateTimeFormat("en-CA", { dateStyle: "short", timeZone: timezone }).format(new Date(iso));
}

function dayLabel(iso: string, timezone: string): string {
  return new Intl.DateTimeFormat("en-GB", { dateStyle: "full", timeZone: timezone }).format(new Date(iso));
}

function timeLabel(iso: string, timezone: string): string {
  return new Intl.DateTimeFormat("en-GB", { timeStyle: "short", timeZone: timezone }).format(new Date(iso));
}

/** The conversation as chat bubbles: the customer on the left, your assistant on the right. */
export function MessageThread({ messages, timezone }: { messages: ThreadMessage[]; timezone: string }) {
  if (messages.length === 0) {
    return <p className="py-10 text-center text-sm text-muted-foreground">No messages yet.</p>;
  }

  return (
    <ol className="space-y-4" aria-label="Messages">
      {messages.map((m, index) => {
        const previous = messages[index - 1];
        const showDay = !previous || dayKey(previous.createdAt, timezone) !== dayKey(m.createdAt, timezone);

        const fromCustomer = m.sender === "customer";
        const { text, sentAsTemplate } = displayBody(m.body);
        const delivery = fromCustomer ? null : deliveryLabel(m.status);
        const intent = fromCustomer ? intentLabel(m.intent) : "";

        return (
          <li key={m.id} className="space-y-4">
            {showDay ? (
              <p className="py-1 text-center text-xs font-medium text-muted-foreground">{dayLabel(m.createdAt, timezone)}</p>
            ) : null}
            <div className={cn("flex", fromCustomer ? "justify-start" : "justify-end")}>
              <div className={cn("flex max-w-[85%] flex-col gap-1 sm:max-w-[70%]", fromCustomer ? "items-start" : "items-end")}>
                {!fromCustomer ? (
                  <span className="flex items-center gap-1 text-[11px] font-medium text-muted-foreground">
                    <Bot className="size-3" aria-hidden /> {m.sender === "system" ? "Automatic message" : "Assistant"}
                  </span>
                ) : null}
                <div
                  className={cn(
                    "whitespace-pre-wrap break-words rounded-2xl px-4 py-2.5 text-sm leading-relaxed shadow-sm",
                    fromCustomer
                      ? "rounded-tl-md border bg-card"
                      : m.sender === "system"
                        ? "rounded-tr-md bg-primary/12 text-foreground ring-1 ring-inset ring-primary/20"
                        : "rounded-tr-md bg-primary text-primary-foreground",
                  )}
                >
                  {text}
                </div>
                <div className="flex flex-wrap items-center gap-x-2 gap-y-0.5 text-[11px] text-muted-foreground">
                  <time dateTime={m.createdAt}>{timeLabel(m.createdAt, timezone)}</time>
                  {delivery ? <span className={cn(delivery.failed && "font-medium text-destructive")}>· {delivery.label}</span> : null}
                  {intent ? <span className="rounded-full bg-muted px-2 py-0.5">{intent}</span> : null}
                </div>
                {sentAsTemplate ? (
                  <p className="flex items-center gap-1 text-[11px] text-muted-foreground">
                    <Info className="size-3" aria-hidden /> Sent as a standard template during testing
                  </p>
                ) : null}
              </div>
            </div>
          </li>
        );
      })}
    </ol>
  );
}
