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
//! Answering a proposal "Allow for this session" lets the agent go on without
//! asking in that app: what it does next carries the proposal's id as its
//! `grant`, and for 12 hours the app's Ask mode is satisfied by it. A pause, a
//! guard, Read only and Off are not.
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
//! per chain, led by whatever in it needs you (else whatever is still underway),
//! and [`Hyperfeed::chain`] returns
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

mod checkpoint;
pub use checkpoint::{
    Checkpoint, CheckpointInput, CheckpointView, MAX_CHECKPOINT_AUTHOR, MAX_CHECKPOINT_ENTRIES,
    MAX_CHECKPOINT_ENTRY, MAX_CHECKPOINT_TEXT,
};

mod watches;
pub use watches::{
    Watch, WatchInput, WatchView, MAX_ACTIVE_WATCHES, WATCH_ACTIONS, WATCH_CANCELLED,
    WATCH_CONDITIONS, WATCH_DONE, WATCH_FAILED, WATCH_FIRING, WATCH_WATCHING,
};

mod prs;
pub use prs::{PrInput, PrSeen, PrView, CHECK_STATES, MAX_FAILING, MAX_PRS, PR_STATES};

mod links;
pub use links::{
    split_subject, Link, LinkInput, LinkView, FROM_SUBJECT, LINK_BY, MAX_LINKS, TASK_SUBJECT,
};

mod push;
pub use push::{
    PushDevice, PushDeviceInput, PushDeviceView, PushKey, PushKeyView, MAX_PUSH_DEVICES,
    MAX_PUSH_ENDPOINT, MAX_PUSH_KEY,
};

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
/// A typed notification's fields, and the call that answers it, as JSON.
const MAX_FIELDS: usize = 4_000;
/// One app's lens: how its events become feed items. Written once per app
/// version, read on every event.
const MAX_LENS: usize = 32_000;
/// One message to or from your agent: a question, an instruction, an answer.
/// A message with a headline may run to [`MAX_LONG_MESSAGE`].
const MAX_MESSAGE: usize = 2_000;
/// A message's headline: one line the feed row shows, in characters.
const MAX_HEADLINE: usize = 80;
/// A message's text when it has a headline: a long answer, a report, a list.
/// The row shows the headline; the text is behind "more" and in the chat.
const MAX_LONG_MESSAGE: usize = 32_000;
/// Images on one message of yours. The bytes are node blobs; the feed keeps
/// only what points at them.
const MAX_ATTACHMENTS: usize = 4;
const MAX_IMAGE_BYTES: u64 = 10 * 1024 * 1024;
/// The shortest and longest lease a session may take on a chain at once. It
/// renews while it works, so a session that dies lets go within one lease.
pub const MIN_LEASE_MS: u64 = 1_000;
pub const MAX_LEASE_MS: u64 = 10 * 60 * 1_000;

/// One standing rule: a short line your agent keeps to on every turn.
const MAX_RULE: usize = 280;
/// Standing rules in force at once: each one goes into every turn's prompt.
const MAX_RULES: usize = 30;
/// Rules your agent suggested that wait for you at once.
const MAX_RULE_PROPOSALS: usize = 20;
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

/// The answer that allows a proposal for the rest of a session, not just once.
/// An agent passes the proposal's id as the `grant` of what it runs afterwards.
pub const SESSION_GRANT: &str = "Allow for this session";

/// How long "Allow for this session" counts, from when you allowed it. An agent
/// that keeps running past it asks you again.
pub const GRANT_WINDOW_MS: u64 = 12 * 60 * 60 * 1_000;

// ── Vocabularies ─────────────────────────────────────────────────────────────

/// What the agent may do in one app. `act` = without asking, `ask` = propose
/// and wait, `read` = read only, `off` = nothing at all.
pub const AGENT_MODES: &[&str] = &["act", "ask", "read", "off"];
/// The mode for an app nobody has set a policy for. Asking is the only safe
/// default: an agent that discovers a new app should not get to act in it.
pub const DEFAULT_AGENT_MODE: &str = "ask";
/// How private a message of yours is, which says which of your agents takes
/// it: `private`, for an agent whose model runs where no operator can read it
/// (an attested TEE), or `public`, for any agent you configured (one with your
/// repositories and tools, say). Your agent's runtime maps each to an agent.
/// Not [`AGENT_MODES`], which say how freely the agent may act in an app.
pub const MESSAGE_MODES: &[&str] = &["private", "public"];
/// Folders one agent may be given, and the length of one folder's path.
const MAX_FOLDERS: usize = 20;
const MAX_PATH: usize = 1_024;
/// Lines in one agent's report of what it can reach: one per agent profile it runs.
const MAX_REACH: usize = 16;

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
/// Your agent's message that asks you something: it needs you until you say
/// something in its chain, which marks it `answered`.
pub const STATUS_ASKED: &str = "asked";

/// The statuses of a step in your agent's turn on a message. See [`TurnStep`].
pub const STEP_STATUSES: [&str; 4] = ["running", "waiting", "done", "failed"];
/// The note on a message whose turn you stopped.
pub const STOPPED_BY_YOU: &str = "Stopped by you";

/// Who wrote a message.
pub const FROM_YOU: &str = "you";
pub const FROM_AGENT: &str = "agent";

/// How a row is best resolved. Empty: nothing beyond the defaults (approve or
/// decline a proposal; open a notification).
pub const ASK_KINDS: &[&str] = &["", "confirm", "reply", "choose"];

/// What a notification is, so the feed can show it as one: a typed
/// notification carries the fields its card needs. `""` is an untyped row.
pub const ITEM_TYPES: &[&str] = &[
    "",
    "message",
    "assignment",
    "poll",
    "invite",
    "turn",
    "request",
    "change",
    "status",
    "other",
];

/// What an attachment may be: images your agent can look at.
pub const IMAGE_TYPES: &[&str] = &["image/png", "image/jpeg", "image/webp", "image/gif"];

/// A lens waits for you, then is in use or turned down.
pub const LENS_PROPOSED: &str = "proposed";
pub const LENS_APPROVED: &str = "approved";
pub const LENS_REJECTED: &str = "rejected";

/// A rule your agent suggested waits for you, then is added or dismissed.
pub const RULE_PROPOSED: &str = "proposed";
pub const RULE_APPROVED: &str = "approved";
pub const RULE_DISMISSED: &str = "dismissed";

pub const KIND_ACTION: &str = "action";
pub const KIND_NOTIFICATION: &str = "notification";
pub const KIND_MESSAGE: &str = "message";

const FILTERS: &[&str] = &["all", "agent", "notifications", "needs_you", "archived"];
/// How many chains one `archive` or `unarchive` call may name.
const MAX_ARCHIVE: usize = 200;

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

/// What a lens made of a notification: its type, the fields its card shows,
/// and the call that answers it in its app. Kept beside the notification, keyed
/// by its id, so rows recorded before lenses existed keep their layout.
#[app::mergeable(id = "hyperfeed::Typed")]
#[derive(
    AbiType, Debug, Clone, PartialEq, BorshSerialize, BorshDeserialize, Serialize, Deserialize,
)]
#[borsh(crate = "calimero_sdk::borsh")]
#[serde(crate = "calimero_sdk::serde")]
pub struct Typed {
    /// One of [`ITEM_TYPES`].
    pub item_type: String,
    /// A JSON object: the fields of that type (`from`, `text`, `options`, …).
    pub fields: String,
    /// A JSON object `{ "method", "args" }`: what your client calls in the
    /// source context to answer, with `"=$answer"` where your answer goes.
    /// Empty: answered by your agent, or not answerable from the feed.
    pub reply_call: String,
}

impl Mergeable for Typed {
    fn merge(&mut self, other: &Self) -> Result<(), MergeError> {
        // Written once with its notification; two devices that typed the same
        // event differently settle on the same one everywhere.
        if borsh::to_vec(other).unwrap_or_default() > borsh::to_vec(self).unwrap_or_default() {
            *self = other.clone();
        }
        Ok(())
    }
}

/// What your agent asked you in a message, kept beside it by the message's
/// id, so messages written before agents could ask keep their layout.
#[app::mergeable(id = "hyperfeed::Asked")]
#[derive(AbiType, Debug, Clone, BorshSerialize, BorshDeserialize, Serialize, Deserialize)]
#[borsh(crate = "calimero_sdk::borsh")]
#[serde(crate = "calimero_sdk::serde")]
pub struct Asked {
    pub ask: Ask,
}

impl Mergeable for Asked {
    fn merge(&mut self, other: &Self) -> Result<(), MergeError> {
        // Written once with its message, never changed.
        if borsh::to_vec(other).unwrap_or_default() > borsh::to_vec(self).unwrap_or_default() {
            *self = other.clone();
        }
        Ok(())
    }
}

/// A message's headline: one line for the feed row, its text behind "more".
/// Kept beside the message, keyed by its id, so messages written before
/// headlines keep their layout.
#[app::mergeable(id = "hyperfeed::Headline")]
#[derive(AbiType, Debug, Clone, BorshSerialize, BorshDeserialize, Serialize, Deserialize)]
#[borsh(crate = "calimero_sdk::borsh")]
#[serde(crate = "calimero_sdk::serde")]
pub struct Headline {
    pub text: String,
}

impl Mergeable for Headline {
    fn merge(&mut self, other: &Self) -> Result<(), MergeError> {
        // Written once with its message, never changed.
        if other.text > self.text {
            self.text = other.text.clone();
        }
        Ok(())
    }
}

/// How private a message of yours is: one of [`MESSAGE_MODES`].
/// Kept beside the message, keyed by its id, so messages written before
/// modes keep their layout.
#[app::mergeable(id = "hyperfeed::MessageMode")]
#[derive(AbiType, Debug, Clone, BorshSerialize, BorshDeserialize, Serialize, Deserialize)]
#[borsh(crate = "calimero_sdk::borsh")]
#[serde(crate = "calimero_sdk::serde")]
pub struct MessageMode {
    pub mode: String,
}

impl Mergeable for MessageMode {
    fn merge(&mut self, other: &Self) -> Result<(), MergeError> {
        // Written once with its message, never changed.
        if other.mode > self.mode {
            self.mode = other.mode.clone();
        }
        Ok(())
    }
}

/// An image on a message: a blob on your node, announced to the feed's
/// context, and what the client needs to show it before fetching it.
#[derive(
    AbiType, Debug, Clone, PartialEq, BorshSerialize, BorshDeserialize, Serialize, Deserialize,
)]
#[borsh(crate = "calimero_sdk::borsh")]
#[serde(crate = "calimero_sdk::serde")]
pub struct Attachment {
    pub blob_id: String,
    /// The file's name as you picked it; may be empty for a pasted image.
    pub name: String,
    /// One of [`IMAGE_TYPES`].
    pub mime: String,
    /// Bytes, at most 10 MiB.
    pub size: u64,
}

/// A message's attachments. Kept beside the message, keyed by its id, so
/// messages written before attachments existed keep their layout.
#[app::mergeable(id = "hyperfeed::Attachments")]
#[derive(
    AbiType, Debug, Clone, PartialEq, BorshSerialize, BorshDeserialize, Serialize, Deserialize,
)]
#[borsh(crate = "calimero_sdk::borsh")]
#[serde(crate = "calimero_sdk::serde")]
pub struct Attachments {
    pub items: Vec<Attachment>,
}

impl Mergeable for Attachments {
    fn merge(&mut self, other: &Self) -> Result<(), MergeError> {
        // Written once with its message, never changed.
        if borsh::to_vec(other).unwrap_or_default() > borsh::to_vec(self).unwrap_or_default() {
            *self = other.clone();
        }
        Ok(())
    }
}

/// How one app version's events become feed items, as your agent learned it
/// from the app's ABI. Nothing uses a lens until you approve it.
#[app::mergeable(id = "hyperfeed::Lens")]
#[derive(AbiType, Debug, Clone, BorshSerialize, BorshDeserialize, Serialize, Deserialize)]
#[borsh(crate = "calimero_sdk::borsh")]
#[serde(crate = "calimero_sdk::serde")]
pub struct Lens {
    pub app: String,
    /// The app version it was learned from: a new version is learned again.
    pub application_id: String,
    /// The lens itself, JSON (see the app's `lens` module).
    pub spec: String,
    /// One line for you: what it records and how it answers.
    pub summary: String,
    /// [`LENS_PROPOSED`], [`LENS_APPROVED`] or [`LENS_REJECTED`].
    pub status: String,
    pub updated_at: u64,
}

