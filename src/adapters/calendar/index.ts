import type { Admin } from "@/engine/types";
import { getAdapterMode, getGoogleEnv } from "@/lib/env";
import { FakeCalendarAdapter } from "./fake";
import { GoogleCalendarAdapter } from "./google";
import type { CalendarAdapter } from "./interface";
import { SupabaseTokenStore } from "./store";

let fake: FakeCalendarAdapter | undefined;

/** One shared fake so tests can set busy times and inspect the events the code under test created. */
export function getFakeCalendar(): FakeCalendarAdapter {
  fake ??= new FakeCalendarAdapter();
  return fake;
}

/** The calendar for one integration: the fake in tests and `CALENDAR_ADAPTER=fake`, else Google. */
export function getCalendar(admin: Admin, integrationId: string): CalendarAdapter {
  if (process.env.NODE_ENV === "test" || getAdapterMode("calendar") === "fake") return getFakeCalendar();
  const env = getGoogleEnv();
  return new GoogleCalendarAdapter(
    { clientId: env.GOOGLE_CLIENT_ID, clientSecret: env.GOOGLE_CLIENT_SECRET, redirectUri: env.GOOGLE_REDIRECT_URI },
    new SupabaseTokenStore(admin, integrationId),
  );
}

export type { CalendarAdapter } from "./interface";
