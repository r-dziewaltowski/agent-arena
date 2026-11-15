import Link from "next/link";
import { Suspense } from "react";
import { StatusBadge } from "@/components/debates/status-badge";
import { ButtonLink, Card, cx, PageHeader } from "@/components/ui";
import { getCurrentUser } from "@/lib/auth/session";
import { listDebates, type DebateFilter } from "@/lib/queries";

const FILTERS: { value: DebateFilter; label: string }[] = [
  { value: "all", label: "All" },
  { value: "open", label: "Open to enter" },
  { value: "running", label: "Live" },
  { value: "completed", label: "Finished" },
  { value: "mine", label: "Mine" },
];

export default function DebatesPage(props: PageProps<"/debates">) {
  return (
    <>
      <PageHeader
        title="Debates"
        description="Enter an open debate with one of your agents, or watch one live."
        actions={<ButtonLink href="/debates/new">New debate</ButtonLink>}
      />
      <Suspense fallback={<p className="text-sm text-zinc-500">Loading debates…</p>}>
        <DebateList searchParams={props.searchParams} />
      </Suspense>
    </>
  );
}

async function DebateList({ searchParams }: { searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  const { filter: raw } = await searchParams;
  const filter = (FILTERS.find((f) => f.value === raw)?.value ?? "all") as DebateFilter;
  const me = await getCurrentUser();
  const debates = await listDebates(filter, me.id);

  return (
    <>
      <div className="mb-4 flex flex-wrap gap-2">
        {FILTERS.map((f) => (
          <Link
            key={f.value}
            href={f.value === "all" ? "/debates" : `/debates?filter=${f.value}`}
            className={cx(
              "rounded-full px-3 py-1 text-sm",
              f.value === filter
                ? "bg-zinc-900 text-white dark:bg-zinc-100 dark:text-zinc-900"
                : "bg-white text-zinc-700 ring-1 ring-zinc-200 hover:bg-zinc-100 dark:bg-zinc-900 dark:text-zinc-300 dark:ring-zinc-800",
            )}
          >
            {f.label}
          </Link>
        ))}
      </div>
      {debates.length === 0 ? (
        <Card className="text-center text-sm text-zinc-600 dark:text-zinc-400">
          No debates here yet.{" "}
          <Link href="/debates/new" className="font-medium text-indigo-600 hover:underline">
            Create one
          </Link>
          .
        </Card>
      ) : (
        <ul className="space-y-3">
          {debates.map((d) => (
            <li key={d.id}>
              <Link href={`/debates/${d.id}`}>
                <Card className="flex items-center justify-between gap-4 transition-colors hover:border-indigo-300 dark:hover:border-indigo-800">
                  <div>
                    <p className="font-medium">{d.topic}</p>
                    <p className="mt-1 text-xs text-zinc-500">
                      {d.entries.length}/{d.maxParticipants} agents · {d.rounds} rounds
                      {d.status === "open" && d.startMode === "scheduled" && d.startAt ? " · scheduled" : ""}
                    </p>
                  </div>
                  <StatusBadge status={d.status} />
                </Card>
              </Link>
            </li>
          ))}
        </ul>
      )}
    </>
  );
}
