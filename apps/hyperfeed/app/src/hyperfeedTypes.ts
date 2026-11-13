/**
 * The shapes the Hyperfeed contract takes and answers, as `logic/src/*.rs`
 * declares them: records keep v1's snake_case fields and JSON numbers (they are
 * plain serde structs, which the component SDK passes through as they are).
 *
 * What the contract takes and answers is the generated client's
 * (`src/generated/client.ts`): the contract marks its records `#[abi(plain)]`,
 * so the ABI describes their JSON numbers, and they are re-exported here. Three
 * answers stay hand-kept, `FeedItem`, `FeedPage` and `SettingsView`: their
 * `#[serde(default)]` fields (for rows older agents wrote) read as optional in
 * the ABI, while the contract always writes them. So do `ActionInput` and
 * `NotificationInput`, which the demo feed reads as the contract does, with
 * every field present. The rest below is the
 * contract's state and events, first generated from v1's ABI by abi-codegen.
 * `hyperfeed.test.ts` pins the method list to the committed
 * `logic/res/abi.json`.
 */

import type {
  AccessView,
  ActionDef,
  ActionModeView,
  ActionSetView,
  AgentAccountView,
  AgentRuleView,
  AgentView,
  AppCount,
  Ask,
  AssignmentView,
  Attachment,
  AutorunView,
  CheckpointInput,
  CheckpointView,
  FeedCounts,
  Folder,
  GuardView,
  LeaseView,
  LensView,
  LinkInput,
  LinkView,
  MemoHits,
  MemoInput,
  MemoView,
  PolicyView,
  PrInput,
  PrView,
  PushDeviceInput,
  PushDeviceView,
  PushKeyView,
  ReachLine,
  ReachView,
  RuleProposalView,
  RuleView,
  SituationInput,
  SituationView,
  Step,
  TurnStep,
  Verdict,
  WatchInput,
  WatchView,
} from "./generated/client";

export type {
  AccessView,
  ActionDef,
  ActionModeView,
  ActionSetView,
  AgentAccountView,
  AgentRuleView,
  AgentView,
  AppCount,
  Ask,
  AssignmentView,
  Attachment,
  AutorunView,
  CheckpointInput,
  CheckpointView,
  FeedCounts,
  Folder,
  GuardView,
  LeaseView,
  LensView,
  LinkInput,
  LinkView,
  MemoHits,
  MemoInput,
  MemoView,
  PolicyView,
  PrInput,
  PrView,
  PushDeviceInput,
  PushDeviceView,
  PushKeyView,
  ReachLine,
  ReachView,
  RuleProposalView,
  RuleView,
  SituationInput,
  SituationView,
  Step,
  TurnStep,
  Verdict,
  WatchInput,
  WatchView,
};

/**
 * What the agent reports for one action.
 */
export interface ActionInput {
  /**
   * Short app key, e.g. `chat`, `sign`, `crm`. Policies are keyed by it.
   */
  app: string;
  source_context: string;
  source_label: string;
  method: string;
  /**
   * One of the guard categories, or empty for none.
   */
  category: string;
  writes: boolean;
  undoable: boolean;
  title: string;
  body: string;
  why: string;
  /**
   * `proposed`, `done` or `failed`.
   */
  outcome: string;
  intent_hash: string;
  executor: string;
  /**
   * What went wrong, for a `failed` outcome.
   */
  note: string;
  /**
   * The chain this continues: the id of the row that led to it (a
   * notification, or an earlier action). Empty starts a chain of its own.
   */
  chain: string;
  /**
   * For a proposal: how you resolve it, beyond approve or decline. A
   * `choose` lets you approve with one of the options; a `reply` lets you
   * edit the agent's draft before it goes.
   */
  ask: Ask;
  /**
   * For an outcome: the id of a proposal in the same app you approved with
   * "Allow for this session" (see [`SESSION_GRANT`]) in the last 12 hours.
   * Under the app's Ask mode, it is recorded without a breach. Older agents
   * omit it.
   */
  grant: string;
  /**
   * What it touched in the app, as [`subject_key`] makes it (`""` for
   * nothing in particular). A notification about the same thing, with no
   * chain of its own, joins this action's chain. Older agents omit it.
   */
  subject: string;
  /**
   * For a draft you send yourself: the call that sends it in its app,
   * `{"method": ..., "args": {...}}`, where `"=answer"` in an arg is your
   * edit of the draft. Your client makes it as you when you approve; the
   * agent never does. Only on a proposal. See `members.rs`.
   */
  send_call: string;
}

