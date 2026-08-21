import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useEphemeral } from "@calimero-network/mero-react";

import { getMessengerDisplayName } from "../utils/messengerName";

/**
 * One ephemeral slice per author per context, carrying both presence signals.
 *
 * The slice is SELF-DESCRIBING: it carries the publisher's display name rather
 * than an id the reader is expected to resolve. That is not a shortcut — the
 * `author` key the node stamps on a presence entry is the per-context
 * identity, which is neither the account id the admin member lists use nor the
 * base58 account `get_profiles` is keyed by (verified: an author decoding to
 * `48cc94aa…` for a node whose account is `e8b65145…` and device is
 * `a30341fa…`). There is no client-side join from author to member, so a name
 * the reader has to look up is a name it can never render.
 *
 * `name` is self-asserted, exactly as `sender_username` already is on the
 * message path. Presence is advisory; nothing is authorised off it.
 */
export interface PresenceSlice {
  name: string;
  typing: boolean;
}

/** Shown for a peer who is present but has not set a display name. */
const ANONYMOUS_LABEL = "Someone";

function displayName(slice: PresenceSlice | undefined): string {
  return slice?.name?.trim() || ANONYMOUS_LABEL;
}

/** How long after the last keystroke we stop claiming to be typing. */
const TYPING_IDLE_MS = 3_000;

/**
 * How long a peer's `typing` claim is honoured without a genuine change.
 *
 * The node re-publishes every locally-set slice on its own ~2.5s heartbeat, so
 * a peer whose client force-quit, crashed, slept or lost the network keeps
 * asserting `typing: true` forever — the 7s node-side TTL never fires, because
 * what it keeps alive is the *node's* liveness, not the client's. Verified on a
 * live rig: a peer published `typing: true` once, went silent, and no removal
 * arrived in 20s.
 *
 * So staleness is decided here, from the last time a peer's slice actually
 * CHANGED. Slightly longer than our own `TYPING_IDLE_MS` so a healthy peer's
 * retraction normally wins the race and this only catches the ungraceful exits.
 */
export const TYPING_STALE_MS = 7_000;

export interface UseEphemeralPresenceResult {
  /** Display names of everyone currently present, excluding you. */
  online: string[];
  /** Display names of everyone currently typing, excluding you. */
  typing: string[];
  /** Call on every keystroke; publishes on transition and self-clears. */
  noteTyping: () => void;
  /** Call when the composer empties or a message is sent. */
  clearTyping: () => void;
  error: Error | null;
}

