import { getMeroJs } from "../api/meroJsClient";
import { getApplicationId } from "../constants/config";
import { APP_SLUG } from "./invitation";

/**
 * Thrown when the app we are configured to run is not installed on the node.
 *
 * Callers must surface this (and offer `installConfiguredApp`) rather than
 * falling back to another installed app. Both `NamespaceEntryPopup` and
 * `CreateWorkspacePopup` used to `return appIds[0]` here, which silently ran
 * chat against whatever else happened to be on the node — e.g. mero-meet,
 * whose contract then rejects chat's init args. `constants/config.ts`
 * documents the same failure for the app-id defaults.
 *
 * Never thrown on an account session: an account has no "installed" set, so
 * there is nothing to be absent from (see `resolveInstalledAppId`).
 */
export class AppNotInstalledError extends Error {
  readonly appId: string;

  constructor(appId: string) {
    super(`Application ${appId} is not installed on this node.`);
    this.name = "AppNotInstalledError";
    this.appId = appId;
  }
}

/**
 * Thrown on an account session while mero-react is still resolving chat's
 * application id from the registry. Transient: the provider fills it in once
 * the registry answers, so the caller shows it and lets the user retry rather
 * than offering an install (an account cannot install anything).
 */
export class ApplicationIdPendingError extends Error {
  constructor() {
    super(
      "Still looking up chat's application id in the registry. Try again in a moment.",
    );
    this.name = "ApplicationIdPendingError";
  }
}

/** Application ids ("packages") installed on the node, in node order. */
export async function listInstalledAppIds(): Promise<string[]> {
  // Node-only in substance: the account admin answers this list too, but with
  // the relay's view, which is why `resolveInstalledAppId` never asks for an
  // account. Through the session admin rather than a raw `/admin-api/
  // applications` read so the node path and its token handling are mero-js's.
  const { apps = [] } = await getMeroJs().admin.listApplications();
  return apps
    .map((app) => (app && typeof app === "object" ? (app.id ?? "") : ""))
    .filter((id): id is string => Boolean(id));
}

/**
 * Resolve the configured application id, matching strictly on id (the
 * package). Throws `AppNotInstalledError` when it is absent — never
 * substitutes a different app.
 *
 * On an account session the answer is the registry-derived id mero-react
 * resolved for chat's package (`useMero().applicationId`, carried on the
 * client): a relay is not "a node with chat installed", its `/admin-api/
 * applications` is not the account's to read, and the id a node derives from
 * its own install is not the one an account's contexts are created under. No
 * listing happens, and `AppNotInstalledError` is never thrown for an account.
 */
export async function resolveInstalledAppId(
  preferred: string = getApplicationId(),
): Promise<string> {
  const client = getMeroJs();
  if (client.isDelegated) {
    if (!client.applicationId) throw new ApplicationIdPendingError();
    return client.applicationId;
  }
  const ids = await listInstalledAppIds();
  if (!ids.includes(preferred)) throw new AppNotInstalledError(preferred);
  return preferred;
}

/** The registry chat publishes to — the same one `main.tsx` hands the login flow. */
const REGISTRY_URL = "https://apps.calimero.network";

/**
 * Install chat on the node from the registry, by coordinates.
 *
 * Since rc.31 the node installs a PUBLISHED bundle by `{ package, version }` and
 * nothing else: every admin request body is `deny_unknown_fields`, so the old
 * `{ url, metadata }` body was refused outright, and a raw wasm URL is not a
 * signed bundle the node would accept anyway. The version is the newest one the
 * registry lists; a node older than that bundle's `minRuntimeVersion` refuses
 * it, which surfaces as the install error rather than a silent mismatch.
 *
 * Returns the application id the node derived — hash(package, signer). Callers
 * must still compare it with `getApplicationId()` and report a mismatch rather
 * than assuming success: a dev bundle signed by another key derives another id.
 *
 * Node-only. The account admin's `installApplication` throws
 * `NotForAccountError`; callers never reach here for an account because
 * `resolveInstalledAppId` never reports "not installed" on one.
 */
export async function installConfiguredApp(): Promise<string> {
  const admin = getMeroJs().admin;
  const [version] = await admin.getRegistryVersions(REGISTRY_URL, APP_SLUG);
  if (!version) {
    throw new Error(`The registry lists no published version of ${APP_SLUG}.`);
  }
  const { applicationId } = await admin.installApplication({
    package: APP_SLUG,
    version,
  });
  if (!applicationId) throw new Error("Node did not return an application id.");
  return applicationId;
}
