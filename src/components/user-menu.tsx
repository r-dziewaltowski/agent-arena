import Link from "next/link";
import { signOutAction } from "@/actions/auth";
import { getCurrentUser } from "@/lib/auth/session";
import { getDb } from "@/lib/db/client";
import { openMessageCount } from "@/lib/contact";
import { openReportCount } from "@/lib/reports";
import { AuthLink, ReturnPathInput } from "./auth-links";
import { Badge, Button, buttonLinkClass } from "./ui";

/** Admins: a link to the admin page, with how many reports and messages are waiting. */
async function AdminLink() {
  const db = await getDb();
  const open = (await openReportCount(db)) + (await openMessageCount(db));
  return (
    <Link href="/admin" title="Reports and messages" className="hover:opacity-80">
      <Badge tone={open > 0 ? "red" : "amber"}>{open > 0 ? `admin · ${open} to review` : "admin"}</Badge>
    </Link>
  );
}

/** Signed in: name and sign out. Visitors: sign in / create account. Both keep your place. */
export async function UserMenu() {
  const me = await getCurrentUser();
  if (!me) {
    return (
      <div className="flex items-center gap-2">
        <AuthLink to="/sign-in" className="text-sm text-zinc-600 hover:text-zinc-900 dark:text-zinc-400 dark:hover:text-zinc-100">
          Sign in
        </AuthLink>
        <AuthLink to="/sign-up" className={buttonLinkClass("primary", "py-1.5")}>
          Create account
        </AuthLink>
      </div>
    );
  }
  return (
    <form action={signOutAction} className="flex items-center gap-3 text-sm">
      <ReturnPathInput />
      <Link href="/account" title="Your account" className="font-medium hover:underline">
        {me.displayName}
      </Link>
      {me.isAdmin && <AdminLink />}
      <Button type="submit" variant="ghost" className="px-1">
        Sign out
      </Button>
    </form>
  );
}
