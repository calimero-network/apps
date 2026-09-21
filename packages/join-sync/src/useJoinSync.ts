import { useEffect, useMemo, useRef, useState } from "react";
import { clearNamespaceJustJoined, isNamespaceJustJoined } from "./justJoined";

/**
 * Base window for the gate. A governance op plus the namespace's own state
 * typically land in under a second on a healthy mesh; past this we give up
 * ONLY if nothing is actively in flight.
 */
export const JOIN_SYNC_WATCHDOG_MS = 30_000;
/**
 * Hard ceiling. Bounds a genuinely stuck sync so the gate can never pin the UI
 * forever, even while something keeps reporting activity.
 */
export const JOIN_SYNC_MAX_MS = 120_000;
/** How often the watchdog re-checks activity past the base window. */
export const JOIN_SYNC_POLL_MS = 2_000;

export interface JoinSyncOptions {
  /** The namespace being shown. `null` while nothing is selected. */
  namespaceId: string | null;
  /**
   * The app's own answer to "has this namespace's data actually arrived?" —
   * the one thing that cannot be shared, because every app reads a different
   * collection. Pass `true` once a real read has come back, INCLUDING an empty
   * one: "no documents yet" is a settled answer, and waiting for a non-empty
   * result would gate an genuinely empty workspace forever.
   */
  settled: boolean;
  /**
   * Optional: a sync is making forward progress. Holds the gate open past the
   * base window, up to the hard ceiling. Leave undefined if the app has no
   * such signal — the gate then simply expires at the base window.
   *
   * A stuck or backing-off sync must report `false`, not `true`: the point of
   * the base window is to stop waiting on something that is not coming.
   */
  active?: boolean;
}

export interface JoinSyncState {
  /**
   * Show the "syncing from peers" affordance. True only for a namespace this
   * session just joined, whose data has not arrived, within the watchdog.
   */
  isSyncing: boolean;
  /** Drop the gate now — for a "show me anyway" control. */
  dismiss: () => void;
}

/**
 * Gate the window between "you joined" and "your data is here".
 *
 * Without it a just-joined namespace renders its ordinary empty state, and the
 * user cannot tell an empty workspace from one that is still arriving. That
 * ambiguity is the whole reason this exists: the two look identical, and the
 * honest one is the less alarming of the two.
 */
export function useJoinSync({
  namespaceId,
  settled,
  active,
}: JoinSyncOptions): JoinSyncState {
  // Bumped to re-read the session store after we mutate it.
  const [tick, setTick] = useState(0);
  const firstSeen = useRef<Map<string, number>>(new Map());
  // Read from a ref inside the watchdog so a change in activity does not
  // restart the timer — which would let a chatty sync postpone the deadline
  // indefinitely.
  const activeRef = useRef(active);
  activeRef.current = active;

  const flagged = useMemo(() => {
    if (!namespaceId) return false;
    if (!isNamespaceJustJoined(namespaceId)) return false;
    if (!firstSeen.current.has(namespaceId)) {
      firstSeen.current.set(namespaceId, Date.now());
    }
    return true;
    // `tick` is the re-evaluate lever; `namespaceId` the real input.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [namespaceId, tick]);

  // Settled is the happy path: the data arrived, so stop gating and forget the
  // namespace. Runs before the watchdog ever fires in the normal case.
  useEffect(() => {
    if (!namespaceId || !flagged || !settled) return;
    clearNamespaceJustJoined(namespaceId);
    setTick((t) => t + 1);
  }, [namespaceId, flagged, settled]);

  useEffect(() => {
    if (!namespaceId || !flagged || settled) return;
    const since = firstSeen.current.get(namespaceId) ?? Date.now();
    let timer: ReturnType<typeof setTimeout>;
    const check = () => {
      const elapsed = Date.now() - since;
      const giveUp =
        elapsed >= JOIN_SYNC_MAX_MS ||
        (elapsed >= JOIN_SYNC_WATCHDOG_MS && !activeRef.current);
      if (giveUp) {
        clearNamespaceJustJoined(namespaceId);
        setTick((t) => t + 1);
        return;
      }
      timer = setTimeout(check, JOIN_SYNC_POLL_MS);
    };
    timer = setTimeout(check, JOIN_SYNC_WATCHDOG_MS);
    return () => clearTimeout(timer);
  }, [namespaceId, flagged, settled]);

  return {
    isSyncing: flagged && !settled,
    dismiss: () => {
      if (!namespaceId) return;
      clearNamespaceJustJoined(namespaceId);
      setTick((t) => t + 1);
    },
  };
}
