/**
 * ── Capturing an invitation, however it arrived ───────────────────────────────
 *
 * The counterpart to `utils/invitation.ts`: that builds links, this receives
 * them. Ported from mero-stream's `lib/invitationIntents.ts`, which is the
 * ecosystem's version of this, so the three apps behave the same way.
 *
 * What it replaced: a hand-rolled `new URLSearchParams(location.search)` read in
 * `ssoBootstrap`, which handled exactly one of the four ways an invitation
 * reaches this app and got two things wrong that mattered:
 *
 *   1. **It only ever saw the cold-open URL.** The desktop launcher's warm
 *      `deep-link` bridge event (app already open, a new link routed to it) and
 *      the PWA `launchQueue` were invisible, and a `calimero://` link was
 *      unreadable — `new URL().hostname` mangles a dotted slug like
 *      `com.calimero.mero-issue-tracker`, which is why `parseIntent` splits that
 *      scheme by hand.
 *   2. **It accepted anybody's invitation.** Two mero apps served from one
 *      origin share a `localStorage`; a link carrying another app's slug was
 *      stashed under this app's key and then failed to join, with no clue why.
 *
 * `DeepLinkController` merges all three sources, dedups by content nonce,
 * persists through `PendingIntentStore` so an intent survives the reload and the
 * auth redirect, replays to a handler that registers late, and drops an intent
 * only when the app acks it.
 *
 * ── Why capture starts at boot, not on mount ──────────────────────────────────
 *
 * `App.tsx` redirects a signed-in visitor off `/` with `<Navigate replace>`,
 * which rewrites the URL to `APP_ROUTE` — query string and all — before any
 * component below it mounts. A controller constructed from an effect would read
 * `location.href` after that rewrite and find nothing. So `index.tsx` calls
 * `ensureInvitationCapture()` before `ReactDOM.render`, which is the last moment
 * the invitation is still in the address bar.
 *
 * ── Why the captured invitation is STICKY ─────────────────────────────────────
 *
 * The controller hands an intent to the first handler only (it dedups by nonce).
 * This app has two interested parties — the app-level route gate, which only
 * needs to know an invitation is waiting so it can move the user to a route that
 * can redeem it, and the workspace, which does the joining. So the capture is
 * held here until somebody acks it, and every current and future subscriber sees
 * it. One ack clears it for all of them.
 */
import {
  DeepLinkController,
  PendingIntentStore,
  getBridge,
  parseIntent,
} from '@calimero-network/mero-platform';
import { APP_SLUG } from '../utils/invitation';

/** The intent verb. `join` is the ecosystem convention; chat-pwa uses it too. */
export const JOIN_ACTION = 'join';

/** Query parameter carrying the invitation payload. Never the hash — the hash
 *  belongs to the SSO callback (see `ssoBootstrap`). */
export const INVITATION_PARAM = 'invitation';

/** Where `ssoBootstrap.captureInvitation` used to stash a link. Read once, on
 *  first capture, so an invitation opened before this release still redeems. */
const LEGACY_STORAGE_KEY = 'pending-invitation';

/** One captured invitation, with the ack the app owes the store. */
export interface CapturedInvitation {
  /** The base58 payload, ready for `decodeInvitation`. */
  code: string;
  /** Ack it so the store stops replaying it. Call once handled OR declined. */
  resolve: () => void;
}

type Listener = (invitation: CapturedInvitation | null) => void;

const listeners = new Set<Listener>();
let controller: DeepLinkController | null = null;
/** Captured and not yet acked. Delivered to every subscriber, current or later. */
let pending: CapturedInvitation | null = null;

/**
 * An in-memory Storage for when the real one throws (Safari private mode, a
 * browser configured to block site data).
 *
 * Not a no-op: dedup within the session still works, so the same link arriving
 * from the URL and from the bridge is handled once. Only cross-reload durability
 * is lost, which is strictly better than failing to boot.
 */
function memoryStorage(): Storage {
  const map = new Map<string, string>();
  return {
    get length() { return map.size; },
    clear: () => map.clear(),
    getItem: (k: string) => map.get(k) ?? null,
    key: (i: number) => [...map.keys()][i] ?? null,
    removeItem: (k: string) => void map.delete(k),
    setItem: (k: string, v: string) => void map.set(k, v),
  } as Storage;
}

function storage(): Storage {
  try {
    // Touched, not just referenced: some browsers expose `localStorage` and
    // throw only on access.
    const probe = '__mero_issue_tracker_probe__';
    window.localStorage.setItem(probe, '1');
    window.localStorage.removeItem(probe);
    return window.localStorage;
  } catch {
    return memoryStorage();
  }
}

