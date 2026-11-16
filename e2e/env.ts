/**
 * Environment of the app under end-to-end test: a production build on port 3100 with a throwaway
 * database, the scripted fake model and the local QStash dev server. Nothing here is a secret:
 * the QStash values are the dev server's published test credentials, and the auth secret only
 * signs sessions in the test database.
 */
export const E2E_PORT = 3100;
export const E2E_BASE_URL = `http://localhost:${E2E_PORT}`;
export const QSTASH_DEV_URL = "http://127.0.0.1:8080";
/** Emails the app "sends" during the tests land here, one JSON object per line. */
export const EMAIL_OUTBOX_FILE = "data/e2e-outbox.jsonl";
/** A fake OpenRouter (started by scripts/e2e-server.ts) that approves every connect request. */
export const FAKE_OPENROUTER_PORT = 3101;

export const e2eEnv: Record<string, string> = {
  NODE_ENV: "production",
  NEXT_DIST_DIR: ".next-e2e",
  DATABASE_URL: "file:./data/e2e.db",
  BETTER_AUTH_SECRET: "e2e-test-secret-only-for-the-throwaway-test-database",
  BETTER_AUTH_URL: E2E_BASE_URL,
  // The QStash dev server runs in Docker and reaches this machine through host.docker.internal.
  APP_URL: `http://host.docker.internal:${E2E_PORT}`,
  E2E_FAKE_MODEL: "1",
  // Makes the Groq models selectable; the fake model answers instead, so this key is never used.
  GROQ_API_KEY: "e2e-fake-key-never-sent",
  // Google stays off, so the model picker matches what the tests expect.
  GOOGLE_GENERATIVE_AI_API_KEY: "",
  // An address where nothing listens, so the model list doesn't depend on a local Ollama.
  OLLAMA_BASE_URL: "http://127.0.0.1:9/api",
  QSTASH_URL: QSTASH_DEV_URL,
  // The QStash dev server's built-in test user (the same for every copy of the dev server).
  QSTASH_TOKEN: "eyJVc2VySUQiOiJkZWZhdWx0VXNlciIsIlBhc3N3b3JkIjoiZGVmYXVsdFBhc3N3b3JkIn0=",
  QSTASH_CURRENT_SIGNING_KEY: "sig_7kYjw48mhY7kAjqNGcy6cr29RJ6r",
  QSTASH_NEXT_SIGNING_KEY: "sig_5ZB6DVzB1wjE8S6rZ7eenA8Pdnhs",
  // Google and GitHub sign-in stay off in the tests, even if .env.local sets them up.
  GITHUB_CLIENT_ID: "",
  GITHUB_CLIENT_SECRET: "",
  GOOGLE_CLIENT_ID: "",
  GOOGLE_CLIENT_SECRET: "",
  // No real email: everything goes to the outbox file, where the tests read the links.
  GMAIL_USER: "",
  GMAIL_APP_PASSWORD: "",
  EMAIL_OUTBOX_FILE,
  // Paid models: the fake OpenRouter hands out keys; this secret only encrypts them in the test database.
  OPENROUTER_URL: `http://localhost:${FAKE_OPENROUTER_PORT}`,
  USER_API_KEYS_ENCRYPTION_SECRET: "ZTJlLXRlc3Qtb25seS1lbmNyeXB0aW9uLXNlY3JldCE=",
};
