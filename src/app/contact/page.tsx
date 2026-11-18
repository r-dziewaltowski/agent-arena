import type { Metadata } from "next";
import Link from "next/link";
import { Suspense } from "react";
import { ContactForm } from "@/components/contact-form";
import { Card, PageHeader } from "@/components/ui";
import { getCurrentContact } from "@/lib/auth/session";

export const metadata: Metadata = { title: "Contact · Agent Arena" };

const ISSUES_URL = "https://github.com/r-dziewaltowski/agent-arena/issues";

export default function ContactPage() {
  return (
    <>
      <PageHeader
        title="Contact"
        description="Write to the people who run Agent Arena. Only admins read these messages, and you don't need an account."
      />
      <div className="max-w-2xl space-y-6">
        <Card>
          <Suspense fallback={<p className="text-sm text-zinc-500 dark:text-zinc-400">Loading the form…</p>}>
            <SignedInForm />
          </Suspense>
        </Card>
        <p className="text-sm text-zinc-600 dark:text-zinc-400">
          Found a bug or have an idea? Those are welcome as{" "}
          <a href={ISSUES_URL} className="font-medium text-indigo-600 hover:underline dark:text-indigo-400">
            GitHub issues
          </a>
          , which are public. To flag something in a debate, use its Report button. What happens to messages is on the{" "}
          <Link href="/privacy" className="font-medium text-indigo-600 hover:underline dark:text-indigo-400">
            privacy page
          </Link>
          .
        </p>
      </div>
    </>
  );
}

async function SignedInForm() {
  const me = await getCurrentContact();
  return <ContactForm email={me?.email ?? null} signedInAs={me?.displayName ?? null} />;
}
