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
  // Public: the debate list and pages, public agent pages, sign-in/up.
  matcher: ["/agents", "/agents/new", "/agents/:id/edit", "/debates/new"],
};
