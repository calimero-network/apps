//! Hyperfeed — one feed for everything your agent did and every notification
//! your apps sent you.
//!
//! A Hyperfeed context is **personal**: you create it, and only you write to it.
//! Two kinds of row land in it.
//!
//! **Actions** are recorded by your agent. When an agent acts for you in
//! another app it signs a warrant, a relay executes the call *as your account*,
//! and the target app sees you. Nothing in core keeps a readable history of
//! those calls, so the agent writes one here: what it called, where, why, the
//! warrant's intent hash and the relay that executed it. Because the agent acts
//! as your account here too, the contract cannot tell the agent's write from
//! yours — which is fine, since every write is yours to make.
//!
//! **Notifications** are recorded by your own client as it watches the events
//! of every context your node is in. Each carries a dedupe key, so two of your
//! devices watching the same stream record it once.
//!
//! ## What the contract decides
//!
//! The agent asks [`Hyperfeed::check_action`] before it acts, and records with
//! [`Hyperfeed::record_action`] either a *proposal* (it wants your approval) or
//! an *outcome* (it already acted). The contract applies your rules — the
//! app's agent mode, the guards that always need you, and the pause switch — to
//! both:
//!
//! * a proposal the rules forbid outright is refused, so the agent learns now;
//! * an outcome the rules say needed you is still recorded, flagged as a
//!   **breach**, and stays in "Needs you" until you keep or undo it. Refusing it
//!   would hide the one thing you most need to see.
//!
//! Approving a proposal does not perform it. The agent watches this context for
//! [`Event::ActionChanged`] and reports the result with
//! [`Hyperfeed::complete_action`]; the warrant it signs then is the authority,
//! and its intent hash is what the feed shows.
//!
//! ## Chains, and resolving things in place
//!
//! Every row belongs to a **chain**: the thread of things that happened
//! because of one another. A mention arrives (a notification, its own chain);
//! the agent answers it by pulling numbers into a sheet and preparing an NDA
//! (actions recorded with that notification's id as their `chain`); you approve
//! the NDA; the agent reports it signed. [`Hyperfeed::feed`] returns one row
//! per chain, led by whatever in it needs you, and [`Hyperfeed::chain`] returns
//! the whole flow. Every row keeps its full **history** of steps, so the flow
//! shows each decision and outcome, not just where it ended.
//!
//! A row can carry an [`Ask`]: how it is best resolved. `reply` (a text, maybe a
//! drafted one), `choose` (one of a few options) or `confirm` (one button). You
//! answer in the feed ([`Hyperfeed::answer_notification`], or
//! [`Hyperfeed::resolve_action`] with an answer); the agent, which already holds
//! the authority to act in the source app, carries it out and reports back
//! ([`Hyperfeed::complete_answer`], [`Hyperfeed::complete_action`]). The feed
//! never needs write access to every app, and every answer leaves the same
//! audit trail as an approval.
//!
//! ## Talking to your agent
//!
//! You can talk to your agent about any chain, or about nothing in particular.
//! [`Hyperfeed::say`] posts your message into the chain (an empty chain starts
//! a new one) as `waiting`. Your agent watches for [`Event::MessagePosted`],
//! takes the message up with [`Hyperfeed::agent_ack`] (`thinking`, which is how
//! you know it is there), and answers with [`Hyperfeed::agent_say`], which
//! marks yours `answered`. Whatever it proposes or does because of the
//! conversation lands in the same chain, under the same rules as everything
//! else. An agent that was away reads [`Hyperfeed::open_questions`] when it
//! starts.
//!
//! ## What holds against a node that does not run this code
//!
//! A peer's node folds deltas without executing this contract, so the owner
//! check in [`Hyperfeed::require_owner`] binds honest nodes only. A Hyperfeed
//! context is meant to have one member — you, on all your devices — so there is
//! no other writer to defend against. Merge-time enforcement (a writer set of
//! one) is the next step if a feed is ever shared.

use calimero_sdk::abi::AbiType;
use calimero_sdk::borsh::{self, BorshDeserialize, BorshSerialize};
use calimero_sdk::serde::{Deserialize, Serialize};
use calimero_sdk::types::Error as AppError;
use calimero_sdk::{app, env, AccountId};
use calimero_storage::collections::crdt_meta::MergeError;
use calimero_storage::collections::{LwwRegister, Mergeable, UnorderedMap};

#[cfg(test)]
mod tests;

// ── Limits ───────────────────────────────────────────────────────────────────
//
// Every field replicates to each of your devices, so nothing is unbounded.

const MAX_KEY: usize = 200;
const MAX_APP: usize = 40;
const MAX_SHORT: usize = 120;
const MAX_TITLE: usize = 200;
const MAX_BODY: usize = 2_000;
const MAX_WHY: usize = 1_000;
const MAX_HASH: usize = 128;
const MAX_OPTIONS: usize = 8;
const MAX_OPTION: usize = 120;
const MAX_HISTORY: usize = 64;
/// One message to or from your agent: a question, an instruction, an answer.
const MAX_MESSAGE: usize = 2_000;
const DEFAULT_PAGE: u32 = 50;
const MAX_PAGE: u32 = 200;

/// How long a notification key keeps meaning "the event already recorded".
///
/// Your devices see the same event within seconds of each other, so a repeat
/// inside the window is another device's report of it. A repeat after the
/// window is the context arriving at the same state again — a real, new event
/// that core's root-hash-based key cannot tell apart — and gets a row of its
/// own. See [`Hyperfeed::record_notification`].
pub const DEDUPE_WINDOW_MS: u64 = 10_000;

/// How many occurrences of one key are looked for before giving up and keying
/// the new one by time. Only a context that keeps returning to the same state
/// gets anywhere near it.
const MAX_OCCURRENCES: u32 = 64;

// ── Vocabularies ─────────────────────────────────────────────────────────────

/// What the agent may do in one app. `act` = without asking, `ask` = propose
/// and wait, `read` = read only, `off` = nothing at all.
pub const AGENT_MODES: &[&str] = &["act", "ask", "read", "off"];
/// The mode for an app nobody has set a policy for. Asking is the only safe
/// default: an agent that discovers a new app should not get to act in it.
pub const DEFAULT_AGENT_MODE: &str = "ask";

/// Where an app's notifications go: the feed and a push, the feed only, or
/// nowhere (still recorded, so un-muting brings them back).
pub const NOTIFICATION_MODES: &[&str] = &["push", "feed", "mute"];
pub const DEFAULT_NOTIFICATION_MODE: &str = "feed";

/// Kinds of action that always need you, whatever the app's mode, when their
/// guard is on. The first four are on until you turn them off.
pub const GUARDS: &[(&str, bool)] = &[
    ("sign", true),
    ("money", true),
    ("new_contact", true),
    ("delete", true),
    ("invite", false),
    ("secret", false),
];

/// What the agent reports: a proposal it wants approved, or an outcome.
const OUTCOMES: &[&str] = &["proposed", "done", "failed"];
const DECISIONS: &[&str] = &["approve", "decline", "undo", "keep"];

pub const STATUS_PENDING: &str = "pending";
pub const STATUS_APPROVED: &str = "approved";
pub const STATUS_DECLINED: &str = "declined";
pub const STATUS_DONE: &str = "done";
pub const STATUS_FAILED: &str = "failed";
pub const STATUS_RETRYING: &str = "retrying";
pub const STATUS_UNDO_REQUESTED: &str = "undo_requested";
pub const STATUS_UNDONE: &str = "undone";

/// A notification's steps: it arrives, you answer, the agent delivers.
pub const STATUS_RECEIVED: &str = "received";
pub const STATUS_ANSWERED: &str = "answered";
pub const STATUS_DELIVERED: &str = "delivered";

/// A message's steps. Yours: `waiting` for your agent, `thinking` once it has
/// picked the message up, then `answered`, or `failed` when it gave up. Your
/// agent's: `said`.
pub const STATUS_WAITING: &str = "waiting";
pub const STATUS_THINKING: &str = "thinking";
pub const STATUS_SAID: &str = "said";

