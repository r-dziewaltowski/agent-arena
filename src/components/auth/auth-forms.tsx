"use client";

import Link from "next/link";
import { useActionState } from "react";
import { signInAction, signInWithGitHubAction, signUpAction, type AuthFormState } from "@/actions/auth";
import { Button, Field, inputClass, Notice } from "@/components/ui";

export function SignUpForm({ next }: { next: string }) {
  const [state, formAction, pending] = useActionState<AuthFormState, FormData>(signUpAction, {});
  const e = state.errors ?? {};
  return (
    <form action={formAction} className="space-y-4">
      <input type="hidden" name="next" value={next} />
      {state.message && <Notice tone="red">{state.message}</Notice>}
      <Field label="Display name" hint="Shown on your agents and votes. Your email is never shown." error={e.displayName}>
        <input name="displayName" required minLength={2} maxLength={40} autoComplete="nickname" className={inputClass} />
      </Field>
      <Field label="Email" error={e.email}>
        <input name="email" type="email" required autoComplete="email" className={inputClass} />
      </Field>
      <Field label="Password" hint="At least 8 characters." error={e.password}>
        <input name="password" type="password" required minLength={8} autoComplete="new-password" className={inputClass} />
      </Field>
      <Button type="submit" disabled={pending} className="w-full">
        {pending ? "Creating account…" : "Create account"}
      </Button>
      <p className="text-center text-sm text-zinc-600 dark:text-zinc-400">
        Already have an account?{" "}
        <Link href={`/sign-in?next=${encodeURIComponent(next)}`} className="font-medium text-indigo-600 hover:underline">
          Sign in
        </Link>
      </p>
    </form>
  );
}

/** "Continue with GitHub", shown only when GitHub sign-in is configured. */
export function GitHubButton({ next }: { next: string }) {
  return (
    <form action={signInWithGitHubAction} className="space-y-4">
      <input type="hidden" name="next" value={next} />
      <Button type="submit" variant="secondary" className="w-full">
        Continue with GitHub
      </Button>
      <div className="flex items-center gap-3 text-xs text-zinc-500">
        <span className="h-px flex-1 bg-zinc-200 dark:bg-zinc-800" />
        or with email
        <span className="h-px flex-1 bg-zinc-200 dark:bg-zinc-800" />
      </div>
    </form>
  );
}

export function SignInForm({ next }: { next: string }) {
  const [state, formAction, pending] = useActionState<AuthFormState, FormData>(signInAction, {});
  return (
    <form action={formAction} className="space-y-4">
      <input type="hidden" name="next" value={next} />
      {state.message && <Notice tone="red">{state.message}</Notice>}
      <Field label="Email">
        <input name="email" type="email" required autoComplete="email" className={inputClass} />
      </Field>
      <Field label="Password">
        <input name="password" type="password" required autoComplete="current-password" className={inputClass} />
      </Field>
      <Button type="submit" disabled={pending} className="w-full">
        {pending ? "Signing in…" : "Sign in"}
      </Button>
      <p className="text-center text-sm text-zinc-600 dark:text-zinc-400">
        New here?{" "}
        <Link href={`/sign-up?next=${encodeURIComponent(next)}`} className="font-medium text-indigo-600 hover:underline">
          Create an account
        </Link>
      </p>
    </form>
  );
}
