/**
 * Converts a local date and time as typed in a `datetime-local` field ("2026-11-20T18:30") in the
 * given IANA time zone ("Asia/Kuala_Lumpur") to epoch ms. Returns null for anything unparseable.
 * An unknown time zone falls back to UTC.
 */
export function localToEpoch(local: string, timeZone: string): number | null {
  const m = /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2})$/.exec(local.trim());
  if (!m) return null;
  const [year, month, day, hour, minute] = m.slice(1).map(Number);
  const asUtc = Date.UTC(year, month - 1, day, hour, minute);
  if (Number.isNaN(asUtc)) return null;
  // The zone's offset at that moment; checked twice so a time near a DST change lands right.
  let epoch = asUtc - offsetMs(asUtc, timeZone);
  epoch = asUtc - offsetMs(epoch, timeZone);
  return epoch;
}

/** How far the zone's wall clock is ahead of UTC at `epoch`, in ms. */
function offsetMs(epoch: number, timeZone: string): number {
  let parts: Intl.DateTimeFormatPart[];
  try {
    parts = new Intl.DateTimeFormat("en-US", {
      timeZone,
      hourCycle: "h23",
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
      hour: "2-digit",
      minute: "2-digit",
      second: "2-digit",
    }).formatToParts(new Date(epoch));
  } catch {
    return 0; // unknown time zone: treat as UTC
  }
  const get = (type: string) => Number(parts.find((p) => p.type === type)?.value);
  const wall = Date.UTC(get("year"), get("month") - 1, get("day"), get("hour"), get("minute"), get("second"));
  return wall - Math.floor(epoch / 1000) * 1000;
}
