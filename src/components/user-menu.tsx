import Link from "next/link";
import { signOutAction } from "@/actions/auth";
import { getCurrentUser } from "@/lib/auth/session";
import { AuthLink, ReturnPathInput } from "./auth-links";
import { Badge, Button, buttonLinkClass } from "./ui";

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
      {me.isAdmin && <Badge tone="amber">admin</Badge>}
      <Button type="submit" variant="ghost" className="px-1">
        Sign out
      </Button>
    </form>
  );
}
