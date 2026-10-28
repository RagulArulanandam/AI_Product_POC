"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useMemo, useState, useTransition } from "react";
import { toast } from "sonner";
import { Check, Loader2 } from "lucide-react";
import { saveProductConfigAction } from "@/app/(app)/products/actions";
import { BusinessHoursEditor } from "@/components/forms/business-hours-editor";
import { Field, FormSection, ToggleRow } from "@/components/forms/form-section";
import { MessagePreview } from "@/components/products/message-preview";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Switch } from "@/components/ui/switch";
import { Textarea } from "@/components/ui/textarea";
import { cn } from "@/lib/utils";
import { DEFAULT_BUSINESS_HOURS, type BusinessHours } from "@/lib/validation/hours";
import type { MissedCallConfig } from "./config";

/** Numbers are held as text while typing, so an empty box is not forced to 0. */
interface Draft {
  delay_minutes: string;
  send_outside_hours: boolean;
  first_message_template: string;
  outside_hours_template: string;
  hoursMode: "profile" | "custom";
  business_hours: BusinessHours;
  booking_enabled: boolean;
  appointment_duration_minutes: string;
  buffer_minutes: string;
  escalation_email: string;
  escalate_on: MissedCallConfig["escalate_on"];
  business_blurb: string;
}

export function toDraft(config: MissedCallConfig): Draft {
  return {
    delay_minutes: String(config.delay_minutes),
    send_outside_hours: config.send_outside_hours,
    first_message_template: config.first_message_template,
    outside_hours_template: config.outside_hours_template,
    hoursMode: config.business_hours ? "custom" : "profile",
    business_hours: config.business_hours ?? DEFAULT_BUSINESS_HOURS,
    booking_enabled: config.booking_enabled,
    appointment_duration_minutes: String(config.appointment_duration_minutes),
    buffer_minutes: String(config.buffer_minutes),
    escalation_email: config.escalation_email ?? "",
    escalate_on: { ...config.escalate_on },
    business_blurb: config.business_blurb,
  };
}

const num = (text: string): number | undefined => (text.trim() === "" ? undefined : Number(text));

/** What is sent to the server: the same shape the product's Zod schema validates. */
export function draftToConfig(draft: Draft, calendarIntegrationId: string | null): Record<string, unknown> {
  return {
    delay_minutes: num(draft.delay_minutes),
    send_outside_hours: draft.send_outside_hours,
    first_message_template: draft.first_message_template,
    outside_hours_template: draft.outside_hours_template,
    business_hours: draft.hoursMode === "custom" ? draft.business_hours : null,
    booking_enabled: draft.booking_enabled,
    appointment_duration_minutes: num(draft.appointment_duration_minutes),
    buffer_minutes: num(draft.buffer_minutes),
    calendar_integration_id: calendarIntegrationId,
    escalation_email: draft.escalation_email.trim() === "" ? null : draft.escalation_email.trim(),
    escalate_on: draft.escalate_on,
    business_blurb: draft.business_blurb,
  };
}

