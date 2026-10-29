"use client";

import { useActionState, useEffect } from "react";
import { Loader2 } from "lucide-react";
import { toast } from "sonner";
import { saveSubscriptionAction, type SubscriptionFormState } from "@/app/admin/actions";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";

const STATUSES = [
  { value: "trial", label: "Free trial" },
  { value: "active", label: "Active" },
  { value: "past_due", label: "Payment overdue" },
  { value: "cancelled", label: "Cancelled" },
];

export interface SubscriptionFormValues {
  status: string;
  plan: string;
  /** ISO timestamp or null. */
  currentPeriodEnd: string | null;
  notes: string;
}

/** The admin's manual subscription editor (there is no Stripe in the POC). */
export function SubscriptionForm({ businessId, values }: { businessId: string; values: SubscriptionFormValues }) {
  const [state, formAction, pending] = useActionState<SubscriptionFormState, FormData>(saveSubscriptionAction.bind(null, businessId), undefined);

  useEffect(() => {
    if (state?.ok) toast.success(state.message);
    else if (state && !state.ok && state.error) toast.error(state.error);
  }, [state]);

  const errors = state && !state.ok ? state.fieldErrors : undefined;

  return (
    <form action={formAction} className="space-y-4">
      <div className="grid gap-4 sm:grid-cols-2">
        <div className="space-y-1.5">
          <Label htmlFor="status">Status</Label>
          <select
            id="status"
            name="status"
            defaultValue={values.status}
            className="h-10 w-full rounded-lg border bg-background px-3 text-sm outline-none focus-visible:ring-2 focus-visible:ring-ring"
          >
            {STATUSES.map((s) => (
              <option key={s.value} value={s.value}>
                {s.label}
              </option>
            ))}
          </select>
        </div>
        <div className="space-y-1.5">
          <Label htmlFor="plan">Plan</Label>
          <Input id="plan" name="plan" defaultValue={values.plan} aria-invalid={errors?.plan ? true : undefined} />
          {errors?.plan ? <p className="text-xs text-destructive">{errors.plan[0]}</p> : null}
        </div>
      </div>
      <div className="space-y-1.5">
        <Label htmlFor="currentPeriodEnd">Renews or ends on</Label>
        <Input
          id="currentPeriodEnd"
          name="currentPeriodEnd"
          type="date"
          defaultValue={values.currentPeriodEnd ? values.currentPeriodEnd.slice(0, 10) : ""}
          className="sm:max-w-[14rem]"
        />
        {errors?.currentPeriodEnd ? <p className="text-xs text-destructive">{errors.currentPeriodEnd[0]}</p> : null}
      </div>
      <div className="space-y-1.5">
        <Label htmlFor="notes">Notes (the business can see these)</Label>
        <Textarea id="notes" name="notes" defaultValue={values.notes} rows={3} />
        {errors?.notes ? <p className="text-xs text-destructive">{errors.notes[0]}</p> : null}
      </div>
      <Button type="submit" disabled={pending}>
        {pending ? <Loader2 className="animate-spin" aria-hidden /> : null} Save subscription
      </Button>
    </form>
  );
}
