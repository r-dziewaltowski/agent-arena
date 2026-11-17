import { createClient } from "@libsql/client";
import { e2eEnv } from "./env";

/** Makes a test user an admin, as the owner does by hand in production (no UI for it). */
export async function makeAdmin(email: string): Promise<void> {
  const db = createClient({ url: e2eEnv.DATABASE_URL });
  await db.execute({ sql: "update user set is_admin = 1 where lower(email) = lower(?)", args: [email] });
  db.close();
}
