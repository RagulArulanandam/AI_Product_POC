"use client";

import { useState, useTransition } from "react";
import { toast } from "sonner";
import { setProductAction } from "@/app/admin/actions";
import { Switch } from "@/components/ui/switch";

/** An admin's on/off switch for one product of one business. Puts the switch back if refused. */
export function AdminProductToggle({ businessId, productKey, enabled, label }: { businessId: string; productKey: string; enabled: boolean; label: string }) {
  const [checked, setChecked] = useState(enabled);
  const [pending, startTransition] = useTransition();

  function change(next: boolean) {
    setChecked(next);
    startTransition(async () => {
      const result = await setProductAction(businessId, productKey, next);
      if (result.ok) toast.success(result.message);
      else {
        setChecked(!next);
        toast.error(result.message);
      }
    });
  }

  return <Switch checked={checked} onCheckedChange={change} disabled={pending} aria-label={`${label} on or off`} />;
}
