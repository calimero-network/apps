import type { AdminApiClient } from "@calimero-network/mero-js";

/**
 * Resolving MeroPixArt's own application id on a NODE login.
 *
 * A node can have several applications installed, so picking `apps[0]` is wrong
 * when the node knows packages — it is whichever app happens to be first, and the
 * teams list then shows another application's namespaces. The id is
 * `hash(package, signer)`: a registry build and a locally dev-signed one have
 * DIFFERENT ids for the same code, so there is no constant to pin; the bundle's
 * `package` is the one identity that does not change between releases, machines
 * or signers, and it is what the node is asked to match on.
 *
 * Deliberately NOT read from `import.meta.env.VITE_APPLICATION_ID`: a stale value
 * configured in the hosting project would silently outrank everything below, which
 * is exactly how MeroDesign shipped a build pinned to an id no node had.
 *
 * On a delegated (account) session there is no node to ask — `GET
 * /admin-api/applications` is node-wide and the relay refuses it to an account
 * (403) — and nothing here runs: the provider resolves the id from the registry
 * by this app's package, and `useApi()` hands that out instead.
 */

export const APP_PACKAGE =
  (import.meta.env.VITE_APPLICATION_PACKAGE as string | undefined)?.trim() ||
  "com.calimero.mero-pixart";

export interface AppEntry {
  id: string;
  package?: string;
}

/**
 * Choose MeroPixArt's application id from the node's installed apps.
 *
 * Whatever carries our `package`, else — on a node that knows no packages at all
 * (a raw-wasm dev install) — the only app installed. When the node knows
 * packages and none is ours, the answer is "", not another app's id.
 */
export function pickApplicationId(apps: readonly AppEntry[]): string {
  const byPackage = apps.find((a) => a?.package === APP_PACKAGE && !!a.id);
  if (byPackage) return byPackage.id;
  const packageAware = apps.some((a) => typeof a?.package === "string" && a.package !== "");
  if (packageAware) return "";
  return apps[0]?.id ?? "";
}

/** Ask the node which of its installed applications is this one. */
export async function resolveApplicationId(admin: AdminApiClient): Promise<string> {
  const res = await admin.listApplications();
  const apps = (res as { apps?: AppEntry[] } | undefined)?.apps ?? [];
  return pickApplicationId(Array.isArray(apps) ? apps : []);
}
