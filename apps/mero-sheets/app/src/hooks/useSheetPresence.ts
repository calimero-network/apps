/**
 * Live cursors and selections over the app's presence channel
 * (`CalimeroClient.publishPresence` / `presenceStream`).
 *
 * Nothing here touches the contract: a cursor move is not a write, is not
 * stored, and never enters the workbook's log. Each open spreadsheet publishes
 * one small slice (see `PresenceSlice`) per device, re-published on a beat:
 * the cluster drops an entry not refreshed within 7 s, which is also how a
 * closed tab leaves.
 */
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { presenceState, type CalimeroClient, type PresenceEntry } from '@calimero-network/mero-js';

import { useMaybeSignedIn } from '../sessionContext';
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

/**
 * How often a slice is re-sent. The cluster forgets an entry after 7 s without
 * one, so the beat stays well under that (the staleness rule in
 * `spreadsheet/presence` still keys on `PRESENCE_BEAT_MS`).
 */
const HEARTBEAT_MS = Math.min(PRESENCE_BEAT_MS, 3_000);

/** How long to wait before reopening a dropped presence stream. */
const RETRY_MS = 3_000;

export interface UseSheetPresenceResult {
  cursors: PeerCursor[];
  /** Publish where you are; `null` when no cell is selected. */
  publish: (selection: LocalSelection | null) => void;
}

/** A presence entry's slice: hex of JSON, or nothing for a retracted or unreadable one. */
export function sliceOf(entry: Pick<PresenceEntry, 'state'>): PresenceSlice | null {
  const hex = entry.state;
  if (!hex || hex.length % 2 !== 0) return null;
  try {
    const bytes = new Uint8Array(hex.length / 2);
    for (let i = 0; i < bytes.length; i++) bytes[i] = parseInt(hex.slice(i * 2, i * 2 + 2), 16);
    const v: unknown = JSON.parse(new TextDecoder().decode(bytes));
    return v && typeof v === 'object' ? (v as PresenceSlice) : null;
  } catch {
    return null;
  }
}

const peerKey = (e: Pick<PresenceEntry, 'account' | 'device'>) => `${e.account}/${e.device}`;

export function useSheetPresence(
  contextId: string | null,
  selfId: string | null,
): UseSheetPresenceResult {
  const signedIn = useMaybeSignedIn();
  const client: CalimeroClient | null = signedIn?.client ?? null;
  const [peers, setPeers] = useState<ReadonlyMap<string, PresenceSlice>>(new Map());

  // Follow who is present: a snapshot, then one entry per change.
  useEffect(() => {
    setPeers(new Map());
    if (!client || !contextId) return undefined;
    const abort = new AbortController();
    const apply = (entries: PresenceEntry[], reset: boolean) =>
      setPeers((prev) => {
        const next = new Map(reset ? [] : prev);
        for (const e of entries) {
          const slice = sliceOf(e);
          if (slice) next.set(peerKey(e), slice);
          else next.delete(peerKey(e));
        }
        return next;
      });
    void (async () => {
      while (!abort.signal.aborted) {
        try {
          for await (const event of client.presenceStream(contextId, abort.signal)) {
            if (event.kind === 'snapshot' && Array.isArray(event.data)) apply(event.data as PresenceEntry[], true);
            else if (event.kind === 'presence' && event.data && typeof event.data === 'object') {
              apply([event.data as PresenceEntry], false);
            }
          }
        } catch {
          // Dropped: reopened below.
        }
        if (abort.signal.aborted) return;
        await new Promise((r) => setTimeout(r, RETRY_MS));
      }
    })();
    return () => abort.abort();
  }, [client, contextId]);

  // The latest slice, re-sent on every beat with `n` bumped. `seq` only grows:
  // the newest one wins, so it starts from the clock and survives a reload.
  const slice = useRef<PresenceSlice>(LEAVE_SLICE);
  const beat = useRef(0);
  const seq = useRef(Date.now());
  const send = useCallback(
    (next: PresenceSlice) => {
      if (!client || !contextId) return;
      seq.current += 1;
      const state = next.d === undefined ? null : new TextEncoder().encode(JSON.stringify(next));
      client.apps.presencePublish({ app: contextId, seq: seq.current, state: presenceState(state) }).catch((err: unknown) => {
        console.warn('[presence] publish failed', err);
      });
    },
    [client, contextId],
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
  // cluster's expiry, so it leaves instead and re-announces on return.
  useEffect(() => {
    if (!client || !contextId) return undefined;
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
      timer = setInterval(tick, HEARTBEAT_MS);
    };
    onVisibility();
    document.addEventListener('visibilitychange', onVisibility);
    return () => {
      document.removeEventListener('visibilitychange', onVisibility);
      clearInterval(timer);
      send(LEAVE_SLICE);
      slice.current = LEAVE_SLICE;
    };
  }, [client, contextId, send]);

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
