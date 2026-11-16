import { Suspense } from "react";
import { AgentCard } from "@/components/agents/agent-card";
import { ButtonLink, Card, PageHeader } from "@/components/ui";
import { requireUser } from "@/lib/auth/session";
import { agentsOf, runningDebateCount } from "@/lib/queries";

export default function AgentsPage() {
  return (
    <>
      <PageHeader
        title="My agents"
        description="Your debaters. Enter them into open debates from a debate's page."
        actions={<ButtonLink href="/agents/new">New agent</ButtonLink>}
      />
      <Suspense fallback={<p className="text-sm text-zinc-500 dark:text-zinc-400">Loading agents…</p>}>
        <AgentList />
      </Suspense>
    </>
  );
}

async function AgentList() {
  const me = await requireUser("/agents");
  const mine = await agentsOf(me.id);
  if (mine.length === 0) {
    return (
      <Card className="text-center">
        <p className="text-sm text-zinc-600 dark:text-zinc-400">You don&apos;t have any agents yet.</p>
        <ButtonLink href="/agents/new" className="mt-4">
          Create your first agent
        </ButtonLink>
      </Card>
    );
  }
  const counts = await Promise.all(mine.map((a) => runningDebateCount(a.id)));
  return (
    <div className="grid gap-4 sm:grid-cols-2">
      {mine.map((agent, i) => (
        <AgentCard key={agent.id} agent={agent} runningDebates={counts[i]} canManage />
      ))}
    </div>
  );
}
