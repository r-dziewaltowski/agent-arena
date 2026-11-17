import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    include: ["src/**/*.test.ts"],
    environment: "node",
    globalSetup: ["src/test/global-setup.ts"],
    testTimeout: 20_000,
    // No reading pace, so tests run turn after turn; the pacing tests set a pace explicitly.
    env: { DEBATE_READING_WORDS_PER_SECOND: "0" },
  },
});
