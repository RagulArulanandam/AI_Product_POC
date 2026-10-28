import { PauseCircle } from "lucide-react";
import { logoutAction } from "@/app/(auth)/actions";
import { AuthShell } from "@/components/auth/auth-shell";
import { Button } from "@/components/ui/button";
import { requireUser } from "@/lib/auth/guards";

export const metadata = { title: "Business disabled" };

export default async function DisabledPage() {
  await requireUser();

  return (
    <AuthShell>
      <div className="space-y-6">
        <span className="flex size-12 items-center justify-center rounded-2xl bg-warning/20 text-[oklch(0.5_0.12_70)]">
          <PauseCircle className="size-6" aria-hidden />
        </span>
        <div className="space-y-2">
          <h1 className="text-3xl font-semibold tracking-tight">This business is switched off</h1>
          <p className="text-muted-foreground">
            The platform team has paused your business, so automations are not running. If you think this is a mistake, please contact support.
          </p>
        </div>
        <form action={logoutAction}>
          <Button type="submit" variant="outline">
            Log out
          </Button>
        </form>
      </div>
    </AuthShell>
  );
}