/**
 * What your client saw for one notification.
 */
export interface NotificationInput {
  /**
   * Stable for the same event on every device, e.g.
   * `<context>:<root hash>:<index>`.
   */
  key: string;
  app: string;
  source_context: string;
  source_label: string;
  from: string;
  title: string;
  body: string;
  event: string;
  needs_you: boolean;
  /**
   * Empty starts a chain of its own, which is usual for a notification.
   */
  chain: string;
  /**
   * How to answer it from the feed, if it can be.
   */
  ask: Ask;
  /**
   * What a lens made of it: one of [`ITEM_TYPES`]. Older clients omit these.
   */
  item_type: string;
  /**
   * The type's fields, a JSON object.
   */
  fields: string;
  /**
   * The call that answers it in its app, a JSON object; see [`Typed`].
   */
  reply_call: string;
}

/**
 * What you let one agent reach on its computer, beyond your Calimero apps:
 * these folders, a shell, the web. Yours to set (`set_access`); the agent's
 * runtime enforces it before any tool runs, and an agent with none set keeps
 * its runtime's default.
 */
export interface Access {
  folders: Folder[];
  shell: boolean;
  web: boolean;
  updated_at: number;
}

/**
 * One thing your agent did, or wants to do, on your behalf.
 *
 * Everything but `history` and `reviewed` is written once. `history` merges as
 * a union of steps, and `reviewed` only ever turns on.
 */
export interface Action {
  id: string;
  app: string;
  source_context: string;
  source_label: string;
  method: string;
  category: string;
  writes: boolean;
  undoable: boolean;
  title: string;
  body: string;
  why: string;
  /**
   * Hex `H(method ‖ args)` from the warrant. The arguments themselves never
   * leave the agent: this is enough to match the feed row to the delta.
   */
  intent_hash: string;
  /**
   * The relay account that executed the warrant, as the agent was told.
   */
  executor: string;
  created_at: number;
  /**
   * The chain this belongs to: the id of the row that started it.
   */
  chain: string;
  ask: Ask;
  /**
   * Why the rules say this needed you, when the agent acted anyway. Empty
   * when it did not.
   */
  breach: string;
  reviewed: boolean;
  reviewed_at: number;
  history: Step[];
}

/**
 * Your setting for one action, kept by `<app>/<action id>`. It outlives the
 * set it was made under: a new version's action with the same id keeps it.
 */
export interface ActionRule {
  /**
   * One of [`ACTION_MODES`], or empty to follow the app again.
   */
  mode: string;
  updated_at: number;
}

/**
 * An app version's actions, as your agent learned them from its ABI.
 */
export interface ActionSet {
  app: string;
  application_id: string;
  actions: ActionDef[];
  /**
   * One line for you: what changed, or what the set covers.
   */
  summary: string;
  /**
   * [`LENS_PROPOSED`], [`LENS_APPROVED`] or [`LENS_REJECTED`].
   */
  status: string;
  updated_at: number;
}

/**
 * An agent's own account you added to the feed, by account.
 */
export interface AgentAccount {
  /**
   * The name it reports in with, and the only one it may speak as.
   */
  name: string;
  /**
   * When you added it, or removed it; the later write wins.
   */
  at: number;
  /**
   * Removed rows stay, so a removal is not undone by an older add merging in.
   */
  removed: boolean;
}

/**
 * A standing rule for one agent only ("Reply in one paragraph" for your
 * phone's agent): it goes into that agent's turns after your general rules,
 * which every agent keeps. Only you add or remove one; removing keeps the
 * row with `removed`, like [`Rule`].
 */
export interface AgentRule {
  /**
   * The agent's name, as it reports in: "mero-bot@studio".
   */
  agent: string;
  text: string;
  created_at: number;
  removed: boolean;
  updated_at: number;
}

/**
 * The agent's global switch, stored under the single key `"main"`.
 */
export interface AgentState {
  paused: boolean;
  updated_at: number;
}

/**
 * The question of your agent's that one of your messages answers, when you
 * answered it from its buttons. Kept beside your message by its id.
 */
export interface Answers {
  ask: string;
}

