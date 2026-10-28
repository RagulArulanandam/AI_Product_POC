import Link from "next/link";
import { CalendarCheck, MessageCircle, MessagesSquare, PhoneMissed, TriangleAlert } from "lucide-react";
import { PageHeader } from "@/components/app/page-header";
import { RecentConversations } from "@/components/app/recent-conversations";
import { SetupChecklist } from "@/components/app/setup-checklist";
import { StatCard } from "@/components/app/stat-card";
import { requireBusiness } from "@/lib/auth/guards";
import { cn } from "@/lib/utils";
import { getMetrics, getSetupChecklist, listRecentConversations } from "@/services/dashboard";

export const metadata = { title: "Dashboard" };

const PERIODS = [7, 30] as const;

export default async function DashboardPage(props: PageProps<"/dashboard">) {
  const { supabase, business } = await requireBusiness();
  const { days: raw } = await props.searchParams;
  const days = PERIODS.find((d) => String(d) === raw) ?? 30;

  const now = new Date();
  const since = new Date(now.getTime() - days * 24 * 3_600_000);
  const [metrics, checklist, recent] = await Promise.all([
    getMetrics(supabase, business.id, since),
    getSetupChecklist(supabase, business.id),
    listRecentConversations(supabase, business.id, 5),
  ]);

  return (
    <div className="space-y-8">
      <PageHeader
        title="Welcome back"
        description={`Here is how ${business.name} is doing over the last ${days} days.`}
        actions={
          <div className="inline-flex rounded-xl border bg-card p-1 shadow-sm" role="group" aria-label="Time period">
            {PERIODS.map((d) => (
              <Link
                key={d}
                href={`/dashboard?days=${d}`}
                aria-current={d === days ? "true" : undefined}
                className={cn(
                  "rounded-lg px-3.5 py-1.5 text-sm font-medium transition-colors",
                  d === days ? "bg-primary text-primary-foreground shadow-sm" : "text-muted-foreground hover:text-foreground",
                )}
              >
                {d} days
              </Link>
            ))}
          </div>
        }
      />

      <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
        <StatCard label="Missed calls handled" value={metrics.missedCalls} hint="Customers your assistant messaged" icon={PhoneMissed} />
        <StatCard label="Conversations" value={metrics.conversations} hint="Customers who wrote back" icon={MessageCircle} accent="success" />
        <StatCard label="Bookings" value={metrics.bookings} hint="Appointments made" icon={CalendarCheck} accent="success" />
        <StatCard
          label="Needs your attention"
          value={metrics.escalations}
          hint={metrics.escalations === 0 ? "Nothing waiting" : "Handed over to you"}
          icon={metrics.escalations === 0 ? MessagesSquare : TriangleAlert}
          accent={metrics.escalations === 0 ? "primary" : "danger"}
        />
      </div>

      <div className="grid gap-6 xl:grid-cols-[1.05fr_1fr]">
        <SetupChecklist checklist={checklist} />
        <RecentConversations conversations={recent} timezone={business.timezone} now={now} />
      </div>
    </div>
  );
}
