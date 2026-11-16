/**
 * Starts the app for the end-to-end tests (Playwright runs this as its web server): makes sure the
 * QStash dev server is up, resets the test database, builds into .next-e2e (unless E2E_SKIP_BUILD
 * is set, e.g. when CI built it in an earlier step) and serves the build on port 3100.
 */
import { spawn, spawnSync } from "node:child_process";
import { rmSync } from "node:fs";
import { E2E_PORT, EMAIL_OUTBOX_FILE, e2eEnv, QSTASH_DEV_URL } from "../e2e/env";

const env = { ...process.env, ...e2eEnv };
const npx = process.platform === "win32" ? "npx.cmd" : "npx";

function run(cmd: string, args: string[]) {
  const result = spawnSync(cmd, args, { stdio: "inherit", env, shell: process.platform === "win32" });
  if (result.status !== 0) throw new Error(`${cmd} ${args.join(" ")} failed`);
}

async function queueReachable(): Promise<boolean> {
  try {
    await fetch(QSTASH_DEV_URL, { signal: AbortSignal.timeout(1000) });
    return true;
  } catch {
    return false;
  }
}

async function ensureQueue() {
  if (await queueReachable()) return; // e.g. the one `npm run dev` started
  console.log("[e2e] starting the QStash dev server in Docker");
  spawnSync("docker", ["rm", "--force", "agent-arena-qstash-e2e"], { stdio: "ignore" });
  const image =
    process.env.QSTASH_DEV_IMAGE ??
    "public.ecr.aws/upstash/qstash@sha256:2d447f3cdbe3d898eaffde21202632e0c20f58cce99c9d64716cc38f451baf32";
  run("docker", [
    "run", "--detach", "--rm", "--name", "agent-arena-qstash-e2e", "--publish", "8080:8080",
    // On Linux, host.docker.internal only exists when mapped explicitly.
    "--add-host=host.docker.internal:host-gateway",
    image, "qstash", "dev",
  ]);
  for (let i = 0; i < 30 && !(await queueReachable()); i++) await new Promise((r) => setTimeout(r, 1000));
  if (!(await queueReachable())) throw new Error("The QStash dev server didn't start.");
}

async function main() {
  await ensureQueue();
  for (const suffix of ["", "-wal", "-shm"]) rmSync(`data/e2e.db${suffix}`, { force: true });
  rmSync(EMAIL_OUTBOX_FILE, { force: true });
  run(npx, ["tsx", "scripts/migrate.ts"]);
  if (!process.env.E2E_SKIP_BUILD) run(npx, ["next", "build"]);
  const server = spawn(npx, ["next", "start", "-p", String(E2E_PORT), "-H", "0.0.0.0"], {
    stdio: "inherit",
    env,
    shell: process.platform === "win32",
  });
  const stop = () => server.kill();
  process.on("SIGINT", stop);
  process.on("SIGTERM", stop);
  server.on("exit", (code) => process.exit(code ?? 0));
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