/// Who wrote a message.
pub const FROM_YOU: &str = "you";
pub const FROM_AGENT: &str = "agent";

/// How a row is best resolved. Empty: nothing beyond the defaults (approve or
/// decline a proposal; open a notification).
pub const ASK_KINDS: &[&str] = &["", "confirm", "reply", "choose"];

pub const KIND_ACTION: &str = "action";
pub const KIND_NOTIFICATION: &str = "notification";
pub const KIND_MESSAGE: &str = "message";

const FILTERS: &[&str] = &["all", "agent", "notifications", "needs_you"];

/// Wall-clock milliseconds. `env::time_now()` is nanoseconds, which is past
/// 2^53 and loses its low digits as a JSON number in the browser.
fn now_ms() -> u64 {
    env::time_now() / 1_000_000
}

/// Whole-value last-writer-wins over a TOTAL order: `at`, then the borsh bytes,
/// so two devices writing in the same millisecond still agree.
fn lww<T: BorshSerialize + Clone>(mine: &mut T, mine_at: u64, theirs: &T, theirs_at: u64) {
    let take = match theirs_at.cmp(&mine_at) {
        std::cmp::Ordering::Greater => true,
        std::cmp::Ordering::Less => false,
        std::cmp::Ordering::Equal => {
            borsh::to_vec(theirs).unwrap_or_default() > borsh::to_vec(mine).unwrap_or_default()
        }
    };
    if take {
        *mine = theirs.clone();
    }
}

// ── Stored records ───────────────────────────────────────────────────────────

/// One step in a row's history: a status, who said what about it, and when.
#[derive(
    AbiType, Debug, Clone, PartialEq, Eq, BorshSerialize, BorshDeserialize, Serialize, Deserialize,
)]
#[borsh(crate = "calimero_sdk::borsh")]
#[serde(crate = "calimero_sdk::serde")]
pub struct Step {
    pub status: String,
    /// The note that came with it: the agent's ("NDA signed"), or your answer
    /// (the reply you sent, the option you picked).
    pub note: String,
    pub at: u64,
}

impl Step {
    fn sort_key(&self) -> (u64, &str, &str) {
        (self.at, &self.status, &self.note)
    }
}

/// Union two histories in one total order, so every replica keeps the same
/// steps in the same order and the last one is the current status.
fn merge_history(mine: &mut Vec<Step>, theirs: &[Step]) {
    for step in theirs {
        if !mine.contains(step) {
            mine.push(step.clone());
        }
    }
    mine.sort_by(|a, b| a.sort_key().cmp(&b.sort_key()));
    if mine.len() > MAX_HISTORY {
        // Keep the first step (how it started) and the most recent ones.
        let excess = mine.len() - MAX_HISTORY;
        mine.drain(1..=excess);
    }
}

/// The current step: the last one. A history is never empty.
fn current(history: &[Step]) -> &Step {
    history
        .last()
        .expect("a history starts with its first step")
}

/// How a row is best resolved in place. See [`ASK_KINDS`].
#[derive(
    AbiType,
    Debug,
    Clone,
    Default,
    PartialEq,
    BorshSerialize,
    BorshDeserialize,
    Serialize,
    Deserialize,
)]
#[borsh(crate = "calimero_sdk::borsh")]
#[serde(crate = "calimero_sdk::serde")]
pub struct Ask {
    /// `""`, `confirm`, `reply` or `choose`.
    pub kind: String,
    /// What the control says: "Reply in #launch", "Pick a slot", "Join the call".
    pub prompt: String,
    /// `choose`: the options (2 to 8). `reply`: suggested quick replies (up to 8).
    pub options: Vec<String>,
    /// `reply`: a draft to start from, e.g. the agent's proposed text.
    pub draft: String,
}

/// One thing your agent did, or wants to do, on your behalf.
///
/// Everything but `history` and `reviewed` is written once. `history` merges as
/// a union of steps, and `reviewed` only ever turns on.
#[app::mergeable(id = "hyperfeed::Action")]
#[derive(AbiType, Debug, Clone, BorshSerialize, BorshDeserialize, Serialize, Deserialize)]
#[borsh(crate = "calimero_sdk::borsh")]
#[serde(crate = "calimero_sdk::serde")]
pub struct Action {
    pub id: String,
    pub app: String,
    pub source_context: String,
    pub source_label: String,
    pub method: String,
    pub category: String,
    pub writes: bool,
    pub undoable: bool,
    pub title: String,
    pub body: String,
    pub why: String,
    /// Hex `H(method ‖ args)` from the warrant. The arguments themselves never
    /// leave the agent: this is enough to match the feed row to the delta.
    pub intent_hash: String,
    /// The relay account that executed the warrant, as the agent was told.
    pub executor: String,
    pub created_at: u64,
    /// The chain this belongs to: the id of the row that started it.
    pub chain: String,
    pub ask: Ask,
    /// Why the rules say this needed you, when the agent acted anyway. Empty
    /// when it did not.
    pub breach: String,
    pub reviewed: bool,
    pub reviewed_at: u64,
    pub history: Vec<Step>,
}

impl Mergeable for Action {
    fn merge(&mut self, other: &Self) -> Result<(), MergeError> {
        merge_history(&mut self.history, &other.history);
        self.reviewed |= other.reviewed;
        self.reviewed_at = self.reviewed_at.max(other.reviewed_at);
        Ok(())
    }
}

/// One notification an app sent you, as your client saw it.
#[app::mergeable(id = "hyperfeed::Notification")]
#[derive(AbiType, Debug, Clone, BorshSerialize, BorshDeserialize, Serialize, Deserialize)]
#[borsh(crate = "calimero_sdk::borsh")]
#[serde(crate = "calimero_sdk::serde")]
pub struct Notification {
    /// The dedupe key the client derived from the source event.
    pub id: String,
    pub app: String,
    pub source_context: String,
    pub source_label: String,
    pub from: String,
    pub title: String,
    pub body: String,
    pub event: String,
    pub needs_you: bool,
    pub created_at: u64,
    pub chain: String,
    pub ask: Ask,
    pub seen: bool,
    pub seen_at: u64,
    /// `received`, then `answered` (your answer as the note), then
    /// `delivered` or `failed` (the agent's note).
    pub history: Vec<Step>,
}

impl Mergeable for Notification {
    fn merge(&mut self, other: &Self) -> Result<(), MergeError> {
        // Seen on any device is seen.
        self.seen |= other.seen;
        self.seen_at = self.seen_at.max(other.seen_at);
        merge_history(&mut self.history, &other.history);
        Ok(())
    }
}

/// One message in a conversation with your agent, inside a chain.
///
/// You talk to your agent about a row by posting into its chain; a question
/// asked from nowhere starts a chain of its own. The agent's answers, and
/// anything it proposes or does because of them, land in the same chain.
#[app::mergeable(id = "hyperfeed::Message")]
#[derive(AbiType, Debug, Clone, BorshSerialize, BorshDeserialize, Serialize, Deserialize)]
#[borsh(crate = "calimero_sdk::borsh")]
#[serde(crate = "calimero_sdk::serde")]
pub struct Message {
    pub id: String,
    pub chain: String,
    /// [`FROM_YOU`] or [`FROM_AGENT`].
    pub from: String,
    pub text: String,
    /// The message of yours this answers; empty for yours, and for an agent
    /// message nobody asked for.
    pub reply_to: String,
    pub created_at: u64,
    pub history: Vec<Step>,
}

impl Mergeable for Message {
    fn merge(&mut self, other: &Self) -> Result<(), MergeError> {
        merge_history(&mut self.history, &other.history);
        Ok(())
    }
}

/// Your rules for one app.
#[app::mergeable(id = "hyperfeed::Policy")]
#[derive(AbiType, Debug, Clone, BorshSerialize, BorshDeserialize, Serialize, Deserialize)]
#[borsh(crate = "calimero_sdk::borsh")]
#[serde(crate = "calimero_sdk::serde")]
pub struct Policy {
    pub app: String,
    pub agent: String,
    pub notifications: String,
    pub updated_at: u64,
}

