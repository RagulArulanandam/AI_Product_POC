import type { LucideIcon } from "lucide-react";
import { cn } from "@/lib/utils";

/** One headline number with an icon, as on the dashboard. */
export function StatCard({
  label,
  value,
  hint,
  icon: Icon,
  accent = "primary",
}: {
  label: string;
  value: number | string;
  hint?: string;
  icon: LucideIcon;
  accent?: "primary" | "success" | "warning" | "danger";
}) {
  const accents = {
    primary: "bg-primary/10 text-primary",
    success: "bg-success/12 text-[oklch(0.45_0.13_155)]",
    warning: "bg-warning/20 text-[oklch(0.5_0.12_70)]",
    danger: "bg-destructive/10 text-destructive",
  } as const;

  return (
    <div className="rounded-2xl border bg-card p-5 shadow-sm">
      <div className="flex items-start justify-between gap-3">
        <p className="text-sm font-medium text-muted-foreground">{label}</p>
        <span className={cn("flex size-9 items-center justify-center rounded-xl", accents[accent])}>
          <Icon className="size-[18px]" aria-hidden />
        </span>
      </div>
      <p className="mt-3 text-3xl font-semibold tracking-tight">{value}</p>
      {hint ? <p className="mt-1 text-xs text-muted-foreground">{hint}</p> : null}
    </div>
  );
}
