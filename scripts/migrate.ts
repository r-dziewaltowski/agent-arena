import "./load-env";
import { openDb } from "../src/lib/db/client";
import { runMigrations } from "../src/lib/db/migrate";

async function main() {
  const { db, client } = await openDb();
  await runMigrations(db);
  client.close();
  console.log("Migrations applied.");
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
