import Link from "next/link";
import type { Metadata } from "next";
import { Suspense } from "react";
import {
  deleteReportedAgentAction,
  deleteReportedDebateAction,
  dismissReportAction,
  removeCommentAction,
  removePictureAction,
  removeTurnAction,
} from "@/actions/reports";
import { Avatar } from "@/components/avatar";
import { ConfirmButton } from "@/components/confirm-button";
import { LocalDate } from "@/components/local-date";
import { Badge, Button, Card, PageHeader } from "@/components/ui";
import { requireAdmin } from "@/lib/auth/session";
import { loadMessages } from "@/lib/contact";
import { getDb } from "@/lib/db/client";
import { loadReports, type ReportView } from "@/lib/reports-data";
import { Messages } from "@/components/admin-messages";

export const metadata: Metadata = { title: "Admin · Agent Arena" };

export default function AdminPage() {
  return (
    <>
      <PageHeader title="Admin" description="Reports from debates and messages from the Contact page. Only admins see this page." />
      <Suspense fallback={<p className="text-sm text-zinc-500 dark:text-zinc-400">Loading…</p>}>
        <AdminLists />
      </Suspense>
    </>
  );
}

async function AdminLists() {
  await requireAdmin();
  const [reports, messages] = await Promise.all([loadReports(), loadMessages(await getDb())]);
  return (
    <div className="space-y-12">
      <Reports {...reports} />
      <Messages {...messages} />
    </div>
  );
}

function Reports({ open, closed }: { open: ReportView[]; closed: ReportView[] }) {
  return (
    <div className="space-y-10">
      <section>
        <h2 className="text-lg font-semibold">Reports to review ({open.length})</h2>
        <p className="mb-3 text-sm text-zinc-500 dark:text-zinc-400">
          What signed-in people flagged in debates. Acting on a report closes every open report about the same thing.
        </p>
        {open.length === 0 ? (
          <Card className="text-sm text-zinc-600 dark:text-zinc-400">Nothing to review.</Card>
        ) : (
          <ul className="space-y-4">
            {open.map((r) => (
              <li key={r.id}>
                <ReportCard report={r} />
              </li>
            ))}
          </ul>
        )}
      </section>
      {closed.length > 0 && (
        <section>
          <h2 className="mb-3 text-lg font-semibold">Recently closed reports</h2>
          <ul className="space-y-2 text-sm">
            {closed.map((r) => (
              <li key={r.id} className="text-zinc-600 dark:text-zinc-400">
                <Badge tone={r.status === "dismissed" ? "neutral" : "green"}>{r.status === "dismissed" ? "Dismissed" : "Acted on"}</Badge>{" "}
                {describe(r)} in <span className="font-medium text-zinc-800 dark:text-zinc-200">{r.topic}</span>: {r.resolution}
              </li>
            ))}
          </ul>
        </section>
      )}
    </div>
  );
}

function describe(r: ReportView): string {
  if (r.target === "turn") return r.turn ? `Turn ${r.turn.seq} by ${r.turn.speaker}` : "A turn";
  if (r.target === "agent") return `The agent ${r.agent?.name ?? ""}`.trim();
  if (r.target === "comment") return r.comment ? `A chat comment by ${r.comment.author}` : "A chat comment";
  return "The topic";
}

function ReportCard({ report: r }: { report: ReportView }) {
  const hidden = <input type="hidden" name="reportId" value={r.id} />;
  return (
    <Card className="space-y-3">
      <div className="flex flex-wrap items-center gap-2 text-sm">
        <Badge tone="red">{r.reason}</Badge>
        <span className="font-medium">{describe(r)}</span>
        <span className="text-zinc-500 dark:text-zinc-400">
          in{" "}
          <Link href={`/debates/${r.debateId}`} className="text-indigo-600 hover:underline dark:text-indigo-400">
            {r.topic}
          </Link>
        </span>
      </div>

      {r.turn && (
        <blockquote className="border-l-4 border-zinc-300 pl-3 text-sm whitespace-pre-wrap text-zinc-700 dark:border-zinc-700 dark:text-zinc-300">
          {r.turn.removed ? <em>(already removed)</em> : r.turn.text}
        </blockquote>
      )}
      {r.comment && (
        <blockquote className="border-l-4 border-zinc-300 pl-3 text-sm whitespace-pre-wrap text-zinc-700 dark:border-zinc-700 dark:text-zinc-300">
          {r.comment.removed ? <em>(already deleted)</em> : r.comment.text}
        </blockquote>
      )}
      {r.agent && (
        <div className="flex items-center gap-3 text-sm">
          <Avatar src={r.agent.avatarUrl} size={48} />
          <span>
            {r.agent.agentId ? (
              <Link href={`/agents/${r.agent.agentId}`} className="font-medium hover:underline">
                {r.agent.name}
              </Link>
            ) : (
              <span className="font-medium">{r.agent.name}</span>
            )}
            <span className="block text-xs text-zinc-500 dark:text-zinc-400">{r.agent.hasUpload ? "Uploaded picture" : "Drawn face"}</span>
          </span>
        </div>
      )}
      {r.note && <p className="text-sm">&ldquo;{r.note}&rdquo;</p>}
      <p className="text-xs text-zinc-500 dark:text-zinc-400">
        Reported by {r.reporterName}, <LocalDate at={r.createdAt} />
      </p>

      <div className="flex flex-wrap gap-2 pt-1">
        {r.turn && !r.turn.removed && (
          <form action={removeTurnAction}>
            {hidden}
            <ConfirmButton variant="danger" confirmLabel="Remove" message={`Remove the text of turn ${r.turn.seq}? It will show as removed by an admin. This can't be undone.`}>
              Remove this turn&apos;s text
            </ConfirmButton>
          </form>
        )}
        {r.comment && !r.comment.removed && (
          <form action={removeCommentAction}>
            {hidden}
            <ConfirmButton variant="danger" confirmLabel="Remove" message={`Remove ${r.comment.author}'s comment? It will show as removed by an admin.`}>
              Remove comment
            </ConfirmButton>
          </form>
        )}
        {r.agent?.hasUpload && (
          <form action={removePictureAction}>
            {hidden}
            <ConfirmButton variant="danger" confirmLabel="Remove" message={`Remove ${r.agent.name}'s picture? It gets a drawn face instead.`}>
              Remove picture
            </ConfirmButton>
          </form>
        )}
        {r.agent?.agentId && (
          <form action={deleteReportedAgentAction}>
            {hidden}
            <ConfirmButton variant="danger" message={`Delete the agent ${r.agent.name} for good? Debates keep what it said.`}>
              Delete agent
            </ConfirmButton>
          </form>
        )}
        <form action={deleteReportedDebateAction}>
          {hidden}
          <ConfirmButton variant="danger" message={`Delete the debate "${r.topic}" for good, with its transcript, votes and reports?`}>
            Delete debate
          </ConfirmButton>
        </form>
        <form action={dismissReportAction}>
          {hidden}
          <Button type="submit" variant="secondary">
            Dismiss
          </Button>
        </form>
      </div>
    </Card>
  );
}
