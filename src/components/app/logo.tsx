import { Sparkles } from "lucide-react";
import { cn } from "@/lib/utils";

/** The product mark: a violet gradient tile with a spark, and the wordmark. */
export function Logo({ className, inverted = false }: { className?: string; inverted?: boolean }) {
  return (
    <span className={cn("inline-flex items-center gap-2.5", className)}>
      <span className="flex size-9 items-center justify-center rounded-xl bg-gradient-to-br from-[oklch(0.62_0.22_295)] to-[oklch(0.46_0.24_278)] text-white shadow-md shadow-primary/30">
        <Sparkles className="size-[18px]" aria-hidden />
      </span>
      <span className={cn("text-[15px] font-semibold leading-none tracking-tight", inverted && "text-white")}>
        Business
        <br />
        <span className={cn("font-medium text-muted-foreground", inverted && "text-white/70")}>Automation</span>
      </span>
    </span>
  );
}
