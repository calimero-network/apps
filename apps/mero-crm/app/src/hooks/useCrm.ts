/**
 * useCrm — the data binding for one pipeline (one app instance).
 *
 * The pipeline is small enough to hold whole: stages, deals (open and closed),
 * people, activities, automations and settings are read together in one
 * round, and every view derives from that snapshot. That keeps the board, the
 * deal list, the to-do list and Insights consistent with each other by
 * construction — they are all the same read.
 *
 *  - Teammates' changes arrive on the app's event stream (`client.events`),
 *    coalesced into one re-read, so a move appears on your board with no
 *    polling.
 *  - Reads never overlap; a change during a read costs exactly one more read.
 *  - `act(fn)` runs any mutation through the typed client (`crm.ts`) and
 *    settles once the re-read its own event starts has landed, so the UI never
 *    lags a write and a write costs one read, not two. With no event within
 *    {@link ECHO_WAIT_MS} (the stream closed), it re-reads itself.
 *
 * v1 waited for a joined context's state to replicate before its first read
 * ("warming up"); an app on Calimero 1.0 is read from its log, so the first
 * read answers.
 */
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import type { CalimeroClient } from '@calimero-network/mero-js';

import { MeroCrmClient } from '../generated/client';
import {
  toActivities,
  toAutomations,
  toContacts,
  toDealDetail,
  toDeals,
  toSettings,
  toStages,
  type ActivityView,
  type AutomationView,
  type ContactView,
  type DealDetail,
  type DealView,
  type Settings,
  type StageView,
} from '../crm';

export type { ActivityView, AutomationView, ContactView, DealDetail, DealView, Settings, StageView };

/** How long a burst of events is gathered into one re-read. */
export const EVENT_COALESCE_MS = 200;

export interface UseCrmArgs {
  client: CalimeroClient;
  /** The pipeline: an app instance id, or null when none is open. */
  appId: string | null;
  after?: () => void;
}

export interface UseCrmReturn {
  stages: StageView[];
  deals: DealView[];
  contacts: ContactView[];
  activities: ActivityView[];
  automations: AutomationView[];
  settings: Settings;
  loading: boolean;
  /** True once the first read has landed. */
  loaded: boolean;
  error: Error | null;
  ready: boolean;
  /** Bumped after every successful read — a cheap "something changed" signal. */
  version: number;
  refresh: () => Promise<void>;
  /** Run a mutation against the pipeline, then re-read. Throws on failure. */
  act: <T>(fn: (client: MeroCrmClient) => Promise<T>) => Promise<T>;
  getDeal: (dealId: string) => Promise<DealDetail>;
}

/** How long a write waits for its own event before it re-reads without one. */
export const ECHO_WAIT_MS = 1500;

const DEFAULT_SETTINGS: Settings = { currency: 'USD', rotting_days: 14 };

/** Calls `onChange` (coalesced) for each event of `app` until the returned stop. */
export function watchEvents(client: Pick<CalimeroClient, 'events'>, app: string, onChange: () => void): () => void {
  const abort = new AbortController();
  let timer: ReturnType<typeof setTimeout> | undefined;
  void (async () => {
    try {
      // From the next event on: the first read already covers what came before.
      for await (const _event of client.events(app, undefined, abort.signal)) {
        clearTimeout(timer);
        timer = setTimeout(onChange, EVENT_COALESCE_MS);
      }
    } catch {
      // Stream closed (sign-out, pipeline left, network): the next write re-reads.
    }
  })();
  return () => {
    clearTimeout(timer);
    abort.abort();
  };
}