/**
 * A chain you put away. It stays out of the feed until something new
 * happens in it, or until `until` passes ("later"); `until` 0 has no return
 * time. Unarchiving keeps the row with `archived: false`, so the latest
 * decision wins on every device.
 */
export interface Archived {
  archived: boolean;
  /**
   * The chain's latest activity when it was put away: anything newer brings it back.
   */
  at: number;
  until: number;
  updated_at: number;
}

/**
 * What your agent asked you in a message, kept beside it by the message's
 * id, so messages written before agents could ask keep their layout.
 */
export interface Asked {
  ask: Ask;
}

/**
 * Which of your agents works in one app: the agent's name, as it reports in
 * (`mero-bot@<host>`). Only that agent takes the app's work (its new items,
 * your decisions about its actions, your messages about it) and only it may
 * call the app. An app with none is your default agent's: the private one.
 */
export interface Assignment {
  /**
   * Empty: back to the default agent.
   */
  agent: string;
  updated_at: number;
}

/**
 * A message's attachments. Kept beside the message, keyed by its id, so
 * messages written before attachments existed keep their layout.
 */
export interface Attachments {
  items: Attachment[];
}

/**
 * One proposal's default, kept by the action's id. The time is last-writer-
 * wins by when it was set; stopping and firing only ever turn on, and a stop
 * outranks a fire, so a merge never makes a stopped default go ahead.
 */
export interface Autorun {
  chain: string;
  at: number;
  set_at: number;
  stopped_at: number;
  fired_at: number;
}

/**
 * The latest checkpoint on one chain, kept by chain id. A new one replaces
 * it whole: last writer wins.
 */
export interface Checkpoint {
  done: string;
  next: string;
  branches: string[];
  worktrees: string[];
  prs: string[];
  questions: string[];
  author: string;
  updated_at: number;
}

export interface Event_ActionChanged {
  id: string;
  status: string;
}

export interface Event_ActionRecorded {
  id: string;
  status: string;
}

export interface Event_ActionsChanged {
  app: string;
  status: string;
}

export interface Event_ArchiveChanged {
  count: number;
}

export interface Event_AutorunChanged {
  id: string;
  status: string;
}

export interface Event_ChainLeaseChanged {
  chain: string;
}

export interface Event_CheckpointChanged {
  chain: string;
}

export interface Event_LensChanged {
  app: string;
  status: string;
}

export interface Event_LinksChanged {
  chain: string;
}

export interface Event_MemosChanged {
  count: number;
}

export interface Event_MessageChanged {
  id: string;
  status: string;
}

export interface Event_MessagePosted {
  id: string;
  chain: string;
  from: string;
}

export interface Event_NotificationChanged {
  id: string;
  status: string;
}

export interface Event_NotificationRecorded {
  id: string;
}

export interface Event_NotificationsSeen {
  count: number;
}

export interface Event_PrChanged {
  key: string;
}

export interface Event_SituationChanged {
  chain: string;
}

export interface Event_StopRequested {
  id: string;
}

export interface Event_WatchChanged {
  id: string;
  chain: string;
  status: string;
}

/**
 * One row of the feed. Actions and notifications share it so a client renders
 * one list; a field that does not apply to the row's kind is empty.
 */
