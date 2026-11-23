import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { NotFound } from "@calimero-network/mero-js";
import type { AppEvent } from "./generated/client";
import { minutesClient, type MeroMinutesClient } from "./minutesApi";
import { useSignedIn } from "./sessionContext";
import { visibleInterval } from "./lib/visibleInterval";

/** Re-read on a timer too: a dropped stream must not leave the workspace stale. */
const POLL_MS = 30_000;

/** After a write of yours, how long the event stream has to deliver it before a re-read anyway. */
export const SETTLE_MS = 1_500;

export type EventListener = (event: AppEvent) => void;

/**
 * The Minutes client bound to this workspace (an app instance), a `version`
 * that bumps when anything may have changed, and `subscribe` for the app's
 * events as they arrive: a meeting page re-reads only the transcript range a
 * `TranscriptChanged` names instead of the whole meeting.
 *
 * The stream starts at the log's head. The safety-net poll skips ticks while
 * the tab is hidden. `onLost` runs once the node no longer admits this account.
 */
export function useWorkspace(appId: string, onLost?: () => void) {
  const { client: calimero, after } = useSignedIn();
  const lost = useRef(onLost);
  lost.current = onLost;
  const client = useMemo(
    () => minutesClient(admitted(calimero, () => lost.current?.()), appId, after),
    [calimero, appId, after],
  );

  const [version, setVersion] = useState(0);
  const bump = useCallback(() => setVersion((v) => v + 1), []);
  const listeners = useRef(new Set<EventListener>());
  const subscribe = useCallback((fn: EventListener) => {
    listeners.current.add(fn);
    return () => {
      listeners.current.delete(fn);
    };
  }, []);

  useEffect(() => visibleInterval(bump, POLL_MS), [bump]);

  const pending = useRef<ReturnType<typeof setTimeout> | null>(null);
  const settle = useRef<ReturnType<typeof setTimeout> | null>(null);
  const streaming = useRef(false);
  useEffect(() => {
    const abort = new AbortController();
    void (async () => {
      let ended = false;
      try {
        const from = (await client.raw.myAccount()).index + 1;
        streaming.current = true;
        for await (const event of client.events(from, abort.signal)) {
          for (const fn of listeners.current) fn(event);
          if (settle.current) clearTimeout(settle.current);
          settle.current = null;
          if (pending.current) clearTimeout(pending.current);
          pending.current = setTimeout(() => {
            pending.current = null;
            bump();
          }, 250);
        }
        ended = true;
      } catch (e) {
        if (!abort.signal.aborted && e instanceof NotFound) lost.current?.();
      } finally {
        streaming.current = false;
      }
      if (ended && !abort.signal.aborted) bump();
    })();
    return () => {
      abort.abort();
      if (pending.current) clearTimeout(pending.current);
      if (settle.current) clearTimeout(settle.current);
    };
  }, [client, bump]);

  /** Run one contract call; its event re-reads, or a re-read follows if none comes. */
  const act = useCallback(
    async <T,>(fn: (c: MeroMinutesClient) => Promise<T>): Promise<T> => {
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

  return { client: client as MeroMinutesClient | null, version, act, subscribe };
}

export type Workspace = ReturnType<typeof useWorkspace>;

type Transport = Parameters<typeof minutesClient>[0];

/** `client` with `onLost` run when the node refuses a call because the app is not there for this account any more. */
function admitted(client: Transport, onLost: () => void): Transport {
  const check = (e: unknown): never => {
    if (e instanceof NotFound && typeof (e as { appCode?: unknown }).appCode !== "string") onLost();
    throw e;
  };
  return {
    ...client,
    apps: {
      call: (args, options) => client.apps.call(args, options).catch(check),
      view: (args, options) => client.apps.view(args, options).catch(check),
    },
    events: client.events?.bind(client),
  };
}

/**
 * Read `load` whenever `version` (or anything in `deps`) moves. Keeps the last
 * good value while re-reading, and reports a failed read without dropping it.
 */
export function useRead<T>(
  client: MeroMinutesClient | null,
  version: number,
  load: (c: MeroMinutesClient) => Promise<T>,
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
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [client, version, ...deps]);

  return { data, error, loading };
}
