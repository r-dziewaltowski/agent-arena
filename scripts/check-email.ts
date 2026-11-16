/**
 * Checks the Gmail settings by logging in to Gmail's mail server; sends nothing. Reads
 * GMAIL_USER and GMAIL_APP_PASSWORD from the shell or .env.local. Prints only a masked address
 * and the password's length, never the password.
 *
 *   npm run email:check
 */
import "./load-env";
import { gmailCredentials, gmailTransport } from "../src/lib/email/send";

async function main() {
  const { user, pass } = gmailCredentials();
  console.log(`GMAIL_USER:         ${user ? user.replace(/^(.).*?(@.*)?$/, (_, first, domain) => `${first}…${domain ?? " (no @domain!)"}`) : "(missing)"}`);
  console.log(`GMAIL_APP_PASSWORD: ${pass ? `${pass.length} characters (should be 16)` : "(missing)"}`);
  if (!user || !pass) process.exit(1);
  await gmailTransport(user, pass).verify();
  console.log("Gmail accepted the login: these settings work.");
}

main().catch((err) => {
  console.error(`Gmail refused: ${err instanceof Error ? err.message : err}`);
  process.exit(1);
});
