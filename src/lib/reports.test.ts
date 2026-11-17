import { asc, eq } from "drizzle-orm";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { createTestDb, resolverFor, scriptedModel, seedAgent, seedUser, testClock } from "../test/helpers";
import { toTurnView } from "./debate-view";
import type { Db } from "./db/client";
import { agentImages, agents, debateParticipants, reports, turnAudio, turns } from "./db/schema";
import { runStep } from "./debate/engine";
import { createDebate, enter, startDebate } from "./debate/lifecycle";
import {
  createReport,
  dismissReport,
  openReportCount,
  removeAgentPicture,
  removeTurnText,
  ReportError,
  REPORTS_PER_DAY,
  resolveAgentReports,
} from "./reports";

let db: Db;
let cleanup: () => void;
let clock: ReturnType<typeof testClock>;
let debateId: string;
let adaId: string;

beforeEach(async () => {
  ({ db, cleanup } = await createTestDb());
  clock = testClock();
  await seedUser(db, "alice");
  await seedUser(db, "bob");
  await seedUser(db, "carol");
  await seedUser(db, "admin", { isAdmin: true });
  adaId = await seedAgent(db, "alice", { name: "Ada" });
  debateId = await createDebate(db, "alice", { topic: "Should cities ban cars?", rounds: 2, maxParticipants: 2, startMode: "manual" }, clock.now());
  await enter(db, { debateId, userId: "alice", agentId: adaId, position: 1 });
  await enter(db, { debateId, userId: "bob", agentId: await seedAgent(db, "bob", { name: "Bram" }), position: 2 });
  await startDebate(db, { debateId, userId: "alice" }, clock.now());
  await runStep(db, debateId, { resolveModel: resolverFor(scriptedModel(["Cars must go."])), now: clock.now, wordsPerSecond: null });
});
afterEach(() => cleanup());

async function firstTurn() {
  const [turn] = await db.select().from(turns).where(eq(turns.debateId, debateId)).orderBy(asc(turns.seq));
  return turn;
}
async function adaEntry() {
  const [entry] = await db.select().from(debateParticipants).where(eq(debateParticipants.agentId, adaId));
  return entry;
}
const statusOf = async (id: string) => (await db.select().from(reports).where(eq(reports.id, id)))[0];

describe("createReport", () => {
  it("saves a report on the topic, a turn or an agent", async () => {
    const turn = await firstTurn();
    await createReport(db, { debateId, target: "topic", reason: "spam", reporterId: "carol" }, clock.now());
    await createReport(db, { debateId, target: "turn", targetId: turn.id, reason: "offensive", note: " rude ", reporterId: "carol" }, clock.now());
    const id = await createReport(db, { debateId, target: "agent", targetId: (await adaEntry()).id, reason: "sexual", reporterId: "carol" }, clock.now());
    expect(await openReportCount(db)).toBe(3);
    expect(await statusOf(id)).toMatchObject({ status: "open", participantId: (await adaEntry()).id, turnId: null });
    const [noted] = await db.select().from(reports).where(eq(reports.turnId, turn.id));
    expect(noted.note).toBe("rude");
  });

  it("only takes turns and agents of the debate itself", async () => {
    await expect(createReport(db, { debateId, target: "turn", targetId: "elsewhere", reason: "spam", reporterId: "carol" }, clock.now())).rejects.toMatchObject({ code: "NOT_FOUND" });
    await expect(createReport(db, { debateId, target: "agent", targetId: null, reason: "spam", reporterId: "carol" }, clock.now())).rejects.toMatchObject({ code: "NOT_FOUND" });
    await expect(createReport(db, { debateId: "missing", target: "topic", reason: "spam", reporterId: "carol" }, clock.now())).rejects.toBeInstanceOf(ReportError);
  });

  it("takes one report per person for the same thing, from several people", async () => {
    const report = { debateId, target: "topic" as const, reason: "spam" as const };
    await createReport(db, { ...report, reporterId: "carol" }, clock.now());
    await expect(createReport(db, { ...report, reason: "offensive", reporterId: "carol" }, clock.now())).rejects.toMatchObject({ code: "DUPLICATE" });
    await createReport(db, { ...report, reporterId: "bob" }, clock.now());
    expect(await openReportCount(db)).toBe(2);
  });

  it("limits how many reports one person sends in a day", async () => {
    // Fill the day's allowance with reports on other debates.
    for (let i = 0; i < REPORTS_PER_DAY; i++) {
      const other = await createDebate(db, "alice", { topic: `Topic ${i}`, rounds: 2, maxParticipants: 2, startMode: "manual" }, clock.now());
      await createReport(db, { debateId: other, target: "topic", reason: "spam", reporterId: "carol" }, clock.now());
    }
    await expect(createReport(db, { debateId, target: "topic", reason: "spam", reporterId: "carol" }, clock.now())).rejects.toMatchObject({ code: "TOO_MANY" });
    clock.advance(24 * 60 * 60_000 + 1);
    await createReport(db, { debateId, target: "topic", reason: "spam", reporterId: "carol" }, clock.now());
  });
});

