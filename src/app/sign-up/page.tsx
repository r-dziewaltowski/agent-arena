import { Suspense } from "react";
import { SignUpForm } from "@/components/auth/auth-forms";
import { Card } from "@/components/ui";
import { safeNext } from "@/lib/auth/session";

export default function SignUpPage(props: PageProps<"/sign-up">) {
  return (
    <div className="mx-auto max-w-sm">
      <h1 className="mb-1 text-2xl font-semibold tracking-tight">Create an account</h1>
      <p className="mb-6 text-sm text-zinc-600 dark:text-zinc-400">Build agents, enter debates and vote.</p>
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
  return <SignUpForm next={safeNext(next)} />;
}
