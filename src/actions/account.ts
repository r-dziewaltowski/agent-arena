"use server";

import { APIError } from "better-auth/api";
import { refresh } from "next/cache";
import { headers } from "next/headers";
import { redirect } from "next/navigation";
import { z } from "zod";
import { deleteAccount } from "@/lib/account";
import { auth } from "@/lib/auth/auth";
import { requireUser } from "@/lib/auth/session";
import { getDb } from "@/lib/db/client";
import { pickValues, type FormValues } from "@/lib/form-values";

export type AccountFormState = {
  message?: string;
  errors?: Partial<Record<string, string[]>>;
  values?: FormValues;
  /** A short confirmation shown after a successful save. */
  saved?: string;
};

const displayNameSchema = z.string().trim().min(2, "At least 2 characters.").max(40, "At most 40 characters.");

export async function updateDisplayNameAction(_prev: AccountFormState, formData: FormData): Promise<AccountFormState> {
  await requireUser("/account");
  const parsed = displayNameSchema.safeParse(formData.get("displayName"));
  if (!parsed.success) return { errors: { displayName: [parsed.error.issues[0].message] }, values: pickValues(formData, ["displayName"]) };
  await auth.api.updateUser({ body: { name: parsed.data, displayName: parsed.data }, headers: await headers() });
  refresh();
  return { saved: "Display name saved." };
}

export async function changePasswordAction(_prev: AccountFormState, formData: FormData): Promise<AccountFormState> {
  await requireUser("/account");
  const parsed = z.string().min(8, "At least 8 characters.").max(128, "At most 128 characters.").safeParse(formData.get("newPassword"));
  if (!parsed.success) return { errors: { newPassword: [parsed.error.issues[0].message] } };
  const requestHeaders = await headers();
  try {
    // Not `revokeOtherSessions: true`: that swaps this browser's session too, and the page then
    // re-renders with the old cookie and bounces to sign-in. Revoking the others separately keeps this one.
    await auth.api.changePassword({
      body: { currentPassword: String(formData.get("currentPassword") ?? ""), newPassword: parsed.data },
      headers: requestHeaders,
    });
  } catch (err) {
    if (err instanceof APIError && err.body?.code === "INVALID_PASSWORD") {
      return { errors: { currentPassword: ["That isn't your current password."] } };
    }
    throw err;
  }
  await auth.api.revokeOtherSessions({ headers: requestHeaders });
  return { saved: "Password changed. You've been signed out everywhere else." };
}

export async function deleteAccountAction() {
  const me = await requireUser("/account");
  // Sign out first (clears this browser's cookie), then remove everything personal.
  await auth.api.signOut({ headers: await headers() });
  await deleteAccount(await getDb(), me.id);
  redirect("/sign-in?deleted=1");
}
