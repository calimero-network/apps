import { getBridge } from "@calimero-network/mero-platform";
import { getNodeUrl, isDesktopWindow, setNodeUrl } from "@calimero-network/mero-react";

/**
 * Let a desktop hand-off log straight in, without re-authenticating.
 *
 * The launcher opens an app at its `links.frontend` with the session already
 * minted, in the URL fragment: `#access_token=…&refresh_token=…&node_url=…`.
 * mero-react will not touch that bundle unless it can decide the node is
 * trusted, and its rule (`resolveTrustedNodeUrl`) is:
 *
 *     candidate + initiated        -> accept only if same origin
 *     candidate + allowedNodeUrls  -> accept only if listed
 *     candidate + neither          -> REJECT
 *
 * "initiated" is the node THIS browser context started a login against. A
 * desktop hand-off never had one — the launcher did the login — so a cold open
 * lands in the third branch and the provider logs
 * "OAuth callback node_url is not trusted … no tokens stored", leaving the user
 * staring at a Connect button while holding a perfectly good session.
 *
 * `allowedNodeUrls` cannot fix this: the node is whichever one the user runs,
 * so there is no list to write at build time.
 *
 * So we seed the initiated node from the callback itself — but ONLY inside the
 * launcher, because that check is a real security boundary, not red tape. In a
 * plain browser tab a link like `#access_token=…&node_url=https://evil` would
 * otherwise bind the client to an attacker's node; the strict behaviour stays
 * exactly as-is there. "Inside the launcher" is either signal:
 *
 *   * `isDesktopWindow()` (mero-react): the Calimero Desktop opens every app in
 *     a Tauri webview, which always carries `__TAURI_INTERNALS__`. This is the
 *     one that fires today — the desktop does NOT inject the platform bridge,
 *     so checking `getBridge()` alone meant the hand-off never ran and every
 *     fresh desktop open fell back to the Connect button.
 *   * `getBridge()`: a launcher that injects the mero-platform capability
 *     surface (`window.__calimero_platform__`).
 *
 * Neither exists in a plain browser tab, which is the context where the
 * callback's node could come from whoever sent the link rather than the shell.
 *
 * ⚠️ Deliberately narrow. It seeds the NODE URL and nothing else:
 *
 *   * Tokens are NOT stored here. `resolveTokenAdoption` orders by `iat`,
 *     merges an access-only hash instead of clobbering a live refresh token,
 *     and refuses an undecodable one. Hand-seeding skips all of that, and
 *     re-presenting an already-rotated refresh token makes the node revoke the
 *     whole family — a hard logout for every holder.
 *   * The hash is NOT stripped. The provider consumes it and clears it itself;
 *     stripping it here means the provider never sees the callback at all,
 *     which is precisely how several apps in the fleet silently downgraded
 *     their own SSO.
 *   * An existing initiated node is NOT overwritten, so a real in-app login
 *     still wins and its same-origin check still runs.
 */
export function adoptDesktopSession(): void {
  try {
    if (!getBridge() && !isDesktopWindow()) return;
    if (getNodeUrl()) return;

    const hash = window.location.hash;
    if (!hash || hash.length < 2) return;
    const params = new URLSearchParams(hash.slice(1));
    if (!params.get("access_token")) return;

    const candidate = params.get("node_url");
    if (!candidate) return;

    const url = new URL(candidate);
    if (url.protocol !== "http:" && url.protocol !== "https:") return;

    setNodeUrl(url.origin);
  } catch {
    // A malformed node_url, storage blocked, or an exotic location under test.
    // Failing here just means no auto-login; the Connect button still works.
  }
}