describe("admin actions", () => {
  it("removes one turn's text and speech, shows it as removed, and closes every report on it", async () => {
    const turn = await firstTurn();
    await db.insert(turnAudio).values({ turnId: turn.id, debateId, mimeType: "audio/mpeg", data: Buffer.from([1]), createdAt: clock.now() });
    const a = await createReport(db, { debateId, target: "turn", targetId: turn.id, reason: "offensive", reporterId: "carol" }, clock.now());
    const b = await createReport(db, { debateId, target: "turn", targetId: turn.id, reason: "offensive", reporterId: "bob" }, clock.now());
    const other = await createReport(db, { debateId, target: "topic", reason: "spam", reporterId: "carol" }, clock.now());

    await removeTurnText(db, turn.id, "admin", clock.now());
    const removed = await firstTurn();
    expect(removed).toMatchObject({ content: "", removedAt: clock.now() });
    expect(toTurnView(removed, clock.now(), null)).toMatchObject({ removed: true, content: "", reveal: null });
    expect(await db.select().from(turnAudio)).toHaveLength(0);
    expect(await statusOf(a)).toMatchObject({ status: "resolved", resolvedById: "admin", resolution: "Removed the turn's text" });
    expect((await statusOf(b)).status).toBe("resolved");
    expect((await statusOf(other)).status).toBe("open");
  });

  it("removes an agent's uploaded picture, back to its drawn face", async () => {
    await db.update(agents).set({ imageUpdatedAt: 5 }).where(eq(agents.id, adaId));
    await db.insert(agentImages).values({ agentId: adaId, mimeType: "image/webp", data: Buffer.from([1]), updatedAt: 5 });
    const id = await createReport(db, { debateId, target: "agent", targetId: (await adaEntry()).id, reason: "sexual", reporterId: "carol" }, clock.now());

    await removeAgentPicture(db, adaId, "admin", clock.now());
    expect(await db.select().from(agentImages)).toHaveLength(0);
    expect((await db.select().from(agents).where(eq(agents.id, adaId)))[0].imageUpdatedAt).toBeNull();
    expect(await statusOf(id)).toMatchObject({ status: "resolved", resolution: "Removed the agent's picture" });
  });

  it("closes the reports on an agent before it's deleted, and dismisses others", async () => {
    const onAgent = await createReport(db, { debateId, target: "agent", targetId: (await adaEntry()).id, reason: "offensive", reporterId: "carol" }, clock.now());
    const onTopic = await createReport(db, { debateId, target: "topic", reason: "other", reporterId: "carol" }, clock.now());
    await resolveAgentReports(db, adaId, "admin", clock.now());
    await dismissReport(db, onTopic, "admin", clock.now());
    expect(await statusOf(onAgent)).toMatchObject({ status: "resolved", resolution: "Deleted the agent" });
    expect(await statusOf(onTopic)).toMatchObject({ status: "dismissed" });
    expect(await openReportCount(db)).toBe(0);
  });
});
