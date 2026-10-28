import { CalendarClock, Check, LifeBuoy } from "lucide-react";
import { PageHeader } from "@/components/app/page-header";
import { StatusBadge } from "@/components/app/status-badge";
import { requireBusiness } from "@/lib/auth/guards";
import { formatDate } from "@/lib/format";
import { subscriptionStatus } from "@/lib/ui/status";
import { getSubscription } from "@/services/business";

export const metadata = { title: "Billing" };

const INCLUDED = [
  "Missed Call to WhatsApp Assistant",
  "AI replies to your customers, day and night",
  "Alerts when a customer needs a person",
  "Conversation history and activity numbers",
];

export default async function BillingPage() {
  const { supabase, business } = await requireBusiness();
  const subscription = await getSubscription(supabase, business.id);
  const status = subscriptionStatus(subscription?.status ?? "trial");

  return (
    <div className="space-y-8">
      <PageHeader title="Billing" description="Your plan and subscription status." />

      <div className="grid gap-6 lg:grid-cols-[1.4fr_1fr]">
        <section className="rounded-2xl border bg-card p-6 shadow-sm sm:p-7">
          <div className="flex items-start justify-between gap-4">
            <div>
              <p className="text-sm font-medium text-muted-foreground">Current plan</p>
              <p className="mt-1 text-3xl font-semibold capitalize tracking-tight">{subscription?.plan ?? "Trial"}</p>
            </div>
            <StatusBadge tone={status.tone}>{status.label}</StatusBadge>
          </div>

          <dl className="mt-6 divide-y rounded-xl border">
            <div className="flex items-center justify-between gap-4 px-4 py-3.5">
              <dt className="flex items-center gap-2 text-sm text-muted-foreground">
                <CalendarClock className="size-4" aria-hidden /> {subscription?.currentPeriodEnd ? "Renews or ends" : "Billing period"}
              </dt>
              <dd className="text-sm font-medium">
                {subscription?.currentPeriodEnd ? formatDate(subscription.currentPeriodEnd, business.timezone) : "Not set yet"}
              </dd>
            </div>
            {subscription?.notes ? (
              <div className="px-4 py-3.5">
                <dt className="text-sm text-muted-foreground">Notes from our team</dt>
                <dd className="mt-1 text-sm">{subscription.notes}</dd>
              </div>
            ) : null}
          </dl>

          <h2 className="mb-3 mt-8 text-sm font-semibold">What is included</h2>
          <ul className="space-y-2.5">
            {INCLUDED.map((item) => (
              <li key={item} className="flex items-center gap-3 text-sm">
                <span className="flex size-5 items-center justify-center rounded-full bg-success/15 text-[oklch(0.45_0.13_155)]">
                  <Check className="size-3.5" aria-hidden />
                </span>
                {item}
              </li>
            ))}
          </ul>
        </section>

        <aside className="h-fit rounded-2xl border bg-gradient-to-br from-primary/10 to-[oklch(0.62_0.2_300)]/10 p-6 sm:p-7">
          <span className="mb-4 flex size-11 items-center justify-center rounded-xl bg-primary/15 text-primary">
            <LifeBuoy className="size-5" aria-hidden />
          </span>
          <h2 className="text-lg font-semibold tracking-tight">Want to change your plan?</h2>
          <p className="mt-2 text-sm leading-relaxed text-muted-foreground">
            Plans are managed by our team for now. Get in touch to upgrade, pause or cancel, and we will update your subscription.
          </p>
        </aside>
      </div>
    </div>
  );
}
