/**
 * Checks how reliable OpenRouter models are right now, with the same kind of request a debate turn
 * sends (system prompt, token cap, minimal reasoning kept out of the reply). Uses the OpenRouter key
 * a user connected in this app (read from the database and decrypted with
 * USER_API_KEYS_ENCRYPTION_SECRET, both from .env.local); never prints it. Models run side by side;
 * each model's requests run one after another.
 *
 *   npm run models:openrouter -- you@example.com nvidia/nemotron-3-ultra-550b-a55b:free [effort=none] 5
 *
 * Free models (":free") cost nothing but count against the account's daily free requests.
 */
import "./load-env";
import { eq } from "drizzle-orm";
import { openDb } from "../src/lib/db/client";
import { user } from "../src/lib/db/schema";
import { loadKey, openRouterUrl } from "../src/lib/openrouter";

type Reply = {
  error?: { message?: string; code?: number };
  choices?: { message?: { content?: string }; finish_reason?: string }[];
  usage?: { prompt_tokens?: number; completion_tokens?: number; completion_tokens_details?: { reasoning_tokens?: number } };
};

async function main() {
  const [email, ...rest] = process.argv.slice(2);
  const times = Number(rest.at(-1)) || 5;
  const effort = rest.find((a) => a.startsWith("effort="))?.slice("effort=".length) ?? "minimal";
  const models = rest.filter((m) => m.includes("/"));
  console.log(`Reasoning effort: ${effort}`);
  if (!email || models.length === 0) throw new Error("Usage: npm run models:openrouter -- <your email> <model> [<model>...] [times]");

  const { db, client } = await openDb();
  const [me] = await db.select({ id: user.id }).from(user).where(eq(user.email, email));
  const key = me ? await loadKey(db, me.id) : null;
  client.close();
  if (!key) throw new Error(`No connected OpenRouter account for ${email} in this database. Connect it on the Account page first.`);

  await Promise.all(models.map((model) => probe(model, key, times, effort)));
}

/** Sends `times` requests to one model and prints its report when done. */
async function probe(model: string, key: string, times: number, effort: string) {
  const lines = ["", model];
  let ok = 0;
  for (let i = 1; i <= times; i++) {
    const started = Date.now();
    const secs = () => ((Date.now() - started) / 1000).toFixed(1).padStart(5);
    try {
      const res = await fetch(`${openRouterUrl()}/api/v1/chat/completions`, {
        method: "POST",
        headers: { authorization: `Bearer ${key}`, "content-type": "application/json", "x-title": "Agent Arena" },
        body: JSON.stringify({
          model,
          max_tokens: 220,
          temperature: 0.7,
          reasoning: { effort, exclude: true },
          messages: [
            { role: "system", content: "You are Ada, an urban planner, in a live debate. Speak in the first person, under 130 words." },
            { role: "user", content: "Opening statement: should city centres ban private cars?" },
          ],
        }),
        signal: AbortSignal.timeout(120_000),
      });
      // OpenRouter answers at once and sends the reply when it's done, so time the whole body.
      const body = (await res.json().catch(() => ({}))) as Reply;
      const text = body.choices?.[0]?.message?.content?.trim() ?? "";
      if (res.ok && text) ok++;
      const u = body.usage;
      const detail = res.ok
        ? `${u?.completion_tokens ?? "?"} tokens (reasoning ${u?.completion_tokens_details?.reasoning_tokens ?? 0}), ${body.choices?.[0]?.finish_reason}: ${text.replace(/\s+/g, " ").slice(0, 60)}`
        : (body.error?.message ?? "").slice(0, 90);
      lines.push(`  ${i}  ${res.status}  ${secs()} s  ${detail}`);
    } catch (err) {
      lines.push(`  ${i}  ---  ${secs()} s  ${err instanceof Error ? err.message : String(err)}`);
    }
  }
  lines.push(`  ${ok} of ${times} gave a usable turn.`);
  console.log(lines.join("\n"));
}

main().catch((err) => {
  console.error(err instanceof Error ? err.message : err);
  process.exit(1);
});