export function useCrm({ client, appId, after }: UseCrmArgs): UseCrmReturn {
  const [stages, setStages] = useState<StageView[]>([]);
  const [deals, setDeals] = useState<DealView[]>([]);
  const [contacts, setContacts] = useState<ContactView[]>([]);
  const [activities, setActivities] = useState<ActivityView[]>([]);
  const [automations, setAutomations] = useState<AutomationView[]>([]);
  const [settings, setSettings] = useState<Settings>(DEFAULT_SETTINGS);
  const [loading, setLoading] = useState(false);
  const [loaded, setLoaded] = useState(false);
  const [error, setError] = useState<Error | null>(null);
  const [version, setVersion] = useState(0);

  const runningRef = useRef<Promise<void> | null>(null);
  const pendingRef = useRef(false);
  /** Writes waiting for the re-read their own event starts ({@link act}). */
  const echoRef = useRef(new Set<() => void>());

  const pipeline: MeroCrmClient | null = useMemo(
    () => (appId ? new MeroCrmClient(client, appId, { after }) : null),
    [client, appId, after],
  );

  // A pipeline switch must not show the previous pipeline's deals for a beat.
  useEffect(() => {
    setStages([]); setDeals([]); setContacts([]); setActivities([]); setAutomations([]);
    setSettings(DEFAULT_SETTINGS); setLoaded(false);
  }, [appId]);

  const readOnce = useCallback(async () => {
    if (!pipeline) return;
    setLoading(true);
    try {
      const [st, ds, cs, as, au, se] = await Promise.all([
        pipeline.listStages().then(toStages),
        pipeline.listDeals({ status: null, stageId: null, owner: null }).then(toDeals),
        pipeline.listContacts().then(toContacts),
        pipeline.listActivities({ dealId: null, done: null }).then(toActivities),
        pipeline.listAutomations().then(toAutomations),
        pipeline.getSettings().then(toSettings),
      ]);
      setStages(st ?? []);
      setDeals(ds ?? []);
      setContacts(cs ?? []);
      setActivities(as ?? []);
      setAutomations(au ?? []);
      setSettings(se ?? DEFAULT_SETTINGS);
      setLoaded(true);
      setVersion((v) => v + 1);
      setError(null);
    } catch (err) {
      setError(err instanceof Error ? err : new Error(String(err)));
    } finally {
      setLoading(false);
    }
  }, [pipeline]);

  const readRef = useRef(readOnce);
  readRef.current = readOnce;

  /** One read at a time; asked during one, one more after it. Settles once the reads asked for have landed. */
  const refresh = useCallback((): Promise<void> => {
    if (runningRef.current) {
      pendingRef.current = true;
      return runningRef.current;
    }
    const run = (async () => {
      try {
        do {
          pendingRef.current = false;
          await readRef.current();
        } while (pendingRef.current);
      } finally {
        runningRef.current = null;
      }
    })();
    runningRef.current = run;
    return run;
  }, []);

  useEffect(() => { void refresh(); }, [readOnce, refresh]);

  useEffect(() => {
    if (!appId) return;
    return watchEvents(client, appId, () => {
      const waiting = [...echoRef.current];
      echoRef.current.clear();
      void refresh().finally(() => waiting.forEach((done) => done()));
    });
  }, [client, appId, refresh]);

  const act = useCallback(
    async <T,>(fn: (c: MeroCrmClient) => Promise<T>): Promise<T> => {
      if (!pipeline) throw new Error('Pipeline not ready yet');
      const result = await fn(pipeline);
      // The write's own event re-reads; without one in time, re-read here.
      await new Promise<void>((resolve) => {
        const done = () => {
          clearTimeout(timer);
          resolve();
        };
        const timer = setTimeout(() => {
          echoRef.current.delete(done);
          void refresh().finally(resolve);
        }, ECHO_WAIT_MS);
        echoRef.current.add(done);
      });
      return result;
    },
    [pipeline, refresh],
  );

  const getDeal = useCallback(
    async (dealId: string) => {
      if (!pipeline) throw new Error('Pipeline not ready yet');
      return toDealDetail(await pipeline.getDeal({ dealId }));
    },
    [pipeline],
  );

  return {
    stages, deals, contacts, activities, automations, settings,
    loading, loaded, error, ready: pipeline !== null, version,
    refresh, act, getDeal,
  };
}
