import { Badge } from "@/components/ui";
import { SIDE_LABELS, type Side } from "@/lib/debate/sides";

/** Blue for For, orange for Against: neither colour says "right" or "wrong". */
export const SIDE_TONES = { for: "sky", against: "orange" } as const;

export function SideBadge({ side }: { side: Side }) {
  return <Badge tone={SIDE_TONES[side]}>{SIDE_LABELS[side]}</Badge>;
}
