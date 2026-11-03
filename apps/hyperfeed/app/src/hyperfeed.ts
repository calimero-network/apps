import type { CalimeroClient } from "@calimero-network/mero-js";
import type {
  ActionDef,
  ActionInput,
  ActionSetView,
  AgentRuleView,
  Ask,
  Attachment,
  AutorunView,
  CheckpointInput,
  CheckpointView,
  FeedItem,
  FeedPage,
  Folder,
  LeaseView,
  LensView,
  LinkInput,
  LinkView,
  MemoInput,
  MemoView,
  NotificationInput,
  PolicyView,
  PrInput,
  PrView,
  PushDeviceInput,
  PushDeviceView,
  PushKeyView,
  ReachLine,
  RuleProposalView,
  RuleView,
  SettingsView,
  SituationInput,
  SituationView,
  TurnStep,
  Verdict,
  WatchInput,
  WatchView,
} from "./hyperfeedTypes";

/**
 * The Hyperfeed contract, method by method, for the screens: the ONE place
 * that knows the component wire.
 *
 * The screens were written against v1's generated client, and keep that API:
 * the same method names and argument objects, answering the same shapes. Under
 * them, each method is the component ABI's (`logic/res/abi.json`): camelCase
 * method and argument names, `u64` arguments as decimal strings, reads as
 * views. The records it answers are v1's, field for field.
 */

/** What the client needs from the cluster: mero-js's `call` and `view`, answering `result`. */
export interface AppTransport {
  call(app: string, method: string, args: Record<string, unknown>): Promise<unknown>;
  view(app: string, method: string, args: Record<string, unknown>): Promise<unknown>;
}

/** {@link AppTransport} over a `CalimeroClient`. */
export function calimeroTransport(client: Pick<CalimeroClient, "call" | "view">): AppTransport {
  return {
    call: async (app, method, args) => (await client.call(app, method, args)).result,
    view: async (app, method, args) => (await client.view(app, method, args)).result,
  };
}

/** The contract's views (`kind: "view"` in the ABI); every other method is a call. */
export const VIEWS: ReadonlySet<string> = new Set([
  "actionSets",
  "autoruns",
  "chain",
  "chainLease",
  "checkAction",
  "checkpoint",
  "feed",
  "item",
  "lenses",
  "links",
  "memos",
  "openQuestions",
  "prs",
  "pushDevices",
  "pushKey",
  "settings",
  "situations",
  "watches"
]);

/** Each method's `u64` parameters, by ABI name: decimal strings on the wire. */
export const U64_PARAMS: Readonly<Record<string, readonly string[]>> = {
  "archive": [
    "until"
  ],
  "claimChain": [
    "ttlMs"
  ],
  "feed": [
    "before"
  ],
  "memos": [
    "since"
  ],
  "renewChain": [
    "ttlMs"
  ],
  "scheduleAutorun": [
    "at"
  ]
};

/** snake_case to camelCase: `app_key` is `appKey` on the wire. */
export function camel(name: string): string {
  return name.replace(/_([a-z0-9])/g, (_, c: string) => c.toUpperCase());
}

/** A method's arguments as the ABI takes them. Fields inside struct arguments stay as they are. */
export function toWire(method: string, params: Record<string, unknown>): Record<string, unknown> {
  const wide = U64_PARAMS[method] ?? [];
  const out: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(params)) {
    const name = camel(key);
    out[name] = wide.includes(name) && typeof value === "number" ? String(Math.trunc(value)) : value;
  }
  return out;
}

export class HyperfeedClient {
  private readonly _transport: AppTransport;
  private readonly _app: string;

  /**
   * @param transport Calls and views on the cluster: {@link calimeroTransport}
   *   over a `CalimeroClient`, or a fake in tests.
   * @param app The feed: an app instance id.
   */
  constructor(transport: AppTransport, app: string) {
    this._transport = transport;
    this._app = app;
  }

  /** The app instance this client calls. */
  get app(): string {
    return this._app;
  }

  /**
   * One method, by its ABI name: arguments as the screens give them (v1's
   * snake_case names) become the ABI's camelCase names, 64-bit integers
   * decimal strings; a view is read, anything else is called (logged).
   */
  private async run<T>(method: string, params: Record<string, unknown>): Promise<T> {
    const args = toWire(method, params);
    const result = VIEWS.has(method)
      ? await this._transport.view(this._app, method, args)
      : await this._transport.call(this._app, method, args);
    return result as T;
  }

  /**
   * `actionSets`
   *
   * Every app's actions, newest first: what your agent learned for each
   * app version, and whether you approved it. An app's newest approved set
   * is the one in force.
   *
   * @intent read_only
   */
  public async actionSets(): Promise<ActionSetView[]> {
    return this.run<ActionSetView[]>('actionSets', {});
  }

