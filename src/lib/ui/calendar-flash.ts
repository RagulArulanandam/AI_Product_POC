/** The message shown on the Integrations page after the Google sign-in round trip (`?calendar=...`). */
export interface CalendarFlash {
  tone: "success" | "warning" | "danger";
  title: string;
  body: string;
}

const FLASHES: Record<string, CalendarFlash> = {
  connected: {
    tone: "success",
    title: "Calendar connected",
    body: "Your assistant can now see when you are free and add appointments to your calendar.",
  },
  denied: {
    tone: "warning",
    title: "Calendar not connected",
    body: "You chose not to give access, so nothing was changed. You can try again whenever you like.",
  },
  no_access: {
    tone: "warning",
    title: "Calendar access was not fully given",
    body: "Google needs permission to see your availability and add events. Connect again and leave both boxes ticked.",
  },
  failed: {
    tone: "danger",
    title: "Could not connect your calendar",
    body: "Something went wrong talking to Google. Please try again.",
  },
  not_configured: {
    tone: "warning",
    title: "Google Calendar is not set up yet",
    body: "The platform still needs its Google connection details. Please contact support.",
  },
  forbidden: {
    tone: "danger",
    title: "You can't change integrations",
    body: "Ask the business owner to connect the calendar.",
  },
};

export function calendarFlash(value: string | string[] | undefined): CalendarFlash | null {
  const key = Array.isArray(value) ? value[0] : value;
  return key && Object.hasOwn(FLASHES, key) ? FLASHES[key] : null;
}
