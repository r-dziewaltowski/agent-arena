import Link from "next/link";
import { removeAgent } from "@/actions/agents";
import { Avatar } from "@/components/avatar";
import { ConfirmButton } from "@/components/confirm-button";
import { Badge, ButtonLink, Card } from "@/components/ui";
import { isRetired, modelLabel } from "@/lib/ai/model-options";
import { avatarUrl } from "@/lib/avatars";
import type { agents } from "@/lib/db/schema";
import { CREATIVITY_LABELS, TURN_LENGTH_LABELS, traitLabel, type Creativity, type TurnLength } from "@/lib/debate/traits";

export function AgentCard({
  agent,
  runningDebates,
  canManage,
}: {
  agent: typeof agents.$inferSelect;
  runningDebates: number;
  canManage: boolean;
}) {
  const retired = isRetired(agent.provider, agent.modelId);
  const deleteMessage =
    runningDebates > 0
      ? `Delete ${agent.name}? It is in ${runningDebates} running debate(s); it will finish with the version it started with.`
      : `Delete ${agent.name}? This can't be undone.`;
  return (
    <Card className="flex flex-col gap-3">
      <div className="flex items-start justify-between gap-3">
        <div className="flex min-w-0 items-center gap-3">
          <Avatar src={avatarUrl(agent)} size={48} />
          <div className="min-w-0">
            <Link href={`/agents/${agent.id}`} className="text-lg font-semibold hover:underline">
              {agent.name}
            </Link>
            <p className="text-xs text-zinc-500 dark:text-zinc-400">
              {modelLabel(agent.provider, agent.modelId)} · {CREATIVITY_LABELS[agent.creativity as Creativity].label} ·{" "}
              {TURN_LENGTH_LABELS[agent.turnLength as TurnLength].label} turns
            </p>
          </div>
        </div>
        <Badge tone={agent.visibility === "public" ? "green" : "neutral"}>{traitLabel(agent.visibility)}</Badge>
      </div>
      <p className="line-clamp-3 text-sm text-zinc-700 dark:text-zinc-300">{agent.persona}</p>
      <div className="flex flex-wrap gap-1.5">
        <Badge tone="violet">{traitLabel(agent.stance)}</Badge>
        <Badge tone="blue">{traitLabel(agent.style)}</Badge>
        <Badge tone="blue">{traitLabel(agent.tone)}</Badge>
        {runningDebates > 0 && <Badge tone="amber">In {runningDebates} running debate(s)</Badge>}
      </div>
      {retired && (
        <p className="text-xs text-amber-700 dark:text-amber-400">
          This agent&apos;s model has been retired. It runs on the provider&apos;s default until you pick a new one.
        </p>
      )}
      {canManage && (
        <div className="mt-auto flex gap-2 pt-2">
          <ButtonLink href={`/agents/${agent.id}/edit`} variant="secondary">
            Edit
          </ButtonLink>
          <form action={removeAgent}>
            <input type="hidden" name="id" value={agent.id} />
            <ConfirmButton variant="danger" message={deleteMessage}>
              Delete
            </ConfirmButton>
          </form>
        </div>
      )}
    </Card>
  );
}
