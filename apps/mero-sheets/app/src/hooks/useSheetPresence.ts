/**
 * Live cursors and selections over the node's ephemeral presence channel.
 *
 * Nothing here touches the contract: a cursor move is not a commit, is not
 * stored, and never enters the workbook's sync history. Each open spreadsheet
 * publishes one small slice (see `PresenceSlice`), re-published on a beat so
 * peers can tell a live tab from a closed one whose node keeps replaying it.
 */
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useEphemeral, useMero } from '@calimero-network/mero-react';

import type { Rect } from '../spreadsheet/refs';
import {
  cursorsFromPresence,
  PRESENCE_BEAT_MS,
  type PeerCursor,
  type PresenceSlice,
} from '../spreadsheet/presence';

/** Where the local user is: the active cell, and the range when it spans cells. */
export interface LocalSelection {
  sheetId: string;
  row: number;
  col: number;
  range: Rect | null;
}

/** Carries no member id, so every reader drops the author. */
const LEAVE_SLICE: PresenceSlice = {};

export interface UseSheetPresenceResult {
  cursors: PeerCursor[];
  /** Publish where you are; `null` when no cell is selected. */
  publish: (selection: LocalSelection | null) => void;
}

export function useSheetPresence(
  contextId: string | null,
  selfId: string | null,
): UseSheetPresenceResult {
  const { mero } = useMero();
  const ephemeral = mero?.ephemeral;
  const { peers } = useEphemeral<PresenceSlice>(contextId);

  // The latest slice, re-sent on every beat with `n` bumped.
  const slice = useRef<PresenceSlice>(LEAVE_SLICE);
  const beat = useRef(0);
  const send = useCallback(
    (next: PresenceSlice) => {
      if (!ephemeral || !contextId) return;
      ephemeral.set(contextId, next).catch((err: unknown) => {
        console.warn('[presence] publish failed', err);
      });
    },
    [ephemeral, contextId],
  );

  const publish = useCallback(
    (sel: LocalSelection | null) => {
      if (!selfId || !sel) {
        slice.current = LEAVE_SLICE;
      } else {
        const g = sel.range
          ? ([sel.range.top, sel.range.left, sel.range.bottom, sel.range.right] as [number, number, number, number])
          : null;
        slice.current = { d: selfId, s: sel.sheetId, r: sel.row, c: sel.col, g, n: beat.current };
      }
      send(slice.current);
    },
    [selfId, send],
  );

  // Beat while visible; a hidden tab's timers can be throttled past the
  // staleness window, so it leaves instead and re-announces on return.
  useEffect(() => {
    if (!ephemeral || !contextId) return undefined;
    let timer: ReturnType<typeof setInterval> | undefined;
    const tick = () => {
      if (slice.current.d === undefined) return;
      beat.current += 1;
      slice.current = { ...slice.current, n: beat.current };
      send(slice.current);
    };
    const onVisibility = () => {
      clearInterval(timer);
      if (document.visibilityState === 'hidden') {
        send(LEAVE_SLICE);
        return;
      }
      if (slice.current.d !== undefined) send(slice.current);
      timer = setInterval(tick, PRESENCE_BEAT_MS);
    };
    onVisibility();
    document.addEventListener('visibilitychange', onVisibility);
    return () => {
      document.removeEventListener('visibilitychange', onVisibility);
      clearInterval(timer);
      // The node heartbeats the last slice until told otherwise.
      send(LEAVE_SLICE);
      slice.current = LEAVE_SLICE;
    };
  }, [ephemeral, contextId, send]);

  // When each peer's slice last CHANGED: the node's heartbeat refreshes
  // arrival for a closed tab too, so only a change proves liveness.
  const changedAt = useRef(new Map<string, { fingerprint: string; at: number }>());
  const [now, setNow] = useState(Date.now);
  useEffect(() => {
    const timer = setInterval(() => setNow(Date.now()), PRESENCE_BEAT_MS);
    return () => clearInterval(timer);
  }, []);

  const cursors = useMemo(() => {
    const t = Math.max(now, Date.now());
    const seen = changedAt.current;
    for (const [author, s] of peers) {
      const fingerprint = JSON.stringify(s);
      const prev = seen.get(author);
      if (!prev || prev.fingerprint !== fingerprint) seen.set(author, { fingerprint, at: t });
    }
    for (const author of [...seen.keys()]) if (!peers.has(author)) seen.delete(author);
    const at = new Map([...seen].map(([a, v]) => [a, v.at]));
    return cursorsFromPresence(peers, at, t, selfId);
  }, [peers, now, selfId]);

  return { cursors, publish };
}
