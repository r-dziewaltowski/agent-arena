/**
 * The debate worker: starts scheduled debates when due and generates turns for running debates,
 * whether or not anyone is watching. Run with `npm run worker`; stop with Ctrl+C.
 */
import "./load-env";
import { openDb } from "../src/lib/db/client";
import { runMigrations } from "../src/lib/db/migrate";
import { runLoop } from "../src/lib/debate/runner";

async function main() {
  const { db, client } = await openDb();
  await runMigrations(db);

  const controller = new AbortController();
  const stop = () => {
    if (controller.signal.aborted) return;
    log("Stopping after the current step…");
    controller.abort();
  };
  process.on("SIGINT", stop);
  process.on("SIGTERM", stop);

  log("Worker started.");
  await runLoop(db, {
    signal: controller.signal,
    onTurnStart: ({ speaker, round, rounds, kind, seq }) =>
      log(`turn ${seq}: ${speaker} (round ${round}/${rounds}, ${kind})`),
    onPass: ({ started, cancelled, steps }) => {
      for (const id of started) log(`debate ${id} started`);
      for (const id of cancelled) log(`debate ${id} cancelled (not enough agents)`);
      for (const { debateId, outcome } of steps) {
        switch (outcome.kind) {
          case "turn":
            if (outcome.debateCompleted) log(`debate ${debateId} completed`);
            break;
          case "waiting":
            log(`debate ${debateId}: model unreachable (${outcome.error}); retrying at ${new Date(outcome.nextAttemptAt).toLocaleTimeString()}`);
            break;
          case "retrying":
            log(`debate ${debateId}: bad turn (${outcome.error}); retry ${outcome.retryCount}`);
            break;
          case "failed":
            log(`debate ${debateId} failed: ${outcome.error}`);
            break;
        }
      }
    },
  });

  client.close();
  log("Worker stopped.");
}

function log(message: string) {
  console.log(`[worker ${new Date().toLocaleTimeString()}] ${message}`);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