export function MissedCallForm({
  initial,
  businessName,
  profileHours,
  timezone,
  calendarStatus = "disconnected",
}: {
  /** Whether Google Calendar is linked, so the booking section can say what will happen. */
  calendarStatus?: "connected" | "disconnected" | "error";
  initial: MissedCallConfig;
  businessName: string;
  profileHours: BusinessHours;
  timezone: string;
}) {
  const router = useRouter();
  const [baseline, setBaseline] = useState(() => toDraft(initial));
  const [draft, setDraft] = useState(baseline);
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [pending, startTransition] = useTransition();

  const dirty = useMemo(() => JSON.stringify(draft) !== JSON.stringify(baseline), [draft, baseline]);
  const set = <K extends keyof Draft>(key: K, value: Draft[K]) => setDraft((d) => ({ ...d, [key]: value }));

  function save() {
    startTransition(async () => {
      const result = await saveProductConfigAction("missed-call", JSON.stringify(draftToConfig(draft, initial.calendar_integration_id)));
      if (result.ok) {
        setErrors({});
        setBaseline(draft);
        toast.success("Settings saved");
        router.refresh();
        return;
      }
      setErrors("fieldErrors" in result && result.fieldErrors ? result.fieldErrors : {});
      toast.error(result.message);
      // Bring the first problem into view.
      requestAnimationFrame(() => document.querySelector('[role="alert"]')?.scrollIntoView({ behavior: "smooth", block: "center" }));
    });
  }

  return (
    <div className="space-y-6 pb-28">
      <FormSection title="When to message" description="How soon after a missed call the customer hears from you.">
        <Field label="Wait before the first message" htmlFor="delay" hint="In minutes. 0 sends straight away; most businesses wait 2 to 5 minutes." error={errors.delay_minutes}>
          <div className="flex items-center gap-3">
            <Input id="delay" type="number" min={0} max={60} inputMode="numeric" className="w-28" value={draft.delay_minutes} onChange={(e) => set("delay_minutes", e.target.value)} />
            <span className="text-sm text-muted-foreground">minutes</span>
          </div>
        </Field>
        <ToggleRow title="Also message outside opening hours" description="Customers who call when you are closed get a different message, and you reply when you reopen.">
          <Switch checked={draft.send_outside_hours} onCheckedChange={(v) => set("send_outside_hours", v)} aria-label="Message outside opening hours" />
        </ToggleRow>
      </FormSection>

      <FormSection title="Your messages" description="Use {{business_name}} and we will fill in your business name.">
        <Field label="First message (during opening hours)" htmlFor="first-message" error={errors.first_message_template}>
          <Textarea id="first-message" value={draft.first_message_template} maxLength={1000} onChange={(e) => set("first_message_template", e.target.value)} aria-invalid={errors.first_message_template ? true : undefined} />
        </Field>
        <MessagePreview label="What your customer sees" template={draft.first_message_template} businessName={businessName} />
        <Field label="First message (outside opening hours)" htmlFor="outside-message" error={errors.outside_hours_template}>
          <Textarea id="outside-message" value={draft.outside_hours_template} maxLength={1000} onChange={(e) => set("outside_hours_template", e.target.value)} aria-invalid={errors.outside_hours_template ? true : undefined} />
        </Field>
        <MessagePreview label="What your customer sees when you are closed" template={draft.outside_hours_template} businessName={businessName} />
      </FormSection>

      <FormSection title="Opening hours" description={`Used to decide which message to send. Times are in ${timezone}.`}>
        <div className="inline-flex rounded-xl border bg-muted/40 p-1" role="group" aria-label="Which opening hours to use">
          {(
            [
              ["profile", "Same as my business"],
              ["custom", "Custom for this product"],
            ] as const
          ).map(([mode, label]) => (
            <button
              key={mode}
              type="button"
              onClick={() => set("hoursMode", mode)}
              aria-pressed={draft.hoursMode === mode}
              className={cn(
                "rounded-lg px-4 py-2 text-sm font-medium transition-colors",
                draft.hoursMode === mode ? "bg-card text-foreground shadow-sm" : "text-muted-foreground hover:text-foreground",
              )}
            >
              {label}
            </button>
          ))}
        </div>
        {draft.hoursMode === "custom" ? (
          <BusinessHoursEditor value={draft.business_hours} onChange={(v) => set("business_hours", v)} errors={errors} idPrefix="product-hours" />
        ) : (
          <p className="rounded-xl border bg-muted/30 p-4 text-sm text-muted-foreground">
            Using the hours from your business settings.{" "}
            <Link href="/settings" className="font-medium text-primary hover:underline">
              Change them in Settings
            </Link>
            . Today: {profileHours.mon ? `weekdays ${profileHours.mon.open} to ${profileHours.mon.close}` : "see settings"}.
          </p>
        )}
      </FormSection>

      <FormSection title="Appointments" description="Let the assistant take booking requests from customers.">
        <ToggleRow
          title="Take appointment requests"
          description={
            calendarStatus === "connected"
              ? "The assistant offers times that are free in your Google Calendar, and books the one the customer picks."
              : "The assistant collects the customer's name, service and preferred time and tells your team. Connect your calendar and it will offer real times and book them for you."
          }
        >
          <Switch checked={draft.booking_enabled} onCheckedChange={(v) => set("booking_enabled", v)} aria-label="Take appointment requests" />
        </ToggleRow>
        {draft.booking_enabled && calendarStatus !== "connected" ? (
          <p className={cn("rounded-xl border p-4 text-sm", calendarStatus === "error" ? "border-destructive/25 bg-destructive/5" : "bg-muted/30 text-muted-foreground")}>
            {calendarStatus === "error" ? "Your calendar needs reconnecting, so customers who ask to book are passed to you. " : "No calendar connected yet. "}
            <Link href="/integrations" className="font-medium text-primary hover:underline">
              {calendarStatus === "error" ? "Reconnect it" : "Connect Google Calendar"}
            </Link>
            .
          </p>
        ) : null}
        <div className="grid gap-6 sm:grid-cols-2">
          <Field label="Appointment length" htmlFor="duration" hint="In minutes." error={errors.appointment_duration_minutes}>
            <Input id="duration" type="number" min={5} max={240} inputMode="numeric" value={draft.appointment_duration_minutes} onChange={(e) => set("appointment_duration_minutes", e.target.value)} />
          </Field>
          <Field label="Gap between appointments" htmlFor="buffer" hint="In minutes. 0 for none." error={errors.buffer_minutes}>
            <Input id="buffer" type="number" min={0} max={120} inputMode="numeric" value={draft.buffer_minutes} onChange={(e) => set("buffer_minutes", e.target.value)} />
          </Field>
        </div>
      </FormSection>

      <FormSection title="When a person should step in" description="The assistant hands the conversation to you and emails you. Urgent messages and health questions always go to you.">
        <Field label="Send alerts to" htmlFor="escalation-email" hint="Leave empty to use your login email. While you are on the free email plan this must be the email you registered with." error={errors.escalation_email}>
          <Input id="escalation-email" type="email" placeholder="you@yourbusiness.com" value={draft.escalation_email} onChange={(e) => set("escalation_email", e.target.value)} aria-invalid={errors.escalation_email ? true : undefined} />
        </Field>
        <div className="space-y-3">
          <ToggleRow title="A customer complains" description="Unhappy or angry messages.">
            <Switch checked={draft.escalate_on.complaint} onCheckedChange={(v) => set("escalate_on", { ...draft.escalate_on, complaint: v })} aria-label="Alert me about complaints" />
          </ToggleRow>
          <ToggleRow title="A customer asks for a person" description='For example "can I speak to someone?".'>
            <Switch checked={draft.escalate_on.wants_human} onCheckedChange={(v) => set("escalate_on", { ...draft.escalate_on, wants_human: v })} aria-label="Alert me when a customer asks for a person" />
          </ToggleRow>
          <ToggleRow title="The assistant is not sure" description="When it cannot answer with confidence.">
            <Switch checked={draft.escalate_on.low_confidence} onCheckedChange={(v) => set("escalate_on", { ...draft.escalate_on, low_confidence: v })} aria-label="Alert me when the assistant is unsure" />
          </ToggleRow>
        </div>
      </FormSection>

      <FormSection title="About your business" description="The assistant may only share what you write here. Add services, location and anything customers often ask.">
        <Field label="What should the assistant know?" htmlFor="blurb" error={errors.business_blurb} hint={`${draft.business_blurb.length} / 1000`}>
          <Textarea id="blurb" rows={5} value={draft.business_blurb} maxLength={1000} placeholder="We are a family dentist on Station Road offering check-ups, hygiene visits and whitening." onChange={(e) => set("business_blurb", e.target.value)} />
        </Field>
      </FormSection>

      <div className="fixed inset-x-0 bottom-0 z-20 border-t bg-background/90 backdrop-blur-md lg:left-[17rem]">
        <div className="mx-auto flex max-w-6xl items-center justify-between gap-4 px-4 py-3 sm:px-6 lg:px-10">
          <p className="flex items-center gap-2 text-sm text-muted-foreground" aria-live="polite">
            {dirty ? (
              <>
                <span className="size-2 rounded-full bg-warning" aria-hidden /> You have unsaved changes
              </>
            ) : (
              <>
                <Check className="size-4 text-success" aria-hidden /> All changes saved
              </>
            )}
          </p>
          <div className="flex gap-2">
            <Button type="button" variant="outline" disabled={!dirty || pending} onClick={() => { setDraft(baseline); setErrors({}); }}>
              Discard
            </Button>
            <Button type="button" disabled={!dirty || pending} onClick={save}>
              {pending ? <Loader2 className="animate-spin" aria-hidden /> : null} Save changes
            </Button>
          </div>
        </div>
      </div>
    </div>
  );
}