  /**
   * `addAgentAccount`
   *
   * Add an agent with an account of its own (a cloud agent, say) under
   * `name`, the name it reports in with. From then on it works your feed as
   * your agent does, speaking only as `name`; what decides for you stays
   * yours. Adding it again renames it. It must also be a member of this
   * feed's context: invite it there as you would anyone.
   *
   * @intent mutating
   */
  public async addAgentAccount(params: { account: string; name: string }): Promise<void> {
    return this.run<void>('addAgentAccount', params);
  }

  /**
   * `addAgentRule`
   *
   * Add a rule for one agent only: it keeps it after your general rules,
   * which every agent keeps. Only you add rules; the same rule twice for
   * the same agent is kept once.
   *
   * @intent mutating
   */
  public async addAgentRule(params: { agent: string; text: string }): Promise<AgentRuleView> {
    return this.run<AgentRuleView>('addAgentRule', params);
  }

  /**
   * `addLink`
   *
   * Link a thing in another app to the task in `chain`: `subject` as
   * [`subject_key`] makes it, a `label` for its chip, `by` you or your
   * agent. What teammates do there joins the task from now on. Adding one
   * again relabels it; you adding one you took off brings it back.
   *
   * @intent mutating
   */
  public async addLink(params: { chain: string; input: LinkInput }): Promise<LinkView> {
    return this.run<LinkView>('addLink', params);
  }

  /**
   * `addPushDevice`
   *
   * A phone (or any browser) to push to: its push subscription, a name,
   * and `quiet` to say only "Something needs you". Owner only; adding one
   * again updates it. At most [`MAX_PUSH_DEVICES`]; the oldest makes room.
   *
   * @intent mutating
   */
  public async addPushDevice(params: { input: PushDeviceInput }): Promise<PushDeviceView> {
    return this.run<PushDeviceView>('addPushDevice', params);
  }

  /**
   * `addRule`
   *
   * Add a standing rule: one short line your agent keeps to on every turn.
   * Only you add rules; the same rule twice is kept once.
   *
   * @intent mutating
   */
  public async addRule(params: { text: string }): Promise<RuleView> {
    return this.run<RuleView>('addRule', params);
  }

  /**
   * `addWatch`
   *
   * Set a watch: when its condition is met (a PR's checks green or red, a
   * PR merged, a branch's CI green or red), its action runs once (merge
   * the PR, start an agent turn with `text`, or tell you), reported in its
   * chain. Your agent's runtime polls it; the same watch twice is kept once.
   *
   * @intent mutating
   */
  public async addWatch(params: { input: WatchInput }): Promise<WatchView> {
    return this.run<WatchView>('addWatch', params);
  }

  /**
   * `agentAck`
   *
   * The agent takes up one of your messages (`thinking`), or gives up on it
   * (`failed`, with why). Taking it up is how you know an agent is there.
   *
   * @intent mutating
   */
  public async agentAck(params: { id: string; status: string; note: string }): Promise<FeedItem> {
    return this.run<FeedItem>('agentAck', params);
  }

  /**
   * `agentAsk`
   *
   * [`Self::agent_say`] that leaves something to you: a question to
   * `reply` to, or options to `choose` from. The message needs you, in To
   * do, until you say something in its chain; your words are its answer.
   * Use it whenever the work is not finished without you, so a chain is
   * only done when it is.
   *
   * Takes a `headline` as [`Self::agent_say`] does.
   *
   * @intent mutating
   */
  public async agentAsk(params: { chain: string; reply_to: string; text: string; ask: Ask; headline: string | null }): Promise<FeedItem> {
    return this.run<FeedItem>('agentAsk', params);
  }

  /**
   * `agentProgress`
   *
   * Your agent says what it is doing on one of your messages it has taken
   * up (`thinking`): "Running the tests", "Editing ChatView.tsx". Each call
   * replaces the last, so you see its latest step and nothing piles up.
   *
   * @intent mutating
   */
  public async agentProgress(params: { id: string; doing: string }): Promise<FeedItem> {
    return this.run<FeedItem>('agentProgress', params);
  }

  /**
   * `agentReach`
   *
   * An agent saying what it can reach: one line per agent profile it runs.
   * Shown to you in Controls beside what you set with `set_access`.
   *
   * @intent mutating
   */
  public async agentReach(params: { name: string; lines: ReachLine[] }): Promise<void> {
    return this.run<void>('agentReach', params);
  }

