import { eq } from "drizzle-orm";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { createTestDb, resolverFor, scriptedModel, seedAgent, seedUser, testClock } from "../test/helpers";
import { deleteAccount } from "./account";
import {
  CHAT_GRACE_MS,
  chatOpen,
  ChatError,
  COMMENT_GAP_MS,
  COMMENT_MAX_LENGTH,
  COMMENTS_PER_DEBATE,
  commentsSince,
  commentViews,
  createComment,
  deleteOwnComment,
  loadComments,
  roleOf,
} from "./chat";
import { cleanComment } from "./chat-shared";
import type { Db } from "./db/client";
import { debateComments, debates, reports, turns } from "./db/schema";
import { runStep } from "./debate/engine";
import { createDebate, deleteDebate, enter, startDebate } from "./debate/lifecycle";
import { createReport, removeComment, ReportError } from "./reports";

let db: Db;
let cleanup: () => void;
let clock: ReturnType<typeof testClock>;
let debateId: string;

beforeEach(async () => {
  ({ db, cleanup } = await createTestDb());
  clock = testClock();
  for (const id of ["alice", "bob", "carol", "dan"]) await seedUser(db, id);
  await seedUser(db, "admin", { isAdmin: true });
  debateId = await createDebate(db, "alice", { topic: "Should cities ban cars?", rounds: 2, maxParticipants: 2, startMode: "manual" }, clock.now());
  await enter(db, { debateId, userId: "alice", agentId: await seedAgent(db, "alice", { name: "Ada" }), position: 1 });
  await enter(db, { debateId, userId: "bob", agentId: await seedAgent(db, "bob", { name: "Bram" }), position: 2 });
  await startDebate(db, { debateId, userId: "alice" }, clock.now());
});
afterEach(() => cleanup());

const post = (userId: string, body = "Great point!", id = debateId) => createComment(db, { debateId: id, userId, body }, clock.now(), null);
const expectError = async (p: Promise<unknown>, code: ChatError["code"]) => {
  await expect(p).rejects.toBeInstanceOf(ChatError);
  await expect(p).rejects.toMatchObject({ code });
};

describe("chatOpen", () => {
  const turn = (revealEndsAt: number | null, kind = "turn") => ({ kind, content: "Cars must go.", revealStartedAt: revealEndsAt && revealEndsAt - 1000, revealEndsAt });

  it("is open while the debate runs, and never in the lobby or once cancelled", () => {
    expect(chatOpen("running", [], 0, 4.5)).toBe(true);
    expect(chatOpen("open", [], 0, 4.5)).toBe(false);
    expect(chatOpen("cancelled", [turn(5000)], 0, 4.5)).toBe(false);
  });

  it("stays open after the debate finishes until its last turn has been shown, plus the grace", () => {
    const shown = [turn(2000), turn(9000)];
    expect(chatOpen("completed", shown, 8000, 4.5)).toBe(true);
    expect(chatOpen("completed", shown, 9000, 4.5)).toBe(false);
    expect(chatOpen("failed", shown, 8000, 4.5)).toBe(true);
    expect(chatOpen("completed", shown, 9000 + CHAT_GRACE_MS - 1, 4.5, CHAT_GRACE_MS)).toBe(true);
    expect(chatOpen("completed", shown, 9000 + CHAT_GRACE_MS, 4.5, CHAT_GRACE_MS)).toBe(false);
  });

  it("ignores summaries, and closes at once for a finished debate run without pacing", () => {
    expect(chatOpen("completed", [turn(2000), turn(9000, "summary")], 5000, 4.5)).toBe(false);
    expect(chatOpen("completed", [{ kind: "turn", content: "Hi", revealStartedAt: null, revealEndsAt: null }], 0, null)).toBe(false);
  });
});

describe("createComment", () => {
  it("saves a tidied comment while the debate runs", async () => {
    const id = await post("carol", "  Ada is\nwinning \u0007this ");
    const [row] = await db.select().from(debateComments).where(eq(debateComments.id, id));
    expect(row).toMatchObject({ body: "Ada is winning this", userId: "carol", debateId, createdAt: clock.now(), deletedAt: null });
  });

  it("refuses empty and overlong comments", async () => {
    await expectError(post("carol", " \n "), "EMPTY");
    await expectError(post("carol", "x".repeat(COMMENT_MAX_LENGTH + 1)), "TOO_LONG");
    await post("carol", "x".repeat(COMMENT_MAX_LENGTH));
  });

  it("allows one comment every 10 seconds per person", async () => {
    await post("carol");
    await post("dan"); // someone else isn't held up
    clock.advance(COMMENT_GAP_MS - 2000);
    await expect(post("carol")).rejects.toThrow("Wait 2 seconds");
    clock.advance(2000);
    await post("carol");
  });

  it("allows 30 comments per person per debate, deleted ones included", async () => {
    for (let i = 0; i < COMMENTS_PER_DEBATE; i++) {
      const id = await post("carol", `Comment ${i}`);
      if (i === 0) await deleteOwnComment(db, id, "carol", clock.now());
      clock.advance(COMMENT_GAP_MS);
    }
    await expectError(post("carol"), "TOO_MANY");
  });

  it("is closed in the lobby, once viewers have seen the last turn, and for a missing debate", async () => {
    const lobby = await createDebate(db, "dan", { topic: "Tea or coffee?", rounds: 2, maxParticipants: 2, startMode: "manual" }, clock.now());
    await expectError(post("carol", "Hi", lobby), "CLOSED");
    await expectError(post("carol", "Hi", "nope"), "NOT_FOUND");

    await runStep(db, debateId, { resolveModel: resolverFor(scriptedModel(["Cars must go."])), now: clock.now, wordsPerSecond: null });
    await db.update(turns).set({ revealStartedAt: clock.now() - 5000, revealEndsAt: clock.now() + 1000 }).where(eq(turns.debateId, debateId));
    await db.update(debates).set({ status: "completed" }).where(eq(debates.id, debateId));
    await post("carol"); // the last turn is still being shown
    clock.advance(1000 + CHAT_GRACE_MS);
    await expectError(post("dan"), "CLOSED");
  });
});

