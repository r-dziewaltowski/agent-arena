/**
 * Makes the agent form's voice samples: one short MP3 per voice in `public/voices/`, made once with
 * the app's free Google key and committed. Skips voices that already have one; delete a file to
 * make it again.
 *
 *   npm run voices:previews
 */
import "./load-env";
import { existsSync, mkdirSync, writeFileSync } from "node:fs";
import { makeSpeech } from "../src/lib/voice/speech";
import { VOICE_NAMES, VOICES } from "../src/lib/voice/voices";

const SAMPLE = "Thank you. I'll keep this short: my opponent is wrong, and in the next minute I'll show you why.";
const DIR = "public/voices";

async function main() {
  const apiKey = process.env.GOOGLE_GENERATIVE_AI_API_KEY;
  if (!apiKey) throw new Error("Set GOOGLE_GENERATIVE_AI_API_KEY (in .env.local or the shell).");
  const model = process.env.GEMINI_TTS_MODEL || "gemini-3.8-flash-tts";
  mkdirSync(DIR, { recursive: true });
  for (const voice of VOICE_NAMES) {
    const file = `${DIR}/${voice}.mp3`;
    if (existsSync(file)) continue;
    const started = Date.now();
    try {
      const speech = await makeSpeech({ text: SAMPLE, voice, direction: "" }, { apiKey, model });
      writeFileSync(file, speech.audio);
      console.log(`${voice} (${VOICES[voice]}): ${(speech.durationMs / 1000).toFixed(1)} s, ${(speech.audio.length / 1024).toFixed(0)} KB, made in ${((Date.now() - started) / 1000).toFixed(1)} s`);
    } catch (err) {
      console.log(`${voice}: ${err instanceof Error ? err.message : err}`);
    }
  }
}

main().catch((err) => {
  console.error(err instanceof Error ? err.message : err);
  process.exit(1);
});
