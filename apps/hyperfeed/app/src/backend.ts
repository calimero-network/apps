import type {
  ActionInput,
  FeedItem,
  FeedPage,
  HyperfeedClient,
  NotificationInput,
  PolicyView,
  SettingsView,
} from "./generated/HyperfeedClient";

export type Filter = "all" | "agent" | "notifications" | "needs_you";
export type Decision = "approve" | "decline" | "undo" | "keep";
export type AgentMode = "act" | "ask" | "read" | "off";
export type NotificationMode = "push" | "feed" | "mute";

/**
 * Everything the screens need from a feed, whichever feed it is.
 *
 * Two implementations: {@link nodeBackend}, which calls the Hyperfeed contract
 * in a context on your node, and `DemoBackend`, which keeps the same rules in
 * memory so the app can be tried without a node. The screens never know which
 * one they hold.
 */
export interface FeedBackend {
  readonly kind: "node" | "demo";
  feed(filter: Filter, appKey: string): Promise<FeedPage>;
  settings(): Promise<SettingsView>;
  resolveAction(id: string, decision: Decision): Promise<FeedItem>;
  markSeen(ids: string[]): Promise<number>;
  markAllSeen(): Promise<number>;
  setPolicy(appKey: string, agent: AgentMode, notifications: NotificationMode): Promise<PolicyView>;
  setGuard(category: string, on: boolean): Promise<void>;
  setPaused(paused: boolean): Promise<void>;
  recordNotification(input: NotificationInput): Promise<FeedItem>;
  recordAction(input: ActionInput): Promise<FeedItem>;
}

/** Rows per read. The contract's own default; the feed pages beyond it. */
export const PAGE_SIZE = 50;

export function nodeBackend(client: HyperfeedClient): FeedBackend {
  return {
    kind: "node",
    feed: (filter, appKey) => client.feed({ filter, app_key: appKey, limit: PAGE_SIZE, before: 0 }),
    settings: () => client.settings(),
    resolveAction: (id, decision) => client.resolveAction({ id, decision }),
    markSeen: (ids) => client.markSeen({ ids }),
    markAllSeen: () => client.markAllSeen(),
    setPolicy: (appKey, agent, notifications) =>
      client.setPolicy({ app_key: appKey, agent, notifications }),
    setGuard: (category, on) => client.setGuard({ category, on }),
    setPaused: (paused) => client.setPaused({ paused }),
    recordNotification: (input) => client.recordNotification({ input }),
    recordAction: (input) => client.recordAction({ input }),
  };
}
