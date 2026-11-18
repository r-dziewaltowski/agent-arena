"use client";

import { useActionState } from "react";
import { contactAction, type ContactFormState } from "@/actions/contact";
import { Button, Field, inputClass, Notice } from "@/components/ui";
import { CONTACT_MESSAGE_MAX_LENGTH, CONTACT_MESSAGE_MIN_LENGTH, CONTACT_TOPICS, HONEYPOT_FIELD } from "@/lib/contact-shared";

/** The Contact page's form. `email`: the signed-in person's address, to prefill the reply field. */
export function ContactForm({ email, signedInAs }: { email: string | null; signedInAs: string | null }) {
  const [state, formAction, pending] = useActionState<ContactFormState, FormData>(contactAction, {});

  if (state.sent) {
    return (
      <Notice tone="blue">
        <p className="font-medium">Thanks, your message is on its way.</p>
        <p className="mt-1">
          We&apos;ll reply to <strong>{state.replyTo}</strong>. Replies come from a Gmail address, so check your spam folder
          if nothing arrives.
        </p>
      </Notice>
    );
  }

  const values = state.values;
  return (
    <form action={formAction} className="space-y-4">
      {state.message && <Notice tone="red">{state.message}</Notice>}
      <Field label="What's it about?" error={state.errors?.topic}>
        <select name="topic" required defaultValue={values?.topic ?? ""} className={inputClass}>
          <option value="" disabled>
            Choose…
          </option>
          {Object.entries(CONTACT_TOPICS).map(([value, label]) => (
            <option key={value} value={value}>
              {label}
            </option>
          ))}
        </select>
      </Field>
      <Field label="Your message" error={state.errors?.body}>
        <textarea
          name="body"
          required
          rows={7}
          minLength={CONTACT_MESSAGE_MIN_LENGTH}
          maxLength={CONTACT_MESSAGE_MAX_LENGTH}
          defaultValue={values?.body}
          className={inputClass}
        />
      </Field>
      <Field
        label="Email address for our reply"
        hint={signedInAs ? `Your account's address; change it if you'd rather we wrote elsewhere. Sent as ${signedInAs}.` : "Only admins see it."}
        error={state.errors?.replyTo}
      >
        <input name="replyTo" type="email" required autoComplete="email" defaultValue={values?.replyTo ?? email ?? ""} className={inputClass} />
      </Field>
      {/* The honeypot: hidden from people (and screen readers, and the Tab key); bots fill it in. */}
      <div aria-hidden className="absolute -left-[9999px] h-px w-px overflow-hidden">
        <label>
          Leave this empty
          <input name={HONEYPOT_FIELD} type="text" tabIndex={-1} autoComplete="off" defaultValue="" />
        </label>
      </div>
      <div className="flex justify-end">
        <Button type="submit" disabled={pending}>
          {pending ? "Sending…" : "Send message"}
        </Button>
      </div>
    </form>
  );
}
