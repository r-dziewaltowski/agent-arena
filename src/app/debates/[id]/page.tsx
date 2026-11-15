import Link from "next/link";
import { notFound } from "next/navigation";
import { Suspense, type ReactNode } from "react";
import { deleteDebateAction, withdrawAction } from "@/actions/debates";
import { ConfirmButton } from "@/components/confirm-button";
import { AutoRefresh } from "@/components/debates/auto-refresh";
import { Countdown } from "@/components/debates/countdown";
import { LiveDebate } from "@/components/debates/live-debate";
import { EnterSlotForm, StartForm } from "@/components/debates/lobby-forms";
import { StatusBadge } from "@/components/debates/status-badge";
import { VotePanel } from "@/components/debates/vote-panel";
import { FailureNotice } from "@/components/debates/failure-notice";
import { Badge, Button, ButtonLink, Card, Notice } from "@/components/ui";
import { modelLabel } from "@/lib/ai/model-options";
import { getCurrentUser, type CurrentUser } from "@/lib/auth/session";
import { loadDebateView, type DebateRow, type SlotEntry } from "@/lib/debate-view";
import { agentsOf } from "@/lib/queries";

export default function DebatePage(props: PageProps<"/debates/[id]">) {
  return (
    <Suspense fallback={<p className="text-sm text-zinc-500">Loading debate…</p>}>
      <DebateView params={props.params} />
    </Suspense>
  );
}

const VOTING_LABELS = { "1h": "1 hour", "1d": "1 day", "3d": "3 days", "1w": "1 week" } as const;
const TALLY_LABELS = {
  live: "counts shown live",
  after_vote: "counts shown after you vote",
  after_close: "counts shown when voting closes",
} as const;

