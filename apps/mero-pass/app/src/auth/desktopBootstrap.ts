/**
 * Desktop cold-open pre-seed — runs ONCE before React mounts (see index.tsx).
 *
 * ── The bug this fixes ───────────────────────────────────────────────────────
 *
 * When the Calimero desktop opens Mero Pass in an app window it hands the
 * session over in the URL fragment:
 *
 *   #access_token=…&refresh_token=…&node_url=…&app-id=…
 *
 * ⚠️ `app-id`. WITH A HYPHEN. That is what the desktop sends; mero-react reads
 *
 *   fragmentParams.get("application_id")
 *
 * so this app took the tokens and silently dropped the application id, then
 * fell back to resolving one itself. Nothing errors — you land signed in
 * against no application, or against whichever install the fallback happened
 * to pick. That is the "auth skip" not working.
 *
 * mero-sign carries the same file for the same reason. This is a port, not a
 * new idea, and the shape is deliberately identical so the two cannot drift.
 *
 * ── What it does, and deliberately does NOT do ──────────────────────────────
 *
 * It seeds the two values mero-react reads from `localStorage` at boot, under
 * the exact keys it reads them from — as PLAIN strings, no JSON wrapper.
 *
 * It does NOT touch the tokens and it does NOT strip the hash. Both belong to
 * `MeroProvider`, which runs `parseAuthCallback` on first render and clears
 * the fragment itself. Consuming either here races React: the token lands in
 * the wrong place, every call goes out unauthenticated, and the person is
 * bounced back to the landing page. See the note in `index.tsx`, and
 * `reference_mero_react_token_adoption_dont_hand_roll`.
 *
 * It never overwrites a value already stored. A returning user has a node and
 * an app id from their last session; a fragment is only ever a cold-open hint.
 */

/** True when running inside the Calimero desktop (Tauri v2) shell. */
export const IS_DESKTOP =
  typeof window !== 'undefined' && '__TAURI_INTERNALS__' in window;

/**
 * The keys MERO-REACT reads.
 *
 * ⚠️ NOT the old SDK's. `calimero-client` read `calimero-application-id` and
 * a JSON-encoded `app-url`; mero-react reads these, as plain strings. Writing
 * the old pair is silent — it seeds keys nothing reads, and the hand-off
 * degrades to the ordinary connect screen with nothing reported.
 */
const APP_ID_KEY = 'mero:application_id';
const NODE_URL_KEY = 'mero:node_url';

/**
 * Seed node url and application id from the fragment. Safe to call anywhere;
 * a no-op off the desktop and on a fragment carrying neither.
 */
export function bootstrapDesktopSession(): void {
  if (typeof window === 'undefined') return;
  try {
    const hash = window.location.hash.slice(1);
    if (!hash) return;
    const p = new URLSearchParams(hash);

    // Every spelling seen in the wild, most specific first. `app-id` is what
    // the desktop sends today; the other two are the SDK's and the older web
    // redirect's. Accepting all three costs nothing for a value we only read.
    const appId = (
      p.get('app-id') ??
      p.get('application_id') ??
      p.get('applicationId') ??
      ''
    ).trim();
    const nodeUrl = (p.get('node_url') ?? p.get('nodeUrl') ?? '').trim();

    if (appId && !localStorage.getItem(APP_ID_KEY)) {
      localStorage.setItem(APP_ID_KEY, appId);
    }
    if (nodeUrl && !localStorage.getItem(NODE_URL_KEY)) {
      // A BARE string. The old SDK JSON-encoded this key; mero-react does
      // not, and a quoted URL never matches the origin its trust check
      // compares.
      localStorage.setItem(NODE_URL_KEY, nodeUrl);
    }
  } catch {
    /* A malformed hash, or storage blocked in a private window. Neither is a
       reason to fail to boot: the app falls back to asking for a node. */
  }
}

/**
 * The node ORIGIN the desktop handed over, for `allowedNodeUrls`.
 *
 * ⚠️ THE ORIGIN, NOT THE RAW URL — this is the second half of the bug.
 * `index.tsx` passed the fragment's `node_url` through verbatim, and
 * mero-react compares trust BY ORIGIN: a value carrying a path or a trailing
 * slash never matches, so the callback is rejected and the tokens are dropped
 * with nothing but a console error. The person lands on the connect screen
 * having just signed in.
 *
 * Read at MODULE SCOPE, before React mounts: `MeroProvider` reads the prop on
 * its first render and strips the fragment itself.
 */
export function hashNodeUrl(): string | undefined {
  if (typeof window === 'undefined') return undefined;
  try {
    const p = new URLSearchParams(window.location.hash.slice(1));
    const raw = (p.get('node_url') ?? p.get('nodeUrl') ?? '').trim();
    return raw ? new URL(raw).origin : undefined;
  } catch {
    return undefined;
  }
}
