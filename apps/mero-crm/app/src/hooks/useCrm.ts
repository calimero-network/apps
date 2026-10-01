/**
 * useCrm — the data binding for one pipeline (one context).
 *
 * The pipeline is small enough to hold whole: stages, every deal (open and
 * closed), people, activities, automations and settings are read together in
 * one round, and every view derives from that snapshot. That keeps the board,
 * the deal list, the to-do list and Insights consistent with each other by
 * construction — they are all the same read.
 *
 *  - `useSubscription([contextId])` re-reads on every sync event, so a
 *    teammate's move appears on your board with no polling (debounced: a join
 *    replicates in a burst).
 *  - Reads never overlap; a change during a read costs exactly one more read.
 *  - A context whose state has not replicated yet reports `warmingUp`, not an
 *    error (see utils/contextReadiness).
 *  - `act(fn)` runs any mutation through the typed client and then re-reads,
 *    so the UI never lags a write.
 */
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useMero, useSubscription } from '@calimero-network/mero-react';
import { useStreamReconnect } from './useStreamReconnect';
import {
  CrmClient,
  type ActivityView,
  type AutomationView,
  type ContactView,
  type DealDetail,
  type DealView,
  type Settings,
  type StageView,
} from '../generated/CrmClient';
import { SYNC_COALESCE_MS, WARMUP_RETRY_MS, classifyReadError } from '../utils/contextReadiness';

export type { ActivityView, AutomationView, ContactView, DealDetail, DealView, Settings, StageView };

export interface UseCrmArgs {
  contextId: string | null;
  executorPublicKey: string | null;
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
  warmingUp: boolean;
  ready: boolean;
  /** Bumped after every successful read — a cheap "something changed" signal. */
  version: number;
  refresh: () => Promise<void>;
  /** Run a mutation against the pipeline, then re-read. Throws on failure. */
  act: <T>(fn: (client: CrmClient) => Promise<T>) => Promise<T>;
  getDeal: (dealId: string) => Promise<DealDetail>;
}

const DEFAULT_SETTINGS: Settings = { currency: 'USD', rotting_days: 14 };

export function useCrm({ contextId, executorPublicKey }: UseCrmArgs): UseCrmReturn {
  const { mero } = useMero();
  const [stages, setStages] = useState<StageView[]>([]);
  const [deals, setDeals] = useState<DealView[]>([]);
  const [contacts, setContacts] = useState<ContactView[]>([]);
  const [activities, setActivities] = useState<ActivityView[]>([]);
  const [automations, setAutomations] = useState<AutomationView[]>([]);
  const [settings, setSettings] = useState<Settings>(DEFAULT_SETTINGS);
  const [loading, setLoading] = useState(false);
  const [loaded, setLoaded] = useState(false);
  const [error, setError] = useState<Error | null>(null);
  const [warmingUp, setWarmingUp] = useState(false);
  const [version, setVersion] = useState(0);

  const inFlightRef = useRef(false);
  const pendingRef = useRef(false);
  const warmingSinceRef = useRef<number | null>(null);

  const client = useMemo(
    () => (mero && contextId && executorPublicKey ? new CrmClient(mero, contextId) : null),
    [mero, contextId, executorPublicKey],
  );

  // A pipeline switch must not show the previous pipeline's deals for a beat.
  useEffect(() => {
    setStages([]); setDeals([]); setContacts([]); setActivities([]); setAutomations([]);
    setSettings(DEFAULT_SETTINGS); setLoaded(false);
  }, [contextId]);

  const refresh = useCallback(async () => {
    if (!client) return;
    if (inFlightRef.current) { pendingRef.current = true; return; }
    inFlightRef.current = true;
    setLoading(true);
    try {
      const [st, ds, cs, as, au, se] = await Promise.all([
        client.listStages(),
        client.listDeals({ status: null, stage_id: null, owner: null }),
        client.listContacts(),
        client.listActivities({ deal_id: null, done: null }),
        client.listAutomations(),
        client.getSettings(),
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
      setWarmingUp(false);
      warmingSinceRef.current = null;
    } catch (err) {
      const outcome = classifyReadError(err, warmingSinceRef.current);
      warmingSinceRef.current = outcome.warmingSince;
      setWarmingUp(outcome.warmingUp);
      setError(outcome.error);
    } finally {
      inFlightRef.current = false;
      setLoading(false);
      if (pendingRef.current) {
        pendingRef.current = false;
        void refreshRef.current();
      }
    }
  }, [client]);

  const refreshRef = useRef(refresh);
  refreshRef.current = refresh;

  useEffect(() => { void refresh(); }, [refresh]);

  useEffect(() => {
    if (!warmingUp || !client) return;
    const timer = setInterval(() => void refreshRef.current(), WARMUP_RETRY_MS);
    return () => clearInterval(timer);
  }, [warmingUp, client]);

  const coalesceRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  useEffect(() => () => { if (coalesceRef.current) clearTimeout(coalesceRef.current); }, []);
  useSubscription(contextId ? [contextId] : [], () => {
    if (coalesceRef.current) clearTimeout(coalesceRef.current);
    coalesceRef.current = setTimeout(() => {
      coalesceRef.current = null;
      void refreshRef.current();
    }, SYNC_COALESCE_MS);
  });
  useStreamReconnect(() => { void refreshRef.current(); });

  const act = useCallback(
    async <T,>(fn: (c: CrmClient) => Promise<T>): Promise<T> => {
      if (!client) throw new Error('Pipeline not ready yet');
      const result = await fn(client);
      await refresh();
      return result;
    },
    [client, refresh],
  );

  const getDeal = useCallback(
    async (dealId: string) => {
      if (!client) throw new Error('Pipeline not ready yet');
      return client.getDeal({ deal_id: dealId });
    },
    [client],
  );

  return {
    stages, deals, contacts, activities, automations, settings,
    loading, loaded, error, warmingUp, ready: client !== null, version,
    refresh, act, getDeal,
  };
}
