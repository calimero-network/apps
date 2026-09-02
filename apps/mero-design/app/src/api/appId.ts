import { adminGet } from "./rpc";

/**
 * Resolving MeroDesign's own application id.
 *
 * A node can have several applications installed (curb, kv-store, MeroDesign…).
 * Picking `apps[0]` is wrong — it's whichever app happens to be first, so the
 * teams/namespaces list ends up showing another application's namespaces.
 *
 * The id is `hash(package, signer)`: it does NOT change between releases (verified
 * — two versions of the same package signed by the same key derive the same id),
 * and it is identical on every node that installs the same signed bundle. So the
 * production id is a constant here and needs no build-time configuration.
 *
 * It DOES change with the signer:
 *
 *   registry bundle (production key)      GgHNECyQqfv1n1XGjrTjNSMjmL1tQBUzWQ7k6uqsSZEZ
 *   `cargo mero bundle --dev` / dev key   a different id for the same code
 *
 * That is why the constant is a PREFERENCE checked against what the node actually
 * has, not an override: a locally dev-installed build, or a future re-signed
 * lineage, still resolves via the manifest `package` instead of failing.
 *
 * ⚠️ Deliberately NOT read from `import.meta.env.VITE_APPLICATION_ID`. That env var
 * used to outrank everything below, and a stale value configured in the hosting
 * project shipped a build pinned to `EYBVLJ…` — an id no node had — so every
 * namespace create failed with an opaque `500 Internal server error` that never
 * mentions application ids. Reading it again would reintroduce exactly that.
 */

/** Production `com.calimero.mero-design`, signed by the release key. */
export const PRODUCTION_APPLICATION_ID =
  "GgHNECyQqfv1n1XGjrTjNSMjmL1tQBUzWQ7k6uqsSZEZ";
const APP_PACKAGE =
  (import.meta.env.VITE_APPLICATION_PACKAGE as string | undefined)?.trim() ||
  "com.calimero.mero-design";

export interface AppEntry {
  id: string;
  package?: string;
}

/** Choose MeroDesign's application id from a list of installed apps. */
export function pickApplicationId(apps: AppEntry[]): string {
  if (apps.some((a) => a.id === PRODUCTION_APPLICATION_ID)) {
    return PRODUCTION_APPLICATION_ID;
  }
  const byPackage = apps.find((a) => a.package === APP_PACKAGE);
  if (byPackage) return byPackage.id;
  return apps[0]?.id ?? "";
}

/** Fetch the installed apps from the node and resolve MeroDesign's id. */
export async function resolveApplicationId(): Promise<string> {
  const res = await adminGet<{ apps?: AppEntry[]; applications?: AppEntry[] }>(
    "/applications",
  );
  const apps = res?.apps ?? res?.applications ?? [];
  return pickApplicationId(Array.isArray(apps) ? apps : []);
}
