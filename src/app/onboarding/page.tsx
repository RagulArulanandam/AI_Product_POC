import { AuthShell } from "@/components/auth/auth-shell";
import { OnboardingForm } from "@/components/auth/onboarding-form";
import { requireNoBusiness } from "@/lib/auth/guards";
import { supportedTimezones } from "@/lib/validation/business";

export const metadata = { title: "Set up your business" };

export default async function OnboardingPage() {
  await requireNoBusiness();

  return (
    <AuthShell>
      <div className="space-y-8">
        <div className="space-y-2">
          <p className="text-sm font-medium text-primary">Step 1 of 1</p>
          <h1 className="text-3xl font-semibold tracking-tight">Tell us about your business</h1>
          <p className="text-muted-foreground">You can change these later, and set your opening hours in Settings.</p>
        </div>
        <OnboardingForm timezones={supportedTimezones()} />
      </div>
    </AuthShell>
  );
}
