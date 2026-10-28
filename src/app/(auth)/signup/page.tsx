import Link from "next/link";
import { SignupForm } from "@/components/auth/signup-form";
import { Card, CardContent, CardDescription, CardFooter, CardHeader, CardTitle } from "@/components/ui/card";

export default function SignupPage() {
  return (
    <Card className="w-full max-w-sm">
      <CardHeader>
        <CardTitle>Create your account</CardTitle>
        <CardDescription>Set up AI automation for your business in minutes.</CardDescription>
      </CardHeader>
      <CardContent>
        <SignupForm />
      </CardContent>
      <CardFooter className="text-sm text-muted-foreground">
        Already registered?&nbsp;
        <Link href="/login" className="underline">
          Log in
        </Link>
      </CardFooter>
    </Card>
  );
}
