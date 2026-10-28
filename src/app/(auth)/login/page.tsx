import Link from "next/link";
import { LoginForm } from "@/components/auth/login-form";
import { Card, CardContent, CardDescription, CardFooter, CardHeader, CardTitle } from "@/components/ui/card";

export default async function LoginPage(props: PageProps<"/login">) {
  const { next } = await props.searchParams;

  return (
    <Card className="w-full max-w-sm">
      <CardHeader>
        <CardTitle>Log in</CardTitle>
        <CardDescription>Welcome back.</CardDescription>
      </CardHeader>
      <CardContent>
        <LoginForm next={typeof next === "string" ? next : undefined} />
      </CardContent>
      <CardFooter className="text-sm text-muted-foreground">
        New here?&nbsp;
        <Link href="/signup" className="underline">
          Create an account
        </Link>
      </CardFooter>
    </Card>
  );
}