export function useEphemeralPresence(contextId: string | null): UseEphemeralPresenceResult {
  const { peers, setPresence, error } = useEphemeral<PresenceSlice>(contextId);

  // Whether we are currently CLAIMING to be typing, so `noteTyping` only
  // publishes on the false→true edge instead of once per keystroke. The node
  // re-publishes every locally-set slice on its own heartbeat tick, so holding
  // the claim costs nothing extra on the wire.
  const claimingTyping = useRef(false);
  const idleTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  // `setPresence` is rebound when the context changes, so the cleanup below
  // must capture the publisher belonging to the context being LEFT — reading
  // the current one would send the retraction to the context just entered.
  const publishRef = useRef(setPresence);
  publishRef.current = setPresence;

  // Announce ourselves on entering a context, and retract typing on the way
  // out.
  //
  // Leaving needs an explicit retraction: the node re-publishes every
  // locally-set slice on its own heartbeat (~2.5s) with a bumped seq, so a
  // slice left saying `typing: true` is kept alive indefinitely rather than
  // ageing out of the TTL. Walking away mid-word would otherwise show peers
  // "X is typing…" forever.
  useEffect(() => {
    if (!contextId) return undefined;
    const publish = publishRef.current;
    claimingTyping.current = false;
    publish({ name: getMessengerDisplayName(), typing: false });

    return () => {
      if (idleTimer.current) {
        clearTimeout(idleTimer.current);
        idleTimer.current = null;
      }
      // Only if we were mid-claim; an unconditional publish would resurrect a
      // slice in a context we are no longer in.
      if (claimingTyping.current) {
        claimingTyping.current = false;
        publish({ name: getMessengerDisplayName(), typing: false });
      }
    };
  }, [contextId, setPresence]);

  const clearTyping = useCallback(() => {
    if (idleTimer.current) {
      clearTimeout(idleTimer.current);
      idleTimer.current = null;
    }
    if (!claimingTyping.current) return;
    claimingTyping.current = false;
    setPresence({ name: getMessengerDisplayName(), typing: false });
  }, [setPresence]);

  const noteTyping = useCallback(() => {
    if (idleTimer.current) clearTimeout(idleTimer.current);
    idleTimer.current = setTimeout(clearTyping, TYPING_IDLE_MS);
    if (claimingTyping.current) return;
    claimingTyping.current = true;
    setPresence({ name: getMessengerDisplayName(), typing: true });
  }, [clearTyping, setPresence]);

  // `peers` already excludes our own echo (`includeSelf` defaults to false).
  //
  // A peer with no name is still PRESENT. `name` is empty whenever that user
  // has not set a display name (`getMessengerDisplayName` reads local storage
  // and returns `""` until they do), which is the normal state of a freshly
  // provisioned node. Filtering on the name would silently drop those peers
  // and make presence look one-directional — the named side sees the unnamed
  // one, never the reverse. Fall back to a label instead of discarding.
  const online = useMemo(
    () => [...peers.values()].map((slice) => displayName(slice)),
    [peers],
  );

  // Last time each peer's slice was observed to CHANGE. Not the last time it
  // arrived — the node's heartbeat refreshes arrival every ~2.5s regardless of
  // whether the peer is still there.
  const lastChangeRef = useRef(new Map<string, { fingerprint: string; at: number }>());
  const [staleTick, setStaleTick] = useState(0);

  const now = Date.now();
  for (const [author, slice] of peers) {
    const fingerprint = JSON.stringify(slice);
    const seen = lastChangeRef.current.get(author);
    if (!seen || seen.fingerprint !== fingerprint) {
      lastChangeRef.current.set(author, { fingerprint, at: now });
    }
  }
  for (const author of [...lastChangeRef.current.keys()]) {
    if (!peers.has(author)) lastChangeRef.current.delete(author);
  }

  // Re-render when the oldest live claim crosses the staleness line, so the
  // indicator clears on its own rather than waiting for the next slice.
  useEffect(() => {
    const claims = [...peers.entries()].filter(([, s]) => s?.typing);
    if (claims.length === 0) return undefined;
    const oldest = Math.min(
      ...claims.map(([a]) => lastChangeRef.current.get(a)?.at ?? Date.now()),
    );
    const remaining = TYPING_STALE_MS - (Date.now() - oldest);
    const timer = setTimeout(() => setStaleTick((n) => n + 1), Math.max(remaining, 50));
    return () => clearTimeout(timer);
  }, [peers, staleTick]);

  const typing = useMemo(
    () =>
      [...peers.entries()]
        .filter(([author, slice]) => {
          if (!slice?.typing) return false;
          const seen = lastChangeRef.current.get(author);
          return !seen || Date.now() - seen.at < TYPING_STALE_MS;
        })
        .map(([, slice]) => displayName(slice)),
    // `staleTick` is the dependency that matters: it fires when a claim ages
    // out with no new slice to trigger a recompute.
    [peers, staleTick],
  );

  return { online, typing, noteTyping, clearTyping, error };
}

/**
 * "Ana is typing…", "Ana and Bo are typing…", "3 people are typing…"
 *
 * Names are only used when they distinguish people. Two peers who have both
 * yet to set a display name would otherwise render as "Someone and Someone",
 * so any repeat collapses to the count form.
 */
export function formatTyping(names: string[]): string {
  if (names.length === 0) return "";
  if (names.length === 1) return `${names[0]} is typing…`;
  const distinct = new Set(names).size === names.length;
  if (names.length === 2 && distinct) {
    return `${names[0]} and ${names[1]} are typing…`;
  }
  return `${names.length} people are typing…`;
}
