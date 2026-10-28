import { AppShell } from "@/components/app/app-shell";
import { requireBusiness } from "@/lib/auth/guards";

export default async function AppLayout({ children }: { children: React.ReactNode }) {
  const { business, user, role } = await requireBusiness();

  return (
    <AppShell business={business} email={user.email ?? ""} role={role}>
      {children}
    </AppShell>
  );
}