  /**
   * `agentSay`
   *
   * The agent says something in a chain: an answer to one of your
   * messages (`reply_to`, which marks it answered), or, with `reply_to`
   * empty, a note of its own in a chain that exists.
   *
   * A long answer takes a `headline`: one line of at most 80 characters,
   * which the feed row shows, with `text` (up to 32 KB) behind "more" and
   * in full in the chat. Without one, `text` keeps to 2000 bytes. Older
   * agents omit it.
   *
   * @intent mutating
   */
  public async agentSay(params: { chain: string; reply_to: string; text: string; headline: string | null }): Promise<FeedItem> {
    return this.run<FeedItem>('agentSay', params);
  }

  /**
   * `agentSeen`
   *
   * An agent saying it is running. The feed shows it as live while it
   * keeps reporting; mero-bot calls this every half minute.
   *
   * @intent mutating
   */
  public async agentSeen(params: { name: string }): Promise<void> {
    return this.run<void>('agentSeen', params);
  }

  /**
   * `agentWork`
   *
   * Your agent reports its turn on one of your messages: every step so far
   * (each with its own `id`, a `title` in words, a `status` of `running`,
   * `waiting`, `done` or `failed`, and when it started) and the answer it
   * has written so far as `draft`. Each call replaces the last, so the
   * turn never adds rows: send it whenever a step starts or ends, and
   * every few seconds while the answer is being written. The steps stay
   * on the message after the turn; the draft shows only while it is
   * `thinking`.
   *
   * @intent mutating
   */
  public async agentWork(params: { id: string; steps: TurnStep[]; draft: string }): Promise<FeedItem> {
    return this.run<FeedItem>('agentWork', params);
  }

  /**
   * `answerAsk`
   *
   * Answer one question your agent asked, from its buttons: `text` is the
   * option you picked, or your reply. It is your next message in the
   * question's chain, and goes to your agent like any other.
   *
   * A question a newer one replaced can still be answered (a screen that
   * had not caught up yet, another device): it is marked answered, the
   * newer question stays open, and your message carries
   * `answers_superseded`, so your agent confirms against where things
   * stand now before acting on it.
   *
   * @intent mutating
   */
  public async answerAsk(params: { id: string; text: string }): Promise<FeedItem> {
    return this.run<FeedItem>('answerAsk', params);
  }

  /**
   * `answerNotification`
   *
   * Answer a notification from the feed: the reply to send, the option you
   * picked, or `""` to confirm. Your agent carries it out in the source app
   * and reports with [`Hyperfeed::complete_answer`]. A failed delivery can be
   * answered again.
   *
   * @intent mutating
   */
  public async answerNotification(params: { id: string; answer: string }): Promise<FeedItem> {
    return this.run<FeedItem>('answerNotification', params);
  }

  /**
   * `approveRule`
   *
   * Approve a rule your agent suggested: it becomes one of your rules,
   * added by you.
   *
   * @intent mutating
   */
  public async approveRule(params: { id: string }): Promise<RuleView> {
    return this.run<RuleView>('approveRule', params);
  }

  /**
   * `archive`
   *
   * Pause the agent: every write it wants to make becomes a proposal.
   * Put chains away: each leaves the feed until something new happens in
   * it, or until `until` (ms; 0 = no return time) for "later". Returns how
   * many were put away.
   *
   * @intent mutating
   */
  public async archive(params: { chains: string[]; until: number }): Promise<number> {
    return this.run<number>('archive', params);
  }

  /**
   * `autoruns`
   *
   * Every proposal's default, soonest first.
   *
   * @intent read_only
   */
  public async autoruns(): Promise<AutorunView[]> {
    return this.run<AutorunView[]>('autoruns', {});
  }

  /**
   * `cancelWatch`
   *
   * Cancel a watch still watching, with an optional note why. A watch that
   * already fired cannot be called back.
   *
   * @intent mutating
   */
  public async cancelWatch(params: { id: string; note: string | null }): Promise<WatchView> {
    return this.run<WatchView>('cancelWatch', params);
  }

  /**
   * `chain`
   *
   * Every row in a chain, oldest first: the whole flow, muted apps included.
   *
   * @intent read_only
   */
  public async chain(params: { chain: string }): Promise<FeedItem[]> {
    return this.run<FeedItem[]>('chain', params);
  }

  /**
   * `chainLease`
   *
   * Who holds `chain` right now: a lease that has not run out, or none.
   *
   * @intent read_only
   */
  public async chainLease(params: { chain: string }): Promise<LeaseView> {
    return this.run<LeaseView>('chainLease', params);
  }

  /**
   * `checkAction`
   *
   * What your rules say about an action before the agent takes it. Name
   * the app `method` it calls: once you approved the app's actions, they
   * decide what the call is, not `category` and `writes`. Older agents omit
   * it and are judged by what they say.
   *
   * @intent read_only
   */
  public async checkAction(params: { app_key: string; category: string; writes: boolean; method: string | null }): Promise<Verdict> {
    return this.run<Verdict>('checkAction', params);
  }

