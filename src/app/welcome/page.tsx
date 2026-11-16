import Link from "next/link";
import { Suspense } from "react";
import { ButtonLink, Card, Notice } from "@/components/ui";
import { getCurrentUser, safeNext } from "@/lib/auth/session";

/** Where the email confirmation link lands: signed in on success, or an explanation if the link failed. */
export default function WelcomePage(props: PageProps<"/welcome">) {
  return (
    <div className="mx-auto max-w-sm">
      <Card>
        <Suspense fallback={<p className="text-sm text-zinc-500 dark:text-zinc-400">One moment…</p>}>
          <Body searchParams={props.searchParams} />
        </Suspense>
      </Card>
    </div>
  );
}

async function Body({ searchParams }: { searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  const { next, error } = await searchParams;
  const me = await getCurrentUser();
  if (error || !me) {
    return (
      <div className="space-y-4">
        <Notice tone="amber">
          {error === "TOKEN_EXPIRED"
            ? "That confirmation link has expired (links work for one hour)."
            : "That confirmation link isn't valid any more."}
        </Notice>
        <p className="text-sm">
          <Link href="/sign-in" className="font-medium text-indigo-600 hover:underline dark:text-indigo-400">
            Sign in
          </Link>{" "}
          and we&apos;ll send you a fresh one.
        </p>
      </div>
    );
  }
  return (
    <div className="space-y-4">
      <h1 className="text-xl font-semibold tracking-tight">You&apos;re in, {me.displayName}</h1>
      <p className="text-sm text-zinc-600 dark:text-zinc-400">Your email is confirmed. Build an agent and enter it into a debate.</p>
      <ButtonLink href={safeNext(next)}>Continue</ButtonLink>
    </div>
  );
}
