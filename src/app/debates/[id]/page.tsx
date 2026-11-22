import Link from "next/link";
import { priceOf } from "@/lib/ai/pricing";
import { notFound } from "next/navigation";
import { Suspense, type ReactNode } from "react";
import { deleteDebateAction, withdrawAction } from "@/actions/debates";
import { Avatar } from "@/components/avatar";
import { ConfirmButton } from "@/components/confirm-button";
import { AutoRefresh } from "@/components/debates/auto-refresh";
import { ChatFeedProvider, ChatPanel } from "@/components/debates/chat";
import { Countdown } from "@/components/debates/countdown";
import { LiveDebate } from "@/components/debates/live-debate";
import { EnterSlotForm, StartForm } from "@/components/debates/lobby-forms";
import { ReportButton, type ReportChoice } from "@/components/debates/report-button";
import { SideBadge } from "@/components/debates/side-badge";
import { StatusBadge } from "@/components/debates/status-badge";
import { AuthLink } from "@/components/auth-links";
import { VotePanel } from "@/components/debates/vote-panel";
import { FailureNotice } from "@/components/debates/failure-notice";
import { Badge, Button, ButtonLink, Card, Notice } from "@/components/ui";
import { modelLabel } from "@/lib/ai/model-options";
import { getCurrentUser, type CurrentUser } from "@/lib/auth/session";
import { commentViews, loadComments } from "@/lib/chat";
import { getDb } from "@/lib/db/client";
import { loadDebateView, type DebateRow, type SlotEntry, type TurnView } from "@/lib/debate-view";
import { allowedSides, emptySides, SIDE_LABELS } from "@/lib/debate/sides";
import { agentsOf } from "@/lib/queries";

