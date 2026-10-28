import { PageHeader } from "@/components/app/page-header";
import { BusinessSettingsForm } from "@/components/settings/business-settings-form";
import { requireBusiness } from "@/lib/auth/guards";
import { formatPhone } from "@/lib/phone";
import { supportedTimezones } from "@/lib/validation/business";
import { parseHours } from "@/products/missed-call/hours";

export const metadata = { title: "Settings" };

export default async function SettingsPage() {
  const { business } = await requireBusiness();

  return (
    <div className="space-y-8">
      <PageHeader title="Settings" description="Your business details and opening hours." />
      <BusinessSettingsForm
        initial={{
          name: business.name,
          phone: formatPhone(business.phone_e164),
          timezone: business.timezone,
          business_hours: parseHours(business.business_hours),
        }}
        timezones={supportedTimezones()}
      />
    </div>
  );
}