impl Mergeable for Lens {
    fn merge(&mut self, other: &Self) -> Result<(), MergeError> {
        let at = self.updated_at;
        lww(self, at, other, other.updated_at);
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

/// A chain you put away. It stays out of the feed until something new
/// happens in it, or until `until` passes ("later"); `until` 0 has no return
/// time. Unarchiving keeps the row with `archived: false`, so the latest
/// decision wins on every device.
#[app::mergeable(id = "hyperfeed::Archived")]
#[derive(AbiType, Debug, Clone, BorshSerialize, BorshDeserialize, Serialize, Deserialize)]
#[borsh(crate = "calimero_sdk::borsh")]
#[serde(crate = "calimero_sdk::serde")]
pub struct Archived {
    pub archived: bool,
    /// The chain's latest activity when it was put away: anything newer brings it back.
    pub at: u64,
    pub until: u64,
    pub updated_at: u64,
}

impl Mergeable for Archived {
    fn merge(&mut self, other: &Self) -> Result<(), MergeError> {
        let at = self.updated_at;
        lww(self, at, other, other.updated_at);
        Ok(())
    }
}

/// What a row is about in another app, as a key: `<app>:<context>`, plus
/// `:<id>` for one thing in it (an issue, a doc, a thread). Kept two ways: by
/// the action's id (what it touched), and by the key (the chain that touched
/// it last), so a notification about the same thing joins that chain. See
/// [`subject_key`].
#[app::mergeable(id = "hyperfeed::Subject")]
#[derive(AbiType, Debug, Clone, BorshSerialize, BorshDeserialize, Serialize, Deserialize)]
#[borsh(crate = "calimero_sdk::borsh")]
#[serde(crate = "calimero_sdk::serde")]
pub struct Subject {
    pub subject: String,
    pub chain: String,
    pub at: u64,
}

impl Mergeable for Subject {
    fn merge(&mut self, other: &Self) -> Result<(), MergeError> {
        let at = self.at;
        lww(self, at, other, other.at);
        Ok(())
    }
}

/// The args that name the one thing a call is about, first match wins. A call
/// with none of them is about its whole context (a chat, a board). mero-bot
/// keys the agent's writes with the same list: change both or neither.
pub const SUBJECT_ARGS: &[&str] = &["issue_id", "doc_id", "thread_id"];

/// The subject key for `id` in `app`'s `context`; `""` with no context, or
/// when the key would not fit.
pub fn subject_key(app: &str, context: &str, id: &str) -> String {
    if app.is_empty() || context.is_empty() {
        return String::new();
    }
    let key = if id.is_empty() {
        format!("{app}:{context}")
    } else {
        format!("{app}:{context}:{id}")
    };
    if key.len() > MAX_KEY {
        String::new()
    } else {
        key
    }
}

/// What a notification is about: the thing its reply goes to. One you cannot
/// answer from the feed has none, and starts a chain of its own.
fn reply_subject(app: &str, context: &str, reply_call: &str) -> String {
    let Ok(calimero_sdk::serde_json::Value::Object(call)) =
        calimero_sdk::serde_json::from_str::<calimero_sdk::serde_json::Value>(reply_call)
    else {
        return String::new();
    };
    let args = call.get("args").and_then(|a| a.as_object());
    let id = SUBJECT_ARGS
        .iter()
        .find_map(|k| {
            args.and_then(|a| a.get(*k))
                .and_then(|v| v.as_str())
                .filter(|s| !s.is_empty())
        })
        .unwrap_or("");
    subject_key(app, context, id)
}

/// When an agent last said it was running, by its name.
#[app::mergeable(id = "hyperfeed::Presence")]
#[derive(AbiType, Debug, Clone, BorshSerialize, BorshDeserialize, Serialize, Deserialize)]
#[borsh(crate = "calimero_sdk::borsh")]
#[serde(crate = "calimero_sdk::serde")]
pub struct Presence {
    pub seen_at: u64,
}

impl Mergeable for Presence {
    fn merge(&mut self, other: &Self) -> Result<(), MergeError> {
        self.seen_at = self.seen_at.max(other.seen_at);
        Ok(())
    }
}

/// A folder an agent may use on its computer: an absolute path, or one under
/// `~`, and whether it may write there too.
#[derive(
    AbiType, Debug, Clone, PartialEq, BorshSerialize, BorshDeserialize, Serialize, Deserialize,
)]
#[borsh(crate = "calimero_sdk::borsh")]
#[serde(crate = "calimero_sdk::serde")]
pub struct Folder {
    pub path: String,
    pub write: bool,
}

/// What you let one agent reach on its computer, beyond your Calimero apps:
/// these folders, a shell, the web. Yours to set (`set_access`); the agent's
/// runtime enforces it before any tool runs, and an agent with none set keeps
/// its runtime's default.
#[app::mergeable(id = "hyperfeed::Access")]
#[derive(AbiType, Debug, Clone, BorshSerialize, BorshDeserialize, Serialize, Deserialize)]
#[borsh(crate = "calimero_sdk::borsh")]
#[serde(crate = "calimero_sdk::serde")]
pub struct Access {
    pub folders: Vec<Folder>,
    pub shell: bool,
    pub web: bool,
    pub updated_at: u64,
}

impl Mergeable for Access {
    fn merge(&mut self, other: &Self) -> Result<(), MergeError> {
        let at = self.updated_at;
        lww(self, at, other, other.updated_at);
        Ok(())
    }
}

/// One agent profile an agent runs, as it reports it: which mode or route
/// it serves, its model, whether its model is attested, and what it can reach
/// besides your Calimero apps.
#[derive(
    AbiType, Debug, Clone, PartialEq, BorshSerialize, BorshDeserialize, Serialize, Deserialize,
)]
#[borsh(crate = "calimero_sdk::borsh")]
#[serde(crate = "calimero_sdk::serde")]
pub struct ReachLine {
    /// What it runs: a message mode (`private`, `public`) or `default`.
    pub serves: String,
    pub profile: String,
    pub model: String,
    pub attested: bool,
    pub folders: Vec<Folder>,
    pub shell: bool,
    pub web: bool,
}

/// What one agent reported it can reach, latest report wins.
#[app::mergeable(id = "hyperfeed::Reach")]
#[derive(AbiType, Debug, Clone, BorshSerialize, BorshDeserialize, Serialize, Deserialize)]
#[borsh(crate = "calimero_sdk::borsh")]
#[serde(crate = "calimero_sdk::serde")]
pub struct Reach {
    pub lines: Vec<ReachLine>,
    pub at: u64,
}

impl Mergeable for Reach {
    fn merge(&mut self, other: &Self) -> Result<(), MergeError> {
        let at = self.at;
        lww(self, at, other, other.at);
        Ok(())
    }
}

/// What you let one agent reach, as settings shows it.
#[derive(AbiType, Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(crate = "calimero_sdk::serde")]
pub struct AccessView {
    pub agent: String,
    pub folders: Vec<Folder>,
    pub shell: bool,
    pub web: bool,
    pub updated_at: u64,
}

/// What one agent reported it can reach, as settings shows it.
#[derive(AbiType, Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(crate = "calimero_sdk::serde")]
pub struct ReachView {
    pub agent: String,
    pub lines: Vec<ReachLine>,
    pub at: u64,
}

/// What your agent is doing right now for one of your messages: its latest
/// step, replaced by the next one. Kept beside the message by id, never in its
/// history, so a long turn adds no rows.
#[app::mergeable(id = "hyperfeed::Progress")]
#[derive(AbiType, Debug, Clone, BorshSerialize, BorshDeserialize, Serialize, Deserialize)]
#[borsh(crate = "calimero_sdk::borsh")]
#[serde(crate = "calimero_sdk::serde")]
pub struct Progress {
    pub doing: String,
    pub at: u64,
}

impl Mergeable for Progress {
    fn merge(&mut self, other: &Self) -> Result<(), MergeError> {
        let at = self.at;
        lww(self, at, other, other.at);
        Ok(())
    }
}

/// One step of your agent's turn on a message of yours: a tool it ran, a file
/// it edited, a write it made. Shown in the message's work block, never as a
/// row of its own.
#[derive(
    AbiType, Debug, Clone, PartialEq, Eq, BorshSerialize, BorshDeserialize, Serialize, Deserialize,
)]
#[borsh(crate = "calimero_sdk::borsh")]
#[serde(crate = "calimero_sdk::serde")]
pub struct TurnStep {
    /// The agent's own id for the step, unique within the turn.
    pub id: String,
    /// What it is doing, in words: "Editing ChatView.tsx", "Running the tests".
    pub title: String,
    /// `running`, `waiting` (on your approval), `done` or `failed`.
    pub status: String,
    /// When the step started.
    pub at: u64,
}

/// Your agent's turn on one of your messages, as it goes: its steps, and the
/// answer it has written so far. Kept beside the message by id and replaced
/// whole by each report, so a long turn adds no rows.
#[app::mergeable(id = "hyperfeed::Work")]
#[derive(AbiType, Debug, Clone, BorshSerialize, BorshDeserialize, Serialize, Deserialize)]
#[borsh(crate = "calimero_sdk::borsh")]
#[serde(crate = "calimero_sdk::serde")]
pub struct Work {
    pub steps: Vec<TurnStep>,
    /// The answer so far, while the agent writes it; `""` before it starts.
    pub draft: String,
    pub at: u64,
}

impl Mergeable for Work {
    fn merge(&mut self, other: &Self) -> Result<(), MergeError> {
        let at = self.at;
        lww(self, at, other, other.at);
        Ok(())
    }
}

/// You asked your agent to stop working on one of your messages.
#[app::mergeable(id = "hyperfeed::StopRequest")]
#[derive(AbiType, Debug, Clone, BorshSerialize, BorshDeserialize, Serialize, Deserialize)]
#[borsh(crate = "calimero_sdk::borsh")]
#[serde(crate = "calimero_sdk::serde")]
pub struct StopRequest {
    pub at: u64,
}

impl Mergeable for StopRequest {
    fn merge(&mut self, other: &Self) -> Result<(), MergeError> {
        // The first request stands: a second one changes nothing.
        self.at = match (self.at, other.at) {
            (0, b) => b,
            (a, 0) => a,
            (a, b) => a.min(b),
        };
        Ok(())
    }
}

/// A question that a newer one in its chain replaced: your agent asked
/// again, or an app sent a new question, before you answered this one. Kept
/// beside the row by its id. Its buttons go; an answer that still reaches it
/// goes to your agent marked as answering an old question.
#[app::mergeable(id = "hyperfeed::Superseded")]
#[derive(AbiType, Debug, Clone, BorshSerialize, BorshDeserialize, Serialize, Deserialize)]
#[borsh(crate = "calimero_sdk::borsh")]
#[serde(crate = "calimero_sdk::serde")]
pub struct Superseded {
    /// The newer question's id.
    pub by: String,
    pub at: u64,
}

impl Mergeable for Superseded {
    fn merge(&mut self, other: &Self) -> Result<(), MergeError> {
        // The first replacement stands, on every device.
        if (other.at, &other.by) < (self.at, &self.by) {
            *self = other.clone();
        }
        Ok(())
    }
}

/// One of your standing rules: a short line your agent keeps to on every
/// turn ("Never push to main", "Answer in English"). Only you add or remove
/// one; removing keeps the row with `removed`, so the latest decision wins on
/// every device.
#[app::mergeable(id = "hyperfeed::Rule")]
#[derive(AbiType, Debug, Clone, BorshSerialize, BorshDeserialize, Serialize, Deserialize)]
#[borsh(crate = "calimero_sdk::borsh")]
#[serde(crate = "calimero_sdk::serde")]
pub struct Rule {
    pub text: String,
    pub created_at: u64,
    pub removed: bool,
    pub updated_at: u64,
}

impl Mergeable for Rule {
    fn merge(&mut self, other: &Self) -> Result<(), MergeError> {
        let at = self.updated_at;
        lww(self, at, other, other.updated_at);
        Ok(())
    }
}

/// The question of your agent's that one of your messages answers, when you
/// answered it from its buttons. Kept beside your message by its id.
#[app::mergeable(id = "hyperfeed::Answers")]
#[derive(AbiType, Debug, Clone, BorshSerialize, BorshDeserialize, Serialize, Deserialize)]
#[borsh(crate = "calimero_sdk::borsh")]
#[serde(crate = "calimero_sdk::serde")]
pub struct Answers {
    pub ask: String,
}

