import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { FormsClient } from "./formsApi";
import { useSignedIn } from "./sessionContext";

/**
 * Re-read on a timer too, not only on events. An event is a nudge, and a
 * dropped stream (laptop asleep, cluster restarted) would otherwise leave the
 * workspace stale with nothing on screen saying so.
 */
const POLL_MS = 30_000;

/**
 * The forms client bound to this workspace (an app instance), plus a
 * `version` that bumps whenever the workspace may have changed: a local write,
 * a teammate's edit, or a new response from a form key or a public link.
 * Views re-read when it moves.
 *
 * There is no optimistic update anywhere. A change is shown once the contract
 * has taken it, which is the only point at which it is true.
 */
export function useWorkspace(appId: string) {
  const { client: calimero, after } = useSignedIn();
  const client = useMemo(() => new FormsClient(calimero, appId, after), [calimero, appId, after]);

  const [version, setVersion] = useState(0);
  const bump = useCallback(() => setVersion((v) => v + 1), []);

  useEffect(() => {
    const timer = window.setInterval(bump, POLL_MS);
    return () => window.clearInterval(timer);
  }, [bump]);

  // The app's committed events, coalesced: one change can arrive as several.
  const pending = useRef<ReturnType<typeof setTimeout> | null>(null);
  useEffect(() => {
    const abort = new AbortController();
    void (async () => {
      try {
        for await (const _event of calimero.events(appId, undefined, abort.signal)) {
          if (pending.current) clearTimeout(pending.current);
          pending.current = setTimeout(() => {
            pending.current = null;
            bump();
          }, 250);
        }
      } catch {
        // The stream dropped or was refused: the timer above still re-reads.
      }
    })();
    return () => {
      abort.abort();
      if (pending.current) clearTimeout(pending.current);
    };
  }, [calimero, appId, bump]);

  /** Run one contract call, then re-read everything. */
  const act = useCallback(
    async <T,>(fn: (c: FormsClient) => Promise<T>): Promise<T> => {
      try {
        return await fn(client);
      } finally {
        bump();
      }
    },
    [client, bump],
  );

  return { client: client as FormsClient | null, version, act };
}

export type Workspace = ReturnType<typeof useWorkspace>;

/**
 * Read `load` whenever `version` (or anything in `deps`) moves. Keeps the last
 * good value while re-reading, so a sync never blanks the screen, and reports
 * a failed read without throwing it away.
 */
export function useRead<T>(
  client: FormsClient | null,
  version: number,
  load: (c: FormsClient) => Promise<T>,
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
