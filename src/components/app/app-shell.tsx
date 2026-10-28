import { Building2 } from "lucide-react";
import { Logo } from "./logo";
import { NavLinks } from "./nav-links";
import { UserMenu } from "./user-menu";

/** The signed-in layout: fixed sidebar on desktop, compact header with pill navigation on mobile. */
export function AppShell({
  business,
  email,
  role,
  children,
}: {
  business: { name: string };
  email: string;
  role: string;
  children: React.ReactNode;
}) {
  return (
    <div className="min-h-screen lg:grid lg:grid-cols-[17rem_1fr]">
      <aside className="sticky top-0 hidden h-screen flex-col border-r bg-sidebar px-4 py-6 lg:flex">
        <Logo className="px-2" />
        <div className="mt-8 flex-1 overflow-y-auto">
          <NavLinks variant="sidebar" />
        </div>
        <div className="mt-6 flex items-center gap-3 rounded-2xl border bg-muted/50 p-3">
          <span className="flex size-9 shrink-0 items-center justify-center rounded-xl bg-primary/10 text-primary">
            <Building2 className="size-[18px]" aria-hidden />
          </span>
          <div className="min-w-0">
            <p className="truncate text-sm font-semibold">{business.name}</p>
            <p className="text-xs text-muted-foreground">Your business</p>
          </div>
        </div>
      </aside>

      <div className="flex min-w-0 flex-col">
        <header className="sticky top-0 z-30 border-b bg-background/85 backdrop-blur-md">
          <div className="flex h-16 items-center justify-between gap-3 px-4 sm:px-6 lg:px-10">
            <div className="lg:hidden">
              <Logo />
            </div>
            <p className="hidden truncate text-sm text-muted-foreground lg:block">
              Signed in to <span className="font-medium text-foreground">{business.name}</span>
            </p>
            <UserMenu email={email} role={role} />
          </div>
          <div className="px-4 sm:px-6 lg:hidden">
            <NavLinks variant="pills" />
          </div>
        </header>
        <main className="mx-auto w-full max-w-6xl flex-1 px-4 py-8 sm:px-6 lg:px-10 lg:py-10">{children}</main>
      </div>
    </div>
  );
}
