import Link from "next/link";
import { Inbox, Newspaper, PhoneMissed, Settings2, type LucideIcon } from "lucide-react";
import { StatusBadge } from "@/components/app/status-badge";
import { buttonVariants } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import type { ProductView } from "@/services/products";
import { ProductToggle } from "./product-toggle";

const ICONS: Record<string, LucideIcon> = {
  "missed-call": PhoneMissed,
  "priority-inbox": Inbox,
  "daily-brief": Newspaper,
};

export function ProductCard({ product }: { product: ProductView }) {
  const comingSoon = product.status === "coming_soon";
  const Icon = ICONS[product.key] ?? PhoneMissed;

  return (
    <div
      data-testid={`product-${product.key}`}
      className={cn(
        "flex flex-col rounded-2xl border bg-card p-6 shadow-sm transition-shadow",
        comingSoon ? "opacity-75" : "hover:shadow-md",
      )}
    >
      <div className="flex items-start justify-between gap-3">
        <span className="flex size-12 items-center justify-center rounded-2xl bg-primary/10 text-primary">
          <Icon className="size-6" aria-hidden />
        </span>
        {comingSoon ? (
          <StatusBadge tone="neutral">Coming soon</StatusBadge>
        ) : product.enabled ? (
          <StatusBadge tone="success">Running</StatusBadge>
        ) : (
          <StatusBadge tone="neutral">Switched off</StatusBadge>
        )}
      </div>

      <h3 className="mt-5 text-lg font-semibold tracking-tight">{product.name}</h3>
      <p className="mt-1.5 flex-1 text-sm leading-relaxed text-muted-foreground">{product.description}</p>

      {comingSoon ? null : (
        <div className="mt-6 flex items-center justify-between gap-3 border-t pt-5">
          <ProductToggle productKey={product.key} enabled={product.enabled} label={product.name} />
          <Link href={`/products/${product.key}`} className={buttonVariants({ variant: "outline", size: "sm" })}>
            <Settings2 aria-hidden /> Configure
          </Link>
        </div>
      )}
    </div>
  );
}
