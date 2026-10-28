import Link from "next/link";
import { ArrowRight, Search } from "lucide-react";
import { PageHeader } from "@/components/app/page-header";
import { ConversationList } from "@/components/conversations/conversation-list";
import { Button, buttonVariants } from "@/components/ui/button";
import { requireBusiness } from "@/lib/auth/guards";
import { cn } from "@/lib/utils";
import { FILTERS, FILTER_LABELS, listConversations, parseFilter } from "@/services/conversations";

export const metadata = { title: "Conversations" };

function href(filter: string, q?: string, before?: string): string {
  const params = new URLSearchParams();
  if (filter !== "all") params.set("filter", filter);
  if (q) params.set("q", q);
  if (before) params.set("before", before);
  const text = params.toString();
  return text ? `/conversations?${text}` : "/conversations";
}

export default async function ConversationsPage(props: PageProps<"/conversations">) {
  const { supabase, business } = await requireBusiness();
  const search = await props.searchParams;
  const filter = parseFilter(search.filter);
  const q = typeof search.q === "string" ? search.q : "";
  const before = typeof search.before === "string" ? search.before : undefined;

  const page = await listConversations(supabase, business.id, { filter, q, before });

  return (
    <div className="space-y-6">
      <PageHeader title="Conversations" description="Every customer your assistant has messaged, and how each one went." />

      <div className="flex flex-col gap-4 lg:flex-row lg:items-center lg:justify-between">
        <nav aria-label="Filter conversations" className="no-scrollbar -mx-1 flex gap-1.5 overflow-x-auto px-1 pb-1">
          {FILTERS.map((f) => (
            <Link
              key={f}
              href={href(f, q)}
              aria-current={f === filter ? "true" : undefined}
              className={cn(
                "shrink-0 rounded-full border px-4 py-1.5 text-sm font-medium transition-colors",
                f === filter ? "border-primary bg-primary text-primary-foreground shadow-sm" : "bg-card text-muted-foreground hover:text-foreground",
              )}
            >
              {FILTER_LABELS[f]}
            </Link>
          ))}
        </nav>

        <form action="/conversations" method="get" role="search" className="flex gap-2">
          {filter !== "all" ? <input type="hidden" name="filter" value={filter} /> : null}
          <div className="relative">
            <Search className="pointer-events-none absolute left-3.5 top-1/2 size-4 -translate-y-1/2 text-muted-foreground" aria-hidden />
            <input
              name="q"
              defaultValue={q}
              placeholder="Search name or number"
              aria-label="Search conversations"
              className="h-11 w-full min-w-64 rounded-xl border border-input bg-card pl-10 pr-3.5 text-sm shadow-xs outline-none focus-visible:border-ring focus-visible:ring-3 focus-visible:ring-ring/50"
            />
          </div>
          <Button type="submit" variant="outline">
            Search
          </Button>
        </form>
      </div>

      <ConversationList conversations={page.items} timezone={business.timezone} searching={q !== "" || filter !== "all"} />

      {page.nextBefore ? (
        <div className="flex justify-center">
          <Link href={href(filter, q, page.nextBefore)} className={buttonVariants({ variant: "outline" })}>
            Show older conversations <ArrowRight aria-hidden />
          </Link>
        </div>
      ) : null}
    </div>
  );
}
