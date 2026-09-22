// Web login: redirect to the node's auth page and come back with tokens in
// the URL hash — the exact flow mero-js's buildAuthLoginUrl/parseAuthCallback
// implement (callback-url + mode + permissions + package-name params; the
// callback hash carries access_token/refresh_token/application_id/context_id/
// context_identity). Desktop (tauri) skips all of this: its SSO hash already
// contains everything, including node_url.

export const PACKAGE_NAME = "com.calimero.mero-blocks";
export const REGISTRY_URL = "https://apps.calimero.network";
const PENDING_NODE_KEY = "mb-pending-node";

/**
 * mero-react MultiContext grant set — we create/list/execute on contexts.
 *
 * This list is a hand-rolled copy of mero-react's `getPermissionsForMode`,
 * because this app owns its own login (no MeroProvider). That means a fix in
 * mero-react does NOT reach us: mero-react 9.1.2 (#73) added
 * `context:subscribe` and this copy had to be corrected by hand.
 *
 * `context:subscribe` is not optional for us. Core's `PermissionValidator`
 * maps `/sse`, `/sse/subscription` AND `/ws` to `Context(Subscribe(Global))`,
 * so a token minted without it is refused `403` +
 * `X-Auth-Error: permission_denied` on every one of them. The app still logs
 * in, lists contexts and executes fine — it simply never receives an event,
 * and `GameClient.subscribe` retries a stream it will never be allowed to
 * open. MEASURED on merod 0.11.0-rc.41: without it `GET /sse` is 403, with it
 * 200.
 *
 * ⚠️ The grant set is baked into the client key at MINT time, so anyone
 * holding a token from before this change must log in again to get a stream.
 */
export const PERMISSIONS = [
  "context:create",
  "context:list",
  "context:execute",
  "context:subscribe",
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
