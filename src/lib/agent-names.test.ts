import { afterEach, beforeEach, describe, expect, it } from "vitest";
import type { Db } from "./db/client";
import { agents } from "./db/schema";
import { createTestDb, seedAgent, seedUser } from "../test/helpers";
import { isAgentNameTaken } from "./agent-names";

let db: Db;
let cleanup: () => void;

beforeEach(async () => {
  ({ db, cleanup } = await createTestDb());
  await seedUser(db, "alice");
  await seedUser(db, "bob");
});
afterEach(() => cleanup());

describe("agent names", () => {
  it("are taken per owner, ignoring case and spaces, but not by the agent being edited", async () => {
    const ada = await seedAgent(db, "alice", { name: "Ada" });
    expect(await isAgentNameTaken(db, "alice", "ada")).toBe(true);
    expect(await isAgentNameTaken(db, "alice", "  ADA ")).toBe(true);
    expect(await isAgentNameTaken(db, "alice", "Ada", ada)).toBe(false); // renaming Ada to Ada
    expect(await isAgentNameTaken(db, "alice", "Bram")).toBe(false);
    expect(await isAgentNameTaken(db, "bob", "Ada")).toBe(false); // other users may use it
  });

  it("are unique in the database too, so two saves at once can't both win", async () => {
    await seedAgent(db, "alice", { name: "Ada" });
    await expect(seedAgent(db, "alice", { name: "ADA" })).rejects.toThrow();
    await expect(seedAgent(db, "bob", { name: "Ada" })).resolves.toBeTruthy();
    expect((await db.select().from(agents)).length).toBe(2);
  });
});
