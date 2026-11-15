import Link from "next/link";
import { notFound } from "next/navigation";
import { Suspense } from "react";
import { removeAgent } from "@/actions/agents";
import { AgentCard } from "@/components/agents/agent-card";
import { ConfirmButton } from "@/components/confirm-button";
import { Card, PageHeader } from "@/components/ui";
import { displayNames, getCurrentUser } from "@/lib/auth/session";
import { debatesOfAgent, getAgent, runningDebateCount } from "@/lib/queries";
import { StatusBadge } from "@/components/debates/status-badge";

export default function AgentPage(props: PageProps<"/agents/[id]">) {
  return (
    <Suspense fallback={<p className="text-sm text-zinc-500">Loading…</p>}>
      <AgentView params={props.params} />
    </Suspense>
  );
}

async function AgentView({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const [me, agent] = await Promise.all([getCurrentUser(), getAgent(id)]);
  const isOwner = !!me && agent?.ownerId === me.id;
  const isAdmin = !!me?.isAdmin;
  // Private agents' full personas are only for their owner (and admins, for moderation).
  if (!agent || (agent.visibility !== "public" && !isOwner && !isAdmin)) notFound();
  const [running, debates, names] = await Promise.all([
    runningDebateCount(agent.id),
    debatesOfAgent(agent.id),
    displayNames([agent.ownerId]),
  ]);

  return (
    <>
      <PageHeader title={agent.name} description={<>by {names.get(agent.ownerId) ?? "someone"}</>} />
      <div className="grid gap-6 md:grid-cols-[2fr_1fr]">
        <div className="space-y-4">
          <AgentCard agent={agent} runningDebates={running} canManage={isOwner} />
          {isAdmin && !isOwner && (
            <form action={removeAgent}>
              <input type="hidden" name="id" value={agent.id} />
              <input type="hidden" name="redirectTo" value="/debates" />
              <ConfirmButton variant="danger" message={`Delete ${agent.name} as admin? This can't be undone.`}>
                Delete as admin
              </ConfirmButton>
            </form>
          )}
        </div>
        <Card>
          <h2 className="mb-3 text-sm font-semibold">Debates</h2>
          {debates.length === 0 ? (
            <p className="text-sm text-zinc-500">Not in any debates yet.</p>
          ) : (
            <ul className="space-y-2 text-sm">
              {debates.map((d) => (
                <li key={d.id} className="flex items-start justify-between gap-2">
                  <Link href={`/debates/${d.id}`} className="hover:underline">
                    {d.topic}
                  </Link>
                  <StatusBadge status={d.status} />
                </li>
              ))}
            </ul>
          )}
        </Card>
      </div>
    </>
  );
}
