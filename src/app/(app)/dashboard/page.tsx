import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { requireBusiness } from "@/lib/auth/guards";
import { formatPhone } from "@/lib/phone";

export default async function DashboardPage() {
  const { business, role } = await requireBusiness();

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-semibold">Dashboard</h1>
        <p className="text-sm text-muted-foreground">Welcome to {business.name}.</p>
      </div>
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            Your business <Badge variant="secondary">{role}</Badge>
          </CardTitle>
          <CardDescription>Setup checklist and activity metrics arrive in a later phase.</CardDescription>
        </CardHeader>
        <CardContent className="space-y-1 text-sm">
          <p>Phone: {formatPhone(business.phone_e164)}</p>
          <p>Timezone: {business.timezone}</p>
        </CardContent>
      </Card>
    </div>
  );
}
