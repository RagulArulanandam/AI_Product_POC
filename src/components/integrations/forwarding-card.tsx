"use client";

import { PhoneForwarded } from "lucide-react";
import { useState, useTransition } from "react";
import { toast } from "sonner";
import { confirmForwardingAction } from "@/app/(app)/integrations/actions";
import { IntegrationCard } from "@/components/integrations/integration-card";
import { Button } from "@/components/ui/button";
import { formatPhone } from "@/lib/phone";
import { integrationStatus } from "@/lib/ui/status";
import { forwardingCodes } from "@/services/integrations";
import { CopyButton } from "./copy-button";

/** Phone forwarding: the assistant number, the codes that forward calls to it, and a confirmation. */
export function ForwardingCard({ assistantNumber, confirmed: initiallyConfirmed }: { assistantNumber: string | null; confirmed: boolean }) {
  const [confirmed, setConfirmed] = useState(initiallyConfirmed);
  const [pending, startTransition] = useTransition();
  const status = assistantNumber
    ? confirmed
      ? integrationStatus("connected")
      : { label: "Set up needed", tone: "warning" as const }
    : { label: "Number needed", tone: "neutral" as const };

  function change(next: boolean) {
    startTransition(async () => {
      const result = await confirmForwardingAction(next);
      if (result.ok) {
        setConfirmed(next);
        toast.success(next ? "Call forwarding confirmed" : "Call forwarding marked as not set up");
      } else {
        toast.error(result.message);
      }
    });
  }

  return (
    <IntegrationCard
      icon={PhoneForwarded}
      title="Missed call forwarding"
      description="Your phone passes calls you can't answer to your assistant number. The assistant then messages the caller on WhatsApp."
      status={status}
    >
      {!assistantNumber ? (
        <p className="rounded-xl border bg-muted/30 p-4 text-sm text-muted-foreground">
          Your assistant number has not been assigned yet. Please contact support and we will set one up for you.
        </p>
      ) : (
        <div className="space-y-6">
          <div className="flex flex-wrap items-center justify-between gap-3 rounded-xl bg-primary/5 p-4 ring-1 ring-inset ring-primary/15">
            <div>
              <p className="text-xs font-medium uppercase tracking-wider text-muted-foreground">Your assistant number</p>
              <p className="mt-1 text-xl font-semibold tracking-tight">{formatPhone(assistantNumber)}</p>
            </div>
            <CopyButton text={assistantNumber} label="assistant number" />
          </div>

          <div>
            <h3 className="text-sm font-semibold">1. Dial these codes on your business phone</h3>
            <p className="mt-1 text-sm text-muted-foreground">
              These work on most UK networks. Type each one into your phone&apos;s keypad and press call. Some networks use a setting in the phone app instead.
            </p>
            <ul className="mt-3 divide-y rounded-xl border">
              {forwardingCodes(assistantNumber).map((item) => (
                <li key={item.code} className="flex flex-wrap items-center justify-between gap-3 px-4 py-3">
                  <div className="min-w-0">
                    <p className="text-sm font-medium">{item.label}</p>
                    <p className="text-sm text-muted-foreground">{item.description}</p>
                  </div>
                  <div className="flex items-center gap-3">
                    <code className="rounded-lg bg-muted px-2.5 py-1.5 font-mono text-sm">{item.code}</code>
                    <CopyButton text={item.code} label={item.label} />
                  </div>
                </li>
              ))}
            </ul>
          </div>

          <div className="flex flex-wrap items-center justify-between gap-3">
            <div>
              <h3 className="text-sm font-semibold">2. Tell us when it is done</h3>
              <p className="text-sm text-muted-foreground">Call your business number from another phone and let it ring out to check.</p>
            </div>
            {confirmed ? (
              <Button type="button" variant="outline" disabled={pending} onClick={() => change(false)}>
                Mark as not set up
              </Button>
            ) : (
              <Button type="button" disabled={pending} onClick={() => change(true)}>
                I have set up forwarding
              </Button>
            )}
          </div>
        </div>
      )}
    </IntegrationCard>
  );
}
