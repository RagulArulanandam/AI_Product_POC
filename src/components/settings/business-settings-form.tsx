"use client";

import { useRouter } from "next/navigation";
import { useMemo, useState, useTransition } from "react";
import { toast } from "sonner";
import { updateBusinessAction } from "@/app/(app)/settings/actions";
import { BusinessHoursEditor } from "@/components/forms/business-hours-editor";
import { Field, FormSection } from "@/components/forms/form-section";
import { SaveBar } from "@/components/forms/save-bar";
import { Input } from "@/components/ui/input";
import type { BusinessHours } from "@/lib/validation/hours";

export interface BusinessDraft {
  name: string;
  phone: string;
  timezone: string;
  business_hours: BusinessHours;
}

export function BusinessSettingsForm({ initial, timezones }: { initial: BusinessDraft; timezones: string[] }) {
  const router = useRouter();
  const [baseline, setBaseline] = useState(initial);
  const [draft, setDraft] = useState(initial);
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [pending, startTransition] = useTransition();

  const dirty = useMemo(() => JSON.stringify(draft) !== JSON.stringify(baseline), [draft, baseline]);
  const set = <K extends keyof BusinessDraft>(key: K, value: BusinessDraft[K]) => setDraft((d) => ({ ...d, [key]: value }));

  function save() {
    startTransition(async () => {
      const result = await updateBusinessAction(JSON.stringify(draft));
      if (result.ok) {
        setErrors({});
        setBaseline(draft);
        toast.success("Business details saved");
        router.refresh();
        return;
      }
      setErrors(result.fieldErrors ?? {});
      toast.error(result.message);
      requestAnimationFrame(() => document.querySelector('[role="alert"]')?.scrollIntoView({ behavior: "smooth", block: "center" }));
    });
  }

  return (
    <div className="space-y-6 pb-28">
      <FormSection title="Business details" description="Shown to your team and used when your assistant introduces itself.">
        <Field label="Business name" htmlFor="biz-name" error={errors.name}>
          <Input id="biz-name" value={draft.name} maxLength={120} onChange={(e) => set("name", e.target.value)} aria-invalid={errors.name ? true : undefined} />
        </Field>
        <div className="grid gap-6 sm:grid-cols-2">
          <Field label="Business phone number" htmlFor="biz-phone" hint="The number your customers call." error={errors.phone}>
            <Input id="biz-phone" type="tel" value={draft.phone} onChange={(e) => set("phone", e.target.value)} aria-invalid={errors.phone ? true : undefined} />
          </Field>
          <Field label="Timezone" htmlFor="biz-timezone" hint="Opening hours are read in this timezone." error={errors.timezone}>
            <select
              id="biz-timezone"
              value={draft.timezone}
              onChange={(e) => set("timezone", e.target.value)}
              className="border-input bg-card h-11 w-full rounded-xl border px-3.5 text-sm shadow-xs outline-none focus-visible:border-ring focus-visible:ring-3 focus-visible:ring-ring/50"
            >
              {timezones.map((tz) => (
                <option key={tz} value={tz}>
                  {tz}
                </option>
              ))}
            </select>
          </Field>
        </div>
      </FormSection>

      <FormSection title="Opening hours" description="Your assistant sends a different message when you are closed. Products can use their own hours instead.">
        <BusinessHoursEditor value={draft.business_hours} onChange={(v) => set("business_hours", v)} errors={errors} idPrefix="biz-hours" />
      </FormSection>

      <SaveBar
        dirty={dirty}
        pending={pending}
        onSave={save}
        onDiscard={() => {
          setDraft(baseline);
          setErrors({});
        }}
      />
    </div>
  );
}
