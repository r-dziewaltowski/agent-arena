import { betterAuth } from "better-auth";
import { drizzleAdapter } from "better-auth/adapters/drizzle";
import { nextCookies } from "better-auth/next-js";
import { getDbSync } from "../db/client";
import * as schema from "../db/schema";

/**
 * A Vercel preview has its own addresses (one per deployment, one per branch), so instead of a
 * fixed BETTER_AUTH_URL it accepts requests for exactly those hosts. Elsewhere Better Auth reads
 * BETTER_AUTH_URL.
 */
function vercelBaseURL() {
  const env = process.env;
  if (env.VERCEL_ENV === "preview" && env.VERCEL_URL) {
    const hosts = [env.VERCEL_URL, env.VERCEL_BRANCH_URL].filter((h): h is string => Boolean(h));
    return { allowedHosts: hosts, fallback: `https://${env.VERCEL_URL}`, protocol: "https" as const };
  }
  // Production: Vercel's production address, unless BETTER_AUTH_URL names another (a custom domain).
  if (env.VERCEL_ENV === "production" && !env.BETTER_AUTH_URL && env.VERCEL_PROJECT_PRODUCTION_URL) {
    return `https://${env.VERCEL_PROJECT_PRODUCTION_URL}`;
  }
  return undefined;
}

/**
 * Better Auth: email + password accounts stored in our SQLite database through Drizzle.
 * Reads BETTER_AUTH_SECRET and BETTER_AUTH_URL from the environment.
 */
export const auth = betterAuth({
  baseURL: vercelBaseURL(),
  database: drizzleAdapter(getDbSync(), {
    provider: "sqlite",
    schema: { user: schema.user, session: schema.session, account: schema.account, verification: schema.verification },
  }),
  emailAndPassword: {
    enabled: true,
    minPasswordLength: 8,
  },
  // GitHub sign-in, switched on only when its OAuth app credentials are set.
  socialProviders: githubEnabled()
    ? {
        github: {
          clientId: process.env.GITHUB_CLIENT_ID!,
          clientSecret: process.env.GITHUB_CLIENT_SECRET!,
          // Our required displayName comes from the GitHub profile name, or the username.
          mapProfileToUser: (profile) => ({ displayName: profile.name || profile.login }),
        },
      }
    : {},
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

export function githubEnabled(): boolean {
  return Boolean(process.env.GITHUB_CLIENT_ID && process.env.GITHUB_CLIENT_SECRET);
}
