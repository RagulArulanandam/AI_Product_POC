import { ShieldCheck } from "lucide-react";
import { Logo } from "@/components/app/logo";
import { UserMenu } from "@/components/app/user-menu";
import { AdminNav } from "./admin-nav";

/**
 * The platform admin layout. Deliberately unlike the customer shell (dark sidebar, amber banner)
 * so an admin never mistakes it for a business's own dashboard (frontend.md section 3).
 */
export function AdminShell({ email, failedCount, children }: { email: string; failedCount: number; children: React.ReactNode }) {
  return (
    <div className="min-h-screen lg:grid lg:grid-cols-[16rem_1fr]">
      <aside className="sticky top-0 hidden h-screen flex-col bg-[oklch(0.22_0.035_285)] px-4 py-6 text-white lg:flex">
        <Logo className="px-2" inverted />
        <div className="mt-8 flex-1">
          <p className="mb-2 px-3 text-[11px] font-semibold uppercase tracking-wider text-white/45">Platform</p>
          <AdminNav failedCount={failedCount} variant="sidebar" />
        </div>
        <p className="px-3 text-xs text-white/45">Changes here are logged with your account.</p>
      </aside>

      <div className="flex min-w-0 flex-col">
        <div className="flex items-center gap-2 bg-warning/90 px-4 py-1.5 text-xs font-semibold text-[oklch(0.3_0.07_70)] sm:px-6 lg:px-10">
          <ShieldCheck className="size-3.5" aria-hidden /> Admin panel: you can see every business
        </div>
        <header className="sticky top-0 z-30 border-b bg-background/85 backdrop-blur-md">
          <div className="flex h-16 items-center justify-between gap-3 px-4 sm:px-6 lg:px-10">
            <div className="lg:hidden">
              <Logo />
            </div>
            <p className="hidden text-sm font-medium text-muted-foreground lg:block">Platform admin</p>
            <UserMenu email={email} role="Platform admin" />
          </div>
          <div className="px-4 sm:px-6 lg:hidden">
            <AdminNav failedCount={failedCount} variant="pills" />
          </div>
        </header>
        <main className="mx-auto w-full max-w-7xl flex-1 px-4 py-8 sm:px-6 lg:px-10 lg:py-10">{children}</main>
      </div>
    </div>
  );
}
