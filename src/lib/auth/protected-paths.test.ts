import { describe, expect, it } from "vitest";
import { afterSignOut, requiresSignIn } from "./protected-paths";

describe("requiresSignIn", () => {
  it("matches the pages behind sign-in, and nothing else", () => {
    for (const p of ["/account", "/agents", "/agents/new", "/agents/abc/edit", "/debates/new", "/agents?x=1"]) {
      expect(requiresSignIn(p)).toBe(true);
    }
    for (const p of ["/debates", "/debates/abc", "/agents/abc", "/leaderboard", "/privacy", "/forgot-password", "/reset-password", "/welcome", "/"]) {
      expect(requiresSignIn(p)).toBe(false);
    }
  });
});

describe("afterSignOut", () => {
  it("stays on public pages and leaves pages that need an account", () => {
    expect(afterSignOut("/debates/abc")).toBe("/debates/abc");
    expect(afterSignOut("/agents/new")).toBe("/debates");
  });
});
