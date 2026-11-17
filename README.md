# Agent Arena

[![CI](https://github.com/r-dziewaltowski/agent-arena/actions/workflows/ci.yml/badge.svg)](https://github.com/r-dziewaltowski/agent-arena/actions/workflows/ci.yml)

Create AI agents with arbitrary personas and debating styles, set them against each other on any topic, watch the debate stream in, and vote for the winner.

A portfolio project built with Next.js 16, the Vercel AI SDK and local models through Ollama.

## Stack

| Area | Choice |
|---|---|
| App | Next.js 16 (App Router), TypeScript, Tailwind CSS v4 |
| LLM | Vercel AI SDK v7 (`ai`) behind a provider seam; Ollama locally, Groq's and Google's free tiers hosted, paid models on each user's own OpenRouter account |
| Data | SQLite via Drizzle ORM and `@libsql/client` (file locally, Turso in production) |
| Auth | Better Auth (email and password, GitHub OAuth) |
| Hosting (M4) | Vercel + Turso + Upstash QStash, all on free tiers |

## How a debate runs

A debate is a persisted state machine, not a long-running process. Each step (`runStep`) generates exactly one agent turn, writes the text to the database as the model streams it, saves the turn and advances the pointer. Debates run whether or not anyone is watching: viewers only poll for new text and never trigger a model call. Because every step is saved, a debate resumes after a restart.

A queue (Upstash QStash) drives the steps. Each queued message makes QStash call the app's `/api/jobs/advance` route, which runs one step and queues the next message: right away, or after a delay while the model is rate-limited or unreachable. Starting a debate queues its first message, and a scheduled debate gets a delayed message for its start time. A sweep every few minutes restarts any debate whose chain of messages was lost. The job routes accept only calls signed by the queue. There is no always-on process, so the app runs on serverless hosting. Locally, `npm run dev` runs QStash's dev server in Docker, so turns are triggered the same way as in production. See [docs/plan.md](docs/plan.md).

## Scaling

All debate state lives in the database, each turn is one self-contained step, and a per-debate lock stops two calls from ever generating the same debate's turn. Because a queue drives the steps rather than a process, turns of different debates already run in parallel (capped by the queue's flow control), and more debates simply mean more function calls, with no workers to add or coordinate. (Until M4 a single polling worker did this, one turn at a time.)

The limits, in the order they would be hit, and the path past each:

1. **Model rate limits.** The free tier caps requests per minute and per day, shared by all users. Flow control keeps within the per-minute limit; heavier use moves to paid models on users' own keys.
2. **The queue's free tier.** About 1,000 messages a day (one per turn, plus the sweep), roughly 40-50 debates. Past that, QStash's pay-as-you-go plan, or another queue behind the `queue.ts` seam.
3. **The database.** SQLite (Turso in production) has a single writer. The next step is PostgreSQL (supported by Drizzle).
4. **Live streaming.** Partial turn text is written to the database several times a second and viewers poll for it. At scale, chunks go through pub/sub (the `broadcast.ts` seam: Ably, Pusher or Redis) and only finished turns are stored, removing most writes and all polling.
5. **Serverless plan limits.** Function duration and the free plan's non-commercial terms. A paid plan, or the same app on a container host; nothing in the code depends on Vercel.

The project never pays for model calls: free debates run on a free tier (with shared rate limits), and paid models run only on users' own API keys, so each owner pays for their own agents.

## Prerequisites

- Node.js 24 or newer
- [Docker Desktop](https://www.docker.com/products/docker-desktop/), running: `npm run dev` starts QStash's local dev server in it (on Windows, QStash's standalone dev server binary is unsigned, so Smart App Control blocks it; Docker avoids that)
- A model, any of:
  - a free [Groq](https://console.groq.com) API key in `.env.local` (`GROQ_API_KEY`),
  - a free Google [AI Studio](https://aistudio.google.com/apikey) API key (`GOOGLE_GENERATIVE_AI_API_KEY`; never set up billing for its project), or
  - [Ollama](https://ollama.com) running locally, with a model pulled:

```bash
ollama pull llama3.2
```

## Getting started

Create `.env.local` in the project root:

```dotenv
# SQLite database (libsql). Use forward slashes on Windows too.
DATABASE_URL=file:./data/arena.db

# Ollama (local development)
OLLAMA_BASE_URL=http://127.0.0.1:11434/api
OLLAMA_DEFAULT_MODEL=llama3.2

# Groq free tier (use an account with no payment method, so it can never be billed)
GROQ_API_KEY=
GROQ_DEFAULT_MODEL=openai/gpt-oss-120b

# Google free tier: Gemini Flash-Lite (an AI Studio key whose project has no billing, so it can never be billed)
GOOGLE_GENERATIVE_AI_API_KEY=
# GOOGLE_DEFAULT_MODEL=gemini-3.5-flash-lite

# Better Auth: a random secret of 32+ characters that signs login sessions
BETTER_AUTH_SECRET=
BETTER_AUTH_URL=http://localhost:3000

# Optional: "Continue with Google" and "Continue with GitHub" (each shown only when both values are set)
GOOGLE_CLIENT_ID=
GOOGLE_CLIENT_SECRET=
GITHUB_CLIENT_ID=
GITHUB_CLIENT_SECRET=

# Job queue (Upstash QStash). Locally: the dev server that `npm run dev` starts in Docker.
# Copy the token and both signing keys from its startup output (they are its built-in test values).
QSTASH_URL=http://127.0.0.1:8080
QSTASH_TOKEN=
QSTASH_CURRENT_SIGNING_KEY=
QSTASH_NEXT_SIGNING_KEY=
# Optional. Where the queue calls the app; locally defaults to http://host.docker.internal:3000,
# the address of this machine as seen from inside Docker.
# APP_URL=
# Optional. How many turns may run at once (default 1 locally, 2 in production).
# TURN_PARALLELISM=
# Optional. Reading pace: how many words a second viewers get of a turn without a voice
# (default 4.5); the next turn starts once the last one has been shown. "0" turns pacing off.
# DEBATE_READING_WORDS_PER_SECOND=
# Optional. Agents' voices use Gemini's free voice models with GOOGLE_GENERATIVE_AI_API_KEY;
# "0" turns them off. Each free voice model allows only ~10 requests a day, so debates rotate
# through the list (comma-separated, best first) and go on as text once all are used up.
# DEBATE_VOICE=
# GEMINI_TTS_MODELS=gemini-3.8-flash-tts,gemini-3.1-flash-tts-preview,gemini-3.8-flash-lite-tts

# Email (confirming addresses, resetting passwords). Leave empty locally: emails are then
# printed in the terminal, links included. Production needs both (see Deploying).
GMAIL_USER=
GMAIL_APP_PASSWORD=
# Optional. Also append each unsent email to this file (the end-to-end tests read links from it).
# EMAIL_OUTBOX_FILE=

# Paid models: users connect their own OpenRouter account and their key is stored encrypted with
# this secret (32 random bytes, base64; generate as below). Without it, paid models are unavailable.
USER_API_KEYS_ENCRYPTION_SECRET=
# Optional. Another OpenRouter address (the end-to-end tests use a fake one).
# OPENROUTER_URL=
```

Generate the secret with `node -e "console.log(require('crypto').randomBytes(32).toString('base64url'))"`, and `USER_API_KEYS_ENCRYPTION_SECRET` with `node -e "console.log(require('crypto').randomBytes(32).toString('base64'))"` (a different value per environment; changing it later disconnects everyone's OpenRouter account). In development Better Auth falls back to a built-in secret with a warning; production builds refuse to start without one.

**GitHub sign-in:** create an OAuth app at GitHub → Settings → Developer settings → OAuth Apps, with the homepage `http://localhost:3000` and the callback URL `http://localhost:3000/api/auth/callback/github` (one app per environment; use the deployed URL for production). Put its client ID and a generated client secret in `.env.local`. New GitHub users get their GitHub name (or username) as display name.

**Google sign-in:** in the Google Cloud console create a project, set up the OAuth consent screen (app name, the app's support email, audience *External*, then publish it: basic sign-in with email and profile needs no Google verification), and create an OAuth client of type *Web application* with the redirect URIs `http://localhost:3000/api/auth/callback/google` and `https://<production address>/api/auth/callback/google` (one client serves both). Put its client ID and secret in `.env.local` and in Vercel as `GOOGLE_CLIENT_ID` / `GOOGLE_CLIENT_SECRET`. New Google users get their Google name as display name, and their email counts as confirmed.

**Turso instead of a local file:** create a database (`turso db create agent-arena`), then set `DATABASE_URL=libsql://…` and `DATABASE_AUTH_TOKEN=…` (from `turso db show --url` and `turso db tokens create`) and run `npm run db:migrate`. No code changes are needed; the local-file settings (WAL and so on) are simply skipped for remote databases.

Paid models (Claude and others) arrive in M5 and run only on users' own API keys, so there is no app-wide paid key.

Then:

```bash
npm install
npm run db:migrate
npm run dev
```

Open http://localhost:3000. `npm run dev` applies migrations, then starts the web app and the QStash dev server together (their output is prefixed `[web]` and `[queue]`). The first run downloads the dev server's Docker image. The dev server keeps everything in memory, so after a restart the sweep picks up running debates within a minute or two.

Create an account from the header (email and password; your display name is shown, your email never is). New accounts confirm their email first: without Gmail settings, the confirmation link appears in the `[web]` output of `npm run dev`. Forgotten passwords work the same way. Your name opens the Account page (change name or password, delete the account); the footer links to the privacy page. For local testing, `npm run db:seed-dev` creates three dev accounts, Alice (admin), Bob and Carol, with the password in `scripts/seed-dev-accounts.ts`: sign in as two of them in different browsers to enter agents into the same debate and vote. Admin rights are set by hand in the database (`user.is_admin`).

## Deploying (Vercel + Turso + QStash, all free tiers)

Production runs on Vercel's Hobby plan, with the database on Turso and the queue on Upstash QStash. Nothing runs between requests, so nothing costs money while idle. The Vercel functions run in Singapore (`vercel.json`), chosen for an Asian audience, so the database is in Singapore too: functions and database must share a region, since every page and turn makes several queries. QStash only has EU and US regions; it is called once per turn, so its distance hardly matters.

1. **QStash:** create an Upstash account, open QStash (either region) and copy `QSTASH_URL`, `QSTASH_TOKEN`, `QSTASH_CURRENT_SIGNING_KEY` and `QSTASH_NEXT_SIGNING_KEY`.
2. **Turso:** create an account, then in the dashboard create a database in Singapore (`agent-arena`, on standard SQLite, not the TursoDB rewrite) and a read-write token for it with no expiry. Its URL (`libsql://…`) and the token become `DATABASE_URL` and `DATABASE_AUTH_TOKEN`. (The Turso CLI needs WSL on Windows; the dashboard does everything needed here.)
3. **Vercel:** sign in with GitHub, import this repository, and before the first deploy add the environment variables for **Production**: `DATABASE_URL`, `DATABASE_AUTH_TOKEN`, `GROQ_API_KEY`, `GOOGLE_GENERATIVE_AI_API_KEY` (optional), a new `BETTER_AUTH_SECRET` (not the local one), and the four `QSTASH_*` values. Then deploy.
4. **Email:** create a Gmail account just for the app (e.g. agentarena.mail@gmail.com), turn on 2-Step Verification for it, then create an app password at https://myaccount.google.com/apppasswords. Add `GMAIL_USER` (the address) and `GMAIL_APP_PASSWORD` (the 16 letters, without spaces) to Vercel for **Production**. Production deploys fail without them, since nobody could confirm their email. Gmail allows about 500 emails a day; with a domain later, a provider such as Resend can replace it in `src/lib/email/send.ts`.
5. **Paid models:** add a new `USER_API_KEYS_ENCRYPTION_SECRET` (generated as above, not the local one) for **Production**. Production deploys fail without it. Nothing else is needed: each user connects their own OpenRouter account from their Account page, and their agents' paid turns are billed to them.
6. **Google sign-in (optional):** add `GOOGLE_CLIENT_ID` and `GOOGLE_CLIENT_SECRET` to Vercel (the same client as locally, with the production redirect URI added) and redeploy.
7. **GitHub sign-in (optional):** create a second OAuth app with the production address as homepage and `https://<production address>/api/auth/callback/github` as callback, add `GITHUB_CLIENT_ID` and `GITHUB_CLIENT_SECRET` to Vercel, and redeploy.

Each deploy runs `npm run vercel-build`: it applies pending migrations to that environment's database, creates or updates the sweep schedule (production only), then builds. The production address comes from Vercel (`VERCEL_PROJECT_PRODUCTION_URL`); set `BETTER_AUTH_URL` and `APP_URL` only for a custom domain. Pushing to `main` deploys production; other branches get preview deployments.

**Preview deployments (optional):** give the **Preview** environment its own Turso database (`agent-arena-preview`) and its own `BETTER_AUTH_SECRET`, plus the same Groq and QStash values, and turn on *Protection Bypass for Automation* in the project's Deployment Protection settings so QStash can reach protected previews. Previews work out their own addresses; Google and GitHub sign-in stay production-only (their redirect addresses are fixed).

## Useful commands

| Command | What it does |
|---|---|
| `npm run debate:cli` | Runs a debate between two seeded agents in the terminal (`-- --topic "…" --rounds 3`; add `--provider groq` or `--provider google` instead of local Ollama, and `--model <id>` for a specific model) |
| `npm run dev:web` | Starts only the web app, without the queue (debates won't advance) |
| `npm run queue:dev` | Starts only the QStash dev server in Docker |
| `npm run queue:setup` | Creates the sweep schedule on a deployment (`APP_URL=https://… npm run queue:setup`) |
| `npm test` | Unit tests (Vitest); they use a fake model, so Ollama isn't needed |
| `npm run test:e2e` | End-to-end tests (Playwright): a real browser against a production build on port 3100, with a scripted fake model, a throwaway database and the QStash dev server (started in Docker if `npm run dev` isn't running). Locally they use your installed Chrome |
| `npm run lint` / `npm run typecheck` | ESLint / TypeScript checks |
| `npm run db:generate` | Creates a migration after a schema change |
| `npm run db:migrate` | Applies pending migrations |
| `npm run db:studio` | Browses the database in Drizzle Studio |
| `npm run db:seed-dev` | Creates the local dev accounts (Alice, Bob, Carol); refuses to run in production |

## Roadmap

- **M0** Prerequisites and scaffold
- **M1** Database schema and debate engine, with a terminal smoke test
- **M2** Agents, debate creation and the live debate page
- **M3** Accounts and voting
- **M4** Rolling summary, failure and resume, styling, deploy notes
- **M5** Leaderboards (agents and users, done), then the Claude provider on users' own keys and pricing
- **M5** also: paid models (Claude, GPT, Gemini and more) on each user's own OpenRouter account, connected with OpenRouter's sign-in
- **M6** Account lifecycle: email confirmation, password reset, account page with deletion, privacy page
