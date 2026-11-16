import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useEphemeral } from "../api/presence";
import { useWorkspacePresence } from "./usePresence";

import { getMessengerDisplayName } from "../utils/messengerName";
import { nameRepository } from "../repositories/names/useNames";

/**
 * One ephemeral slice per account per context, carrying both presence signals.
 *
 * Peers are keyed by account (the node stamps each entry with its publisher),
 * so a peer is named like a message's sender: from the workspace's member
 * metadata. The `name` a slice carries is the publisher's own copy of that
 * same name, read only until the workspace's member list has loaded.
 * Presence is advisory; nothing is authorised off it.
 */
export interface PresenceSlice {
  name: string;
  typing: boolean;
}

/** Shown for a peer who is present but has not set a display name. */
const ANONYMOUS_LABEL = "Someone";

function displayName(account: string, slice: PresenceSlice | undefined): string {
  // `displayName` schedules the fetch that `peek` does not.
  nameRepository.displayName(account);
  return nameRepository.peek(account) || slice?.name?.trim() || ANONYMOUS_LABEL;
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
  // #general is the workspace's presence channel: its typing goes through that
  // entry, not a second one (same account and device, they would overwrite).
  const workspace = useWorkspacePresence();
  const shared = contextId !== null && contextId === workspace.app;
  const own = useEphemeral<PresenceSlice>(shared ? null : contextId);
  const setShared = workspace.setSlice;
  const sharedSet = useCallback((slice: PresenceSlice) => setShared({ ...slice }), [setShared]);
  const sharedClear = useCallback(() => setShared(null), [setShared]);
  const peers = shared ? (workspace.peers as unknown as Map<string, PresenceSlice>) : own.peers;
  const setPresence = shared ? sharedSet : own.setPresence;
  const clearPresence = shared ? sharedClear : own.clearPresence;
  const error = shared ? null : own.error;
  // Recompute the labels when names load.
  const [namesVersion, setNamesVersion] = useState(0);
  useEffect(() => nameRepository.subscribe(() => setNamesVersion((n) => n + 1)), []);

  // Whether we are currently CLAIMING to be typing, so `noteTyping` only
  // publishes on the false→true edge instead of once per keystroke. The node
  // re-publishes every locally-set slice on its own heartbeat tick, so holding
  // the claim costs nothing extra on the wire.
  const claimingTyping = useRef(false);
  const idleTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  // `clearPresence` is rebound when the context changes, so the cleanup below
  // must capture the one belonging to the context being LEFT — reading the
  // current one would retract in the context just entered.
  const clearRef = useRef(clearPresence);
  clearRef.current = clearPresence;

  // Nothing is published until the person types: an idle composer sends
  // nothing (an entry is refreshed every few seconds while it stands, so
  // announcing on entry cost a call every few seconds per open composer).
  // Leaving mid-word takes the entry back.
  useEffect(() => {
    if (!contextId) return undefined;
    const clear = clearRef.current;
    claimingTyping.current = false;
    return () => {
      if (idleTimer.current) {
        clearTimeout(idleTimer.current);
        idleTimer.current = null;
      }
      if (claimingTyping.current) {
        claimingTyping.current = false;
        clear();
      }
    };
  }, [contextId]);

  const clearTyping = useCallback(() => {
    if (idleTimer.current) {
      clearTimeout(idleTimer.current);
      idleTimer.current = null;
    }
    if (!claimingTyping.current) return;
    claimingTyping.current = false;
    clearPresence();
  }, [clearPresence]);

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
    () =>
      [...peers.entries()].map(([account, slice]) => displayName(account, slice)),
    // eslint-disable-next-line react-hooks/exhaustive-deps -- `namesVersion`: names loaded
    [peers, namesVersion],
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
        .map(([account, slice]) => displayName(account, slice)),
    // `staleTick` is the dependency that matters: it fires when a claim ages
    // out with no new slice to trigger a recompute.
    // eslint-disable-next-line react-hooks/exhaustive-deps -- `namesVersion`: names loaded
    [peers, staleTick, namesVersion],
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
