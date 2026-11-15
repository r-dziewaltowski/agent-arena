"use server";

import { APIError } from "better-auth/api";
import { headers } from "next/headers";
import { redirect } from "next/navigation";
import { z } from "zod";
import { auth } from "@/lib/auth/auth";
import { afterSignOut } from "@/lib/auth/protected-paths";
import { safeNext } from "@/lib/auth/session";
import { pickValues, type FormValues } from "@/lib/form-values";

export type AuthFormState = { message?: string; errors?: Partial<Record<string, string[]>>; values?: FormValues };

// Handed back on errors so the form keeps what was typed (passwords never are).
const SIGN_UP_FIELDS = ["displayName", "email"] as const;
const SIGN_IN_FIELDS = ["email"] as const;

const signUpSchema = z.object({
  displayName: z.string().trim().min(2, "At least 2 characters.").max(40),
  email: z.email("Enter a valid email address."),
  password: z.string().min(8, "At least 8 characters.").max(128),
});

export async function signUpAction(_prev: AuthFormState, formData: FormData): Promise<AuthFormState> {
  const parsed = signUpSchema.safeParse({
    displayName: formData.get("displayName"),
    email: formData.get("email"),
    password: formData.get("password"),
  });
  const values = pickValues(formData, SIGN_UP_FIELDS);
  if (!parsed.success) return { errors: z.flattenError(parsed.error).fieldErrors, values };
  const { displayName, email, password } = parsed.data;
  try {
    // `name` is Better Auth's required field; we show `displayName` everywhere.
    await auth.api.signUpEmail({ body: { name: displayName, displayName, email, password }, headers: await headers() });
  } catch (err) {
    if (err instanceof APIError) {
      if (err.body?.code === "USER_ALREADY_EXISTS_USE_ANOTHER_EMAIL") {
        return { errors: { email: ["An account with this email already exists."] }, values };
      }
      return { message: err.body?.message ?? "Couldn't create the account.", values };
    }
    throw err;
  }
  redirect(safeNext(formData.get("next")));
}

export async function signInAction(_prev: AuthFormState, formData: FormData): Promise<AuthFormState> {
  const email = String(formData.get("email") ?? "");
  const password = String(formData.get("password") ?? "");
  try {
    await auth.api.signInEmail({ body: { email, password }, headers: await headers() });
  } catch (err) {
    if (err instanceof APIError) return { message: "Invalid email or password.", values: pickValues(formData, SIGN_IN_FIELDS) };
    throw err;
  }
  redirect(safeNext(formData.get("next")));
}

/** Starts GitHub sign-in: Better Auth returns GitHub's authorization page to send the browser to. */
export async function signInWithGitHubAction(formData: FormData) {
  const next = safeNext(formData.get("next"));
  const result = await auth.api.signInSocial({
    body: {
      provider: "github",
      callbackURL: next,
      // Failures (e.g. the email already belongs to a password account) come back to the
      // sign-in page with ?error=…, which it explains, instead of Better Auth's bare error page.
      errorCallbackURL: `/sign-in?next=${encodeURIComponent(next)}`,
    },
    headers: await headers(),
  });
  if (!result.url) throw new Error("GitHub sign-in is not available.");
  redirect(result.url);
}

export async function signOutAction(formData: FormData) {
  await auth.api.signOut({ headers: await headers() });
  // Stay on the page you were on, unless it needs an account.
  redirect(afterSignOut(safeNext(formData.get("next"))));
}
