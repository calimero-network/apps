import type { BlobStore } from "./attachments";
import type {
  ActionInput,
  ActionSetView,
  Attachment,
  CheckpointView,
  FeedItem,
  FeedPage,
  HyperfeedClient,
  LensView,
  LinkView,
  NotificationInput,
  PolicyView,
  PrView,
  PushDeviceInput,
  PushDeviceView,
  PushKeyView,
  RuleProposalView,
  RuleView,
  AgentRuleView,
  SettingsView,
  WatchView,
  Folder,
} from "./generated/HyperfeedClient";
import { mergeWatchInput } from "./watches";

export type Filter = "all" | "agent" | "notifications" | "needs_you" | "archived";
export type Decision = "approve" | "decline" | "undo" | "keep";
export type AgentMode = "act" | "ask" | "read" | "off";
export type NotificationMode = "push" | "feed" | "mute";
/** How you set one action; "" follows its app. */
export type ActionMode = "" | "act" | "ask" | "off";

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
  /** Report how a draft you approved went: the feed sends those itself (an action's reply call). */
  completeAction(id: string, outcome: "done" | "failed", note: string): Promise<FeedItem>;
  /** Call a method of another app on your node: how a typed row is answered directly. */
  callApp(contextId: string, method: string, args: Record<string, unknown>): Promise<unknown>;
  /** What your agent learned for each app version, and what you decided. */
  lenses(): Promise<LensView[]>;
  decideLens(appKey: string, applicationId: string, decision: "approve" | "reject"): Promise<LensView>;
  /** What your agent can do in each app version, as it learned it, and what you decided; [] when the feed predates actions. */
  actionSets?(): Promise<ActionSetView[]>;
  decideActions?(appKey: string, applicationId: string, decision: "approve" | "reject"): Promise<ActionSetView>;
  /** Set one action apart from its app's mode: "act", "ask", "off", or "" to follow the app again. */
  setActionMode?(appKey: string, action: string, mode: ActionMode): Promise<void>;
  /** Every row in a chain, oldest first. */
  chain(chain: string): Promise<FeedItem[]>;
  /** Where the task in a chain stands, as your agent last wrote it; null when it wrote none, or the feed predates checkpoints. */
  checkpoint?(chain: string): Promise<CheckpointView | null>;
  /** The watches in a chain ("when X, do Y"), oldest first; [] when the feed predates watches. */
  watches?(chain: string): Promise<WatchView[]>;
  /** Cancel a watch that has not fired yet. */
  cancelWatch?(id: string): Promise<WatchView>;
  /**
   * A PR card's Merge, or Merge when green: a merge watch on the task's chain
   * (`pr_green` → `merge`). Your agent's runtime fires it once every check
   * passed, and merges only by the safe-merge rules.
   */
  mergeWhenGreen?(chain: string, repo: string, pr: number): Promise<WatchView>;
  /** The PRs your agent's runtime recorded as it saw them on GitHub (`""`: every chain); [] when the feed predates them. */
  prs?(chain: string): Promise<PrView[]>;
  /** The things a task works on in your other apps, as chips; [] when the feed predates links. */
  links?(chain: string): Promise<LinkView[]>;
  /** Link a thing (`<app>:<context>[:<id>]`) to a task by hand; what teammates do there joins it. */
  addLink?(chain: string, subject: string, label: string): Promise<LinkView>;
  /** Take a link off a task: your agent touching the thing again does not bring it back. */
  removeLink?(chain: string, subject: string): Promise<void>;
  /** The key phones subscribe with (empty before your agent's runtime set one); null when the feed predates push. */
  pushKey?(): Promise<PushKeyView | null>;
  /** The devices your agent's runtime pushes to, newest first; [] when the feed predates push. */
  pushDevices?(): Promise<PushDeviceView[]>;
  /** Push to this device: its browser's subscription, a name, and whether it stays quiet. */
  addPushDevice?(input: PushDeviceInput): Promise<PushDeviceView>;
  /** Stop pushing to a device. */
  removePushDevice?(endpoint: string): Promise<void>;
  /**
   * Talk to your agent about a chain, or about anything with `chain` "" (a new
   * chain). With images (uploaded with {@link FeedBackend.images}), `text` may be empty.
   * `mode` says which of your agents it is for; pass it only to a feed whose
   * settings list `message_modes`, since an older feed refuses the argument.
   */
  say(chain: string, text: string, attachments?: Attachment[], mode?: string): Promise<FeedItem>;
  /**
   * Answer one of your agent's questions from its buttons: your next message
   * in its chain (`chain`), marked as answering that question. A feed made
   * before `answer_ask` takes it as a plain message in the chain.
   */
  answerAsk(id: string, chain: string, text: string): Promise<FeedItem>;
  /** Where images on your messages are kept; null when this feed can't hold them. */
  readonly images: BlobStore | null;
  /** Ask your agent to stop working on one of your messages. */
  stop(id: string): Promise<FeedItem>;
  markSeen(ids: string[]): Promise<number>;
  markAllSeen(): Promise<number>;
  setPolicy(appKey: string, agent: AgentMode, notifications: NotificationMode): Promise<PolicyView>;
  setGuard(category: string, enabled: boolean): Promise<void>;
  setPaused(paused: boolean): Promise<void>;
  /**
   * What `agent` may reach on its computer besides your Calimero apps; it
   * replaces what was set. Only a feed whose settings carry `access` has it.
   */
  setAccess?(agent: string, folders: Folder[], shell: boolean, web: boolean): Promise<void>;
  /**
   * Which agent works in `app` (its name as it reports in); `""` gives the app
   * back to the default. Only a feed whose settings carry `assignments` has it.
   */
  setAssignment?(app: string, agent: string): Promise<void>;
  /**
   * Add an agent with an account of its own (a cloud agent) under the name it
   * reports in with, or take one off. Only a feed whose settings carry
   * `agent_accounts` has them.
   */
  addAgentAccount?(account: string, name: string): Promise<void>;
  removeAgentAccount?(account: string): Promise<void>;
  /** Add one of your standing rules: a short line your agent keeps to on every turn. */
  addRule(text: string): Promise<RuleView>;
  removeRule(id: string): Promise<void>;
  /**
   * Add a rule for one agent only (its name as it reports in): it keeps it
   * after your general rules. Only a feed whose settings carry `agent_rules` has it.
   */
  addAgentRule?(agent: string, text: string): Promise<AgentRuleView>;
  removeAgentRule?(id: string): Promise<void>;
  /** Approve a rule your agent suggested: it becomes your own rule. */
  approveRule(id: string): Promise<RuleView>;
  dismissRule(id: string): Promise<RuleProposalView>;
  /** Put chains away until something new happens in them, or until `until` (ms) for "later". */
  archive(chains: string[], until?: number): Promise<number>;
  unarchive(chains: string[]): Promise<number>;
  recordNotification(input: NotificationInput): Promise<FeedItem>;
  recordAction(input: ActionInput): Promise<FeedItem>;
}

