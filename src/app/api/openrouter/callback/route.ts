import { cookies } from "next/headers";
import { getCurrentUser } from "@/lib/auth/session";
import { getDb } from "@/lib/db/client";
import { exchangeCode, openPkceCookie, PKCE_COOKIE, saveConnection } from "@/lib/openrouter";

/**
 * Where OpenRouter sends the user back after "Connect": checks the one-time state against the
 * cookie set by `connectOpenRouterAction`, swaps the code for the user's key and stores it.
 */
export async function GET(request: Request) {
  const url = new URL(request.url);
  // A relative redirect: behind a proxy (or bound to 0.0.0.0) the request's own origin isn't the
  // address the browser used. Not Response.redirect: its headers are read-only, and Next adds the
  // cookie deletion to them.
  const redirectTo = (path: string) => new Response(null, { status: 303, headers: { location: path } });
  const back = (result: string) => redirectTo(`/account?openrouter=${result}`);

  const me = await getCurrentUser();
  if (!me) return redirectTo("/sign-in?next=%2Faccount");

  const cookieStore = await cookies();
  const verifier = openPkceCookie(cookieStore.get(PKCE_COOKIE)?.value, { state: url.searchParams.get("state") ?? "", userId: me.id });
  cookieStore.delete({ name: PKCE_COOKIE, path: url.pathname });
  const code = url.searchParams.get("code");
  if (!code) return back("cancelled");
  if (!verifier) return back("expired");

  try {
    await saveConnection(await getDb(), me.id, await exchangeCode(code, verifier));
  } catch (err) {
    console.error("[openrouter] connecting failed:", err instanceof Error ? err.message : err);
    return back("failed");
  }
  return back("connected");
}
