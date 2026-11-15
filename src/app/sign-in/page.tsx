import { Suspense } from "react";
import { GitHubButton, SignInForm } from "@/components/auth/auth-forms";
import { githubEnabled } from "@/lib/auth/auth";
import { Card } from "@/components/ui";
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

async function Form({ searchParams }: { searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  const { next } = await searchParams;
  const target = safeNext(next);
  return (
    <>
      {githubEnabled() && <GitHubButton next={target} />}
      <div className={githubEnabled() ? "mt-4" : undefined}>
        <SignInForm next={target} />
      </div>
    </>
  );
}
