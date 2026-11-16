/**
 * Checks how reliable Google's free models are right now, with the same kind of request a debate
 * turn sends (system prompt, temperature, token cap, stop sequence, minimal thinking). Reads
 * GOOGLE_GENERATIVE_AI_API_KEY from the shell or .env.local and never prints it.
 *
 *   npm run models:google                          list the Gemini/Gemma text models the key can use
 *   npm run models:google -- gemma-4-31b-it 10     send 10 requests and report each one
 *
 * Gemma 4 was left out on 2026-11-16 (most requests failed); add it to src/lib/ai/models.ts only
 * if nearly all requests succeed within a few seconds.
 */
import "./load-env";

const API = "https://generativelanguage.googleapis.com/v1beta";

async function call(path: string, key: string, body?: unknown) {
  const res = await fetch(`${API}/${path}`, {
    method: body ? "POST" : "GET",
    headers: { "x-goog-api-key": key, "content-type": "application/json" },
    body: body ? JSON.stringify(body) : undefined,
  });
  type GoogleResponse = {
    error?: { message?: string };
    models?: { name: string; supportedGenerationMethods?: string[] }[];
    usageMetadata?: { candidatesTokenCount?: number; thoughtsTokenCount?: number };
  };
  return { status: res.status, json: (await res.json()) as GoogleResponse };
}

async function list(key: string) {
  const { status, json } = await call("models?pageSize=1000", key);
  if (status !== 200) throw new Error(`Google answered ${status}: ${json.error?.message}`);
  for (const m of json.models ?? []) {
    const name = String(m.name).replace("models/", "");
    if (!m.supportedGenerationMethods?.includes("generateContent")) continue;
    if (!/gemma|gemini/.test(name) || /image|tts|audio|live|embedding|transcribe|banana|omni/.test(name)) continue;
    console.log(name);
  }
}

async function probe(key: string, model: string, times: number) {
  const body = {
    contents: [{ role: "user", parts: [{ text: "In two sentences: should city centres ban private cars?" }] }],
    systemInstruction: { parts: [{ text: "You are Ada, an urban planner, taking part in a live debate." }] },
    generationConfig: { temperature: 0.7, maxOutputTokens: 220, stopSequences: ["\nBram:"], thinkingConfig: { thinkingLevel: "minimal" } },
  };
  let ok = 0;
  for (let i = 1; i <= times; i++) {
    const started = Date.now();
    const { status, json } = await call(`models/${model}:generateContent`, key, body);
    const secs = ((Date.now() - started) / 1000).toFixed(1);
    if (status === 200) ok++;
    const detail =
      status === 200
        ? `${json.usageMetadata?.candidatesTokenCount ?? "?"} tokens, thinking ${json.usageMetadata?.thoughtsTokenCount ?? 0}`
        : (json.error?.message ?? "").slice(0, 80);
    console.log(`${String(i).padStart(2)}  ${status}  ${secs.padStart(5)} s  ${detail}`);
  }
  console.log(`\n${model}: ${ok} of ${times} succeeded.`);
}

async function main() {
  const key = process.env.GOOGLE_GENERATIVE_AI_API_KEY;
  if (!key) throw new Error("Set GOOGLE_GENERATIVE_AI_API_KEY (in .env.local or the shell).");
  const [model, times] = process.argv.slice(2);
  if (model) await probe(key, model, Number(times ?? 10));
  else await list(key);
}

main().catch((err) => {
  console.error(err instanceof Error ? err.message : err);
  process.exit(1);
});
