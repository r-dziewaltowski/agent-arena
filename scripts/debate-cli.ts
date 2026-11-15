/**
 * Terminal smoke test of the engine against the real model: seeds two dev users with one agent
 * each, creates a debate, enters both agents, starts it and runs it to completion, printing each
 * turn as it streams.
 *
 *   npm run debate:cli -- --topic "Should city centres ban private cars?" --rounds 2
 *   npm run debate:cli -- --provider groq            (needs GROQ_API_KEY in .env.local)
 *   npm run debate:cli -- --provider groq --model llama-3.1-8b-instant
 */
import "./load-env";
import { eq } from "drizzle-orm";
import { defaultModelFor, type Provider } from "../src/lib/ai/provider";
import { openDb, type Db } from "../src/lib/db/client";
import { runMigrations } from "../src/lib/db/migrate";
import { agents, debates, turns, user } from "../src/lib/db/schema";
import { runStep } from "../src/lib/debate/engine";
import { createDebate, enter, startDebate } from "../src/lib/debate/lifecycle";
import { setTimeout as sleep } from "node:timers/promises";

function arg(name: string, fallback: string): string {
  const i = process.argv.indexOf(`--${name}`);
  return i >= 0 && process.argv[i + 1] ? process.argv[i + 1] : fallback;
}

const topic = arg("topic", "Should city centres ban private cars?");
const rounds = Number(arg("rounds", "2"));
const provider = arg("provider", "ollama") as Provider;
if (!["ollama", "groq"].includes(provider)) {
  console.error(`Unknown --provider "${provider}". Use ollama or groq.`);
  process.exit(1);
}
const model = arg("model", defaultModelFor(provider));

const DEV_USERS = [
  // Same ids as the web app's dev users (src/lib/auth/dev-users.ts); Alice is the admin there too.
  { id: "dev-user-alice", name: "Alice", email: "alice@example.test", isAdmin: true },
  { id: "dev-user-bob", name: "Bob", email: "bob@example.test", isAdmin: false },
];

const DEV_AGENTS = [
  {
    id: "dev-agent-ada",
    ownerId: "dev-user-alice",
    name: "Ada",
    persona:
      "An urban planner with twenty years of experience redesigning European city centres. Believes streets should be built for people, not cars, and backs claims with data from cities that have tried it.",
    style: "analytical",
    tone: "formal",
    stance: "contrarian",
  },
  {
    id: "dev-agent-bram",
    ownerId: "dev-user-bob",
    name: "Bram",
    persona:
      "A retired taxi driver who now runs a small hardware shop. Distrusts top-down planning and worries that car bans hurt workers, older people and small shopkeepers.",
    style: "storyteller",
    tone: "dry",
    stance: "contrarian",
  },
];

async function seed(db: Db) {
  const now = Date.now();
  for (const u of DEV_USERS) {
    await db
      .insert(user)
      .values({ ...u, displayName: u.name })
      .onConflictDoNothing();
  }
  for (const a of DEV_AGENTS) {
    const values = {
      ...a,
      provider,
      modelId: model,
      creativity: "balanced" as const,
      turnLength: "medium" as const,
      createdAt: now,
      updatedAt: now,
    };
    await db
      .insert(agents)
      .values(values)
      .onConflictDoUpdate({ target: agents.id, set: { ...values, createdAt: undefined } });
  }
}

async function main() {
  const { db, client } = await openDb();
  await runMigrations(db);
  await seed(db);

  const debateId = await createDebate(db, "dev-user-alice", {
    topic,
    rounds,
    maxParticipants: 2,
    startMode: "manual",
  });
  await enter(db, { debateId, userId: "dev-user-alice", agentId: "dev-agent-ada", position: 1 });
  await enter(db, { debateId, userId: "dev-user-bob", agentId: "dev-agent-bram", position: 2 });
  await startDebate(db, { debateId, userId: "dev-user-alice" });

  const [started] = await db.select().from(debates).where(eq(debates.id, debateId));
  console.log(`\nDebate ${debateId}`);
  console.log(`Topic: ${topic}`);
  console.log(`Model: ${provider}/${model} · ${rounds} rounds · token budget ${started.maxTotalTokens}\n`);

  for (;;) {
    const outcome = await runStep(db, debateId, {
      onTurnStart: ({ speaker, round, rounds: total, kind }) =>
        process.stdout.write(`── Round ${round}/${total} · ${kind} · ${speaker} ──\n`),
      onDelta: (delta) => process.stdout.write(delta),
    });

    if (outcome.kind === "turn") {
      const [turn] = await db.select().from(turns).where(eq(turns.id, outcome.turnId));
      console.log(
        `\n   [${turn.promptTokens} prompt + ${turn.completionTokens} completion tokens · ${((turn.latencyMs ?? 0) / 1000).toFixed(1)} s · ${turn.finishReason}]\n`,
      );
      if (outcome.debateCompleted) break;
    } else if (outcome.kind === "waiting") {
      const wait = Math.round((outcome.nextAttemptAt - Date.now()) / 1000);
      console.log(`\n   Model unavailable (${outcome.error}). Retrying in ${wait} s…`);
      await sleep(Math.max(0, outcome.nextAttemptAt - Date.now()));
    } else if (outcome.kind === "retrying") {
      console.log(`\n   Bad turn (${outcome.error}); retry ${outcome.retryCount}…`);
      await sleep(5_000);
    } else if (outcome.kind === "failed") {
      console.log(`\n   Debate failed: ${outcome.error}`);
      break;
    } else {
      await sleep(500);
    }
  }

  const [final] = await db.select().from(debates).where(eq(debates.id, debateId));
  console.log(
    `Status: ${final.status} · tokens used ${final.totalPromptTokens} prompt + ${final.totalCompletionTokens} completion (budget ${final.maxTotalTokens})`,
  );
  client.close();
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