impl Mergeable for Answers {
    fn merge(&mut self, other: &Self) -> Result<(), MergeError> {
        // Written once with its message, never changed.
        if other.ask > self.ask {
            self.ask = other.ask.clone();
        }
        Ok(())
    }
}

/// Which agent session is working on a chain, until when. A session claims a
/// chain before it starts a turn there, renews the lease while it works, and
/// releases it at the end; another session is refused the chain until then,
/// or until the lease runs out (the session died). Kept by chain id.
#[app::mergeable(id = "hyperfeed::Lease")]
#[derive(AbiType, Debug, Clone, BorshSerialize, BorshDeserialize, Serialize, Deserialize)]
#[borsh(crate = "calimero_sdk::borsh")]
#[serde(crate = "calimero_sdk::serde")]
pub struct Lease {
    /// The session's own id: unique per running agent process.
    pub session: String,
    /// Who it is, in words: "mero-bot@studio".
    pub agent: String,
    /// When this session took the chain; kept while it renews.
    pub claimed_at: u64,
    /// When the lease runs out; 0 once released.
    pub expires_at: u64,
    pub updated_at: u64,
}

impl Mergeable for Lease {
    fn merge(&mut self, other: &Self) -> Result<(), MergeError> {
        let at = self.updated_at;
        lww(self, at, other, other.updated_at);
        Ok(())
    }
}

/// A rule your agent suggested after you corrected it. It changes nothing
/// until you approve it, which adds it as your own rule.
#[app::mergeable(id = "hyperfeed::RuleProposal")]
#[derive(AbiType, Debug, Clone, BorshSerialize, BorshDeserialize, Serialize, Deserialize)]
#[borsh(crate = "calimero_sdk::borsh")]
#[serde(crate = "calimero_sdk::serde")]
pub struct RuleProposal {
    pub text: String,
    /// Why your agent suggests it: the correction that led to it.
    pub why: String,
    /// The chain where you corrected it, or `""`.
    pub chain: String,
    /// [`RULE_PROPOSED`], [`RULE_APPROVED`] or [`RULE_DISMISSED`].
    pub status: String,
    pub created_at: u64,
    pub updated_at: u64,
}

impl Mergeable for RuleProposal {
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
    /// For an outcome: the id of a proposal in the same app you approved with
    /// "Allow for this session" (see [`SESSION_GRANT`]) in the last 12 hours.
    /// Under the app's Ask mode, it is recorded without a breach. Older agents
    /// omit it.
    #[serde(default)]
    pub grant: String,
    /// What it touched in the app, as [`subject_key`] makes it (`""` for
    /// nothing in particular). A notification about the same thing, with no
    /// chain of its own, joins this action's chain. Older agents omit it.
    #[serde(default)]
    pub subject: String,
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
    /// What a lens made of it: one of [`ITEM_TYPES`]. Older clients omit these.
    #[serde(default)]
    pub item_type: String,
    /// The type's fields, a JSON object.
    #[serde(default)]
    pub fields: String,
    /// The call that answers it in its app, a JSON object; see [`Typed`].
    #[serde(default)]
    pub reply_call: String,
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
    // ── typed notifications ──
    /// One of [`ITEM_TYPES`]; `""` for an untyped row.
    pub item_type: String,
    /// The type's fields, a JSON object, or `""`.
    pub fields: String,
    /// The call that answers it in its app, or `""`; see [`Typed`].
    pub reply_call: String,
    // ── a message your agent is working on ──
    /// Its latest step while the message is `thinking` ("Editing ChatView.tsx"), or `""`.
    #[serde(default)]
    pub doing: String,
    /// When that step started; 0 with no step.
    #[serde(default)]
    pub doing_at: u64,
    // ── messages with images ──
    /// Images on a message of yours; empty for every other row.
    #[serde(default)]
    pub attachments: Vec<Attachment>,
    // ── your agent's turn on a message of yours ──
    /// What your agent did for it, step by step; empty for every other row.
    #[serde(default)]
    pub steps: Vec<TurnStep>,
    /// The answer your agent has written so far, while the message is `thinking`; `""` otherwise.
    #[serde(default)]
    pub draft: String,
    /// When you asked your agent to stop working on it; 0 if you did not.
    #[serde(default)]
    pub stop_at: u64,
    // ── messages with a headline ──
    /// The headline the message was written with, which is also its `title`;
    /// `""` when it has none, and for every other row. Without one, `title`
    /// is the message's first line and a client may derive a shorter one.
    #[serde(default)]
    pub headline: String,
    // ── which agent a message of yours is for ──
    /// On a message of yours sent with a mode: `private` or `public` (see
    /// [`MESSAGE_MODES`]). `""` when it was sent without one, and for every
    /// other row; your agent's runtime then decides, usually by the chain's
    /// last message that had one.
    #[serde(default)]
    pub mode: String,
    // ── questions a newer one replaced ──
    /// On a question (your agent's, or a notification's) that a newer one in
    /// its chain replaced before you answered it: the newer one's id. Its
    /// buttons are gone. `""` otherwise.
    #[serde(default)]
    pub superseded_by: String,
    /// On a message of yours sent from a question's buttons: that question's
    /// id. `""` otherwise.
    #[serde(default)]
    pub answers: String,
    /// Whether the question it answers had been replaced by a newer one: your
    /// agent confirms against where things stand now before acting on it.
    #[serde(default)]
    pub answers_superseded: bool,
    // ── who is on the chain ──
    /// On a message: the agent whose session holds its chain right now
    /// ("mero-bot@studio"), or `""` when nobody does.
    #[serde(default)]
    pub held_by: String,
    /// Since when that session has held the chain; 0 when nobody does.
    #[serde(default)]
    pub held_since: u64,
    // ── what it is about ──
    /// On an action, what it touched; on a notification, what its reply goes
    /// to; see [`subject_key`]. `""` for nothing in particular.
    #[serde(default)]
    pub subject: String,
}

#[derive(AbiType, Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(crate = "calimero_sdk::serde")]
pub struct FeedCounts {
    pub all: u32,
    pub agent: u32,
    pub notifications: u32,
    pub needs_you: u32,
    /// Chains put away right now (shown only by the `archived` filter).
    pub archived: u32,
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
pub struct LensView {
    pub app: String,
    pub application_id: String,
    pub spec: String,
    pub summary: String,
    pub status: String,
    pub updated_at: u64,
}

#[derive(AbiType, Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(crate = "calimero_sdk::serde")]
pub struct SettingsView {
    pub owner: String,
    pub paused: bool,
    pub policies: Vec<PolicyView>,
    pub guards: Vec<GuardView>,
    /// Every agent that has reported in, most recent first.
    pub agents: Vec<AgentView>,
    /// Your standing rules, oldest first: your agent keeps to each on every turn.
    #[serde(default)]
    pub rules: Vec<RuleView>,
    /// Rules your agent suggested that wait for you, newest first.
    #[serde(default)]
    pub rule_proposals: Vec<RuleProposalView>,
    /// The modes a message of yours may be sent with ([`MESSAGE_MODES`]).
    /// Empty on a feed made before modes, which refuses a `mode` argument.
    #[serde(default)]
    pub message_modes: Vec<String>,
    /// What you let each agent reach on its computer, by agent name. An agent
    /// with no entry keeps its runtime's default.
    #[serde(default)]
    pub access: Vec<AccessView>,
    /// What each agent last reported it can reach, by agent name.
    #[serde(default)]
    pub reach: Vec<ReachView>,
}

/// One of your standing rules, as settings shows it.
#[derive(AbiType, Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(crate = "calimero_sdk::serde")]
pub struct RuleView {
    pub id: String,
    pub text: String,
    pub created_at: u64,
}

/// A rule your agent suggested, as settings shows it.
#[derive(AbiType, Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(crate = "calimero_sdk::serde")]
pub struct RuleProposalView {
    pub id: String,
    pub text: String,
    pub why: String,
    pub chain: String,
    pub status: String,
    pub created_at: u64,
}

/// A session's lease on a chain, as [`Hyperfeed::claim_chain`] returns it.
#[derive(AbiType, Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(crate = "calimero_sdk::serde")]
pub struct LeaseView {
    pub chain: String,
    pub session: String,
    pub agent: String,
    pub claimed_at: u64,
    /// 0 once released.
    pub expires_at: u64,
}

/// An agent and when it last said it was running (ms).
#[derive(AbiType, Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(crate = "calimero_sdk::serde")]
pub struct AgentView {
    pub name: String,
    pub seen_at: u64,
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
    /// What a lens made of a notification, by the notification's id.
    typed: UnorderedMap<String, Typed>,
    /// How each app version's events become feed items, by `<app>@<application id>`.
    lenses: UnorderedMap<String, Lens>,
    /// Chains you put away, by chain id.
    archived: UnorderedMap<String, Archived>,
    /// Agents that report in, by name.
    presence: UnorderedMap<String, Presence>,
    /// What your agent asked you, by its message's id.
    asks: UnorderedMap<String, Asked>,
    /// Your agent's latest step on each message it is working on, by message id.
    progress: UnorderedMap<String, Progress>,
    /// Images on your messages, by the message's id.
    attachments: UnorderedMap<String, Attachments>,
    /// Your agent's turn on each of your messages it worked on, by message id.
    work: UnorderedMap<String, Work>,
    /// Your requests to stop a turn, by message id.
    stops: UnorderedMap<String, StopRequest>,
    /// Headlines of messages written with one, by the message's id.
    headlines: UnorderedMap<String, Headline>,
    /// Which agent each of your messages sent with a mode is for, by the message's id.
    modes: UnorderedMap<String, MessageMode>,
    /// What you let each agent reach on its computer, by agent name.
    access: UnorderedMap<String, Access>,
    /// What each agent last reported it can reach, by agent name.
    reach: UnorderedMap<String, Reach>,
    /// Questions a newer one in their chain replaced, by the question's id.
    superseded: UnorderedMap<String, Superseded>,
    /// The question each of your messages sent from its buttons answers, by
    /// your message's id.
    answers: UnorderedMap<String, Answers>,
    /// Which agent session works on each chain, by chain id.
    leases: UnorderedMap<String, Lease>,
    /// "When X, do Y", polled by your agent's runtime, by id. See [`watches`].
    watches: UnorderedMap<String, Watch>,

    /// Your standing rules, by id.
    rules: UnorderedMap<String, Rule>,
    /// Rules your agent suggested, by id.
    rule_proposals: UnorderedMap<String, RuleProposal>,
    /// Where each task stands, as your agent last wrote it, by chain id.
    checkpoints: UnorderedMap<String, Checkpoint>,
    /// The PRs your tasks link to, as your agent's runtime last saw them on
    /// GitHub, by `owner/name#number`. See [`prs`].
    prs: UnorderedMap<String, PrSeen>,
    /// What each action touched, by the action's id.
    action_subjects: UnorderedMap<String, Subject>,
    /// The chain that last touched each subject, by its key.
    subject_chains: UnorderedMap<String, Subject>,
    /// Each task's links, by `<chain>|<subject>`. See [`links`].
    links: UnorderedMap<String, Link>,
    /// Devices to push to, by endpoint. See [`push`].
    push_devices: UnorderedMap<String, PushDevice>,
    /// The runtime's VAPID public key, under `vapid`.
    push_keys: UnorderedMap<String, PushKey>,
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
    /// A lens was proposed, approved or turned down: re-read `lenses`.
    LensChanged {
        app: &'a str,
        status: &'a str,
    },
    /// Chains were put away or brought back: re-read the feed.
    ArchiveChanged {
        count: u32,
    },
    /// You asked your agent to stop working on message `id`: it ends the turn
    /// and marks the message failed, "Stopped by you".
    StopRequested {
        id: &'a str,
    },
    /// A watch was set, fired, finished or cancelled: re-read `watches`.
    WatchChanged {
        id: &'a str,
        chain: &'a str,
        status: &'a str,
    },
    /// An agent session took a chain, or let it go: re-read who is on it.
    ChainLeaseChanged {
        chain: &'a str,
    },
    /// Your agent wrote where a task stands: re-read its `checkpoint`.
    CheckpointChanged {
        chain: &'a str,
    },
    /// Your agent's runtime saw a PR change on GitHub (`owner/name#number`):
    /// re-read `prs`.
    PrChanged {
        key: &'a str,
    },
    /// A task's links changed: re-read `links`.
    LinksChanged {
        chain: &'a str,
    },
    /// A device to push to, or the push key, changed: re-read `push_devices`.
    PushChanged,
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
            typed: UnorderedMap::new(),
            lenses: UnorderedMap::new(),
            archived: UnorderedMap::new(),
            presence: UnorderedMap::new(),
            asks: UnorderedMap::new(),
            progress: UnorderedMap::new(),
            attachments: UnorderedMap::new(),
            work: UnorderedMap::new(),
            stops: UnorderedMap::new(),
            headlines: UnorderedMap::new(),
            modes: UnorderedMap::new(),
            access: UnorderedMap::new(),
            reach: UnorderedMap::new(),
            superseded: UnorderedMap::new(),
            answers: UnorderedMap::new(),
            leases: UnorderedMap::new(),
            watches: UnorderedMap::new(),