async function DebateView({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const [me, view] = await Promise.all([getCurrentUser(), loadDebateView(id)]);
  if (!view) notFound();
  const { debate, slots, turns, votes, creatorName, loadedAt } = view;
  const isCreator = !!me && debate.creatorId === me.id;

  return (
    <div className="space-y-6">
      <div>
        <div className="flex flex-wrap items-center gap-3">
          <StatusBadge status={debate.status} />
          <span className="text-xs text-zinc-500">created by {creatorName}</span>
        </div>
        <h1 className="mt-2 text-2xl font-semibold tracking-tight">{debate.topic}</h1>
        <div className="mt-3 flex flex-wrap gap-1.5">
          <Badge>{debate.rounds} rounds</Badge>
          <Badge>Up to {debate.maxParticipants} agents</Badge>
          <Badge>{debate.allowMultipleEntries ? "Several agents per user" : "One agent per user"}</Badge>
          <Badge>Voting {VOTING_LABELS[debate.votingDuration]}, {TALLY_LABELS[debate.tallyVisibility]}</Badge>
        </div>
      </div>

      {debate.status === "open" ? (
        <Lobby debate={debate} slots={slots} me={me} isCreator={isCreator} />
      ) : (
        <div className="grid gap-6 md:grid-cols-[1fr_16rem]">
          <div>
            {debate.status === "failed" && (
              <div className="mb-6">
                <FailureNotice
                  debateId={debate.id}
                  errorMessage={debate.errorMessage}
                  canManage={isCreator || !!me?.isAdmin}
                />
              </div>
            )}
            {debate.status === "cancelled" ? (
              <Notice tone="amber">
                <p className="font-medium">This debate was cancelled.</p>
                <p className="mt-1">{debate.cancelReason}</p>
              </Notice>
            ) : (
              <LiveDebate
                // Remount when the status changes (e.g. resumed after a failure) so polling restarts.
                key={debate.status}
                debateId={debate.id}
                rounds={debate.rounds}
                speakers={slots.map((s) => ({ participantId: s.participantId, name: s.name, position: s.position }))}
                initialTurns={turns}
                initial={{
                  status: debate.status,
                  waitingReason: debate.waitingReason,
                  nextAttemptAt: debate.nextAttemptAt,
                  totalPromptTokens: debate.totalPromptTokens,
                  totalCompletionTokens: debate.totalCompletionTokens,
                }}
              />
            )}
            {debate.status === "completed" && (
              <VotePanel debate={debate} slots={slots} votes={votes} viewerId={me?.id ?? null} now={loadedAt} />
            )}
          </div>
          <Participants slots={slots} />
        </div>
      )}

      {me?.isAdmin && debate.status !== "open" && (
        <form action={deleteDebateAction}>
          <input type="hidden" name="debateId" value={debate.id} />
          <ConfirmButton variant="danger" message="Delete this debate as admin? Its transcript and votes are removed for good.">
            Delete as admin
          </ConfirmButton>
        </form>
      )}
    </div>
  );
}

function Participants({ slots }: { slots: SlotEntry[] }) {
  return (
    <Card className="h-fit">
      <h2 className="mb-3 text-sm font-semibold">Participants</h2>
      <ol className="space-y-3 text-sm">
        {slots.map((s) => (
          <li key={s.participantId}>
            <p className="font-medium">
              {s.position}.{" "}
              {s.agentId ? (
                <Link href={`/agents/${s.agentId}`} className="hover:underline">
                  {s.name}
                </Link>
              ) : (
                <>
                  {s.name} <span className="text-xs font-normal text-zinc-500">(agent deleted)</span>
                </>
              )}
            </p>
            <p className="text-xs text-zinc-500">
              by {s.ownerName}
              {s.provider && s.modelId && <> · {modelLabel(s.provider, s.modelId)}</>}
            </p>
            {s.modelFallbackFrom && s.provider && (
              <p className="mt-0.5 text-xs text-amber-700 dark:text-amber-400">
                Ran on {modelLabel(s.provider, s.modelId ?? "")}: its chosen model ({modelLabel(s.provider, s.modelFallbackFrom)}) has been retired.
              </p>
            )}
          </li>
        ))}
      </ol>
    </Card>
  );
}

async function Lobby({
  debate,
  slots,
  me,
  isCreator,
}: {
  debate: DebateRow;
  slots: SlotEntry[];
  me: CurrentUser | null;
  isCreator: boolean;
}) {
  const myAgents = me ? await agentsOf(me.id) : [];
  const enteredAgentIds = new Set(slots.map((s) => s.agentId));
  const alreadyIn = !!me && slots.some((s) => s.userId === me.id);
  const canEnter = debate.allowMultipleEntries || !alreadyIn;
  const eligible = canEnter ? myAgents.filter((a) => !enteredAgentIds.has(a.id)) : [];
  const positions = Array.from({ length: debate.maxParticipants }, (_, i) => i + 1);

  let startInfo: ReactNode;
  if (debate.startMode === "manual") startInfo = isCreator ? null : "Starts when the creator starts it.";
  else if (debate.startMode === "when_full") startInfo = "Starts automatically when every slot is filled.";
  else if (debate.startAt) startInfo = <Countdown to={debate.startAt} />;

  return (
    <div className="space-y-6">
      <AutoRefresh />
      {startInfo && <Notice tone="blue">{startInfo}</Notice>}

      <div className="grid gap-4 sm:grid-cols-2">
        {positions.map((position) => {
          const slot = slots.find((s) => s.position === position);
          return (
            <Card key={position} className="flex flex-col gap-2">
              <p className="text-xs font-semibold uppercase tracking-wide text-zinc-500">Slot {position}{position === 1 ? " · speaks first" : ""}</p>
              {slot ? (
                <>
                  <p className="font-medium">{slot.name}</p>
                  <p className="text-xs text-zinc-500">
                    by {slot.ownerName}
                    {slot.provider && slot.modelId && <> · {modelLabel(slot.provider, slot.modelId)}</>}
                  </p>
                  {slot.userId === me?.id && (
                    <form action={withdrawAction} className="mt-auto pt-2">
                      <input type="hidden" name="participantId" value={slot.participantId} />
                      <Button type="submit" variant="secondary">
                        Withdraw
                      </Button>
                    </form>
                  )}
                </>
              ) : eligible.length > 0 ? (
                <EnterSlotForm debateId={debate.id} position={position} agents={eligible.map((a) => ({ id: a.id, name: a.name }))} />
              ) : (
                <p className="text-sm text-zinc-500">
                  Empty.{" "}
                  {!me ? (
                    <Link href={`/sign-in?next=/debates/${debate.id}`} className="text-indigo-600 hover:underline">
                      Sign in to enter an agent
                    </Link>
                  ) : myAgents.length === 0 ? (
                    <Link href="/agents/new" className="text-indigo-600 hover:underline">
                      Create an agent
                    </Link>
                  ) : !canEnter ? (
                    "You already have an agent in this debate."
                  ) : (
                    "All your agents are already in."
                  )}
                </p>
              )}
            </Card>
          );
        })}
      </div>

      {isCreator && (
        <div className="flex flex-wrap items-center justify-between gap-4">
          {debate.startMode === "manual" ? <StartForm debateId={debate.id} disabled={slots.length < 2} /> : <span />}
          <form action={deleteDebateAction}>
            <input type="hidden" name="debateId" value={debate.id} />
            <ConfirmButton variant="danger" message="Delete this debate? Entered agents are withdrawn.">
              Delete debate
            </ConfirmButton>
          </form>
        </div>
      )}
      {!isCreator && me?.isAdmin && (
        <form action={deleteDebateAction}>
          <input type="hidden" name="debateId" value={debate.id} />
          <ConfirmButton variant="danger" message="Delete this debate as admin?">
            Delete as admin
          </ConfirmButton>
        </form>
      )}
      <ButtonLink href="/debates" variant="ghost" className="px-0">
        ← All debates
      </ButtonLink>
    </div>
  );
}
