import { redirect } from "next/navigation";

// proxy.ts sends signed-out visitors to /login; this is the fallback for signed-in ones.
export default function Home() {
  redirect("/dashboard");
}
