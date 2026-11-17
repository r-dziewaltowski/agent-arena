import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { parseRange } from "../http-range";
import {
  decodePcm,
  defaultSpeechMaker,
  encodeMp3,
  makeSpeech,
  resetVoiceModelLimits,
  SpeechQuotaError,
  speakWithRotation,
  speechPrompt,
  VOICE_MODELS,
  type SpeechRequest,
} from "./speech";
import { speechDirection, voiceFor, VOICE_NAMES } from "./voices";

const REQUEST: SpeechRequest = { text: "Hello there. General Kenobi.", voice: "Kore", direction: "" };
const made = { audio: new Uint8Array([1]), mimeType: "audio/mpeg" as const, durationMs: 1000, marks: [[0, 0] as [number, number]] };

function pcm(seconds: number, rate = 24_000): Buffer {
  const buf = Buffer.alloc(seconds * rate * 2);
  for (let i = 0; i < seconds * rate; i++) buf.writeInt16LE(Math.round(3000 * Math.sin(i / 10)), i * 2);
  return buf;
}

function wav(data: Buffer, rate = 24_000): Buffer {
  const h = Buffer.alloc(44);
  h.write("RIFF", 0);
  h.writeUInt32LE(36 + data.length, 4);
  h.write("WAVEfmt ", 8);
  h.writeUInt32LE(16, 16);
  h.writeUInt16LE(1, 20);
  h.writeUInt16LE(1, 22);
  h.writeUInt32LE(rate, 24);
  h.writeUInt32LE(rate * 2, 28);
  h.writeUInt16LE(2, 32);
  h.writeUInt16LE(16, 34);
  h.write("data", 36);
  h.writeUInt32LE(data.length, 40);
  return Buffer.concat([h, data]);
}

describe("decodePcm", () => {
  it("reads bare PCM and WAV files alike", () => {
    const data = pcm(1);
    expect(decodePcm(data, "audio/L16;codec=pcm;rate=24000")).toMatchObject({ sampleRate: 24_000 });
    expect(decodePcm(data, "audio/L16;codec=pcm;rate=24000").samples.length).toBe(24_000);
    const fromWav = decodePcm(wav(pcm(1, 16_000), 16_000), "audio/wav");
    expect(fromWav.sampleRate).toBe(16_000);
    expect(fromWav.samples.length).toBe(16_000);
  });
});

describe("encodeMp3", () => {
  it("makes a small MP3", async () => {
    const { samples } = decodePcm(pcm(2), "audio/L16;rate=24000");
    const mp3 = await encodeMp3(samples, 24_000);
    expect(mp3[0]).toBe(0xff); // an MP3 frame header
    expect(mp3.length).toBeLessThan(20_000); // 48 kbit/s: about 12 KB for 2 s
  });
});

describe("speechPrompt", () => {
  it("puts the direction in director's notes and the turn in the transcript", () => {
    const prompt = speechPrompt("We must act.", "weary professor.");
    expect(prompt).toBe("### DIRECTOR'S NOTES\nStyle: weary professor.\n\n#### TRANSCRIPT\nWe must act.");
    expect(speechPrompt("Hi.", "  ")).toContain("Style: Natural, like a confident debater.");
  });
});

describe("makeSpeech", () => {
  afterEach(() => vi.unstubAllGlobals());

  it("turns Gemini's answer into an MP3 with marks", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () =>
        Response.json({ candidates: [{ content: { parts: [{ inlineData: { mimeType: "audio/wav", data: wav(pcm(2)).toString("base64") } }] } }] }),
      ),
    );
    const speech = await makeSpeech(REQUEST, { apiKey: "k", model: "m" });
    expect(speech.durationMs).toBe(2000);
    expect(speech.marks.at(-1)).toEqual([2000, REQUEST.text.length]);
  });

  it("tells a daily limit from a per-minute one", async () => {
    const refusal = (quotaId: string) =>
      Response.json(
        {
          error: {
            message: "quota",
            details: [
              { "@type": "type.googleapis.com/google.rpc.QuotaFailure", violations: [{ quotaId }] },
              { "@type": "type.googleapis.com/google.rpc.RetryInfo", retryDelay: "22s" },
            ],
          },
        },
        { status: 429 },
      );
    vi.stubGlobal("fetch", vi.fn(async () => refusal("GenerateRequestsPerDayPerProjectPerModel-FreeTier")));
    await expect(makeSpeech(REQUEST, { apiKey: "k", model: "m" })).rejects.toMatchObject({ daily: true, retryAfterMs: 22_000 });
    vi.stubGlobal("fetch", vi.fn(async () => refusal("GenerateRequestsPerMinutePerProjectPerModel-FreeTier")));
    await expect(makeSpeech(REQUEST, { apiKey: "k", model: "m" })).rejects.toMatchObject({ daily: false });
  });
});

