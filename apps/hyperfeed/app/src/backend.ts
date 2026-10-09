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
  /** `answer`: the option picked or the text to send, for a proposal with an ask. */
  resolveAction(id: string, decision: Decision, answer?: string): Promise<FeedItem>;
  /** Answer a notification in place: the reply, the option, or "" to confirm. */
  answerNotification(id: string, answer: string): Promise<FeedItem>;
  /** Every row in a chain, oldest first. */
  chain(chain: string): Promise<FeedItem[]>;
  markSeen(ids: string[]): Promise<number>;
  markAllSeen(): Promise<number>;
  setPolicy(appKey: string, agent: AgentMode, notifications: NotificationMode): Promise<PolicyView>;
  setGuard(category: string, enabled: boolean): Promise<void>;
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
    resolveAction: (id, decision, answer = "") => client.resolveAction({ id, decision, answer }),
    answerNotification: (id, answer) => client.answerNotification({ id, answer }),
    chain: (chain) => client.chain({ chain }),
    markSeen: (ids) => client.markSeen({ ids }),
    markAllSeen: () => client.markAllSeen(),
    setPolicy: (appKey, agent, notifications) =>
      client.setPolicy({ app_key: appKey, agent, notifications }),
    setGuard: (category, enabled) => client.setGuard({ category, enabled }),
    setPaused: (paused) => client.setPaused({ paused }),
    recordNotification: (input) => client.recordNotification({ input }),
    recordAction: (input) => client.recordAction({ input }),
  };
}