export interface FeedItem {
  id: string;
  kind: string;
  /**
   * The chain it belongs to, how many rows the chain has, and when anything
   * in it last happened (what the feed is ordered and paged by).
   */
  chain: string;
  chain_len: number;
  chain_at: number;
  app: string;
  source_context: string;
  source_label: string;
  title: string;
  body: string;
  at: number;
  needs_you: boolean;
  /**
   * The current status and its note: an action's (`pending` … `done`) or a
   * notification's (`received`, `answered`, `delivered`, `failed`).
   */
  status: string;
  status_at: number;
  note: string;
  ask: Ask;
  /**
   * Every step, oldest first.
   */
  history: Step[];
  method: string;
  category: string;
  why: string;
  intent_hash: string;
  executor: string;
  undoable: boolean;
  breach: string;
  /**
   * When you kept an action the agent took without asking; 0 if not.
   */
  reviewed_at: number;
  /**
   * Who sent a notification; for a message, [`FROM_YOU`] or [`FROM_AGENT`].
   */
  from: string;
  event: string;
  seen: boolean;
  /**
   * The message of yours an agent message answers.
   */
  reply_to: string;
  /**
   * One of [`ITEM_TYPES`]; `""` for an untyped row.
   */
  item_type: string;
  /**
   * The type's fields, a JSON object, or `""`.
   */
  fields: string;
  /**
   * The call that answers it in its app, or `""`; see [`Typed`].
   */
  reply_call: string;
  /**
   * Its latest step while the message is `thinking` ("Editing ChatView.tsx"), or `""`.
   */
  doing: string;
  /**
   * When that step started; 0 with no step.
   */
  doing_at: number;
  /**
   * Images on a message of yours; empty for every other row.
   */
  attachments: Attachment[];
  /**
   * What your agent did for it, step by step; empty for every other row.
   */
  steps: TurnStep[];
  /**
   * The answer your agent has written so far, while the message is `thinking`; `""` otherwise.
   */
  draft: string;
  /**
   * When you asked your agent to stop working on it; 0 if you did not.
   */
  stop_at: number;
  /**
   * The headline the message was written with, which is also its `title`;
   * `""` when it has none, and for every other row. Without one, `title`
   * is the message's first line and a client may derive a shorter one.
   */
  headline: string;
  /**
   * On a message of yours sent with a mode: `private` or `public` (see
   * [`MESSAGE_MODES`]). `""` when it was sent without one, and for every
   * other row; your agent's runtime then decides, usually by the chain's
   * last message that had one.
   */
  mode: string;
  /**
   * On a question (your agent's, or a notification's) that a newer one in
   * its chain replaced before you answered it: the newer one's id. Its
   * buttons are gone. `""` otherwise.
   */
  superseded_by: string;
  /**
   * On a message of yours sent from a question's buttons: that question's
   * id. `""` otherwise.
   */
  answers: string;
  /**
   * Whether the question it answers had been replaced by a newer one: your
   * agent confirms against where things stand now before acting on it.
   */
  answers_superseded: boolean;
  /**
   * On a message: the agent whose session holds its chain right now
   * ("mero-bot@studio"), or `""` when nobody does.
   */
  held_by: string;
  /**
   * Since when that session has held the chain; 0 when nobody does.
   */
  held_since: number;
  /**
   * On an action, what it touched; on a notification, what its reply goes
   * to; see [`subject_key`]. `""` for nothing in particular.
   */
  subject: string;
}

export interface FeedPage {
  items: FeedItem[];
  /**
   * Counts over the whole feed (muted apps excluded), not just this page,
   * so the filter tabs stay right while paging.
   */
  counts: FeedCounts;
  apps: AppCount[];
  /**
   * Pass as `before` for the next page; 0 when there is none.
   */
  next_before: number;
}

/**
 * One "always ask me before" switch.
 */
export interface Guard {
  category: string;
  enabled: boolean;
  updated_at: number;
}

/**
 * A message's headline: one line for the feed row, its text behind "more".
 * Kept beside the message, keyed by its id, so messages written before
 * headlines keep their layout.
 */
export interface Headline {
  text: string;
}

