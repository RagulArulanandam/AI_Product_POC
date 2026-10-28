"use client";

import { useState, useTransition } from "react";
import { toast } from "sonner";
import { toggleProductAction } from "@/app/(app)/products/actions";
import { Switch } from "@/components/ui/switch";

/** The on/off switch on a product. Updates straight away and puts it back with a reason if refused. */
export function ProductToggle({ productKey, enabled, label }: { productKey: string; enabled: boolean; label: string }) {
  const [checked, setChecked] = useState(enabled);
  const [pending, startTransition] = useTransition();

  function change(next: boolean) {
    setChecked(next);
    startTransition(async () => {
      const result = await toggleProductAction(productKey, next);
      if (result.ok) {
        toast.success(next ? `${label} is on` : `${label} is off`);
      } else {
        setChecked(!next);
        toast.error(result.message);
      }
    });
  }

  return (
    <div className="flex items-center gap-2.5">
      <span className="text-sm font-medium text-muted-foreground">{checked ? "On" : "Off"}</span>
      <Switch checked={checked} onCheckedChange={change} disabled={pending} aria-label={`${label} on or off`} />
    </div>
  );
}
