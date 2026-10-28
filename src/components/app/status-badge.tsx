import { cn } from "@/lib/utils";
import type { Tone } from "@/lib/ui/status";

const TONES: Record<Tone, string> = {
  success: "bg-success/12 text-[oklch(0.42_0.13_155)] ring-success/25",
  warning: "bg-warning/20 text-[oklch(0.45_0.1_70)] ring-warning/40",
  danger: "bg-destructive/10 text-destructive ring-destructive/25",
  neutral: "bg-muted text-muted-foreground ring-border",
  info: "bg-primary/10 text-primary ring-primary/20",
};

const DOTS: Record<Tone, string> = {
  success: "bg-success",
  warning: "bg-warning",
  danger: "bg-destructive",
  neutral: "bg-muted-foreground/60",
  info: "bg-primary",
};

/** A small coloured pill with a dot, used for states everywhere in the dashboard. */
export function StatusBadge({ tone, children, className }: { tone: Tone; children: React.ReactNode; className?: string }) {
  return (
    <span
      className={cn(
        "inline-flex items-center gap-1.5 rounded-full px-2.5 py-0.5 text-xs font-medium ring-1 ring-inset",
        TONES[tone],
        className,
      )}
    >
      <span className={cn("size-1.5 rounded-full", DOTS[tone])} aria-hidden />
      {children}
    </span>
  );
}
