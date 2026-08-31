// Live sync-status for one or more contexts, read off the SAME merod SSE
// stream that useContextEvents already consumes. Core pushes a
// `ContextEventPayload::SyncStatus` event as the sync run-loop changes
// phase (and per snapshot page), so a client waiting on a fresh join can
// SHOW real progress ("connecting to peers…", "receiving 60%…") instead
// of a static "syncing" placeholder the user can't tell from a failure.
//
// Wire shape (core `crates/primitives/src/events.rs` +
// `crates/primitives/src/sync_status.rs`), delivered by mero-react's
// `useSubscription` as `SseEventData { contextId, type, data }`:
//   { type: 'SyncStatus', contextId,
//     data: { syncState: { state, percent?, etaSecs?, recordsReceived?,
//                          retryInSecs? }, failureCount, lastError? } }
// `syncState` is internally tagged on `state` (camelCase). `is_initialized`
// is deliberately NOT on this event — it's a context-layer fact; the join
// gate infers "data arrived" from the folder-list load instead.

import { useCallback, useMemo, useState } from 'react';
import {
  useSubscription,
  type SseEventData,
} from '@calimero-network/mero-react';
import { normalizeContextIds } from './useContextEvents';

export type SyncPhase =
  | 'idle'
  | 'waitingForPeers'
  | 'syncing'
  | 'receivingSnapshot'
  | 'backingOff';

export interface SyncSnapshot {
  contextId: string;
  phase: SyncPhase;
  /** receivingSnapshot: 0-100 once the peer reports a total; null while unknown. */
  percent: number | null;
  etaSecs: number | null;
  recordsReceived: number | null;
  /** backingOff: seconds until the next retry attempt. */
  retryInSecs: number | null;
  failureCount: number;
  lastError: string | null;
}

const PHASES: ReadonlySet<string> = new Set<SyncPhase>([
  'idle',
  'waitingForPeers',
  'syncing',
  'receivingSnapshot',
  'backingOff',
]);

/** True when two snapshots are field-identical. The node re-emits SyncStatus
 *  on a timer (and per snapshot page), so consecutive events are often the same
 *  phase/progress; bailing out on an unchanged snapshot keeps `setLatest` from
 *  re-rendering every consumer (the whole workspace provider) on each idle tick. */
function sameSnapshot(a: SyncSnapshot | null, b: SyncSnapshot): boolean {
  return (
    a !== null &&
    a.contextId === b.contextId &&
    a.phase === b.phase &&
    a.percent === b.percent &&
    a.etaSecs === b.etaSecs &&
    a.recordsReceived === b.recordsReceived &&
    a.retryInSecs === b.retryInSecs &&
    a.failureCount === b.failureCount &&
    a.lastError === b.lastError
  );
}

/** Coerce a wire value to a finite number, else null — the payload is
 *  untrusted network input, and a bad `percent` would otherwise render as
 *  `NaN%` (and a broken width) in the progress bar. */
function num(v: unknown): number | null {
  return typeof v === 'number' && Number.isFinite(v) ? v : null;
}

/** Parse a raw SSE event into a SyncSnapshot, or null if it isn't a
 *  well-formed `SyncStatus` event. Pure — this is the unit under test. */
export function parseSyncStatusEvent(
  event: SseEventData | null | undefined,
): SyncSnapshot | null {
  if (!event || event.type !== 'SyncStatus') return null;
  const data = event.data as
    | {
        syncState?: {
          state?: string;
          percent?: number | null;
          etaSecs?: number | null;
          recordsReceived?: number | null;
          retryInSecs?: number | null;
        };
        failureCount?: number;
        lastError?: string | null;
      }
    | undefined;
  const s = data?.syncState;
  if (!s?.state || !PHASES.has(s.state)) return null;
  return {
    contextId: event.contextId,
    phase: s.state as SyncPhase,
    percent: num(s.percent),
    etaSecs: num(s.etaSecs),
    recordsReceived: num(s.recordsReceived),
    retryInSecs: num(s.retryInSecs),
    failureCount: num(data?.failureCount) ?? 0,
    lastError: typeof data?.lastError === 'string' ? data.lastError : null,
  };
}

/** Subscribe to `SyncStatus` events for `contextIds` and return the most
 *  recently received snapshot across them (null until the first arrives).
 *  Shares mero-react's per-id-set EventSource with useContextEvents, so
 *  this adds a handler, not a socket. */
export function useSyncStatus(
  contextIds:
    | ReadonlyArray<string | null | undefined>
    | string
    | null
    | undefined,
): SyncSnapshot | null {
  const ids = normalizeContextIds(contextIds);
  const idsKey = ids.join(',');
  // Membership set built once per id-set change (not re-split per event).
  const idSet = useMemo(
    () => new Set(idsKey ? idsKey.split(',') : []),
    [idsKey],
  );

  const [latest, setLatest] = useState<SyncSnapshot | null>(null);
  // Drop the previous id-set's snapshot the moment the subscription changes
  // (e.g. a namespace switch), synchronously during render — React re-renders
  // immediately without committing, so no consumer (nor the useDriveWorkspace
  // watchdog, which treats a lingering non-idle snapshot as "still syncing")
  // ever reads a stale phase for the new set. Resetting in an effect instead
  // leaves a one-render stale window and can wipe a just-arrived event.
  const [trackedKey, setTrackedKey] = useState(idsKey);
  if (idsKey !== trackedKey) {
    setTrackedKey(idsKey);
    setLatest(null);
  }

  const handler = useCallback(
    (event: SseEventData) => {
      const snap = parseSyncStatusEvent(event);
      if (!snap) return;
      // Only track contexts we asked about (the shared socket fans events
      // for every subscribed id set through to every handler).
      if (!idSet.has(snap.contextId)) return;
      // Bail out (return prev) when nothing changed so React skips the render.
      setLatest((prev) => (sameSnapshot(prev, snap) ? prev : snap));
    },
    [idSet],
  );

  useSubscription(ids, handler);
  return latest;
}