export interface Hyperfeed {
  /**
   * The account that created the feed. Only it decides; agents it adds
   * (see `agent_accounts`) write the agent's side.
   */
  owner: string;
  actions: Record<string, Action>;
  notifications: Record<string, Notification>;
  policies: Record<string, Policy>;
  guards: Record<string, Guard>;
  agent: Record<string, AgentState>;
  messages: Record<string, Message>;
  /**
   * What a lens made of a notification, by the notification's id.
   */
  typed: Record<string, Typed>;
  /**
   * How each app version's events become feed items, by `<app>@<application id>`.
   */
  lenses: Record<string, Lens>;
  /**
   * What your agent can do in each app version, by `<app>@<application id>`.
   * See [`actions`].
   */
  action_sets: Record<string, ActionSet>;
  /**
   * Your setting for each action apart from its app, by `<app>/<action id>`.
   */
  action_rules: Record<string, ActionRule>;
  /**
   * Chains you put away, by chain id.
   */
  archived: Record<string, Archived>;
  /**
   * Agents that report in, by name.
   */
  presence: Record<string, Presence>;
  /**
   * What your agent asked you, by its message's id.
   */
  asks: Record<string, Asked>;
  /**
   * Your agent's latest step on each message it is working on, by message id.
   */
  progress: Record<string, Progress>;
  /**
   * Images on your messages, by the message's id.
   */
  attachments: Record<string, Attachments>;
  /**
   * Your agent's turn on each of your messages it worked on, by message id.
   */
  work: Record<string, Work>;
  /**
   * Your requests to stop a turn, by message id.
   */
  stops: Record<string, StopRequest>;
  /**
   * Headlines of messages written with one, by the message's id.
   */
  headlines: Record<string, Headline>;
  /**
   * Which agent each of your messages sent with a mode is for, by the message's id.
   */
  modes: Record<string, MessageMode>;
  /**
   * What you let each agent reach on its computer, by agent name.
   */
  access: Record<string, Access>;
  /**
   * What each agent last reported it can reach, by agent name.
   */
  reach: Record<string, Reach>;
  /**
   * Questions a newer one in their chain replaced, by the question's id.
   */
  superseded: Record<string, Superseded>;
  /**
   * The question each of your messages sent from its buttons answers, by
   * your message's id.
   */
  answers: Record<string, Answers>;
  /**
   * Which agent session works on each chain, by chain id.
   */
  leases: Record<string, Lease>;
  /**
   * "When X, do Y", polled by your agent's runtime, by id. See [`watches`].
   */
  watches: Record<string, Watch>;
  /**
   * Your standing rules, by id.
   */
  rules: Record<string, Rule>;
  /**
   * Rules your agent suggested, by id.
   */
  rule_proposals: Record<string, RuleProposal>;
  /**
   * Where each task stands, as your agent last wrote it, by chain id.
   */
  checkpoints: Record<string, Checkpoint>;
  /**
   * The PRs your tasks link to, as your agent's runtime last saw them on
   * GitHub, by `owner/name#number`. See [`prs`].
   */
  prs: Record<string, PrSeen>;
  /**
   * Your agent's query cache: what it read, by a hash of where, which tool
   * and its arguments. See [`memo`].
   */
  memos: Record<string, Memo>;
  /**
   * What each action touched, by the action's id.
   */
  action_subjects: Record<string, Subject>;
  /**
   * The chain that last touched each subject, by its key.
   */
  subject_chains: Record<string, Subject>;
  /**
   * Each task's links, by `<chain>|<subject>`. See [`links`].
   */
  links: Record<string, Link>;
  /**
   * Devices to push to, by endpoint. See [`push`].
   */
  push_devices: Record<string, PushDevice>;
  /**
   * The runtime's VAPID public key, under `vapid`.
   */
  push_keys: Record<string, PushKey>;
  /**
   * Which agent works in each app, by app key. See [`Assignment`].
   */
  assignments: Record<string, Assignment>;
  /**
   * Your rules for one agent only, by id. See [`AgentRule`].
   */
  agent_rules: Record<string, AgentRule>;
  /**
   * Agents with accounts of their own that you added, by account. See [`members`].
   */
  agent_accounts: Record<string, AgentAccount>;
  /**
   * The call that sends each draft for you to send, by the action's id.
   */
  sends: Record<string, SendCall>;
  /**
   * Each task told as one card, as your agent last wrote it, by chain id.
   * See [`brief`].
   */
  situations: Record<string, Situation>;
  /**
   * Proposals that go ahead at a set time unless you stop them, by the
   * action's id. See [`brief`].
   */
  autoruns: Record<string, Autorun>;
}

/**
 * Which agent session is working on a chain, until when. A session claims a
 * chain before it starts a turn there, renews the lease while it works, and
 * releases it at the end; another session is refused the chain until then,
 * or until the lease runs out (the session died). Kept by chain id.
 */
export interface Lease {
  /**
   * The session's own id: unique per running agent process.
   */
  session: string;
  /**
   * Who it is, in words: "mero-bot@studio".
   */
  agent: string;
  /**
   * When this session took the chain; kept while it renews.
   */
  claimed_at: number;
  /**
   * When the lease runs out; 0 once released.
   */
  expires_at: number;
  updated_at: number;
}

/**
 * How one app version's events become feed items, as your agent learned it
 * from the app's ABI. Nothing uses a lens until you approve it.
 */
export interface Lens {
  app: string;
  /**
   * The app version it was learned from: a new version is learned again.
   */
  application_id: string;
  /**
   * The lens itself, JSON (see the app's `lens` module).
   */
  spec: string;
  /**
   * One line for you: what it records and how it answers.
   */
  summary: string;
  /**
   * [`LENS_PROPOSED`], [`LENS_APPROVED`] or [`LENS_REJECTED`].
   */
  status: string;
  updated_at: number;
}

