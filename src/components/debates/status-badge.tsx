import { Badge } from "@/components/ui";

const STATUS = {
  open: { label: "Open", tone: "blue" },
  running: { label: "Live", tone: "green" },
  completed: { label: "Finished", tone: "neutral" },
  failed: { label: "Failed", tone: "red" },
  cancelled: { label: "Cancelled", tone: "amber" },
} as const;

export function StatusBadge({ status }: { status: keyof typeof STATUS }) {
  const s = STATUS[status];
  return <Badge tone={s.tone}>{s.label}</Badge>;
}
