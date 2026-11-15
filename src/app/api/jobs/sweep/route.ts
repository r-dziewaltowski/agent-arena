import { getDb } from "@/lib/db/client";
import { getQueue, SWEEP_PATH } from "@/lib/jobs/queue";
import { sweep } from "@/lib/jobs/sweep";
import { isQueueRequest, jobLog } from "@/lib/jobs/verify";

export const maxDuration = 60;

/** Called only by the queue's schedule: restarts stalled debates and starts overdue scheduled ones. */
export async function POST(request: Request) {
  const body = await request.text();
  if (!(await isQueueRequest(request, body, SWEEP_PATH))) {
    return new Response("Invalid signature", { status: 401 });
  }
  try {
    const result = await sweep(await getDb(), { queue: getQueue() });
    for (const id of result.started) jobLog(`sweep: started scheduled debate ${id}`);
    for (const id of result.cancelled) jobLog(`sweep: cancelled scheduled debate ${id} (not enough agents)`);
    for (const id of result.restarted) jobLog(`sweep: restarted stalled debate ${id}`);
    return Response.json(result);
  } catch (err) {
    console.error("[jobs] sweep failed", err);
    return new Response("Sweep failed", { status: 500 });
  }
}