  /**
   * `checkpoint`
   *
   * The latest checkpoint on `chain`, or none: read it before acting there.
   *
   * @intent read_only
   */
  public async checkpoint(params: { chain: string }): Promise<CheckpointView> {
    return this.run<CheckpointView>('checkpoint', params);
  }

  /**
   * `claimChain`
   *
   * An agent session takes `chain` for `ttl_ms` before it starts a turn
   * there: one turn per chain at a time, across machines. Refused while
   * another session holds an unexpired lease; a lease that ran out (its
   * session died) can be taken. Claiming a chain the session already
   * holds renews it. `agent` names it for the chat ("mero-bot@studio");
   * older agents omit it.
   *
   * @intent mutating
   */
  public async claimChain(params: { chain: string; session: string; ttl_ms: number; agent: string | null }): Promise<LeaseView> {
    return this.run<LeaseView>('claimChain', params);
  }

  /**
   * `clearMemos`
   *
   * Forget every cached read. Yours only. Returns how many were dropped.
   *
   * @intent mutating
   */
  public async clearMemos(): Promise<number> {
    return this.run<number>('clearMemos', {});
  }

  /**
   * `clearSituation`
   *
   * Take a chain's situation off: the brief shows its rows again.
   *
   * @intent mutating
   */
  public async clearSituation(params: { chain: string }): Promise<boolean> {
    return this.run<boolean>('clearSituation', params);
  }

  /**
   * `completeAction`
   *
   * The agent reports what happened after you approved, asked for a retry,
   * or asked for an undo. For a draft you send (one with a `reply_call`),
   * your client reports instead, once it sent it or the app refused.
   *
   * @intent mutating
   */
  public async completeAction(params: { id: string; outcome: string; note: string }): Promise<FeedItem> {
    return this.run<FeedItem>('completeAction', params);
  }

  /**
   * `completeAnswer`
   *
   * The agent reports whether it carried out your answer to a notification:
   * sent the reply, cast the vote, accepted the invite.
   *
   * @intent mutating
   */
  public async completeAnswer(params: { id: string; outcome: string; note: string }): Promise<FeedItem> {
    return this.run<FeedItem>('completeAnswer', params);
  }

  /**
   * `decideActions`
   *
   * Approve or turn down the actions your agent proposed for an app
   * version. Once approved they decide what each call in the app is, and
   * a method none of them names asks you every time.
   *
   * @intent mutating
   */
  public async decideActions(params: { app_key: string; application_id: string; decision: string }): Promise<ActionSetView> {
    return this.run<ActionSetView>('decideActions', params);
  }

  /**
   * `decideLens`
   *
   * Approve or turn down a lens your agent proposed. Only an approved lens
   * turns an app's events into feed items, and only for the app version it
   * was learned from.
   *
   * @intent mutating
   */
  public async decideLens(params: { app_key: string; application_id: string; decision: string }): Promise<LensView> {
    return this.run<LensView>('decideLens', params);
  }

  /**
   * `dismissRule`
   *
   * Turn down a rule your agent suggested.
   *
   * @intent mutating
   */
  public async dismissRule(params: { id: string }): Promise<RuleProposalView> {
    return this.run<RuleProposalView>('dismissRule', params);
  }

  /**
   * `dropMemos`
   *
   * Your agent's runtime drops cached reads it knows are wrong now (it
   * wrote there, or the app changed). Returns how many it dropped.
   *
   * @intent mutating
   */
  public async dropMemos(params: { agent: string; keys: string[] }): Promise<number> {
    return this.run<number>('dropMemos', params);
  }

  /**
   * `feed`
   *
   * The feed: one row per chain, newest activity first.
   *
   * A row is the chain's **lead**: the latest step that needs you if any
   * does, otherwise the latest still underway (an action approved, retrying
   * or being undone; your message waiting or being answered; your answer
   * being delivered), otherwise the latest row. So a chain is settled only
   * when everything in it is. Its `chain_len` says how many rows the chain
   * holds and `needs_you` whether any of them needs you; read them all with
   * [`Hyperfeed::chain`].
   *
   * `filter` keeps chains holding an action (`agent`), a notification
   * (`notifications`), or something that needs you (`needs_you`); `app_key`
   * keeps chains that touch that app; `before` pages by `chain_at` (0 = from
   * the newest). The counts are over chains, for the whole feed.
   *
   * @intent read_only
   */
  public async feed(params: { filter: string; app_key: string; limit: number; before: number }): Promise<FeedPage> {
    return this.run<FeedPage>('feed', params);
  }

