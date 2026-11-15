"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import type { ReactNode } from "react";

/**
 * Header links and the sign-out form need the current page, which the server-rendered header
 * can't see, so these small client pieces add it: signing in brings you back, signing out keeps
 * you where you are.
 */
function useReturnPath(): string {
  const pathname = usePathname();
  // Coming back to the sign-in or sign-up page itself would be pointless.
  return pathname === "/sign-in" || pathname === "/sign-up" ? "/debates" : pathname;
}

export function AuthLink({ to, className, children }: { to: "/sign-in" | "/sign-up"; className?: string; children: ReactNode }) {
  const back = useReturnPath();
  return (
    <Link href={`${to}?next=${encodeURIComponent(back)}`} className={className}>
      {children}
    </Link>
  );
}

/** The current page, sent with the sign-out form so the server can bring you back to it. */
export function ReturnPathInput() {
  return <input type="hidden" name="next" value={useReturnPath()} />;
}
