import Link from "next/link";
import { Suspense } from "react";
import { ResetPasswordForm } from "@/components/auth/auth-forms";
import { Card, Notice } from "@/components/ui";

/** Reached from the emailed link: Better Auth checks the token and sends people here with it. */
export default function ResetPasswordPage(props: PageProps<"/reset-password">) {
  return (
    <div className="mx-auto max-w-sm">
      <h1 className="mb-6 text-2xl font-semibold tracking-tight">Choose a new password</h1>
      <Card>
        <Suspense>
          <Body searchParams={props.searchParams} />
        </Suspense>
      </Card>
    </div>
  );
}

async function Body({ searchParams }: { searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  const { token, error } = await searchParams;
  if (error || typeof token !== "string" || !token) {
    return (
      <Notice tone="red">
        This reset link has expired or was already used.{" "}
        <Link href="/forgot-password" className="font-medium underline">
          Get a new link
        </Link>
        .
      </Notice>
    );
  }
  return <ResetPasswordForm token={token} />;
}
