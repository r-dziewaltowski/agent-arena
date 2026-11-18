import { eq } from "drizzle-orm";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { createTestDb, seedUser, testClock } from "../test/helpers";
import { deleteAccount } from "./account";
import {
  ContactError,
  createMessage,
  deleteMessage,
  deleteOldMessages,
  hashIp,
  loadMessages,
  markMessageDone,
  MESSAGES_KEPT_MS,
  MESSAGES_PER_DAY,
  openMessageCount,
  type NewMessage,
} from "./contact";
import type { Db } from "./db/client";
import { contactMessages } from "./db/schema";
import { contactReceived } from "./email/templates";

let db: Db;
let cleanup: () => void;
let clock: ReturnType<typeof testClock>;

const SECRET = "test-secret";
const message = (over: Partial<NewMessage> = {}): NewMessage => ({
  topic: "privacy",
  body: "Please delete everything you have about me.",
  replyTo: "visitor@example.test",
  userId: null,
  ipHash: hashIp("203.0.113.7", clock.now(), SECRET),
  ...over,
});

beforeEach(async () => {
  ({ db, cleanup } = await createTestDb());
  clock = testClock();
  await seedUser(db, "alice");
  await seedUser(db, "admin", { isAdmin: true });
});
afterEach(() => cleanup());

describe("hashIp", () => {
  it("is stable within a day, differs across days and addresses, and doesn't contain the address", () => {
    const now = Date.UTC(2026, 10, 18, 9);
    const a = hashIp("203.0.113.7", now, SECRET);
    expect(hashIp("203.0.113.7", now + 60 * 60_000, SECRET)).toBe(a);
    expect(hashIp("203.0.113.7", now + 24 * 60 * 60_000, SECRET)).not.toBe(a);
    expect(hashIp("203.0.113.8", now, SECRET)).not.toBe(a);
    expect(hashIp("203.0.113.7", now, "another-secret")).not.toBe(a);
    expect(a).not.toContain("203");
  });
});

describe("createMessage", () => {
  it("saves the message with the reply address lowercased, open", async () => {
    const id = await createMessage(db, message({ replyTo: " Visitor@Example.TEST ", body: "  Hello there, admins.  " }), clock.now());
    const [row] = await db.select().from(contactMessages).where(eq(contactMessages.id, id));
    expect(row).toMatchObject({ topic: "privacy", body: "Hello there, admins.", replyTo: "visitor@example.test", status: "open", userId: null });
    expect(await openMessageCount(db)).toBe(1);
  });

  it(`allows ${MESSAGES_PER_DAY} a day per reply address, whatever the IP address`, async () => {
    for (let i = 0; i < MESSAGES_PER_DAY; i++) {
      await createMessage(db, message({ ipHash: hashIp(`198.51.100.${i}`, clock.now(), SECRET) }), clock.now());
    }
    await expect(createMessage(db, message({ ipHash: "fresh", replyTo: "VISITOR@example.test" }), clock.now())).rejects.toThrow(ContactError);
    // A day later it's fine again.
    clock.advance(24 * 60 * 60_000 + 1);
    await expect(createMessage(db, message({ ipHash: "fresh" }), clock.now())).resolves.toBeTruthy();
  });

  it("limits one IP address, whatever reply address it gives", async () => {
    for (let i = 0; i < MESSAGES_PER_DAY; i++) await createMessage(db, message({ replyTo: `someone${i}@example.test` }), clock.now());
    await expect(createMessage(db, message({ replyTo: "another@example.test" }), clock.now())).rejects.toThrow(ContactError);
  });

  it("limits one account, whatever addresses it gives", async () => {
    for (let i = 0; i < MESSAGES_PER_DAY; i++) {
      await createMessage(db, message({ userId: "alice", replyTo: `alice${i}@example.test`, ipHash: `ip${i}` }), clock.now());
    }
    await expect(createMessage(db, message({ userId: "alice", replyTo: "new@example.test", ipHash: "new" }), clock.now())).rejects.toThrow(ContactError);
  });
});

describe("admin actions and cleanup", () => {
  it("marks a message done, and lists open ones oldest first", async () => {
    const first = await createMessage(db, message({ replyTo: "one@example.test", ipHash: "1" }), clock.now());
    clock.advance(1000);
    const second = await createMessage(db, message({ replyTo: "two@example.test", ipHash: "2" }), clock.now());
    expect((await loadMessages(db)).open.map((m) => m.id)).toEqual([first, second]);

    await markMessageDone(db, first, "admin", clock.now());
    const { open, done } = await loadMessages(db);
    expect(open.map((m) => m.id)).toEqual([second]);
    expect(done.map((m) => m.id)).toEqual([first]);
    expect(await openMessageCount(db)).toBe(1);

    await deleteMessage(db, second);
    expect(await openMessageCount(db)).toBe(0);
  });

  it("deletes messages older than six months, done or not", async () => {
    const old = await createMessage(db, message({ replyTo: "old@example.test", ipHash: "1" }), clock.now());
    clock.advance(MESSAGES_KEPT_MS - 1000);
    const recent = await createMessage(db, message({ replyTo: "new@example.test", ipHash: "2" }), clock.now());
    clock.advance(2000);
    await deleteOldMessages(db, clock.now());
    const ids = (await db.select({ id: contactMessages.id }).from(contactMessages)).map((r) => r.id);
    expect(ids).toEqual([recent]);
    expect(ids).not.toContain(old);
  });

  it("deletes the messages someone sent while signed in when they delete their account", async () => {
    await createMessage(db, message({ userId: "alice", replyTo: "alice@example.test", ipHash: "1" }), clock.now());
    const visitor = await createMessage(db, message({ replyTo: "visitor@example.test", ipHash: "2" }), clock.now());
    await deleteAccount(db, "alice", clock.now());
    const ids = (await db.select({ id: contactMessages.id }).from(contactMessages)).map((r) => r.id);
    expect(ids).toEqual([visitor]);
  });
});

describe("contactReceived", () => {
  it("sets Reply-To to the sender and escapes the message in the HTML", () => {
    const email = contactReceived(
      "admin@example.test",
      { topic: "Privacy or my data", body: "Hi <b>admins</b>\n\nSecond paragraph", replyTo: "visitor@example.test", senderName: null },
      "https://example.test/admin#messages",
    );
    expect(email.replyTo).toBe("visitor@example.test");
    expect(email.subject).toBe("Message on Agent Arena: Privacy or my data");
    expect(email.text).toContain("Hi <b>admins</b>\n\nSecond paragraph");
    expect(email.html).toContain("Hi &lt;b&gt;admins&lt;/b&gt;");
    expect(email.html).not.toContain("<b>admins</b>");
  });
});
