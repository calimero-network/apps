import { adminGet } from "./rpc";

/**
 * Resolving MeroDesign's own application id.
 *
 * A node can have several applications installed (curb, kv-store, MeroDesign…).
 * Picking `apps[0]` is wrong — it's whichever app happens to be first, so the
 * teams/namespaces list ends up showing another application's namespaces.
 *
 * We identify our own app the same way curb does: an explicit id wins, then we
 * match on the manifest `package` (`com.calimero.merodesign`). Only as a last
 * resort do we fall back to the first app (correct on a single-app dev node).
 */

const ENV_APP_ID =
  (import.meta.env.VITE_APPLICATION_ID as string | undefined)?.trim() ?? "";
const APP_PACKAGE =
  (import.meta.env.VITE_APPLICATION_PACKAGE as string | undefined)?.trim() ||
  "com.calimero.merodesign";

export interface AppEntry {
  id: string;
  package?: string;
}

/** Choose MeroDesign's application id from a list of installed apps. */
export function pickApplicationId(apps: AppEntry[]): string {
  if (ENV_APP_ID) return ENV_APP_ID;
  const byPackage = apps.find((a) => a.package === APP_PACKAGE);
  if (byPackage) return byPackage.id;
  return apps[0]?.id ?? "";
}

/** Fetch the installed apps from the node and resolve MeroDesign's id. */
export async function resolveApplicationId(): Promise<string> {
  if (ENV_APP_ID) return ENV_APP_ID;
  const res = await adminGet<{ apps?: AppEntry[]; applications?: AppEntry[] }>(
    "/applications",
  );
  const apps = res?.apps ?? res?.applications ?? [];
  return pickApplicationId(Array.isArray(apps) ? apps : []);
}
