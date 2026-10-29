import Link from "next/link";
import { Compass } from "lucide-react";
import { Logo } from "@/components/app/logo";
import { buttonVariants } from "@/components/ui/button";

export const metadata = { title: "Page not found" };

export default function NotFound() {
  return (
    <main className="flex min-h-screen flex-col items-center justify-center gap-6 px-6 text-center">
      <Logo />
      <span className="flex size-14 items-center justify-center rounded-2xl bg-primary/10 text-primary">
        <Compass className="size-7" aria-hidden />
      </span>
      <div className="space-y-2">
        <h1 className="text-2xl font-semibold tracking-tight sm:text-3xl">We can&apos;t find that page</h1>
        <p className="mx-auto max-w-md text-muted-foreground">The link may be old, or the page may have moved. Head back to your dashboard and carry on from there.</p>
      </div>
      <Link href="/dashboard" className={buttonVariants()}>
        Go to dashboard
      </Link>
    </main>
  );
}
