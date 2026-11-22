import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { catalogAvailability } from "../ai/models";
import { createComment, deleteOwnComment } from "../chat";
import type { Db } from "../db/client";
import { createDebate, deleteAgent, enter, startDebate, startOrCancelScheduled, withdraw } from "../debate/lifecycle";
import { advanceDebate } from "../jobs/advance";
import { fakeQueue } from "../jobs/queue";
import { createReport, removeComment } from "../reports";
import { createTestDb, resolverFor, scriptedModel, seedAgent, seedUser, testClock } from "../../test/helpers";
import { channelFor, parseEvent, type DebateEvent } from "./events";
import { listen, publish, streamUrlFor } from "./publish";

const KEY = "appId.keyId:secret";

describe("events", () => {
  it("reads the events it knows and ignores anything else", () => {
    expect(parseEvent('{"type":"turns"}')).toEqual({ type: "turns" });
    expect(parseEvent('{"type":"refresh","extra":1}')).toEqual({ type: "refresh" });
    expect(parseEvent('{"type":"comment","comment":{"id":"c1"}}')).toMatchObject({ type: "comment", comment: { id: "c1" } });
    expect(parseEvent('{"type":"comment"}')).toBeNull();
    expect(parseEvent('{"type":"party"}')).toBeNull();
    expect(parseEvent("not json")).toBeNull();
    expect(channelFor("abc")).toBe("debate:abc");
  });
});

describe("publishing", () => {
  afterEach(() => {
    vi.unstubAllEnvs();
    vi.unstubAllGlobals();
  });

  it("reaches this process's listeners for that debate only, until they stop", async () => {
    const heard: DebateEvent[] = [];
    const stop = listen("d1", (e) => heard.push(e));
    const other = vi.fn();
    const stopOther = listen("d2", other);
    await publish("d1", { type: "turns" });
    stop();
    await publish("d1", { type: "refresh" });
    expect(heard).toEqual([{ type: "turns" }]);
    expect(other).not.toHaveBeenCalled();
    stopOther();
  });

  it("sends each event to the debate's Ably channel when a key is set, and never throws", async () => {
    vi.stubEnv("ABLY_API_KEY", KEY);
    const fetchMock = vi.fn(async () => new Response("{}", { status: 201 }));
    vi.stubGlobal("fetch", fetchMock);
    await publish("d1", { type: "turns" });
    const [url, init] = fetchMock.mock.calls[0] as unknown as [string, RequestInit];
    expect(url).toBe("https://main.realtime.ably.net/channels/debate%3Ad1/messages");
    expect((init.headers as Record<string, string>).authorization).toBe(`Basic ${Buffer.from(KEY).toString("base64")}`);
    // Identified as the server, for Ably apps that require identified clients.
    expect((init.headers as Record<string, string>)["x-ably-clientid"]).toBe(Buffer.from("agent-arena-server").toString("base64"));
    expect(JSON.parse(init.body as string)).toEqual({ name: "turns", data: '{"type":"turns"}' });

    vi.spyOn(console, "error").mockImplementation(() => {});
    fetchMock.mockImplementation(async () => new Response("nope", { status: 500 }));
    await expect(publish("d1", { type: "turns" })).resolves.toBeUndefined();
    fetchMock.mockImplementation(async () => {
      throw new Error("offline");
    });
    await expect(publish("d1", { type: "turns" })).resolves.toBeUndefined();
  });
});

describe("where browsers listen", () => {
  afterEach(() => vi.unstubAllGlobals());

  it("is the local stream off Vercel, nowhere on Vercel without a key or when turned off", async () => {
    expect(await streamUrlFor("d1", {})).toBe("/api/debates/d1/events");
    expect(await streamUrlFor("d1", { VERCEL: "1" })).toBeNull();
    expect(await streamUrlFor("d1", { REALTIME: "off" })).toBeNull();
    expect(await streamUrlFor("d1", { ABLY_API_KEY: "not a key" })).toBe("/api/debates/d1/events");
  });

  it("is Ably's stream with a listen-only token for that debate, shared while it has a while left", async () => {
    const fetchMock = vi.fn(async () => Response.json({ token: "tok-1", expires: Date.now() + 3_600_000 }));
    vi.stubGlobal("fetch", fetchMock);
    const url = new URL((await streamUrlFor("d-token", { ABLY_API_KEY: KEY, VERCEL: "1" }))!);
    expect(url.origin + url.pathname).toBe("https://main.realtime.ably.net/sse");
    expect(Object.fromEntries(url.searchParams)).toEqual({ v: "1.2", channels: "debate:d-token", enveloped: "false", accessToken: "tok-1" });

    const [tokenUrl, init] = fetchMock.mock.calls[0] as unknown as [string, RequestInit];
    expect(tokenUrl).toBe("https://main.realtime.ably.net/keys/appId.keyId/requestToken");
    const body = JSON.parse(init.body as string);
    expect(body).toMatchObject({ keyName: "appId.keyId", ttl: 3_600_000, clientId: "viewer" });
    expect(JSON.parse(body.capability)).toEqual({ "debate:d-token": ["subscribe"] });

    await streamUrlFor("d-token", { ABLY_API_KEY: KEY });
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });
});

