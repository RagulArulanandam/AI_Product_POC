import Link from "next/link";
import { logoutAction } from "@/app/(auth)/actions";
import { Button } from "@/components/ui/button";
import { requireBusiness } from "@/lib/auth/guards";

export default async function AppLayout({ children }: { children: React.ReactNode }) {
  const { business, user } = await requireBusiness();

  return (
    <div className="flex min-h-full flex-1 flex-col">
      <header className="border-b bg-background">
        <div className="mx-auto flex h-14 w-full max-w-5xl items-center justify-between px-4">
          <div className="flex items-center gap-6">
            <span className="font-semibold">{business.name}</span>
            <nav className="flex items-center gap-4 text-sm text-muted-foreground">
              <Link href="/dashboard" className="hover:text-foreground">
                Dashboard
              </Link>
            </nav>
          </div>
          <form action={logoutAction} className="flex items-center gap-3 text-sm">
            <span className="text-muted-foreground">{user.email}</span>
            <Button type="submit" variant="outline" size="sm">
              Log out
            </Button>
          </form>
        </div>
      </header>
      <main className="mx-auto w-full max-w-5xl flex-1 px-4 py-8">{children}</main>
    </div>
  );
}
