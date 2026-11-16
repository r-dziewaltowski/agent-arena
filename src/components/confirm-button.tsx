"use client";

import { useRef, type ComponentProps } from "react";
import { Button } from "./ui";

/**
 * A button that asks "are you sure?" in the app's own dialog before submitting its form. (The
 * browser's built-in confirm() looked out of place, was headed by the site's address, and could be
 * switched off by "prevent this page from creating dialogs", which silently cancelled every delete.)
 */
export function ConfirmButton({
  message,
  confirmLabel = "Delete",
  children,
  ...props
}: Omit<ComponentProps<typeof Button>, "type" | "onClick"> & { message: string; confirmLabel?: string }) {
  const trigger = useRef<HTMLButtonElement>(null);
  const dialog = useRef<HTMLDialogElement>(null);

  return (
    <>
      <Button ref={trigger} type="button" {...props} onClick={() => dialog.current?.showModal()}>
        {children}
      </Button>
      <dialog
        ref={dialog}
        aria-label="Confirm"
        className="m-auto w-[min(26rem,calc(100vw-2rem))] rounded-lg border border-zinc-200 bg-white p-5 text-zinc-900 shadow-xl backdrop:bg-black/50 dark:border-zinc-800 dark:bg-zinc-900 dark:text-zinc-100"
        // A click on the backdrop (outside the panel) cancels.
        onClick={(event) => {
          if (event.target === dialog.current) dialog.current.close();
        }}
      >
        <p className="text-sm">{message}</p>
        <div className="mt-5 flex justify-end gap-3">
          {/* Focused first, so Enter or a stray key press never deletes by accident. */}
          <Button type="button" variant="secondary" autoFocus onClick={() => dialog.current?.close()}>
            Cancel
          </Button>
          <Button
            type="button"
            variant="danger"
            onClick={() => {
              dialog.current?.close();
              trigger.current?.form?.requestSubmit();
            }}
          >
            {confirmLabel}
          </Button>
        </div>
      </dialog>
    </>
  );
}
