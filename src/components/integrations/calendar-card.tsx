"use client";

import { CalendarDays, TriangleAlert } from "lucide-react";
import { useState, useTransition } from "react";
import { toast } from "sonner";
import { disconnectCalendarAction } from "@/app/(app)/integrations/actions";
import { IntegrationCard } from "@/components/integrations/integration-card";
import { Button, buttonVariants } from "@/components/ui/button";
import { integrationStatus } from "@/lib/ui/status";

const CONNECT_URL = "/api/integrations/google/connect";

export interface CalendarCardProps {
  status: "connected" | "disconnected" | "error";
  accountLabel: string | null;
  lastError: string | null;
  /** False until the platform has its Google connection details. */
  available: boolean;
}

/** Google Calendar: connect, see which account is linked, reconnect after a problem, or disconnect. */
export function CalendarCard({ status, accountLabel, lastError, available }: CalendarCardProps) {
  const [confirming, setConfirming] = useState(false);
  const [pending, startTransition] = useTransition();

  function disconnect() {
    startTransition(async () => {
      const result = await disconnectCalendarAction();
      setConfirming(false);
      if (result.ok) toast.success(result.message);
      else toast.error(result.message);
    });
  }

  return (
    <IntegrationCard
      icon={CalendarDays}
      title="Google Calendar"
      description="Lets your assistant see when you are free and add appointments straight into your calendar. It can only read when you are busy and add events, never see their details."
      status={integrationStatus(status)}
    >
      {status === "connected" ? (
        <div className="flex flex-wrap items-center justify-between gap-3">
          <p className="text-sm text-muted-foreground">
            Connected as <span className="font-medium text-foreground">{accountLabel ?? "your Google account"}</span>. Bookings go into its main calendar.
          </p>
          {confirming ? (
            <div className="flex items-center gap-2">
              <Button type="button" variant="outline" onClick={() => setConfirming(false)} disabled={pending}>
                Keep connected
              </Button>
              <Button type="button" variant="destructive" onClick={disconnect} disabled={pending}>
                {pending ? "Disconnecting..." : "Yes, disconnect"}
              </Button>
            </div>
          ) : (
            <Button type="button" variant="outline" onClick={() => setConfirming(true)}>
              Disconnect
            </Button>
          )}
        </div>
      ) : (
        <div className="space-y-4">
          {status === "error" ? (
            <div className="flex gap-3 rounded-xl border border-destructive/25 bg-destructive/5 p-4 text-sm" role="alert">
              <TriangleAlert className="mt-0.5 size-4 shrink-0 text-destructive" aria-hidden />
              <div>
                <p className="font-medium">Your calendar needs reconnecting</p>
                <p className="mt-0.5 text-muted-foreground">
                  {lastError ?? "Google stopped allowing access."} Until then, customers who ask to book are passed to you.
                </p>
              </div>
            </div>
          ) : null}
          <div className="flex flex-wrap items-center justify-between gap-3">
            <p className="text-sm text-muted-foreground">
              {available
                ? "Connect your calendar to let customers book appointments automatically."
                : "Google Calendar can't be connected yet: the platform's Google details are missing."}
            </p>
            {available ? (
              <a href={CONNECT_URL} className={buttonVariants()}>
                {status === "error" ? "Reconnect Google Calendar" : "Connect Google Calendar"}
              </a>
            ) : (
              <Button type="button" disabled>
                Connect Google Calendar
              </Button>
            )}
          </div>
        </div>
      )}
    </IntegrationCard>
  );
}
