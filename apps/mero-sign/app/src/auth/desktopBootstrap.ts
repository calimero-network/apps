/**
 * Desktop cold-open pre-seed — runs ONCE before React mounts (see main.tsx).
 *
 * ── The bug this fixes ───────────────────────────────────────────────────────
 *
 * When the Calimero desktop app opens Mero Sign in an app window it hands the
 * session over in the URL fragment:
 *
 *   #access_token=…&refresh_token=…&node_url=…&app-id=…
 *
 * ⚠️ `app-id`. With a HYPHEN. Seven apps in this repo read that spelling, and
 * `@calimero-network/calimero-client` used to read only `application_id`, and
 * mero-react does the same:
 *
 *   const applicationId = fragmentParams.get("application_id");
 *
 * So on the desktop this app took the tokens and silently dropped the
 * application id, then fell back to resolving one itself. Nothing errors; you
 * simply land signed in against no application, or against whichever install
 * the fallback happened to pick. That is the "auth skip" not working.
 *
 * ── What this does, and deliberately does NOT do ─────────────────────────────
 *
 * It seeds the two values mero-react reads from `localStorage` at boot, under
 * the exact keys it reads them from:
 *
 *   calimero-application-id   ← the app id  (plain string)
 *   app-url                   ← the node url (JSON-encoded — the SDK does
 *                               `JSON.parse` on it, so a bare string throws)
 *
 * It does NOT touch the tokens, and it does NOT strip the hash. Both belong to
 * `CalimeroProvider.processHashParams`, which runs on first render and clears
 * the fragment itself. Consuming either here races React: the token ends up in
 * the wrong place, every call goes out unauthenticated, and the person is
 * bounced back to the landing page. The same trap is documented at length in
 * mero-issue-tracker's `ssoBootstrap.ts`, which is this file's opposite number
 * for the apps on mero-react.
 *
 * It also never overwrites a value that is already stored. A returning user has
 * a node and an app id from their last session; a fragment is only ever a
 * cold-open hint.
 */

/** True when running inside the Calimero desktop (Tauri v2) shell. */
export const IS_DESKTOP =
  typeof window !== 'undefined' && '__TAURI_INTERNALS__' in window;

/**
 * The keys MERO-REACT reads. Not the old SDK's.
 *
 * ⚠️ THESE CHANGED WHEN THE SDK DID, and getting it wrong is silent. This file
 * originally existed because the previous seeding wrote `localStorage['node-url']`
 * while `calimero-client` read `app-url` — a key nothing read, so the desktop
 * hand-off degraded to the ordinary connect screen with nothing reported. The
 * SDK swap made `calimero-application-id` and `app-url` dead in exactly the
 * same way; mero-react reads `mero:application_id` and `mero:node_url`, as
 * plain strings (no JSON wrapper).
 */
const APP_ID_KEY = 'mero:application_id';
const NODE_URL_KEY = 'mero:node_url';

/**
 * Seed node url and application id from the fragment. Safe to call anywhere;
 * it is a no-op off the desktop and on a fragment that carries neither.
 */
export function bootstrapDesktopSession(): void {
  if (typeof window === 'undefined') return;
  try {
    const hash = window.location.hash.slice(1);
    if (!hash) return;
    const p = new URLSearchParams(hash);

    // Every spelling seen in the wild, most specific first. `app-id` is what
    // the desktop sends today; the other two are what the SDK and the older
    // web redirect use, and costing nothing to accept is worth more than being
    // strict about a value we only read.
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
      // A BARE string. The old SDK JSON-encoded this key; mero-react does not,
      // and a quoted URL never matches the origin its trust check compares.
      localStorage.setItem(NODE_URL_KEY, nodeUrl);
    }
  } catch {
    /* A malformed hash, or storage blocked in a private window. Neither is a
       reason to fail to boot: the app falls back to asking for a node. */
  }
}

/**
 * The node URL the desktop handed over, for `allowedNodeUrls`.
 *
 * ⚠️ mero-react's node-trust check is DEFAULT-DENY. An app that mounts
 * `MeroProvider` without anchoring trust rejects the SSO callback the desktop
 * gives it and drops the tokens with nothing but a console error — the person
 * lands on the connect screen having just signed in. `scripts/check-desktop-sso.py`
 * fails the build for exactly this, and it failed for Mero Sign the moment the
 * provider swap landed.
 *
 * Read at MODULE SCOPE, before React mounts: `MeroProvider` reads the prop on
 * its first render, and the provider itself strips the fragment.
 */
export function hashNodeUrl(): string | undefined {
  if (typeof window === 'undefined') return undefined;
  try {
    const p = new URLSearchParams(window.location.hash.slice(1));
    const raw = (p.get('node_url') ?? p.get('nodeUrl') ?? '').trim();
    // The ORIGIN, not the whole URL: trust is compared by origin, and a value
    // carrying a path never matches.
    return raw ? new URL(raw).origin : undefined;
  } catch {
    return undefined;
  }
}
