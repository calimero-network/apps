import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { NotFound } from "@calimero-network/mero-js";
import { formsClient, type MeroFormsClient } from "./formsApi";
import { useSignedIn } from "./sessionContext";
import { visibleInterval } from "./lib/visibleInterval";

/**
 * Re-read on a timer too, not only on events. An event is a nudge, and a
 * dropped stream (laptop asleep, cluster restarted) would otherwise leave the
 * workspace stale with nothing on screen saying so.
 */
const POLL_MS = 30_000;

/**
 * After a write of yours, how long the event stream has to deliver it before
 * the workspace is re-read anyway.
 */
export const SETTLE_MS = 1_500;

/**
 * The forms client bound to this workspace (an app instance), plus a
 * `version` that bumps whenever the workspace may have changed: a local write,
 * a teammate's edit, or a new response from a form key or a public link.
 * Views re-read when it moves.
 *
 * The stream starts at the log's head: what is already committed is what the
 * views read, not replayed. A write of yours comes back on it like anyone
 * else's, so it is not re-read twice. The safety-net poll skips ticks while
 * the tab is hidden. `onLost` runs once the node no longer admits this
 * account to the workspace (removed from it, or it was deleted).
 *
 * There is no optimistic update anywhere. A change is shown once the contract
 * has taken it, which is the only point at which it is true.
 */
export function useWorkspace(appId: string, onLost?: () => void) {
  const { client: calimero, after } = useSignedIn();
  const client = useMemo(() => formsClient(calimero, appId, after), [calimero, appId, after]);

  const [version, setVersion] = useState(0);
  const bump = useCallback(() => setVersion((v) => v + 1), []);
  const lost = useRef(onLost);
  lost.current = onLost;

  useEffect(() => visibleInterval(bump, POLL_MS), [bump]);

  // The app's committed events, coalesced: one change can arrive as several.
  const pending = useRef<ReturnType<typeof setTimeout> | null>(null);
  const settle = useRef<ReturnType<typeof setTimeout> | null>(null);
  const streaming = useRef(false);
  useEffect(() => {
    const abort = new AbortController();
    void (async () => {
      try {
        const from = (await client.raw.myAccount()).index + 1;
        streaming.current = true;
        for await (const _event of client.events(from, abort.signal)) {
          if (settle.current) clearTimeout(settle.current);
          settle.current = null;
          if (pending.current) clearTimeout(pending.current);
          pending.current = setTimeout(() => {
            pending.current = null;
            bump();
          }, 250);
        }
      } catch (e) {
        // Not admitted any more: close it. Anything else (a dropped stream): the timer above still re-reads.
        if (!abort.signal.aborted && e instanceof NotFound) lost.current?.();
      } finally {
        streaming.current = false;
      }
    })();
    return () => {
      abort.abort();
      if (pending.current) clearTimeout(pending.current);
      if (settle.current) clearTimeout(settle.current);
    };
  }, [client, bump]);

  /** Run one contract call; its event re-reads, or a re-read follows if none comes. */
  const act = useCallback(
    async <T,>(fn: (c: MeroFormsClient) => Promise<T>): Promise<T> => {
      try {
        return await fn(client);
      } finally {
        if (!streaming.current) bump();
        else {
          if (settle.current) clearTimeout(settle.current);
          settle.current = setTimeout(() => {
            settle.current = null;
            bump();
          }, SETTLE_MS);
        }
      }
    },
    [client, bump],
  );

  return { client: client as MeroFormsClient | null, version, act };
}

export type Workspace = ReturnType<typeof useWorkspace>;

/**
 * Read `load` whenever `version` (or anything in `deps`) moves. Keeps the last
 * good value while re-reading, so a sync never blanks the screen, and reports
 * a failed read without throwing it away.
 */
export function useRead<T>(
  client: MeroFormsClient | null,
  version: number,
  load: (c: MeroFormsClient) => Promise<T>,
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
