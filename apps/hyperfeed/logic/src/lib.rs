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

pub const KIND_ACTION: &str = "action";
pub const KIND_NOTIFICATION: &str = "notification";

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

/// The part of an action that changes after it is recorded.
#[derive(
    AbiType, Debug, Clone, PartialEq, BorshSerialize, BorshDeserialize, Serialize, Deserialize,
)]
#[borsh(crate = "calimero_sdk::borsh")]
#[serde(crate = "calimero_sdk::serde")]
pub struct ActionState {
    pub status: String,
    /// The agent's or your note on the latest change ("NDA signed", "undo
    /// failed: the message was already read").
    pub note: String,
    pub at: u64,
}

/// One thing your agent did, or wants to do, on your behalf.
///
/// Everything but `state` and `reviewed` is written once. `state` resolves
/// last-writer-wins, and `reviewed` only ever turns on.
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
    /// Why the rules say this needed you, when the agent acted anyway. Empty
    /// when it did not.
    pub breach: String,
    pub reviewed: bool,
    pub state: ActionState,
}

impl Mergeable for Action {
    fn merge(&mut self, other: &Self) -> Result<(), MergeError> {
        let at = self.state.at;
        lww(&mut self.state, at, &other.state, other.state.at);
        self.reviewed |= other.reviewed;
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
    pub seen: bool,
    pub seen_at: u64,
}

impl Mergeable for Notification {
    fn merge(&mut self, other: &Self) -> Result<(), MergeError> {
        // Seen on any device is seen.
        self.seen |= other.seen;
        self.seen_at = self.seen_at.max(other.seen_at);
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
    pub app: String,
    pub source_context: String,
    pub source_label: String,
    pub title: String,
    pub body: String,
    pub at: u64,
    pub needs_you: bool,
    // ── actions ──
    pub status: String,
    pub status_at: u64,
    pub note: String,
    pub method: String,
    pub category: String,
    pub why: String,
    pub intent_hash: String,
    pub executor: String,
    pub undoable: bool,
    pub breach: String,
    // ── notifications ──
    pub from: String,
    pub event: String,
    pub seen: bool,
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
}

/// Every event is a nudge to re-read the feed; none carries the row itself.
#[app::event]
pub enum Event<'a> {
    ActionRecorded { id: &'a str, status: &'a str },
    ActionChanged { id: &'a str, status: &'a str },
    NotificationRecorded { id: &'a str },
    NotificationsSeen { count: u32 },
    SettingsChanged,
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
        matches!(a.state.status.as_str(), STATUS_PENDING | STATUS_FAILED)
            || (!a.breach.is_empty() && !a.reviewed)
    }

    fn action_item(a: &Action) -> FeedItem {
        FeedItem {
            id: a.id.clone(),
            kind: KIND_ACTION.to_owned(),
            app: a.app.clone(),
            source_context: a.source_context.clone(),
            source_label: a.source_label.clone(),
            title: a.title.clone(),
            body: a.body.clone(),
            at: a.created_at,
            needs_you: Self::action_needs_you(a),
            status: a.state.status.clone(),
            status_at: a.state.at,
            note: a.state.note.clone(),
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
            from: String::new(),
            event: String::new(),
            seen: true,
        }
    }

