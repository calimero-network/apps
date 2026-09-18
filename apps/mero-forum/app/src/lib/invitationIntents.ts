// ── Capturing an invitation, however it arrived ───────────────────────────────
//
// The counterpart to `lib/inviteLink.ts`: that builds links, this receives them.
//
// A single module-level `DeepLinkController` rather than a hook, because the
// thing it wraps is process-wide and arrives once. Three sources funnel into it:
//
//   * the cold-open URL (web/PWA, or the launcher appending `?invitation=…` to
//     the app's frontend URL),
//   * the launcher's warm `deep-link` bridge event (the app is already open and a
//     new link is routed to it),
//   * the PWA `launchQueue`.
//
// The SDK dedups them by content nonce, persists to localStorage so an intent
// survives a reload and the auth redirect, replays to a handler that registers
// late, and drops an intent only when the app acks it. Two consequences worth
// stating because the previous hand-rolled version got both wrong:
//
//   1. **The landing route does not matter.** A handler mounted anywhere in the
//      app sees the intent. The old code read `location.href` in one effect on
//      one route, which is how room invitations came to point at a page that
//      could not redeem them.
//   2. **Arriving before the session is ready is fine.** The intent is buffered
//      until something asks for it, so there is no race between the invitation
//      and login — and no need to gate capture on a session that may not exist
//      yet.
//
// A note on storage: `localStorage` can throw outright (Safari in private mode,
// a browser configured to block site data). The store is constructed lazily
// behind a try/catch so an invitation still works in that session — it just does
// not survive a reload, which is strictly better than the app failing to boot.

import {
  DeepLinkController,
  PendingIntentStore,
  getBridge,
} from "@calimero-network/mero-platform";
import {
  JOIN_ACTION,
  invitationFromRaw,
  urlWithoutInvitation,
} from "./inviteLink";

/** One captured invitation, with the ack the app owes the store. */
export interface CapturedInvitation {
  /** The base58 payload, ready for `decodeInvite`. */
  code: string;
  /** Ack it so the store stops replaying it. Call once handled OR declined. */
  resolve: () => void;
}

type Listener = (invitation: CapturedInvitation) => void;

const listeners = new Set<Listener>();
/** Captured but not yet taken by a listener. Replayed to a late subscriber. */
let buffered: CapturedInvitation | null = null;
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
    const probe = "__mero_stream_probe__";
    window.localStorage.setItem(probe, "1");
    window.localStorage.removeItem(probe);
    return window.localStorage;
  } catch {
    return memoryStorage();
  }
}

function deliver(invitation: CapturedInvitation): void {
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
    // the app's own frontend URL, which parses to a null action with the params
    // intact. Anything else is somebody else's intent.
    if (intent.action !== null && intent.action !== JOIN_ACTION) return;

    const code = invitationFromRaw(intent.raw);
    if (!code) {
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

    deliver({ code, resolve: intent.resolve });
  });
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

/** Test seam: drop the controller and any buffered intent. */
export function resetInvitationCaptureForTests(): void {
  controller?.dispose();
  controller = null;
  listeners.clear();
  buffered = null;
}