describe("deleting and loading comments", () => {
  it("lets only the author delete a comment; polls learn it's gone, the page leaves it out", async () => {
    const since = clock.now();
    const id = await post("carol", "Oops");
    clock.advance(COMMENT_GAP_MS);
    await post("dan", "Hello");
    expect(await deleteOwnComment(db, id, "dan", clock.now())).toBe(false);
    clock.advance(60_000);
    expect(await deleteOwnComment(db, id, "carol", clock.now())).toBe(true);

    const page = await commentViews(db, debateId, await loadComments(db, debateId), "dan");
    expect(page.map((c) => c.body)).toEqual(["Hello"]);
    // A poll since just now hears about the deletion only.
    const polled = await commentViews(db, debateId, await commentsSince(db, debateId, clock.now()), null);
    expect(polled).toEqual([expect.objectContaining({ id, gone: true, body: "" })]);
    // A poll from the start gets both, oldest first.
    expect((await commentsSince(db, debateId, since)).map((c) => c.userId)).toEqual(["carol", "dan"]);
  });

  it("shows a comment an admin removed as removed", async () => {
    const id = await post("carol", "Something rude");
    await createReport(db, { debateId, target: "comment", targetId: id, reason: "offensive", reporterId: "dan" }, clock.now());
    await removeComment(db, id, "admin", clock.now());
    const [view] = await commentViews(db, debateId, await loadComments(db, debateId), null);
    expect(view).toMatchObject({ id, removed: true, gone: false, body: "" });
    const [report] = await db.select().from(reports).where(eq(reports.commentId, id));
    expect(report).toMatchObject({ status: "resolved", resolution: "Removed the comment" });
  });
});

describe("comment views", () => {
  it("names who has a stake: an agent's owner or the debate's creator", async () => {
    const stakes = { creatorId: "carol", agents: [{ userId: "alice", name: "Ada" }, { userId: "bob", name: "Bram" }, { userId: "bob", name: "Bo" }] };
    expect(roleOf("alice", stakes)).toBe("owner of Ada");
    expect(roleOf("bob", stakes)).toBe("owner of Bram and Bo");
    expect(roleOf("carol", stakes)).toBe("created the debate");
    expect(roleOf("dan", stakes)).toBeNull();
  });

  it("marks the viewer's own comments and uses display names", async () => {
    await post("alice", "Go Ada");
    clock.advance(1);
    await post("dan", "Go Bram");
    const views = await commentViews(db, debateId, await loadComments(db, debateId), "dan");
    expect(views).toEqual([
      expect.objectContaining({ author: "alice", role: "owner of Ada", mine: false }),
      expect.objectContaining({ author: "dan", role: null, mine: true }),
    ]);
  });

  it("cleans comments to one line", () => {
    expect(cleanComment("a\r\n\tb  ")).toBe("a b");
  });
});

describe("reports, deleting the debate or an account", () => {
  it("reports a comment once, never your own or a deleted one", async () => {
    const id = await post("carol", "Buy my course");
    await expect(createReport(db, { debateId, target: "comment", targetId: id, reason: "spam", reporterId: "carol" }, clock.now())).rejects.toBeInstanceOf(ReportError);
    await createReport(db, { debateId, target: "comment", targetId: id, reason: "spam", reporterId: "dan" }, clock.now());
    await expect(createReport(db, { debateId, target: "comment", targetId: id, reason: "spam", reporterId: "dan" }, clock.now())).rejects.toMatchObject({ code: "DUPLICATE" });
    await deleteOwnComment(db, id, "carol", clock.now());
    await expect(createReport(db, { debateId, target: "comment", targetId: id, reason: "spam", reporterId: "alice" }, clock.now())).rejects.toMatchObject({ code: "NOT_FOUND" });
  });

  it("goes with the debate, and with its author's account", async () => {
    const id = await post("carol");
    await post("dan");
    await createReport(db, { debateId, target: "comment", targetId: id, reason: "spam", reporterId: "dan" }, clock.now());
    await deleteAccount(db, "carol", clock.now());
    expect((await db.select().from(debateComments)).map((c) => c.userId)).toEqual(["dan"]);
    expect(await db.select().from(reports)).toHaveLength(0);

    await deleteDebate(db, { debateId, userId: "admin", isAdmin: true });
    expect(await db.select().from(debateComments)).toHaveLength(0);
  });
});