impl Mergeable for Policy {
    fn merge(&mut self, other: &Self) -> Result<(), MergeError> {
        let at = self.updated_at;
        lww(self, at, other, other.updated_at);
        Ok(())
    }
}

/// One "always ask me before" switch.
#[app::mergeable(id = "hyperfeed::Guard")]
#[derive(AbiType, Debug, Clone, BorshSerialize, BorshDeserialize, Serialize, Deserialize)]
#[borsh(crate = "calimero_sdk::borsh")]
#[serde(crate = "calimero_sdk::serde")]
pub struct Guard {
    pub category: String,
    pub enabled: bool,
    pub updated_at: u64,
}

impl Mergeable for Guard {
    fn merge(&mut self, other: &Self) -> Result<(), MergeError> {
        let at = self.updated_at;
        lww(self, at, other, other.updated_at);
        Ok(())
    }
}

/// The agent's global switch, stored under the single key `"main"`.
#[app::mergeable(id = "hyperfeed::AgentState")]
#[derive(AbiType, Debug, Clone, BorshSerialize, BorshDeserialize, Serialize, Deserialize)]
#[borsh(crate = "calimero_sdk::borsh")]
#[serde(crate = "calimero_sdk::serde")]
pub struct AgentState {
    pub paused: bool,
    pub updated_at: u64,
}

impl Mergeable for AgentState {
    fn merge(&mut self, other: &Self) -> Result<(), MergeError> {
        let at = self.updated_at;
        lww(self, at, other, other.updated_at);
        Ok(())
    }
}

// ── Inputs and views ─────────────────────────────────────────────────────────

/// What the agent reports for one action.
#[derive(AbiType, Debug, Clone, Serialize, Deserialize)]
#[serde(crate = "calimero_sdk::serde")]
pub struct ActionInput {
    /// Short app key, e.g. `chat`, `sign`, `crm`. Policies are keyed by it.
    pub app: String,
    pub source_context: String,
    pub source_label: String,
    pub method: String,
    /// One of the guard categories, or empty for none.
    pub category: String,
    pub writes: bool,
    pub undoable: bool,
    pub title: String,
    pub body: String,
    pub why: String,
    /// `proposed`, `done` or `failed`.
    pub outcome: String,
    pub intent_hash: String,
    pub executor: String,
    /// What went wrong, for a `failed` outcome.
    pub note: String,
    /// The chain this continues: the id of the row that led to it (a
    /// notification, or an earlier action). Empty starts a chain of its own.
    pub chain: String,
    /// For a proposal: how you resolve it, beyond approve or decline. A
    /// `choose` lets you approve with one of the options; a `reply` lets you
    /// edit the agent's draft before it goes.
    pub ask: Ask,
}

/// What your client saw for one notification.
#[derive(AbiType, Debug, Clone, Serialize, Deserialize)]
#[serde(crate = "calimero_sdk::serde")]
pub struct NotificationInput {
    /// Stable for the same event on every device, e.g.
    /// `<context>:<root hash>:<index>`.
    pub key: String,
    pub app: String,
    pub source_context: String,
    pub source_label: String,
    pub from: String,
    pub title: String,
    pub body: String,
    pub event: String,
    pub needs_you: bool,
    /// Empty starts a chain of its own, which is usual for a notification.
    pub chain: String,
    /// How to answer it from the feed, if it can be.
    pub ask: Ask,
}

/// The rules' answer for one prospective action.
#[derive(AbiType, Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(crate = "calimero_sdk::serde")]
pub struct Verdict {
    /// `act`, `ask` or `refuse`.
    pub decision: String,
    pub reason: String,
}

/// One row of the feed. Actions and notifications share it so a client renders
/// one list; a field that does not apply to the row's kind is empty.
#[derive(AbiType, Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(crate = "calimero_sdk::serde")]
pub struct FeedItem {
    pub id: String,
    pub kind: String,
    /// The chain it belongs to, how many rows the chain has, and when anything
    /// in it last happened (what the feed is ordered and paged by).
    pub chain: String,
    pub chain_len: u32,
    pub chain_at: u64,
    pub app: String,
    pub source_context: String,
    pub source_label: String,
    pub title: String,
    pub body: String,
    pub at: u64,
    pub needs_you: bool,
    /// The current status and its note: an action's (`pending` … `done`) or a
    /// notification's (`received`, `answered`, `delivered`, `failed`).
    pub status: String,
    pub status_at: u64,
    pub note: String,
    pub ask: Ask,
    /// Every step, oldest first.
    pub history: Vec<Step>,
    // ── actions ──
    pub method: String,
    pub category: String,
    pub why: String,
    pub intent_hash: String,
    pub executor: String,
    pub undoable: bool,
    pub breach: String,
    /// When you kept an action the agent took without asking; 0 if not.
    pub reviewed_at: u64,
    // ── notifications and messages ──
    /// Who sent a notification; for a message, [`FROM_YOU`] or [`FROM_AGENT`].
    pub from: String,
    pub event: String,
    pub seen: bool,
    // ── messages ──
    /// The message of yours an agent message answers.
    pub reply_to: String,
}

#[derive(AbiType, Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(crate = "calimero_sdk::serde")]
pub struct FeedCounts {
    pub all: u32,
    pub agent: u32,
    pub notifications: u32,
    pub needs_you: u32,
}

#[derive(AbiType, Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(crate = "calimero_sdk::serde")]
pub struct AppCount {
    pub app: String,
    pub count: u32,
}

#[derive(AbiType, Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(crate = "calimero_sdk::serde")]
pub struct FeedPage {
    pub items: Vec<FeedItem>,
    /// Counts over the whole feed (muted apps excluded), not just this page,
    /// so the filter tabs stay right while paging.
    pub counts: FeedCounts,
    pub apps: Vec<AppCount>,
    /// Pass as `before` for the next page; 0 when there is none.
    pub next_before: u64,
}

#[derive(AbiType, Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(crate = "calimero_sdk::serde")]
pub struct PolicyView {
    pub app: String,
    pub agent: String,
    pub notifications: String,
}

#[derive(AbiType, Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(crate = "calimero_sdk::serde")]
pub struct GuardView {
    pub category: String,
    pub enabled: bool,
}

#[derive(AbiType, Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(crate = "calimero_sdk::serde")]
pub struct SettingsView {
    pub owner: String,
    pub paused: bool,
    pub policies: Vec<PolicyView>,
    pub guards: Vec<GuardView>,
}

// ── State ────────────────────────────────────────────────────────────────────

#[app::state(emits = for<'a> Event<'a>)]
pub struct Hyperfeed {
    /// The account that created the feed; the only one that writes to it.
    owner: LwwRegister<String>,
    actions: UnorderedMap<String, Action>,
    notifications: UnorderedMap<String, Notification>,
    policies: UnorderedMap<String, Policy>,
    guards: UnorderedMap<String, Guard>,
    agent: UnorderedMap<String, AgentState>,
    messages: UnorderedMap<String, Message>,
}

/// Every event is a nudge to re-read the feed; none carries the row itself.
#[app::event]
pub enum Event<'a> {
    ActionRecorded {
        id: &'a str,
        status: &'a str,
    },
    ActionChanged {
        id: &'a str,
        status: &'a str,
    },
    NotificationRecorded {
        id: &'a str,
    },
    NotificationChanged {
        id: &'a str,
        status: &'a str,
    },
    NotificationsSeen {
        count: u32,
    },
    SettingsChanged,
    /// A message in a chain: yours (your agent should answer) or its answer.
    MessagePosted {
        id: &'a str,
        chain: &'a str,
        from: &'a str,
    },
    MessageChanged {
        id: &'a str,
        status: &'a str,
    },
}

// ── Logic ────────────────────────────────────────────────────────────────────

#[app::logic]
impl Hyperfeed {
    /// No arguments: the frontend's context-creation flow sends `{}`. The
    /// creator owns the feed.
    #[app::init]
    pub fn init() -> Hyperfeed {
        Hyperfeed {
            owner: LwwRegister::new(Self::caller()),
            actions: UnorderedMap::new(),
            notifications: UnorderedMap::new(),
            policies: UnorderedMap::new(),
            guards: UnorderedMap::new(),
            agent: UnorderedMap::new(),
            messages: UnorderedMap::new(),
        }
    }