/**
 * One link of a task, kept by `<chain>|<subject>`. Taking it off keeps the
 * row with `removed: true`, so your agent touching the thing again does not
 * bring it back; only you adding it does.
 */
export interface Link {
  chain: string;
  subject: string;
  label: string;
  by: string;
  added_at: number;
  removed: boolean;
  updated_at: number;
}

/**
 * One read as the agent last saw it, kept by its key.
 */
export interface Memo {
  scope: string;
  tool: string;
  args: string;
  value: string;
  class: string;
  ttl_ms: number;
  fetched_at: number;
  unchanged: number;
  /**
   * Per agent, each only ever growing: merged by max, so two agents never
   * lose each other's counts.
   */
  hits: MemoHits[];
  last_hit_at: number;
  agent: string;
  attested: boolean;
  /**
   * When the feed last took a write to it (the feed's clock): what
   * [`crate::Hyperfeed::memos`] reads after.
   */
  updated_at: number;
}

/**
 * One message in a conversation with your agent, inside a chain.
 *
 * You talk to your agent about a row by posting into its chain; a question
 * asked from nowhere starts a chain of its own. The agent's answers, and
 * anything it proposes or does because of them, land in the same chain.
 */
export interface Message {
  id: string;
  chain: string;
  /**
   * [`FROM_YOU`] or [`FROM_AGENT`].
   */
  from: string;
  text: string;
  /**
   * The message of yours this answers; empty for yours, and for an agent
   * message nobody asked for.
   */
  reply_to: string;
  created_at: number;
  history: Step[];
}

/**
 * How private a message of yours is: one of [`MESSAGE_MODES`].
 * Kept beside the message, keyed by its id, so messages written before
 * modes keep their layout.
 */
export interface MessageMode {
  mode: string;
}

/**
 * One notification an app sent you, as your client saw it.
 */
export interface Notification {
  /**
   * The dedupe key the client derived from the source event.
   */
  id: string;
  app: string;
  source_context: string;
  source_label: string;
  from: string;
  title: string;
  body: string;
  event: string;
  needs_you: boolean;
  created_at: number;
  chain: string;
  ask: Ask;
  seen: boolean;
  seen_at: number;
  /**
   * `received`, then `answered` (your answer as the note), then
   * `delivered` or `failed` (the agent's note).
   */
  history: Step[];
}

/**
 * Your rules for one app.
 */
export interface Policy {
  app: string;
  agent: string;
  notifications: string;
  updated_at: number;
}

/**
 * One PR as the runtime last saw it, kept by `owner/name#number`.
 */
export interface PrSeen {
  chain: string;
  repo: string;
  pr: number;
  title: string;
  state: string;
  draft: boolean;
  base: string;
  default_branch: string;
  conflicts: boolean;
  head_sha: string;
  checks: string;
  checks_total: number;
  checks_passed: number;
  checks_pending: number;
  failing: string[];
  stacked_on: number;
  stacked_merged: boolean;
  seen_at: number;
}

/**
 * When an agent last said it was running, by its name.
 */
export interface Presence {
  seen_at: number;
}

/**
 * What your agent is doing right now for one of your messages: its latest
 * step, replaced by the next one. Kept beside the message by id, never in its
 * history, so a long turn adds no rows.
 */
export interface Progress {
  doing: string;
  at: number;
}

/**
 * One device, kept by its endpoint. Taking it off keeps the row with
 * `removed: true`, so a device that synced late does not bring it back.
 */
export interface PushDevice {
  endpoint: string;
  p256dh: string;
  auth: string;
  name: string;
  /**
   * Say only "Something needs you": no title, no text leaves your node.
   */
  quiet: boolean;
  /**
   * The VAPID public key it subscribed with.
   */
  key: string;
  added_at: number;
  removed: boolean;
  updated_at: number;
}

/**
 * The runtime's VAPID public key.
 */
export interface PushKey {
  public_key: string;
  /**
   * The runtime that holds its private half, by name.
   */
  by: string;
  updated_at: number;
}

/**
 * What one agent reported it can reach, latest report wins.
 */
export interface Reach {
  lines: ReachLine[];
  at: number;
}

/**
 * One of your standing rules: a short line your agent keeps to on every
 * turn ("Never push to main", "Answer in English"). Only you add or remove
 * one; removing keeps the row with `removed`, so the latest decision wins on
 * every device.
 */
