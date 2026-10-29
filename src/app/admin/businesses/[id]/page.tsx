import Link from "next/link";
import { notFound } from "next/navigation";
import { ArrowLeft } from "lucide-react";
import { setBusinessStatusAction } from "@/app/admin/actions";
import { AdminProductToggle } from "@/components/admin/admin-product-toggle";
import { ConfirmActionButton } from "@/components/admin/confirm-action-button";
import { LogFilter, LogsTable } from "@/components/admin/logs-table";
import { SubscriptionForm } from "@/components/admin/subscription-form";
import { PageHeader } from "@/components/app/page-header";
import { StatusBadge } from "@/components/app/status-badge";
import { requireAdmin } from "@/lib/auth/guards";
import { formatDateTime } from "@/lib/format";
import { conversationStatus, integrationProviderLabel, integrationStatus } from "@/lib/ui/status";
import { uuidSchema } from "@/lib/validation/admin";
import { getBusinessDetail, listAutomationLogs, LOG_STATUSES, type LogStatusFilter } from "@/services/admin";

export const metadata = { title: "Business" };

export default async function AdminBusinessPage(props: PageProps<"/admin/businesses/[id]">) {
  const { id } = await props.params;
  if (!uuidSchema.safeParse(id).success) notFound();

  const { admin } = await requireAdmin();
  const business = await getBusinessDetail(admin, id);
  if (!business) notFound();

  const search = await props.searchParams;
  const raw = Array.isArray(search.status) ? search.status[0] : search.status;
  const statusFilter = LOG_STATUSES.find((s) => s === raw) as LogStatusFilter | undefined;
  const logs = await listAutomationLogs(admin, { businessId: id, status: statusFilter, limit: 50 });

  const disabled = business.status === "disabled";
  const tz = business.timezone;

  return (
    <div className="space-y-8">
      <Link href="/admin" className="inline-flex items-center gap-1.5 text-sm text-muted-foreground hover:text-foreground">
        <ArrowLeft className="size-4" aria-hidden /> All businesses
      </Link>

      <PageHeader
        title={business.name}
        description={
          <span className="flex flex-wrap items-center gap-x-3 gap-y-1">
            <StatusBadge tone={disabled ? "warning" : "success"}>{disabled ? "Paused" : "Active"}</StatusBadge>
            <span>{business.phoneMasked}</span>
            <span>Time zone {tz}</span>
            <span>Joined {formatDateTime(business.createdAt, tz)}</span>
          </span>
        }
        actions={
          <ConfirmActionButton
            action={setBusinessStatusAction.bind(null, business.id, disabled ? "active" : "disabled")}
            label={disabled ? "Resume business" : "Pause business"}
            confirmLabel={disabled ? "Yes, resume" : "Yes, pause"}
            variant={disabled ? "outline" : "destructive"}
            size="default"
          />
        }
      />

      <div className="grid gap-6 lg:grid-cols-2">
        <section className="rounded-2xl border bg-card p-6 shadow-sm">
          <h2 className="text-base font-semibold">Subscription</h2>
          <p className="mb-5 mt-1 text-sm text-muted-foreground">Set by hand for the POC. Products can only be switched on by the business while the status is trial or active.</p>
          <SubscriptionForm
            businessId={business.id}
            values={{
              status: business.subscription?.status ?? "trial",
              plan: business.subscription?.plan ?? "trial",
              currentPeriodEnd: business.subscription?.currentPeriodEnd ?? null,
              notes: business.subscription?.notes ?? "",
            }}
          />
        </section>

        <div className="space-y-6">
          <section className="rounded-2xl border bg-card p-6 shadow-sm">
            <h2 className="text-base font-semibold">Products</h2>
            <p className="mb-4 mt-1 text-sm text-muted-foreground">An admin can switch a product on whatever the subscription says.</p>
            <ul className="divide-y">
              {business.products.map((p) => (
                <li key={p.key} className="flex items-center justify-between gap-4 py-3">
                  <div>
                    <p className="text-sm font-medium">{p.name}</p>
                    {p.available ? null : <p className="text-xs text-muted-foreground">Coming soon</p>}
                  </div>
                  {p.available ? <AdminProductToggle businessId={business.id} productKey={p.key} enabled={p.enabled} label={p.name} /> : null}
                </li>
              ))}
            </ul>
          </section>

          <section className="rounded-2xl border bg-card p-6 shadow-sm">
            <h2 className="text-base font-semibold">Integrations</h2>
            {business.integrations.length === 0 ? (
              <p className="mt-3 text-sm text-muted-foreground">Nothing connected yet.</p>
            ) : (
              <ul className="mt-3 divide-y">
                {business.integrations.map((i) => {
                  const s = integrationStatus(i.status);
                  return (
                    <li key={i.provider} className="flex items-start justify-between gap-4 py-3">
                      <div className="min-w-0">
                        <p className="text-sm font-medium">{integrationProviderLabel(i.provider)}</p>
                        {i.accountLabel ? <p className="truncate text-xs text-muted-foreground">{i.accountLabel}</p> : null}
                        {i.lastError ? <p className="mt-0.5 text-xs text-destructive">{i.lastError}</p> : null}
                      </div>
                      <StatusBadge tone={s.tone}>{s.label}</StatusBadge>
                    </li>
                  );
                })}
              </ul>
            )}
          </section>
        </div>
      </div>

      <section className="space-y-3">
        <h2 className="text-base font-semibold">Recent conversations</h2>
        {business.recentConversations.length === 0 ? (
          <p className="text-sm text-muted-foreground">No conversations yet.</p>
        ) : (
          <ul className="divide-y rounded-2xl border bg-card shadow-sm">
            {business.recentConversations.map((c) => {
              const s = conversationStatus(c.state);
              return (
                <li key={c.id} className="flex items-center justify-between gap-4 px-5 py-3 text-sm">
                  <span className="text-muted-foreground">{formatDateTime(c.startedAt, tz)}</span>
                  <StatusBadge tone={s.tone}>{s.label}</StatusBadge>
                </li>
              );
            })}
          </ul>
        )}
      </section>

      <section className="space-y-3">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <h2 className="text-base font-semibold">Automation log</h2>
          <LogFilter basePath={`/admin/businesses/${business.id}`} active={statusFilter} />
        </div>
        <LogsTable rows={logs} timezone={tz} />
      </section>
    </div>
  );
}