    // ── helpers ──────────────────────────────────────────────────────────────

    fn caller() -> String {
        AccountId::from(env::account_id()).to_string()
    }

    fn require_owner(&self) -> app::Result<()> {
        if *self.owner.get() == Self::caller() {
            Ok(())
        } else {
            Err(AppError::msg("only the feed's owner can write to it"))
        }
    }

    fn fresh_id() -> String {
        let mut buffer = [0u8; 16];
        env::random_bytes(&mut buffer);
        buffer.iter().map(|b| format!("{b:02x}")).collect()
    }

    fn check_len(field: &str, value: &str, max: usize, required: bool) -> app::Result<()> {
        if required && value.trim().is_empty() {
            return Err(AppError::msg(format!("{field} must not be empty")));
        }
        if value.len() > max {
            return Err(AppError::msg(format!(
                "{field} is {} bytes, limit is {max}",
                value.len()
            )));
        }
        Ok(())
    }

    fn check_one_of(field: &str, value: &str, allowed: &[&str]) -> app::Result<()> {
        if allowed.contains(&value) {
            Ok(())
        } else {
            Err(AppError::msg(format!(
                "{field} must be one of {}, got {value:?}",
                allowed.join(", ")
            )))
        }
    }

    /// App keys are policy keys, shown as labels, so they stay short and plain.
    fn check_app(app: &str) -> app::Result<()> {
        Self::check_len("app", app, MAX_APP, true)?;
        if app
            .chars()
            .all(|c| c.is_ascii_lowercase() || c.is_ascii_digit() || c == '-' || c == '.')
        {
            Ok(())
        } else {
            Err(AppError::msg(format!(
                "app must be lowercase letters, digits, '-' or '.', got {app:?}"
            )))
        }
    }

    fn check_category(category: &str) -> app::Result<()> {
        if category.is_empty() || GUARDS.iter().any(|(name, _)| *name == category) {
            Ok(())
        } else {
            let names: Vec<&str> = GUARDS.iter().map(|(name, _)| *name).collect();
            Err(AppError::msg(format!(
                "category must be empty or one of {}, got {category:?}",
                names.join(", ")
            )))
        }
    }

    fn policy_for(&self, app: &str) -> app::Result<PolicyView> {
        Ok(match self.policies.get(app)? {
            Some(p) => PolicyView {
                app: p.app.clone(),
                agent: p.agent.clone(),
                notifications: p.notifications.clone(),
            },
            None => PolicyView {
                app: app.to_owned(),
                agent: DEFAULT_AGENT_MODE.to_owned(),
                notifications: DEFAULT_NOTIFICATION_MODE.to_owned(),
            },
        })
    }

    fn guard_on(&self, category: &str) -> app::Result<bool> {
        if category.is_empty() {
            return Ok(false);
        }
        if let Some(g) = self.guards.get(category)? {
            return Ok(g.enabled);
        }
        Ok(GUARDS
            .iter()
            .find(|(name, _)| *name == category)
            .is_some_and(|(_, on)| *on))
    }

    fn is_paused(&self) -> app::Result<bool> {
        Ok(self.agent.get("main")?.is_some_and(|a| a.paused))
    }

    fn verdict(&self, app: &str, category: &str, writes: bool) -> app::Result<Verdict> {
        let policy = self.policy_for(app)?;
        let answer = |decision: &str, reason: String| Verdict {
            decision: decision.to_owned(),
            reason,
        };
        if policy.agent == "off" {
            return Ok(answer("refuse", format!("your agent is off in {app}")));
        }
        if !writes {
            return Ok(answer("act", format!("reading in {app} is allowed")));
        }
        if policy.agent == "read" {
            return Ok(answer(
                "refuse",
                format!("your agent may only read in {app}"),
            ));
        }
        if self.is_paused()? {
            return Ok(answer("ask", "your agent is paused".to_owned()));
        }
        if self.guard_on(category)? {
            return Ok(answer("ask", format!("\"{category}\" always needs you")));
        }
        if policy.agent == "ask" {
            return Ok(answer("ask", format!("your agent asks first in {app}")));
        }
        Ok(answer("act", format!("your agent may act in {app}")))
    }

    fn action_needs_you(a: &Action) -> bool {
        matches!(
            current(&a.history).status.as_str(),
            STATUS_PENDING | STATUS_FAILED
        ) || (!a.breach.is_empty() && !a.reviewed)
    }

    /// An ask makes a notification need you until it is answered (or its
    /// delivery failed); without one, a flagged notification needs you until
    /// you have seen it.
    fn notification_needs_you(n: &Notification) -> bool {
        let status = current(&n.history).status.as_str();
        if !n.ask.kind.is_empty() {
            return matches!(status, STATUS_RECEIVED | STATUS_FAILED);
        }
        n.needs_you && !n.seen
    }

    fn action_item(a: &Action) -> FeedItem {
        let now = current(&a.history);
        FeedItem {
            id: a.id.clone(),
            kind: KIND_ACTION.to_owned(),
            chain: a.chain.clone(),
            chain_len: 1,
            chain_at: now.at,
            app: a.app.clone(),
            source_context: a.source_context.clone(),
            source_label: a.source_label.clone(),
            title: a.title.clone(),
            body: a.body.clone(),
            at: a.created_at,
            needs_you: Self::action_needs_you(a),
            status: now.status.clone(),
            status_at: now.at,
            note: now.note.clone(),
            ask: a.ask.clone(),
            history: a.history.clone(),
            method: a.method.clone(),
            category: a.category.clone(),
            why: a.why.clone(),
            intent_hash: a.intent_hash.clone(),
            executor: a.executor.clone(),
            undoable: a.undoable,
            breach: if a.reviewed {
                String::new()
            } else {
                a.breach.clone()
            },
            reviewed_at: a.reviewed_at,
            from: String::new(),
            event: String::new(),
            seen: true,
            reply_to: String::new(),
        }
    }

    fn notification_item(n: &Notification) -> FeedItem {
        let now = current(&n.history);
        FeedItem {
            id: n.id.clone(),
            kind: KIND_NOTIFICATION.to_owned(),
            chain: n.chain.clone(),
            chain_len: 1,
            // Seeing a notification is not news: it does not move the chain.
            chain_at: now.at,
            app: n.app.clone(),
            source_context: n.source_context.clone(),
            source_label: n.source_label.clone(),
            title: n.title.clone(),
            body: n.body.clone(),
            at: n.created_at,
            needs_you: Self::notification_needs_you(n),
            status: now.status.clone(),
            status_at: now.at,
            note: now.note.clone(),
            ask: n.ask.clone(),
            history: n.history.clone(),
            method: String::new(),
            category: String::new(),
            why: String::new(),
            intent_hash: String::new(),
            executor: String::new(),
            undoable: false,
            breach: String::new(),
            reviewed_at: 0,
            from: n.from.clone(),
            event: n.event.clone(),
            seen: n.seen,
            reply_to: String::new(),
        }
    }

    /// A message as a row. It never needs you: what the agent wants from you
    /// arrives as a proposal in the same chain.
    fn message_item(m: &Message) -> FeedItem {
        let now = current(&m.history);
        FeedItem {
            id: m.id.clone(),
            kind: KIND_MESSAGE.to_owned(),
            chain: m.chain.clone(),
            chain_len: 1,
            chain_at: now.at,
            app: String::new(),
            source_context: String::new(),
            source_label: String::new(),
            title: headline(&m.text),
            body: m.text.clone(),
            at: m.created_at,
            needs_you: false,
            status: now.status.clone(),
            status_at: now.at,
            note: now.note.clone(),
            ask: Ask::default(),
            history: m.history.clone(),
            method: String::new(),
            category: String::new(),
            why: String::new(),
            intent_hash: String::new(),
            executor: String::new(),
            undoable: false,
            breach: String::new(),
            reviewed_at: 0,
            from: m.from.clone(),
            event: String::new(),
            seen: true,
            reply_to: m.reply_to.clone(),
        }
    }

