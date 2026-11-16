/**
 * Sign-in through another service's account (OAuth). Each provider is switched on only when its
 * OAuth client credentials are set, so a fresh checkout (or the end-to-end tests) simply has none.
 */
export const SOCIAL_PROVIDERS = ["google", "github"] as const;
export type SocialProvider = (typeof SOCIAL_PROVIDERS)[number];

export const SOCIAL_LABELS: Record<SocialProvider, string> = { google: "Google", github: "GitHub" };

const CREDENTIALS: Record<SocialProvider, [id: string, secret: string]> = {
  google: ["GOOGLE_CLIENT_ID", "GOOGLE_CLIENT_SECRET"],
  github: ["GITHUB_CLIENT_ID", "GITHUB_CLIENT_SECRET"],
};

/** The providers whose credentials are set, in the order their buttons appear. */
export function enabledSocialProviders(env: Record<string, string | undefined> = process.env): SocialProvider[] {
  return SOCIAL_PROVIDERS.filter((p) => CREDENTIALS[p].every((name) => Boolean(env[name])));
}

export function socialCredentials(provider: SocialProvider, env: Record<string, string | undefined> = process.env) {
  const [id, secret] = CREDENTIALS[provider];
  return { clientId: env[id] ?? "", clientSecret: env[secret] ?? "" };
}

export function isSocialProvider(value: unknown): value is SocialProvider {
  return typeof value === "string" && (SOCIAL_PROVIDERS as readonly string[]).includes(value);
}

/** Why a sign-in through `provider` came back without signing in (Better Auth's error codes). */
export function socialErrorMessage(error: string, provider: SocialProvider | null): string {
  const name = provider ? SOCIAL_LABELS[provider] : "That";
  if (error === "account_not_linked") {
    return `An account with your ${name} email already exists. Sign in with your email and password instead.`;
  }
  if (error === "access_denied") return `${name} sign-in was cancelled.`;
  return `${name} sign-in didn't complete. Please try again.`;
}
