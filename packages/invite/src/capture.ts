// ── Capturing an invitation, however it arrived ───────────────────────────────
//
// Eleven apps in this repo carried a near-identical copy of this file. They
// differed in comments, quote style and import paths; the logic was the same,
// and so were its two gaps (see `spendAttempt` below and `redeem.ts`).
//
// Three sources funnel into one controller:
//
//   * the cold-open URL (web/PWA, or the desktop launcher appending
//     `?invitation=…` to this app's frontend URL),
//   * the launcher's warm `deep-link` bridge event (the app is already open),
//   * the PWA `launchQueue`.
//
// The SDK dedups them by content nonce, persists to localStorage so an intent
// survives a reload and the auth redirect, replays to a handler that registers
// late, and drops an intent only when the app acks it via `resolve()`.
//
// Two consequences worth stating, because hand-rolled versions got both wrong:
//
//   1. The landing route does not matter. A handler mounted anywhere sees the
//      intent, so an invitation cannot land on a page that cannot redeem it.
//   2. Arriving before the session is ready is fine. The intent is buffered
//      until something asks for it, so there is no race with login.
//
// Storage note: `localStorage` can throw outright (Safari private mode, a
// browser set to block site data). The store is built behind a probe so an
// invitation still works in that session — it just does not survive a reload,
// which is strictly better than failing to boot.

import {
  DeepLinkController,
  PendingIntentStore,
  getBridge,
} from "@calimero-network/mero-platform";

/** The action an invite link carries: `calimero://<package>/join?invitation=…`. */
export const JOIN_ACTION = "join";
/** The query parameter every app's invite builder emits. */
export const INVITATION_PARAM = "invitation";

/** One captured invitation, with the ack the app owes the store. */
export interface CapturedInvitation {
  /** The raw invitation token, ready to parse. */
  token: string;
  /** Ack it so the store stops replaying it. Call once handled OR declined. */
  resolve: () => void;
  /**
   * Whether to attempt the join without being asked.
   *
   * False once this invitation has spent its automatic attempts. The token is
   * still handed over — so a field can be prefilled and one click retries it —
   * but a link that can never join stops re-firing on every load.
   */
  autoJoin: boolean;
}

type Listener = (invitation: CapturedInvitation) => void;

/**
 * How many loads may auto-join one invitation before it needs a human.
 *
 * An unacked intent is replayed on every load by design, so that a transient
 * failure (node still starting, no member online yet) is retried rather than
 * lost. Without a ceiling a *permanent* failure is retried just as eagerly and
 * forever — which is what made every restart of the node re-fire a link that
 * had already been used.
 */
export const MAX_AUTO_JOIN_ATTEMPTS = 3;

const listeners = new Set<Listener>();
/** Captured but not yet taken by a listener. Replayed to a late subscriber. */
let buffered: CapturedInvitation | null = null;
/**
 * The captured invitation, held for the life of the session rather than
 * consumed on delivery — so code that is not a subscriber can still ask. Used
 * by bootstrap paths that need to know an invitation is inbound before they
 * decide where to send the user.
 */
let current: CapturedInvitation | null = null;
let controller: DeepLinkController | null = null;
/** Namespaced per app so two apps on one origin cannot spend each other's budget. */
let attemptsKey = "calimero:invitation-attempts";

/**
 * An in-memory Storage, for when the real one throws.
 *
 * Not a no-op: dedup within the session still works, so the same link arriving
 * from the URL and the bridge is handled once. Only cross-reload durability is
 * lost.
 */
function memoryStorage(): Storage {
  const map = new Map<string, string>();
  return {
    get length() {
      return map.size;
    },
    clear: () => map.clear(),
    getItem: (k) => map.get(k) ?? null,
    key: (i) => [...map.keys()][i] ?? null,
    removeItem: (k) => void map.delete(k),
    setItem: (k, v) => void map.set(k, v),
  } as Storage;
}

function storage(): Storage {
  try {
    // Touched, not just referenced: some browsers expose `localStorage` and
    // throw only on access.
    const probe = "__calimero_invite_probe__";
    window.localStorage.setItem(probe, "1");
    window.localStorage.removeItem(probe);
    return window.localStorage;
  } catch {
    return memoryStorage();
  }
}

function readAttempts(): Record<string, number> {
  try {
    const parsed: unknown = JSON.parse(storage().getItem(attemptsKey) ?? "{}");
    return parsed && typeof parsed === "object"
      ? (parsed as Record<string, number>)
      : {};
  } catch {
    return {};
  }
}

function writeAttempts(attempts: Record<string, number>): void {
  try {
    storage().setItem(attemptsKey, JSON.stringify(attempts));
  } catch {
    /* unwritable storage — the cap degrades to per-session, never to a throw */
  }
}

