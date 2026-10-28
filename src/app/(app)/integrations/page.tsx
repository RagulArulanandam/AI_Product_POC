import { CircleCheck, MessageCircle, TriangleAlert } from "lucide-react";
import { PageHeader } from "@/components/app/page-header";
import { CalendarCard } from "@/components/integrations/calendar-card";
import { ForwardingCard } from "@/components/integrations/forwarding-card";
import { IntegrationCard } from "@/components/integrations/integration-card";
import { requireBusiness } from "@/lib/auth/guards";
import { isGoogleConfigured } from "@/lib/env";
import { calendarFlash } from "@/lib/ui/calendar-flash";
import { getIntegrationsOverview } from "@/services/integrations";

export const metadata = { title: "Integrations" };

export default async function IntegrationsPage(props: PageProps<"/integrations">) {
  const { supabase, business } = await requireBusiness();
  const overview = await getIntegrationsOverview(supabase, business.id);
  const flash = calendarFlash((await props.searchParams).calendar);

  return (
    <div className="space-y-8">
      <PageHeader title="Integrations" description="Connect your phone and calendar so your assistant can do its job." />

      {flash ? (
        <div
          role="status"
          className={
            flash.tone === "success"
              ? "flex gap-3 rounded-2xl border border-success/30 bg-success/10 p-4"
              : flash.tone === "warning"
                ? "flex gap-3 rounded-2xl border border-warning/40 bg-warning/15 p-4"
                : "flex gap-3 rounded-2xl border border-destructive/25 bg-destructive/5 p-4"
          }
        >
          {flash.tone === "success" ? <CircleCheck className="mt-0.5 size-5 shrink-0 text-success" aria-hidden /> : <TriangleAlert className="mt-0.5 size-5 shrink-0" aria-hidden />}
          <div>
            <p className="font-semibold">{flash.title}</p>
            <p className="text-sm text-muted-foreground">{flash.body}</p>
          </div>
        </div>
      ) : null}

      <div className="space-y-6">
        <IntegrationCard
          icon={MessageCircle}
          title="WhatsApp"
          description="Your assistant messages customers from a shared business WhatsApp number, with your business name at the start of the message. Nothing to set up."
          status={{ label: "Active", tone: "success" }}
        />

        <ForwardingCard assistantNumber={overview.assistantNumber} confirmed={overview.telephony.forwardingConfirmed} />

        <CalendarCard
          status={overview.calendar.status}
          accountLabel={overview.calendar.accountLabel}
          lastError={overview.calendar.lastError}
          available={isGoogleConfigured()}
        />
      </div>
    </div>
  );
}
