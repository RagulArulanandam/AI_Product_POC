import Link from "next/link";
import { Building2, CalendarCheck, MessagesSquare, TriangleAlert, UserRoundCheck } from "lucide-react";
import { EmptyState } from "@/components/app/empty-state";
import { PageHeader } from "@/components/app/page-header";
import { StatCard } from "@/components/app/stat-card";
import { StatusBadge } from "@/components/app/status-badge";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { requireAdmin } from "@/lib/auth/guards";
import { formatDate } from "@/lib/format";
import { integrationProviderLabel, integrationStatus, subscriptionStatus } from "@/lib/ui/status";
import { getPlatformMetrics, listBusinessOverviews } from "@/services/admin";

export const metadata = { title: "Businesses" };

export default async function AdminHome() {
  const { admin } = await requireAdmin();
  const now = new Date();
  const [metrics, businesses] = await Promise.all([getPlatformMetrics(admin, now), listBusinessOverviews(admin, now)]);

  return (
    <div className="space-y-8">
      <PageHeader title="Businesses" description="Everyone on the platform, with their subscription, products and how things are running." />

      <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
        <StatCard label="Businesses" value={metrics.businesses} hint={`${metrics.activeBusinesses} active`} icon={Building2} />
        <StatCard label="Conversations" value={metrics.conversations} hint="Last 30 days" icon={MessagesSquare} />
        <StatCard label="Bookings" value={metrics.bookings} hint="Last 30 days" icon={CalendarCheck} accent="success" />
        <StatCard label="Needs a person" value={metrics.escalations} hint="Handed over, last 30 days" icon={UserRoundCheck} accent="warning" />
      </div>

      {metrics.failedActions > 0 || metrics.errorsLast24h > 0 ? (
        <Link
          href="/admin/failures"
          className="flex items-center gap-3 rounded-2xl border border-destructive/25 bg-destructive/5 p-4 text-sm transition-colors hover:bg-destructive/10"
        >
          <TriangleAlert className="size-5 shrink-0 text-destructive" aria-hidden />
          <span>
            <span className="font-semibold">{metrics.failedActions} failed automation{metrics.failedActions === 1 ? "" : "s"}</span>
            <span className="text-muted-foreground"> and {metrics.errorsLast24h} error{metrics.errorsLast24h === 1 ? "" : "s"} logged in the last 24 hours. View failures</span>
          </span>
        </Link>
      ) : null}

      {businesses.length === 0 ? (
        <EmptyState icon={Building2} title="No businesses yet" description="Businesses appear here as soon as someone signs up." />
      ) : (
        <div className="overflow-hidden rounded-2xl border bg-card shadow-sm">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Business</TableHead>
                <TableHead>Status</TableHead>
                <TableHead>Subscription</TableHead>
                <TableHead>Products on</TableHead>
                <TableHead>Integrations</TableHead>
                <TableHead className="text-right">30 days</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {businesses.map((b) => {
                const sub = b.subscription ? subscriptionStatus(b.subscription.status) : null;
                return (
                  <TableRow key={b.id} data-testid={`business-${b.id}`}>
                    <TableCell>
                      <Link href={`/admin/businesses/${b.id}`} className="font-semibold hover:text-primary hover:underline">
                        {b.name}
                      </Link>
                      <p className="text-xs text-muted-foreground">
                        {b.phoneMasked} · joined {formatDate(b.createdAt, b.timezone)}
                      </p>
                    </TableCell>
                    <TableCell>
                      <StatusBadge tone={b.status === "active" ? "success" : "warning"}>{b.status === "active" ? "Active" : "Paused"}</StatusBadge>
                    </TableCell>
                    <TableCell>{sub ? <StatusBadge tone={sub.tone}>{sub.label}</StatusBadge> : <span className="text-muted-foreground">None</span>}</TableCell>
                    <TableCell className="text-sm">{b.products.length ? b.products.map((p) => p.name).join(", ") : <span className="text-muted-foreground">None</span>}</TableCell>
                    <TableCell>
                      <div className="flex flex-wrap gap-1.5">
                        {b.integrations.length === 0 ? <span className="text-sm text-muted-foreground">None</span> : null}
                        {b.integrations.map((i) => {
                          const s = integrationStatus(i.status);
                          return (
                            <StatusBadge key={i.provider} tone={s.tone}>
                              {integrationProviderLabel(i.provider)}
                            </StatusBadge>
                          );
                        })}
                      </div>
                    </TableCell>
                    <TableCell className="text-right text-sm tabular-nums">
                      {b.stats.conversations} chats
                      {b.stats.escalations ? <span className="text-muted-foreground"> ·{b.stats.escalations} handed over</span> : null}
                      {b.stats.failedActions ? <span className="font-medium text-destructive"> · {b.stats.failedActions} failed</span> : null}
                    </TableCell>
                  </TableRow>
                );
              })}
            </TableBody>
          </Table>
        </div>
      )}
    </div>
  );
}
