"use server";

import { APIError } from "better-auth/api";
import { headers } from "next/headers";
import { redirect } from "next/navigation";
import { z } from "zod";
import { auth } from "@/lib/auth/auth";
import { afterSignOut } from "@/lib/auth/protected-paths";
import { safeNext } from "@/lib/auth/session";
import { enabledSocialProviders, isSocialProvider, SOCIAL_LABELS } from "@/lib/auth/social";
import { pickValues, type FormValues } from "@/lib/form-values";

export type AuthFormState = {
  message?: string;
  errors?: Partial<Record<string, string[]>>;
  values?: FormValues;
  /** Set after a successful step that continues by email (confirmation or reset link sent). */
  sentTo?: string;
};

// Handed back on errors so the form keeps what was typed (passwords never are).
const SIGN_UP_FIELDS = ["displayName", "email"] as const;
const SIGN_IN_FIELDS = ["email"] as const;

const password = z
  .string()
  .min(8, "At least 8 characters.")
  .max(128, "At most 128 characters.");

const signUpSchema = z.object({
  displayName: z.string().trim().min(2, "At least 2 characters.").max(40, "At most 40 characters."),
  email: z.email("Enter a valid email address."),
  password,
});

export async function signUpAction(_prev: AuthFormState, formData: FormData): Promise<AuthFormState> {
  const parsed = signUpSchema.safeParse({
    displayName: formData.get("displayName"),
    email: formData.get("email"),
    password: formData.get("password"),
  });
  const values = pickValues(formData, SIGN_UP_FIELDS);
  if (!parsed.success) return { errors: z.flattenError(parsed.error).fieldErrors, values };
  const { displayName, email, password: pw } = parsed.data;
  try {
    // `name` is Better Auth's required field; we show `displayName` everywhere. The confirmation
    // link brings the person back to where they were heading, signed in.
    await auth.api.signUpEmail({
      body: { name: displayName, displayName, email, password: pw, callbackURL: welcomeUrl(formData.get("next")) },
      headers: await headers(),
    });
  } catch (err) {
    if (err instanceof APIError) return { message: err.body?.message ?? "Couldn't create the account.", values };
    throw err;
  }
  // Same answer whether or not the email was already registered (the owner gets a note instead).
  return { sentTo: email };
}

export async function signInAction(_prev: AuthFormState, formData: FormData): Promise<AuthFormState> {
  const email = String(formData.get("email") ?? "");
  const pw = String(formData.get("password") ?? "");
  const values = pickValues(formData, SIGN_IN_FIELDS);
  try {
    await auth.api.signInEmail({
      body: { email, password: pw, callbackURL: welcomeUrl(formData.get("next")) },
      headers: await headers(),
    });
  } catch (err) {
    if (err instanceof APIError) {
      if (err.body?.code === "EMAIL_NOT_VERIFIED") {
        return { message: "Please confirm your email first. We've just sent you a new confirmation link.", values };
      }
      return { message: "Invalid email or password.", values };
    }
    throw err;
  }
  redirect(safeNext(formData.get("next")));
}

export async function forgotPasswordAction(_prev: AuthFormState, formData: FormData): Promise<AuthFormState> {
  const parsed = z.email("Enter a valid email address.").safeParse(formData.get("email"));
  if (!parsed.success) return { errors: { email: [parsed.error.issues[0].message] }, values: pickValues(formData, ["email"]) };
  try {
    await auth.api.requestPasswordReset({ body: { email: parsed.data, redirectTo: "/reset-password" }, headers: await headers() });
  } catch (err) {
    if (!(err instanceof APIError)) throw err;
  }
  // Never says whether an account exists.
  return { sentTo: parsed.data };
}

export async function resetPasswordAction(_prev: AuthFormState, formData: FormData): Promise<AuthFormState> {
  const parsed = password.safeParse(formData.get("password"));
  if (!parsed.success) return { errors: { password: [parsed.error.issues[0].message] } };
  try {
    await auth.api.resetPassword({ body: { newPassword: parsed.data, token: String(formData.get("token") ?? "") }, headers: await headers() });
  } catch (err) {
    if (err instanceof APIError) return { message: "This reset link has expired or was already used. Ask for a new one." };
    throw err;
  }
  redirect("/sign-in?reset=1");
}

/** Starts sign-in with Google or GitHub: Better Auth returns their page to send the browser to. */
export async function signInWithSocialAction(formData: FormData) {
  const provider = formData.get("provider");
  if (!isSocialProvider(provider) || !enabledSocialProviders().includes(provider)) throw new Error("That sign-in isn't available.");
  const next = safeNext(formData.get("next"));
  const result = await auth.api.signInSocial({
    body: {
      provider,
      callbackURL: next,
      // Failures (e.g. the email already belongs to a password account) come back to the
      // sign-in page with ?error=…, which it explains naming the service, instead of Better
      // Auth's bare error page.
      errorCallbackURL: `/sign-in?next=${encodeURIComponent(next)}&via=${provider}`,
    },
    headers: await headers(),
  });
  if (!result.url) throw new Error(`${SOCIAL_LABELS[provider]} sign-in is not available.`);
  redirect(result.url);
}

export async function signOutAction(formData: FormData) {
  await auth.api.signOut({ headers: await headers() });
  // Stay on the page you were on, unless it needs an account.
  redirect(afterSignOut(safeNext(formData.get("next"))));
}

/** Where a confirmation link lands: the welcome page, which then continues to `next`. */
function welcomeUrl(next: FormDataEntryValue | null): string {
  return `/welcome?next=${encodeURIComponent(safeNext(next))}`;
}
