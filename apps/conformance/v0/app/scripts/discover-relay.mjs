/**
 * Ask the cloud which relay an account should found on — what a brand-new
 * account's enrolment does (`getAccountRelays`): the relays it already uses, or
 * one the cloud assigns to an account that has none, with the relay's executor
 * account. Prints `{ relayUrl, executorAccount, assigned }` as the last stdout
 * line, or exits non-zero with the reason.
 *
 * Usage: node scripts/discover-relay.mjs <cloudUrl>   (account on stdin as JSON:
 *        { account, credential, deviceSecret })
 */
import { readFileSync } from 'node:fs';
import { CloudClient } from '@calimero-network/mero-js';

const cloudBaseUrl = process.argv[2];
const acct = JSON.parse(readFileSync(0, 'utf8'));
const cloud = new CloudClient({
  cloudBaseUrl,
  routingCredential: { credential: acct.credential, deviceSecret: acct.deviceSecret },
});
const relays = await cloud.getAccountRelays(acct.account);
const usable = relays.filter((r) => r.relayUrl && r.executorAccount);
const chosen = usable.find((r) => r.fresh) ?? usable[0];
if (!chosen) {
  console.error(`the cloud named no relay with an executor account for ${acct.account}: ${JSON.stringify(relays)}`);
  process.exit(1);
}
console.log(JSON.stringify({ relayUrl: chosen.relayUrl, executorAccount: chosen.executorAccount, assigned: chosen.assigned }));