/** Counts this load's attempt and reports whether it is still within the cap. */
function spendAttempt(token: string): boolean {
  const attempts = readAttempts();
  const spent = attempts[token] ?? 0;
  if (spent >= MAX_AUTO_JOIN_ATTEMPTS) return false;
  attempts[token] = spent + 1;
  writeAttempts(attempts);
  return true;
}

/** Drops the ledger entry so an acked token cannot leak into it forever. */
function forgetAttempts(token: string): void {
  const attempts = readAttempts();
  if (!(token in attempts)) return;
  delete attempts[token];
  writeAttempts(attempts);
}

/** The token in a raw deep-link payload, or `null` if it carries none. */
export function invitationFromRaw(raw: string): string | null {
  const direct = raw.trim();
  if (!direct) return null;
  // A bare token, or a URL/query carrying one.
  try {
    const params = new URLSearchParams(
      direct.includes("?") ? direct.slice(direct.indexOf("?") + 1) : direct,
    );
    const found = params.get(INVITATION_PARAM);
    if (found && found.trim()) return found.trim();
  } catch {
    /* not a query string — fall through to the bare-token reading */
  }
  return direct.includes("=") || direct.includes("?") ? null : direct;
}

/** The current URL with the invitation parameter removed. */
export function urlWithoutInvitation(href: string): string {
  try {
    const url = new URL(href);
    if (!url.searchParams.has(INVITATION_PARAM)) return href;
    url.searchParams.delete(INVITATION_PARAM);
    return url.toString();
  } catch {
    return href;
  }
}

function deliver(invitation: CapturedInvitation): void {
  current = invitation;
  if (listeners.size === 0) {
    buffered = invitation;
    return;
  }
  for (const listener of listeners) listener(invitation);
}

function ensureController(): void {
  if (controller) return;
  controller = new DeepLinkController(new PendingIntentStore(storage()), {
    location: typeof window !== "undefined" ? window.location : null,
    bridge: getBridge(),
    launchQueue:
      typeof window !== "undefined"
        ? (window as unknown as { launchQueue?: never }).launchQueue ?? null
        : null,
  });

  controller.on((intent) => {
    // `join`, or no action at all — the launcher can append `?invitation=…` to
    // this app's own frontend URL, which parses to a null action with the
    // params intact. Anything else is somebody else's intent.
    if (intent.action !== null && intent.action !== JOIN_ACTION) return;

    const token = invitationFromRaw(intent.raw);
    if (!token) {
      // Nothing for us in it, but it is still ours to ack or it replays forever.
      intent.resolve();
      return;
    }

    // Hygiene, not bookkeeping — the store already remembers this. Done AFTER
    // capture, or the parameter would be gone before the controller read it.
    try {
      const cleaned = urlWithoutInvitation(window.location.href);
      if (cleaned !== window.location.href) {
        window.history.replaceState(null, "", cleaned);
      }
    } catch {
      /* no history API (or a non-browser test env) — the intent still stands */
    }

    deliver({
      token,
      resolve: () => {
        forgetAttempts(token);
        if (current?.token === token) current = null;
        intent.resolve();
      },
      autoJoin: spendAttempt(token),
    });
  });
}

/**
 * Start listening for inbound invitation links.
 *
 * Call once before React mounts: the launcher appends `?invitation=…` to the
 * app's own URL, and a router would otherwise replace the URL before any
 * component could read it.
 *
 * `appKey` namespaces the attempt ledger. Two apps served from one origin (the
 * dev server, a preview deployment) would otherwise share it.
 */
export function primeInvitationCapture(appKey?: string): void {
  if (appKey) attemptsKey = `${appKey}:invitation-attempts`;
  ensureController();
}

/**
 * Subscribe to invitations. Replays one already captured, so a component that
 * mounts after the link was opened still sees it.
 */
export function onInvitation(listener: Listener): () => void {
  ensureController();
  listeners.add(listener);
  if (buffered) {
    const pending = buffered;
    buffered = null;
    listener(pending);
  }
  return () => {
    listeners.delete(listener);
  };
}

/**
 * The captured invitation right now, without subscribing.
 *
 * Unlike `onInvitation`, this does not consume it and does not register a
 * listener — it answers "is an invitation inbound?" for code that only needs
 * to know, such as a bootstrap deciding where to land the user.
 */
export function peekInvitation(): CapturedInvitation | null {
  ensureController();
  return current;
}

/** Test seam: drop the controller and any buffered intent. */
export function resetInvitationCaptureForTests(): void {
  controller?.dispose();
  controller = null;
  listeners.clear();
  buffered = null;
  current = null;
  attemptsKey = "calimero:invitation-attempts";
}
