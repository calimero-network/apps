// Web login: redirect to the node's auth page and come back with tokens in
// the URL hash — the exact flow mero-js's buildAuthLoginUrl/parseAuthCallback
// implement (callback-url + mode + permissions + package-name params; the
// callback hash carries access_token/refresh_token/application_id/context_id/
// context_identity). Desktop (tauri) skips all of this: its SSO hash already
// contains everything, including node_url.

export const PACKAGE_NAME = "com.calimero.meroblocks";
export const REGISTRY_URL = "https://apps.calimero.network";
const PENDING_NODE_KEY = "mb-pending-node";

/** mero-react MultiContext grant set — we create/list/execute on contexts */
export const PERMISSIONS = [
  "context:create",
  "context:list",
  "context:execute",
  "application:list",
  "namespace",
  "group",
  "blob",
  "context:alias",
];

export function buildLoginUrl(nodeUrl: string, callbackUrl: string): string {
  const params = new URLSearchParams();
  params.set("callback-url", callbackUrl);
  params.set("permissions", PERMISSIONS.join(","));
  params.set("mode", "multi-context");
  params.set("package-name", PACKAGE_NAME);
  params.set("registry-url", REGISTRY_URL);
  const base = nodeUrl.replace(/\/+$/, "");
  return `${base}/auth/login?${params.toString()}`;
}

/**
 * Kick off the web login: remember which node we are logging into (the
 * callback hash may not echo node_url back), then leave for the auth page.
 * `navigate` is injectable for tests.
 */
export function beginWebLogin(
  nodeUrl: string,
  navigate: (url: string) => void = (url) => {
    window.location.href = url;
  },
): void {
  const clean = nodeUrl.trim().replace(/\/+$/, "");
  localStorage.setItem(PENDING_NODE_KEY, clean);
  const callback = new URL(window.location.href);
  callback.hash = "";
  navigate(buildLoginUrl(clean, callback.toString()));
}

/** The node URL stashed by beginWebLogin, consumed once on callback. */
export function takePendingNodeUrl(): string | null {
  const url = localStorage.getItem(PENDING_NODE_KEY);
  if (url) localStorage.removeItem(PENDING_NODE_KEY);
  return url;
}
