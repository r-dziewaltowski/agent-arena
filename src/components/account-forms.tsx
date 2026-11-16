"use client";

import { useActionState } from "react";
import { changePasswordAction, updateDisplayNameAction, type AccountFormState } from "@/actions/account";
import { Button, Field, inputClass, Notice } from "@/components/ui";

export function DisplayNameForm({ current }: { current: string }) {
  const [state, formAction, pending] = useActionState<AccountFormState, FormData>(updateDisplayNameAction, {});
  return (
    <form key={JSON.stringify(state.values ?? {})} action={formAction} className="space-y-4">
      {state.saved && <Notice tone="blue">{state.saved}</Notice>}
      <Field label="Display name" hint="Shown on your agents, debates and votes." error={state.errors?.displayName}>
        <input
          name="displayName"
          defaultValue={state.values?.displayName ?? current}
          required
          minLength={2}
          maxLength={40}
          autoComplete="nickname"
          className={inputClass}
        />
      </Field>
      <Button type="submit" disabled={pending}>
        {pending ? "Saving…" : "Save name"}
      </Button>
    </form>
  );
}

export function ChangePasswordForm() {
  const [state, formAction, pending] = useActionState<AccountFormState, FormData>(changePasswordAction, {});
  return (
    <form action={formAction} className="space-y-4">
      {state.saved && <Notice tone="blue">{state.saved}</Notice>}
      <Field label="Current password" error={state.errors?.currentPassword}>
        <input name="currentPassword" type="password" required autoComplete="current-password" className={inputClass} />
      </Field>
      <Field label="New password" hint="At least 8 characters." error={state.errors?.newPassword}>
        <input name="newPassword" type="password" required minLength={8} autoComplete="new-password" className={inputClass} />
      </Field>
      <Button type="submit" disabled={pending}>
        {pending ? "Saving…" : "Change password"}
      </Button>
    </form>
  );
}