    fn notification_item(n: &Notification) -> FeedItem {
        FeedItem {
            id: n.id.clone(),
            kind: KIND_NOTIFICATION.to_owned(),
            app: n.app.clone(),
            source_context: n.source_context.clone(),
            source_label: n.source_label.clone(),
            title: n.title.clone(),
            body: n.body.clone(),
            at: n.created_at,
            needs_you: n.needs_you && !n.seen,
            status: String::new(),
            status_at: n.seen_at,
            note: String::new(),
            method: String::new(),
            category: String::new(),
            why: String::new(),
            intent_hash: String::new(),
            executor: String::new(),
            undoable: false,
            breach: String::new(),
            from: n.from.clone(),
            event: n.event.clone(),
            seen: n.seen,
        }
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
                            Occurrence::Seen(prev)
                        }
                        _ => Occurrence::New(id),
                    })
                }
            }
        }
        // A context that keeps coming back to one state: key by time instead.
        match latest {
            Some(prev) if now.saturating_sub(prev.created_at) <= DEDUPE_WINDOW_MS => {
                Ok(Occurrence::Seen(prev))
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

    fn set_state(
        &mut self,
        mut action: Action,
        status: &str,
        note: String,
    ) -> app::Result<FeedItem> {
        // Strictly after the state it replaces, so last-writer-wins never
        // drops a change made in the same millisecond on this device.
        let at = now_ms().max(action.state.at + 1);
        action.state = ActionState {
            status: status.to_owned(),
            note,
            at,
        };
        let item = Self::action_item(&action);
        self.actions.insert(action.id.clone(), action)?;
        app::emit!(Event::ActionChanged {
            id: &item.id,
            status: &item.status,
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
        let action = Action {
            id: Self::fresh_id(),
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
            breach,
            reviewed: false,
            state: ActionState {
                status: status.to_owned(),
                note: input.note,
                at: now,
            },
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
        let status = match (action.state.status.as_str(), outcome.as_str()) {
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
        self.set_state(action, status, note)
    }

    // ── your side ────────────────────────────────────────────────────────────

    /// Approve or decline a proposal, retry or drop a failure, ask for an
    /// undo, or keep an action the agent took without asking.
    pub fn resolve_action(&mut self, id: String, decision: String) -> app::Result<FeedItem> {
        self.require_owner()?;
        Self::check_one_of("decision", &decision, DECISIONS)?;
        let mut action = self.get_action(&id)?;
        let current = action.state.status.clone();

        if decision == "keep" {
            if action.breach.is_empty() || action.reviewed {
                return Err(AppError::msg(format!("action {id} has nothing to keep")));
            }
            action.reviewed = true;
            let item = Self::action_item(&action);
            self.actions.insert(action.id.clone(), action)?;
            app::emit!(Event::ActionChanged {
                id: &item.id,
                status: &item.status,
            });
            return Ok(item);
        }

        let status = match (current.as_str(), decision.as_str()) {
            (STATUS_PENDING, "approve") => STATUS_APPROVED,
            (STATUS_FAILED, "approve") => STATUS_RETRYING,
            (STATUS_PENDING | STATUS_FAILED, "decline") => STATUS_DECLINED,
            (STATUS_DONE, "undo") if action.undoable => STATUS_UNDO_REQUESTED,
            (STATUS_DONE, "undo") => {
                return Err(AppError::msg(format!("action {id} cannot be undone")))
            }
            _ => {
                return Err(AppError::msg(format!(
                    "cannot {decision} an action that is {current}"
                )))
            }
        };
        // Deciding on an action is reviewing it.
        action.reviewed = true;
        self.set_state(action, status, String::new())
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

        let now = now_ms();
        let id = match self.occurrence_of(&input.key, now)? {
            Occurrence::Seen(existing) => return Ok(Self::notification_item(&existing)),
            Occurrence::New(id) => id,
        };
        let n = Notification {
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
            seen: false,
            seen_at: 0,
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

    /// The feed, newest first. `filter` is `all`, `agent`, `notifications` or
    /// `needs_you`; `app_key` narrows to one app when not empty; `before` pages by
    /// time (0 = from the newest).
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

        let muted: Vec<String> = self
            .policies
            .entries()?
            .filter(|(_, p)| p.notifications == "mute")
            .map(|(k, _)| k)
            .collect();

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

        let mut counts = FeedCounts {
            all: 0,
            agent: 0,
            notifications: 0,
            needs_you: 0,
        };
        let mut apps: Vec<AppCount> = Vec::new();
        for item in &all {
            counts.all += 1;
            if item.kind == KIND_ACTION {
                counts.agent += 1;
            } else {
                counts.notifications += 1;
            }
            if item.needs_you {
                counts.needs_you += 1;
            }
            match apps.iter_mut().find(|a| a.app == item.app) {
                Some(a) => a.count += 1,
                None => apps.push(AppCount {
                    app: item.app.clone(),
                    count: 1,
                }),
            }
        }
        apps.sort_by(|a, b| b.count.cmp(&a.count).then_with(|| a.app.cmp(&b.app)));

        let mut items: Vec<FeedItem> = all
            .into_iter()
            .filter(|i| match filter.as_str() {
                "agent" => i.kind == KIND_ACTION,
                "notifications" => i.kind == KIND_NOTIFICATION,
                "needs_you" => i.needs_you,
                _ => true,
            })
            .filter(|i| app_key.is_empty() || i.app == app_key)
            .filter(|i| before == 0 || i.at < before)
            .collect();
        // Newest first; the id breaks ties so every device pages identically.
        items.sort_by(|a, b| b.at.cmp(&a.at).then_with(|| b.id.cmp(&a.id)));

        let next_before = if items.len() > limit {
            items[limit - 1].at
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

    /// One row, by id, whichever kind it is.
    pub fn item(&self, id: String) -> app::Result<Option<FeedItem>> {
        if let Some(a) = self.actions.get(&id)? {
            return Ok(Some(Self::action_item(&a)));
        }
        Ok(self
            .notifications
            .get(&id)?
            .map(|n| Self::notification_item(&n)))
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
    Seen(Notification),
    /// A new event, to be stored under this id.
    New(String),
}

fn outcome_status(outcome: &str) -> &'static str {
    if outcome == "failed" {
        STATUS_FAILED
    } else {
        STATUS_DONE
    }
}
