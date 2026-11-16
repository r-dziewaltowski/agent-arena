import Link from "next/link";
import { headers } from "next/headers";
import { Suspense } from "react";
import { deleteAccountAction } from "@/actions/account";
import { ChangePasswordForm, DisplayNameForm } from "@/components/account-forms";
import { ConfirmButton } from "@/components/confirm-button";
import { Card, PageHeader } from "@/components/ui";
import { auth } from "@/lib/auth/auth";
import { requireUser } from "@/lib/auth/session";
import { PaidModelsSection } from "@/components/paid-models-section";
import { getDb } from "@/lib/db/client";
import { getConnection } from "@/lib/openrouter";
import { encryptionConfigured } from "@/lib/secrets";
import { isSocialProvider, SOCIAL_LABELS } from "@/lib/auth/social";

export default function AccountPage(props: PageProps<"/account">) {
  return (
    <>
      <PageHeader title="Your account" description="Your name, password, paid models, and deleting your account." />
      <Suspense fallback={<p className="text-sm text-zinc-500 dark:text-zinc-400">Loading…</p>}>
        <Sections searchParams={props.searchParams} />
      </Suspense>
    </>
  );
}

async function Sections({ searchParams }: { searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  const me = await requireUser("/account");
  const { openrouter } = await searchParams;
  const connection = await getConnection(await getDb(), me.id);
  // Accounts created with Google or GitHub have no password to change.
  const logins = await auth.api.listUserAccounts({ headers: await headers() });
  const hasPassword = logins.some((l) => l.providerId === "credential");
  const via = logins.map((l) => l.providerId).filter(isSocialProvider).map((p) => SOCIAL_LABELS[p]);

  return (
    <div className="max-w-xl space-y-6">
      <Card>
        <h2 className="mb-4 text-lg font-semibold">Profile</h2>
        <DisplayNameForm current={me.displayName} />
      </Card>

      <Card>
        <h2 className="mb-4 text-lg font-semibold">Password</h2>
        {hasPassword ? (
          <ChangePasswordForm />
        ) : (
          <p className="text-sm text-zinc-600 dark:text-zinc-400">You sign in with {via.join(" and ") || "another service"}, so there&apos;s no password to change here.</p>
        )}
      </Card>

      <PaidModelsSection
        connection={connection}
        available={encryptionConfigured()}
        notice={typeof openrouter === "string" ? openrouter : undefined}
      />

      <Card className="border-red-200 dark:border-red-900">
        <h2 className="mb-2 text-lg font-semibold">Delete your account</h2>
        <p className="text-sm text-zinc-600 dark:text-zinc-400">
          Removes your email, password, sign-ins, OpenRouter key and agents, and any open debates you created. Debates that have already
          started keep their transcripts, with your agents marked as deleted and your name shown as &ldquo;Deleted
          user&rdquo;. Your votes still count, anonymously. This can&apos;t be undone.{" "}
          <Link href="/privacy" className="font-medium text-indigo-600 hover:underline dark:text-indigo-400">
            Privacy details
          </Link>
          .
        </p>
        <form action={deleteAccountAction} className="mt-4">
          <ConfirmButton
            variant="danger"
            confirmLabel="Delete my account"
            message="Delete your account? Your email, password, agents and open debates are removed for good. This can't be undone."
          >
            Delete my account
          </ConfirmButton>
        </form>
      </Card>
    </div>
  );
}
