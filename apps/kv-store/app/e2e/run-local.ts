/**
 * Bring up the same stack the Playwright suite uses — one native merod with the
 * bundle installed and a namespace + context created — and LEAVE IT RUNNING, so
 * the app can be clicked through by hand.
 *
 * Reuses global-setup rather than reimplementing it, so what you click is
 * exactly what the specs drive. `global-teardown` is deliberately not called;
 * stop it with Ctrl-C, which kills merod with this process.
 */
import globalSetup from "./global-setup";
import { readState } from "./global-setup";

await globalSetup();
const s = readState();

const params = new URLSearchParams({
  access_token: s.accessToken,
  refresh_token: s.refreshToken,
  node_url: s.nodeUrl,
  application_id: s.applicationId,
});
const withCtx = new URLSearchParams(params);
withCtx.set("context_id", s.contextId);

console.log("\n────────────────────────────────────────────────────────");
console.log("  node       ", s.nodeUrl);
console.log("  application", s.applicationId);
console.log("  namespace  ", s.namespaceId);
console.log("  context    ", s.contextId);
console.log("\n  OPEN THIS (lands in the context, KV panel):");
console.log(`  http://localhost:5173/#${withCtx.toString()}`);
console.log("\n  OR THIS (lands on the picker, namespaces card):");
console.log(`  http://localhost:5173/#${params.toString()}`);
console.log("────────────────────────────────────────────────────────\n");
console.log("merod is running. Ctrl-C here to stop it.\n");

// Hold the process so merod stays up.
await new Promise(() => {});
