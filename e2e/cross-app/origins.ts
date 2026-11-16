import { LOCAL_NODES } from "../../packages/merod-local/src/cluster.ts";
import { appLabel } from "../../packages/connect/src/appHost.ts";

/**
 * Each app's dev server, on its own origin as each app is on its own host in
 * production. `merod local` trusts passkey ceremonies from all three (the
 * setup passes `--origins`); every one is `localhost`, the relying party a
 * passkey belongs to, so one person's passkey signs them in to all three.
 */
export const ORIGINS = {
  home: "http://localhost:5173",
  chat: "http://localhost:3000",
  kv: "http://localhost:5174",
} as const;

/**
 * The nodes' own pages (the consent page) under `localhost` rather than
 * `127.0.0.1`: a consent page asks for the passkey with the cluster's rp-id,
 * `localhost`, which a browser refuses on `127.0.0.1`. The setup trusts these
 * too, and the spec opens each consent page here.
 */
export const NODE_PAGES = LOCAL_NODES.map((n) => n.replace("//127.0.0.1:", "//localhost:"));

/**
 * Where node 1 serves `pkg`'s frontend from its bundle, on the package's own
 * origin as Calimero Cloud does: a session opened there is bound to `pkg`.
 */
export function servedOrigin(pkg: string): string {
  return `http://${appLabel(pkg)}.${new URL(NODE_PAGES[0]!).host}`;
}
