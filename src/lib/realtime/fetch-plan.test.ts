import { describe, expect, it } from "vitest";
import { CATCH_UP, eventAsk, nextFetch, POLL_MS, SAFETY_FETCH_MS, turnsCacheControl } from "./fetch-plan";

describe("the turns endpoint's caching", () => {
  it("shares answers with a version and no comments catch-up; anything else is never cached", () => {
    expect(turnsCacheControl({ commentsSince: 0, version: "e1700000000000" })).toBe("public, max-age=0, s-maxage=2");
    expect(turnsCacheControl({ commentsSince: 0, version: "m1700000000000-2" })).toBe("public, max-age=0, s-maxage=2");
    expect(turnsCacheControl({ commentsSince: 0, version: "s56666667" })).toBe("public, max-age=0, s-maxage=2");
    expect(turnsCacheControl({ commentsSince: 1700000000000, version: "e1700000000000" })).toBe("no-store");
    expect(turnsCacheControl({ commentsSince: 0, version: null })).toBe("no-store");
    expect(turnsCacheControl({ commentsSince: Number.NaN, version: null })).toBe("no-store");
    expect(turnsCacheControl({ commentsSince: 0, version: "anything-else" })).toBe("no-store");
  });

  it("asks for a shared answer per event, or catches up for an event without a time", () => {
    expect(eventAsk(1234)).toEqual({ catchUp: false, version: "e1234" });
    expect(eventAsk(undefined)).toEqual(CATCH_UP);
  });
});

describe("when to fetch next while pushed", () => {
  const now = 1_000_000;
  const noJitter = () => 0;
  // 20 words at 4.5 words a second take 4,445 ms to show.
  const shown = { status: "streaming", reveal: { startsAt: now - 1_000, full: "word ".repeat(20).trim(), marks: null } };

  it("fetches just after the next moment, shared under that moment's version", () => {
    const plan = nextFetch({ turns: [shown], upcoming: { startsAt: now + 9_000 } }, 4.5, now, null, noJitter);
    const end = now - 1_000 + 4_445;
    expect(plan.delayMs).toBe(end - now + 100);
    expect(plan.ask).toEqual({ catchUp: false, version: `m${end}` });
    expect(plan.moment).toEqual({ moment: end, attempt: 0 });
  });

  it("asks about the same moment again under a new version, when the answer came too early", () => {
    const upcoming = { startsAt: now - 50 };
    const first = nextFetch({ turns: [], upcoming }, 4.5, now, null, noJitter);
    expect(first.delayMs).toBe(250);
    const again = nextFetch({ turns: [], upcoming }, 4.5, now, first.moment, noJitter);
    expect(again.ask).toEqual({ catchUp: false, version: `m${now - 50}-1` });
  });

  it("with nothing coming, makes a shared safety fetch, the same for everyone in a 30-second slot", () => {
    const slot = Math.floor((now + SAFETY_FETCH_MS) / SAFETY_FETCH_MS);
    expect(nextFetch({ turns: [], upcoming: null }, 4.5, now, null)).toMatchObject({
      delayMs: SAFETY_FETCH_MS,
      ask: { catchUp: false, version: `s${slot}` },
    });
    expect(nextFetch({ turns: [], upcoming: null }, 4.5, now + 1_000, null).ask).toEqual({ catchUp: false, version: `s${slot}` });
    expect(nextFetch({ turns: [], upcoming: { startsAt: now + 60_000 } }, 4.5, now, null).delayMs).toBe(SAFETY_FETCH_MS);
  });

  it("keeps polling, with the catch-up, for a turn written live", () => {
    const live = { status: "streaming", reveal: null };
    expect(nextFetch({ turns: [live], upcoming: null }, null, now, null)).toMatchObject({ delayMs: POLL_MS, ask: CATCH_UP });
  });
});
