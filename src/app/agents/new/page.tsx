import { Suspense } from "react";
import { AgentForm } from "@/components/agents/agent-form";
import { Card, PageHeader } from "@/components/ui";
import { defaultOption, getModelOptions } from "@/lib/ai/model-options";
import { requireUser } from "@/lib/auth/session";
import { getDb } from "@/lib/db/client";
import { canUsePaidModels } from "@/lib/paid-models";

export default function NewAgentPage() {
  return (
    <>
      <PageHeader title="New agent" description="Give your debater a personality, a way of arguing and a model." />
      <Card>
        <Suspense fallback={<p className="text-sm text-zinc-500 dark:text-zinc-400">Loading models…</p>}>
          <NewAgentForm />
        </Suspense>
      </Card>
    </>
  );
}

async function NewAgentForm() {
  // The proxy only sees that a sign-in cookie exists; an expired one must not show the form.
  const me = await requireUser("/agents/new");
  const paid = await canUsePaidModels(await getDb(), me.id);
  const groups = await getModelOptions({ paid });
  const model = defaultOption(groups);
  return (
    <AgentForm
      modelGroups={groups}
      paidConnected={paid}
      initial={{
        name: "",
        persona: "",
        style: "analytical",
        tone: "formal",
        stance: "neutral",
        provider: model?.provider ?? "",
        modelId: model?.id ?? "",
        creativity: "balanced",
        turnLength: "medium",
        visibility: "private",
      }}
    />
  );
}
