import type { AdminApiClient } from "@calimero-network/mero-js";
import { getApplicationId } from "@calimero-network/mero-react";

/**
 * Resolving Mero Calendar's own application id.
 *
 * A node can have several applications installed. Picking `apps[0]` is wrong —
 * it's whichever app happens to be first, and the teams list then shows another
 * application's namespaces.
 *
 * Every candidate below is a PREFERENCE checked against what the node actually
 * has, never an override. An id the node doesn't know is not a recoverable
 * mistake: the node answers a request carrying an unknown application with an
 * opaque `500 Internal server error` that never mentions application ids, and
 * MeroDesign shipped a build wedged exactly that way from a stale
 * `VITE_APPLICATION_ID` baked into the hosting project. The application id is
 * `hash(package, signer)`, so it also legitimately differs between a
 * registry-signed release and a `cargo mero bundle --dev` build of the same
 * code — a hard-configured id cannot be right for both.
 *
 * Order: the id our session was handed (desktop SSO hash → mero-react storage),
 * then a configured `VITE_APPLICATION_ID`, then whatever carries our manifest
 * `package`, and only as a last resort the single app on a dev node.
 */

const ENV_APP_ID =
  (import.meta.env.VITE_APPLICATION_ID as string | undefined)?.trim() ?? "";
const APP_PACKAGE =
  (import.meta.env.VITE_APPLICATION_PACKAGE as string | undefined)?.trim() ||
  "com.calimero.mero-calendar";

export interface AppEntry {
  id: string;
  package?: string;
}

/**
 * Choose Mero Calendar's application id from the node's installed apps.
 *
 * `sessionAppId` is the id carried by the current session (the desktop SSO hash
 * stores it via `setApplicationId`); it outranks configuration because it
 * describes the node we are actually talking to.
 */
export function pickApplicationId(
  apps: AppEntry[],
  sessionAppId = "",
): string {
  const installed = (id: string) => !!id && apps.some((a) => a.id === id);
  if (installed(sessionAppId)) return sessionAppId;
  if (installed(ENV_APP_ID)) return ENV_APP_ID;
  const byPackage = apps.find((a) => a.package === APP_PACKAGE);
  if (byPackage) return byPackage.id;
  return apps[0]?.id ?? "";
}

/**
 * Fetch the installed apps from the node and resolve Mero Calendar's id.
 *
 * A NODE question: `listApplications` is `GET /admin-api/applications`, a
 * node-wide listing an account's token cannot pass (403 on the relay), and an
 * account has no install of its own to find — its id comes from the registry,
 * on `useMero().applicationId`. `useEnsureAppId` never calls this on a
 * delegated session.
 */
export async function resolveApplicationId(
  admin: Pick<AdminApiClient, "listApplications">,
): Promise<string> {
  const res = (await admin.listApplications()) as {
    apps?: AppEntry[];
    applications?: AppEntry[];
  };
  const apps = res?.apps ?? res?.applications ?? [];
  return pickApplicationId(
    Array.isArray(apps) ? apps : [],
    getApplicationId() ?? "",
  );
}