            rules: UnorderedMap::new(),
            rule_proposals: UnorderedMap::new(),
            checkpoints: UnorderedMap::new(),
            prs: UnorderedMap::new(),
            action_subjects: UnorderedMap::new(),
            subject_chains: UnorderedMap::new(),
            links: UnorderedMap::new(),
            push_devices: UnorderedMap::new(),
            push_keys: UnorderedMap::new(),
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
    /// A typed notification's parts: a known type, and JSON objects within
    /// their limits. The contract does not read the JSON beyond its shape; the
    /// lens that wrote it and the client that renders it agree on the rest.
    fn check_typed(item_type: &str, fields: &str, reply_call: &str) -> app::Result<()> {
        Self::check_one_of("item_type", item_type, ITEM_TYPES)?;
        Self::check_len("fields", fields, MAX_FIELDS, false)?;
        Self::check_len("reply_call", reply_call, MAX_FIELDS, false)?;
        if item_type.is_empty() && !(fields.is_empty() && reply_call.is_empty()) {
            return Err(AppError::msg("fields and reply_call need an item_type"));
        }
        if !fields.is_empty() {
            Self::check_json_object("fields", fields)?;
        }
        if !reply_call.is_empty() {
            let call = Self::check_json_object("reply_call", reply_call)?;
            let method = call.get("method").and_then(|m| m.as_str()).unwrap_or("");
            if method.is_empty() || !call.get("args").is_some_and(|a| a.is_object()) {
                return Err(AppError::msg(
                    "reply_call must be {\"method\": \"…\", \"args\": {…}}",
                ));
            }
        }
        Ok(())
    }

    fn check_json_object(
        field: &str,
        value: &str,
    ) -> app::Result<calimero_sdk::serde_json::Map<String, calimero_sdk::serde_json::Value>> {
        match calimero_sdk::serde_json::from_str::<calimero_sdk::serde_json::Value>(value) {
            Ok(calimero_sdk::serde_json::Value::Object(map)) => Ok(map),
            _ => Err(AppError::msg(format!("{field} must be a JSON object"))),
        }
    }

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

    /// Whether `grant` lets an outcome in `app` stand without asking: the
    /// app's mode is Ask, nothing else (a pause, a guard) needs you, and
    /// `grant` is a proposal in that app you allowed for the session within
    /// [`GRANT_WINDOW_MS`].
    fn granted(&self, grant: &str, app: &str, category: &str, now: u64) -> app::Result<bool> {
        if grant.is_empty()
            || self.policy_for(app)?.agent != "ask"
            || self.is_paused()?
            || self.guard_on(category)?
        {
            return Ok(false);
        }
        let Some(proposal) = self.actions.get(grant)? else {
            return Ok(false);
        };
        Ok(proposal.app == app
            && proposal.history.iter().any(|s| {
                s.status == STATUS_APPROVED
                    && s.note == SESSION_GRANT
                    && now.saturating_sub(s.at) <= GRANT_WINDOW_MS
            }))
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
            item_type: String::new(),
            fields: String::new(),
            reply_call: String::new(),
            doing: String::new(),
            doing_at: 0,
            attachments: Vec::new(),
            steps: Vec::new(),
            draft: String::new(),
            stop_at: 0,
            headline: String::new(),
            mode: String::new(),
            superseded_by: String::new(),
            answers: String::new(),
            answers_superseded: false,
            held_by: String::new(),
            held_since: 0,
            subject: String::new(),
        }
    }

    /// An action as a row, with what it touched.
    fn action_row(&self, a: &Action) -> app::Result<FeedItem> {
        let mut item = Self::action_item(a);
        if let Some(s) = self.action_subjects.get(&a.id)? {
            item.subject = s.subject.clone();
        }
        Ok(item)
    }

    /// The chain that last touched `subject`, if it is still in your feed: a
    /// chain you put away is not brought back by a notification about it.
    fn chain_for_subject(&self, subject: &str) -> app::Result<Option<String>> {
        if subject.is_empty() {
            return Ok(None);
        }
        let Some(seen) = self.subject_chains.get(subject)?.map(|s| s.chain.clone()) else {
            return Ok(None);
        };
        if self.archived.get(&seen)?.is_some_and(|a| a.archived) {
            return Ok(None);
        }
        Ok(Some(seen))
    }

    /// A notification as a row, with what a lens made of it.
    fn notification_row(&self, n: &Notification) -> app::Result<FeedItem> {
        let typed = self.typed.get(&n.id)?.map(|t| t.clone());
        let mut item = Self::notification_item(n, typed.as_ref());
        if let Some(s) = self.superseded.get(&n.id)? {
            item.superseded_by = s.by.clone();
            // A replaced question no longer waits on you.
            if item.status == STATUS_RECEIVED {
                item.needs_you = false;
            }
        }
        Ok(item)
    }

