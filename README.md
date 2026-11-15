# Agent Arena

[![CI](https://github.com/r-dziewaltowski/agent-arena/actions/workflows/ci.yml/badge.svg)](https://github.com/r-dziewaltowski/agent-arena/actions/workflows/ci.yml)

Create AI agents with arbitrary personas and debating styles, set them against each other on any topic, watch the debate stream in, and vote for the winner.

A portfolio project built with Next.js 16, the Vercel AI SDK and local models through Ollama.

## Stack

| Area | Choice |
|---|---|
| App | Next.js 16 (App Router), TypeScript, Tailwind CSS v4 |
| LLM | Vercel AI SDK v7 (`ai`) behind a provider seam; Ollama locally, Claude later |
| Data | SQLite via Drizzle ORM and `@libsql/client` (file locally, Turso later) |
| Auth | Better Auth (email and password, GitHub OAuth later) |

## How a debate runs

A debate is a persisted state machine, not a long-running process. The browser drives it: `POST /api/debates/[id]/step` generates exactly one agent turn, streams it back, saves it and advances the pointer. The page repeats that while the debate is running, and observers poll for new turns. That makes a debate resumable after a restart, a closed tab or a serverless timeout.

## Scaling

v1 runs one worker that generates one turn at a time, with SQLite as the database. That fits a small deployment and a single local model. The design is built so it can grow without changing the engine: all debate state lives in the database, each turn is one self-contained step, and a per-debate lock stops two workers from ever generating the same debate's turn.

The limits, in the order they would be hit, and the path past each:

1. **Model capacity.** A local model generates one reply at a time (about 8 s per turn), so one machine serves tens of debates an hour, not thousands. Moving to a hosted model lets one worker run many turns **concurrently**, bounded by the provider's rate limits and cost.
2. **More workers.** The same worker can run on several machines; each would atomically **claim** a batch of ready debates instead of competing for locks.
3. **The database.** SQLite has a single writer and can't be shared between machines. The next step is Turso (hosted libSQL, minimal code change), then PostgreSQL (supported by Drizzle).
4. **Live streaming.** Partial turn text is written to the database several times a second and viewers poll for it. At scale, chunks go through pub/sub (the `broadcast.ts` seam: Ably, Pusher or Redis) and only finished turns are stored, removing most writes and all polling.
5. **A job queue.** Eventually each turn becomes a job that queues the next one, and scheduled starts become delayed jobs (BullMQ, SQS or a hosted job service), which gives retries, backoff and distribution across workers.

The project never pays for model calls: free debates run on a free tier (with shared rate limits), and paid models run only on users' own API keys, so each owner pays for their own agents.

## Prerequisites

- Node.js 24 or newer
- A model, either or both of:
  - a free [Groq](https://console.groq.com) API key in `.env.local` (`GROQ_API_KEY`), or
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

# Better Auth (from M3)
BETTER_AUTH_SECRET=
BETTER_AUTH_URL=http://localhost:3000
```

Paid models (Claude and others) arrive in M5 and run only on users' own API keys, so there is no app-wide paid key.

Then:

```bash
npm install
npm run db:migrate
npm run dev
```

Open http://localhost:3000.

## Useful commands

| Command | What it does |
|---|---|
| `npm run debate:cli` | Runs a debate between two seeded agents in the terminal (`-- --topic "…" --rounds 3`; add `--provider groq` to use Groq instead of local Ollama) |
| `npm run worker` | Starts the worker that starts scheduled debates and generates turns |
| `npm test` | Unit tests (Vitest); they use a fake model, so Ollama isn't needed |
| `npm run lint` / `npm run typecheck` | ESLint / TypeScript checks |
| `npm run db:generate` | Creates a migration after a schema change |
| `npm run db:migrate` | Applies pending migrations |
| `npm run db:studio` | Browses the database in Drizzle Studio |

## Roadmap

- **M0** Prerequisites and scaffold
- **M1** Database schema and debate engine, with a terminal smoke test
- **M2** Agents, debate creation and the live debate page
- **M3** Accounts and voting
- **M4** Rolling summary, failure and resume, styling, deploy notes
- **M5** Claude provider, pricing, leaderboard
