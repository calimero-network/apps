import axios from "axios";
import { getNodeUrl } from "@calimero-network/mero-react";

import { getAuthConfig, getMeroJs } from "../api/meroJsClient";
import { getApplicationId } from "../constants/config";
import { APP_SLUG } from "./invitation";

const DEFAULT_ENDPOINT = "http://localhost:2428";

/**
 * Thrown when the app we are configured to run is not installed on the node.
 *
 * Callers must surface this (and offer `installConfiguredApp`) rather than
 * falling back to another installed app. Both `NamespaceEntryPopup` and
 * `CreateWorkspacePopup` used to `return appIds[0]` here, which silently ran
 * chat against whatever else happened to be on the node — e.g. mero-meet,
 * whose contract then rejects chat's init args. `constants/config.ts`
 * documents the same failure for the app-id defaults.
 */
export class AppNotInstalledError extends Error {
  readonly appId: string;

  constructor(appId: string) {
    super(`Application ${appId} is not installed on this node.`);
    this.name = "AppNotInstalledError";
    this.appId = appId;
  }
}

function nodeBase(): string {
  return getNodeUrl() || DEFAULT_ENDPOINT;
}

function authHeaders(): Record<string, string> {
  const cfg = getAuthConfig();
  const headers: Record<string, string> = { "Content-Type": "application/json" };
  if (cfg?.jwtToken) headers.Authorization = `Bearer ${cfg.jwtToken}`;
  return headers;
}

/** Application ids ("packages") installed on the node, in node order. */
export async function listInstalledAppIds(): Promise<string[]> {
  const res = await axios.get(`${nodeBase()}/admin-api/applications`, {
    headers: authHeaders(),
  });
  const apps: unknown[] = res.data?.data?.apps ?? [];
  return apps
    .map((app) => {
      if (!app || typeof app !== "object") return "";
      const typed = app as { id?: string; applicationId?: string };
      return typed.id ?? typed.applicationId ?? "";
    })
    .filter((id): id is string => Boolean(id));
}

/**
 * Resolve the configured application id, matching strictly on id (the
 * package). Throws `AppNotInstalledError` when it is absent — never
 * substitutes a different app.
 */
export async function resolveInstalledAppId(
  preferred: string = getApplicationId(),
): Promise<string> {
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
