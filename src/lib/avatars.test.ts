import { describe, expect, it } from "vitest";
import { avatarUrl, generatedAvatarUrl, MAX_SEED_LENGTH, randomSeed, sniffImageType } from "./avatars";

describe("avatarUrl", () => {
  it("uses the uploaded picture, versioned, when there is one", () => {
    expect(avatarUrl({ id: "a1", imageUpdatedAt: 123, avatarSeed: "x" })).toBe("/api/agents/a1/image?v=123");
  });

  it("otherwise a generated face from the seed, or from the id", () => {
    expect(avatarUrl({ id: "a1", imageUpdatedAt: null, avatarSeed: "x y" })).toBe("/api/avatars/x%20y");
    expect(avatarUrl({ id: "a1", avatarSeed: "" })).toBe("/api/avatars/a1");
    expect(avatarUrl({ id: "a1" })).toBe("/api/avatars/a1");
  });

  it("keeps seeds short and safe in the address", () => {
    expect(generatedAvatarUrl("a/b?c")).toBe("/api/avatars/a%2Fb%3Fc");
    expect(generatedAvatarUrl("x".repeat(500))).toBe(`/api/avatars/${"x".repeat(MAX_SEED_LENGTH)}`);
    expect(randomSeed()).toMatch(/^[a-z0-9]+$/);
  });
});

describe("sniffImageType", () => {
  const bytes = (...parts: (string | number[])[]) =>
    Uint8Array.from(parts.flatMap((p) => (typeof p === "string" ? [...p].map((c) => c.charCodeAt(0)) : p)));

  it("recognises WebP, JPEG and PNG by their first bytes", () => {
    expect(sniffImageType(bytes("RIFF", [0, 0, 0, 0], "WEBPVP8 "))).toBe("image/webp");
    expect(sniffImageType(bytes([0xff, 0xd8, 0xff, 0xe0]))).toBe("image/jpeg");
    expect(sniffImageType(bytes([0x89], "PNG", [0x0d, 0x0a, 0x1a, 0x0a]))).toBe("image/png");
  });

  it("rejects anything else, whatever it claims to be", () => {
    expect(sniffImageType(bytes("<svg onload=alert(1)>"))).toBeNull();
    expect(sniffImageType(bytes("GIF89a"))).toBeNull();
    expect(sniffImageType(new Uint8Array())).toBeNull();
  });
});
