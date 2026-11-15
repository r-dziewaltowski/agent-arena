/**
 * Seam for pushing live chunks to viewers. A no-op in v1: viewers poll the turns endpoint, which
 * returns the in-progress turn. Swap in hosted pub/sub or an SSE fan-out later without touching
 * the engine.
 */
export function publishChunk(debateId: string, chunk: string): void {
  void debateId;
  void chunk;
}
