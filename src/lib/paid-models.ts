import type { Db } from "./db/client";
import { getConnection } from "./openrouter";
import { encryptionConfigured } from "./secrets";

/** Whether this user can use paid models now: the app can hold keys and they've connected OpenRouter. */
export async function canUsePaidModels(db: Db, userId: string): Promise<boolean> {
  return encryptionConfigured() && (await getConnection(db, userId)) !== null;
}
