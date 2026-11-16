import { afterEach, describe, expect, it, vi } from "vitest";
import { closedBeforeReply, untrackedFetch } from "./client";

/** The error Node's fetch throws when the server closed a reused connection without answering. */
function staleConnection(): TypeError {
  return Object.assign(new TypeError("fetch failed"), { cause: Object.assign(new Error("other side closed"), { code: "UND_ERR_SOCKET" }) });
}

describe("untrackedFetch", () => {
  afterEach(() => vi.unstubAllGlobals());

  it("resends a query once, with its body, when the connection was already closed", async () => {
    const bodies: string[] = [];
    const fetchMock = vi.fn(async (input: RequestInfo | URL) => {
      bodies.push(await (input as Request).text());
      if (bodies.length === 1) throw staleConnection();
      return new Response("ok");
    });
    vi.stubGlobal("fetch", fetchMock);

    const res = await untrackedFetch(new Request("https://db.example/v3/pipeline", { method: "POST", body: '{"sql":"select 1"}' }));
    expect(await res.text()).toBe("ok");
    expect(bodies).toEqual(['{"sql":"select 1"}', '{"sql":"select 1"}']);
  });

  it("doesn't retry other failures, or a second closed connection", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => Promise.reject(new TypeError("fetch failed"))));
    await expect(untrackedFetch("https://db.example")).rejects.toThrow("fetch failed");

    const alwaysStale = vi.fn(async () => Promise.reject(staleConnection()));
    vi.stubGlobal("fetch", alwaysStale);
    await expect(untrackedFetch("https://db.example")).rejects.toThrow("fetch failed");
    expect(alwaysStale).toHaveBeenCalledTimes(2);
  });

  it("recognises only connection-closed errors", () => {
    expect(closedBeforeReply(staleConnection())).toBe(true);
    expect(closedBeforeReply(Object.assign(new TypeError("fetch failed"), { cause: { code: "ECONNRESET" } }))).toBe(true);
    expect(closedBeforeReply(Object.assign(new TypeError("fetch failed"), { cause: { code: "ETIMEDOUT", syscall: "write" } }))).toBe(true);
    expect(closedBeforeReply(Object.assign(new TypeError("fetch failed"), { cause: { code: "ETIMEDOUT", syscall: "read" } }))).toBe(false);
    expect(closedBeforeReply(Object.assign(new TypeError("fetch failed"), { cause: { code: "ENOTFOUND" } }))).toBe(false);
    expect(closedBeforeReply(new Error("SQLITE_CONSTRAINT"))).toBe(false);
  });
});