  /**
   * `finishWatch`
   *
   * How the fired action went: `done` or `failed`, with a note.
   *
   * @intent mutating
   */
  public async finishWatch(params: { id: string; outcome: string; note: string }): Promise<WatchView> {
    return this.run<WatchView>('finishWatch', params);
  }

  /**
   * `fireAutorun`
   *
   * Your agent's runtime fires a default once its time came: the proposal
   * is approved, with its draft as the answer, and your agent carries it out
   * as any approval. Every check that let it be set is made again; if one
   * fails now, it is refused and the proposal waits for you.
   *
   * @intent mutating
   */
  public async fireAutorun(params: { id: string }): Promise<FeedItem> {
    return this.run<FeedItem>('fireAutorun', params);
  }

  /**
   * `fireWatch`
   *
   * The runtime takes a watch whose condition it saw met, before it acts:
   * `watching → firing`, refused for any other status. Of every session
   * polling, exactly one gets it, once.
   *
   * @intent mutating
   */
  public async fireWatch(params: { id: string; session: string }): Promise<WatchView> {
    return this.run<WatchView>('fireWatch', params);
  }

  /**
   * `item`
   *
   * One row, by id, whichever kind it is.
   *
   * @intent read_only
   */
  public async item(params: { id: string }): Promise<FeedItem> {
    return this.run<FeedItem>('item', params);
  }

  /**
   * `lenses`
   *
   * Every lens, newest first: what your agent learned for each app version,
   * and whether you approved it.
   *
   * @intent read_only
   */
  public async lenses(): Promise<LensView[]> {
    return this.run<LensView[]>('lenses', {});
  }

  /**
   * `links`
   *
   * The links of the task in `chain`, oldest first, each with how much
   * teammates did there (its notifications in the task).
   *
   * @intent read_only
   */
  public async links(params: { chain: string }): Promise<LinkView[]> {
    return this.run<LinkView[]>('links', params);
  }

  /**
   * `markAllSeen`
   *
   * Mark every notification seen.
   *
   * @intent mutating
   */
  public async markAllSeen(): Promise<number> {
    return this.run<number>('markAllSeen', {});
  }

  /**
   * `markSeen`
   *
   * Mark notifications seen. Unknown ids are skipped; returns how many
   * changed.
   *
   * @intent mutating
   */
  public async markSeen(params: { ids: string[] }): Promise<number> {
    return this.run<number>('markSeen', params);
  }

  /**
   * `memos`
   *
   * The cached reads written after `since` (the feed's clock, ms; 0 for
   * all), oldest write first.
   *
   * @intent read_only
   */
  public async memos(params: { since: number }): Promise<MemoView[]> {
    return this.run<MemoView[]>('memos', params);
  }

  /**
   * `openQuestions`
   *
   * Your messages your agent has not answered yet, oldest first: what an
   * agent that was away picks up when it starts.
   *
   * @intent read_only
   */
  public async openQuestions(): Promise<FeedItem[]> {
    return this.run<FeedItem[]>('openQuestions', {});
  }

  /**
   * `proposeActions`
   *
   * The agent proposes an app version's actions, learned from its ABI:
   * which methods make up each thing you would recognise ("Edit
   * documents"), whether it writes, and the guard that covers it. It waits
   * for you; the app's newest approved set stays in force meanwhile. The
   * same actions proposed again change nothing.
   *
   * @intent mutating
   */
  public async proposeActions(params: { app_key: string; application_id: string; actions: ActionDef[]; summary: string }): Promise<ActionSetView> {
    return this.run<ActionSetView>('proposeActions', params);
  }

  /**
   * `proposeLens`
   *
   * The agent proposes a lens for one app version, learned from its ABI.
   * It waits for you: an approved lens is replaced only by a new proposal,
   * which waits again. The same spec proposed again changes nothing.
   *
   * @intent mutating
   */
  public async proposeLens(params: { app_key: string; application_id: string; spec: string; summary: string }): Promise<LensView> {
    return this.run<LensView>('proposeLens', params);
  }

  /**
   * `proposeRule`
   *
   * Your agent suggests a standing rule after you corrected it: `text` is
   * the rule, `why` the correction, `chain` where it happened. It waits
   * for you in Controls and in the chat; nothing changes until you approve
   * it. A rule you already have, or one already waiting, is not suggested
   * twice.
   *
   * @intent mutating
   */
  public async proposeRule(params: { text: string; why: string; chain: string }): Promise<RuleProposalView> {
    return this.run<RuleProposalView>('proposeRule', params);
  }

