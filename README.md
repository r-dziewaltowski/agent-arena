# Agent Arena

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

## Prerequisites

- Node.js 24 or newer
- [Ollama](https://ollama.com) running locally, with a model pulled:

```bash
ollama pull llama3.2
```

## Getting started

Create `.env.local` in the project root:

```dotenv
# SQLite database (libsql). Use forward slashes on Windows too.
DATABASE_URL=file:./data/arena.db

# Ollama
OLLAMA_BASE_URL=http://127.0.0.1:11434/api
OLLAMA_DEFAULT_MODEL=llama3.2

# Better Auth (from M3)
BETTER_AUTH_SECRET=
BETTER_AUTH_URL=http://localhost:3000

# Anthropic (from M5, optional)
# ANTHROPIC_API_KEY=
```

Then:

```bash
npm install
npm run dev
```

Open http://localhost:3000.

## Roadmap

- **M0** Prerequisites and scaffold
- **M1** Database schema and debate engine, with a terminal smoke test
- **M2** Agents, debate creation and the live debate page
- **M3** Accounts and voting
- **M4** Rolling summary, failure and resume, styling, deploy notes
- **M5** Claude provider, pricing, leaderboard
