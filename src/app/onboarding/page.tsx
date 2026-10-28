import { OnboardingForm } from "@/components/auth/onboarding-form";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { requireNoBusiness } from "@/lib/auth/guards";
import { supportedTimezones } from "@/lib/validation/business";

export default async function OnboardingPage() {
  await requireNoBusiness();

  return (
    <main className="flex flex-1 items-center justify-center px-4 py-12">
      <Card className="w-full max-w-md">
        <CardHeader>
          <CardTitle>Tell us about your business</CardTitle>
          <CardDescription>You can change these details later, and set opening hours in settings.</CardDescription>
        </CardHeader>
        <CardContent>
          <OnboardingForm timezones={supportedTimezones()} />
        </CardContent>
      </Card>
    </main>
  );
}
