import { createCipheriv, createDecipheriv, createHash, randomBytes } from "node:crypto";

/**
 * Encryption for secrets the app must keep, such as users' OpenRouter keys (debates run while
 * their owners are offline, so the key has to be stored). AES-256-GCM under USER_API_KEYS_ENCRYPTION_SECRET:
 * 32 random bytes, base64, separate from the auth secret. Stored values look like
 * `v1:<iv>:<tag>:<ciphertext>` (base64url); the version prefix lets the secret be rotated later.
 */
const VERSION = "v1";

export function encryptionConfigured(): boolean {
  try {
    encryptionKey();
    return true;
  } catch {
    return false;
  }
}

function encryptionKey(secret = process.env.USER_API_KEYS_ENCRYPTION_SECRET): Buffer {
  const key = Buffer.from(secret ?? "", "base64");
  if (key.length !== 32) {
    throw new Error("USER_API_KEYS_ENCRYPTION_SECRET must be 32 random bytes, base64-encoded (see the README).");
  }
  return key;
}

export function encryptSecret(plain: string, secret?: string): string {
  const iv = randomBytes(12);
  const cipher = createCipheriv("aes-256-gcm", encryptionKey(secret), iv);
  const ciphertext = Buffer.concat([cipher.update(plain, "utf8"), cipher.final()]);
  return [VERSION, iv, cipher.getAuthTag(), ciphertext].map((p) => (typeof p === "string" ? p : p.toString("base64url"))).join(":");
}

/** Throws if the value was altered, or encrypted under a different secret. */
export function decryptSecret(value: string, secret?: string): string {
  const [version, iv, tag, ciphertext] = value.split(":");
  if (version !== VERSION || !iv || !tag || ciphertext === undefined) throw new Error("Not an encrypted value.");
  const decipher = createDecipheriv("aes-256-gcm", encryptionKey(secret), Buffer.from(iv, "base64url"));
  decipher.setAuthTag(Buffer.from(tag, "base64url"));
  return Buffer.concat([decipher.update(Buffer.from(ciphertext, "base64url")), decipher.final()]).toString("utf8");
}

export function sha256Hex(value: string): string {
  return createHash("sha256").update(value).digest("hex");
}
