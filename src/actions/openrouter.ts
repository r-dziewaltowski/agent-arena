"use server";

import { refresh } from "next/cache";
import { cookies, headers } from "next/headers";
import { redirect } from "next/navigation";
import { requireUser } from "@/lib/auth/session";
import { getDb } from "@/lib/db/client";
import {
  authorizeUrl,
  CALLBACK_PATH,
  createPkce,
  deleteConnection,
  PKCE_COOKIE,
  PKCE_COOKIE_MAX_AGE_S,
  sealPkceCookie,
} from "@/lib/openrouter";
import { encryptionConfigured } from "@/lib/secrets";

/** Sends the user to OpenRouter to approve a key for this app; they come back to the callback. */
export async function connectOpenRouterAction() {
  const me = await requireUser("/account");
  if (!encryptionConfigured()) redirect("/account?openrouter=unavailable");

  const { verifier, challenge, state } = createPkce();
  const h = await headers();
  const proto = h.get("x-forwarded-proto") ?? "http";
  const origin = `${proto}://${h.get("x-forwarded-host") ?? h.get("host")}`;
  (await cookies()).set(PKCE_COOKIE, sealPkceCookie({ verifier, state, userId: me.id }), {
    httpOnly: true,
    secure: proto === "https",
    sameSite: "lax", // sent on the top-level navigation back from OpenRouter
    path: CALLBACK_PATH,
    maxAge: PKCE_COOKIE_MAX_AGE_S,
  });
  redirect(authorizeUrl({ callbackUrl: `${origin}${CALLBACK_PATH}`, challenge, state }));
}

/** Forgets the stored key. Revoking it on OpenRouter is up to the user (the page says so). */
export async function disconnectOpenRouterAction() {
  const me = await requireUser("/account");
  await deleteConnection(await getDb(), me.id);
  refresh();
  redirect("/account?openrouter=disconnected");
}
