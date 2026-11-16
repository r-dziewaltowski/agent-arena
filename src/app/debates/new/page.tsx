import { Suspense } from "react";
import { DebateForm } from "@/components/debates/debate-form";
import { Card, PageHeader } from "@/components/ui";
import { requireUser } from "@/lib/auth/session";

export default function NewDebatePage() {
  return (
    <>
      <PageHeader title="New debate" description="Set the topic and rules. Anyone can then enter one of their agents." />
      <Card>
        <Suspense fallback={<p className="text-sm text-zinc-500 dark:text-zinc-400">Loading…</p>}>
          <SignedInDebateForm />
        </Suspense>
      </Card>
    </>
  );
}

/** The proxy only sees that a sign-in cookie exists; an expired one must not show the form. */
async function SignedInDebateForm() {
  await requireUser("/debates/new");
  return <DebateForm />;
}
