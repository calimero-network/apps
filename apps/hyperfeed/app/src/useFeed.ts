import { useCallback, useEffect, useRef, useState } from "react";
import type { FeedItem, FeedPage, SettingsView } from "./generated/HyperfeedClient";
import type { AgentMode, Decision, FeedBackend, Filter, NotificationMode } from "./backend";

export interface Feed {
  page: FeedPage | null;
  settings: SettingsView | null;
  error: string | null;
  busy: boolean;
  filter: Filter;
  appKey: string;
  setFilter: (f: Filter) => void;
  setAppKey: (k: string) => void;
  refresh: () => Promise<void>;
  dismissError: () => void;
  /** Decide on an action; `answer` is the option or text for a proposal with an ask. */
  resolve: (id: string, decision: Decision, answer?: string) => Promise<void>;
  /** Answer a notification in place. */
  answer: (id: string, answer: string) => Promise<void>;
  /** Every row in a chain, oldest first. A read: no busy state, no refresh. */
  loadChain: (chain: string) => Promise<FeedItem[]>;
  markSeen: (ids: string[]) => Promise<void>;
  markAllSeen: () => Promise<void>;
  setPolicy: (appKey: string, agent: AgentMode, notifications: NotificationMode) => Promise<void>;
  setGuard: (category: string, enabled: boolean) => Promise<void>;
  setPaused: (paused: boolean) => Promise<void>;
}

/**
 * Re-read when nothing arrived, for a change made while the event stream was
 * reconnecting: a missed event is never replayed.
 */
const POLL_MS = 15_000;

/**
 * One feed, kept current.
 *
 * There is no optimistic update: an approval is only an approval once the
 * contract has taken it, and every call is followed by a re-read. `nudge` is
 * how the caller says "something changed" — an event on the feed's context, or
 * the demo's own change listener.
 */
export function useFeed(backend: FeedBackend | null, nudge: number): Feed {
  const [page, setPage] = useState<FeedPage | null>(null);
  const [settings, setSettings] = useState<SettingsView | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [filter, setFilter] = useState<Filter>("all");
  const [appKey, setAppKey] = useState("");
  // A burst of events (an action and its status change) must not fire a read
  // per event; one in flight is enough, and the trailing one is kept.
  const reading = useRef(false);
  const again = useRef(false);

  const refresh = useCallback(async () => {
    if (!backend) return;
    if (reading.current) {
      again.current = true;
      return;
    }
    reading.current = true;
    try {
      do {
        again.current = false;
        const [p, s] = await Promise.all([backend.feed(filter, appKey), backend.settings()]);
        setPage(p);
        setSettings(s);
        setError(null);
      } while (again.current);
    } catch (e) {
      setError(messageOf(e));
    } finally {
      reading.current = false;
    }
  }, [backend, filter, appKey]);

  useEffect(() => {
    void refresh();
  }, [refresh, nudge]);

  useEffect(() => {
    const timer = window.setInterval(() => void refresh(), POLL_MS);
    return () => window.clearInterval(timer);
  }, [refresh]);

  const run = useCallback(
    async (fn: (b: FeedBackend) => Promise<unknown>) => {
      if (!backend) return;
      setBusy(true);
      setError(null);
      try {
        await fn(backend);
      } catch (e) {
        setError(messageOf(e));
      } finally {
        setBusy(false);
        await refresh();
      }
    },
    [backend, refresh],
  );

  return {
    page,
    settings,
    error,
    busy,
    filter,
    appKey,
    setFilter,
    setAppKey,
    refresh,
    dismissError: useCallback(() => setError(null), []),
    resolve: useCallback((id, decision, answer) => run((b) => b.resolveAction(id, decision, answer)), [run]),
    answer: useCallback((id, answer) => run((b) => b.answerNotification(id, answer)), [run]),
    loadChain: useCallback(async (chain) => (backend ? backend.chain(chain) : []), [backend]),
    markSeen: useCallback((ids) => run((b) => b.markSeen(ids)), [run]),
    markAllSeen: useCallback(() => run((b) => b.markAllSeen()), [run]),
    setPolicy: useCallback((k, agent, notifications) => run((b) => b.setPolicy(k, agent, notifications)), [run]),
    setGuard: useCallback((category, enabled) => run((b) => b.setGuard(category, enabled)), [run]),
    setPaused: useCallback((paused) => run((b) => b.setPaused(paused)), [run]),
  };
}

/** The item a list row refers to, or the first one when nothing is picked. */
export function pickSelected(items: FeedItem[], selected: string | null): FeedItem | null {
  return items.find((i) => i.id === selected) ?? items[0] ?? null;
}

/** A contract refusal is a sentence; anything else gets one. */
export function messageOf(e: unknown): string {
  if (e instanceof Error) return e.message;
  if (typeof e === "string") return e;
  return "Something went wrong talking to the node.";
}
