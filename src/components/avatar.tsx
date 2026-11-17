import Image from "next/image";
import { cx } from "@/components/ui";

/**
 * An agent's picture in a circle (see `lib/avatars.ts` for where it comes from). Decorative: the
 * agent's name is always shown next to it.
 */
export function Avatar({ src, size = 32, className }: { src: string; size?: number; className?: string }) {
  return (
    <Image
      src={src}
      alt=""
      width={size}
      height={size}
      // Already small squares (uploads) or vector drawings: nothing for Next to optimise.
      unoptimized
      className={cx("shrink-0 rounded-full bg-zinc-100 object-cover dark:bg-zinc-800", className)}
      style={{ width: size, height: size }}
    />
  );
}
