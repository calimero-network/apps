// Sign-in on Calimero Cloud: a passkey on the cluster, run in this page.
//
// v1 redirected to a node's auth page and read tokens back off the URL hash
// (or enrolled a device key at the account wallet). On release-v2 a player is
// their passkey account: the ceremony runs here, the session lives in memory
// (`@calimero-apps/cloud`), and the page reloads into the world picker.

import { CloudMero, defaultClusterUrl } from "@calimero-apps/cloud";
import { updateSession } from "./session";

export const PACKAGE_NAME = "com.calimero.merraria";
export const REGISTRY_URL = "https://apps.calimero.network";

/** The cluster this build talks to (`VITE_CALIMERO_URL`), as the default to offer. */
export function defaultCluster(): string {
  return defaultClusterUrl();
}

function clean(url: string): string {
  return url.trim().replace(/\/+$/, "");
}

/**
 * Sign in with a passkey on `clusterUrl`, record the cluster on the session,
 * and reload into the picker. `navigate` is injectable for tests.
 */
export async function beginWebLogin(
  clusterUrl: string,
  navigate: (url: string) => void = (url) => {
    window.location.href = url;
  },
): Promise<void> {
  const url = clean(clusterUrl);
  const mero = new CloudMero(url);
  try {
    await mero.signIn();
  } finally {
    mero.close();
  }
  updateSession({ kind: "node", nodeUrl: url });
  navigate(window.location.href);
}

/** Create an account with a new passkey on `clusterUrl`, then as `beginWebLogin`. */
export async function createAccount(
  clusterUrl: string,
  name: string,
  navigate: (url: string) => void = (url) => {
    window.location.href = url;
  },
): Promise<void> {
  const url = clean(clusterUrl);
  const mero = new CloudMero(url);
  try {
    await mero.signUp(name.trim() || "Merraria player");
  } finally {
    mero.close();
  }
  updateSession({ kind: "node", nodeUrl: url });
  navigate(window.location.href);
}
