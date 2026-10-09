import type {
  ActionInput,
  FeedItem,
  FeedPage,
  HyperfeedClient,
  LensView,
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
  /** Report how an answer went, when the feed carried it out itself (a typed row's reply call). */
  completeAnswer(id: string, outcome: "delivered" | "failed", note: string): Promise<FeedItem>;
  /** Call a method of another app on your node: how a typed row is answered directly. */
  callApp(contextId: string, method: string, args: Record<string, unknown>): Promise<unknown>;
  /** What your agent learned for each app version, and what you decided. */
  lenses(): Promise<LensView[]>;
  decideLens(appKey: string, applicationId: string, decision: "approve" | "reject"): Promise<LensView>;
  /** Every row in a chain, oldest first. */
  chain(chain: string): Promise<FeedItem[]>;
  /** Talk to your agent about a chain, or about anything with `chain` "" (a new chain). */
  say(chain: string, text: string): Promise<FeedItem>;
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

/** The one call the feed makes into other apps. */
export interface AppRpc {
  execute<T>(params: { contextId: string; method: string; argsJson?: Record<string, unknown> }): Promise<T>;
}

export function nodeBackend(client: HyperfeedClient, rpc: AppRpc): FeedBackend {
  return {
    kind: "node",
    feed: (filter, appKey) => client.feed({ filter, app_key: appKey, limit: PAGE_SIZE, before: 0 }),
    settings: () => client.settings(),
    resolveAction: (id, decision, answer = "") => client.resolveAction({ id, decision, answer }),
    answerNotification: (id, answer) => client.answerNotification({ id, answer }),
    completeAnswer: (id, outcome, note) => client.completeAnswer({ id, outcome, note }),
    callApp: (contextId, method, args) => rpc.execute({ contextId, method, argsJson: args }),
    lenses: () => client.lenses(),
    decideLens: (appKey, applicationId, decision) =>
      client.decideLens({ app_key: appKey, application_id: applicationId, decision }),
    chain: (chain) => client.chain({ chain }),
    say: (chain, text) => client.say({ chain, text }),
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