    fn notification_item(n: &Notification, typed: Option<&Typed>) -> FeedItem {
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
            item_type: typed.map(|t| t.item_type.clone()).unwrap_or_default(),
            fields: typed.map(|t| t.fields.clone()).unwrap_or_default(),
            reply_call: typed.map(|t| t.reply_call.clone()).unwrap_or_default(),
            doing: String::new(),
            doing_at: 0,
            attachments: Vec::new(),
            steps: Vec::new(),
            draft: String::new(),
            stop_at: 0,
            headline: String::new(),
            mode: String::new(),
            superseded_by: String::new(),
            answers: String::new(),
            answers_superseded: false,
            held_by: String::new(),
            held_since: 0,
            subject: typed
                .map(|t| reply_subject(&n.app, &n.source_context, &t.reply_call))
                .unwrap_or_default(),
        }
    }

    /// A message as a row: what your agent asked you on its own message (an
    /// agent's message still `asked` needs you), its latest step while it
    /// works on one of yours, and the images on one of yours.
    fn message_row(&self, m: &Message) -> app::Result<FeedItem> {
        let mut item = Self::message_item(m);
        if let Some(a) = self.asks.get(&m.id)? {
            item.ask = a.ask.clone();
        }
        item.needs_you = m.from == FROM_AGENT && item.status == STATUS_ASKED;
        if let Some(s) = self.superseded.get(&m.id)? {
            item.superseded_by = s.by.clone();
            item.needs_you = false;
        }
        if let Some(a) = self.answers.get(&m.id)? {
            item.answers = a.ask.clone();
            item.answers_superseded = self.superseded.get(&a.ask)?.is_some();
        }
        if item.status == STATUS_THINKING {
            if let Some(p) = self.progress.get(&m.id)? {
                item.doing = p.doing.clone();
                item.doing_at = p.at;
            }
        }
        // The steps stay with the message once the turn is over; the draft
        // only while it is written, after which the answer is its own row.
        if let Some(w) = self.work.get(&m.id)? {
            item.steps = w.steps.clone();
            if item.status == STATUS_THINKING {
                item.draft = w.draft.clone();
            }
        }
        if let Some(s) = self.stops.get(&m.id)? {
            item.stop_at = s.at;
        }
        if let Some(l) = self.leases.get(&m.chain)? {
            if l.expires_at > now_ms() {
                item.held_by = l.agent.clone();
                item.held_since = l.claimed_at;
            }
        }
        if let Some(h) = self.headlines.get(&m.id)? {
            item.headline = h.text.clone();
            item.title = h.text.clone();
        }
        if let Some(md) = self.modes.get(&m.id)? {
            item.mode = md.mode.clone();
        }
        if let Some(a) = self.attachments.get(&m.id)? {
            item.attachments = a.items.clone();
            if item.body.is_empty() && item.headline.is_empty() {
                let n = item.attachments.len();
                item.title = if n == 1 {
                    "Sent an image".to_owned()
                } else {
                    format!("Sent {n} images")
                };
            }
        }
        Ok(item)
    }

    /// A message as a row, without what it asks: see [`Self::message_row`].
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
            item_type: String::new(),
            fields: String::new(),
            reply_call: String::new(),
            doing: String::new(),
            doing_at: 0,
            attachments: Vec::new(),
            steps: Vec::new(),
            draft: String::new(),
            stop_at: 0,
            headline: String::new(),
            mode: String::new(),
            superseded_by: String::new(),
            answers: String::new(),
            answers_superseded: false,
            held_by: String::new(),
            held_since: 0,
            subject: String::new(),
        }
    }

    /// Images on a message of yours: blobs on your node, of a type your agent
    /// can look at, within their limits.
    fn check_attachments(attachments: &[Attachment]) -> app::Result<()> {
        if attachments.len() > MAX_ATTACHMENTS {
            return Err(AppError::msg(format!(
                "{} attachments, limit is {MAX_ATTACHMENTS}",
                attachments.len()
            )));
        }
        for (i, a) in attachments.iter().enumerate() {
            let at = format!("attachments[{i}]");
            Self::check_len(&format!("{at}.blob_id"), &a.blob_id, MAX_HASH, true)?;
            if !a.blob_id.chars().all(|c| c.is_ascii_alphanumeric()) {
                return Err(AppError::msg(format!(
                    "{at}.blob_id must be letters and digits"
                )));
            }
            Self::check_len(&format!("{at}.name"), &a.name, MAX_SHORT, false)?;
            Self::check_one_of(&format!("{at}.mime"), &a.mime, IMAGE_TYPES)?;
            if a.size == 0 || a.size > MAX_IMAGE_BYTES {
                return Err(AppError::msg(format!(
                    "{at}.size is {} bytes, must be 1 to {MAX_IMAGE_BYTES}",
                    a.size
                )));
            }
        }
        Ok(())
    }

    /// The mode a message of yours was sent with, if any: one of
    /// [`MESSAGE_MODES`]. Empty is none, so a client may always send the field.
    fn check_message_mode(mode: Option<String>) -> app::Result<Option<String>> {
        let Some(mode) = mode.filter(|m| !m.is_empty()) else {
            return Ok(None);
        };
        if !MESSAGE_MODES.contains(&mode.as_str()) {
            return Err(AppError::msg(format!(
                "mode must be one of {}, not {mode}",
                MESSAGE_MODES.join(", ")
            )));
        }
        Ok(Some(mode))
    }

    /// A message's text and headline within their limits, and the headline
    /// to keep: `None` for none. A headline is one line of at most
    /// [`MAX_HEADLINE`] characters, and lets the text run to
    /// [`MAX_LONG_MESSAGE`] bytes; without one the text keeps to
    /// [`MAX_MESSAGE`]. An empty headline is no headline, so a caller can
    /// always pass the field.
    fn check_message(
        text: &str,
        headline: Option<String>,
        required: bool,
    ) -> app::Result<Option<String>> {
        let headline = headline
            .map(|h| h.trim().to_owned())
            .filter(|h| !h.is_empty());
        let Some(h) = headline else {
            Self::check_len("text", text, MAX_MESSAGE, required)?;
            return Ok(None);
        };
        let chars = h.chars().count();
        if chars > MAX_HEADLINE {
            return Err(AppError::msg(format!(
                "headline is {chars} characters, limit is {MAX_HEADLINE}"
            )));
        }
        if h.contains(['\n', '\r']) {
            return Err(AppError::msg("headline must be one line"));
        }
        Self::check_len("text", text, MAX_LONG_MESSAGE, required)?;
        Ok(Some(h))
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
        let item = self.action_row(&action)?;
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
        let item = self.notification_row(&n)?;
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

    /// When the newest row in `chain` was made; 0 for none.
    fn chain_last_at(&self, chain: &str) -> app::Result<u64> {
        let actions = self
            .actions
            .entries()?
            .filter(|(_, a)| a.chain == chain)
            .map(|(_, a)| a.created_at);
        let notes = self
            .notifications
            .entries()?
            .filter(|(_, n)| n.chain == chain)
            .map(|(_, n)| n.created_at);
        let messages = self
            .messages
            .entries()?
            .filter(|(_, m)| m.chain == chain)
            .map(|(_, m)| m.created_at);
        Ok(actions.chain(notes).chain(messages).max().unwrap_or(0))
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
        let item = self.message_row(&m)?;
        self.messages.insert(m.id.clone(), m)?;
        app::emit!(Event::MessageChanged {
            id: &item.id,
            status: &item.status,
        });
        Ok(item)
    }

    // One row of a message, whoever writes it: each argument is a column of it.
    #[allow(clippy::too_many_arguments)]
    fn post_message(
        &mut self,
        chain: String,
        from: &str,
        text: String,
        reply_to: String,
        status: &str,
        ask: Option<Ask>,
        attachments: Vec<Attachment>,
        headline: Option<String>,
        mode: Option<String>,
    ) -> app::Result<FeedItem> {
        // Strictly after what it follows in its chain: a message posted in the
        // same millisecond as the row it answers still reads after it.
        let mut now = now_ms();
        if !chain.is_empty() {
            now = now.max(self.chain_last_at(&chain)? + 1);
        }
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
        if let Some(ask) = ask {
            self.asks.insert(m.id.clone(), Asked { ask })?;
        }
        if !attachments.is_empty() {
            self.attachments
                .insert(m.id.clone(), Attachments { items: attachments })?;
        }
        if let Some(text) = headline {
            self.headlines.insert(m.id.clone(), Headline { text })?;
        }
        if let Some(mode) = mode {
            self.modes.insert(m.id.clone(), MessageMode { mode })?;
        }
        let item = self.message_row(&m)?;
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
    /// needed you is recorded with a breach, never dropped, unless the app's
    /// mode alone asked for you and its `grant` is a session you allowed.
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
        Self::check_len("grant", &input.grant, MAX_KEY, false)?;
        if !input.grant.is_empty() && input.outcome == "proposed" {
            return Err(AppError::msg(
                "a grant belongs on a done or failed action; a proposal waits for you",
            ));
        }
        Self::check_len("subject", &input.subject, MAX_KEY, false)?;

        let now = now_ms();
        let verdict = self.verdict(&input.app, &input.category, input.writes)?;
        // An unknown or stale grant is not an error: the outcome still happened,
        // and is recorded with its breach.
        let granted = self.granted(&input.grant, &input.app, &input.category, now)?;
        let (status, breach) = match (input.outcome.as_str(), verdict.decision.as_str()) {
            ("proposed", "refuse") => {
                return Err(AppError::msg(format!("not allowed: {}", verdict.reason)))
            }
            ("proposed", _) => (STATUS_PENDING, String::new()),
            (outcome, "act") => (outcome_status(outcome), String::new()),
            (outcome, "ask") if granted => (outcome_status(outcome), String::new()),
            (outcome, "ask") => (
                outcome_status(outcome),
                format!("acted without asking: {}", verdict.reason),
            ),
            (outcome, _) => (
                outcome_status(outcome),
                format!("acted where it may not: {}", verdict.reason),
            ),
        };

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
        let mut item = Self::action_item(&action);
        if !input.subject.is_empty() {
            let seen = Subject {
                subject: input.subject,
                chain: action.chain.clone(),
                at: now,
            };
            self.action_subjects
                .insert(action.id.clone(), seen.clone())?;
            // A thing you took off this task stays off it.
            if !self.link_removed(&seen.chain, &seen.subject)? {
                self.subject_chains
                    .insert(seen.subject.clone(), seen.clone())?;
                self.link_subject(&seen.chain, &seen.subject, "", "agent", false)?;
            }
            item.subject = seen.subject;
        }
        self.actions.insert(action.id.clone(), action)?;
        app::emit!(Event::ActionRecorded {
            id: &item.id,
            status: &item.status,
        });
        Ok(item)
    }

    /// Your agent touched `subject` (see [`subject_key`]) for the task in
    /// `chain` with a write that has no row of its own: a step of its turn on
    /// a message of yours. A notification about it then joins `chain`, as
    /// for an action that names it.
    pub fn touch_subject(&mut self, chain: String, subject: String) -> app::Result<()> {
        self.require_owner()?;
        Self::check_len("chain", &chain, MAX_KEY, true)?;
        Self::check_len("subject", &subject, MAX_KEY, true)?;
        if !self.chain_exists(&chain)? {
            return Err(AppError::msg(format!("no chain {chain}")));
        }
        if self.link_removed(&chain, &subject)? {
            return Ok(());
        }
        self.link_subject(&chain, &subject, "", "agent", false)?;
        let seen = Subject {
            subject,
            chain,
            at: now_ms(),
        };
        self.subject_chains.insert(seen.subject.clone(), seen)?;
        Ok(())
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
    ///
    /// A long answer takes a `headline`: one line of at most 80 characters,
    /// which the feed row shows, with `text` (up to 32 KB) behind "more" and
    /// in full in the chat. Without one, `text` keeps to 2000 bytes. Older
    /// agents omit it.
    pub fn agent_say(
        &mut self,
        chain: String,
        reply_to: String,
        text: String,
        headline: Option<String>,
    ) -> app::Result<FeedItem> {
        self.agent_post(chain, reply_to, text, None, headline)
    }

    /// [`Self::agent_say`] that leaves something to you: a question to
    /// `reply` to, or options to `choose` from. The message needs you, in To
    /// do, until you say something in its chain; your words are its answer.
    /// Use it whenever the work is not finished without you, so a chain is
    /// only done when it is.
    ///
    /// Takes a `headline` as [`Self::agent_say`] does.
    pub fn agent_ask(
        &mut self,
        chain: String,
        reply_to: String,
        text: String,
        ask: Ask,
        headline: Option<String>,
    ) -> app::Result<FeedItem> {
        Self::check_ask(&ask)?;
        Self::check_one_of("ask.kind", &ask.kind, &["reply", "choose"])?;
        self.agent_post(chain, reply_to, text, Some(ask), headline)
    }

    fn agent_post(
        &mut self,
        chain: String,
        reply_to: String,
        text: String,
        ask: Option<Ask>,
        headline: Option<String>,
    ) -> app::Result<FeedItem> {
        self.require_owner()?;
        Self::check_len("chain", &chain, MAX_KEY, true)?;
        let headline = Self::check_message(&text, headline, true)?;
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
        let asks = ask.is_some();
        let status = if asks { STATUS_ASKED } else { STATUS_SAID };
        let item = self.post_message(
            chain,
            FROM_AGENT,
            text,
            reply_to,
            status,
            ask,
            Vec::new(),
            headline,
            None,
        )?;
        if asks {
            self.supersede_asks(&item.chain, &item.id)?;
        }
        Ok(item)
    }

    /// A new question in `chain` (`by`) replaces the ones there you have not
    /// answered yet: your agent's open questions, and notifications still
    /// waiting for your answer. Their buttons go, and they stop needing you.
    fn supersede_asks(&mut self, chain: &str, by: &str) -> app::Result<()> {
        let mut open: Vec<String> = Vec::new();
        for (id, m) in self.messages.entries()? {
            if id != by
                && m.chain == chain
                && m.from == FROM_AGENT
                && current(&m.history).status == STATUS_ASKED
            {
                open.push(id);
            }
        }
        for (id, n) in self.notifications.entries()? {
            if id != by
                && n.chain == chain
                && !n.ask.kind.is_empty()
                && current(&n.history).status == STATUS_RECEIVED
            {
                open.push(id);
            }
        }
        let at = now_ms();
        for id in open {
            if self.superseded.get(&id)?.is_some() {
                continue;
            }
            self.superseded.insert(
                id,
                Superseded {
                    by: by.to_owned(),
                    at,
                },
            )?;
        }
        Ok(())
    }

    /// You said something in a chain: whatever your agent asked you there is
    /// answered by it. A question a newer one replaced is not: your words
    /// answer the question in front of you.
    fn answer_asks(&mut self, chain: &str, text: &str) -> app::Result<()> {
        let mut open: Vec<Message> = Vec::new();
        for (id, m) in self.messages.entries()? {
            if m.chain == chain
                && m.from == FROM_AGENT
                && current(&m.history).status == STATUS_ASKED
                && self.superseded.get(&id)?.is_none()
            {
                open.push(m.clone());
            }
        }
        let note: String = text.chars().take(MAX_WHY / 4).collect();
        for m in open {
            self.push_message_step(m, STATUS_ANSWERED, note.clone())?;
        }
        Ok(())
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
            .map(|(_, m)| self.message_row(&m))
            .collect::<app::Result<Vec<_>>>()?;
        open.sort_by(|a, b| a.at.cmp(&b.at).then_with(|| a.id.cmp(&b.id)));
        Ok(open)
    }

    /// The agent proposes a lens for one app version, learned from its ABI.
    /// It waits for you: an approved lens is replaced only by a new proposal,
    /// which waits again. The same spec proposed again changes nothing.
    pub fn propose_lens(
        &mut self,
        app_key: String,
        application_id: String,
        spec: String,
        summary: String,
    ) -> app::Result<LensView> {
        self.require_owner()?;
        Self::check_app(&app_key)?;
        Self::check_len("application_id", &application_id, MAX_KEY, true)?;
        Self::check_len("spec", &spec, MAX_LENS, true)?;
        Self::check_len("summary", &summary, MAX_WHY, true)?;
        Self::check_json_object("spec", &spec)?;
        let key = Self::lens_key(&app_key, &application_id);
        let prior = self.lenses.get(&key)?.map(|l| l.clone());
        if let Some(l) = &prior {
            if l.spec == spec && l.summary == summary {
                return Ok(Self::lens_view(l.clone()));
            }
        }
        let lens = Lens {
            app: app_key,
            application_id,
            spec,
            summary,
            status: LENS_PROPOSED.to_owned(),
            updated_at: prior.map_or(now_ms(), |l| now_ms().max(l.updated_at + 1)),
        };
        self.lenses.insert(key, lens.clone())?;
        app::emit!(Event::LensChanged {
            app: &lens.app,
            status: &lens.status,
        });
        Ok(Self::lens_view(lens))
    }

    fn lens_key(app_key: &str, application_id: &str) -> String {
        format!("{app_key}@{application_id}")
    }

    fn lens_view(l: Lens) -> LensView {
        LensView {
            app: l.app,
            application_id: l.application_id,
            spec: l.spec,
            summary: l.summary,
            status: l.status,
            updated_at: l.updated_at,
        }
    }

    // ── your side ────────────────────────────────────────────────────────────

    /// Talk to your agent: about a chain (`chain` = its id), or about
    /// anything (`chain` empty, which starts a new chain). Your agent picks it
    /// up, answers in the chain, and may propose or act there under your rules.
    ///
    /// A long message takes a `headline`, as [`Self::agent_say`] does. Older
    /// clients omit it.
    ///
    /// `mode` says how private it is, and so which of your agents takes it:
    /// `private` or `public` (see [`MESSAGE_MODES`]). Omitted or empty, it
    /// has none, and your agent's runtime decides. Older clients omit it.
    pub fn say(
        &mut self,
        chain: String,
        text: String,
        headline: Option<String>,
        mode: Option<String>,
    ) -> app::Result<FeedItem> {
        self.say_with(chain, text, Vec::new(), headline, mode)
    }

    /// [`Self::say`] with images: up to four, each a blob you uploaded to your
    /// node and announced to this context. With an image, `text` may be empty.
    pub fn say_with(
        &mut self,
        chain: String,
        text: String,
        attachments: Vec<Attachment>,
        headline: Option<String>,
        mode: Option<String>,
    ) -> app::Result<FeedItem> {
        self.require_owner()?;
        Self::check_len("chain", &chain, MAX_KEY, false)?;
        let headline = Self::check_message(&text, headline, attachments.is_empty())?;
        Self::check_attachments(&attachments)?;
        let mode = Self::check_message_mode(mode)?;
        if !chain.is_empty() && !self.chain_exists(&chain)? {
            return Err(AppError::msg(format!("no chain {chain}")));
        }
        if !chain.is_empty() {
            self.answer_asks(&chain, &text)?;
        }
        self.post_message(
            chain,
            FROM_YOU,
            text,
            String::new(),
            STATUS_WAITING,
            None,
            attachments,
            headline,
            mode,
        )
    }

    /// Answer one question your agent asked, from its buttons: `text` is the
    /// option you picked, or your reply. It is your next message in the
    /// question's chain, and goes to your agent like any other.
    ///
    /// A question a newer one replaced can still be answered (a screen that
    /// had not caught up yet, another device): it is marked answered, the
    /// newer question stays open, and your message carries
    /// `answers_superseded`, so your agent confirms against where things
    /// stand now before acting on it.
    pub fn answer_ask(&mut self, id: String, text: String) -> app::Result<FeedItem> {
        self.require_owner()?;
        Self::check_len("text", &text, MAX_MESSAGE, true)?;
        let m = self.get_message(&id)?;
        if m.from != FROM_AGENT || self.asks.get(&id)?.is_none() {
            return Err(AppError::msg(format!("message {id} asks you nothing")));
        }
        let status = current(&m.history).status.clone();
        if status != STATUS_ASKED {
            return Err(AppError::msg(format!("message {id} is already {status}")));
        }
        let chain = m.chain.clone();
        if self.superseded.get(&id)?.is_some() {
            let note: String = text.chars().take(MAX_WHY / 4).collect();
            self.push_message_step(m, STATUS_ANSWERED, note)?;
        } else {
            self.answer_asks(&chain, &text)?;
        }
        let item = self.post_message(
            chain,
            FROM_YOU,
            text,
            String::new(),
            STATUS_WAITING,
            None,
            Vec::new(),
            None,
            None,
        )?;
        self.answers
            .insert(item.id.clone(), Answers { ask: id.clone() })?;
        let mut item = item;
        item.answers = id.clone();
        item.answers_superseded = self.superseded.get(&id)?.is_some();
        Ok(item)
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
            let item = self.action_row(&action)?;
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
        Self::check_typed(&input.item_type, &input.fields, &input.reply_call)?;

        let now = now_ms();
        let id = match self.occurrence_of(&input.key, now)? {
            Occurrence::Seen(existing) => return self.notification_row(&existing),
            Occurrence::New(id) => id,
        };
        // About something a task of yours touched: it joins that task's chain.
        let joins = if input.chain.is_empty() && !input.item_type.is_empty() {
            self.chain_for_subject(&reply_subject(
                &input.app,
                &input.source_context,
                &input.reply_call,
            ))?
        } else {
            None
        };
        let n = Notification {
            chain: Self::chain_of(joins.as_deref().unwrap_or(&input.chain), &id)?,
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
        let typed = Typed {
            item_type: input.item_type,
            fields: input.fields,
            reply_call: input.reply_call,
        };
        let typed = (!typed.item_type.is_empty()).then_some(typed);
        let item = Self::notification_item(&n, typed.as_ref());
        if let Some(t) = typed {
            self.typed.insert(n.id.clone(), t)?;
        }
        let asks = !n.ask.kind.is_empty();
        self.notifications.insert(n.id.clone(), n)?;
        if asks {
            self.supersede_asks(&item.chain, &item.id)?;
        }
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

    /// Approve or turn down a lens your agent proposed. Only an approved lens
    /// turns an app's events into feed items, and only for the app version it
    /// was learned from.
    pub fn decide_lens(
        &mut self,
        app_key: String,
        application_id: String,
        decision: String,
    ) -> app::Result<LensView> {
        self.require_owner()?;
        Self::check_one_of("decision", &decision, &["approve", "reject"])?;
        let key = Self::lens_key(&app_key, &application_id);
        let mut lens =
            self.lenses.get(&key)?.map(|l| l.clone()).ok_or_else(|| {
                AppError::msg(format!("no lens for {app_key} at {application_id}"))
            })?;
        lens.status = if decision == "approve" {
            LENS_APPROVED
        } else {
            LENS_REJECTED
        }
        .to_owned();
        lens.updated_at = now_ms().max(lens.updated_at + 1);
        self.lenses.insert(key, lens.clone())?;
        app::emit!(Event::LensChanged {
            app: &lens.app,
            status: &lens.status,
        });
        Ok(Self::lens_view(lens))
    }

    /// Pause the agent: every write it wants to make becomes a proposal.
    /// Put chains away: each leaves the feed until something new happens in
    /// it, or until `until` (ms; 0 = no return time) for "later". Returns how
    /// many were put away.
    pub fn archive(&mut self, chains: Vec<String>, until: u64) -> app::Result<u32> {
        self.require_owner()?;
        if chains.len() > MAX_ARCHIVE {
            return Err(AppError::msg(format!(
                "at most {MAX_ARCHIVE} chains at a time"
            )));
        }
        if until != 0 && until <= now_ms() {
            return Err(AppError::msg("until must be in the future, or 0"));
        }
        self.set_archived(&chains, true, until)
    }

    /// Bring chains back into the feed.
    pub fn unarchive(&mut self, chains: Vec<String>) -> app::Result<u32> {
        self.require_owner()?;
        if chains.len() > MAX_ARCHIVE {
            return Err(AppError::msg(format!(
                "at most {MAX_ARCHIVE} chains at a time"
            )));
        }
        self.set_archived(&chains, false, 0)
    }

    fn set_archived(&mut self, chains: &[String], archived: bool, until: u64) -> app::Result<u32> {
        let mut count = 0u32;
        for chain in chains {
            Self::check_len("chain", chain, MAX_KEY, false)?;
            let latest = self
                .all_items(true)?
                .into_iter()
                .filter(|i| i.chain == *chain)
                .map(|i| i.chain_at.max(i.at))
                .max()
                .ok_or_else(|| AppError::msg(format!("no chain {chain}")))?;
            let updated_at = match self.archived.get(chain)? {
                Some(a) => now_ms().max(a.updated_at + 1),
                None => now_ms(),
            };
            self.archived.insert(
                chain.clone(),
                Archived {
                    archived,
                    at: latest,
                    until,
                    updated_at,
                },
            )?;
            count += 1;
        }
        app::emit!(Event::ArchiveChanged { count });
        Ok(count)
    }

    /// Whether a chain is put away now, given its latest activity.
    fn is_archived(&self, chain: &str, chain_at: u64, now: u64) -> app::Result<bool> {
        Ok(match self.archived.get(chain)? {
            Some(a) => a.archived && chain_at <= a.at && (a.until == 0 || now < a.until),
            None => false,
        })
    }

    /// Your agent says what it is doing on one of your messages it has taken
    /// up (`thinking`): "Running the tests", "Editing ChatView.tsx". Each call
    /// replaces the last, so you see its latest step and nothing piles up.
    pub fn agent_progress(&mut self, id: String, doing: String) -> app::Result<FeedItem> {
        self.require_owner()?;
        Self::check_len("doing", &doing, MAX_TITLE, true)?;
        let m = self.get_message(&id)?;
        if m.from != FROM_YOU {
            return Err(AppError::msg(format!("message {id} is the agent's own")));
        }
        let status = current(&m.history).status.clone();
        if status != STATUS_THINKING {
            return Err(AppError::msg(format!(
                "message {id} is {status}; progress is for a message being worked on"
            )));
        }
        let at = match self.progress.get(&id)? {
            Some(p) => now_ms().max(p.at + 1),
            None => now_ms(),
        };
        self.progress.insert(id.clone(), Progress { doing, at })?;
        app::emit!(Event::MessageChanged {
            id: &id,
            status: STATUS_THINKING,
        });
        self.message_row(&m)
    }

    /// Your agent reports its turn on one of your messages: every step so far
    /// (each with its own `id`, a `title` in words, a `status` of `running`,
    /// `waiting`, `done` or `failed`, and when it started) and the answer it
    /// has written so far as `draft`. Each call replaces the last, so the
    /// turn never adds rows: send it whenever a step starts or ends, and
    /// every few seconds while the answer is being written. The steps stay
    /// on the message after the turn; the draft shows only while it is
    /// `thinking`.
    pub fn agent_work(
        &mut self,
        id: String,
        steps: Vec<TurnStep>,
        draft: String,
    ) -> app::Result<FeedItem> {
        self.require_owner()?;
        if steps.len() > MAX_HISTORY {
            return Err(AppError::msg(format!(
                "{} steps, limit is {MAX_HISTORY}",
                steps.len()
            )));
        }
        for s in &steps {
            Self::check_len("step id", &s.id, MAX_KEY, true)?;
            Self::check_len("step title", &s.title, MAX_TITLE, true)?;
            Self::check_one_of("step status", &s.status, &STEP_STATUSES)?;
        }
        // A long answer, written with a headline, streams as a long draft.
        Self::check_len("draft", &draft, MAX_LONG_MESSAGE, false)?;
        let m = self.get_message(&id)?;
        if m.from != FROM_YOU {
            return Err(AppError::msg(format!("message {id} is the agent's own")));
        }
        let status = current(&m.history).status.clone();
        if status == STATUS_WAITING {
            return Err(AppError::msg(format!(
                "message {id} is waiting; take it up with agent_ack first"
            )));
        }
        let at = match self.work.get(&id)? {
            Some(w) => now_ms().max(w.at + 1),
            None => now_ms(),
        };
        self.work.insert(id.clone(), Work { steps, draft, at })?;
        app::emit!(Event::MessageChanged {
            id: &id,
            status: &status,
        });
        self.message_row(&m)
    }

    /// You ask your agent to stop working on one of your messages. One it has
    /// not taken up yet is closed at once, "Stopped by you"; one it is working
    /// on (`thinking`) keeps the request, and your agent ends its turn and
    /// marks the message failed, "Stopped by you". Asking twice changes
    /// nothing.
    pub fn stop(&mut self, id: String) -> app::Result<FeedItem> {
        self.require_owner()?;
        let m = self.get_message(&id)?;
        if m.from != FROM_YOU {
            return Err(AppError::msg(format!(
                "message {id} is the agent's own; stop one of yours"
            )));
        }
        let status = current(&m.history).status.clone();
        match status.as_str() {
            STATUS_WAITING => {
                self.stops
                    .insert(id.clone(), StopRequest { at: now_ms() })?;
                self.push_message_step(m, STATUS_FAILED, STOPPED_BY_YOU.to_owned())
            }
            STATUS_THINKING => {
                if self.stops.get(&id)?.is_none() {
                    self.stops
                        .insert(id.clone(), StopRequest { at: now_ms() })?;
                    app::emit!(Event::StopRequested { id: &id });
                    app::emit!(Event::MessageChanged {
                        id: &id,
                        status: STATUS_THINKING,
                    });
                }
                self.message_row(&m)
            }
            _ => Err(AppError::msg(format!(
                "message {id} is {status}; there is no turn to stop"
            ))),
        }
    }

    fn check_lease(chain: &str, session: &str, ttl_ms: u64) -> app::Result<()> {
        Self::check_len("chain", chain, MAX_KEY, true)?;
        Self::check_len("session", session, MAX_KEY, true)?;
        if !(MIN_LEASE_MS..=MAX_LEASE_MS).contains(&ttl_ms) {
            return Err(AppError::msg(format!(
                "ttl_ms must be {MIN_LEASE_MS} to {MAX_LEASE_MS}, got {ttl_ms}"
            )));
        }
        Ok(())
    }

    fn lease_view(chain: &str, l: &Lease) -> LeaseView {
        LeaseView {
            chain: chain.to_owned(),
            session: l.session.clone(),
            agent: l.agent.clone(),
            claimed_at: l.claimed_at,
            expires_at: l.expires_at,
        }
    }

    /// Why `session` may not have `chain` now: another session holds a lease
    /// on it that has not run out.
    fn held_by_other(
        chain: &str,
        session: &str,
        lease: Option<&Lease>,
        now: u64,
    ) -> app::Result<()> {
        match lease {
            Some(l) if l.session != session && l.expires_at > now => {
                let who = if l.agent.is_empty() {
                    "another session"
                } else {
                    &l.agent
                };
                Err(AppError::msg(format!(
                    "chain {chain} is held by {who} for {} s more",
                    (l.expires_at - now).div_ceil(1_000)
                )))
            }
            _ => Ok(()),
        }
    }

    /// An agent session takes `chain` for `ttl_ms` before it starts a turn
    /// there: one turn per chain at a time, across machines. Refused while
    /// another session holds an unexpired lease; a lease that ran out (its
    /// session died) can be taken. Claiming a chain the session already
    /// holds renews it. `agent` names it for the chat ("mero-bot@studio");
    /// older agents omit it.
    pub fn claim_chain(
        &mut self,
        chain: String,
        session: String,
        ttl_ms: u64,
        agent: Option<String>,
    ) -> app::Result<LeaseView> {
        self.require_owner()?;
        Self::check_lease(&chain, &session, ttl_ms)?;
        let agent = agent.unwrap_or_default();
        Self::check_len("agent", &agent, MAX_SHORT, false)?;
        let now = now_ms();
        let prior = self.leases.get(&chain)?.map(|l| l.clone());
        Self::held_by_other(&chain, &session, prior.as_ref(), now)?;
        let still_mine = prior
            .as_ref()
            .filter(|l| l.session == session && l.expires_at > now)
            .map(|l| l.claimed_at);
        let updated_at = prior.as_ref().map_or(now, |l| now.max(l.updated_at + 1));
        let lease = Lease {
            claimed_at: still_mine.unwrap_or(now),
            session,
            agent,
            expires_at: now + ttl_ms,
            updated_at,
        };
        let view = Self::lease_view(&chain, &lease);
        let fresh = still_mine.is_none();
        self.leases.insert(chain.clone(), lease)?;
        if fresh {
            app::emit!(Event::ChainLeaseChanged { chain: &chain });
        }
        Ok(view)
    }

    /// The session holding `chain` keeps it for another `ttl_ms` while it
    /// works. Refused once another session has it, or when this one never
    /// did or released it: it should stop, not carry on beside the other.
    pub fn renew_chain(
        &mut self,
        chain: String,
        session: String,
        ttl_ms: u64,
    ) -> app::Result<LeaseView> {
        self.require_owner()?;
        Self::check_lease(&chain, &session, ttl_ms)?;
        let now = now_ms();
        let mut lease = self
            .leases
            .get(&chain)?
            .map(|l| l.clone())
            .ok_or_else(|| AppError::msg(format!("chain {chain} is not claimed")))?;
        Self::held_by_other(&chain, &session, Some(&lease), now)?;
        if lease.session != session || lease.expires_at == 0 {
            return Err(AppError::msg(format!(
                "this session does not hold chain {chain}; claim it again"
            )));
        }
        lease.expires_at = now + ttl_ms;
        lease.updated_at = now.max(lease.updated_at + 1);
        let view = Self::lease_view(&chain, &lease);
        self.leases.insert(chain, lease)?;
        Ok(view)
    }

    /// The session lets `chain` go at the end of its turn. Returns whether it
    /// held it: letting go of a chain it does not hold changes nothing.
    pub fn release_chain(&mut self, chain: String, session: String) -> app::Result<bool> {
        self.require_owner()?;
        Self::check_len("chain", &chain, MAX_KEY, true)?;
        Self::check_len("session", &session, MAX_KEY, true)?;
        let Some(mut lease) = self.leases.get(&chain)?.map(|l| l.clone()) else {
            return Ok(false);
        };
        if lease.session != session || lease.expires_at == 0 {
            return Ok(false);
        }
        lease.expires_at = 0;
        lease.updated_at = now_ms().max(lease.updated_at + 1);
        self.leases.insert(chain.clone(), lease)?;
        app::emit!(Event::ChainLeaseChanged { chain: &chain });
        Ok(true)
    }

    /// Who holds `chain` right now: a lease that has not run out, or none.
    pub fn chain_lease(&self, chain: String) -> app::Result<Option<LeaseView>> {
        Self::check_len("chain", &chain, MAX_KEY, true)?;
        let now = now_ms();
        Ok(self
            .leases
            .get(&chain)?
            .filter(|l| l.expires_at > now)
            .map(|l| Self::lease_view(&chain, &l)))
    }

    /// Your agent writes where the task in `chain` stands: what is done, the
    /// next step, its branches, worktrees and PRs, and what is still open. It
    /// replaces the chain's last checkpoint, so a new session can pick the
    /// task up from it. The limits are in `checkpoint.rs`.
    pub fn set_checkpoint(
        &mut self,
        chain: String,
        input: CheckpointInput,
    ) -> app::Result<CheckpointView> {
        self.require_owner()?;
        Self::check_len("chain", &chain, MAX_KEY, true)?;
        if !self.chain_exists(&chain)? {
            return Err(AppError::msg(format!("no chain {chain}")));
        }
        let prior_at = self.checkpoints.get(&chain)?.map_or(0, |c| c.updated_at);
        let checkpoint = Checkpoint::from_input(input, now_ms().max(prior_at + 1))?;
        let view = checkpoint.view(&chain);
        self.checkpoints.insert(chain.clone(), checkpoint)?;
        app::emit!(Event::CheckpointChanged { chain: &chain });
        Ok(view)
    }

    /// The latest checkpoint on `chain`, or none: read it before acting there.
    pub fn checkpoint(&self, chain: String) -> app::Result<Option<CheckpointView>> {
        Self::check_len("chain", &chain, MAX_KEY, true)?;
        Ok(self.checkpoints.get(&chain)?.map(|c| c.view(&chain)))
    }

    /// A standing rule's text: one short line, trimmed.
    fn check_rule(text: &str) -> app::Result<String> {
        let text = text.trim();
        Self::check_len("rule", text, MAX_RULE, true)?;
        if text.contains(['\n', '\r']) {
            return Err(AppError::msg("a rule is one line"));
        }
        Ok(text.to_owned())
    }

    /// Your rules in force, oldest first.
    fn active_rules(&self) -> app::Result<Vec<RuleView>> {
        let mut out: Vec<RuleView> = self
            .rules
            .entries()?
            .filter(|(_, r)| !r.removed)
            .map(|(id, r)| RuleView {
                id,
                text: r.text,
                created_at: r.created_at,
            })
            .collect();
        out.sort_by(|a, b| {
            a.created_at
                .cmp(&b.created_at)
                .then_with(|| a.id.cmp(&b.id))
        });
        Ok(out)
    }

    fn insert_rule(&mut self, text: String) -> app::Result<RuleView> {
        let rules = self.active_rules()?;
        if let Some(same) = rules.iter().find(|r| r.text.eq_ignore_ascii_case(&text)) {
            return Ok(same.clone());
        }
        if rules.len() >= MAX_RULES {
            return Err(AppError::msg(format!(
                "you have {MAX_RULES} rules, the limit; remove one first"
            )));
        }
        // Strictly after the newest rule: two added in one millisecond keep
        // their order, instead of falling back to their random ids.
        let now = now_ms().max(rules.iter().map(|r| r.created_at + 1).max().unwrap_or(0));
        let id = Self::fresh_id();
        self.rules.insert(
            id.clone(),
            Rule {
                text: text.clone(),
                created_at: now,
                removed: false,
                updated_at: now,
            },
        )?;
        app::emit!(Event::SettingsChanged);
        Ok(RuleView {
            id,
            text,
            created_at: now,
        })
    }

    /// Add a standing rule: one short line your agent keeps to on every turn.
    /// Only you add rules; the same rule twice is kept once.
    pub fn add_rule(&mut self, text: String) -> app::Result<RuleView> {
        self.require_owner()?;
        let text = Self::check_rule(&text)?;
        self.insert_rule(text)
    }

    /// Remove one of your standing rules.
    pub fn remove_rule(&mut self, id: String) -> app::Result<()> {
        self.require_owner()?;
        let mut rule = self
            .rules
            .get(&id)?
            .map(|r| r.clone())
            .filter(|r| !r.removed)
            .ok_or_else(|| AppError::msg(format!("no rule {id}")))?;
        rule.removed = true;
        rule.updated_at = now_ms().max(rule.updated_at + 1);
        self.rules.insert(id, rule)?;
        app::emit!(Event::SettingsChanged);
        Ok(())
    }

    /// Your agent suggests a standing rule after you corrected it: `text` is
    /// the rule, `why` the correction, `chain` where it happened. It waits
    /// for you in Controls and in the chat; nothing changes until you approve
    /// it. A rule you already have, or one already waiting, is not suggested
    /// twice.
    pub fn propose_rule(
        &mut self,
        text: String,
        why: String,
        chain: String,
    ) -> app::Result<RuleProposalView> {
        self.require_owner()?;
        let text = Self::check_rule(&text)?;
        Self::check_len("why", &why, MAX_WHY, false)?;
        Self::check_len("chain", &chain, MAX_KEY, false)?;
        if !chain.is_empty() && !self.chain_exists(&chain)? {
            return Err(AppError::msg(format!("no chain {chain}")));
        }
        if self
            .active_rules()?
            .iter()
            .any(|r| r.text.eq_ignore_ascii_case(&text))
        {
            return Err(AppError::msg("that is already one of the user's rules"));
        }
        let waiting = self.waiting_rule_proposals()?;
        if let Some(same) = waiting.iter().find(|p| p.text.eq_ignore_ascii_case(&text)) {
            return Ok(same.clone());
        }
        if waiting.len() >= MAX_RULE_PROPOSALS {
            return Err(AppError::msg(format!(
                "{MAX_RULE_PROPOSALS} suggested rules already wait for the user"
            )));
        }
        let now = now_ms();
        let id = Self::fresh_id();
        let proposal = RuleProposal {
            text,
            why,
            chain,
            status: RULE_PROPOSED.to_owned(),
            created_at: now,
            updated_at: now,
        };
        let view = Self::rule_proposal_view(id.clone(), &proposal);
        self.rule_proposals.insert(id, proposal)?;
        app::emit!(Event::SettingsChanged);
        Ok(view)
    }

    /// Approve a rule your agent suggested: it becomes one of your rules,
    /// added by you.
    pub fn approve_rule(&mut self, id: String) -> app::Result<RuleView> {
        self.require_owner()?;
        let mut proposal = self.waiting_rule_proposal(&id)?;
        let rule = self.insert_rule(proposal.text.clone())?;
        proposal.status = RULE_APPROVED.to_owned();
        proposal.updated_at = now_ms().max(proposal.updated_at + 1);
        self.rule_proposals.insert(id, proposal)?;
        app::emit!(Event::SettingsChanged);
        Ok(rule)
    }

    /// Turn down a rule your agent suggested.
    pub fn dismiss_rule(&mut self, id: String) -> app::Result<RuleProposalView> {
        self.require_owner()?;
        let mut proposal = self.waiting_rule_proposal(&id)?;
        proposal.status = RULE_DISMISSED.to_owned();
        proposal.updated_at = now_ms().max(proposal.updated_at + 1);
        let view = Self::rule_proposal_view(id.clone(), &proposal);
        self.rule_proposals.insert(id, proposal)?;
        app::emit!(Event::SettingsChanged);
        Ok(view)
    }

    fn waiting_rule_proposal(&self, id: &str) -> app::Result<RuleProposal> {
        let proposal = self
            .rule_proposals
            .get(id)?
            .map(|p| p.clone())
            .ok_or_else(|| AppError::msg(format!("no suggested rule {id}")))?;
        if proposal.status != RULE_PROPOSED {
            return Err(AppError::msg(format!(
                "suggested rule {id} is already {}",
                proposal.status
            )));
        }
        Ok(proposal)
    }

    /// Rules your agent suggested that wait for you, newest first.
    fn waiting_rule_proposals(&self) -> app::Result<Vec<RuleProposalView>> {
        let mut out: Vec<RuleProposalView> = self
            .rule_proposals
            .entries()?
            .filter(|(_, p)| p.status == RULE_PROPOSED)
            .map(|(id, p)| Self::rule_proposal_view(id, &p))
            .collect();
        out.sort_by(|a, b| {
            b.created_at
                .cmp(&a.created_at)
                .then_with(|| a.id.cmp(&b.id))
        });
        Ok(out)
    }

    fn rule_proposal_view(id: String, p: &RuleProposal) -> RuleProposalView {
        RuleProposalView {
            id,
            text: p.text.clone(),
            why: p.why.clone(),
            chain: p.chain.clone(),
            status: p.status.clone(),
            created_at: p.created_at,
        }
    }

    // ── watches: "when X, do Y", kept here so it outlives a session ─────────

    /// Set a watch: when its condition is met (a PR's checks green or red, a
    /// PR merged, a branch's CI green or red), its action runs once (merge
    /// the PR, start an agent turn with `text`, or tell you), reported in its
    /// chain. Your agent's runtime polls it; the same watch twice is kept once.
    pub fn add_watch(&mut self, input: WatchInput) -> app::Result<WatchView> {
        self.watch_add(input)
    }

    /// Cancel a watch still watching, with an optional note why. A watch that
    /// already fired cannot be called back.
    pub fn cancel_watch(&mut self, id: String, note: Option<String>) -> app::Result<WatchView> {
        self.watch_cancel(&id, note.as_deref().unwrap_or_default())
    }

    /// The runtime takes a watch whose condition it saw met, before it acts:
    /// `watching → firing`, refused for any other status. Of every session
    /// polling, exactly one gets it, once.
    pub fn fire_watch(&mut self, id: String, session: String) -> app::Result<WatchView> {
        self.watch_fire(&id, &session)
    }

    /// How the fired action went: `done` or `failed`, with a note.
    pub fn finish_watch(
        &mut self,
        id: String,
        outcome: String,
        note: String,
    ) -> app::Result<WatchView> {
        self.watch_finish(&id, &outcome, &note)
    }

    /// What the runtime last saw of a watching watch's condition, as one line
    /// ("3 of 5 checks passed, 2 running"). Only a change is written.
    pub fn watch_seen(&mut self, id: String, seen: String) -> app::Result<WatchView> {
        self.watch_seen_impl(&id, &seen)
    }

    /// The watches in `chain` (`""`: every chain), oldest first, whatever
    /// their status.
    pub fn watches(&self, chain: String) -> app::Result<Vec<WatchView>> {
        self.watch_list(&chain)
    }

    // ── PRs: what the runtime sees on GitHub, for the PR card's merge button ─

    /// Your agent's runtime records a PR a task links to as GitHub shows it
    /// now: state, base and default branch, conflicts, head commit, checks
    /// (the failing ones named) and the PR it is stacked on. Owner only; one
    /// row per PR, the oldest of [`MAX_PRS`] dropped to make room.
    pub fn record_pr(&mut self, input: PrInput) -> app::Result<PrView> {
        self.pr_record(input)
    }

    /// The PRs the runtime recorded for `chain` (`""`: every chain), the most
    /// recently seen first.
    pub fn prs(&self, chain: String) -> app::Result<Vec<PrView>> {
        self.pr_list(&chain)
    }

    /// Link a thing in another app to the task in `chain`: `subject` as
    /// [`subject_key`] makes it, a `label` for its chip, `by` you or your
    /// agent. What teammates do there joins the task from now on. Adding one
    /// again relabels it; you adding one you took off brings it back.
    pub fn add_link(&mut self, chain: String, input: LinkInput) -> app::Result<LinkView> {
        self.link_add(chain, input)
    }

    /// Take a link off the task in `chain`. Nothing new about it joins the
    /// task, and your agent touching it again does not bring it back.
    pub fn remove_link(&mut self, chain: String, subject: String) -> app::Result<()> {
        self.link_remove(chain, subject)
    }

    /// The links of the task in `chain`, oldest first, each with how much
    /// teammates did there (its notifications in the task).
    pub fn links(&self, chain: String) -> app::Result<Vec<LinkView>> {
        self.link_list(&chain)
    }

    /// Spin a task off the chat in `from`: `text` is your message that opens
    /// it, in a chain of its own, with its own post, workspace, checkpoint
    /// and PRs. The chat keeps a link to the task (`hyperfeed:task:<chain>`)
    /// and the task one back (`hyperfeed:from:<chain>`). Takes a `headline`
    /// as [`Self::say`] does, which names the task's link. Returns the
    /// task's first message; its chain is the task.
    pub fn start_task(
        &mut self,
        from: String,
        text: String,
        headline: Option<String>,
    ) -> app::Result<FeedItem> {
        self.task_start(from, text, headline)
    }

    // ── Push: wake your phone when something needs you ───────────────────────

    /// Your agent's runtime keeps its VAPID public key here, for phones to
    /// subscribe with; `by` names the runtime that holds the private half.
    /// Owner only. A different key drops every device: each subscribes again.
    pub fn set_push_key(&mut self, public_key: String, by: String) -> app::Result<PushKeyView> {
        self.push_key_set(public_key, by)
    }

    /// The key phones subscribe with; empty before a runtime set one.
    pub fn push_key(&self) -> app::Result<PushKeyView> {
        self.push_key_get()
    }

    /// A phone (or any browser) to push to: its push subscription, a name,
    /// and `quiet` to say only "Something needs you". Owner only; adding one
    /// again updates it. At most [`MAX_PUSH_DEVICES`]; the oldest makes room.
    pub fn add_push_device(&mut self, input: PushDeviceInput) -> app::Result<PushDeviceView> {
        self.push_device_add(input)
    }

    /// Stop pushing to a device: you took it off, or its push service said
    /// it is gone.
    pub fn remove_push_device(&mut self, endpoint: String) -> app::Result<()> {
        self.push_device_remove(endpoint)
    }

    /// The devices to push to, newest first.
    pub fn push_devices(&self) -> app::Result<Vec<PushDeviceView>> {
        self.push_device_list()
    }

    /// An agent saying it is running. The feed shows it as live while it
    /// keeps reporting; mero-bot calls this every half minute.
    pub fn agent_seen(&mut self, name: String) -> app::Result<()> {
        self.require_owner()?;
        Self::check_len("name", &name, MAX_KEY, false)?;
        self.presence.insert(name, Presence { seen_at: now_ms() })?;
        Ok(())
    }

    /// What `agent` (its name, as it reports in) may reach on its computer
    /// besides your Calimero apps: `folders` (each with or without writes),
    /// a `shell`, and the `web`. It replaces what was set before. Your
    /// agent's runtime refuses this method to the agent, so only you widen
    /// or narrow it.
    pub fn set_access(
        &mut self,
        agent: String,
        folders: Vec<Folder>,
        shell: bool,
        web: bool,
    ) -> app::Result<()> {
        self.require_owner()?;
        Self::check_len("agent", &agent, MAX_KEY, true)?;
        Self::check_folders(&folders)?;
        let updated_at = match self.access.get(&agent)? {
            Some(a) => now_ms().max(a.updated_at + 1),
            None => now_ms(),
        };
        self.access.insert(
            agent,
            Access {
                folders,
                shell,
                web,
                updated_at,
            },
        )?;
        app::emit!(Event::SettingsChanged);
        Ok(())
    }

    /// An agent saying what it can reach: one line per agent profile it runs.
    /// Shown to you in Controls beside what you set with `set_access`.
    pub fn agent_reach(&mut self, name: String, lines: Vec<ReachLine>) -> app::Result<()> {
        self.require_owner()?;
        Self::check_len("name", &name, MAX_KEY, true)?;
        if lines.len() > MAX_REACH {
            return Err(AppError::msg(format!(
                "{} reach lines, limit is {MAX_REACH}",
                lines.len()
            )));
        }
        for l in &lines {
            Self::check_len("serves", &l.serves, MAX_SHORT, true)?;
            Self::check_len("profile", &l.profile, MAX_SHORT, true)?;
            Self::check_len("model", &l.model, MAX_SHORT, false)?;
            Self::check_folders(&l.folders)?;
        }
        let at = match self.reach.get(&name)? {
            Some(r) => now_ms().max(r.at + 1),
            None => now_ms(),
        };
        self.reach.insert(name, Reach { lines, at })?;
        app::emit!(Event::SettingsChanged);
        Ok(())
    }

    /// Folders within their limits: absolute or under `~`, one line each.
    fn check_folders(folders: &[Folder]) -> app::Result<()> {
        if folders.len() > MAX_FOLDERS {
            return Err(AppError::msg(format!(
                "{} folders, limit is {MAX_FOLDERS}",
                folders.len()
            )));
        }
        for f in folders {
            Self::check_len("folder", &f.path, MAX_PATH, true)?;
            if !(f.path.starts_with('/') || f.path == "~" || f.path.starts_with("~/")) {
                return Err(AppError::msg(format!(
                    "folder must be absolute or under ~, got {:?}",
                    f.path
                )));
            }
            if f.path.contains('\n') || f.path.split('/').any(|part| part == "..") {
                return Err(AppError::msg(format!(
                    "folder must be one path with no '..', got {:?}",
                    f.path
                )));
            }
        }
        Ok(())
    }

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
        let mut all: Vec<FeedItem> = Vec::new();
        for (_, a) in self.actions.entries()? {
            all.push(self.action_row(&a)?);
        }
        for (_, n) in self.notifications.entries()? {
            if !muted.contains(&n.app) {
                all.push(self.notification_row(&n)?);
            }
        }
        // A conversation is never muted: you started it.
        for (_, m) in self.messages.entries()? {
            all.push(self.message_row(&m)?);
        }
        Ok(all)
    }

    /// The feed: one row per chain, newest activity first.
    ///
    /// A row is the chain's **lead**: the latest step that needs you if any
    /// does, otherwise the latest still underway (an action approved, retrying
    /// or being undone; your message waiting or being answered; your answer
    /// being delivered), otherwise the latest row. So a chain is settled only
    /// when everything in it is. Its `chain_len` says how many rows the chain
    /// holds and `needs_you` whether any of them needs you; read them all with
    /// [`Hyperfeed::chain`].
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
            archived: 0,
        };
        let now = now_ms();
        let mut apps: Vec<AppCount> = Vec::new();
        let mut rows: Vec<(FeedItem, bool, bool, Vec<String>)> = Vec::new();
        for (chain_id, items) in chains {
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
                .or_else(|| items.iter().filter(|i| underway(i)).max_by(by_time))
                .or_else(|| items.iter().max_by(by_time))
                .expect("a chain has at least one row");
            let mut lead = lead.clone();
            lead.chain_len = u32::try_from(items.len()).unwrap_or(u32::MAX);
            lead.chain_at = chain_at;
            lead.needs_you = needs;

            // Put away: only the archived view shows it, and nothing counts it.
            let archived = self.is_archived(&chain_id, chain_at, now)?;
            counts.archived += u32::from(archived);
            if archived != (filter == "archived") {
                continue;
            }
            if archived {
                rows.push((lead, has_action, has_notification, chain_apps));
                continue;
            }

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
            return Ok(Some(self.action_row(&a)?));
        }
        if let Some(n) = self.notifications.get(&id)? {
            return Ok(Some(self.notification_row(&n)?));
        }
        match self.messages.get(&id)? {
            Some(m) => Ok(Some(self.message_row(&m)?)),
            None => Ok(None),
        }
    }

    /// Every lens, newest first: what your agent learned for each app version,
    /// and whether you approved it.
    pub fn lenses(&self) -> app::Result<Vec<LensView>> {
        let mut out: Vec<LensView> = self
            .lenses
            .entries()?
            .map(|(_, l)| LensView {
                app: l.app,
                application_id: l.application_id,
                spec: l.spec,
                summary: l.summary,
                status: l.status,
                updated_at: l.updated_at,
            })
            .collect();
        out.sort_by(|a, b| {
            b.updated_at
                .cmp(&a.updated_at)
                .then_with(|| a.app.cmp(&b.app))
        });
        Ok(out)
    }

    /// Your rules: the pause switch, every app you set a policy for, every
    /// guard (defaults included), your standing rules, and the rules your
    /// agent suggested that wait for you.
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
        let mut agents: Vec<AgentView> = self
            .presence
            .entries()?
            .map(|(name, p)| AgentView {
                name,
                seen_at: p.seen_at,
            })
            .collect();
        agents.sort_by(|a, b| b.seen_at.cmp(&a.seen_at).then_with(|| a.name.cmp(&b.name)));
        let mut access: Vec<AccessView> = self
            .access
            .entries()?
            .map(|(agent, a)| AccessView {
                agent,
                folders: a.folders,
                shell: a.shell,
                web: a.web,
                updated_at: a.updated_at,
            })
            .collect();
        access.sort_by(|a, b| a.agent.cmp(&b.agent));
        let mut reach: Vec<ReachView> = self
            .reach
            .entries()?
            .map(|(agent, r)| ReachView {
                agent,
                lines: r.lines,
                at: r.at,
            })
            .collect();
        reach.sort_by(|a, b| a.agent.cmp(&b.agent));
        Ok(SettingsView {
            owner: self.owner.get().clone(),
            paused: self.is_paused()?,
            policies,
            guards,
            agents,
            rules: self.active_rules()?,
            rule_proposals: self.waiting_rule_proposals()?,
            message_modes: MESSAGE_MODES.iter().map(|m| (*m).to_owned()).collect(),
            access,
            reach,
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

/// Whether a row is still being carried: an action you approved, asked to
/// retry or to undo; a message of yours waiting for your agent or being
/// answered; a notification you answered, being delivered.
fn underway(item: &FeedItem) -> bool {
    match item.kind.as_str() {
        KIND_ACTION => matches!(
            item.status.as_str(),
            STATUS_APPROVED | STATUS_RETRYING | STATUS_UNDO_REQUESTED
        ),
        KIND_MESSAGE => {
            item.from == FROM_YOU
                && matches!(item.status.as_str(), STATUS_WAITING | STATUS_THINKING)
        }
        KIND_NOTIFICATION => item.status == STATUS_ANSWERED,
        _ => false,
    }
}

fn outcome_status(outcome: &str) -> &'static str {
    if outcome == "failed" {
        STATUS_FAILED
    } else {
        STATUS_DONE
    }
}
