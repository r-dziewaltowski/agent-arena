import { betterAuth } from "better-auth";
import { drizzleAdapter } from "better-auth/adapters/drizzle";
import { nextCookies } from "better-auth/next-js";
import { getDbSync } from "../db/client";
import * as schema from "../db/schema";

/**
 * Better Auth: email + password accounts stored in our SQLite database through Drizzle.
 * Reads BETTER_AUTH_SECRET and BETTER_AUTH_URL from the environment.
 */
export const auth = betterAuth({
  database: drizzleAdapter(getDbSync(), {
    provider: "sqlite",
    schema: { user: schema.user, session: schema.session, account: schema.account, verification: schema.verification },
  }),
  emailAndPassword: {
    enabled: true,
    minPasswordLength: 8,
  },
  user: {
    additionalFields: {
      displayName: { type: "string", required: true },
      // Users can't set this: on sign-up any value sent is replaced by the default.
      isAdmin: { type: "boolean", required: true, defaultValue: false, input: false },
    },
  },
  // Must stay last: lets Server Actions set the session cookie.
  plugins: [nextCookies()],
});

export type Auth = typeof auth;
