import { connectOpenRouterAction, disconnectOpenRouterAction } from "@/actions/openrouter";
import { ConfirmButton } from "@/components/confirm-button";
import { LocalDate } from "@/components/local-date";
import { Button, Card, Notice } from "@/components/ui";
import { offeredModels } from "@/lib/ai/models";
import { costPerTurnUsd, formatUsd } from "@/lib/ai/pricing";
import type { ConnectionStatus } from "@/lib/openrouter";

const NOTICES: Record<string, { tone: "blue" | "amber" | "red"; text: string }> = {
  connected: { tone: "blue", text: "OpenRouter is connected. Your agents can now use its free and paid models." },
  disconnected: {
    tone: "blue",
    text: "OpenRouter is disconnected and the key is deleted here. To be sure it can't be used, also revoke it on OpenRouter.",
  },
  cancelled: { tone: "amber", text: "Connecting was cancelled on OpenRouter." },
  expired: { tone: "amber", text: "That connection attempt expired. Please try again." },
  failed: { tone: "red", text: "OpenRouter didn't accept the connection. Please try again." },
  unavailable: { tone: "amber", text: "OpenRouter models aren't available on this server yet." },
};

const linkClass = "font-medium text-indigo-600 hover:underline dark:text-indigo-400";

/**
 * Account page: connect OpenRouter so agents can use its models on the user's own account: a few
 * free ones (its daily free requests) and paid ones (its credit).
 */
export function PaidModelsSection({
  connection,
  available,
  notice,
}: {
  connection: ConnectionStatus | null;
  /** False when the server can't store keys (no USER_API_KEYS_ENCRYPTION_SECRET). */
  available: boolean;
  notice?: string;
}) {
  const shown = notice ? NOTICES[notice] : undefined;
  const byCost = offeredModels("openrouter")
    .filter((m) => m.price)
    .map((m) => ({ name: m.name, cost: costPerTurnUsd(m.price!) }))
    .sort((a, b) => a.cost - b.cost);
  const [cheapest, dearest] = [byCost[0], byCost[byCost.length - 1]];
  const free = offeredModels("openrouter").filter((m) => m.tier === "free").map((m) => m.name);
  return (
    <Card>
      <h2 className="mb-2 text-lg font-semibold">More models with OpenRouter</h2>
      {shown && (
        <div className="mb-3">
          <Notice tone={shown.tone}>{shown.text}</Notice>
        </div>
      )}
      {!available ? (
        <p className="text-sm text-zinc-600 dark:text-zinc-400">OpenRouter models aren&apos;t available on this server yet.</p>
      ) : connection ? (
        <div className="space-y-3 text-sm text-zinc-600 dark:text-zinc-400">
          <p>
            Connected to OpenRouter since <LocalDate at={connection.connectedAt} />. Agents on its free models use your
            account&apos;s daily free requests; agents on paid models use your OpenRouter credit.
          </p>
          {connection.failedAt && (
            <Notice tone="amber">
              OpenRouter last refused your key: {connection.failReason?.replace(/^its owner's /, "your ")}. Agents on
              OpenRouter models are skipped in debates that were running then. Free requests come back the next day; for the
              rest, top up or raise the limit on OpenRouter, or reconnect.
            </Notice>
          )}
          <p>
            <a href={connection.manageUrl} target="_blank" rel="noreferrer" className={linkClass}>
              Manage this key on OpenRouter
            </a>{" "}
            to see what it has spent, set a spending limit, or revoke it.
          </p>
          <form action={disconnectOpenRouterAction}>
            <ConfirmButton
              variant="secondary"
              confirmLabel="Disconnect"
              message="Disconnect OpenRouter? The key is deleted here, and agents on OpenRouter models are skipped in debates until you connect again."
            >
              Disconnect OpenRouter
            </ConfirmButton>
          </form>
        </div>
      ) : (
        <div className="space-y-3 text-sm text-zinc-600 dark:text-zinc-400">
          <p>
            Give your agents more models through your own{" "}
            <a href="https://openrouter.ai" target="_blank" rel="noreferrer" className={linkClass}>
              OpenRouter
            </a>{" "}
            account: {free.join(" and ")}, free within OpenRouter&apos;s daily limit (no credit needed), and paid
            models such as Claude, GPT and Gemini on your OpenRouter credit. You approve on OpenRouter and it gives this site a key for your account; you never paste one.
            The key is stored encrypted, used only for your own agents&apos; turns, and you can revoke it any time.
          </p>
          <p>
            A medium turn on a paid model costs from {formatUsd(cheapest.cost)} ({cheapest.name}) to{" "}
            {formatUsd(dearest.cost)} ({dearest.name}). On OpenRouter&apos;s approval screen you can give the key a credit
            limit and an expiry.
          </p>
          <form action={connectOpenRouterAction}>
            <Button type="submit">Connect OpenRouter</Button>
          </form>
        </div>
      )}
    </Card>
  );
}