  /**
   * `prs`
   *
   * The PRs the runtime recorded for `chain` (`""`: every chain), the most
   * recently seen first.
   *
   * @intent read_only
   */
  public async prs(params: { chain: string }): Promise<PrView[]> {
    return this.run<PrView[]>('prs', params);
  }

  /**
   * `pushDevices`
   *
   * The devices to push to, newest first.
   *
   * @intent read_only
   */
  public async pushDevices(): Promise<PushDeviceView[]> {
    return this.run<PushDeviceView[]>('pushDevices', {});
  }

  /**
   * `pushKey`
   *
   * The key phones subscribe with; empty before a runtime set one.
   *
   * @intent read_only
   */
  public async pushKey(): Promise<PushKeyView> {
    return this.run<PushKeyView>('pushKey', {});
  }

  /**
   * `putMemos`
   *
   * Your agent's runtime keeps reads worth keeping, as `agent` (an added
   * agent only as itself): up to [`MAX_MEMO_BATCH`] a call, each replacing
   * its row unless the row was fetched later, while every agent's hits are
   * kept. The least used rows are dropped past [`MAX_MEMOS`] or
   * [`MAX_MEMO_BYTES`]. Returns how many rows it wrote.
   *
   * @intent mutating
   */
  public async putMemos(params: { agent: string; memos: MemoInput[] }): Promise<number> {
    return this.run<number>('putMemos', params);
  }

  /**
   * `recordAction`
   *
   * Record an action: a proposal for you to approve, or an outcome.
   *
   * A proposal the rules refuse is an error. An outcome the rules say
   * needed you is recorded with a breach, never dropped, unless the app's
   * mode alone asked for you and its `grant` is a session you allowed.
   *
   * @intent mutating
   */
  public async recordAction(params: { input: ActionInput }): Promise<FeedItem> {
    return this.run<FeedItem>('recordAction', params);
  }

  /**
   * `recordNotification`
   *
   * Record a notification your client saw.
   *
   * Every device records what it sees, and the same event arrives under the
   * same key on each, so a key already recorded within
   * [`DEDUPE_WINDOW_MS`] returns that row and records nothing. The same key
   * later is a new event — the source context came back to a state it had
   * been in — and is stored as `<key>#1`, `<key>#2`, … Two devices reporting
   * that occurrence derive the same id, so their rows still merge.
   *
   * @intent mutating
   */
  public async recordNotification(params: { input: NotificationInput }): Promise<FeedItem> {
    return this.run<FeedItem>('recordNotification', params);
  }

  /**
   * `recordPr`
   *
   * Your agent's runtime records a PR a task links to as GitHub shows it
   * now: state, base and default branch, conflicts, head commit, checks
   * (the failing ones named) and the PR it is stacked on. Owner only; one
   * row per PR, the oldest of [`MAX_PRS`] dropped to make room.
   *
   * @intent mutating
   */
  public async recordPr(params: { input: PrInput }): Promise<PrView> {
    return this.run<PrView>('recordPr', params);
  }

  /**
   * `releaseChain`
   *
   * The session lets `chain` go at the end of its turn. Returns whether it
   * held it: letting go of a chain it does not hold changes nothing.
   *
   * @intent mutating
   */
  public async releaseChain(params: { chain: string; session: string }): Promise<boolean> {
    return this.run<boolean>('releaseChain', params);
  }

  /**
   * `removeAgentAccount`
   *
   * Stop an agent account working your feed. Remove it from the context
   * too, so it no longer reads it.
   *
   * @intent mutating
   */
  public async removeAgentAccount(params: { account: string }): Promise<void> {
    return this.run<void>('removeAgentAccount', params);
  }

  /**
   * `removeAgentRule`
   *
   * Remove one of your rules for one agent.
   *
   * @intent mutating
   */
  public async removeAgentRule(params: { id: string }): Promise<void> {
    return this.run<void>('removeAgentRule', params);
  }

  /**
   * `removeLink`
   *
   * Take a link off the task in `chain`. Nothing new about it joins the
   * task, and your agent touching it again does not bring it back.
   *
   * @intent mutating
   */
  public async removeLink(params: { chain: string; subject: string }): Promise<void> {
    return this.run<void>('removeLink', params);
  }

  /**
   * `removePushDevice`
   *
   * Stop pushing to a device: you took it off, or its push service said
   * it is gone.
   *
   * @intent mutating
   */
  public async removePushDevice(params: { endpoint: string }): Promise<void> {
    return this.run<void>('removePushDevice', params);
  }

  /**
   * `removeRule`
   *
   * Remove one of your standing rules.
   *
   * @intent mutating
   */
  public async removeRule(params: { id: string }): Promise<void> {
    return this.run<void>('removeRule', params);
  }

