import { adminGet } from "./rpc";

/**
 * Resolving Mero Calendar's own application id.
 *
 * A node can have several applications installed. Picking `apps[0]` is wrong —
 * it's whichever app happens to be first. We identify our own app by an explicit
 * id first, then by matching the manifest `package` (`com.calimero.merocalendar`).
 * Only as a last resort do we fall back to the first app (correct on a
 * single-app dev node).
 */

const ENV_APP_ID =
  (import.meta.env.VITE_APPLICATION_ID as string | undefined)?.trim() ?? "";
const APP_PACKAGE =
  (import.meta.env.VITE_APPLICATION_PACKAGE as string | undefined)?.trim() ||
  "com.calimero.merocalendar";

export interface AppEntry {
  id: string;
  package?: string;
}

/** Choose Mero Calendar's application id from a list of installed apps. */
export function pickApplicationId(apps: AppEntry[]): string {
  if (ENV_APP_ID) return ENV_APP_ID;
  const byPackage = apps.find((a) => a.package === APP_PACKAGE);
  if (byPackage) return byPackage.id;
  return apps[0]?.id ?? "";
}

/** Fetch the installed apps from the node and resolve Mero Calendar's id. */
export async function resolveApplicationId(): Promise<string> {
  if (ENV_APP_ID) return ENV_APP_ID;
  const res = await adminGet<{ apps?: AppEntry[]; applications?: AppEntry[] }>(
    "/applications",
  );
  const apps = res?.apps ?? res?.applications ?? [];
  return pickApplicationId(Array.isArray(apps) ? apps : []);
}