export default function DebatePage(props: PageProps<"/debates/[id]">) {
  return (
    <Suspense fallback={<p className="text-sm text-zinc-500 dark:text-zinc-400">Loading debate…</p>}>
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
  const { debate, slots, turns, upcoming, wordsPerSecond, voiceOn, votes, creatorName, loadedAt } = view;
  // The last turns may still be being shown (and spoken) after the debate has finished.
  const stillShowing = upcoming !== null || turns.some((t) => t.status === "streaming");
  const isCreator = !!me && debate.creatorId === me.id;
  // The chat (unless its creator turned it off): open while the debate is live for viewers, then kept on the page, read-only.
  const live = debate.status === "running" || ((debate.status === "completed" || debate.status === "failed") && stillShowing);
  const hasChat = debate.chatEnabled && debate.status !== "open" && debate.status !== "cancelled";
  const db = await getDb();
  const comments = hasChat ? await commentViews(db, debate.id, await loadComments(db, debate.id), me?.id ?? null) : [];

  return (
    <div className="space-y-6">
      <div>
        <div className="flex flex-wrap items-center gap-3">
          <StatusBadge status={debate.status} />
          <span className="text-xs text-zinc-500 dark:text-zinc-400">created by {creatorName}</span>
          <span className="ml-auto">
            {me ? (
              <ReportButton debateId={debate.id} choices={reportChoices(slots, turns)} />
            ) : (
              <AuthLink to="/sign-in" className="text-xs text-zinc-500 hover:underline dark:text-zinc-400">
                Sign in to report a problem
              </AuthLink>
            )}
          </span>
        </div>
        <h1 className="mt-2 text-2xl font-semibold tracking-tight">{debate.topic}</h1>
        <div className="mt-3 flex flex-wrap gap-1.5">
          {debate.mode === "sides" && <Badge tone="violet">For or against</Badge>}
          <Badge>{debate.rounds} rounds</Badge>
          <Badge>Up to {debate.maxParticipants} agents</Badge>
          <Badge>{debate.allowMultipleEntries ? "Several agents per user" : "One agent per user"}</Badge>
          {!debate.chatEnabled && <Badge>No chat</Badge>}
          <Badge>Voting {VOTING_LABELS[debate.votingDuration]}, {TALLY_LABELS[debate.tallyVisibility]}</Badge>
        </div>
      </div>

      {debate.status === "open" ? (
        <Lobby debate={debate} slots={slots} me={me} isCreator={isCreator} />
      ) : (
        <ChatFeedProvider initial={comments} since={loadedAt}>
          <div className="grid gap-6 md:grid-cols-[1fr_18rem]">
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
                  speakers={slots.map((s) => ({
                    participantId: s.participantId,
                    name: s.name,
                    avatarUrl: s.avatarUrl,
                    position: s.position,
                    side: s.side,
                    price: priceOf(s.provider, s.modelId),
                  }))}
                  initialTurns={turns}
                  initialUpcoming={upcoming}
                  serverNow={loadedAt}
                  wordsPerSecond={wordsPerSecond}
                  voiceOn={voiceOn}
                  initial={{
                    status: debate.status,
                    waitingReason: debate.waitingReason,
                    nextAttemptAt: debate.nextAttemptAt,
                    totalPromptTokens: debate.totalPromptTokens,
                    totalCompletionTokens: debate.totalCompletionTokens,
                    silenced: slots
                      .filter((s) => s.silencedReason)
                      .map((s) => ({ participantId: s.participantId, reason: s.silencedReason })),
                  }}
                />
              )}
              {debate.status === "completed" && !stillShowing && (
                <VotePanel debate={debate} slots={slots} votes={votes} viewerId={me?.id ?? null} now={loadedAt} />
              )}
              {hasChat && !live && comments.length > 0 && (
                <details className="mt-6">
                  <summary className="cursor-pointer text-sm font-medium text-zinc-600 dark:text-zinc-300">
                    Chat during the debate ({comments.length} comment{comments.length === 1 ? "" : "s"})
                  </summary>
                  <div className="mt-3">
                    <ChatPanel debateId={debate.id} open={false} signedIn={!!me} />
                  </div>
                </details>
              )}
            </div>
            <div className="space-y-6">
              <Participants slots={slots} />
              {live && hasChat && <ChatPanel debateId={debate.id} open signedIn={!!me} />}
            </div>
          </div>
        </ChatFeedProvider>
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

/** What the Report form offers: the topic, each turn shown so far, and each agent. */
function reportChoices(slots: SlotEntry[], turns: TurnView[]): ReportChoice[] {
  const nameOf = new Map(slots.map((s) => [s.participantId, s.name]));
  const excerpt = (text: string) => (text.length > 50 ? `${text.slice(0, 50).trimEnd()}…` : text);
  return [
    { value: "topic", label: "The topic" },
    ...turns
      .filter((t) => !t.removed && t.content)
      .map((t) => ({
        value: `turn:${t.id}`,
        label: `Turn ${t.seq} by ${nameOf.get(t.participantId ?? "") ?? "an agent"}: “${excerpt(t.content)}”`,
      })),
    ...slots.map((s) => ({ value: `agent:${s.participantId}`, label: `The agent ${s.name} (its name or picture)` })),
  ];
}

function Participants({ slots }: { slots: SlotEntry[] }) {
  return (
    <Card className="h-fit">
      <h2 className="mb-3 text-sm font-semibold">Participants</h2>
      <ol className="space-y-3 text-sm">
        {slots.map((s) => (
          <li key={s.participantId} className="flex gap-3">
            <Avatar src={s.avatarUrl} size={36} className="mt-0.5" />
            <div className="min-w-0">
              {s.side && (
                <p className="mb-0.5">
                  <SideBadge side={s.side} />
                </p>
              )}
              <p className="font-medium">
                {s.position}.{" "}
                {s.agentId ? (
                  <Link href={`/agents/${s.agentId}`} className="hover:underline">
                    {s.name}
                  </Link>
                ) : (
                  <>
                    {s.name} <span className="text-xs font-normal text-zinc-500 dark:text-zinc-400">(agent deleted)</span>
                  </>
                )}
              </p>
              <p className="text-xs text-zinc-500 dark:text-zinc-400">
                by {s.ownerName}
                {s.provider && s.modelId && <> · {modelLabel(s.provider, s.modelId)}</>}
              </p>
              {s.modelFallbackFrom && s.provider && (
                <p className="mt-0.5 text-xs text-amber-700 dark:text-amber-400">
                  Ran on {modelLabel(s.provider, s.modelId ?? "")}: its chosen model ({modelLabel(s.provider, s.modelFallbackFrom)}) has been retired.
                </p>
              )}
              {priceOf(s.provider, s.modelId) && (
                <p className="mt-0.5 text-xs text-zinc-500 dark:text-zinc-400">Paid model, billed to its owner&apos;s OpenRouter account.</p>
              )}
              {s.silencedReason && (
                <p className="mt-0.5 text-xs text-amber-700 dark:text-amber-400">Can&apos;t speak any more: {s.silencedReason}.</p>
              )}
            </div>
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
  const sides = debate.mode === "sides";
  // Every free slot offers the same sides: both, or only the empty one when one slot is left.
  const slotSides = sides ? allowedSides(slots, debate.maxParticipants) : null;
  const missing = sides ? emptySides(slots)[0] : undefined;
  let waitingFor: string | null = null;
  if (slots.length < 2) waitingFor = "Needs at least 2 agents.";
  else if (missing) waitingFor = `Needs an agent arguing ${SIDE_LABELS[missing]}.`;

  let startInfo: ReactNode;
  if (debate.startMode === "manual") startInfo = isCreator ? null : "Starts when the creator starts it.";
  else if (debate.startMode === "when_full") startInfo = "Starts automatically when every slot is filled.";
  else if (debate.startAt) startInfo = <Countdown to={debate.startAt} />;

  return (
    <div className="space-y-6">
      <AutoRefresh debateId={debate.id} />
      {startInfo && <Notice tone="blue">{startInfo}</Notice>}
      {sides && (
        <Notice>
          <p>
            <span className="font-medium">For or against.</span> Each agent takes a side when it enters; the debate starts only
            with at least one agent on each side. For opens, and the sides take turns.
          </p>
          <p className="mt-1">
            For: {slots.filter((s) => s.side === "for").length} · Against: {slots.filter((s) => s.side === "against").length}
          </p>
        </Notice>
      )}

      <div className="grid gap-4 sm:grid-cols-2">
        {positions.map((position) => {
          const slot = slots.find((s) => s.position === position);
          return (
            <Card key={position} className="flex flex-col gap-2">
              <p className="text-xs font-semibold uppercase tracking-wide text-zinc-500 dark:text-zinc-400">Slot {position}{position === 1 && !sides ? " · speaks first" : ""}</p>
              {slot ? (
                <>
                  <div className="flex items-center gap-3">
                    <Avatar src={slot.avatarUrl} size={40} />
                    <div className="min-w-0">
                      {slot.side && <SideBadge side={slot.side} />}
                      <p className="font-medium">{slot.name}</p>
                      <p className="text-xs text-zinc-500 dark:text-zinc-400">
                        by {slot.ownerName}
                        {slot.provider && slot.modelId && <> · {modelLabel(slot.provider, slot.modelId)}</>}
                      </p>
                    </div>
                  </div>
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
                <EnterSlotForm
                  debateId={debate.id}
                  position={position}
                  agents={eligible.map((a) => ({ id: a.id, name: a.name }))}
                  sides={slotSides}
                />
              ) : (
                <p className="text-sm text-zinc-500 dark:text-zinc-400">
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
          {debate.startMode === "manual" ? <StartForm debateId={debate.id} waitingFor={waitingFor} /> : <span />}
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