export interface Rule {
  text: string;
  created_at: number;
  removed: boolean;
  updated_at: number;
}

/**
 * A rule your agent suggested after you corrected it. It changes nothing
 * until you approve it, which adds it as your own rule.
 */
export interface RuleProposal {
  text: string;
  /**
   * Why your agent suggests it: the correction that led to it.
   */
  why: string;
  /**
   * The chain where you corrected it, or `""`.
   */
  chain: string;
  /**
   * [`RULE_PROPOSED`], [`RULE_APPROVED`] or [`RULE_DISMISSED`].
   */
  status: string;
  created_at: number;
  updated_at: number;
}

/**
 * The call that sends a draft in its app, kept beside the action it belongs to.
 */
export interface SendCall {
  /**
   * `{"method": ..., "args": {...}}`, as a lens's `reply_call` is.
   */
  call: string;
}

export interface SettingsView {
  owner: string;
  paused: boolean;
  policies: PolicyView[];
  guards: GuardView[];
  /**
   * Every agent that has reported in, most recent first.
   */
  agents: AgentView[];
  /**
   * Your standing rules, oldest first: your agent keeps to each on every turn.
   */
  rules: RuleView[];
  /**
   * Rules your agent suggested that wait for you, newest first.
   */
  rule_proposals: RuleProposalView[];
  /**
   * The modes a client offers beside Send. Always empty: which agent takes
   * your work is set per app (`assignments`). A `mode` argument is still
   * taken and kept, for clients made before assignments.
   */
  message_modes: string[];
  /**
   * What you let each agent reach on its computer, by agent name. An agent
   * with no entry keeps its runtime's default.
   */
  access: AccessView[];
  /**
   * What each agent last reported it can reach, by agent name.
   */
  reach: ReachView[];
  /**
   * Which agent works in each app you assigned, by app. An app with none
   * is your default agent's. Absent on a feed made before assignments.
   */
  assignments: AssignmentView[];
  /**
   * Your rules for one agent only, by agent then oldest first. Each agent
   * keeps `rules` and then its own. Absent on a feed made before them.
   */
  agent_rules: AgentRuleView[];
  /**
   * Actions you set apart from their app's mode, by app then action.
   * Absent on a feed made before actions.
   */
  action_modes: ActionModeView[];
  /**
   * Agents with accounts of their own you added, by name. Absent on a feed
   * made before them.
   */
  agent_accounts: AgentAccountView[];
}

/**
 * One chain's situation, kept by chain id. A new one replaces it whole: last
 * writer wins.
 */
export interface Situation {
  headline: string;
  summary: string;
  recommend: string;
  reason: string;
  score: number;
  due_at: number;
  sources: number;
  apps: number;
  author: string;
  updated_at: number;
}

/**
 * You asked your agent to stop working on one of your messages.
 */
export interface StopRequest {
  at: number;
}

/**
 * What a row is about in another app, as a key: `<app>:<context>`, plus
 * `:<id>` for one thing in it (an issue, a doc, a thread). Kept two ways: by
 * the action's id (what it touched), and by the key (the chain that touched
 * it last), so a notification about the same thing joins that chain. See
 * [`subject_key`].
 */
export interface Subject {
  subject: string;
  chain: string;
  at: number;
}

/**
 * A question that a newer one in its chain replaced: your agent asked
 * again, or an app sent a new question, before you answered this one. Kept
 * beside the row by its id. Its buttons go; an answer that still reaches it
 * goes to your agent marked as answering an old question.
 */
export interface Superseded {
  /**
   * The newer question's id.
   */
  by: string;
  at: number;
}

/**
 * What a lens made of a notification: its type, the fields its card shows,
 * and the call that answers it in its app. Kept beside the notification, keyed
 * by its id, so rows recorded before lenses existed keep their layout.
 */
export interface Typed {
  /**
   * One of [`ITEM_TYPES`].
   */
  item_type: string;
  /**
   * A JSON object: the fields of that type (`from`, `text`, `options`, …).
   */
  fields: string;
  /**
   * A JSON object `{ "method", "args" }`: what your client calls in the
   * source context to answer, with `"=$answer"` where your answer goes.
   * Empty: answered by your agent, or not answerable from the feed.
   */
  reply_call: string;
}

/**
 * One watch, kept by id.
 */
