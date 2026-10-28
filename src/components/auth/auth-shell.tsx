import { CalendarCheck, MessageCircle, PhoneMissed, ShieldCheck } from "lucide-react";
import { Logo } from "@/components/app/logo";

const POINTS = [
  { icon: PhoneMissed, title: "Missed call? Handled.", text: "We text the caller on WhatsApp within minutes." },
  { icon: MessageCircle, title: "Friendly AI replies", text: "Answers questions in your words, day and night." },
  { icon: CalendarCheck, title: "Books the appointment", text: "Straight into your Google Calendar." },
  { icon: ShieldCheck, title: "You stay in control", text: "Complaints and urgent messages go to you." },
];

/** Split-screen layout for sign up, log in and onboarding: the form on the left, the pitch on the right. */
export function AuthShell({ children, wide = false }: { children: React.ReactNode; wide?: boolean }) {
  return (
    <div className="grid min-h-screen lg:grid-cols-[minmax(0,1fr)_minmax(0,1.05fr)]">
      <div className="flex flex-col px-6 py-8 sm:px-10">
        <Logo />
        <div className="flex flex-1 items-center justify-center py-10">
          <div className={wide ? "w-full max-w-lg" : "w-full max-w-md"}>{children}</div>
        </div>
        <p className="text-xs text-muted-foreground">© {new Date().getFullYear()} Business Automation</p>
      </div>

      <aside className="relative hidden overflow-hidden bg-gradient-to-br from-[oklch(0.5_0.24_285)] via-[oklch(0.44_0.24_280)] to-[oklch(0.33_0.2_275)] p-12 text-white lg:flex lg:flex-col lg:justify-center">
        <div className="pointer-events-none absolute -right-24 -top-24 size-96 rounded-full bg-white/10 blur-3xl" aria-hidden />
        <div className="pointer-events-none absolute -bottom-32 -left-16 size-[28rem] rounded-full bg-[oklch(0.7_0.2_320)]/25 blur-3xl" aria-hidden />
        <div className="relative max-w-lg">
          <p className="mb-3 inline-flex rounded-full bg-white/15 px-3 py-1 text-xs font-medium ring-1 ring-inset ring-white/25">
            AI for small businesses
          </p>
          <h2 className="text-4xl font-semibold leading-tight tracking-tight">Never lose a customer to a missed call again.</h2>
          <p className="mt-4 text-lg text-white/75">Set it up in minutes. No developers, no technical knowledge.</p>
          <ul className="mt-10 space-y-5">
            {POINTS.map(({ icon: Icon, title, text }) => (
              <li key={title} className="flex items-start gap-4">
                <span className="flex size-10 shrink-0 items-center justify-center rounded-xl bg-white/15 ring-1 ring-inset ring-white/25">
                  <Icon className="size-5" aria-hidden />
                </span>
                <div>
                  <p className="font-medium">{title}</p>
                  <p className="text-sm text-white/70">{text}</p>
                </div>
              </li>
            ))}
          </ul>
        </div>
      </aside>
    </div>
  );
}
