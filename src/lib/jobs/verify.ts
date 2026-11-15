import { Receiver } from "@upstash/qstash";
import { appUrl, signingKeys } from "./config";

/**
 * True when a request really comes from our queue: QStash signs every delivery with the account's
 * signing keys, over the body and the destination URL. Anything else is rejected, so nobody can
 * trigger model calls by calling a job route directly.
 */
export async function isQueueRequest(request: Request, body: string, path: string): Promise<boolean> {
  const signature = request.headers.get("upstash-signature");
  if (!signature) return false;
  const receiver = new Receiver({
    ...signingKeys(),
    // Never accept the local dev server's public keys in production.
    devMode: process.env.NODE_ENV === "production" ? false : undefined,
  });
  try {
    // The URL is rebuilt from our own public address, not taken from the request (proxies change it).
    return await receiver.verify({ signature, body, url: appUrl() + path, clockTolerance: 5 });
  } catch {
    return false;
  }
}

export function jobLog(message: string) {
  console.log(`[jobs ${new Date().toLocaleTimeString()}] ${message}`);
}
