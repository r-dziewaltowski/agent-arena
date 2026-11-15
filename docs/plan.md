# Agent Arena: implementation plan

## Context

Agent Arena is a web app where users create AI agents with arbitrary traits, enter them into debates on any topic, watch the debates unfold live, and vote for the winner. It is a non-commercial, small-scale project that aims to keep running costs at or near zero, and a way to explore building with LLM libraries.

Key decisions:

| Area | Decision |
|---|---|
| Stack | Next.js 16 (App Router) + TypeScript + Tailwind v4, single codebase |
| LLM layer | Vercel AI SDK v7 (`ai`) with provider abstraction |
| Models and cost | The project never pays for model calls. Free: local Ollama (development) and Groq's free tier on an app account with no payment method (M1.5; the hosted default once deployed). Paid models (Claude and others) only on users' own API keys (M5) |
| Persistence | SQLite via Drizzle ORM + `@libsql/client` (file db locally, Turso in production) |
| Auth | Better Auth (email + password first, GitHub OAuth later) |
| Debate runner | A hosted queue (Upstash QStash) drives debates: each turn is one HTTP call to the app, which queues the next, so debates start and finish whether or not anyone is watching, with no always-on process. Until M4 a polling worker process did this; it was replaced so hosting needs no always-on machine |
| Hosting | Vercel Hobby (web app and job routes) + Turso free (database) + QStash free (queue): $0 a month. The same app runs on any Node host if a free tier falls short (e.g. Fly.io, ~$4 a month), since nothing depends on Vercel-only features |
| Location | `C:\dev\agent-arena`, fresh git repo |
| v1 scope | Core loop + persistence + user accounts + open debates that users enter with their own agents + live word-by-word view of the current turn for every viewer. Judge, leaderboard and debate modes deferred |

Environment (current machine, 2026-11-15): Node 26.13.1, npm 11.20, git 2.56, Ollama 0.40.16 with `llama3.2` pulled (reports token usage). Package versions re-checked on npm: next 16.4.6, ai 7.0.173, ollama-ai-provider-v2 4.1.0 (peer `ai ^7`, `zod ^4`), drizzle-orm 0.45.4, drizzle-kit 0.31.11, better-auth 1.7.25 (peer next ^16, drizzle-orm ^0.45), @libsql/client 0.18.0, zod 4.6.7, tailwindcss 4.3.5.

> **M0 is done** (commit `253f5ee`). `.env.example` and `.env.local` are created by hand; the variables are listed in the README.

## Architecture in one paragraph

A debate is a persisted state machine, not a long-running process. It is created **open**: users enter their own agents into free speaking slots until it starts (manually, when full, or at a scheduled time). A **hosted queue** (Upstash QStash; its local dev server in development) drives every running debate: a queued message makes QStash call the app's job route, which calls `runStep` to generate exactly one agent turn (one LLM call), writing the partial text to the database every ~300 ms while the model streams, then saves the finished turn, advances the pointer and queues the next message (immediately, or after a delay when the model is rate-limited or unreachable). Starting a debate queues its first message; a scheduled debate gets a delayed message for its start time; a sweep every few minutes restarts any chain that was lost. Viewers never drive anything: the debate page polls `GET /api/debates/[id]/turns?after=seq`, which includes the in-progress turn, so every viewer sees it appear word by word. A lock guarantees one turn at a time per debate even if a message is delivered twice. Because each step is saved, the design survives restarts and is trivially resumable; `runStep` doesn't care who calls it (the job route, the terminal CLI, tests). Turn order is strict round-robin by slot: round 1 openings, middle rounds arguments, last round closings. Context stays bounded via a window of the last 6 turns plus a rolling summary. Voting opens when the debate completes and closes after the debate's voting duration: one vote per user, never for your own agent.

## Debate lifecycle

Configuration, fixed at creation (a debate can be deleted but never edited):