    fn check_ask(ask: &Ask) -> app::Result<()> {
        Self::check_one_of("ask.kind", &ask.kind, ASK_KINDS)?;
        Self::check_len("ask.prompt", &ask.prompt, MAX_TITLE, false)?;
        Self::check_len("ask.draft", &ask.draft, MAX_BODY, false)?;
        if ask.options.len() > MAX_OPTIONS {
            return Err(AppError::msg(format!(
                "ask.options has {} options, limit is {MAX_OPTIONS}",
                ask.options.len()
            )));
        }
        for option in &ask.options {
            Self::check_len("ask.options[]", option, MAX_OPTION, true)?;
        }
        match ask.kind.as_str() {
            "" if !ask.options.is_empty() || !ask.draft.is_empty() || !ask.prompt.is_empty() => {
                Err(AppError::msg(
                    "an empty ask kind takes no prompt, options or draft",
                ))
            }
            "choose" if ask.options.len() < 2 => {
                Err(AppError::msg("a choose ask needs at least 2 options"))
            }
            "confirm" if !ask.options.is_empty() || !ask.draft.is_empty() => {
                Err(AppError::msg("a confirm ask takes a prompt only"))
            }
            _ => Ok(()),
        }
    }

    /// Whether `answer` resolves `ask`, and the note it is recorded with.
    fn check_answer(ask: &Ask, answer: &str) -> app::Result<String> {
        match ask.kind.as_str() {
            "choose" if ask.options.iter().any(|o| o == answer) => Ok(answer.to_owned()),
            "choose" => Err(AppError::msg(format!(
                "answer must be one of {}",
                ask.options.join(", ")
            ))),
            "reply" => {
                Self::check_len("answer", answer, MAX_BODY, true)?;
                Ok(answer.to_owned())
            }
            "confirm" | "" if answer.is_empty() => Ok(String::new()),
            _ => Err(AppError::msg("this takes no answer")),
        }
    }

    fn chain_of(chain: &str, id: &str) -> app::Result<String> {
        Self::check_len("chain", chain, MAX_KEY, false)?;
        Ok(if chain.is_empty() {
            id.to_owned()
        } else {
            chain.to_owned()
        })
    }

    /// The next step's time: now, but strictly after the last step, so a
    /// history never ties with itself on a fast device.
    fn next_at(history: &[Step]) -> u64 {
        now_ms().max(current(history).at + 1)
    }

    /// Whether `key` at `now` is an event already recorded, or which id a new
    /// one gets: the key itself, then `<key>#1`, `<key>#2`, … in order. Only the
    /// latest occurrence can be the one being re-reported.
    fn occurrence_of(&self, key: &str, now: u64) -> app::Result<Occurrence> {
        let mut latest: Option<Notification> = None;
        for n in 0..MAX_OCCURRENCES {
            let id = if n == 0 {
                key.to_owned()
            } else {
                format!("{key}#{n}")
            };
            match self.notifications.get(&id)? {
                Some(found) => latest = Some(found.clone()),
                None => {
                    return Ok(match latest {
                        Some(prev) if now.saturating_sub(prev.created_at) <= DEDUPE_WINDOW_MS => {
                            Occurrence::Seen(Box::new(prev))
                        }
                        _ => Occurrence::New(id),
                    })
                }
            }
        }
        // A context that keeps coming back to one state: key by time instead.
        match latest {
            Some(prev) if now.saturating_sub(prev.created_at) <= DEDUPE_WINDOW_MS => {
                Ok(Occurrence::Seen(Box::new(prev)))
            }
            _ => Ok(Occurrence::New(format!("{key}@{now}"))),
        }
    }

    fn get_action(&self, id: &str) -> app::Result<Action> {
        self.actions
            .get(id)?
            .map(|a| a.clone())
            .ok_or_else(|| AppError::msg(format!("no action {id}")))
    }

    fn push_step(
        &mut self,
        mut action: Action,
        status: &str,
        note: String,
    ) -> app::Result<FeedItem> {
        let at = Self::next_at(&action.history);
        action.history.push(Step {
            status: status.to_owned(),
            note,
            at,
        });
        let item = Self::action_item(&action);
        self.actions.insert(action.id.clone(), action)?;
        app::emit!(Event::ActionChanged {
            id: &item.id,
            status: &item.status,
        });
        Ok(item)
    }

    fn get_notification(&self, id: &str) -> app::Result<Notification> {
        self.notifications
            .get(id)?
            .map(|n| n.clone())
            .ok_or_else(|| AppError::msg(format!("no notification {id}")))
    }

    fn push_notification_step(
        &mut self,
        mut n: Notification,
        status: &str,
        note: String,
    ) -> app::Result<FeedItem> {
        let at = Self::next_at(&n.history);
        n.history.push(Step {
            status: status.to_owned(),
            note,
            at,
        });
        let item = Self::notification_item(&n);
        self.notifications.insert(n.id.clone(), n)?;
        app::emit!(Event::NotificationChanged {
            id: &item.id,
            status: &item.status,
        });
        Ok(item)
    }

    fn get_message(&self, id: &str) -> app::Result<Message> {
        self.messages
            .get(id)?
            .map(|m| m.clone())
            .ok_or_else(|| AppError::msg(format!("no message {id}")))
    }

    /// Whether any row lives in `chain`: a message goes into a chain that
    /// exists, or starts its own.
    fn chain_exists(&self, chain: &str) -> app::Result<bool> {
        Ok(self.actions.entries()?.any(|(_, a)| a.chain == chain)
            || self.notifications.entries()?.any(|(_, n)| n.chain == chain)
            || self.messages.entries()?.any(|(_, m)| m.chain == chain))
    }

    fn push_message_step(
        &mut self,
        mut m: Message,
        status: &str,
        note: String,
    ) -> app::Result<FeedItem> {
        let at = Self::next_at(&m.history);
        m.history.push(Step {
            status: status.to_owned(),
            note,
            at,
        });
        let item = Self::message_item(&m);
        self.messages.insert(m.id.clone(), m)?;
        app::emit!(Event::MessageChanged {
            id: &item.id,
            status: &item.status,
        });
        Ok(item)
    }

    fn post_message(
        &mut self,
        chain: String,
        from: &str,
        text: String,
        reply_to: String,
        status: &str,
    ) -> app::Result<FeedItem> {
        let now = now_ms();
        let id = Self::fresh_id();
        let m = Message {
            chain: Self::chain_of(&chain, &id)?,
            id,
            from: from.to_owned(),
            text,
            reply_to,
            created_at: now,
            history: vec![Step {
                status: status.to_owned(),
                note: String::new(),
                at: now,
            }],
        };
        let item = Self::message_item(&m);
        self.messages.insert(m.id.clone(), m)?;
        app::emit!(Event::MessagePosted {
            id: &item.id,
            chain: &item.chain,
            from: &item.from,
        });
        Ok(item)
    }

    // ── the agent's side ─────────────────────────────────────────────────────

    /// What your rules say about an action before the agent takes it.
    pub fn check_action(
        &self,
        app_key: String,
        category: String,
        writes: bool,
    ) -> app::Result<Verdict> {
        Self::check_app(&app_key)?;
        Self::check_category(&category)?;
        self.verdict(&app_key, &category, writes)
    }

