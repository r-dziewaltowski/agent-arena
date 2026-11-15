/**
 * Runs Upstash's QStash dev server in Docker for local development (`npm run dev` starts it next
 * to Next.js). It is a local stand-in for QStash: in-memory, reset on every start, for
 * development only. The app talks to it exactly as it talks to QStash in production.
 */
import { spawn, spawnSync } from "node:child_process";

const CONTAINER = "agent-arena-qstash";
// Pinned by digest (version 2.44.2; the registry has no version tags), so every run uses the
// same dev server. Override with QSTASH_DEV_IMAGE=public.ecr.aws/upstash/qstash:latest to update.
const IMAGE =
  process.env.QSTASH_DEV_IMAGE ??
  "public.ecr.aws/upstash/qstash@sha256:2d447f3cdbe3d898eaffde21202632e0c20f58cce99c9d64716cc38f451baf32";
const PORT = process.env.QSTASH_DEV_PORT ?? "8080";

const docker = spawnSync("docker", ["info", "--format", "{{.ServerVersion}}"], { encoding: "utf8" });
if (docker.error || docker.status !== 0) {
  console.error(
    docker.error
      ? "Docker isn't installed. Install Docker Desktop (see the README), or run `npm run dev:web` without the queue."
      : "Docker isn't running. Start Docker Desktop and run `npm run dev` again.",
  );
  process.exit(1);
}

// A container left over from a previous run (Windows can kill the docker client without stopping it)
// would hold the port.
spawnSync("docker", ["rm", "--force", CONTAINER], { stdio: "ignore" });

const child = spawn(
  "docker",
  ["run", "--rm", "--name", CONTAINER, "--publish", `${PORT}:8080`, IMAGE, "qstash", "dev"],
  { stdio: "inherit" },
);

const stop = () => {
  spawnSync("docker", ["rm", "--force", CONTAINER], { stdio: "ignore" });
  process.exit(0);
};
process.on("SIGINT", stop);
process.on("SIGTERM", stop);
child.on("exit", (code) => process.exit(code ?? 0));
