/**
 * Pages that need a signed-in user. Keep in step with the matcher in src/proxy.ts, which must be
 * a literal and so can't import this.
 */
const PATTERNS = [/^\/account$/, /^\/agents$/, /^\/agents\/new$/, /^\/agents\/[^/]+\/edit$/, /^\/debates\/new$/];

export function requiresSignIn(path: string): boolean {
  const pathname = path.split(/[?#]/)[0];
  return PATTERNS.some((p) => p.test(pathname));
}

/** Where to go after signing out from `path`: stay there, unless it needs an account. */
export function afterSignOut(path: string): string {
  return requiresSignIn(path) ? "/debates" : path;
}
