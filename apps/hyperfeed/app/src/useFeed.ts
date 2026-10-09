import { useCallback, useEffect, useRef, useState } from "react";
import type { FeedItem, FeedPage, LensView, SettingsView } from "./generated/HyperfeedClient";
import { fillReplyCall } from "./lens/lens";
import type { AgentMode, Decision, FeedBackend, Filter, NotificationMode } from "./backend";

export interface Feed {
  page: FeedPage | null;
  settings: SettingsView | null;
  /** What your agent learned for each app version, newest first. */
  lenses: LensView[];
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
  /**
   * Answer a notification in place. A typed row with a reply call is carried
   * out right here, in the source app, and reported delivered or failed; any
   * other answer waits for your agent.
   */
  answer: (id: string, answer: string) => Promise<void>;
  decideLens: (appKey: string, applicationId: string, decision: "approve" | "reject") => Promise<void>;
  /**
   * Talk to your agent about a chain ("" starts a new one). Resolves to your
   * message, so the caller can open its chain; null when the node refused it.
   */
  say: (chain: string, text: string) => Promise<FeedItem | null>;
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
  const [lenses, setLenses] = useState<LensView[]>([]);
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
        const [p, s, l] = await Promise.all([backend.feed(filter, appKey), backend.settings(), backend.lenses()]);
        setPage(p);
        setSettings(s);
        setLenses(l);
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
    lenses,
    error,
    busy,
    filter,
    appKey,
    setFilter,
    setAppKey,
    refresh,
    dismissError: useCallback(() => setError(null), []),
    resolve: useCallback((id, decision, answer) => run((b) => b.resolveAction(id, decision, answer)), [run]),
    answer: useCallback(
      (id, answer) =>
        run(async (b) => {
          const item = await b.answerNotification(id, answer);
          if (item.reply_call) await deliver(b, item, answer);
        }),
      [run],
    ),
    decideLens: useCallback(
      (appKey, applicationId, decision) => run((b) => b.decideLens(appKey, applicationId, decision)),
      [run],
    ),
    say: useCallback(
      async (chain, text) => {
        let posted: FeedItem | null = null;
        await run(async (b) => {
          posted = await b.say(chain, text);
        });
        return posted;
      },
      [run],
    ),
    loadChain: useCallback(async (chain) => (backend ? backend.chain(chain) : []), [backend]),
    markSeen: useCallback((ids) => run((b) => b.markSeen(ids)), [run]),
    markAllSeen: useCallback(() => run((b) => b.markAllSeen()), [run]),
    setPolicy: useCallback((k, agent, notifications) => run((b) => b.setPolicy(k, agent, notifications)), [run]),
    setGuard: useCallback((category, enabled) => run((b) => b.setGuard(category, enabled)), [run]),
    setPaused: useCallback((paused) => run((b) => b.setPaused(paused)), [run]),
  };
}

/**
 * Your answer, carried out in the app it belongs to with the call the row's
 * lens wrote, then reported. A refusal is reported too: the row goes back to
 * you as failed, with the app's own words, and can be answered again.
 */
export async function deliver(b: FeedBackend, item: FeedItem, answer: string): Promise<void> {
  try {
    const call = fillReplyCall(item.reply_call, answer);
    await b.callApp(item.source_context, call.method, call.args);
  } catch (e) {
    await b.completeAnswer(item.id, "failed", messageOf(e).slice(0, 900));
    throw e;
  }
  await b.completeAnswer(item.id, "delivered", item.source_label ? `Sent in ${item.source_label}` : "Sent");
}

/** The item a list row refers to, or the first one when nothing is picked. */
export function pickSelected(items: FeedItem[], selected: string | null): FeedItem | null {
  return items.find((i) => i.id === selected) ?? items[0] ?? null;
}

/** A contract refusal is a sentence; anything else gets one. */
export function messageOf(e: unknown): string {
  // An app's refusal arrives as `{ type: "FunctionCallError", data: "<its words>" }`.
  const data = (e as { data?: unknown } | null)?.data;
  if (typeof data === "string" && data) return data.replace(/^the method call returned an error:\s*/, "").replace(/^"|"$/g, "");
  if (e instanceof Error) return e.message;
  if (typeof e === "string") return e;
  return "Something went wrong talking to the node.";
}
