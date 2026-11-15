/**
 * Loads `.env.local` (then `.env`) for terminal scripts, which, unlike Next.js, don't read them
 * on their own. Values already set in the environment win. Missing files are fine.
 */
for (const file of [".env.local", ".env"]) {
  try {
    process.loadEnvFile(file);
  } catch {
    // no such file
  }
}

export {};
