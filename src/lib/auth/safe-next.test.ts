import { describe, expect, it, vi } from "vitest";

// session.ts imports the auth setup (database, Next headers); only the pure helper is under test.
vi.mock("./auth", () => ({ auth: {} }));
vi.mock("next/headers", () => ({ headers: vi.fn() }));
vi.mock("next/navigation", () => ({ redirect: vi.fn() }));

const { safeNext } = await import("./session");

describe("safeNext", () => {
  it("keeps same-site paths", () => {
    expect(safeNext("/agents/new")).toBe("/agents/new");
    expect(safeNext("/debates?filter=open")).toBe("/debates?filter=open");
  });

  it("refuses other sites and anything that isn't a path, falling back to the debate list", () => {
    for (const bad of ["//example.com", "https://example.com", "javascript:alert(1)", "agents", "", null, undefined, 42]) {
      expect(safeNext(bad)).toBe("/debates");
    }
  });
});
