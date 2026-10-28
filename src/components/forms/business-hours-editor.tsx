"use client";

import { Copy } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Switch } from "@/components/ui/switch";
import type { BusinessHours } from "@/lib/validation/hours";

const DAYS: { key: keyof BusinessHours; label: string }[] = [
  { key: "mon", label: "Monday" },
  { key: "tue", label: "Tuesday" },
  { key: "wed", label: "Wednesday" },
  { key: "thu", label: "Thursday" },
  { key: "fri", label: "Friday" },
  { key: "sat", label: "Saturday" },
  { key: "sun", label: "Sunday" },
];

const DEFAULT_DAY = { open: "09:00", close: "17:00" };

/** Opening hours for the week: a switch per day, and start and end times when it is open. */
export function BusinessHoursEditor({
  value,
  onChange,
  errors = {},
  errorPrefix = "business_hours",
  idPrefix = "hours",
}: {
  value: BusinessHours;
  onChange: (next: BusinessHours) => void;
  /** Field errors keyed like `business_hours.mon`. */
  errors?: Record<string, string | undefined>;
  errorPrefix?: string;
  idPrefix?: string;
}) {
  const setDay = (key: keyof BusinessHours, day: BusinessHours[keyof BusinessHours]) => onChange({ ...value, [key]: day });

  function copyMondayToWeekdays() {
    const monday = value.mon;
    onChange({ ...value, tue: monday, wed: monday, thu: monday, fri: monday });
  }

  return (
    <div className="space-y-3">
      <div className="divide-y rounded-xl border">
        {DAYS.map(({ key, label }) => {
          const day = value[key];
          const error = errors[`${errorPrefix}.${key}`] ?? errors[`${errorPrefix}.${key}.close`] ?? errors[`${errorPrefix}.${key}.open`];
          return (
            <div key={key} className="px-4 py-3">
              <div className="flex flex-wrap items-center gap-x-4 gap-y-2">
                <div className="flex w-36 items-center gap-3">
                  <Switch
                    checked={day !== null}
                    onCheckedChange={(open) => setDay(key, open ? { ...DEFAULT_DAY } : null)}
                    aria-label={`${label} open`}
                  />
                  <span className="text-sm font-medium">{label}</span>
                </div>
                {day ? (
                  <div className="flex items-center gap-2">
                    <Input
                      id={`${idPrefix}-${key}-open`}
                      type="time"
                      value={day.open}
                      onChange={(e) => setDay(key, { ...day, open: e.target.value })}
                      aria-label={`${label} opens`}
                      className="h-10 w-32"
                    />
                    <span className="text-sm text-muted-foreground">to</span>
                    <Input
                      id={`${idPrefix}-${key}-close`}
                      type="time"
                      value={day.close}
                      onChange={(e) => setDay(key, { ...day, close: e.target.value })}
                      aria-label={`${label} closes`}
                      className="h-10 w-32"
                    />
                  </div>
                ) : (
                  <span className="text-sm text-muted-foreground">Closed</span>
                )}
              </div>
              {error ? (
                <p className="mt-2 text-sm text-destructive" role="alert">
                  {error}
                </p>
              ) : null}
            </div>
          );
        })}
      </div>
      <Button type="button" variant="ghost" size="sm" onClick={copyMondayToWeekdays}>
        <Copy aria-hidden /> Copy Monday to Tuesday to Friday
      </Button>
    </div>
  );
}
