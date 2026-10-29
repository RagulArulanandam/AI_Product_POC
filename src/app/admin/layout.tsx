import { AdminShell } from "@/components/admin/admin-shell";
import { requireAdmin } from "@/lib/auth/guards";
import { countFailedActions } from "@/services/admin";

export const metadata = { title: { default: "Admin", template: "%s · Admin" } };

export default async function AdminLayout({ children }: { children: React.ReactNode }) {
  const { user, admin } = await requireAdmin();
  const failedCount = await countFailedActions(admin);

  return (
    <AdminShell email={user.email ?? ""} failedCount={failedCount}>
      {children}
    </AdminShell>
  );
}
