/**
 * Agent pictures: an uploaded one if the owner added it, otherwise a generated face (DiceBear's
 * "Notionists", CC0 artwork) from a seed, so every agent has one. Pure helpers, safe in the browser.
 */

/** What decides an agent's picture. */
export type AvatarSource = {
  id: string;
  /** Set while it has an uploaded picture: when it last changed. */
  imageUpdatedAt?: number | null;
  avatarSeed?: string | null;
};

/** Longest seed accepted in a generated face's address. */
export const MAX_SEED_LENGTH = 64;

/** The address of an agent's picture. Each version has its own address, so browsers keep it for good. */
export function avatarUrl(agent: AvatarSource): string {
  if (agent.imageUpdatedAt) return `/api/agents/${agent.id}/image?v=${agent.imageUpdatedAt}`;
  return generatedAvatarUrl(agent.avatarSeed || agent.id);
}

export function generatedAvatarUrl(seed: string): string {
  return `/api/avatars/${encodeURIComponent(seed.slice(0, MAX_SEED_LENGTH))}`;
}

/** A fresh seed for "another face". */
export function randomSeed(): string {
  return Math.random().toString(36).slice(2, 12);
}

/** Uploaded pictures, after the browser has made them small. */
export const UPLOAD_SIZE_PX = 256;
export const MAX_UPLOAD_BYTES = 200_000;
/** What the browser will even try to shrink. */
export const MAX_ORIGINAL_BYTES = 15_000_000;

/** The picture's real format, from its first bytes (never trusting the name or declared type). */
export function sniffImageType(bytes: Uint8Array): "image/webp" | "image/jpeg" | "image/png" | null {
  const ascii = (from: number, to: number) => String.fromCharCode(...bytes.slice(from, to));
  if (bytes.length >= 12 && ascii(0, 4) === "RIFF" && ascii(8, 12) === "WEBP") return "image/webp";
  if (bytes.length >= 3 && bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff) return "image/jpeg";
  if (bytes.length >= 8 && bytes[0] === 0x89 && ascii(1, 4) === "PNG") return "image/png";
  return null;
}
