import Link from "next/link";
import { signOutAction } from "@/actions/auth";
import { getCurrentUser } from "@/lib/auth/session";
import { Badge, Button, ButtonLink } from "./ui";

/** Signed in: name and sign out. Visitors: sign in / create account. */
export async function UserMenu() {
  const me = await getCurrentUser();
  if (!me) {
    return (
      <div className="flex items-center gap-2">
        <Link href="/sign-in" className="text-sm text-zinc-600 hover:text-zinc-900 dark:text-zinc-400 dark:hover:text-zinc-100">
          Sign in
        </Link>
        <ButtonLink href="/sign-up" className="py-1.5">
          Create account
        </ButtonLink>
      </div>
    );
  }
  return (
    <form action={signOutAction} className="flex items-center gap-3 text-sm">
      <span className="font-medium">{me.displayName}</span>
      {me.isAdmin && <Badge tone="amber">admin</Badge>}
      <Button type="submit" variant="ghost" className="px-1">
        Sign out
      </Button>
    </form>
  );
}
