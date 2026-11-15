import { Suspense } from "react";
import { GitHubButton, SignInForm } from "@/components/auth/auth-forms";
import { githubEnabled } from "@/lib/auth/auth";
import { Card, Notice } from "@/components/ui";
import { safeNext } from "@/lib/auth/session";

export default function SignInPage(props: PageProps<"/sign-in">) {
  return (
    <div className="mx-auto max-w-sm">
      <h1 className="mb-6 text-2xl font-semibold tracking-tight">Sign in</h1>
      <Card>
        <Suspense>
          <Form searchParams={props.searchParams} />
        </Suspense>
      </Card>
    </div>
  );
}

/** Why GitHub sign-in came back without signing in (Better Auth's error codes). */
function gitHubErrorMessage(error: string | string[] | undefined): string | null {
  if (!error) return null;
  if (error === "account_not_linked") {
    return "An account with your GitHub email already exists. Sign in with your email and password instead.";
  }
  if (error === "access_denied") return "GitHub sign-in was cancelled.";
  return "GitHub sign-in didn't complete. Please try again.";
}

async function Form({ searchParams }: { searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  const { next, error } = await searchParams;
  const target = safeNext(next);
  const gitHubError = gitHubErrorMessage(error);
  return (
    <>
      {gitHubError && (
        <div className="mb-4">
          <Notice tone="amber">{gitHubError}</Notice>
        </div>
      )}
      {githubEnabled() && <GitHubButton next={target} />}
      <div className={githubEnabled() ? "mt-4" : undefined}>
        <SignInForm next={target} />
      </div>
    </>
  );
}