describe("what each change tells viewers", () => {
  let db: Db;
  let cleanup: () => void;
  let clock: ReturnType<typeof testClock>;
  let heard: DebateEvent[];
  let stop: () => void;

  beforeEach(async () => {
    ({ db, cleanup } = await createTestDb());
    clock = testClock();
    for (const id of ["alice", "bob", "carol"]) await seedUser(db, id);
    await seedUser(db, "admin", { isAdmin: true });
  });
  afterEach(() => {
    stop?.();
    cleanup();
  });

  async function watched(opts: { startMode?: "manual" | "scheduled"; startAt?: number } = {}) {
    const startMode = opts.startMode ?? "manual";
    const debateId = await createDebate(
      db,
      "alice",
      { topic: "Should cities ban cars?", rounds: 2, maxParticipants: 3, startMode, startAt: opts.startAt },
      clock.now(),
    );
    heard = [];
    stop = listen(debateId, (e) => heard.push(e));
    return debateId;
  }

  it("lobby changes ask viewers to reload: entries, withdrawals, the start, a deleted agent", async () => {
    const debateId = await watched();
    const ada = await seedAgent(db, "alice", { name: "Ada" });
    await enter(db, { debateId, userId: "alice", agentId: ada, position: 1 });
    const bramEntry = await enter(db, { debateId, userId: "bob", agentId: await seedAgent(db, "bob", { name: "Bram" }), position: 2 });
    await withdraw(db, { participantId: bramEntry, userId: "bob" });
    await deleteAgent(db, { agentId: ada, userId: "alice", isAdmin: false });
    expect(heard).toEqual([{ type: "refresh" }, { type: "refresh" }, { type: "refresh" }, { type: "refresh" }]);

    await enter(db, { debateId, userId: "alice", agentId: await seedAgent(db, "alice", { name: "Cy" }), position: 1 });
    await enter(db, { debateId, userId: "bob", agentId: await seedAgent(db, "bob", { name: "Di" }), position: 2 });
    heard.length = 0;
    await startDebate(db, { debateId, userId: "alice" }, clock.now());
    expect(heard).toEqual([{ type: "refresh" }]);
  });

  it("a scheduled start or cancellation asks viewers to reload; nothing happening says nothing", async () => {
    const debateId = await watched({ startMode: "scheduled", startAt: clock.now() + 60_000 });
    expect(await startOrCancelScheduled(db, debateId, clock.now())).toBe("unchanged");
    expect(heard).toEqual([]);
    expect(await startOrCancelScheduled(db, debateId, clock.now() + 60_000)).toBe("cancelled");
    expect(heard).toEqual([{ type: "refresh" }]);
  });

  it("each step of a running debate tells viewers to fetch the turns", async () => {
    const debateId = await watched();
    await enter(db, { debateId, userId: "alice", agentId: await seedAgent(db, "alice"), position: 1 });
    await enter(db, { debateId, userId: "bob", agentId: await seedAgent(db, "bob"), position: 2 });
    await startDebate(db, { debateId, userId: "alice" }, clock.now());
    heard.length = 0;
    const q = fakeQueue();
    const result = await advanceDebate(db, debateId, {
      queue: q.queue,
      now: clock.now,
      resolveModel: resolverFor(scriptedModel(["Cars must go."])),
      getAvailability: async () => catalogAvailability(),
    });
    expect(result.kind).toBe("step");
    expect(heard).toEqual([{ type: "turns" }]);
  });

  it("comments are pushed whole, as a visitor sees them; deleted and removed ones too", async () => {
    const debateId = await watched();
    await enter(db, { debateId, userId: "alice", agentId: await seedAgent(db, "alice", { name: "Ada" }), position: 1 });
    await enter(db, { debateId, userId: "bob", agentId: await seedAgent(db, "bob"), position: 2 });
    await startDebate(db, { debateId, userId: "alice" }, clock.now());
    heard.length = 0;

    const first = await createComment(db, { debateId, userId: "alice", body: "Go Ada" }, clock.now(), null);
    const second = await createComment(db, { debateId, userId: "carol", body: "Rude words" }, clock.now(), null);
    await deleteOwnComment(db, first, "alice", clock.now());
    await createReport(db, { debateId, target: "comment", targetId: second, reason: "offensive", reporterId: "bob" }, clock.now());
    await removeComment(db, second, "admin", clock.now());

    expect(heard).toEqual([
      { type: "comment", comment: expect.objectContaining({ id: first, author: "alice", role: "owner of Ada", body: "Go Ada", mine: false }) },
      { type: "comment", comment: expect.objectContaining({ id: second, body: "Rude words", removed: false }) },
      { type: "comment", comment: expect.objectContaining({ id: first, gone: true, body: "" }) },
      { type: "comment", comment: expect.objectContaining({ id: second, removed: true, body: "" }) },
    ]);
  });
});