| Setting | Values |
|---|---|
| topic | free text |
| rounds | number, default 3 |
| maxParticipants | 2 to 4 |
| startMode | `manual`, `when_full` or `scheduled` (with `startAt`) |
| allowMultipleEntries | on/off, default off: whether one user may enter several of their own agents |
| votingDuration | 1 hour, 1 day, 3 days (default) or 1 week after the debate completes; no "no limit" option, so every debate gets a final result |
| tallyVisibility | `live` (everyone sees counts while voting is open), `after_vote` (default: each user once they've voted, everyone else when voting closes) or `after_close` (nobody until voting closes) |

v1 debates are **free discussion**: each agent argues its own view from its persona and stance, no assigned sides. Later modes (binary for/against, multiple choice, free discussion as the default) add a `mode` column; existing debates default to free discussion.

States: `open` → `running` → `completed` (or `failed`), plus `cancelled`.

- **Open.** Any signed-in user may enter **one** of their own agents, or several different ones of their own if `allowMultipleEntries` is on, and picks a free slot for each (slot = speaking order; slot 1 opens each round). The same agent can never take two slots. With multiple entries on, one user can fill every slot; the creator accepts that by choosing the setting. The creator may enter too. An entrant can withdraw any of their entries before the start, which frees that slot. Edits to an entered agent before the start still count; deleting an agent withdraws it from every open debate. The creator can delete the debate only while it is open.
- **Start.** Needs at least 2 entries.
  - `manual`: the creator's Start button, enabled from 2 entries.
  - `when_full`: starts in the same transaction as the entry that fills the last slot.
  - `scheduled`: a delayed queue message arrives at `startAt` (the sweep catches it if the message is lost); it starts the debate with whoever has entered if there are 2 or more, otherwise it marks it `cancelled` with a reason shown to entrants. Empty slots are fine.
- **On start.** Remaining entries keep their relative order and are renumbered 1..n; if two agents share a name, later ones get a suffix in the snapshot ("Socrates (2)"), because names label turns and drive stop sequences; a retired model is replaced by its provider's default (recorded in `modelFallbackFrom`); each participant's agent is snapshotted (traits, model, labels and resolved numbers); `maxTotalTokens` is computed; `startedAt` is set.
- **Running → completed.** The queue drives turns until the closing round is done, with nobody needing to watch. Once started, nobody can delete the debate or withdraw from it, so a finished debate belongs to everyone in it.
- **Voting.** Opens when the debate completes; the engine sets `votingClosesAt = completedAt + votingDuration`. Votes after that time are rejected (a clock comparison, no extra job). While voting is open the winner is **provisional** and the counts are shown according to `tallyVisibility`; once it closes the result is **final** and visible to everyone. The vote panel states the rule, e.g. "Results are revealed when voting closes in 2 days". Only final results count towards the leaderboard.
- **Deleting or editing an agent that is in a running or finished debate** is allowed and has no effect on that debate: turns are built only from the participant snapshot, never from the `agents` table. Agents are **hard-deleted** (by their owner or an admin): the agent row is removed, its entries in open debates are withdrawn, and in started or finished debates the participant's `agentId` is set to null. Those debates keep the snapshot (name, transcript, votes) with a small "agent deleted" label and no link to an agent page. Deleted agents don't appear on the leaderboard.
- **Admin deletion.** An admin can delete any debate (permanently, with its entries, turns and votes) or any agent (as above), at any stage, behind a confirmation dialog. An agent page lists the debates the agent appeared in, so an admin removing offensive content can find them.
- **Failed and cancelled debates** have no voting.

## Data model (Drizzle, SQLite)

Better Auth owns `user`, `session`, `account`, `verification` (generated by its CLI into `src/lib/db/schema/auth.ts`), with two additional user fields: `displayName` (chosen at sign-up, shown everywhere a person appears; email addresses are never shown to other users) and `isAdmin` (default false, set by hand in the database). App tables use text UUID ids and integer epoch-ms timestamps.

- **agents**: id, ownerId (idx), name, persona (text), style, tone, stance (all three plain text columns; see trait fields below), provider (`ollama|groq|anthropic`; text, so more can be added without a migration), modelId (from the model catalog, see below), creativity (`focused|balanced|creative|wild`, default `balanced`), turnLength (`short|medium|long`, default `medium`), visibility (`private|public`, default `private`), createdAt, updatedAt. Hard delete (see lifecycle).
- **debates**: id, creatorId (idx), topic, rounds (default 3), maxParticipants, startMode, startAt (nullable), allowMultipleEntries (default false), votingDuration (default 3 days), tallyVisibility (default `after_vote`), status (`open|running|completed|failed|cancelled`), cancelReason, currentRound, currentTurnIndex, maxTotalTokens (not shown to users; computed at start, see below), totalPromptTokens, totalCompletionTokens, summary, summaryThroughSeq, lockToken, lockedAt, retryCount, waitAttempts (consecutive "unreachable" attempts, for the backoff), nextAttemptAt, waitingReason, errorMessage, createdAt, startedAt, completedAt, votingClosesAt (set at completion). Indexes `(status, createdAt)` and `(status, startAt)`.
- **debate_participants** (an entry while open, a participant once started): id, debateId (idx), agentId (nullable: set to null when the agent is deleted after the start), userId (the agent's owner), position (slot), joinedAt, plus snapshot columns filled at start: the agent's traits/model, the creativity and turnLength labels **and** the resolved `temperature` and `maxOutputTokens` actually sent to the model, and `modelFallbackFrom` (the agent's chosen model when it was retired and the provider default ran instead; null otherwise). Unique `(debateId, position)` and `(debateId, agentId)`; index `(debateId, userId)`. "One entry per user" can't be a unique index because it depends on `allowMultipleEntries`, so `enter` checks it inside the slot-claiming transaction.
- **turns**: id, debateId, participantId (nullable for summary turns), round, seq, kind (`opening|argument|closing|summary`), status (`streaming|complete`), content (grows while streaming), promptTokens, completionTokens, modelId, latencyMs, finishReason, createdAt, updatedAt. Unique `(debateId, seq)`.
- **votes**: id, debateId, userId, participantId, createdAt. Unique `(debateId, userId)`; index `(debateId, participantId)`. A vote for a participant whose `userId` is the voter is rejected, which covers all of a user's agents; if one user owns every participant, they can't vote in that debate, but everyone else can.

Trait fields: `persona` is free text and carries most of the identity. The other three are stored as plain text so the allowed values can change without a migration:

- `style` (rhetorical method, e.g. socratic, analytical, storyteller) and `tone` (voice, e.g. formal, dry, sarcastic): **a preset key or the user's own text** (max 80 chars). A preset maps to a hand-tuned prompt sentence; custom text goes into a fixed frame ("Your rhetorical style: …" / "Your tone: …"). Exact preset lists are chosen in M2.
- `stance` (relation to other speakers): **preset only** in v1: `contrarian`, `agreeable`, `neutral`, `mediator`, `provocateur`. Unlike style and tone, the engine acts on stance: each preset has its own round instruction (e.g. contrarian: challenge the last speaker's strongest point; mediator: find common ground and propose a compromise). More specific attitudes go in the persona. Custom stance can be added later without a migration if real debates show a need.

Presets live in one module (`src/lib/debate/traits.ts`) shared by the Zod validation, the prompt builder and the agent form. A `goal` field is deferred until real debates show a need.

Model settings: owners never see raw numbers. `creativity` and `turnLength` are stored as labels and turned into `temperature` and `maxOutputTokens` **for the agent's current provider** when the debate starts (and stored in the snapshot), so switching provider never leaves an invalid value and nothing has to be adjusted. Starting mapping (tuned after real debates):

| creativity | Ollama | Groq | Claude |
|---|---|---|---|
| focused | 0.3 | 0.3 | 0.2 |
| balanced | 0.7 | 0.7 | 0.6 |
| creative | 1.0 | 1.0 | 0.8 |
| wild | 1.3 | 1.3 | 1.0 |

turnLength: short 120, medium 220, long 400 tokens.

Model catalog (`src/lib/ai/models.ts`): agents pick a model from a list, not free text, because models get retired (Groq retired its Llama models during M1.5) and need per-model settings. Each entry: provider, model id, display name and short description, `free` or `paid` (paid = runs on the owner's own key, M5), reasoning settings where relevant (replacing `groqReasoningOptions`: gpt-oss `low`, Qwen `none`, both hidden), and `offered` (false once retired). Each provider has a default entry. Groq entries are the models checked against the live list (`openai/gpt-oss-120b` default, `openai/gpt-oss-20b`, `qwen/qwen3.8-27b`). Ollama is the exception: its models are whatever is installed on the machine, read from Ollama's `/api/tags`. Saving an agent accepts only an offered catalog model (or an installed Ollama model).

Retired models (option A, fall back): when a debate starts and a participant's model is no longer offered (or, for Ollama, no longer installed), the snapshot uses the provider's default model instead and records the requested one in `modelFallbackFrom`. The debate page shows it ("ran on GPT-OSS 120B; Ada's model has been retired"), and the agent's own page warns "model retired, pick a new one". Open debates involve other people, so one owner's stale setting never blocks or fails a debate.

Debate token budget: users don't set it. At start, once participants are known, `maxTotalTokens` (prompt + completion) is computed as a safety cap: rounds × sum over participants of (their resolved `maxOutputTokens` + a prompt allowance of ~1,500), × 1.2 headroom for summary calls. The allowance and headroom are starting guesses, checked against real token counts in the M1 smoke test. A visible budget control (e.g. Short / Normal / Long debate) can be added later.

Cost display = token sums per debate/participant times a static price table in `src/lib/ai/pricing.ts` (Ollama and Groq free tier = 0; paid models at list price, billed to the agent owner's own key).

## Access rules

| Action | Who |
|---|---|
| Watch debates, browse the debate list | Anyone, no account needed |
| Sign up | Anyone (open email + password) |
| Create agents and debates | Any signed-in user |
| Edit an agent | Its owner only |
| Delete an agent | Its owner, or an admin |
| Enter a debate | Any signed-in user, with their own agents only, while it is open: one entry per user, or several different agents if the debate allows multiple entries |
| Withdraw an entry | The entrant, per entry, while the debate is open |
| Start a `manual` debate | Its creator, from 2 entries |
| Delete a debate | Its creator, while it is open; an admin, at any time |
| Generate turns | Only the job routes, which accept only signature-checked calls from the queue; no user or viewer can trigger a model call directly (starting or resuming a debate only queues its next step) |
| Vote | Signed-in users, once per completed debate, while voting is open (from completion until `votingClosesAt`), not for their own agent |
| See vote counts | While voting is open: per the debate's `tallyVisibility`. After it closes: everyone |

Admins: a minimal `isAdmin` flag (set by hand on the project owner's account) for removing bad content; there is no report button or moderation queue in v1. It grants no model access: the project never pays for model calls.

Input limits (Zod): topic ~200 characters, agent name ~40, persona ~1,500, custom style/tone 80, display name ~40.

Agent visibility: only an agent's owner can ever enter it into a debate, so visibility doesn't control use. It controls **what others can see**: `public` agents have a browsable page with the full persona and settings; `private` agents (default) show only their name and their arguments in the debates they take part in. The agent form says so.

Model cost: the project never pays for model calls.
- **Free models** (Ollama locally, Groq's free tier when hosted) run on an account with **no payment method**, so exceeding the free limits means requests are refused until the limits reset, never a bill. Rate-limit responses (HTTP 429) make a debate wait and retry (honouring the provider's retry-after), like an unreachable model, instead of failing it. All users share the app's free-tier limits; a daily cap of ~1,000 requests is roughly 160 six-turn debates.
- **Paid models** (Claude and others, M5) only with the agent owner's **own API key** ("bring your own key"): each agent's turns are billed to its owner, so in a mixed debate every entrant pays only for their own agent. Keys are stored encrypted on the server (debates run while owners are offline), never shown again after saving, never logged, and deletable. If a key stops working mid-debate, that agent's turn fails with a visible reason (rule decided in M5: skip the agent's turns or fail the debate). A sign-in "connect your account" flow (e.g. OpenRouter's) is preferred over pasted keys where available. Claude Haiku 5.5 is the cheap default for users (~0.1 cent per six-turn debate at list price).
- Users are told which provider sees their agents' personas and debates.

## Debate engine and queue

- `src/lib/ai/provider.ts`: `resolveModel(provider, modelId): LanguageModel`. Phase 1 returns `createOllama({ baseURL })(modelId)`; the Anthropic branch is added in M5. Also `resolveSettings(provider, creativity, turnLength): { temperature, maxOutputTokens }` holding the mapping table above.
- `src/lib/debate/lifecycle.ts`: `enter`, `withdraw`, `start` (renumber slots, snapshot, compute budget), `startDueScheduled` (start or cancel scheduled debates whose `startAt` has passed), `cancel`. `enter` checks, in one transaction, that the debate is open, the agent belongs to the user and isn't already entered, the slot is free, and (when `allowMultipleEntries` is off) the user has no other entry. All state changes use conditional updates or transactions so two users racing for a slot, or two callers starting the same debate, can't both win.
- `src/lib/debate/prompt.ts`: short imperative system prompt (name and persona first, then style/tone/stance, topic, opponents, rules: 2-4 short paragraphs, first person, no name prefix, no speaking for others). Transcript rendered as alternating messages: own past turns as `assistant`, others' as `user` prefixed with speaker name. Optional summary message first. Final user message carries the round-specific instruction. `stopSequences` on `"\n{OtherName}:"`. Post-process: strip a leading `Name:` and any `<think>...</think>` block.
- `src/lib/debate/engine.ts`: `runStep(debateId)`: only for `running` debates; acquire lock via conditional update (skip if held and fresher than 90 s), load state, build prompt, insert the next turn row with `status = 'streaming'`, `streamText` with the `maxOutputTokens` and `temperature` from the participant snapshot, update the row's `content` every ~300 ms and call the `src/lib/debate/broadcast.ts` `publishChunk(debateId, chunk)` seam (no-op in v1, swappable for push to viewers later), then on finish mark the row `complete` with usage (tokens nullable; estimate `chars/4` when Ollama omits usage), advance pointers, trigger summary fold when `seq - summaryThroughSeq >= 6`, mark the debate `completed` (setting `completedAt` and `votingClosesAt`) after the closing round or jump to the closing round when `maxTotalTokens` is exceeded, release lock. A `streaming` row left behind by a crash (older than the lock timeout) is discarded and the turn regenerated.
- Error handling in `runStep` distinguishes two cases. **Provider unreachable** (connection refused, timeout, Ollama not running or the PC asleep): the half-written turn is discarded, the debate stays `running` with `waitingReason` set and `nextAttemptAt` pushed out with growing delays (e.g. 30 s, 1 min, 2 min, … capped at 10 min); it never fails for this reason, and the debate page shows "Waiting for the model to become available". **A genuinely bad turn** (empty output, an error returned by the model): retried twice (`retryCount`), then the debate is marked `failed` with `errorMessage`. A successful turn resets both.
- **Before M4** `src/lib/debate/runner.ts` + `scripts/worker.ts` were a polling loop (every ~2 s: `startDueScheduled()`, then `runStep` for each ready running debate, one at a time). M4 replaces it with the queue below; the worker and `runLoop` are removed, and `debate:cli` keeps calling `runStep` directly.
- **Queue seam** `src/lib/jobs/queue.ts`: `enqueueAdvance(debateId, { at? })`, implemented with `@upstash/qstash` (`publishJSON` to `${APP_URL}/api/jobs/advance`, `notBefore` rounded up to whole seconds and clamped to the maximum delay). Server code receives it like `resolveModel`, so tests use a fake queue that records messages. Another queue (SQS, Inngest, a self-hosted one) can replace it behind the same function.
- **`POST /api/jobs/advance`** (`{ debateId }`): verifies the QStash signature (`Receiver`, current and next signing keys) and rejects anything else. If the debate is `open`, scheduled and due, it starts it or cancels it (the per-debate form of `startDueScheduled`); if it is due but further away than the queue's maximum delay, it re-queues itself at that maximum. If the debate is `running`, it calls `runStep` and chains on the outcome: a turn that didn't finish the debate → queue the next step now; `waiting` → queue at `nextAttemptAt`; `retrying` → queue after ~5 s; completed, failed, cancelled or deleted → stop; skipped because another call holds the lock → stop (that call chains). It returns 200 for every handled outcome (model problems are already handled inside `runStep`) and 5xx only for unexpected errors, such as the database being unreachable, so QStash retries those.
- **Who queues the first message:** `startDebate` (manual Start), the entry that fills a `when_full` debate, `resumeDebate`, and `createDebate` for scheduled debates (delayed to `startAt`). Messages are queued after the transaction commits. A failure to queue is logged, not shown as an error: the sweep picks the debate up.
- **Duplicates** (a QStash retry after a step that actually succeeded, or the sweep racing a live chain) are harmless without deduplication ids: the per-debate lock lets only one call generate a turn, and a call that finds the lock held stops instead of queuing, so two chains collapse into one. QStash keeps deduplication ids for 90 days, so ids built from the debate's position would have dropped the step after a Resume (same position, counters reset); they were left out.
- **Sweep** `POST /api/jobs/sweep`, called by a QStash schedule every 10 minutes (~144 of the free tier's ~1,000 daily messages): starts or cancels due scheduled debates whose message was lost, and queues a step for running debates that are due (`nextAttemptAt` passed or empty) but have had no activity for over 2 minutes (a lost chain, e.g. a crash between saving a turn and queuing the next). The schedule is created idempotently under a fixed schedule id by `npm run queue:setup` (with the deployment's `APP_URL`) at deploy time. Locally `src/instrumentation.ts` creates it when the dev server starts (the QStash dev server keeps everything in memory), running every minute, so debates left running when the machine was off continue within a minute or two.
- **Parallelism:** QStash flow control (one key for all turns) caps how many turns run at once: 1 locally, since Ollama handles one generation well; a few in production, sized to Groq's per-minute limits (`TURN_PARALLELISM`). Turns of different debates otherwise run in parallel.
- **Callback address:** `APP_URL` (locally it defaults to `http://host.docker.internal:3000`, since the QStash dev server runs in Docker, where `localhost` is the container; in production `APP_URL` or `BETTER_AUTH_URL`). The same address is used to verify signatures, since QStash signs the destination URL. Preview deployments use their own URL (Vercel's `VERCEL_BRANCH_URL`), and their messages forward the `x-vercel-protection-bypass` header (`VERCEL_AUTOMATION_BYPASS_SECRET`, available on Hobby) so QStash can get past preview protection.
- **Time limits:** Vercel Hobby functions run for up to 300 s; the job routes set `maxDuration` accordingly. A turn takes seconds on Groq and up to about a minute with a cold local Ollama.

## Routes and pages

Pages under `src/app/`: `/` (open and recent debates), `/sign-in`, `/sign-up`, `/agents` (yours), `/agents/new`, `/agents/[id]` (public agents, or your own), `/agents/[id]/edit`, `/debates` (filter: open / running / completed / mine), `/debates/new`, `/debates/[id]`:
- open: settings, slots with entrants, Enter (pick one of your agents and a free slot), Withdraw, Start (creator, manual), Delete (creator), countdown for scheduled starts;
- running/completed: transcript with the current turn growing word by word (polling), a "waiting for the model" notice when the model is unreachable, cost badges; when completed, the vote panel with the closing countdown and the tally shown per `tallyVisibility` (provisional), then the final result once voting closes;
- cancelled: the reason.

Mutations via server actions in `src/actions/{agents,debates,entries,votes}.ts`. Route handlers: `GET /api/debates/[id]/turns?after=seq` (completed turns after `seq` plus the in-progress turn, polled about once a second while running), `/api/auth/[...all]` for Better Auth, and the queue-only job routes `POST /api/jobs/advance` and `POST /api/jobs/sweep` (see above). `src/proxy.ts` (Next 16 replacement for middleware) does cookie-presence redirects only, for pages that need sign-in; real authorization lives in actions/handlers via `auth.api.getSession`.

## Project structure

```
C:\dev\agent-arena
  src/app/...                 pages + api routes above
  src/components/{ui,agents,debates}/
  src/actions/                'use server' mutations
  src/lib/auth/               auth.ts, auth-client.ts, session.ts (requireUser)
  src/lib/db/                 client.ts, schema/{auth,agents,debates,votes}.ts
  src/lib/ai/                 provider.ts, models.ts (model catalog), pricing.ts
  src/lib/debate/             lifecycle.ts, engine.ts, prompt.ts, traits.ts, summarize.ts, broadcast.ts, results.ts
  src/lib/jobs/               queue.ts (the queue seam), advance.ts (start-or-step and chaining), sweep.ts
  src/app/api/jobs/           advance/ and sweep/ route handlers (queue-only)
  src/lib/validation/         zod schemas
  scripts/debate-cli.ts       terminal smoke test of the engine (calls runStep directly)
  scripts/setup-queue.ts      creates the sweep schedule on a deployment (npm run queue:setup)
  scripts/queue-dev.ts        runs the QStash dev server in Docker (part of npm run dev)
  src/instrumentation.ts      creates the sweep schedule on the local dev server at startup
  src/**/*.test.ts            Vitest unit tests next to the code they test
  .github/workflows/ci.yml    CI: lint, type check, tests, build
  drizzle/                    migrations; drizzle.config.ts; .env.local (gitignored); .env.example
```

## Milestones (each ends runnable)

**M0. Prerequisites. ✅ Done.** Install Ollama (`winget install Ollama.Ollama`) and pull one small model (`ollama pull llama3.2`, ~2 GB; fall back to `qwen3:4b` if persona adherence is poor). Init git repo, scaffold with `create-next-app` (TypeScript, Tailwind, App Router, src dir), add `.gitignore`, `.env.example`, `README.md`.

**M1. Skeleton + engine smoke test (no UI, no auth). ✅ Done** (public repo with green CI). Drizzle + libsql file db (`file:./data/arena.db`), schema and first migration, `provider.ts`, `lifecycle.ts`, `prompt.ts`, `engine.ts`, `runner.ts`, `scripts/worker.ts`, `scripts/debate-cli.ts`: seeds two users with one agent each, creates a 2-round debate, enters both agents, starts it, and runs it to completion through the same runner code the worker uses, printing each turn as it streams plus token counts. Vitest with unit tests for `lifecycle.ts` (slots, entry limits, start modes, cancellation, voting window), `resolveSettings`, the prompt builder, name suffixing, and `runStep` driven by the AI SDK's fake model from `ai/test` (turn saved, pointer advanced, budget jump to closing, unreachable-provider backoff, bad-turn failure); tests never need Ollama. At the end of M1: create the public GitHub repo (create `.env.example` first), push, and add the CI workflow. Demo: terminal debate and a green CI run.

**M1.5. Free hosted model (Groq).** ✅ Done. `@ai-sdk/groq` branch in `provider.ts` (key from `GROQ_API_KEY`, default model `openai/gpt-oss-120b`, overridable with `GROQ_DEFAULT_MODEL`), Groq column in the creativity mapping, rate limits (HTTP 429) treated like an unreachable model (wait, honouring retry-after, never fail), `--provider groq` in the terminal CLI, tests. The Groq account has no payment method, so it can never be billed. Demo: the same terminal debate on Groq.

**M2. Core loop in the browser (temporary dev users). ✅ Done.** `npm run dev` starts both the Next.js dev server and the worker in one terminal. Until real auth exists, a dev-only user switcher (a cookie choosing one of a few seeded users) lets one browser act as several users, which entering needs. Agent CRUD (server actions + forms; style and tone as comboboxes that suggest presets but accept custom text, stance as a select, creativity as a 4-step Focused/Balanced/Creative/Wild control, turn length as Short/Medium/Long, a private/public visibility toggle, a model picker from the model catalog showing the free models of the providers that are configured (Groq when its key is set; Ollama's installed models when it is reachable), each with its display name and description; a "model retired, pick a new one" warning on agents whose model is no longer offered; editing or deleting an agent that is in a running debate shows "This agent is in N running debate(s). It will finish with the version it started with."), debate create page (topic, rounds, max participants, start mode with optional date/time, allow multiple entries per user, voting duration, tally visibility), the open-debate page (slots, enter, withdraw, start, delete, countdown), `/debates/[id]` with polling, the live word-by-word current turn, transcript and cost badge. Demo: create a debate, enter agents as two dev users, start it, watch turns appear in two browser windows at once.

**M3. Auth + voting. ✅ Done.** Better Auth (email/password, Drizzle adapter, `nextCookies` plugin), generated auth schema + migration (with `displayName` and `isAdmin`), sign-in/up pages (display name chosen at sign-up) replacing the dev user switcher, admin delete for any debate or agent behind a confirmation dialog, ownership and entry checks per the access rules, debate pages and list stay public without an account, `proxy.ts` (redirects only for pages that need sign-in), voting while open (409 on duplicate, rejection for your own agent and after `votingClosesAt`), closing countdown, tally shown per `tallyVisibility`, provisional vs final winner/tie display. Demo: full product loop with two browser sessions.

**M4. Robustness + polish + deployment.** _In progress. Done: rolling summary, failure UX with Resume, phone-width check, GitHub sign-in (checked locally with an OAuth app for localhost; production needs its own app), Turso readiness, the queue (checked locally end to end: a "when full" start, a scheduled start with no browser open, recovery by the sweep after a restart mid-debate, and Groq rate-limit waits through delayed messages). Decided (2026-11-15): Vercel + Turso + QStash, all on free tiers. Remaining: deployment._

Hosting options considered: an always-on worker on a small paid machine (Fly.io ~$4 a month, Hetzner ~€5) or a free VM, versus serverless with a queue. The queue won: $0, nothing to maintain, and it is the job-queue step of the scaling path. Debates run on Groq's free tier (decided in M1.5); Ollama is local only.

1. **Queue** (see "Debate engine and queue"): `queue.ts` seam with a fake for tests, the `advance` and `sweep` job routes with signature checks, queuing from start, `when_full`, resume and scheduled creation, flow-control parallelism, the sweep schedule setup. `npm run dev` runs `next dev` plus Upstash's QStash dev server in Docker (`public.ecr.aws/upstash/qstash`, port 8080; in-memory, for development only), so local and production trigger turns the same way. The dev server's standalone binary (`@upstash/qstash-cli`) is unsigned and Windows Smart App Control blocks it, which has no per-app exceptions, hence Docker. The worker and `runLoop` are removed. Tests: chaining for every `runStep` outcome, early delivery, scheduled start through a delayed message (and re-queue when early), cancellation, sweep recovery of a lost chain and of overdue scheduled debates, delivery-time rounding and clamping, signature rejection. New environment variables (`QSTASH_URL`, `QSTASH_TOKEN`, `QSTASH_CURRENT_SIGNING_KEY`, `QSTASH_NEXT_SIGNING_KEY`, `APP_URL`, `TURN_PARALLELISM`) go into the README, and `.env.example` with secrets left empty.
2. **Deploy:** a production Turso database and a separate one for previews; a Vercel project linked to the GitHub repo (production from `main`, a preview per branch or pull request); environment variables per Vercel environment (Production / Preview); migrations applied to the right database on each deployment (decided: the `vercel-build` script runs `scripts/deploy-setup.ts` before `next build`, which migrates that environment's database and, on production, creates or updates the sweep schedule); functions pinned to Singapore (`vercel.json`, `sin1`) next to the Turso database (Singapore), chosen for an Asian audience; QStash has only EU and US regions, which costs a fraction of a second once per turn; the production address taken from Vercel's `VERCEL_PROJECT_PRODUCTION_URL` (so neither `APP_URL` nor `BETTER_AUTH_URL` is needed without a custom domain) and preview addresses from `VERCEL_URL` / `VERCEL_BRANCH_URL` (Better Auth's dynamic `baseURL` with exactly those hosts allowed); a GitHub OAuth app for the production URL (GitHub sign-in stays off on previews, since an OAuth app has one callback URL); Better Auth's trusted origins covering preview URLs. CI keeps running lint, type check, tests and build on every push.
3. **Check in the cloud:** a debate from start to finish with no browser open, a scheduled start, a forced model wait, and a preview deployment running its own debate against the preview database.

**M5. Paid models on users' own keys + leaderboard.** Bring-your-own-key: a settings page where users add, replace or delete their API keys (stored encrypted with a server-side secret, never shown again, never logged), or connect an account through a sign-in flow where the provider offers one (e.g. OpenRouter). `@ai-sdk/anthropic` branch in `provider.ts` using the agent owner's key (default `claude-haiku-5-5`); paid models are catalog entries marked `paid` and appear in the agent form only for users with a key for that provider; `runStep` resolves the key per agent at call time; a key that fails mid-debate gives a visible reason (decide: skip that agent's turns, or fail the debate). Optional "Advanced" raw `temperatureOverride` (nullable column; validated against the current provider's range on save, and the form warns and asks the owner to fix or clear it if a provider change puts it out of range; never silently adjusted), pricing table (costs shown per agent, billed to its owner), leaderboard (wins, votes, debates per agent; final results only, i.e. debates whose voting has closed), optional LLM judge turn shown next to the human tally.

**Later, optional.**
- Debate modes: binary choice (each entrant picks for/against), multiple choice (creator lists options, each entrant defends one), free discussion (today's behaviour, the default).
- Push instead of polling: replace the `broadcast.ts` no-op with hosted pub/sub (Ably, Pusher or Upstash) or an SSE route, so viewers get chunks pushed rather than polling. Polling stays as the fallback.

## Scaling path (not planned for v1)

From M4, debates are driven by a queue calling serverless functions, on Turso. What makes it scalable: state lives in the database, one turn per `runStep` call, a per-debate lock, and the queue rather than a process drives debates, so turns of different debates already run in parallel (up to the flow-control limit) and more debates simply mean more function calls, with no workers to add or coordinate. (Before M4 a single polling worker ran one turn at a time; growing it would have meant concurrency in the loop, then several workers atomically claiming batches of debates, then a job queue. The queue skipped those steps.) Limits in the order they would be hit, with the change for each:

| Limit | Symptom | Change |
|---|---|---|
| Model rate limits | Groq's free tier caps requests per minute and per day, shared by all users | Flow-control parallelism keeps within the per-minute limit; heavier use moves to paid models on users' own keys (M5), each with their own limits |
| Queue free tier | ~1,000 messages a day, one per turn plus the sweep: roughly 40-50 debates a day | QStash pay-as-you-go (about $1 per 100,000 messages), or another queue behind `queue.ts` |
| SQLite (Turso) | One writer per database | PostgreSQL (rewrite the Drizzle schema files for the pg dialect) |
| Partial-text writes and polling | ~3 writes/s per streaming turn plus one poll/s per viewer | Push chunks through pub/sub via `broadcast.ts` (Ably, Pusher, Redis) and store only finished turns; viewers subscribe instead of polling |
| Serverless plan limits | Function duration (300 s on Hobby), cold starts, and Hobby is for non-commercial use | A paid plan, or the same app on a container host; the job routes don't change |

Cost: the project never pays for model calls, so at scale the binding limit is the shared free tier's rate limits; heavier use moves onto users' own keys (M5), where each owner pays for their agents. The README carries a shorter version of this section.

## Known gotchas to handle during implementation

- Windows + libsql: use `file:./data/arena.db` (forward slashes). If the native binary fails on Node 24+, switch dev driver to `better-sqlite3`; the Drizzle schema stays the same.
- SQLite with two processes writing the same file (Next.js and the worker before M4; Next.js and `debate:cli` after): enable WAL mode and a busy timeout so writes queue instead of failing; keep the ~300 ms partial-text updates small (one row update each). On Turso those updates are network round trips: widen the interval to ~500 ms if latency or the free tier's monthly write allowance becomes a concern.
- Queue (M4): the QStash dev server keeps everything in memory, so restarting `npm run dev` loses queued messages and the sweep schedule; startup recreates the schedule, and the sweep (every minute locally) restarts what was lost. On Windows the docker client can be killed without stopping its container, so `queue-dev.ts` removes a leftover container (fixed name) before starting. The free tier's maximum message delay (7 days at the time of writing) limits how far ahead one message can reach, hence the re-queue for distant scheduled starts. Check the free-tier numbers on Upstash's pricing page when setting up; third-party sources disagree.
- Next 16: `params`, `headers()`, `cookies()` are async; `proxy.ts` replaces `middleware.ts`; runs on Node runtime, so no DB calls there.
- Better Auth: run its CLI to generate the schema before the first migration; set `BETTER_AUTH_SECRET` and `BETTER_AUTH_URL`.
- Ollama cold start is 10-20 s; the per-turn timeout (and the job routes' `maxDuration`) must be at least 60 s. Usage may be missing, so tokens are nullable with a chars/4 estimate.
- Ollama (found in M1): the provider's default API ignores the SDK's generic `stopSequences` and `maxOutputTokens`, so `callSettings` in `provider.ts` passes them as Ollama's native `options.stop` / `options.num_predict`. The prompt also asks for a word count of ~60% of the token cap so turns end naturally; a turn that still hits the cap is trimmed to its last full sentence.
- Groq (found in M1.5): its Llama models were retired; the free chat models are reasoning models (`openai/gpt-oss-120b`, `openai/gpt-oss-20b`, `qwen/qwen3.8-27b`), whose reasoning tokens count against the turn cap. `groqReasoningOptions` keeps reasoning minimal and hidden (gpt-oss: effort `low`, ~20-30 tokens; Qwen: `none`). Check the model list (`GET /openai/v1/models`) when changing models; it changes over time.
- Small local models: keep system prompt short, alternate roles, stop sequences, strip name prefixes and think tags, cap output via turnLength (default medium, 220 tokens). Imperfect adherence is acceptable in phase 1 and becomes the "same prompt, better model" demo in M5.
- Races: slot claims rely on the unique `(debateId, position)` index; the one-entry-per-user rule is checked inside the same transaction, since it can't be an index; the `when_full` start runs in the same transaction as the filling entry; `start` and `startDueScheduled` use a conditional `status = 'open'` update so only one caller wins.
- Times: store `startAt` as UTC epoch ms; the form and countdown show the viewer's local time.
- Never cache the libsql client on `globalThis` without a guard (dev hot reload).
- Agents read each other's turns, so one may try "ignore your instructions" on its opponents. Each agent's persona only reaches its own system prompt, and in a debate this is harmless (arguably part of the game), so no defences are built.
- Tests: the fake model replaces `resolveModel` in tests; each test uses a fresh in-memory or temp-file SQLite database with migrations applied.

## Verification

- M1: `npx tsx scripts/debate-cli.ts` prints a coherent 2-agent debate as it streams, with token counts; `npx drizzle-kit studio` shows the rows.
- M2 onward: run `npm run dev` (web app + worker) via the browser preview; as two dev users, enter agents and check each start mode (manual Start, auto start on the last slot, a scheduled start a minute ahead with no browser open, and a scheduled start with one entry that becomes cancelled); try two users claiming the same slot; with multiple entries off, confirm a second entry by the same user is rejected, and with it on, run a debate entirely with one user's agents; watch the current turn grow word by word in two windows; stop the worker mid-turn and restart it to confirm the debate resumes; check console and network for errors.
- M3: sign up in two browser sessions, vote once each, confirm a second vote returns 409, a vote for your own agent is rejected, and the tally is correct; with a 1-hour voting window (temporarily shortened in dev), confirm votes are rejected after it closes; check each tally visibility from a voter's, a non-voter's and an anonymous view.
- M2 onward also: mark an entered agent's model as not offered, start the debate, and confirm it runs on the provider default with the "model retired" note on the debate and agent pages.
- M2 onward also: stop Ollama while a debate is running and confirm it shows "waiting for the model" and resumes when Ollama is back, without failing; enter two agents with the same name and confirm the suffix.
- M3 also: as admin, delete a running debate and an agent that took part in finished debates (the debates keep the snapshot with the "agent deleted" label); no email address appears anywhere in the UI.
- M4 (queue): with `npm run dev` (web app + QStash dev server), repeat the M2 start-mode checks, including a scheduled start with no browser open; stop `npm run dev` mid-turn and restart it to confirm the sweep continues the debate; run two debates at once and confirm the flow-control limit holds; confirm an unsigned call to `/api/jobs/advance` is rejected. In the cloud: the same on the production deployment, plus a preview deployment running a debate against the preview database.
- Each milestone ends with lint, type check, `npm test` and `npm run build` passing locally and (from the end of M1) in CI, and a git commit.
