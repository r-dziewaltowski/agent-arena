import { findModel, listOllamaModels, offeredModels, PROVIDER_LABELS } from "./models";
import { costPerTurnUsd, formatUsd } from "./pricing";
import { defaultModelFor, googleApiKey, type Provider } from "./provider";

export type ModelOption = { provider: Provider; id: string; name: string; description: string };
export type ModelGroup = { provider: Provider; label: string; models: ModelOption[] };

/** OpenRouter's models come in two groups: free (the owner's daily free requests) and paid. */
const OPENROUTER_FREE_LABEL = "Free, on your OpenRouter account (your own daily limit)";

function catalogGroup(provider: Provider, tier?: "free" | "paid"): ModelGroup {
  return {
    provider,
    label: tier === "free" ? OPENROUTER_FREE_LABEL : PROVIDER_LABELS[provider],
    models: offeredModels(provider)
      .filter((m) => !tier || m.tier === tier)
      .map(({ provider, id, name, description, price }) => ({
        provider,
        id,
        name,
        // Paid models say roughly what a medium-length turn costs their owner.
        description: price ? `${description} About ${formatUsd(costPerTurnUsd(price))} a turn.` : description,
      })),
  };
}

/**
 * The models the agent form can offer right now: Groq's and Google's offered catalog models when
 * their keys are set, the models installed in Ollama when it can be reached, and OpenRouter's free
 * and paid models when this user has connected their OpenRouter account.
 */
export async function getModelOptions(opts: { paid?: boolean } = {}): Promise<ModelGroup[]> {
  const groups: ModelGroup[] = [];
  if (process.env.GROQ_API_KEY) groups.push(catalogGroup("groq"));
  if (googleApiKey()) groups.push(catalogGroup("google"));
  if (opts.paid) groups.push(catalogGroup("openrouter", "free"), catalogGroup("openrouter", "paid"));
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
