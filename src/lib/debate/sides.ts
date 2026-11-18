/**
 * For-or-against debates: each entry argues for or against the topic. Rules shared by the server
 * (entering, starting) and the lobby (what each slot offers). No server imports: the lobby's
 * client form uses the labels.
 */

export const SIDES = ["for", "against"] as const;
export type Side = (typeof SIDES)[number];
export type DebateMode = "open" | "sides";

export const SIDE_LABELS: Record<Side, string> = { for: "For", against: "Against" };

export function isSide(value: unknown): value is Side {
  return value === "for" || value === "against";
}

export const otherSide = (side: Side): Side => (side === "for" ? "against" : "for");

/** Sides with nobody on them yet. */
export function emptySides(entries: { side: Side | null }[]): Side[] {
  return SIDES.filter((side) => !entries.some((e) => e.side === side));
}

/**
 * The sides a new entry may take. Each side needs at least one agent, so when the entry would take
 * the last free slot and one side is still empty, only that side is left.
 */
export function allowedSides(entries: { side: Side | null }[], maxParticipants: number): Side[] {
  const empty = emptySides(entries);
  const lastSlot = entries.length + 1 >= maxParticipants;
  return lastSlot && empty.length === 1 ? empty : [...SIDES];
}

/** Whether a for-or-against debate can start: at least one agent on each side. */
export function bothSidesTaken(entries: { side: Side | null }[]): boolean {
  return emptySides(entries).length === 0;
}

/**
 * Speaking order: the sides take turns (For, Against, For, …), in slot order within each side;
 * For opens, as the side proposing the motion. When one side has more agents, the rest of them
 * speak one after another at the end of the round.
 */
export function alternateSides<T extends { side: Side | null; position: number }>(entries: T[]): T[] {
  const bySlot = [...entries].sort((a, b) => a.position - b.position);
  const pro = bySlot.filter((e) => e.side === "for");
  const con = bySlot.filter((e) => e.side !== "for");
  const out: T[] = [];
  for (let i = 0; i < Math.max(pro.length, con.length); i++) {
    if (pro[i]) out.push(pro[i]);
    if (con[i]) out.push(con[i]);
  }
  return out;
}

export type SideTally = { for: number; against: number; total: number; winner: Side | null };

/** The side vote: which side convinced more voters (owners' votes have no side and don't count). */
export function tallySides(votes: { side: Side | null }[]): SideTally {
  const pro = votes.filter((v) => v.side === "for").length;
  const con = votes.filter((v) => v.side === "against").length;
  return { for: pro, against: con, total: pro + con, winner: pro > con ? "for" : con > pro ? "against" : null };
}
