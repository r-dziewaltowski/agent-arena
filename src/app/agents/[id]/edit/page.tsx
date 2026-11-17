import { notFound } from "next/navigation";
import { Suspense } from "react";
import { AgentForm } from "@/components/agents/agent-form";
import { avatarUrl } from "@/lib/avatars";
import { voiceFor } from "@/lib/voice/voices";
import { Card, Notice, PageHeader } from "@/components/ui";
import { getModelOptions, isRetired, modelLabel } from "@/lib/ai/model-options";
import { requireUser } from "@/lib/auth/session";
import { getDb } from "@/lib/db/client";
import { canUsePaidModels } from "@/lib/paid-models";
import { getAgent, runningDebateCount } from "@/lib/queries";

export default function EditAgentPage(props: PageProps<"/agents/[id]/edit">) {
  return (
    <>
      <PageHeader title="Edit agent" />
      <Suspense fallback={<p className="text-sm text-zinc-500 dark:text-zinc-400">Loading…</p>}>
        <EditAgent params={props.params} />
      </Suspense>
    </>
  );
}

async function EditAgent({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const [me, agent] = await Promise.all([requireUser(`/agents/${id}/edit`), getAgent(id)]);
  if (!agent || agent.ownerId !== me.id) notFound();
  const paid = await canUsePaidModels(await getDb(), me.id);
  const [groups, running] = await Promise.all([getModelOptions({ paid }), runningDebateCount(agent.id)]);
  return (
    <div className="space-y-4">
      {running > 0 && (
        <Notice tone="amber">
          This agent is in {running} running debate(s). It will finish with the version it started with; your changes
          apply to debates that start later.
        </Notice>
      )}
      {isRetired(agent.provider, agent.modelId) && (
        <Notice tone="amber">This agent&apos;s model has been retired. Pick a new one below.</Notice>
      )}
      <Card>
        <AgentForm
          modelGroups={groups}
          paidConnected={paid}
          currentModelLabel={modelLabel(agent.provider, agent.modelId)}
          initial={{
            id: agent.id,
            name: agent.name,
            persona: agent.persona,
            style: agent.style,
            tone: agent.tone,
            stance: agent.stance,
            provider: agent.provider,
            modelId: agent.modelId,
            creativity: agent.creativity,
            turnLength: agent.turnLength,
            visibility: agent.visibility,
            voice: voiceFor(agent.id, agent.voice),
            voiceStyle: agent.voiceStyle ?? "",
            avatarSeed: agent.avatarSeed ?? "",
            pictureUrl: agent.imageUpdatedAt ? avatarUrl(agent) : null,
          }}
        />
      </Card>
    </div>
  );
}
