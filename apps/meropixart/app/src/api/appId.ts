import { adminGet } from "./rpc";

/**
 * Resolving MeroPixArt's own application id.
 *
 * A node can have several applications installed, so picking `apps[0]` is wrong —
 * it is whichever app happens to be first, and the teams/projects list then shows
 * another application's namespaces.
 *
 * The id is `hash(package, signer)`: it does NOT change between releases (verified
 * — two versions of the same package signed by the same key derive the same id),
 * and it is identical on every node that installs the same signed bundle. So the
 * production id can simply be a constant here, with no build-time configuration.
 *
 * It DOES change with the signer, which is the one thing to keep in mind:
 *
 *   registry bundle (production key)      J7SPnKLUbvf166Z61X74JMyK4oDLyAzN98RehWJhNyrv
 *   `cargo mero bundle --dev` / dev key   DuaN713adUp9Mr8VN448U7vNeyhavfP3nVZVBWSyhCox
 *
 * Same code, two ids. That is why the constant is a PREFERENCE checked against
 * what the node actually has, not an override: a locally dev-installed build, or a
 * future re-signed lineage, still resolves correctly via the manifest `package`
 * instead of failing. Getting this wrong is expensive to debug — the node answers a
 * request for an unknown application with an opaque `500 Internal server error`
 * that never mentions application ids.
 *
 * Deliberately NOT read from `import.meta.env.VITE_APPLICATION_ID`: a stale value
 * configured in the hosting project would silently outrank everything below, which
 * is exactly how MeroDesign shipped a build pinned to an id no node had.
 */

/** Production `com.calimero.meropixart`, signed by the release key. */
export const PRODUCTION_APPLICATION_ID =
  "J7SPnKLUbvf166Z61X74JMyK4oDLyAzN98RehWJhNyrv";

const APP_PACKAGE =
  (import.meta.env.VITE_APPLICATION_PACKAGE as string | undefined)?.trim() ||
  "com.calimero.meropixart";

export interface AppEntry {
  id: string;
  package?: string;
}

/**
 * Choose MeroPixArt's application id from the node's installed apps.
 *
 * Order: the production id if this node has it, else whatever carries our
 * `package` (a dev install, or a re-signed release), else the only app installed.
 */
export function pickApplicationId(apps: AppEntry[]): string {
  if (apps.some((a) => a.id === PRODUCTION_APPLICATION_ID)) {
    return PRODUCTION_APPLICATION_ID;
  }
  const byPackage = apps.find((a) => a.package === APP_PACKAGE);
  if (byPackage) return byPackage.id;
  return apps[0]?.id ?? "";
}

/** Fetch the installed apps from the node and resolve MeroPixArt's id. */
export async function resolveApplicationId(): Promise<string> {
  const res = await adminGet<{ apps?: AppEntry[]; applications?: AppEntry[] }>(
    "/applications",
  );
  const apps = res?.apps ?? res?.applications ?? [];
  return pickApplicationId(Array.isArray(apps) ? apps : []);
}
