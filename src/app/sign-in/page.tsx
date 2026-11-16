import { Suspense } from "react";
import { SignInForm, SocialButtons } from "@/components/auth/auth-forms";
import { Card, Notice } from "@/components/ui";
import { safeNext } from "@/lib/auth/session";
import { enabledSocialProviders, isSocialProvider, socialErrorMessage } from "@/lib/auth/social";

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

/** Why the user came back here without being signed in (Better Auth's error codes). */
function errorMessage(error: string | string[] | undefined, via: string | string[] | undefined): string | null {
  if (typeof error !== "string" || !error) return null;
  if (error === "INVALID_TOKEN" || error === "TOKEN_EXPIRED") return "That link has expired or was already used. Sign in to get a new confirmation email.";
  return socialErrorMessage(error, isSocialProvider(via) ? via : null);
}

async function Form({ searchParams }: { searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  const { next, error, via, reset, deleted } = await searchParams;
  const target = safeNext(next);
  const signInError = errorMessage(error, via);
  return (
    <>
      {signInError && (
        <div className="mb-4">
          <Notice tone="amber">{signInError}</Notice>
        </div>
      )}
      {reset && (
        <div className="mb-4">
          <Notice tone="blue">Your password was changed. Sign in with the new one.</Notice>
        </div>
      )}
      {deleted && (
        <div className="mb-4">
          <Notice tone="blue">Your account was deleted. Thanks for trying Agent Arena.</Notice>
        </div>
      )}
      <SocialButtons providers={enabledSocialProviders()} next={target} />
      <SignInForm next={target} />
    </>
  );
}
