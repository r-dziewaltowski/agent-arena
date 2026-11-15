/** Settings for the job queue, read from environment variables. */

const isProduction = () => process.env.NODE_ENV === "production";

/**
 * The address the queue calls back. A Vercel preview deployment uses its own URL, so its messages
 * reach that deployment and not production.
 */
export function appUrl(): string {
  const strip = (url: string) => url.replace(/\/$/, "");
  if (process.env.VERCEL_ENV === "preview" && process.env.VERCEL_URL) return `https://${process.env.VERCEL_URL}`;
  if (process.env.APP_URL) return strip(process.env.APP_URL);
  // Vercel's production address (e.g. agent-arena.vercel.app), provided at build and run time.
  if (process.env.VERCEL_ENV === "production" && process.env.VERCEL_PROJECT_PRODUCTION_URL) {
    return `https://${process.env.VERCEL_PROJECT_PRODUCTION_URL}`;
  }
  if (isProduction()) return strip(process.env.BETTER_AUTH_URL ?? "http://localhost:3000");
  // Locally the QStash dev server runs in Docker, where "localhost" is the container itself;
  // host.docker.internal is how a container reaches this machine.
  return "http://host.docker.internal:3000";
}

/** How many turns may run at once across all debates (QStash flow control). */
export function turnParallelism(): number {
  const n = Number(process.env.TURN_PARALLELISM);
  if (Number.isInteger(n) && n >= 1) return n;
  // Local Ollama handles one generation well; Groq's free tier allows a few at once.
  return isProduction() ? 2 : 1;
}

/** How often the sweep runs: every 10 minutes in production (it costs queue messages), every minute locally. */
export function sweepCron(): string {
  return process.env.SWEEP_CRON ?? (isProduction() ? "*/10 * * * *" : "* * * * *");
}

export class QueueNotConfiguredError extends Error {
  constructor(missing: string) {
    super(`The job queue isn't configured: set ${missing} (see the README).`);
    this.name = "QueueNotConfiguredError";
  }
}

export function qstashConfig(): { baseUrl?: string; token: string } {
  const token = process.env.QSTASH_TOKEN;
  if (!token) throw new QueueNotConfiguredError("QSTASH_TOKEN");
  return { baseUrl: process.env.QSTASH_URL || undefined, token };
}

export function signingKeys(): { currentSigningKey: string; nextSigningKey: string } {
  const currentSigningKey = process.env.QSTASH_CURRENT_SIGNING_KEY;
  const nextSigningKey = process.env.QSTASH_NEXT_SIGNING_KEY;
  if (!currentSigningKey || !nextSigningKey) {
    throw new QueueNotConfiguredError("QSTASH_CURRENT_SIGNING_KEY and QSTASH_NEXT_SIGNING_KEY");
  }
  return { currentSigningKey, nextSigningKey };
}
