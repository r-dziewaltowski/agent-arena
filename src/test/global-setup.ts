import { rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

const dir = join(tmpdir(), "agent-arena-tests");

/** Removes the test database folder before and after the run. */
export default function setup() {
  rmSync(dir, { recursive: true, force: true });
  return () => {
    try {
      rmSync(dir, { recursive: true, force: true, maxRetries: 10, retryDelay: 100 });
    } catch {
      // A file still locked by Windows; it will be cleared at the start of the next run.
    }
  };
}
