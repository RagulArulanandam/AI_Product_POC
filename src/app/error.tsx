"use client";

import { useEffect } from "react";
import { TriangleAlert } from "lucide-react";
import { Logo } from "@/components/app/logo";
import { Button, buttonVariants } from "@/components/ui/button";

/** Shown when a page throws. Never shows the error text: it can contain details people should not see. */
export default function ErrorPage({ error, reset }: { error: Error & { digest?: string }; reset: () => void }) {
  useEffect(() => {
    // The digest lets us find the matching server log line without exposing the message.
    console.error("page error", error.digest ?? "no digest");
  }, [error]);

  return (
    <main className="flex min-h-screen flex-col items-center justify-center gap-6 px-6 text-center">
      <Logo />
      <span className="flex size-14 items-center justify-center rounded-2xl bg-destructive/10 text-destructive">
        <TriangleAlert className="size-7" aria-hidden />
      </span>
      <div className="space-y-2">
        <h1 className="text-2xl font-semibold tracking-tight sm:text-3xl">Something went wrong</h1>
        <p className="mx-auto max-w-md text-muted-foreground">
          That didn&apos;t work, and it&apos;s not your fault. Try again, and if it keeps happening let us know.
          {error.digest ? <span className="mt-2 block text-xs">Reference: {error.digest}</span> : null}
        </p>
      </div>
      <div className="flex gap-2">
        <Button onClick={reset}>Try again</Button>
        <a href="/dashboard" className={buttonVariants({ variant: "outline" })}>
          Back to dashboard
        </a>
      </div>
    </main>
  );
}
