import { randomUUID } from "node:crypto";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { TEST_DB_DIR } from "../../test/helpers";
import { outboxSender } from "./send";
import { confirmEmail, resetPassword } from "./templates";

describe("email", () => {
  it("writes outbox emails to the file, so end-to-end tests can follow their links", async () => {
    const file = join(TEST_DB_DIR, `outbox-${randomUUID()}.jsonl`);
    await outboxSender(file).send(confirmEmail("ada@example.test", "Ada", "http://localhost/confirm?token=abc"));
    const [line] = readFileSync(file, "utf8").trim().split("\n");
    expect(JSON.parse(line)).toMatchObject({ to: "ada@example.test", subject: "Confirm your email for Agent Arena" });
  });

  it("puts the link in both versions and escapes names in the HTML", () => {
    const email = resetPassword("x@example.test", "<b>Bob</b>", "http://localhost/reset?token=1&x=2");
    expect(email.text).toContain("http://localhost/reset?token=1&x=2");
    expect(email.html).toContain("http://localhost/reset?token=1&amp;x=2");
    expect(email.html).toContain("&lt;b&gt;Bob&lt;/b&gt;");
    expect(email.html).not.toContain("<b>Bob</b>");
  });
});