    /// Record an action: a proposal for you to approve, or an outcome.
    ///
    /// A proposal the rules refuse is an error. An outcome the rules say
    /// needed you is recorded with a breach, never dropped.
    pub fn record_action(&mut self, input: ActionInput) -> app::Result<FeedItem> {
        self.require_owner()?;
        Self::check_app(&input.app)?;
        Self::check_category(&input.category)?;
        Self::check_one_of("outcome", &input.outcome, OUTCOMES)?;
        Self::check_len("source_context", &input.source_context, MAX_KEY, false)?;
        Self::check_len("source_label", &input.source_label, MAX_SHORT, false)?;
        Self::check_len("method", &input.method, MAX_SHORT, true)?;
        Self::check_len("title", &input.title, MAX_TITLE, true)?;
        Self::check_len("body", &input.body, MAX_BODY, false)?;
        Self::check_len("why", &input.why, MAX_WHY, false)?;
        Self::check_len("intent_hash", &input.intent_hash, MAX_HASH, false)?;
        Self::check_len("executor", &input.executor, MAX_KEY, false)?;
        Self::check_len("note", &input.note, MAX_WHY, false)?;
        Self::check_ask(&input.ask)?;
        if !input.ask.kind.is_empty() && input.outcome != "proposed" {
            return Err(AppError::msg(
                "an ask belongs on a proposal; a done or failed action has nothing to answer",
            ));
        }

        let verdict = self.verdict(&input.app, &input.category, input.writes)?;
        let (status, breach) = match (input.outcome.as_str(), verdict.decision.as_str()) {
            ("proposed", "refuse") => {
                return Err(AppError::msg(format!("not allowed: {}", verdict.reason)))
            }
            ("proposed", _) => (STATUS_PENDING, String::new()),
            (outcome, "act") => (outcome_status(outcome), String::new()),
            (outcome, "ask") => (
                outcome_status(outcome),
                format!("acted without asking: {}", verdict.reason),
            ),
            (outcome, _) => (
                outcome_status(outcome),
                format!("acted where it may not: {}", verdict.reason),
            ),
        };

        let now = now_ms();
        let id = Self::fresh_id();
        let action = Action {
            chain: Self::chain_of(&input.chain, &id)?,
            id,
            app: input.app,
            source_context: input.source_context,
            source_label: input.source_label,
            method: input.method,
            category: input.category,
            writes: input.writes,
            undoable: input.undoable,
            title: input.title,
            body: input.body,
            why: input.why,
            intent_hash: input.intent_hash,
            executor: input.executor,
            created_at: now,
            ask: input.ask,
            breach,
            reviewed: false,
            reviewed_at: 0,
            history: vec![Step {
                status: status.to_owned(),
                note: input.note,
                at: now,
            }],
        };
        let item = Self::action_item(&action);
        self.actions.insert(action.id.clone(), action)?;
        app::emit!(Event::ActionRecorded {
            id: &item.id,
            status: &item.status,
        });
        Ok(item)
    }

    /// The agent reports what happened after you approved, asked for a retry,
    /// or asked for an undo.
    pub fn complete_action(
        &mut self,
        id: String,
        outcome: String,
        note: String,
    ) -> app::Result<FeedItem> {
        self.require_owner()?;
        Self::check_one_of("outcome", &outcome, &["done", "failed"])?;
        Self::check_len("note", &note, MAX_WHY, false)?;
        let action = self.get_action(&id)?;
        let status = match (current(&action.history).status.as_str(), outcome.as_str()) {
            (STATUS_APPROVED | STATUS_RETRYING, "done") => STATUS_DONE,
            (STATUS_APPROVED | STATUS_RETRYING, _) => STATUS_FAILED,
            (STATUS_UNDO_REQUESTED, "done") => STATUS_UNDONE,
            // The undo did not happen, so the action still stands.
            (STATUS_UNDO_REQUESTED, _) => STATUS_DONE,
            (current, _) => {
                return Err(AppError::msg(format!(
                    "action {id} is {current}; nothing is waiting on the agent"
                )))
            }
        };
        self.push_step(action, status, note)
    }

    /// The agent reports whether it carried out your answer to a notification:
    /// sent the reply, cast the vote, accepted the invite.
    pub fn complete_answer(
        &mut self,
        id: String,
        outcome: String,
        note: String,
    ) -> app::Result<FeedItem> {
        self.require_owner()?;
        Self::check_one_of("outcome", &outcome, &["delivered", "failed"])?;
        Self::check_len("note", &note, MAX_WHY, false)?;
        let n = self.get_notification(&id)?;
        let status = current(&n.history).status.clone();
        if status != STATUS_ANSWERED {
            return Err(AppError::msg(format!(
                "notification {id} is {status}; nothing is waiting on the agent"
            )));
        }
        let next = if outcome == "delivered" {
            STATUS_DELIVERED
        } else {
            STATUS_FAILED
        };
        self.push_notification_step(n, next, note)
    }

    /// The agent takes up one of your messages (`thinking`), or gives up on it
    /// (`failed`, with why). Taking it up is how you know an agent is there.
    pub fn agent_ack(&mut self, id: String, status: String, note: String) -> app::Result<FeedItem> {
        self.require_owner()?;
        Self::check_one_of("status", &status, &[STATUS_THINKING, STATUS_FAILED])?;
        Self::check_len("note", &note, MAX_WHY, false)?;
        let m = self.get_message(&id)?;
        if m.from != FROM_YOU {
            return Err(AppError::msg(format!("message {id} is the agent's own")));
        }
        let now = current(&m.history).status.clone();
        match (now.as_str(), status.as_str()) {
            (STATUS_WAITING, _) | (STATUS_THINKING, STATUS_FAILED) => {
                self.push_message_step(m, &status, note)
            }
            _ => Err(AppError::msg(format!(
                "message {id} is {now}; cannot mark it {status}"
            ))),
        }
    }

    /// The agent says something in a chain: an answer to one of your
    /// messages (`reply_to`, which marks it answered), or, with `reply_to`
    /// empty, a note of its own in a chain that exists.
    pub fn agent_say(
        &mut self,
        chain: String,
        reply_to: String,
        text: String,
    ) -> app::Result<FeedItem> {
        self.require_owner()?;
        Self::check_len("chain", &chain, MAX_KEY, true)?;
        Self::check_len("text", &text, MAX_MESSAGE, true)?;
        Self::check_len("reply_to", &reply_to, MAX_KEY, false)?;
        if reply_to.is_empty() {
            if !self.chain_exists(&chain)? {
                return Err(AppError::msg(format!("no chain {chain}")));
            }
        } else {
            let asked = self.get_message(&reply_to)?;
            if asked.from != FROM_YOU {
                return Err(AppError::msg(format!(
                    "message {reply_to} is the agent's own; answer one of yours"
                )));
            }
            if asked.chain != chain {
                return Err(AppError::msg(format!(
                    "message {reply_to} is in chain {}, not {chain}",
                    asked.chain
                )));
            }
            // A second answer to the same question leaves it answered.
            if current(&asked.history).status != STATUS_ANSWERED {
                self.push_message_step(asked, STATUS_ANSWERED, String::new())?;
            }
        }
        self.post_message(chain, FROM_AGENT, text, reply_to, STATUS_SAID)
    }

    /// Your messages your agent has not answered yet, oldest first: what an
    /// agent that was away picks up when it starts.
    pub fn open_questions(&self) -> app::Result<Vec<FeedItem>> {
        let mut open: Vec<FeedItem> = self
            .messages
            .entries()?
            .filter(|(_, m)| {
                m.from == FROM_YOU
                    && matches!(
                        current(&m.history).status.as_str(),
                        STATUS_WAITING | STATUS_THINKING
                    )
            })
            .map(|(_, m)| Self::message_item(&m))
            .collect();
        open.sort_by(|a, b| a.at.cmp(&b.at).then_with(|| a.id.cmp(&b.id)));
        Ok(open)
    }

    // ── your side ────────────────────────────────────────────────────────────

    /// Talk to your agent: about a chain (`chain` = its id), or about
    /// anything (`chain` empty, which starts a new chain). Your agent picks it
    /// up, answers in the chain, and may propose or act there under your rules.
    pub fn say(&mut self, chain: String, text: String) -> app::Result<FeedItem> {
        self.require_owner()?;
        Self::check_len("chain", &chain, MAX_KEY, false)?;
        Self::check_len("text", &text, MAX_MESSAGE, true)?;
        if !chain.is_empty() && !self.chain_exists(&chain)? {
            return Err(AppError::msg(format!("no chain {chain}")));
        }
        self.post_message(chain, FROM_YOU, text, String::new(), STATUS_WAITING)
    }

