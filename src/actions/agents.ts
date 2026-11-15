"use server";

import { randomUUID } from "node:crypto";
import { eq } from "drizzle-orm";
import { refresh } from "next/cache";
import { redirect } from "next/navigation";
import { getModelOptions } from "@/lib/ai/model-options";
import { getCurrentUser } from "@/lib/auth/session";
import { getDb } from "@/lib/db/client";
import { agents } from "@/lib/db/schema";
import { deleteAgent, LifecycleError } from "@/lib/debate/lifecycle";
import { agentSchema } from "@/lib/validation/agent";

export type AgentFormState = {
  errors?: Partial<Record<string, string[]>>;
  message?: string;
};

/** Creates or updates an agent from the agent form. */
export async function saveAgent(_prev: AgentFormState, formData: FormData): Promise<AgentFormState> {
  const me = await getCurrentUser();
  const db = await getDb();
  const agentId = formData.get("id") ? String(formData.get("id")) : null;
  const [provider, ...modelParts] = String(formData.get("model") ?? "").split("::");

  const parsed = agentSchema.safeParse({
    name: formData.get("name"),
    persona: formData.get("persona"),
    style: formData.get("style"),
    tone: formData.get("tone"),
    stance: formData.get("stance"),
    provider,
    modelId: modelParts.join("::"),
    creativity: formData.get("creativity"),
    turnLength: formData.get("turnLength"),
    visibility: formData.get("visibility"),
  });
  if (!parsed.success) {
    return { errors: parsed.error.flatten().fieldErrors, message: "Please fix the highlighted fields." };
  }
  const v = parsed.data;

  // Only models the form can currently offer may be saved, except an unchanged existing choice.
  const options = await getModelOptions();
  const offered = options.some((g) => g.models.some((m) => m.provider === v.provider && m.id === v.modelId));
  let existing: typeof agents.$inferSelect | undefined;
  if (agentId) {
    [existing] = await db.select().from(agents).where(eq(agents.id, agentId));
    if (!existing || existing.ownerId !== me.id) return { message: "You can only edit your own agents." };
  }
  const unchanged = existing && existing.provider === v.provider && existing.modelId === v.modelId;
  if (!offered && !unchanged) return { errors: { model: ["Pick one of the available models."] } };

  const now = Date.now();
  if (existing) {
    await db
      .update(agents)
      .set({ ...v, updatedAt: now })
      .where(eq(agents.id, existing.id));
  } else {
    await db.insert(agents).values({ id: randomUUID(), ownerId: me.id, ...v, createdAt: now, updatedAt: now });
  }
  redirect("/agents");
}

/** Deletes an agent (owner or admin). */
export async function removeAgent(formData: FormData) {
  const me = await getCurrentUser();
  const db = await getDb();
  try {
    await deleteAgent(db, { agentId: String(formData.get("id")), userId: me.id, isAdmin: me.isAdmin });
  } catch (err) {
    if (!(err instanceof LifecycleError)) throw err;
  }
  if (formData.get("redirectTo")) redirect(String(formData.get("redirectTo")));
  refresh();
}
