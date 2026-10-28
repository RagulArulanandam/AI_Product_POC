"use client";

import { useActionState } from "react";
import { createBusinessAction } from "@/app/onboarding/actions";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { FieldError, FormError } from "./form-parts";

export function OnboardingForm({ timezones }: { timezones: string[] }) {
  const [state, formAction, pending] = useActionState(createBusinessAction, undefined);

  return (
    <form action={formAction} className="space-y-4">
      <FormError state={state} />
      <div className="space-y-2">
        <Label htmlFor="name">Business name</Label>
        <Input id="name" name="name" autoComplete="organization" maxLength={120} required />
        <FieldError state={state} name="name" />
      </div>
      <div className="space-y-2">
        <Label htmlFor="phone">Business phone number</Label>
        <Input id="phone" name="phone" type="tel" autoComplete="tel" placeholder="020 7946 0000" required />
        <p className="text-xs text-muted-foreground">The number your customers call.</p>
        <FieldError state={state} name="phone" />
      </div>
      <div className="space-y-2">
        <Label htmlFor="timezone">Timezone</Label>
        <select
          id="timezone"
          name="timezone"
          defaultValue="Europe/London"
          className="border-input bg-background h-9 w-full rounded-md border px-3 text-sm"
        >
          {timezones.map((tz) => (
            <option key={tz} value={tz}>
              {tz}
            </option>
          ))}
        </select>
        <FieldError state={state} name="timezone" />
      </div>
      <Button type="submit" className="w-full" disabled={pending}>
        {pending ? "Creating business..." : "Create business"}
      </Button>
    </form>
  );
}