    /// Approve or decline a proposal, retry or drop a failure, ask for an
    /// undo, or keep an action the agent took without asking.
    ///
    /// `answer` goes with an approval when the proposal has an [`Ask`]: one of
    /// its options for `choose`, the text to send for `reply` (the agent's
    /// draft, edited or not). Every other decision takes `""`.
    pub fn resolve_action(
        &mut self,
        id: String,
        decision: String,
        answer: String,
    ) -> app::Result<FeedItem> {
        self.require_owner()?;
        Self::check_one_of("decision", &decision, DECISIONS)?;
        let mut action = self.get_action(&id)?;
        let status_now = current(&action.history).status.clone();

        if decision == "keep" {
            if action.breach.is_empty() || action.reviewed {
                return Err(AppError::msg(format!("action {id} has nothing to keep")));
            }
            if !answer.is_empty() {
                return Err(AppError::msg("keep takes no answer"));
            }
            action.reviewed = true;
            action.reviewed_at = Self::next_at(&action.history);
            let item = Self::action_item(&action);
            self.actions.insert(action.id.clone(), action)?;
            app::emit!(Event::ActionChanged {
                id: &item.id,
                status: &item.status,
            });
            return Ok(item);
        }

        let note = match (status_now.as_str(), decision.as_str()) {
            (STATUS_PENDING, "approve") => Self::check_answer(&action.ask, &answer)?,
            _ if !answer.is_empty() => {
                return Err(AppError::msg(format!("{decision} takes no answer")))
            }
            _ => String::new(),
        };
        let status = match (status_now.as_str(), decision.as_str()) {
            (STATUS_PENDING, "approve") => STATUS_APPROVED,
            (STATUS_FAILED, "approve") => STATUS_RETRYING,
            (STATUS_PENDING | STATUS_FAILED, "decline") => STATUS_DECLINED,
            (STATUS_DONE, "undo") if action.undoable => STATUS_UNDO_REQUESTED,
            (STATUS_DONE, "undo") => {
                return Err(AppError::msg(format!("action {id} cannot be undone")))
            }
            _ => {
                return Err(AppError::msg(format!(
                    "cannot {decision} an action that is {status_now}"
                )))
            }
        };
        // Deciding on an action is reviewing it.
        if !action.reviewed && !action.breach.is_empty() {
            action.reviewed_at = Self::next_at(&action.history);
        }
        action.reviewed = true;
        self.push_step(action, status, note)
    }

    /// Answer a notification from the feed: the reply to send, the option you
    /// picked, or `""` to confirm. Your agent carries it out in the source app
    /// and reports with [`Hyperfeed::complete_answer`]. A failed delivery can be
    /// answered again.
    pub fn answer_notification(&mut self, id: String, answer: String) -> app::Result<FeedItem> {
        self.require_owner()?;
        let mut n = self.get_notification(&id)?;
        if n.ask.kind.is_empty() {
            return Err(AppError::msg(format!(
                "notification {id} has nothing to answer; open it in its app"
            )));
        }
        let status = current(&n.history).status.clone();
        if !matches!(status.as_str(), STATUS_RECEIVED | STATUS_FAILED) {
            return Err(AppError::msg(format!(
                "notification {id} is already {status}"
            )));
        }
        let note = Self::check_answer(&n.ask, &answer)?;
        // Answering it is reading it.
        if !n.seen {
            n.seen = true;
            n.seen_at = now_ms();
        }
        self.push_notification_step(n, STATUS_ANSWERED, note)
    }

    /// Record a notification your client saw.
    ///
    /// Every device records what it sees, and the same event arrives under the
    /// same key on each, so a key already recorded within
    /// [`DEDUPE_WINDOW_MS`] returns that row and records nothing. The same key
    /// later is a new event — the source context came back to a state it had
    /// been in — and is stored as `<key>#1`, `<key>#2`, … Two devices reporting
    /// that occurrence derive the same id, so their rows still merge.
    pub fn record_notification(&mut self, input: NotificationInput) -> app::Result<FeedItem> {
        self.require_owner()?;
        Self::check_len("key", &input.key, MAX_KEY, true)?;
        Self::check_app(&input.app)?;
        Self::check_len("source_context", &input.source_context, MAX_KEY, false)?;
        Self::check_len("source_label", &input.source_label, MAX_SHORT, false)?;
        Self::check_len("from", &input.from, MAX_SHORT, false)?;
        Self::check_len("title", &input.title, MAX_TITLE, true)?;
        Self::check_len("body", &input.body, MAX_BODY, false)?;
        Self::check_len("event", &input.event, MAX_SHORT, false)?;
        Self::check_ask(&input.ask)?;

        let now = now_ms();
        let id = match self.occurrence_of(&input.key, now)? {
            Occurrence::Seen(existing) => return Ok(Self::notification_item(&existing)),
            Occurrence::New(id) => id,
        };
        let n = Notification {
            chain: Self::chain_of(&input.chain, &id)?,
            id,
            app: input.app,
            source_context: input.source_context,
            source_label: input.source_label,
            from: input.from,
            title: input.title,
            body: input.body,
            event: input.event,
            needs_you: input.needs_you,
            created_at: now,
            ask: input.ask,
            seen: false,
            seen_at: 0,
            history: vec![Step {
                status: STATUS_RECEIVED.to_owned(),
                note: String::new(),
                at: now,
            }],
        };
        let item = Self::notification_item(&n);
        self.notifications.insert(n.id.clone(), n)?;
        app::emit!(Event::NotificationRecorded { id: &item.id });
        Ok(item)
    }

    /// Mark notifications seen. Unknown ids are skipped; returns how many
    /// changed.
    pub fn mark_seen(&mut self, ids: Vec<String>) -> app::Result<u32> {
        self.require_owner()?;
        let now = now_ms();
        let mut count = 0u32;
        for id in ids {
            let Some(n) = self.notifications.get(&id)?.map(|n| n.clone()) else {
                continue;
            };
            if n.seen {
                continue;
            }
            let mut n = n;
            n.seen = true;
            n.seen_at = now;
            self.notifications.insert(id, n)?;
            count += 1;
        }
        if count > 0 {
            app::emit!(Event::NotificationsSeen { count });
        }
        Ok(count)
    }

    /// Mark every notification seen.
    pub fn mark_all_seen(&mut self) -> app::Result<u32> {
        self.require_owner()?;
        let unseen: Vec<String> = self
            .notifications
            .entries()?
            .filter(|(_, n)| !n.seen)
            .map(|(id, _)| id)
            .collect();
        self.mark_seen(unseen)
    }

    pub fn set_policy(
        &mut self,
        app_key: String,
        agent: String,
        notifications: String,
    ) -> app::Result<PolicyView> {
        self.require_owner()?;
        Self::check_app(&app_key)?;
        Self::check_one_of("agent", &agent, AGENT_MODES)?;
        Self::check_one_of("notifications", &notifications, NOTIFICATION_MODES)?;
        let updated_at = match self.policies.get(&app_key)? {
            Some(p) => now_ms().max(p.updated_at + 1),
            None => now_ms(),
        };
        let policy = Policy {
            app: app_key.clone(),
            agent,
            notifications,
            updated_at,
        };
        self.policies.insert(app_key.clone(), policy)?;
        app::emit!(Event::SettingsChanged);
        self.policy_for(&app_key)
    }

    pub fn set_guard(&mut self, category: String, enabled: bool) -> app::Result<()> {
        self.require_owner()?;
        Self::check_category(&category)?;
        if category.is_empty() {
            return Err(AppError::msg("category must not be empty"));
        }
        let updated_at = match self.guards.get(&category)? {
            Some(g) => now_ms().max(g.updated_at + 1),
            None => now_ms(),
        };
        self.guards.insert(
            category.clone(),
            Guard {
                category,
                enabled,
                updated_at,
            },
        )?;
        app::emit!(Event::SettingsChanged);
        Ok(())
    }

    /// Pause the agent: every write it wants to make becomes a proposal.
    pub fn set_paused(&mut self, paused: bool) -> app::Result<()> {
        self.require_owner()?;
        let updated_at = match self.agent.get("main")? {
            Some(a) => now_ms().max(a.updated_at + 1),
            None => now_ms(),
        };
        self.agent
            .insert("main".to_owned(), AgentState { paused, updated_at })?;
        app::emit!(Event::SettingsChanged);
        Ok(())
    }

    // ── reads ────────────────────────────────────────────────────────────────

