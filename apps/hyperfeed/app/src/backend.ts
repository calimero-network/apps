import type { BlobStore } from "./attachments";
import type {
  ActionInput,
  ActionSetView,
  Attachment,
  AutorunView,
  CheckpointView,
  FeedItem,
  FeedPage,
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
  SituationView,
  SettingsView,
  WatchView,
  Folder,
} from "./hyperfeedTypes";
import type { HyperfeedClient } from "./generated/client";
import type { OtherApps } from "./otherApps";
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
 * Two implementations: {@link clusterBackend}, which calls the Hyperfeed
 * contract in an app instance on your cluster, and `DemoBackend`, which keeps the same rules in
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
  /** Call a method of another app you reach (by app instance id): how a typed row is answered directly. */
  callApp(app: string, method: string, args: Record<string, unknown>): Promise<unknown>;
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
  /** Each task your agent told as one card, newest first; [] when the feed predates situations. */
  situations?(): Promise<SituationView[]>;
  /** Proposals that go ahead at a set time unless you stop them, soonest first; [] when the feed predates them. */
  autoruns?(): Promise<AutorunView[]>;
  /** Stop a proposal's default: it waits for you as any proposal does. */
  stopAutorun?(id: string): Promise<AutorunView>;
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

/** A 64-bit integer argument (`u64`) as the contract takes it: a decimal string. */
export function u64(n: number): string {
  return String(Math.trunc(n));
}

/**
 * The contract's answer as the screens read it, where the generated type is
 * not already it: a `FeedItem`, `FeedPage` or `SettingsView` (hand-kept in
 * `hyperfeedTypes`, see there), or a call's `null` read as `void`.
 */
function as<T>(answer: Promise<unknown>): Promise<T> {
  return answer as Promise<T>;
}

/**
 * The feed in an app instance on the cluster, through its generated client
 * ({@link HyperfeedClient}, `src/generated/client.ts`); `apps` is how a row is
 * answered in another app.
 */
export function clusterBackend(client: HyperfeedClient, apps: OtherApps, images: BlobStore | null = null): FeedBackend {
  return {
    kind: "node",
    images,
    feed: (filter, appKey) => as(client.feed({ filter, appKey, limit: PAGE_SIZE, before: u64(0) })),
    settings: () => as(client.settings()),
    resolveAction: (id, decision, answer = "") => as(client.resolveAction({ id, decision, answer })),
    answerNotification: (id, answer) => as(client.answerNotification({ id, answer })),
    completeAnswer: (id, outcome, note) => as(client.completeAnswer({ id, outcome, note })),
    completeAction: (id, outcome, note) => as(client.completeAction({ id, outcome, note })),
    callApp: (app, method, args) => apps.call(app, method, args),
    lenses: () => client.lenses(),
    decideLens: (appKey, applicationId, decision) => client.decideLens({ appKey, applicationId, decision }),
    actionSets: () => client.actionSets(),
    decideActions: (appKey, applicationId, decision) =>
      as(client.decideActions({ appKey, applicationId, decision })),
    setActionMode: (appKey, action, mode) => client.setActionMode({ appKey, action, mode }).then(() => undefined),
    chain: (chain) => as(client.chain({ chain })),
    checkpoint: (chain) => client.checkpoint({ chain }).then((c) => c ?? null),
    situations: () => client.situations(),
    autoruns: () => client.autoruns(),
    stopAutorun: (id) => client.stopAutorun({ id }),
    watches: (chain) => client.watches({ chain }),
    cancelWatch: (id) => client.cancelWatch({ id, note: null }),
    mergeWhenGreen: (chain, repo, pr) => client.addWatch({ input: mergeWatchInput(chain, repo, pr) }),
    prs: (chain) => client.prs({ chain }),
    links: (chain) => client.links({ chain }),
    addLink: (chain, subject, label) => client.addLink({ chain, input: { subject, label, by: "you" } }),
    removeLink: (chain, subject) => client.removeLink({ chain, subject }).then(() => undefined),
    pushKey: () => client.pushKey(),
    pushDevices: () => client.pushDevices(),
    addPushDevice: (input) => client.addPushDevice({ input }),
    removePushDevice: (endpoint) => client.removePushDevice({ endpoint }).then(() => undefined),
    // Text alone keeps to `say`; only images need `sayWith`. `headline` and
    // `mode` are optional arguments, sent only when given.
    say: (chain, text, attachments = [], mode) =>
      as(
        attachments.length
          ? client.sayWith({ chain, text, attachments, ...(mode ? { mode } : {}) })
          : client.say({ chain, text, ...(mode ? { mode } : {}) }),
      ),
    answerAsk: (id, _chain, text) => as(client.answerAsk({ id, text })),
    stop: (id) => as(client.stop({ id })),
    markSeen: (ids) => client.markSeen({ ids }),
    markAllSeen: () => client.markAllSeen(),
    setPolicy: (appKey, agent, notifications) => client.setPolicy({ appKey, agent, notifications }),
    setGuard: (category, enabled) => as(client.setGuard({ category, enabled })),
    setPaused: (paused) => as(client.setPaused({ paused })),
    setAccess: (agent, folders, shell, web) => as(client.setAccess({ agent, folders, shell, web })),
    setAssignment: (app, agent) => as(client.setAssignment({ appKey: app, agent })),
    addAgentAccount: (account, name) => as(client.addAgentAccount({ account, name })),
    removeAgentAccount: (account) => as(client.removeAgentAccount({ account })),
    addRule: (text) => client.addRule({ text }),
    removeRule: (id) => as(client.removeRule({ id })),
    addAgentRule: (agent, text) => client.addAgentRule({ agent, text }),
    removeAgentRule: (id) => as(client.removeAgentRule({ id })),
    approveRule: (id) => client.approveRule({ id }),
    dismissRule: (id) => client.dismissRule({ id }),
    archive: (chains, until = 0) => client.archive({ chains, until: u64(until) }),
    unarchive: (chains) => client.unarchive({ chains }),
    recordNotification: (input) => as(client.recordNotification({ input })),
    recordAction: (input) => as(client.recordAction({ input })),
  };
}
