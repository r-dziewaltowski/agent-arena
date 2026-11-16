"use client";

import Link from "next/link";
import { useActionState } from "react";
import {
  forgotPasswordAction,
  resetPasswordAction,
  signInAction,
  signInWithSocialAction,
  signUpAction,
  type AuthFormState,
} from "@/actions/auth";
import { Button, Field, inputClass, Notice } from "@/components/ui";
import { SOCIAL_LABELS, type SocialProvider } from "@/lib/auth/social";

const linkClass = "font-medium text-indigo-600 hover:underline dark:text-indigo-400";

/** Shown in place of a form once a link has been emailed. */
function CheckYourEmail({ to, children }: { to: string; children: React.ReactNode }) {
  return (
    <div className="space-y-3 text-sm" role="status">
      <p className="text-base font-medium">Check your email</p>
      <p>
        We&apos;ve sent a link to <span className="font-medium">{to}</span>. {children}
      </p>
      <p className="text-zinc-500 dark:text-zinc-400">
        Nothing there after a few minutes? Check the spam folder, or try again.
      </p>
    </div>
  );
}

export function SignUpForm({ next }: { next: string }) {
  const [state, formAction, pending] = useActionState<AuthFormState, FormData>(signUpAction, {});
  const e = state.errors ?? {};
  const v = state.values ?? {};
  if (state.sentTo) {
    return <CheckYourEmail to={state.sentTo}>Open it to confirm your address and finish creating your account.</CheckYourEmail>;
  }
  return (
    <form action={formAction} className="space-y-4">
      <input type="hidden" name="next" value={next} />
      {state.message && <Notice tone="red">{state.message}</Notice>}
      <Field label="Display name" hint="Shown on your agents and votes. Your email is never shown." error={e.displayName}>
        <input
          name="displayName"
          defaultValue={v.displayName}
          required
          minLength={2}
          maxLength={40}
          autoComplete="nickname"
          className={inputClass}
        />
      </Field>
      <Field label="Email" hint="We'll send a link to confirm it." error={e.email}>
        <input name="email" type="email" defaultValue={v.email} required autoComplete="email" className={inputClass} />
      </Field>
      <Field label="Password" hint="At least 8 characters." error={e.password}>
        <input name="password" type="password" required minLength={8} autoComplete="new-password" className={inputClass} />
      </Field>
      <Button type="submit" disabled={pending} className="w-full">
        {pending ? "Creating account…" : "Create account"}
      </Button>
      <p className="text-center text-xs text-zinc-500 dark:text-zinc-400">
        See{" "}
        <Link href="/privacy" className={linkClass}>
          what we store and why
        </Link>
        .
      </p>
      <p className="text-center text-sm text-zinc-600 dark:text-zinc-400">
        Already have an account?{" "}
        <Link href={`/sign-in?next=${encodeURIComponent(next)}`} className={linkClass}>
          Sign in
        </Link>
      </p>
    </form>
  );
}

/** "Continue with Google" / "Continue with GitHub", one per configured provider. */
export function SocialButtons({ providers, next }: { providers: SocialProvider[]; next: string }) {
  if (providers.length === 0) return null;
  return (
    <div className="mb-4 space-y-3">
      {providers.map((provider) => (
        <form key={provider} action={signInWithSocialAction}>
          <input type="hidden" name="provider" value={provider} />
          <input type="hidden" name="next" value={next} />
          <Button type="submit" variant="secondary" className="w-full">
            Continue with {SOCIAL_LABELS[provider]}
          </Button>
        </form>
      ))}
      <div className="flex items-center gap-3 pt-1 text-xs text-zinc-500 dark:text-zinc-400">
        <span className="h-px flex-1 bg-zinc-200 dark:bg-zinc-800" />
        or with email
        <span className="h-px flex-1 bg-zinc-200 dark:bg-zinc-800" />
      </div>
    </div>
  );
}

export function SignInForm({ next }: { next: string }) {
  const [state, formAction, pending] = useActionState<AuthFormState, FormData>(signInAction, {});
  return (
    <form action={formAction} className="space-y-4">
      <input type="hidden" name="next" value={next} />
      {state.message && <Notice tone="red">{state.message}</Notice>}
      <Field label="Email">
        <input name="email" type="email" defaultValue={state.values?.email} required autoComplete="email" className={inputClass} />
      </Field>
      <Field label="Password">
        <input name="password" type="password" required autoComplete="current-password" className={inputClass} />
      </Field>
      <Button type="submit" disabled={pending} className="w-full">
        {pending ? "Signing in…" : "Sign in"}
      </Button>
      <p className="text-center text-sm text-zinc-600 dark:text-zinc-400">
        <Link href="/forgot-password" className={linkClass}>
          Forgot your password?
        </Link>
      </p>
      <p className="text-center text-sm text-zinc-600 dark:text-zinc-400">
        New here?{" "}
        <Link href={`/sign-up?next=${encodeURIComponent(next)}`} className={linkClass}>
          Create an account
        </Link>
      </p>
    </form>
  );
}

export function ForgotPasswordForm() {
  const [state, formAction, pending] = useActionState<AuthFormState, FormData>(forgotPasswordAction, {});
  if (state.sentTo) {
    return (
      <CheckYourEmail to={state.sentTo}>
        If there&apos;s an account with this address, the link lets you choose a new password. It works for one hour.
      </CheckYourEmail>
    );
  }
  return (
    <form action={formAction} className="space-y-4">
      <Field label="Email" hint="We'll email you a link to choose a new password." error={state.errors?.email}>
        <input name="email" type="email" defaultValue={state.values?.email} required autoComplete="email" className={inputClass} />
      </Field>
      <Button type="submit" disabled={pending} className="w-full">
        {pending ? "Sending…" : "Send reset link"}
      </Button>
      <p className="text-center text-sm text-zinc-600 dark:text-zinc-400">
        <Link href="/sign-in" className={linkClass}>
          Back to sign in
        </Link>
      </p>
    </form>
  );
}

export function ResetPasswordForm({ token }: { token: string }) {
  const [state, formAction, pending] = useActionState<AuthFormState, FormData>(resetPasswordAction, {});
  return (
    <form action={formAction} className="space-y-4">
      <input type="hidden" name="token" value={token} />
      {state.message && (
        <Notice tone="red">
          {state.message}{" "}
          <Link href="/forgot-password" className={linkClass}>
            Get a new link
          </Link>
        </Notice>
      )}
      <Field label="New password" hint="At least 8 characters." error={state.errors?.password}>
        <input name="password" type="password" required minLength={8} autoComplete="new-password" className={inputClass} />
      </Field>
      <Button type="submit" disabled={pending} className="w-full">
        {pending ? "Saving…" : "Set new password"}
      </Button>
    </form>
  );
}