export interface Watch {
  chain: string;
  condition: string;
  repo: string;
  pr: number;
  branch: string;
  action: string;
  text: string;
  /**
   * Who set it: "mero-bot@studio", or "" for you.
   */
  agent: string;
  /**
   * [`WATCH_WATCHING`], [`WATCH_FIRING`], [`WATCH_DONE`], [`WATCH_FAILED`]
   * or [`WATCH_CANCELLED`].
   */
  status: string;
  /**
   * How the action went, or why it was cancelled.
   */
  note: string;
  /**
   * What the runtime last saw, as one line: "3 of 5 checks passed, 2 running".
   */
  seen: string;
  seen_at: number;
  /**
   * The session that fired it, and when.
   */
  fired_by: string;
  fired_at: number;
  created_at: number;
  updated_at: number;
}

/**
 * Your agent's turn on one of your messages, as it goes: its steps, and the
 * answer it has written so far. Kept beside the message by id and replaced
 * whole by each report, so a long turn adds no rows.
 */
export interface Work {
  steps: TurnStep[];
  /**
   * The answer so far, while the agent writes it; `""` before it starts.
   */
  draft: string;
  at: number;
}

export type AbiEvent =
  | { name: "ActionChanged"; payload: Event_ActionChanged }
  | { name: "ActionRecorded"; payload: Event_ActionRecorded }
  | {
    /**
     * An app's actions were proposed, approved or turned down: re-read
     * `action_sets`.
     */
    name: "ActionsChanged";
    payload: Event_ActionsChanged;
  }
  | {
    /**
     * Chains were put away or brought back: re-read the feed.
     */
    name: "ArchiveChanged";
    payload: Event_ArchiveChanged;
  }
  | {
    /**
     * A proposal's default was set, stopped or went ahead: re-read `autoruns`.
     */
    name: "AutorunChanged";
    payload: Event_AutorunChanged;
  }
  | {
    /**
     * An agent session took a chain, or let it go: re-read who is on it.
     */
    name: "ChainLeaseChanged";
    payload: Event_ChainLeaseChanged;
  }
  | {
    /**
     * Your agent wrote where a task stands: re-read its `checkpoint`.
     */
    name: "CheckpointChanged";
    payload: Event_CheckpointChanged;
  }
  | {
    /**
     * A lens was proposed, approved or turned down: re-read `lenses`.
     */
    name: "LensChanged";
    payload: Event_LensChanged;
  }
  | {
    /**
     * A task's links changed: re-read `links`.
     */
    name: "LinksChanged";
    payload: Event_LinksChanged;
  }
  | {
    /**
     * Your agent's runtime wrote or dropped cached reads: re-read `memos`
     * after the newest `updated_at` you have.
     */
    name: "MemosChanged";
    payload: Event_MemosChanged;
  }
  | {
    /**
     * You cleared your agent's query cache: forget every cached read.
     */
    name: "MemosCleared";
  }
  | { name: "MessageChanged"; payload: Event_MessageChanged }
  | {
    /**
     * A message in a chain: yours (your agent should answer) or its answer.
     */
    name: "MessagePosted";
    payload: Event_MessagePosted;
  }
  | { name: "NotificationChanged"; payload: Event_NotificationChanged }
  | { name: "NotificationRecorded"; payload: Event_NotificationRecorded }
  | { name: "NotificationsSeen"; payload: Event_NotificationsSeen }
  | {
    /**
     * Your agent's runtime saw a PR change on GitHub (`owner/name#number`):
     * re-read `prs`.
     */
    name: "PrChanged";
    payload: Event_PrChanged;
  }
  | {
    /**
     * A device to push to, or the push key, changed: re-read `push_devices`.
     */
    name: "PushChanged";
  }
  | { name: "SettingsChanged" }
  | {
    /**
     * Your agent wrote or cleared how a task reads as one card: re-read `situations`.
     */
    name: "SituationChanged";
    payload: Event_SituationChanged;
  }
  | {
    /**
     * You asked your agent to stop working on message `id`: it ends the turn
     * and marks the message failed, "Stopped by you".
     */
    name: "StopRequested";
    payload: Event_StopRequested;
  }
  | {
    /**
     * A watch was set, fired, finished or cancelled: re-read `watches`.
     */
    name: "WatchChanged";
    payload: Event_WatchChanged;
  }
;
