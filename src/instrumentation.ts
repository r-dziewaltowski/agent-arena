/**
 * Runs once when the Next.js server starts. In development it creates the sweep schedule on the
 * local QStash dev server, which keeps everything in memory and so forgets it on every restart.
 * In production the schedule is created once at deploy time (`npm run queue:setup`).
 */
export async function register() {
  if (process.env.NEXT_RUNTIME !== "nodejs" || process.env.NODE_ENV !== "development") return;
  if (!process.env.QSTASH_TOKEN) {
    console.warn("[jobs] QSTASH_TOKEN isn't set, so debates won't run. See the README (job queue).");
    return;
  }
  const { ensureSweepSchedule } = await import("./lib/jobs/queue");
  // Don't hold up the server: the dev server may still be starting, so retry for a minute.
  void (async () => {
    for (let attempt = 1; attempt <= 30; attempt++) {
      try {
        await ensureSweepSchedule();
        console.log("[jobs] sweep schedule ready on the QStash dev server");
        return;
      } catch {
        await new Promise((r) => setTimeout(r, 2000));
      }
    }
    console.warn("[jobs] couldn't reach the QStash dev server; stalled debates won't be restarted.");
  })();
}
