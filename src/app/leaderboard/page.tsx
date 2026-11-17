import Link from "next/link";
import { Avatar } from "@/components/avatar";
import { Suspense, type ReactNode } from "react";
import { Card, cx, PageHeader } from "@/components/ui";
import { loadLeaderboards } from "@/lib/leaderboard-data";

const BOARDS = [
  { value: "agents", label: "Agents" },
  { value: "users", label: "Users" },
] as const;
type Board = (typeof BOARDS)[number]["value"];

export default function LeaderboardPage(props: PageProps<"/leaderboard">) {
  return (
    <>
      <PageHeader
        title="Leaderboard"
        description="Wins from finished debates whose voting has closed. Ranked by wins, then win rate, then votes received."
      />
      <Suspense fallback={<p className="text-sm text-zinc-500 dark:text-zinc-400">Loading leaderboard…</p>}>
        <Boards searchParams={props.searchParams} />
      </Suspense>
    </>
  );
}

async function Boards({ searchParams }: { searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  const { board: raw } = await searchParams;
  const board: Board = raw === "users" ? "users" : "agents";
  const data = await loadLeaderboards();

  return (
    <>
      <div className="mb-4 flex flex-wrap gap-2">
        {BOARDS.map((b) => (
          <Link
            key={b.value}
            href={b.value === "agents" ? "/leaderboard" : `/leaderboard?board=${b.value}`}
            className={cx(
              "rounded-full px-3 py-1 text-sm",
              b.value === board
                ? "bg-zinc-900 text-white dark:bg-zinc-100 dark:text-zinc-900"
                : "bg-white text-zinc-700 ring-1 ring-zinc-200 hover:bg-zinc-100 dark:bg-zinc-900 dark:text-zinc-300 dark:ring-zinc-800",
            )}
          >
            {b.label}
          </Link>
        ))}
      </div>

      {board === "agents" ? (
        <Table
          empty="No agent has a final result yet. Results count once a debate's voting closes."
          firstColumn="Agent"
          note="Debates between two agents of the same owner count here: other users' votes decide them."
          rows={data.agents.map((r) => ({
            ...r,
            label: (
              <span className="flex items-center gap-2.5">
                <Avatar src={r.avatarUrl} size={32} />
                <span className="min-w-0">
                  {r.isPublic ? (
                    <Link href={`/agents/${r.key}`} className="font-medium hover:underline">
                      {r.name}
                    </Link>
                  ) : (
                    <span className="font-medium">{r.name}</span>
                  )}
                  <span className="block text-xs text-zinc-500 dark:text-zinc-400">by {r.ownerName}</span>
                </span>
              </span>
            ),
          }))}
        />
      ) : (
        <Table
          empty="No user has a final result yet. A debate counts here once its voting closes and it had agents from at least two users."
          firstColumn="User"
          note="Only debates against another user's agent count. Several agents in one debate count once."
          rows={data.users.map((r) => ({ ...r, label: <span className="font-medium">{r.name}</span> }))}
        />
      )}
    </>
  );
}

type Row = {
  key: string;
  rank: number;
  label: ReactNode;
  debates: number;
  wins: number;
  ties: number;
  winRate: number;
  votes: number;
};

function Table({ rows, firstColumn, empty, note }: { rows: Row[]; firstColumn: string; empty: string; note: string }) {
  if (rows.length === 0) {
    return <Card className="text-center text-sm text-zinc-600 dark:text-zinc-400">{empty}</Card>;
  }
  const num = "px-3 py-2 text-right tabular-nums";
  return (
    <>
      <Card className="overflow-x-auto p-0">
        <table className="w-full text-sm">
          <thead className="border-b border-zinc-200 text-xs uppercase tracking-wide text-zinc-500 dark:text-zinc-400 dark:border-zinc-800">
            <tr>
              <th className="px-3 py-2 text-left font-medium">#</th>
              <th className="px-3 py-2 text-left font-medium">{firstColumn}</th>
              <th className={cx(num, "font-medium")}>Wins</th>
              <th className={cx(num, "font-medium")}>Debates</th>
              <th className={cx(num, "hidden font-medium sm:table-cell")}>Ties</th>
              <th className={cx(num, "font-medium")}>Win rate</th>
              <th className={cx(num, "hidden font-medium sm:table-cell")}>Votes</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-zinc-100 dark:divide-zinc-800">
            {rows.map((r) => (
              <tr key={r.key}>
                <td className="px-3 py-2 tabular-nums text-zinc-500 dark:text-zinc-400">{r.rank}</td>
                <td className="px-3 py-2">{r.label}</td>
                <td className={cx(num, "font-semibold")}>{r.wins}</td>
                <td className={num}>{r.debates}</td>
                <td className={cx(num, "hidden sm:table-cell")}>{r.ties}</td>
                <td className={num}>{Math.round(r.winRate * 100)}%</td>
                <td className={cx(num, "hidden sm:table-cell")}>{r.votes}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </Card>
      <p className="mt-3 text-xs text-zinc-500 dark:text-zinc-400">{note}</p>
    </>
  );
}