    /// Every row, muted apps' notifications excluded unless `include_muted`.
    fn all_items(&self, include_muted: bool) -> app::Result<Vec<FeedItem>> {
        let muted: Vec<String> = if include_muted {
            Vec::new()
        } else {
            self.policies
                .entries()?
                .filter(|(_, p)| p.notifications == "mute")
                .map(|(k, _)| k)
                .collect()
        };
        let mut all: Vec<FeedItem> = self
            .actions
            .entries()?
            .map(|(_, a)| Self::action_item(&a))
            .collect();
        all.extend(
            self.notifications
                .entries()?
                .filter(|(_, n)| !muted.contains(&n.app))
                .map(|(_, n)| Self::notification_item(&n)),
        );
        // A conversation is never muted: you started it.
        all.extend(
            self.messages
                .entries()?
                .map(|(_, m)| Self::message_item(&m)),
        );
        Ok(all)
    }

    /// The feed: one row per chain, newest activity first.
    ///
    /// A row is the chain's **lead**: the latest step that needs you if any
    /// does, otherwise the latest row. Its `chain_len` says how many rows the
    /// chain holds and `needs_you` whether any of them needs you; read them all
    /// with [`Hyperfeed::chain`].
    ///
    /// `filter` keeps chains holding an action (`agent`), a notification
    /// (`notifications`), or something that needs you (`needs_you`); `app_key`
    /// keeps chains that touch that app; `before` pages by `chain_at` (0 = from
    /// the newest). The counts are over chains, for the whole feed.
    pub fn feed(
        &self,
        filter: String,
        app_key: String,
        limit: u32,
        before: u64,
    ) -> app::Result<FeedPage> {
        Self::check_one_of("filter", &filter, FILTERS)?;
        let limit = match limit {
            0 => DEFAULT_PAGE,
            n => n.min(MAX_PAGE),
        } as usize;

        let mut chains: Vec<(String, Vec<FeedItem>)> = Vec::new();
        for item in self.all_items(false)? {
            match chains.iter_mut().find(|(c, _)| *c == item.chain) {
                Some((_, items)) => items.push(item),
                None => chains.push((item.chain.clone(), vec![item])),
            }
        }

        let mut counts = FeedCounts {
            all: 0,
            agent: 0,
            notifications: 0,
            needs_you: 0,
        };
        let mut apps: Vec<AppCount> = Vec::new();
        let mut rows: Vec<(FeedItem, bool, bool, Vec<String>)> = Vec::new();
        for (_, items) in chains {
            // A conversation with your agent counts as agent activity.
            let has_action = items
                .iter()
                .any(|i| i.kind == KIND_ACTION || i.kind == KIND_MESSAGE);
            let has_notification = items.iter().any(|i| i.kind == KIND_NOTIFICATION);
            let needs = items.iter().any(|i| i.needs_you);
            let chain_at = items.iter().map(|i| i.chain_at).max().unwrap_or(0);
            let mut chain_apps: Vec<String> = items
                .iter()
                .filter(|i| !i.app.is_empty())
                .map(|i| i.app.clone())
                .collect();
            chain_apps.sort();
            chain_apps.dedup();

            let by_time =
                |a: &&FeedItem, b: &&FeedItem| a.at.cmp(&b.at).then_with(|| a.id.cmp(&b.id));
            let lead = items
                .iter()
                .filter(|i| i.needs_you)
                .max_by(by_time)
                .or_else(|| items.iter().max_by(by_time))
                .expect("a chain has at least one row");
            let mut lead = lead.clone();
            lead.chain_len = u32::try_from(items.len()).unwrap_or(u32::MAX);
            lead.chain_at = chain_at;
            lead.needs_you = needs;

            counts.all += 1;
            counts.agent += u32::from(has_action);
            counts.notifications += u32::from(has_notification);
            counts.needs_you += u32::from(needs);
            for app in &chain_apps {
                match apps.iter_mut().find(|a| a.app == *app) {
                    Some(a) => a.count += 1,
                    None => apps.push(AppCount {
                        app: app.clone(),
                        count: 1,
                    }),
                }
            }
            rows.push((lead, has_action, has_notification, chain_apps));
        }
        apps.sort_by(|a, b| b.count.cmp(&a.count).then_with(|| a.app.cmp(&b.app)));

        let mut items: Vec<FeedItem> = rows
            .into_iter()
            .filter(
                |(lead, has_action, has_notification, _)| match filter.as_str() {
                    "agent" => *has_action,
                    "notifications" => *has_notification,
                    "needs_you" => lead.needs_you,
                    _ => true,
                },
            )
            .filter(|(_, _, _, chain_apps)| app_key.is_empty() || chain_apps.contains(&app_key))
            .map(|(lead, ..)| lead)
            .filter(|lead| before == 0 || lead.chain_at < before)
            .collect();
        // Newest activity first; the chain id breaks ties so every device
        // pages identically.
        items.sort_by(|a, b| {
            b.chain_at
                .cmp(&a.chain_at)
                .then_with(|| b.chain.cmp(&a.chain))
        });

        let next_before = if items.len() > limit {
            items[limit - 1].chain_at
        } else {
            0
        };
        items.truncate(limit);

        Ok(FeedPage {
            items,
            counts,
            apps,
            next_before,
        })
    }

    /// Every row in a chain, oldest first: the whole flow, muted apps included.
    pub fn chain(&self, chain: String) -> app::Result<Vec<FeedItem>> {
        Self::check_len("chain", &chain, MAX_KEY, true)?;
        let mut items: Vec<FeedItem> = self
            .all_items(true)?
            .into_iter()
            .filter(|i| i.chain == chain)
            .collect();
        items.sort_by(|a, b| a.at.cmp(&b.at).then_with(|| a.id.cmp(&b.id)));
        let len = u32::try_from(items.len()).unwrap_or(u32::MAX);
        let chain_at = items.iter().map(|i| i.chain_at).max().unwrap_or(0);
        for item in &mut items {
            item.chain_len = len;
            item.chain_at = chain_at;
        }
        Ok(items)
    }

    /// One row, by id, whichever kind it is.
    pub fn item(&self, id: String) -> app::Result<Option<FeedItem>> {
        if let Some(a) = self.actions.get(&id)? {
            return Ok(Some(Self::action_item(&a)));
        }
        if let Some(n) = self.notifications.get(&id)? {
            return Ok(Some(Self::notification_item(&n)));
        }
        Ok(self.messages.get(&id)?.map(|m| Self::message_item(&m)))
    }

    /// Your rules: the pause switch, every app you set a policy for, and
    /// every guard (defaults included).
    pub fn settings(&self) -> app::Result<SettingsView> {
        let mut policies: Vec<PolicyView> = self
            .policies
            .entries()?
            .map(|(_, p)| PolicyView {
                app: p.app,
                agent: p.agent,
                notifications: p.notifications,
            })
            .collect();
        policies.sort_by(|a, b| a.app.cmp(&b.app));
        let mut guards = Vec::with_capacity(GUARDS.len());
        for (category, _) in GUARDS {
            guards.push(GuardView {
                category: (*category).to_owned(),
                enabled: self.guard_on(category)?,
            });
        }
        Ok(SettingsView {
            owner: self.owner.get().clone(),
            paused: self.is_paused()?,
            policies,
            guards,
        })
    }
}

/// What [`Hyperfeed::occurrence_of`] found for a notification key.
enum Occurrence {
    /// Already recorded inside the window: another device's report of it.
    Seen(Box<Notification>),
    /// A new event, to be stored under this id.
    New(String),
}

/// A message's first line, cut to a title's length on a character boundary.
fn headline(text: &str) -> String {
    let line = text.lines().next().unwrap_or("").trim();
    if line.len() <= MAX_TITLE {
        return line.to_owned();
    }
    let mut end = MAX_TITLE - '…'.len_utf8();
    while !line.is_char_boundary(end) {
        end -= 1;
    }
    format!("{}…", &line[..end])
}

fn outcome_status(outcome: &str) -> &'static str {
    if outcome == "failed" {
        STATUS_FAILED
    } else {
        STATUS_DONE
    }
}