/**
 * Pull an invitation code out of a captured raw string.
 *
 * Returns null for a URL that carries some other app's slug — that is not ours
 * to redeem. The slug check requires BOTH a slug and an action: `parseIntent`
 * reports the first path segment as the slug whatever it is, so this app's own
 * `/issue-tracker?invitation=…` parses as `{slug: "issue-tracker", action: null}`
 * — a route misread as a slug. Rejecting on the slug alone would throw away
 * exactly the links this function exists to accept.
 */
export function invitationFromRaw(raw: string): string | null {
  const trimmed = raw.trim();
  if (!trimmed) return null;
  const intent = parseIntent(trimmed);
  const isPlatformIntent = intent.slug !== null && intent.action !== null;
  if (isPlatformIntent && intent.slug !== APP_SLUG) return null;
  const code = intent.params[INVITATION_PARAM]?.trim();
  return code ? code : null;
}

/**
 * Strip the invitation parameter from a URL, preserving everything else.
 *
 * Hygiene, not bookkeeping — the platform store is what makes redemption
 * durable. An invitation is a signed capability, and one sitting in the address
 * bar gets screenshotted, pasted into a bug report, or shared by someone
 * demonstrating their screen.
 *
 * The hash is preserved: it carries the SSO session on the desktop hand-off, and
 * dropping it would sign the user out in order to accept an invitation.
 */
export function urlWithoutInvitation(url: string): string {
  const [beforeHash, ...hashParts] = url.split('#');
  const hash = hashParts.length ? `#${hashParts.join('#')}` : '';
  const q = beforeHash.indexOf('?');
  if (q < 0) return url;
  const base = beforeHash.slice(0, q);
  const params = new URLSearchParams(beforeHash.slice(q + 1));
  params.delete(INVITATION_PARAM);
  const rest = params.toString();
  return `${base}${rest ? `?${rest}` : ''}${hash}`;
}

function notify(): void {
  for (const listener of [...listeners]) listener(pending);
}

function hold(code: string, ack: () => void): void {
  const captured: CapturedInvitation = {
    code,
    resolve: () => {
      if (pending !== captured) return; // already acked by another subscriber
      pending = null;
      try { ack(); } catch { /* the store is best-effort */ }
      notify();
    },
  };
  pending = captured;
  notify();
}

/** Migrate a link captured by the pre-platform `ssoBootstrap` capture. */
function adoptLegacyCapture(): void {
  let raw: string | null = null;
  try { raw = window.localStorage.getItem(LEGACY_STORAGE_KEY); } catch { return; }
  if (!raw?.trim()) return;
  const forget = () => {
    try { window.localStorage.removeItem(LEGACY_STORAGE_KEY); } catch { /* ignore */ }
  };
  // The legacy key held the bare `?invitation=` value, so take it as-is rather
  // than through `invitationFromRaw` (which expects a URL or an intent).
  hold(raw.trim(), forget);
}

/**
 * Start capturing. Idempotent, and safe to call before React mounts — which is
 * where it MUST be called from (see the file header).
 */
export function ensureInvitationCapture(): void {
  if (controller || typeof window === 'undefined') return;

  controller = new DeepLinkController(new PendingIntentStore(storage()), {
    location: window.location,
    bridge: getBridge(),
    launchQueue:
      (window as unknown as { launchQueue?: never }).launchQueue ?? null,
  });

  controller.on((intent) => {
    // `join`, or no action at all — the launcher can append `?invitation=…` to
    // the app's own frontend URL, which parses to a null action with the params
    // intact. Anything else is somebody else's intent.
    if (intent.action !== null && intent.action !== JOIN_ACTION) return;

    const code = invitationFromRaw(intent.raw);
    if (!code) {
      // Nothing for us in it, but it is still ours to ack or it replays forever.
      intent.resolve();
      return;
    }

    // Done AFTER capture, or the parameter would be gone before the controller
    // read it.
    try {
      const cleaned = urlWithoutInvitation(window.location.href);
      if (cleaned !== window.location.href) {
        window.history.replaceState(null, '', cleaned);
      }
    } catch { /* no history API (or a non-browser test env) — the intent stands */ }

    hold(code, intent.resolve);
  });

  if (!pending) adoptLegacyCapture();
}

/**
 * Subscribe to the captured invitation. The listener is called immediately with
 * the current value (possibly null) and again whenever it changes, so a
 * component that mounts long after the link was opened still sees it.
 */
export function onInvitation(listener: Listener): () => void {
  ensureInvitationCapture();
  listeners.add(listener);
  listener(pending);
  return () => { listeners.delete(listener); };
}

/** The captured invitation right now, without subscribing. */
export function peekInvitation(): CapturedInvitation | null {
  return pending;
}

/** Test seam: drop the controller, the subscribers and any held intent. */
export function resetInvitationCaptureForTests(): void {
  controller?.dispose();
  controller = null;
  listeners.clear();
  pending = null;
}
