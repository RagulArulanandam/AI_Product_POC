import Link from "next/link";
import { ArrowRight, Check } from "lucide-react";
import { buttonVariants } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import type { Checklist } from "@/services/dashboard";

/** The "get set up" card: a progress bar and the next steps, each linking to where it is done. */
export function SetupChecklist({ checklist }: { checklist: Checklist }) {
  const percent = checklist.total === 0 ? 100 : Math.round((checklist.done / checklist.total) * 100);
  const complete = checklist.done === checklist.total;

  return (
    <section className="rounded-2xl border bg-card p-6 shadow-sm">
      <div className="flex items-start justify-between gap-4">
        <div className="space-y-1">
          <h2 className="text-lg font-semibold tracking-tight">{complete ? "You are all set" : "Get set up"}</h2>
          <p className="text-sm text-muted-foreground">
            {complete ? "Your assistant is ready to handle missed calls." : `${checklist.done} of ${checklist.total} steps done`}
          </p>
        </div>
        <span className="text-2xl font-semibold tabular-nums text-primary">{percent}%</span>
      </div>
      <div
        className="mt-4 h-2 overflow-hidden rounded-full bg-muted"
        role="progressbar"
        aria-valuenow={percent}
        aria-valuemin={0}
        aria-valuemax={100}
        aria-label="Setup progress"
      >
        <div
          className="h-full rounded-full bg-gradient-to-r from-primary to-[oklch(0.62_0.2_300)] transition-all"
          style={{ width: `${percent}%` }}
        />
      </div>

      <ul className="mt-5 divide-y">
        {checklist.items.map((item) => (
          <li key={item.key} className="flex items-center gap-4 py-3.5">
            <span
              className={cn(
                "flex size-7 shrink-0 items-center justify-center rounded-full border-2",
                item.done ? "border-success bg-success text-success-foreground" : "border-border text-transparent",
              )}
              aria-hidden
            >
              <Check className="size-4" />
            </span>
            <div className="min-w-0 flex-1">
              <p className={cn("text-sm font-medium", item.done && "text-muted-foreground")}>
                {item.title}
                {item.optional ? (
                  <span className="ml-2 rounded-full bg-muted px-2 py-0.5 text-[11px] font-medium text-muted-foreground">Optional</span>
                ) : null}
              </p>
              <p className="text-sm text-muted-foreground">{item.description}</p>
            </div>
            {item.done ? null : (
              <Link href={item.href} className={buttonVariants({ variant: "outline", size: "sm" })}>
                {item.cta} <ArrowRight aria-hidden />
              </Link>
            )}
          </li>
        ))}
      </ul>
    </section>
  );
}
