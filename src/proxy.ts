import { getSessionCookie } from "better-auth/cookies";
import { NextResponse, type NextRequest } from "next/server";

/**
 * Sends visitors without a session cookie to sign in on pages that need an account. This only
 * checks that a cookie is present; real authorization happens in pages and actions.
 */
export function proxy(request: NextRequest) {
  if (getSessionCookie(request)) return NextResponse.next();
  const url = new URL("/sign-in", request.url);
  url.searchParams.set("next", request.nextUrl.pathname);
  return NextResponse.redirect(url);
}

export const config = {
  // Public: the debate list and pages, public agent pages, sign-in/up. Keep in step with
  // src/lib/auth/protected-paths.ts (this matcher must be a literal, so it can't import that).
  matcher: ["/agents", "/agents/new", "/agents/:id/edit", "/debates/new"],
};
