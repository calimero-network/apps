import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useMero, useSubscription } from "@calimero-network/mero-react";
import type { SubscriptionEventData } from "@calimero-network/mero-react";
import { LeadsClient } from "./generated/LeadsClient";

/**
 * Re-read on a timer too, not only on events. An event is a nudge, and a
 * dropped stream (laptop asleep, node restarted) would otherwise leave the
 * inbox stale with nothing on screen saying so.
 */
const POLL_MS = 30_000;

/**
 * The generated client bound to this session's inbox context, plus a
 * `version` that bumps whenever the inbox may have changed — a local write, a
 * teammate's edit synced from their node, or a new lead from a form key.
 * Views re-read when it moves.
 *
 * There is no optimistic update anywhere. A change is shown once the contract
 * has taken it, which is the only point at which it is true; on a local node
 * that round trip is short enough not to need hiding.
 */
export function useInbox(contextId: string) {
  const { mero } = useMero();
  const client = useMemo(() => (mero ? new LeadsClient(mero, contextId) : null), [mero, contextId]);

  const [version, setVersion] = useState(0);
  const bump = useCallback(() => setVersion((v) => v + 1), []);

  useEffect(() => {
    const timer = window.setInterval(bump, POLL_MS);
    return () => window.clearInterval(timer);
  }, [bump]);

  // Coalesced: one change can arrive as several events.
  const pending = useRef<ReturnType<typeof setTimeout> | null>(null);
  useEffect(() => () => {
    if (pending.current) clearTimeout(pending.current);
  }, []);
  useSubscription(
    useMemo(() => [contextId], [contextId]),
    useCallback(
      (event: SubscriptionEventData) => {
        if ("contextId" in event && event.contextId !== contextId) return;
        if (pending.current) clearTimeout(pending.current);
        pending.current = setTimeout(() => {
          pending.current = null;
          bump();
        }, 250);
      },
      [contextId, bump],
    ),
  );

  /** Run one contract call, then re-read everything. */
  const act = useCallback(
    async <T,>(fn: (c: LeadsClient) => Promise<T>): Promise<T> => {
      if (!client) throw new Error("Not connected to a node yet.");
      try {
        return await fn(client);
      } finally {
        bump();
      }
    },
    [client, bump],
  );

  return { client, version, act };
}

export type Inbox = ReturnType<typeof useInbox>;

/**
 * Read `load` whenever `version` (or anything in `deps`) moves. Keeps the last
 * good value while re-reading, so a sync never blanks the screen, and reports
 * a failed read without throwing it away.
 */
export function useRead<T>(
  client: LeadsClient | null,
  version: number,
  load: (c: LeadsClient) => Promise<T>,
  deps: unknown[],
): { data: T | null; error: string | null; loading: boolean } {
  const [data, setData] = useState<T | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const loadRef = useRef(load);
  loadRef.current = load;

  useEffect(() => {
    if (!client) return;
    let live = true;
    setLoading(true);
    loadRef
      .current(client)
      .then((v) => {
        if (!live) return;
        setData(v);
        setError(null);
      })
      .catch((e: unknown) => {
        if (live) setError(e instanceof Error ? e.message : String(e));
      })
      .finally(() => {
        if (live) setLoading(false);
      });
    return () => {
      live = false;
    };
    // `deps` is the caller's own dependency list, spread on purpose.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [client, version, ...deps]);

  return { data, error, loading };
}
