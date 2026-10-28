import { logoutAction } from "@/app/(auth)/actions";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { requireUser } from "@/lib/auth/guards";

export default async function DisabledPage() {
  await requireUser();

  return (
    <main className="flex flex-1 items-center justify-center px-4 py-12">
      <Card className="w-full max-w-md">
        <CardHeader>
          <CardTitle>This business is disabled</CardTitle>
          <CardDescription>
            Your business has been switched off by the platform team, so automations are paused. Contact support if you
            think this is a mistake.
          </CardDescription>
        </CardHeader>
        <CardContent>
          <form action={logoutAction}>
            <Button type="submit" variant="outline">
              Log out
            </Button>
          </form>
        </CardContent>
      </Card>
    </main>
  );
}