describe("speakWithRotation", () => {
  const models = ["a", "b", "c"];
  const sleep = vi.fn(async () => {});
  beforeEach(() => {
    resetVoiceModelLimits();
    sleep.mockClear();
  });

  it("keeps the debate's model while it works", async () => {
    const make = vi.fn(async () => made);
    expect(await speakWithRotation({ ...REQUEST, model: "b" }, { models, make, sleep })).toMatchObject({ model: "b", nextModel: "b" });
    expect(make).toHaveBeenCalledWith(expect.anything(), "b");
    // A debate's first spoken turn starts with the best model.
    expect(await speakWithRotation(REQUEST, { models, make, sleep })).toMatchObject({ model: "a", nextModel: "a" });
  });

  it("moves the debate on for good when its model's day is used up", async () => {
    const make = vi.fn(async (_r: SpeechRequest, model: string) => {
      if (model === "a") throw new SpeechQuotaError("a: daily", true, 3_600_000);
      return made;
    });
    expect(await speakWithRotation(REQUEST, { models, make, sleep })).toMatchObject({ model: "b", nextModel: "b" });
    // Remembered: the next debate doesn't ask "a" again today.
    make.mockClear();
    expect(await speakWithRotation({ ...REQUEST, model: "a" }, { models, make, sleep })).toMatchObject({ model: "b", nextModel: "b" });
    expect(make).toHaveBeenCalledTimes(1);
  });

  it("waits out a short per-minute limit once, keeping the same voice", async () => {
    let calls = 0;
    const make = vi.fn(async () => {
      if (calls++ === 0) throw new SpeechQuotaError("a: minute", false, 5_000);
      return made;
    });
    expect(await speakWithRotation(REQUEST, { models, make, sleep })).toMatchObject({ model: "a", nextModel: "a" });
    expect(sleep).toHaveBeenCalledWith(5_000);
  });

  it("borrows the next model for one turn after other failures, without moving the debate", async () => {
    const make = vi.fn(async (_r: SpeechRequest, model: string) => {
      if (model === "a") throw new SpeechQuotaError("a: minute", false, 45_000); // too long to wait
      return made;
    });
    expect(await speakWithRotation(REQUEST, { models, make, sleep })).toMatchObject({ model: "b", nextModel: "a" });
    expect(sleep).not.toHaveBeenCalled();
  });

  it("gives up when every model is used up (the turn goes ahead as text)", async () => {
    const make = vi.fn(async (_r: SpeechRequest, model: string): Promise<typeof made> => {
      throw new SpeechQuotaError(`${model}: daily`, true, undefined);
    });
    await expect(speakWithRotation(REQUEST, { models, make, sleep })).rejects.toBeInstanceOf(SpeechQuotaError);
  });
});

describe("defaultSpeechMaker", () => {
  it("is off without a Google key or with DEBATE_VOICE=0, and rotates Gemini's free models", () => {
    expect(defaultSpeechMaker({})).toBeNull();
    expect(defaultSpeechMaker({ GOOGLE_GENERATIVE_AI_API_KEY: "k", DEBATE_VOICE: "0" })).toBeNull();
    expect(defaultSpeechMaker({ GOOGLE_GENERATIVE_AI_API_KEY: "k" })).toBeTypeOf("function");
    expect(VOICE_MODELS[0]).toBe("gemini-3.8-flash-tts");
  });
});

describe("voices", () => {
  it("keeps a chosen voice and picks a stable one for agents from before voices", () => {
    expect(voiceFor("agent-1", "Puck")).toBe("Puck");
    expect(voiceFor("agent-1", null)).toBe(voiceFor("agent-1", "not a voice"));
    expect(VOICE_NAMES).toContain(voiceFor("agent-1", null));
  });

  it("speaks as the owner says, or in the agent's tone", () => {
    const tones = { dry: "Dry and understated, with deadpan wit." };
    expect(speechDirection(" a sea captain ", "dry", tones)).toBe("a sea captain");
    expect(speechDirection(null, "dry", tones)).toBe("Dry and understated, with deadpan wit, like a confident debater");
    expect(speechDirection("", "cheerfully blunt", tones)).toBe("cheerfully blunt, like a confident debater");
  });
});

describe("parseRange", () => {
  it("reads the byte ranges browsers ask for", () => {
    expect(parseRange(null, 100)).toBeNull();
    expect(parseRange("bytes=0-", 100)).toEqual([0, 99]);
    expect(parseRange("bytes=10-19", 100)).toEqual([10, 19]);
    expect(parseRange("bytes=90-200", 100)).toEqual([90, 99]);
    expect(parseRange("bytes=-10", 100)).toEqual([90, 99]);
    expect(parseRange("bytes=100-", 100)).toBe("invalid");
    expect(parseRange("items=0-1", 100)).toBeNull();
  });
});
