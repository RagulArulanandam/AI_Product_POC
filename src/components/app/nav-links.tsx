"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import {
  CreditCard,
  LayoutDashboard,
  MessagesSquare,
  Plug,
  Settings,
  Sparkles,
  type LucideIcon,
} from "lucide-react";
import { cn } from "@/lib/utils";

interface NavItem {
  href: string;
  label: string;
  icon: LucideIcon;
}

export const NAV_SECTIONS: { title: string; items: NavItem[] }[] = [
  { title: "Overview", items: [{ href: "/dashboard", label: "Dashboard", icon: LayoutDashboard }] },
  {
    title: "Automations",
    items: [
      { href: "/products", label: "Products", icon: Sparkles },
      { href: "/conversations", label: "Conversations", icon: MessagesSquare },
    ],
  },
  { title: "Connections", items: [{ href: "/integrations", label: "Integrations", icon: Plug }] },
  {
    title: "Account",
    items: [
      { href: "/billing", label: "Billing", icon: CreditCard },
      { href: "/settings", label: "Settings", icon: Settings },
    ],
  },
];

/** A link is active on its own page and on pages beneath it (e.g. /products/missed-call). */
export function isActive(pathname: string, href: string): boolean {
  return pathname === href || pathname.startsWith(`${href}/`);
}

/** Sidebar navigation (desktop) and a scrolling pill row (mobile). */
export function NavLinks({ variant }: { variant: "sidebar" | "pills" }) {
  const pathname = usePathname();

  if (variant === "pills") {
    return (
      <nav aria-label="Main" className="no-scrollbar -mx-4 flex gap-1.5 overflow-x-auto px-4 pb-3">
        {NAV_SECTIONS.flatMap((s) => s.items).map(({ href, label, icon: Icon }) => {
          const active = isActive(pathname, href);
          return (
            <Link
              key={href}
              href={href}
              aria-current={active ? "page" : undefined}
              className={cn(
                "inline-flex shrink-0 items-center gap-1.5 rounded-full border px-3.5 py-1.5 text-sm font-medium transition-colors",
                active ? "border-primary bg-primary text-primary-foreground shadow-sm" : "bg-card text-muted-foreground hover:text-foreground",
              )}
            >
              <Icon className="size-4" aria-hidden />
              {label}
            </Link>
          );
        })}
      </nav>
    );
  }

  return (
    <nav aria-label="Main" className="space-y-6">
      {NAV_SECTIONS.map((section) => (
        <div key={section.title} className="space-y-1">
          <p className="px-3 text-[11px] font-semibold uppercase tracking-wider text-muted-foreground/80">{section.title}</p>
          {section.items.map(({ href, label, icon: Icon }) => {
            const active = isActive(pathname, href);
            return (
              <Link
                key={href}
                href={href}
                aria-current={active ? "page" : undefined}
                className={cn(
                  "group flex items-center gap-3 rounded-xl px-3 py-2.5 text-sm font-medium transition-colors",
                  active
                    ? "bg-primary/10 text-primary"
                    : "text-muted-foreground hover:bg-muted hover:text-foreground",
                )}
              >
                <Icon className={cn("size-[18px]", active ? "text-primary" : "text-muted-foreground group-hover:text-foreground")} aria-hidden />
                {label}
                {active ? <span className="ml-auto size-1.5 rounded-full bg-primary" aria-hidden /> : null}
              </Link>
            );
          })}
        </div>
      ))}
    </nav>
  );
}