  /**
   * `renewChain`
   *
   * The session holding `chain` keeps it for another `ttl_ms` while it
   * works. Refused once another session has it, or when this one never
   * did or released it: it should stop, not carry on beside the other.
   *
   * @intent mutating
   */
  public async renewChain(params: { chain: string; session: string; ttl_ms: number }): Promise<LeaseView> {
    return this.run<LeaseView>('renewChain', params);
  }

  /**
   * `resolveAction`
   *
   * Approve or decline a proposal, retry or drop a failure, ask for an
   * undo, or keep an action the agent took without asking.
   *
   * `answer` goes with an approval when the proposal has an [`Ask`]: one of
   * its options for `choose`, the text to send for `reply` (the agent's
   * draft, edited or not). Every other decision takes `""`.
   *
   * @intent mutating
   */
  public async resolveAction(params: { id: string; decision: string; answer: string }): Promise<FeedItem> {
    return this.run<FeedItem>('resolveAction', params);
  }

  /**
   * `say`
   *
   * Talk to your agent: about a chain (`chain` = its id), or about
   * anything (`chain` empty, which starts a new chain). Your agent picks it
   * up, answers in the chain, and may propose or act there under your rules.
   *
   * A long message takes a `headline`, as [`Self::agent_say`] does. Older
   * clients omit it.
   *
   * `mode` says how private it is, and so which of your agents takes it:
   * `private` or `public` (see [`MESSAGE_MODES`]). Omitted or empty, it
   * has none, and your agent's runtime decides. Older clients omit it.
   *
   * @intent mutating
   */
  public async say(params: { chain: string; text: string; headline: string | null; mode: string | null }): Promise<FeedItem> {
    return this.run<FeedItem>('say', params);
  }

  /**
   * `sayWith`
   *
   * [`Self::say`] with images: up to four, each a blob you uploaded to your
   * node and announced to this context. With an image, `text` may be empty.
   *
   * @intent mutating
   */
  public async sayWith(params: { chain: string; text: string; attachments: Attachment[]; headline: string | null; mode: string | null }): Promise<FeedItem> {
    return this.run<FeedItem>('sayWith', params);
  }

  /**
   * `scheduleAutorun`
   *
   * Your agent sets a proposal to go ahead at `at` (ms) unless you stop it.
   * Allowed only where nothing would be lost by it (see
   * [`Self::autorun_answer`]), up to [`MAX_AUTORUN_AHEAD_MS`] ahead. Setting
   * it again moves the time; once you stopped it, it stays stopped.
   *
   * @intent mutating
   */
  public async scheduleAutorun(params: { id: string; at: number }): Promise<AutorunView> {
    return this.run<AutorunView>('scheduleAutorun', params);
  }

  /**
   * `setAccess`
   *
   * What `agent` (its name, as it reports in) may reach on its computer
   * besides your Calimero apps: `folders` (each with or without writes),
   * a `shell`, and the `web`. It replaces what was set before. Your
   * agent's runtime refuses this method to the agent, so only you widen
   * or narrow it.
   *
   * @intent mutating
   */
  public async setAccess(params: { agent: string; folders: Folder[]; shell: boolean; web: boolean }): Promise<void> {
    return this.run<void>('setAccess', params);
  }

  /**
   * `setActionMode`
   *
   * Set one action apart from its app's mode: `act` without asking, `ask`
   * first, `off`, or empty to follow the app again. Your guards and the
   * pause still apply.
   *
   * @intent mutating
   */
  public async setActionMode(params: { app_key: string; action: string; mode: string }): Promise<void> {
    return this.run<void>('setActionMode', params);
  }

  /**
   * `setAssignment`
   *
   * Assign `app_key` to `agent` (its name, as it reports in): from then on
   * only that agent takes the app's work and calls it. An empty `agent`
   * gives the app back to your default agent. Your agent's runtime refuses
   * this method to the agent, so only you move an app between agents.
   *
   * @intent mutating
   */
  public async setAssignment(params: { app_key: string; agent: string }): Promise<void> {
    return this.run<void>('setAssignment', params);
  }

  /**
   * `setCheckpoint`
   *
   * Your agent writes where the task in `chain` stands: what is done, the
   * next step, its branches, worktrees and PRs, and what is still open. It
   * replaces the chain's last checkpoint, so a new session can pick the
   * task up from it. The limits are in `checkpoint.rs`.
   *
   * @intent mutating
   */
  public async setCheckpoint(params: { chain: string; input: CheckpointInput }): Promise<CheckpointView> {
    return this.run<CheckpointView>('setCheckpoint', params);
  }

  /**
   * `setGuard`
   *
   * @intent mutating
   */
  public async setGuard(params: { category: string; enabled: boolean }): Promise<void> {
    return this.run<void>('setGuard', params);
  }

