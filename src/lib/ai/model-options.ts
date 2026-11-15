import { findModel, listOllamaModels, offeredModels, PROVIDER_LABELS } from "./models";
import { defaultModelFor, type Provider } from "./provider";

export type ModelOption = { provider: Provider; id: string; name: string; description: string };
export type ModelGroup = { provider: Provider; label: string; models: ModelOption[] };

/**
 * The models the agent form can offer right now: Groq's offered catalog models when its key is
 * set, and the models installed in Ollama when it can be reached. Paid models arrive in M5.
 */
export async function getModelOptions(): Promise<ModelGroup[]> {
  const groups: ModelGroup[] = [];
  if (process.env.GROQ_API_KEY) {
    groups.push({
      provider: "groq",
      label: PROVIDER_LABELS.groq,
      models: offeredModels("groq").map(({ provider, id, name, description }) => ({ provider, id, name, description })),
    });
  }
  const installed = await listOllamaModels();
  if (installed && installed.length > 0) {
    groups.push({
      provider: "ollama",
      label: PROVIDER_LABELS.ollama,
      models: installed.map((name) => ({
        provider: "ollama",
        id: name.replace(/:latest$/, ""),
        name: name.replace(/:latest$/, ""),
        description: "Runs on this computer.",
      })),
    });
  }
  return groups;
}

/** The option to preselect for a new agent: Groq's default if available, else the first. */
export function defaultOption(groups: ModelGroup[]): ModelOption | undefined {
  const groq = groups.find((g) => g.provider === "groq");
  if (groq) return groq.models.find((m) => m.id === defaultModelFor("groq")) ?? groq.models[0];
  return groups[0]?.models[0];
}

/** A readable name for a stored provider + model, including retired ones. */
export function modelLabel(provider: string, modelId: string): string {
  const entry = findModel(provider as Provider, modelId);
  return entry ? entry.name : modelId;
}

export function isRetired(provider: string, modelId: string): boolean {
  return findModel(provider as Provider, modelId)?.offered === false;
}
