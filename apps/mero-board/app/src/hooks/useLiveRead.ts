/**
 * One read, kept live. The tracker's useIssues rules, generalised:
 *  - one read in flight at a time; a request during a read runs once after it
 *  - sync events are debounced (SYNC_COALESCE_MS) and refetch
 *  - a "context not initialised yet" failure is held as `warmingUp`, retried on
 *    a timer, and promoted to `error` if it never clears (utils/contextReadiness)
 *  - a stream reconnect refetches, since nothing replays missed events
 */
import { useCallback, useEffect, useRef, useState } from 'react';
import { useSubscription } from '@calimero-network/mero-react';
import { useStreamReconnect } from './useStreamReconnect';
import { SYNC_COALESCE_MS, WARMUP_RETRY_MS, classifyReadError } from '../utils/contextReadiness';

/** Serialises an async read: concurrent calls coalesce into one trailing re-run. */
export function coalesceReads(read: () => Promise<void>): () => Promise<void> {
  let inFlight = false;
  let pending = false;
  const run = async (): Promise<void> => {
    if (inFlight) { pending = true; return; }
    inFlight = true;
    try {
      await read();
    } finally {
      inFlight = false;
      if (pending) { pending = false; void run(); }
    }
  };
  return run;
}

export interface LiveRead<T> {
  data: T | null;
  loading: boolean;
  error: Error | null;
  warmingUp: boolean;
  refresh: () => Promise<void>;
  /** Replace the data locally (optimistic update); the next refresh overwrites it. */
  patch: (fn: (prev: T | null) => T | null) => void;
}

export function useLiveRead<T>(contextId: string | null, read: (() => Promise<T>) | null): LiveRead<T> {
  const [data, setData] = useState<T | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<Error | null>(null);
  const [warmingUp, setWarmingUp] = useState(false);
  const warmingSinceRef = useRef<number | null>(null);
  const readRef = useRef(read);
  readRef.current = read;

  const runRef = useRef<() => Promise<void>>(async () => {});
  useEffect(() => {
    runRef.current = coalesceReads(async () => {
      const r = readRef.current;
      if (!r) return;
      setLoading(true);
      try {
        const next = await r();
        setData(next);
        setError(null);
        setWarmingUp(false);
        warmingSinceRef.current = null;
      } catch (err) {
        const outcome = classifyReadError(err, warmingSinceRef.current);
        warmingSinceRef.current = outcome.warmingSince;
        setWarmingUp(outcome.warmingUp);
        setError(outcome.error);
      } finally {
        setLoading(false);
      }
    });
    void runRef.current();
  }, [read]);

  const refresh = useCallback(() => runRef.current(), []);

  useEffect(() => {
    if (!warmingUp || !read) return;
    const timer = setInterval(() => void runRef.current(), WARMUP_RETRY_MS);
    return () => clearInterval(timer);
  }, [warmingUp, read]);

  const coalesceRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  useEffect(() => () => { if (coalesceRef.current) clearTimeout(coalesceRef.current); }, []);
  useSubscription(contextId ? [contextId] : [], () => {
    if (coalesceRef.current) clearTimeout(coalesceRef.current);
    coalesceRef.current = setTimeout(() => {
      coalesceRef.current = null;
      void runRef.current();
    }, SYNC_COALESCE_MS);
  });
  useStreamReconnect(() => { void runRef.current(); });

  const patch = useCallback((fn: (prev: T | null) => T | null) => setData(fn), []);

  return { data, loading, error, warmingUp, refresh, patch };
}
