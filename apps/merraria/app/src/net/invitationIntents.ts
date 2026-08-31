// ── Receiving an invitation, however it arrived ───────────────────────────────
//
// The counterpart to `inviteLink()` in ./inviteLink: that builds links, this
// receives them. Until now Merraria only built them — nothing read an inbound
// `?invitation=`, so every link it generated opened the app and did nothing, and
// the recipient had to copy the token out of the address bar into the join
// field by hand.
//
// A single module-level `DeepLinkController` rather than a hook, because the
// thing it wraps is process-wide and arrives once. Three sources funnel into it:
//
//   * the cold-open URL (web build, or the launcher appending `?invitation=…` to
//     this app's frontend URL),
//   * the launcher's warm `deep-link` bridge event (app already open),
//   * the PWA `launchQueue`.
//
// The SDK dedups them by content nonce, persists to localStorage so an intent
// survives a reload and the auth redirect, replays to a handler that registers
// late, and drops an intent only when the app acks it via `resolve()`. That ack
// model is why there is no "is this error terminal?" guesswork here: an
// invitation that failed for a transient reason simply is not acked, so it is
// still there on the next load.
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

import {
  JOIN_ACTION,
  inviteFromRaw,
  urlWithoutInvite,
} from "./inviteLink";

/** One captured invitation, with the ack the app owes the store. */
export interface CapturedInvite {
  /** The invitation token, ready for `decodeInvite`. */
  token: string;
  /** Ack it so the store stops replaying it. Call once handled OR declined. */
  resolve: () => void;
}

type Listener = (invitation: CapturedInvite) => void;

const listeners = new Set<Listener>();
/** Captured but not yet taken by a listener. Replayed to a late subscriber. */
let buffered: CapturedInvite | null = null;
let controller: DeepLinkController | null = null;

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
    const probe = "__merraria_probe__";
    window.localStorage.setItem(probe, "1");
    window.localStorage.removeItem(probe);
    return window.localStorage;
  } catch {
    return memoryStorage();
  }
}

function deliver(invitation: CapturedInvite): void {
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
        ? ((window as unknown as { launchQueue?: never }).launchQueue ?? null)
        : null,
  });

  controller.on((intent) => {
    // `join`, or no action at all — the launcher can append `?invitation=…` to
    // this app's own frontend URL, which parses to a null action with the params
    // intact. Anything else is somebody else's intent.
    if (intent.action !== null && intent.action !== JOIN_ACTION) return;

    const token = inviteFromRaw(intent.raw);
    if (!token) {
      // Nothing for us in it, but it is still ours to ack or it replays forever.
      intent.resolve();
      return;
    }

    // Hygiene, not bookkeeping — the store already remembers this. Done AFTER
    // capture, or the parameter would be gone before the controller read it.
    try {
      const cleaned = urlWithoutInvite(window.location.href);
      if (cleaned !== window.location.href) {
        window.history.replaceState(null, "", cleaned);
      }
    } catch {
      /* no history API (or a non-browser test env) — the intent still stands */
    }

    deliver({ token, resolve: intent.resolve });
  });
}

/**
 * Start listening for inbound invitation links.
 *
 * Called once from `main.tsx` before React mounts, because the launcher appends
 * `?invitation=…` to the app's own URL and React Router would otherwise replace
 * the URL before any component could read it.
 */
export function primeInviteCapture(): void {
  ensureController();
}

/**
 * Subscribe to invitations. Replays one already captured, so a component that
 * mounts after the link was opened still sees it.
 */
export function onInvite(listener: Listener): () => void {
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

/** Test seam: drop the controller and any buffered intent. */
export function resetInviteCaptureForTests(): void {
  controller?.dispose();
  controller = null;
  listeners.clear();
  buffered = null;
}
