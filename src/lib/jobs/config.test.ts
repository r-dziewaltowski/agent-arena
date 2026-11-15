import { afterEach, describe, expect, it, vi } from "vitest";
import { appUrl } from "./config";

afterEach(() => vi.unstubAllEnvs());

function env(vars: Record<string, string | undefined>) {
  for (const key of ["APP_URL", "BETTER_AUTH_URL", "VERCEL_ENV", "VERCEL_URL", "VERCEL_PROJECT_PRODUCTION_URL"]) {
    vi.stubEnv(key, vars[key]);
  }
  vi.stubEnv("NODE_ENV", vars.NODE_ENV ?? "development");
}

describe("appUrl", () => {
  it("reaches this machine from Docker in development", () => {
    env({ BETTER_AUTH_URL: "http://localhost:3000" });
    expect(appUrl()).toBe("http://host.docker.internal:3000");
  });

  it("uses a Vercel preview's own deployment address, even when APP_URL is set", () => {
    env({ VERCEL_ENV: "preview", VERCEL_URL: "agent-arena-abc123.vercel.app", APP_URL: "https://prod.example" });
    expect(appUrl()).toBe("https://agent-arena-abc123.vercel.app");
  });

  it("uses Vercel's production address unless APP_URL overrides it", () => {
    env({ NODE_ENV: "production", VERCEL_ENV: "production", VERCEL_PROJECT_PRODUCTION_URL: "agent-arena.vercel.app" });
    expect(appUrl()).toBe("https://agent-arena.vercel.app");
    env({
      NODE_ENV: "production",
      VERCEL_ENV: "production",
      VERCEL_PROJECT_PRODUCTION_URL: "agent-arena.vercel.app",
      APP_URL: "https://arena.example/",
    });
    expect(appUrl()).toBe("https://arena.example");
  });

  it("falls back to BETTER_AUTH_URL on other production hosts", () => {
    env({ NODE_ENV: "production", BETTER_AUTH_URL: "https://arena.example" });
    expect(appUrl()).toBe("https://arena.example");
  });
});
