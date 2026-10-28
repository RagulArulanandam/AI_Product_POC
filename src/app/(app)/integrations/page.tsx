import { CalendarDays, MessageCircle } from "lucide-react";
import { PageHeader } from "@/components/app/page-header";
import { ForwardingCard } from "@/components/integrations/forwarding-card";
import { IntegrationCard } from "@/components/integrations/integration-card";
import { Button } from "@/components/ui/button";
import { requireBusiness } from "@/lib/auth/guards";
import { integrationStatus } from "@/lib/ui/status";
import { getIntegrationsOverview } from "@/services/integrations";

export const metadata = { title: "Integrations" };

export default async function IntegrationsPage() {
  const { supabase, business } = await requireBusiness();
  const overview = await getIntegrationsOverview(supabase, business.id);

  return (
    <div className="space-y-8">
      <PageHeader title="Integrations" description="Connect your phone and calendar so your assistant can do its job." />

      <div className="space-y-6">
        <IntegrationCard
          icon={MessageCircle}
          title="WhatsApp"
          description="Your assistant messages customers from a shared business WhatsApp number, with your business name at the start of the message. Nothing to set up."
          status={{ label: "Active", tone: "success" }}
        />

        <ForwardingCard assistantNumber={overview.assistantNumber} confirmed={overview.telephony.forwardingConfirmed} />

        <IntegrationCard
          icon={CalendarDays}
          title="Google Calendar"
          description="Lets your assistant see when you are free and add appointments straight into your calendar."
          status={integrationStatus(overview.calendar.status)}
        >
          {overview.calendar.status === "connected" ? (
            <p className="text-sm text-muted-foreground">
              Connected as <span className="font-medium text-foreground">{overview.calendar.accountLabel}</span>.
            </p>
          ) : (
            <div className="flex flex-wrap items-center justify-between gap-3">
              <p className="text-sm text-muted-foreground">
                {overview.calendar.lastError ?? "Connect your calendar to let customers book appointments automatically."}
              </p>
              <Button type="button" disabled title="Available in the next update">
                Connect Google Calendar
              </Button>
            </div>
          )}
        </IntegrationCard>
      </div>
    </div>
  );
}
