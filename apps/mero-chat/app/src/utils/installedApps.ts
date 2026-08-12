import axios from "axios";
import { getNodeUrl } from "@calimero-network/mero-react";

import { getAuthConfig } from "../api/meroJsClient";
import { getApplicationId, getApplicationPath } from "../constants/config";

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

/**
 * Install the configured app on the node from its published WASM URL.
 *
 * Returns the application id the node derived from the installed bytes. That
 * id is a hash over the wasm AND its metadata, so it only equals
 * `getApplicationId()` when both match what produced the configured id —
 * callers must compare and report a mismatch rather than assuming success.
 */
export async function installConfiguredApp(): Promise<string> {
  const res = await axios.post(
    `${nodeBase()}/admin-api/install-application`,
    { url: getApplicationPath(), metadata: [] },
    { headers: authHeaders() },
  );
  const installed = res.data?.data?.applicationId ?? "";
  if (!installed) throw new Error("Node did not return an application id.");
  return installed;
}
