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

export interface ReadSink<T> {
  start: () => void;
  data: (next: T) => void;
  error: (err: unknown) => void;
  settle: () => void;
}

/**
 * A coalesced runner for one generation of `read`. When the read changes
 * (folder, board or filter switch) the hook bumps its generation; a result
 * from an older generation still in flight is dropped instead of overwriting
 * the newer one.
 */
export function generationRunner<T>(
  read: () => (() => Promise<T>) | null,
  isCurrent: () => boolean,
  sink: ReadSink<T>,
): () => Promise<void> {
  return coalesceReads(async () => {
    const r = read();
    if (!r || !isCurrent()) return;
    sink.start();
    try {
      const next = await r();
      if (isCurrent()) sink.data(next);
    } catch (err) {
      if (isCurrent()) sink.error(err);
    } finally {
      if (isCurrent()) sink.settle();
    }
  });
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
  const generationRef = useRef(0);
  useEffect(() => {
    const generation = ++generationRef.current;
    setData(null);
    setError(null);
    setWarmingUp(false);
    setLoading(false);
    warmingSinceRef.current = null;
    runRef.current = generationRunner<T>(
      () => readRef.current,
      () => generationRef.current === generation,
      {
        start: () => setLoading(true),
        data: (next) => {
          setData(next);
          setError(null);
          setWarmingUp(false);
          warmingSinceRef.current = null;
        },
        error: (err) => {
          const outcome = classifyReadError(err, warmingSinceRef.current);
          warmingSinceRef.current = outcome.warmingSince;
          setWarmingUp(outcome.warmingUp);
          setError(outcome.error);
        },
        settle: () => setLoading(false),
      },
    );
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