/** Rows per read. The contract's own default; the feed pages beyond it. */
export const PAGE_SIZE = 50;

/** The one call the feed makes into other apps. */
export interface AppRpc {
  execute<T>(params: { contextId: string; method: string; argsJson?: Record<string, unknown> }): Promise<T>;
}

export function nodeBackend(client: HyperfeedClient, rpc: AppRpc, images: BlobStore | null = null): FeedBackend {
  return {
    kind: "node",
    images,
    feed: (filter, appKey) => client.feed({ filter, app_key: appKey, limit: PAGE_SIZE, before: 0 }),
    settings: () => client.settings(),
    resolveAction: (id, decision, answer = "") => client.resolveAction({ id, decision, answer }),
    answerNotification: (id, answer) => client.answerNotification({ id, answer }),
    completeAnswer: (id, outcome, note) => client.completeAnswer({ id, outcome, note }),
    completeAction: (id, outcome, note) => client.completeAction({ id, outcome, note }),
    callApp: (contextId, method, args) => rpc.execute({ contextId, method, argsJson: args }),
    lenses: () => client.lenses(),
    decideLens: (appKey, applicationId, decision) =>
      client.decideLens({ app_key: appKey, application_id: applicationId, decision }),
    actionSets: () =>
      client.actionSets().catch((e: unknown) => {
        if (lacksMethod(e, "action_sets")) return [];
        throw e;
      }),
    decideActions: (appKey, applicationId, decision) =>
      client.decideActions({ app_key: appKey, application_id: applicationId, decision }),
    setActionMode: (appKey, action, mode) =>
      client.setActionMode({ app_key: appKey, action, mode }).then(() => undefined),
    chain: (chain) => client.chain({ chain }),
    checkpoint: (chain) =>
      client.checkpoint({ chain }).then(
        (c) => (c ? c : null),
        (e: unknown) => {
          if (lacksMethod(e, "checkpoint")) return null;
          throw e;
        },
      ),
    watches: (chain) =>
      client.watches({ chain }).catch((e: unknown) => {
        if (lacksMethod(e, "watches")) return [];
        throw e;
      }),
    cancelWatch: (id) => client.cancelWatch({ id, note: null }),
    mergeWhenGreen: (chain, repo, pr) => client.addWatch({ input: mergeWatchInput(chain, repo, pr) }),
    prs: (chain) =>
      client.prs({ chain }).catch((e: unknown) => {
        if (lacksMethod(e, "prs")) return [];
        throw e;
      }),
    links: (chain) =>
      client.links({ chain }).catch((e: unknown) => {
        if (lacksMethod(e, "links")) return [];
        throw e;
      }),
    addLink: (chain, subject, label) => client.addLink({ chain, input: { subject, label, by: "you" } }),
    removeLink: (chain, subject) => client.removeLink({ chain, subject }).then(() => undefined),
    pushKey: () =>
      client.pushKey().catch((e: unknown) => {
        if (lacksMethod(e, "push_key")) return null;
        throw e;
      }),
    pushDevices: () =>
      client.pushDevices().catch((e: unknown) => {
        if (lacksMethod(e, "push_devices")) return [];
        throw e;
      }),
    addPushDevice: (input) => client.addPushDevice({ input }),
    removePushDevice: (endpoint) => client.removePushDevice({ endpoint }).then(() => undefined),
    // Text alone keeps to `say`, which every feed has; only images need `say_with`.
    // No `headline` key: a feed made before headlines refuses any argument it does not know.
    // `mode` only when given, for the same reason: callers give it to a feed that lists modes.
    say: (chain, text, attachments = [], mode) =>
      attachments.length
        ? client.sayWith({ chain, text, attachments, ...(mode ? { mode } : {}) } as Parameters<HyperfeedClient["sayWith"]>[0])
        : client.say({ chain, text, ...(mode ? { mode } : {}) } as Parameters<HyperfeedClient["say"]>[0]),
    answerAsk: (id, chain, text) =>
      client.answerAsk({ id, text }).catch((e: unknown) => {
        if (!lacksMethod(e, "answer_ask")) throw e;
        return client.say({ chain, text } as Parameters<HyperfeedClient["say"]>[0]);
      }),
    stop: (id) => client.stop({ id }),
    markSeen: (ids) => client.markSeen({ ids }),
    markAllSeen: () => client.markAllSeen(),
    setPolicy: (appKey, agent, notifications) =>
      client.setPolicy({ app_key: appKey, agent, notifications }),
    setGuard: (category, enabled) => client.setGuard({ category, enabled }),
    setPaused: (paused) => client.setPaused({ paused }),
    setAccess: (agent, folders, shell, web) => client.setAccess({ agent, folders, shell, web }),
    setAssignment: (app, agent) => client.setAssignment({ app_key: app, agent }),
    addAgentAccount: (account, name) => client.addAgentAccount({ account, name }),
    removeAgentAccount: (account) => client.removeAgentAccount({ account }),
    addRule: (text) => client.addRule({ text }),
    removeRule: (id) => client.removeRule({ id }),
    addAgentRule: (agent, text) => client.addAgentRule({ agent, text }),
    removeAgentRule: (id) => client.removeAgentRule({ id }),
    approveRule: (id) => client.approveRule({ id }),
    dismissRule: (id) => client.dismissRule({ id }),
    archive: (chains, until = 0) => client.archive({ chains, until }),
    unarchive: (chains) => client.unarchive({ chains }),
    recordNotification: (input) => client.recordNotification({ input }),
    recordAction: (input) => client.recordAction({ input }),
  };
}

/**
 * Whether a call failed because the feed's contract has no such method: a feed
 * made before it. The node answers `{ type: "FunctionCallError", data: 'method "x" not found' }`.
 */
export function lacksMethod(e: unknown, method: string): boolean {
  const data = (e as { data?: unknown } | null)?.data;
  const said = `${String(e)} ${typeof data === "string" ? data : JSON.stringify(data ?? "")}`;
  return new RegExp(`${method}.*not found|not found.*${method}`, "i").test(said);
}
