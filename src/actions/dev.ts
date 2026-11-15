"use server";

import { cookies } from "next/headers";
import { DEV_USER_COOKIE, DEV_USERS } from "@/lib/auth/dev-users";

/** Switches the dev user (M2 only; replaced by real sign-in in M3). */
export async function switchDevUser(formData: FormData) {
  const id = String(formData.get("userId"));
  if (!DEV_USERS.some((u) => u.id === id)) return;
  (await cookies()).set(DEV_USER_COOKIE, id, { path: "/", sameSite: "lax", httpOnly: true });
}
