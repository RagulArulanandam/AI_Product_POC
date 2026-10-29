"use client";

import { useState, useTransition } from "react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import type { AdminResult } from "@/services/admin";

/** A button that asks "are you sure?" in place, runs an admin action and shows the result as a toast. */
export function ConfirmActionButton({
  action,
  label,
  confirmLabel,
  variant = "outline",
  size = "sm",
}: {
  action: () => Promise<AdminResult>;
  label: string;
  confirmLabel: string;
  variant?: "outline" | "destructive" | "default";
  size?: "sm" | "default";
}) {
  const [confirming, setConfirming] = useState(false);
  const [pending, startTransition] = useTransition();

  function run() {
    startTransition(async () => {
      const result = await action();
      setConfirming(false);
      if (result.ok) toast.success(result.message);
      else toast.error(result.message);
    });
  }

  if (!confirming) {
    return (
      <Button type="button" variant={variant} size={size} onClick={() => setConfirming(true)}>
        {label}
      </Button>
    );
  }
  return (
    <span className="inline-flex items-center gap-1.5">
      <Button type="button" variant="ghost" size={size} onClick={() => setConfirming(false)} disabled={pending}>
        Cancel
      </Button>
      <Button type="button" variant={variant === "outline" ? "default" : variant} size={size} onClick={run} disabled={pending}>
        {pending ? "Working..." : confirmLabel}
      </Button>
    </span>
  );
}
