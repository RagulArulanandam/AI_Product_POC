"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { Building2, TriangleAlert, type LucideIcon } from "lucide-react";
import { cn } from "@/lib/utils";

interface AdminNavItem {
  href: string;
  label: string;
  icon: LucideIcon;
  /** Shown as a red count when above zero. */
  badge?: number;
}

/** A link is active on its own page and beneath it; /admin itself also covers /admin/businesses/[id]. */
export function isAdminActive(pathname: string, href: string): boolean {
  if (href === "/admin") return pathname === "/admin" || pathname.startsWith("/admin/businesses");
  return pathname === href || pathname.startsWith(`${href}/`);
}

export function AdminNav({ failedCount, variant }: { failedCount: number; variant: "sidebar" | "pills" }) {
  const pathname = usePathname();
  const items: AdminNavItem[] = [
    { href: "/admin", label: "Businesses", icon: Building2 },
    { href: "/admin/failures", label: "Failures", icon: TriangleAlert, badge: failedCount },
  ];

  return (
    <nav aria-label="Admin" className={cn(variant === "sidebar" ? "space-y-1" : "no-scrollbar -mx-4 flex gap-1.5 overflow-x-auto px-4 pb-3")}>
      {items.map(({ href, label, icon: Icon, badge }) => {
        const active = isAdminActive(pathname, href);
        return (
          <Link
            key={href}
            href={href}
            aria-current={active ? "page" : undefined}
            className={cn(
              variant === "sidebar"
                ? "flex items-center gap-3 rounded-xl px-3 py-2.5 text-sm font-medium transition-colors"
                : "inline-flex shrink-0 items-center gap-1.5 rounded-full border px-3.5 py-1.5 text-sm font-medium transition-colors",
              variant === "sidebar"
                ? active
                  ? "bg-white/12 text-white"
                  : "text-white/65 hover:bg-white/8 hover:text-white"
                : active
                  ? "border-foreground bg-foreground text-background"
                  : "bg-card text-muted-foreground hover:text-foreground",
            )}
          >
            <Icon className="size-[18px]" aria-hidden />
            {label}
            {badge ? (
              <span className="ml-auto rounded-full bg-destructive px-2 py-0.5 text-[11px] font-semibold leading-none text-white" aria-label={`${badge} failed`}>
                {badge}
              </span>
            ) : null}
          </Link>
        );
      })}
    </nav>
  );
}
