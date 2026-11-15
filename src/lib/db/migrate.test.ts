import { randomUUID } from "node:crypto";
import { mkdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { createClient } from "@libsql/client";
import { describe, expect, it } from "vitest";
import { TEST_DB_DIR } from "../../test/helpers";

describe("migration 0003 (unique agent names)", () => {
  it("renames existing duplicates per owner, ignoring case, then enforces uniqueness", async () => {
    mkdirSync(TEST_DB_DIR, { recursive: true });
    const client = createClient({ url: `file:${join(TEST_DB_DIR, `${randomUUID()}.db`).replaceAll("\\", "/")}` });
    // Just the columns the migration touches.
    await client.execute("CREATE TABLE agents (id TEXT PRIMARY KEY, owner_id TEXT, name TEXT, created_at INTEGER)");
    const rows: [string, string, string, number][] = [
      ["a1", "alice", "Ada", 1],
      ["a2", "alice", "ada", 2],
      ["a3", "alice", "Ada", 3],
      ["a4", "alice", "Bram", 4],
      ["b1", "bob", "Ada", 5], // another owner may keep the same name
    ];
    for (const r of rows) await client.execute({ sql: "INSERT INTO agents VALUES (?, ?, ?, ?)", args: r });

    const sql = readFileSync(join(process.cwd(), "drizzle", "0003_unique_agent_names.sql"), "utf8");
    for (const statement of sql.split("--> statement-breakpoint")) await client.execute(statement);

    const names = Object.fromEntries((await client.execute("SELECT id, name FROM agents")).rows.map((r) => [r.id, r.name]));
    expect(names).toEqual({ a1: "Ada", a2: "ada (2)", a3: "Ada (3)", a4: "Bram", b1: "Ada" });
    await expect(client.execute("INSERT INTO agents VALUES ('a5', 'alice', 'BRAM', 6)")).rejects.toThrow(/UNIQUE/);
    client.close();
  });
});
