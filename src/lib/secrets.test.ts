import { randomBytes } from "node:crypto";
import { describe, expect, it } from "vitest";
import { decryptSecret, encryptSecret } from "./secrets";

const secret = randomBytes(32).toString("base64");

describe("encryptSecret / decryptSecret", () => {
  it("round-trips, with a fresh nonce each time and the plain text nowhere in the output", () => {
    const a = encryptSecret("sk-or-v1-abc", secret);
    const b = encryptSecret("sk-or-v1-abc", secret);
    expect(a).not.toBe(b);
    expect(a).not.toContain("sk-or");
    expect(a.startsWith("v1:")).toBe(true);
    expect(decryptSecret(a, secret)).toBe("sk-or-v1-abc");
  });

  it("refuses altered values and other secrets", () => {
    const value = encryptSecret("sk-or-v1-abc", secret);
    const parts = value.split(":");
    const flipped = Buffer.from(parts[3], "base64url");
    flipped[0] ^= 1;
    expect(() => decryptSecret([...parts.slice(0, 3), flipped.toString("base64url")].join(":"), secret)).toThrow();
    expect(() => decryptSecret(value, randomBytes(32).toString("base64"))).toThrow();
    expect(() => decryptSecret("plain-text", secret)).toThrow("Not an encrypted value.");
  });

  it("insists on a 32-byte secret", () => {
    expect(() => encryptSecret("x", "too-short")).toThrow(/USER_API_KEYS_ENCRYPTION_SECRET/);
  });
});
