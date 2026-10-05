import type { AdminApiClient } from "@calimero-network/mero-js";

/**
 * Resolving MeroDesign's own application id.
 *
 * A node can have several applications installed (curb, kv-store, MeroDesign…).
 * Picking `apps[0]` is wrong — it's whichever app happens to be first, so the
 * teams/namespaces list ends up showing another application's namespaces. So
 * the installed list is matched on the bundle's `package`, the one identity
 * that does not change between releases, machines or signers.
 *
 * On an ACCOUNT session there is no node to ask: `listApplications` is a
 * node-wide listing the relay refuses to an account (403), and an account has
 * no install of its own to find. mero-react ≥ 9.11 resolves the account's id
 * from the registry by this app's package, on `useMero().applicationId` — see
 * `hooks/useApplicationId.ts`, which only calls into here on a node login.
 *
 * ⚠️ There is deliberately no pinned production id and no
 * `import.meta.env.VITE_APPLICATION_ID`. An id is `hash(package, signer)`: a
 * constant pinned here went stale the moment the release key changed, and the
 * env var once shipped a build pinned to an id no node had — every namespace
 * create failed with an opaque `500` that never mentioned application ids.
 */

export const APP_PACKAGE =
  (import.meta.env.VITE_APPLICATION_PACKAGE as string | undefined)?.trim() ||
  "com.calimero.mero-design";

export interface AppEntry {
  id: string;
  package?: string;
}

/**
 * Choose MeroDesign's application id from a list of installed apps: the one
 * whose package is ours, else — on a node that files its installs without a
 * package (a raw-wasm dev install) — the only thing there is, `apps[0]`.
 */
export function pickApplicationId(apps: AppEntry[]): string {
  const byPackage = apps.find((a) => a.package === APP_PACKAGE);
  if (byPackage) return byPackage.id;
  return apps[0]?.id ?? "";
}

/** Ask the NODE which of its installed applications is this one. */
export async function resolveApplicationId(
  admin: Pick<AdminApiClient, "listApplications">,
): Promise<string> {
  const res = (await admin.listApplications()) as unknown as
    | { apps?: AppEntry[]; applications?: AppEntry[] }
    | AppEntry[]
    | null;
  const apps = Array.isArray(res) ? res : res?.apps ?? res?.applications ?? [];
  return pickApplicationId(Array.isArray(apps) ? apps : []);
}
