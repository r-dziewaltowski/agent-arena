/**
 * Creates (or updates) the QStash schedule that calls the sweep route on a deployment. Run once
 * per deployment with that deployment's QStash credentials:
 *
 *   APP_URL=https://your-app.example npm run queue:setup
 *
 * Locally there's no need: `npm run dev` creates it on the dev server at startup.
 */
import "./load-env";
import { ensureSweepSchedule, SWEEP_PATH } from "../src/lib/jobs/queue";

const baseUrl = process.env.APP_URL?.replace(/\/$/, "");
if (!baseUrl?.startsWith("https://")) {
  console.error("Set APP_URL to the deployment's https:// address, e.g. APP_URL=https://agent-arena.vercel.app");
  process.exit(1);
}
const cron = process.env.SWEEP_CRON ?? "*/10 * * * *";

ensureSweepSchedule({ baseUrl, cron })
  .then(() => console.log(`Sweep schedule set: "${cron}" → ${baseUrl}${SWEEP_PATH}`))
  .catch((err) => {
    console.error(err instanceof Error ? err.message : err);
    process.exit(1);
  });
