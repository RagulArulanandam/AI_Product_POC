import Link from "next/link";
import { CircleCheck } from "lucide-react";
import { retryActionAction } from "@/app/admin/actions";
import { ConfirmActionButton } from "@/components/admin/confirm-action-button";
import { EmptyState } from "@/components/app/empty-state";
import { PageHeader } from "@/components/app/page-header";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { requireAdmin } from "@/lib/auth/guards";
import { formatDateTime } from "@/lib/format";
import { listFailedActions } from "@/services/admin";

export const metadata = { title: "Failures" };

const TYPE_LABELS: Record<string, string> = {
  handle_event: "Handle incoming event",
  send_first_message: "Send first message",
  expire_conversation: "Close quiet conversation",
};

export default async function FailuresPage() {
  const { admin } = await requireAdmin();
  const failed = await listFailedActions(admin);

  return (
    <div className="space-y-8">
      <PageHeader
        title="Failed automations"
        description="Actions that ran out of attempts. Retrying puts one back in the queue with a fresh set of attempts; the worker runs it within a minute."
      />

      {failed.length === 0 ? (
        <EmptyState icon={CircleCheck} title="Nothing has failed" description="Every automation has either finished or is still waiting to run." />
      ) : (
        <div className="overflow-hidden rounded-2xl border bg-card shadow-sm">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Business</TableHead>
                <TableHead>Action</TableHead>
                <TableHead>Error</TableHead>
                <TableHead>Attempts</TableHead>
                <TableHead>Failed</TableHead>
                <TableHead className="text-right">
                  <span className="sr-only">Retry</span>
                </TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {failed.map((a) => (
                <TableRow key={a.id} data-testid={`failed-${a.id}`}>
                  <TableCell>
                    <Link href={`/admin/businesses/${a.businessId}`} className="font-medium hover:text-primary hover:underline">
                      {a.businessName}
                    </Link>
                  </TableCell>
                  <TableCell>{TYPE_LABELS[a.type] ?? a.type.replace(/_/g, " ")}</TableCell>
                  <TableCell className="max-w-[26rem] truncate text-muted-foreground" title={a.lastError ?? undefined}>
                    {a.lastError ?? "No error recorded"}
                  </TableCell>
                  <TableCell className="tabular-nums">
                    {a.attempts} of {a.maxAttempts}
                  </TableCell>
                  <TableCell className="whitespace-nowrap text-muted-foreground">{formatDateTime(a.failedAt, "Europe/London")}</TableCell>
                  <TableCell className="text-right">
                    <ConfirmActionButton action={retryActionAction.bind(null, a.id)} label="Retry" confirmLabel="Yes, retry" />
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </div>
      )}
    </div>
  );
}
