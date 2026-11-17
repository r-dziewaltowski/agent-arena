/**
 * A stand-in voice for the end-to-end tests (with E2E_FAKE_MODEL=1, never on Vercel): a soft tone
 * per sentence with a pause between sentences, run through the real marks and MP3 code, so the
 * Listen button, the audio route and the text keeping step can be tested without Gemini.
 */
import { readingWordsPerSecond } from "../debate/pacing";
import { buildMarks, sentenceEnds } from "./marks";
import { encodeMp3, type SpeechMaker } from "./speech";

const RATE = 24_000;
/** As fast as the configured reading pace (quick in the end-to-end tests); about six characters a word. */
const charsPerSecond = () => 6 * (readingWordsPerSecond() ?? 2.5);
const PAUSE_MS = 400;

export function fakeSpeechSamples(text: string): Int16Array {
  const parts: number[] = [];
  const silence = (ms: number) => {
    for (let i = 0; i < (RATE * ms) / 1000; i++) parts.push(0);
  };
  let from = 0;
  silence(200);
  for (const end of sentenceEnds(text)) {
    const ms = ((end - from) / charsPerSecond()) * 1000;
    for (let i = 0; i < (RATE * ms) / 1000; i++) parts.push(Math.round(4000 * Math.sin((2 * Math.PI * 220 * i) / RATE)));
    silence(PAUSE_MS);
    from = end;
  }
  return Int16Array.from(parts);
}

export const fakeSpeechMaker: SpeechMaker = async (request) => {
  const samples = fakeSpeechSamples(request.text);
  return {
    audio: await encodeMp3(samples, RATE),
    mimeType: "audio/mpeg",
    durationMs: Math.round((samples.length / RATE) * 1000),
    marks: buildMarks(request.text, samples, RATE),
    model: "fake",
    nextModel: "fake",
  };
};
