import type { LucideIcon } from "lucide-react";
import { StatusBadge } from "@/components/app/status-badge";
import type { Tone } from "@/lib/ui/status";

/** A connection (WhatsApp, phone forwarding, calendar): what it is, its state, and what to do. */
export function IntegrationCard({
  icon: Icon,
  title,
  description,
  status,
  children,
}: {
  icon: LucideIcon;
  title: string;
  description: string;
  status: { label: string; tone: Tone };
  children?: React.ReactNode;
}) {
  return (
    <section className="rounded-2xl border bg-card p-6 shadow-sm sm:p-7">
      <div className="flex items-start justify-between gap-4">
        <div className="flex items-start gap-4">
          <span className="flex size-12 shrink-0 items-center justify-center rounded-2xl bg-primary/10 text-primary">
            <Icon className="size-6" aria-hidden />
          </span>
          <div className="space-y-1">
            <h2 className="text-lg font-semibold tracking-tight">{title}</h2>
            <p className="max-w-xl text-sm leading-relaxed text-muted-foreground">{description}</p>
          </div>
        </div>
        <StatusBadge tone={status.tone}>{status.label}</StatusBadge>
      </div>
      {children ? <div className="mt-6 border-t pt-6">{children}</div> : null}
    </section>
  );
}
