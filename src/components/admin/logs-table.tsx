import Link from "next/link";
import { ScrollText } from "lucide-react";
import { EmptyState } from "@/components/app/empty-state";
import { StatusBadge } from "@/components/app/status-badge";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { formatDateTime } from "@/lib/format";
import { logStatus } from "@/lib/ui/status";
import { cn } from "@/lib/utils";
import { LOG_STATUSES, type LogRow, type LogStatusFilter } from "@/services/admin";

/** Short text for the details column: the useful reason or error, never the whole payload. */
export function summariseDetails(details: unknown): string {
  if (!details || typeof details !== "object") return "";
  const d = details as Record<string, unknown>;
  const pick = d.error ?? d.message ?? d.action ?? d.product ?? d.status;
  return typeof pick === "string" ? pick : "";
}

/** Status filter chips. Each is a plain link so the filter survives a refresh and can be shared. */
export function LogFilter({ basePath, active }: { basePath: string; active?: LogStatusFilter }) {
  const chips: { label: string; value?: LogStatusFilter }[] = [{ label: "All" }, ...LOG_STATUSES.map((s) => ({ label: logStatus(s).label, value: s }))];
  return (
    <div className="flex flex-wrap gap-1.5" role="group" aria-label="Filter logs by status">
      {chips.map((c) => (
        <Link
          key={c.label}
          href={c.value ? `${basePath}?status=${c.value}` : basePath}
          aria-current={c.value === active ? "true" : undefined}
          className={cn(
            "rounded-full border px-3 py-1 text-sm font-medium transition-colors",
            c.value === active ? "border-foreground bg-foreground text-background" : "bg-card text-muted-foreground hover:text-foreground",
          )}
        >
          {c.label}
        </Link>
      ))}
    </div>
  );
}

export function LogsTable({ rows, timezone = "Europe/London" }: { rows: LogRow[]; timezone?: string }) {
  if (rows.length === 0) {
    return <EmptyState icon={ScrollText} title="No log entries" description="Nothing matches this filter yet." />;
  }
  return (
    <div className="overflow-hidden rounded-2xl border bg-card shadow-sm">
      <Table>
        <TableHeader>
          <TableRow>
            <TableHead>When</TableHead>
            <TableHead>Event</TableHead>
            <TableHead>Step</TableHead>
            <TableHead>Status</TableHead>
            <TableHead>Reason</TableHead>
          </TableRow>
        </TableHeader>
        <TableBody>
          {rows.map((r) => {
            const s = logStatus(r.status);
            const extra = summariseDetails(r.details);
            return (
              <TableRow key={r.id}>
                <TableCell className="whitespace-nowrap text-muted-foreground">{formatDateTime(r.createdAt, timezone)}</TableCell>
                <TableCell className="font-medium">{r.eventType.replace(/_/g, " ")}</TableCell>
                <TableCell className="capitalize text-muted-foreground">{r.step}</TableCell>
                <TableCell>
                  <StatusBadge tone={s.tone}>{s.label}</StatusBadge>
                </TableCell>
                <TableCell className="max-w-[28rem] truncate text-muted-foreground" title={[r.reason, extra].filter(Boolean).join(": ")}>
                  {[r.reason, extra].filter(Boolean).join(": ") || "-"}
                </TableCell>
              </TableRow>
            );
          })}
        </TableBody>
      </Table>
    </div>
  );
}