  /**
   * `setPaused`
   *
   * @intent mutating
   */
  public async setPaused(params: { paused: boolean }): Promise<void> {
    return this.run<void>('setPaused', params);
  }

  /**
   * `setPolicy`
   *
   * @intent mutating
   */
  public async setPolicy(params: { app_key: string; agent: string; notifications: string }): Promise<PolicyView> {
    return this.run<PolicyView>('setPolicy', params);
  }

  /**
   * `setPushKey`
   *
   * Your agent's runtime keeps its VAPID public key here, for phones to
   * subscribe with; `by` names the runtime that holds the private half.
   * Owner only. A different key drops every device: each subscribes again.
   *
   * @intent mutating
   */
  public async setPushKey(params: { public_key: string; by: string }): Promise<PushKeyView> {
    return this.run<PushKeyView>('setPushKey', params);
  }

  /**
   * `setSituation`
   *
   * Your agent tells the task in `chain` as one card: a headline, what is
   * going on, what it recommends, why it ranks where it does, and when it
   * is due. It replaces the chain's last one. At most [`MAX_SITUATIONS`]
   * are kept; one more drops the one written longest ago.
   *
   * @intent mutating
   */
  public async setSituation(params: { chain: string; input: SituationInput }): Promise<SituationView> {
    return this.run<SituationView>('setSituation', params);
  }

  /**
   * `settings`
   *
   * Your rules: the pause switch, every app you set a policy for, every
   * guard (defaults included), your standing rules, and the rules your
   * agent suggested that wait for you.
   *
   * @intent read_only
   */
  public async settings(): Promise<SettingsView> {
    return this.run<SettingsView>('settings', {});
  }

  /**
   * `situations`
   *
   * Every task your agent told as one card, most recently written first.
   *
   * @intent read_only
   */
  public async situations(): Promise<SituationView[]> {
    return this.run<SituationView[]>('situations', {});
  }

  /**
   * `startTask`
   *
   * Spin a task off the chat in `from`: `text` is your message that opens
   * it, in a chain of its own, with its own post, workspace, checkpoint
   * and PRs. The chat keeps a link to the task (`hyperfeed:task:<chain>`)
   * and the task one back (`hyperfeed:from:<chain>`). Takes a `headline`
   * as [`Self::say`] does, which names the task's link. Returns the
   * task's first message; its chain is the task.
   *
   * @intent mutating
   */
  public async startTask(params: { from: string; text: string; headline: string | null }): Promise<FeedItem> {
    return this.run<FeedItem>('startTask', params);
  }

  /**
   * `stop`
   *
   * You ask your agent to stop working on one of your messages. One it has
   * not taken up yet is closed at once, "Stopped by you"; one it is working
   * on (`thinking`) keeps the request, and your agent ends its turn and
   * marks the message failed, "Stopped by you". Asking twice changes
   * nothing.
   *
   * @intent mutating
   */
  public async stop(params: { id: string }): Promise<FeedItem> {
    return this.run<FeedItem>('stop', params);
  }

  /**
   * `stopAutorun`
   *
   * You stop a proposal's default: it waits for you as any proposal does,
   * and never goes ahead on its own again.
   *
   * @intent mutating
   */
  public async stopAutorun(params: { id: string }): Promise<AutorunView> {
    return this.run<AutorunView>('stopAutorun', params);
  }

  /**
   * `touchSubject`
   *
   * Your agent touched `subject` (see [`subject_key`]) for the task in
   * `chain` with a write that has no row of its own: a step of its turn on
   * a message of yours. A notification about it then joins `chain`, as
   * for an action that names it.
   *
   * @intent mutating
   */
  public async touchSubject(params: { chain: string; subject: string }): Promise<void> {
    return this.run<void>('touchSubject', params);
  }

  /**
   * `unarchive`
   *
   * Bring chains back into the feed.
   *
   * @intent mutating
   */
  public async unarchive(params: { chains: string[] }): Promise<number> {
    return this.run<number>('unarchive', params);
  }

  /**
   * `watchSeen`
   *
   * What the runtime last saw of a watching watch's condition, as one line
   * ("3 of 5 checks passed, 2 running"). Only a change is written.
   *
   * @intent mutating
   */
  public async watchSeen(params: { id: string; seen: string }): Promise<WatchView> {
    return this.run<WatchView>('watchSeen', params);
  }

  /**
   * `watches`
   *
   * The watches in `chain` (`""`: every chain), oldest first, whatever
   * their status.
   *
   * @intent read_only
   */
  public async watches(params: { chain: string }): Promise<WatchView[]> {
    return this.run<WatchView[]>('watches', params);
  }

}