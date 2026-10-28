"use client";

import { Check, Loader2 } from "lucide-react";
import { Button } from "@/components/ui/button";

/** The sticky bar at the bottom of a settings page: shows whether there are unsaved changes. */
export function SaveBar({
  dirty,
  pending,
  onSave,
  onDiscard,
}: {
  dirty: boolean;
  pending: boolean;
  onSave: () => void;
  onDiscard: () => void;
}) {
  return (
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
          <Button type="button" variant="outline" disabled={!dirty || pending} onClick={onDiscard}>
            Discard
          </Button>
          <Button type="button" disabled={!dirty || pending} onClick={onSave}>
            {pending ? <Loader2 className="animate-spin" aria-hidden /> : null} Save changes
          </Button>
        </div>
      </div>
    </div>
  );
}
