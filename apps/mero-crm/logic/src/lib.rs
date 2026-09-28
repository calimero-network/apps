//! CRM service — one sales pipeline, shared by the team that works it.
//!
//! One context is one pipeline. It holds the stages, the deals moving through
//! them, the people behind those deals, the activities scheduled against them,
//! the notes, and the automations that schedule follow-ups when a deal enters a
//! stage. Every member of the namespace sees the same board, live, replicated
//! between their own nodes.
//!
//! Patterns, following the rest of the fleet:
//!
//! - Every mutable field of a map value is its own `LwwRegister`, so two people
//!   editing DIFFERENT fields of one deal both keep their edit, and two editing
//!   the SAME field converge last-writer-wins. `update_deal` / `update_contact`
//!   only write the fields that actually changed for the same reason: writing
//!   an unchanged value would re-stamp it and clobber a teammate's concurrent
//!   edit of that field.
//! - Hand-written `Mergeable` on the CRDT-nesting values (#2577 re-keying).
//! - Named-struct returns only (no tuples) so every view is ABI-expressible.
//! - Money is `u64` in whole units of the pipeline currency. No floats in
//!   replicated state: two nodes must compute byte-identical values.
//! - Owners are display names (member aliases), the same convention as the
//!   issue tracker's assignee, so the board can show a name without a lookup.
//!
//! Who can write what, as every node enforces it (a member can run a patched
//! node that skips every check in this file):
//!
//! - Stages, deals, contacts, activities and automations are the TEAM'S shared
//!   working data, deliberately writable by every member — that is what makes
//!   it a shared board. They stay plain collections: moving them into an
//!   owned type would make every nested `LwwRegister` its creator's alone.
//! - Who CREATED a record is not a field anyone can rewrite: it is the owner
//!   stamp of a write-once entry in `created_by`, written with the record.
//!   "Only the creator may delete" is checked against that stamp. (A patched
//!   node can still remove a shared record outright; the stamp is what stops
//!   it passing itself off as the creator, or an honest node deleting on its
//!   behalf.)
//! - Notes are `Authored`: each is its author's, so nobody else can rewrite or
//!   delete one, and the author shown is the stamp.

use std::collections::BTreeMap;

use calimero_sdk::abi::AbiType;
use calimero_sdk::app;
use calimero_sdk::borsh::{BorshDeserialize, BorshSerialize};
use calimero_sdk::env;
use calimero_sdk::serde::{Deserialize, Serialize};
use calimero_sdk::types::Error as AppError;
use calimero_sdk::AccountId;
use calimero_storage::collections::crdt_meta::MergeError;
use calimero_storage::collections::{
    Authored, IndexedMap, LwwRegister, Mergeable, UnorderedMap, WriteOnce,
};
use calimero_storage::env as storage_env;

pub mod events;
use events::Event;

// ---------------------------------------------------------------------------
// Domain constants
// ---------------------------------------------------------------------------

/// Deal lifecycle. A deal is `open` while it sits in a stage; closing it takes
/// it off the board without losing which stage it closed from.
pub const DEAL_STATUSES: [&str; 3] = ["open", "won", "lost"];
/// Activity kinds — the five every CRM in the category converges on.
pub const ACTIVITY_KINDS: [&str; 5] = ["call", "meeting", "task", "email", "deadline"];
/// The pipeline a new context starts with: (id, name, win probability %).
/// Fixed ids, because `init` runs once on the creator's node and the rest of
/// the team receives the same entries by replication.
const DEFAULT_STAGES: [(&str, &str, u32); 5] = [
    ("stage-lead", "Lead in", 10),
    ("stage-qualified", "Qualified", 25),
    ("stage-meeting", "Meeting", 40),
    ("stage-proposal", "Proposal", 60),
    ("stage-negotiation", "Negotiation", 80),
];
const DEFAULT_CURRENCY: &str = "USD";
/// Days a deal may sit in a stage without activity before it is "rotting".
const DEFAULT_ROTTING_DAYS: u32 = 14;
const MAX_STAGES: usize = 12;
/// Rules one stage may carry. Enforced on the write, and again when a deal
/// enters the stage: every member can add rules, so a patched node could plant
/// thousands and make each honest move write one activity per rule.
const MAX_AUTOMATIONS_PER_STAGE: usize = 10;
const MAX_NAME_LEN: usize = 120;
const MAX_TEXT_LEN: usize = 10_000;
const DAY_MS: u64 = 86_400_000;

// ---------------------------------------------------------------------------
// Data models (internal, Borsh-only — they nest CRDTs; callers get *View structs)
// ---------------------------------------------------------------------------

/// A column of the pipeline.
#[app::mergeable(id = "mero_crm::Stage")]
#[derive(Debug, Clone, BorshSerialize, BorshDeserialize, AbiType)]
#[borsh(crate = "calimero_sdk::borsh")]
pub struct Stage {
    pub id: String,
    pub name: LwwRegister<String>,
    /// Win probability in percent, 0..=100. Drives the weighted forecast.
    pub probability: LwwRegister<u32>,
    /// Sort key. Reordering rewrites every stage's position in one call.
    pub position: LwwRegister<u32>,
    pub created_at: u64,
}

impl Mergeable for Stage {
    fn merge(&mut self, other: &Self) -> Result<(), MergeError> {
        if (other.created_at, &other.id) < (self.created_at, &self.id) {
            self.id = other.id.clone();
            self.created_at = other.created_at;
        }
        self.name.merge(&other.name);
        self.probability.merge(&other.probability);
        self.position.merge(&other.position);
        Ok(())
    }
}

/// A deal: an opportunity with a value, moving through the stages.
///
/// Indexed by the fields the board filters on, so a stage column, an owner's
/// deals or a person's deals is a seek rather than a scan of every deal.
#[app::mergeable(id = "mero_crm::Deal")]
#[derive(Debug, Clone, BorshSerialize, BorshDeserialize, AbiType, app::Indexed)]
#[borsh(crate = "calimero_sdk::borsh")]
pub struct Deal {
    pub id: String,
    pub title: LwwRegister<String>,
    pub value: LwwRegister<u64>,
    pub organization: LwwRegister<String>,
    #[index]
    pub contact_id: LwwRegister<Option<String>>,
    #[index]
    pub owner: LwwRegister<Option<String>>,
    #[index]
    pub stage_id: LwwRegister<String>,
    #[index]
    pub status: LwwRegister<String>,
    pub lost_reason: LwwRegister<String>,
    /// Expected close date, ms since the epoch.
    pub expected_close: LwwRegister<Option<u64>>,
    /// Where the deal came from (referral, inbound, outbound, event, …).
    pub source: LwwRegister<String>,
    /// When the deal entered its current stage — what "rotting" measures.
    pub stage_entered_at: LwwRegister<u64>,
    pub closed_at: LwwRegister<Option<u64>>,
    pub created_at: u64,
}

impl Mergeable for Deal {
    fn merge(&mut self, other: &Self) -> Result<(), MergeError> {
        if (other.created_at, &other.id) < (self.created_at, &self.id) {
            self.id = other.id.clone();
            self.created_at = other.created_at;
        }
        self.title.merge(&other.title);
        self.value.merge(&other.value);
        self.organization.merge(&other.organization);
        self.contact_id.merge(&other.contact_id);
        self.owner.merge(&other.owner);
        self.stage_id.merge(&other.stage_id);
        self.status.merge(&other.status);
        self.lost_reason.merge(&other.lost_reason);
        self.expected_close.merge(&other.expected_close);
        self.source.merge(&other.source);
        self.stage_entered_at.merge(&other.stage_entered_at);
        self.closed_at.merge(&other.closed_at);
        Ok(())
    }
}

/// A person the team sells to.
#[app::mergeable(id = "mero_crm::Contact")]
#[derive(Debug, Clone, BorshSerialize, BorshDeserialize, AbiType)]
#[borsh(crate = "calimero_sdk::borsh")]
pub struct Contact {
    pub id: String,
    pub name: LwwRegister<String>,
    pub email: LwwRegister<String>,
    pub phone: LwwRegister<String>,
    pub organization: LwwRegister<String>,
    pub job_title: LwwRegister<String>,
    pub created_at: u64,
}

impl Mergeable for Contact {
    fn merge(&mut self, other: &Self) -> Result<(), MergeError> {
        if (other.created_at, &other.id) < (self.created_at, &self.id) {
            self.id = other.id.clone();
            self.created_at = other.created_at;
        }
        self.name.merge(&other.name);
        self.email.merge(&other.email);
        self.phone.merge(&other.phone);
        self.organization.merge(&other.organization);
        self.job_title.merge(&other.job_title);
        Ok(())
    }
}

/// Something someone has to do: a call, a meeting, a task, an email, a deadline.
#[app::mergeable(id = "mero_crm::Activity")]
#[derive(Debug, Clone, BorshSerialize, BorshDeserialize, AbiType, app::Indexed)]
#[borsh(crate = "calimero_sdk::borsh")]
pub struct Activity {
    pub id: String,
    /// A deal's activities are one seek; `None` puts no row in the index.
    #[index]
    pub deal_id: Option<String>,
    pub contact_id: Option<String>,
    pub kind: String,
    pub subject: LwwRegister<String>,
    pub due_at: LwwRegister<u64>,
    pub done: LwwRegister<bool>,
    pub done_at: LwwRegister<Option<u64>>,
    pub owner: LwwRegister<Option<String>>,
    pub note: LwwRegister<String>,
    /// Set when an automation scheduled it rather than a person.
    pub automation_id: Option<String>,
    pub created_at: u64,
}

impl Mergeable for Activity {
    fn merge(&mut self, other: &Self) -> Result<(), MergeError> {
        if (other.created_at, &other.id) < (self.created_at, &self.id) {
            self.id = other.id.clone();
            self.deal_id = other.deal_id.clone();
            self.contact_id = other.contact_id.clone();
            self.kind = other.kind.clone();
            self.automation_id = other.automation_id.clone();
            self.created_at = other.created_at;
        }
        self.subject.merge(&other.subject);
        self.due_at.merge(&other.due_at);
        self.done.merge(&other.done);
        self.done_at.merge(&other.done_at);
        self.owner.merge(&other.owner);
        self.note.merge(&other.note);
        Ok(())
    }
}

/// A note on a deal. Immutable once written; only its author may delete it —
/// the author being the entry's owner stamp, not a field.
#[app::mergeable(id = "mero_crm::Note")]
#[derive(Debug, Clone, BorshSerialize, BorshDeserialize, AbiType, app::Indexed)]
#[borsh(crate = "calimero_sdk::borsh")]
pub struct Note {
    pub id: String,
    #[index]
    pub deal_id: String,
    pub body: String,
    pub created_at: u64,
}

impl Mergeable for Note {
    fn merge(&mut self, other: &Self) -> Result<(), MergeError> {
        // Immutable: keep the deterministic winner of a (theoretical) id race.
        if (other.created_at, &other.id) < (self.created_at, &self.id) {
            *self = other.clone();
        }
        Ok(())
    }
}

/// "When a deal enters `stage_id`, schedule a `kind` activity called `subject`,
/// due `due_in_days` later." The simple rule that covers most of what sales
/// automation is actually used for: never letting a deal arrive somewhere with
/// no next step.
#[app::mergeable(id = "mero_crm::Automation")]
#[derive(Debug, Clone, BorshSerialize, BorshDeserialize, AbiType, app::Indexed)]
#[borsh(crate = "calimero_sdk::borsh")]
pub struct Automation {
    pub id: String,
    #[index]
    pub stage_id: String,
    pub kind: String,
    pub subject: String,
    pub due_in_days: u32,
    pub enabled: LwwRegister<bool>,
    pub created_at: u64,
}

impl Mergeable for Automation {
    fn merge(&mut self, other: &Self) -> Result<(), MergeError> {
        if (other.created_at, &other.id) < (self.created_at, &self.id) {
            self.id = other.id.clone();
            self.stage_id = other.stage_id.clone();
            self.kind = other.kind.clone();
            self.subject = other.subject.clone();
            self.due_in_days = other.due_in_days;
            self.created_at = other.created_at;
        }
        self.enabled.merge(&other.enabled);
        Ok(())
    }
}

// ---------------------------------------------------------------------------
// Read-shaped views returned to callers (serde-able, ABI-expressible)
// ---------------------------------------------------------------------------

#[derive(Debug, Clone, Serialize, Deserialize, AbiType)]
#[serde(crate = "calimero_sdk::serde")]
pub struct StageView {
    pub id: String,
    pub name: String,
    pub probability: u32,
    pub position: u32,
}

/// The earliest open activity on a deal — the "next step" the board shows.
#[derive(Debug, Clone, Serialize, Deserialize, AbiType)]
#[serde(crate = "calimero_sdk::serde")]
pub struct NextActivity {
    pub id: String,
    pub kind: String,
    pub subject: String,
    pub due_at: u64,
}

#[derive(Debug, Clone, Serialize, Deserialize, AbiType)]
#[serde(crate = "calimero_sdk::serde")]
pub struct DealView {
    pub id: String,
    pub title: String,
    pub value: u64,
    pub organization: String,
    pub contact_id: Option<String>,
    /// The linked person's name, resolved here so the board needs no join.
    pub contact_name: Option<String>,
    pub owner: Option<String>,
    pub stage_id: String,
    pub status: String,
    pub lost_reason: String,
    pub expected_close: Option<u64>,
    pub source: String,
    /// Win probability: the stage's while open, 100 when won, 0 when lost.
    pub probability: u32,
    pub stage_entered_at: u64,
    pub closed_at: Option<u64>,
    pub next_activity: Option<NextActivity>,
    pub open_activities: u32,
    /// The most recent completed activity or note, if any.
    pub last_touch_at: Option<u64>,
    pub created_by: String,
    pub created_at: u64,
}

#[derive(Debug, Clone, Serialize, Deserialize, AbiType)]
#[serde(crate = "calimero_sdk::serde")]
pub struct ContactView {
    pub id: String,
    pub name: String,
    pub email: String,
    pub phone: String,
    pub organization: String,
    pub job_title: String,
    pub open_deals: u32,
    pub won_value: u64,
    pub created_by: String,
    pub created_at: u64,
}

#[derive(Debug, Clone, Serialize, Deserialize, AbiType)]
#[serde(crate = "calimero_sdk::serde")]
pub struct ActivityView {
    pub id: String,
    pub deal_id: Option<String>,
    /// The deal's title, resolved here so the to-do list needs no join.
    pub deal_title: Option<String>,
    pub contact_id: Option<String>,
    pub kind: String,
    pub subject: String,
    pub due_at: u64,
    pub done: bool,
    pub done_at: Option<u64>,
    pub owner: Option<String>,
    pub note: String,
    pub automation_id: Option<String>,
    pub created_by: String,
    pub created_at: u64,
}

#[derive(Debug, Clone, Serialize, Deserialize, AbiType)]
#[serde(crate = "calimero_sdk::serde")]
pub struct NoteView {
    pub id: String,
    pub deal_id: String,
    pub author: String,
    pub body: String,
    pub created_at: u64,
}

#[derive(Debug, Clone, Serialize, Deserialize, AbiType)]
#[serde(crate = "calimero_sdk::serde")]
pub struct AutomationView {
    pub id: String,
    pub stage_id: String,
    pub kind: String,
    pub subject: String,
    pub due_in_days: u32,
    pub enabled: bool,
    pub created_by: String,
    pub created_at: u64,
}

/// A deal with everything the detail page shows (named struct, never a tuple).
#[derive(Debug, Clone, Serialize, Deserialize, AbiType)]
#[serde(crate = "calimero_sdk::serde")]
pub struct DealDetail {
    pub deal: DealView,
    pub contact: Option<ContactView>,
    pub activities: Vec<ActivityView>,
    pub notes: Vec<NoteView>,
}

#[derive(Debug, Clone, Serialize, Deserialize, AbiType)]
#[serde(crate = "calimero_sdk::serde")]
pub struct Settings {
    pub currency: String,
    pub rotting_days: u32,
}

// ---------------------------------------------------------------------------
// State
// ---------------------------------------------------------------------------

#[app::state(emits = for<'a> Event<'a>)]
pub struct Crm {
    stages: UnorderedMap<String, Stage>,
    deals: IndexedMap<String, Deal>,
    contacts: UnorderedMap<String, Contact>,
    activities: IndexedMap<String, Activity>,
    notes: Authored<IndexedMap<String, Note>>,
    automations: IndexedMap<String, Automation>,
    /// Record id → when it was created, written once with the record by the
    /// account that created it. That owner stamp IS the record's `created_by`:
    /// no node accepts a rewrite of it, so neither can anyone take over a
    /// record's authorship by writing a field.
    created_by: WriteOnce<UnorderedMap<String, u64>>,
    currency: LwwRegister<String>,
    rotting_days: LwwRegister<u32>,
}

/// Fetch a mutable entry or bail with `not found`.
macro_rules! get_mut_or_404 {
    ($map:expr, $id:expr, $what:literal) => {
        $map.get_mut(&$id)
            .map_err(|e| AppError::msg(format!(concat!($what, ".get_mut: {}"), e)))?
            .ok_or_else(|| not_found($what, &$id))?
    };
}

/// Mutate an `IndexedMap` entry in place, keeping its indexes in step, or bail
/// with `not found`.
macro_rules! update_or_404 {
    ($map:expr, $id:expr, $what:literal, $f:expr) => {
        $map.update(&$id, $f)
            .map_err(|e| AppError::msg(format!(concat!($what, ".update: {}"), e)))?
            .ok_or_else(|| not_found($what, &$id))?
    };
}

#[app::logic]
impl Crm {
    #[app::init]
    pub fn init() -> Crm {
        let mut stages = UnorderedMap::new_with_field_name("crm:stages");
        for (position, (id, name, probability)) in DEFAULT_STAGES.iter().enumerate() {
            let _ = stages.insert(
                (*id).to_string(),
                Stage {
                    id: (*id).to_string(),
                    name: LwwRegister::new((*name).to_string()),
                    probability: LwwRegister::new(*probability),
                    position: LwwRegister::new(position as u32),
                    created_at: 0,
                },
            );
        }
        Crm {
            stages,
            deals: IndexedMap::new_with_field_name("crm:deals"),
            contacts: UnorderedMap::new_with_field_name("crm:contacts"),
            activities: IndexedMap::new_with_field_name("crm:activities"),
            notes: Authored::new_with_field_name("crm:notes"),
            automations: IndexedMap::new_with_field_name("crm:automations"),
            created_by: WriteOnce::new_with_field_name("crm:created_by"),
            currency: LwwRegister::new(DEFAULT_CURRENCY.to_string()),
            rotting_days: LwwRegister::new(DEFAULT_ROTTING_DAYS),
        }
    }

    // ── Settings ────────────────────────────────────────────────────────────

    pub fn get_settings(&self) -> app::Result<Settings> {
        Ok(Settings {
            currency: self.currency.get().clone(),
            // Clamped on read: any member can write the register, so the range
            // `set_rotting_days` checks is only a promise about honest nodes.
            rotting_days: (*self.rotting_days.get()).clamp(1, 365),
        })
    }

    /// Set the pipeline currency: a three-letter ISO 4217 code such as `EUR`.
    pub fn set_currency(&mut self, currency: String) -> app::Result<()> {
        let code = currency.trim().to_ascii_uppercase();
        if code.len() != 3 || !code.chars().all(|c| c.is_ascii_alphabetic()) {
            return Err(invalid("currency must be a three-letter code such as USD"));
        }
        self.currency.set(code);
        app::emit!(Event::SettingsChanged {});
        Ok(())
    }

    /// Days without activity before an open deal is flagged as rotting (1..=365).
    pub fn set_rotting_days(&mut self, days: u32) -> app::Result<()> {
        if !(1..=365).contains(&days) {
            return Err(invalid("rotting_days must be between 1 and 365"));
        }
        self.rotting_days.set(days);
        app::emit!(Event::SettingsChanged {});
        Ok(())
    }

    // ── Stages ──────────────────────────────────────────────────────────────

    /// Stages in pipeline order.
    pub fn list_stages(&self) -> app::Result<Vec<StageView>> {
        let mut out: Vec<StageView> = self
            .stages
            .entries()
            .map_err(|e| AppError::msg(format!("stages.entries: {e}")))?
            .map(|(_, s)| stage_view(&s))
            .collect();
        out.sort_by(|a, b| (a.position, &a.id).cmp(&(b.position, &b.id)));
        Ok(out)
    }

    /// Append a stage at the end of the pipeline. Returns its id.
    pub fn add_stage(&mut self, name: String, probability: u32) -> app::Result<String> {
        validate_name("stage name", &name)?;
        validate_probability(probability)?;
        let existing = self.list_stages()?;
        if existing.len() >= MAX_STAGES {
            return Err(invalid("a pipeline can have at most 12 stages"));
        }
        let position = existing.last().map(|s| s.position + 1).unwrap_or(0);
        let now = now_ms();
        let id = new_id("stage", now);
        self.stages
            .insert(
                id.clone(),
                Stage {
                    id: id.clone(),
                    name: LwwRegister::new(name.trim().to_string()),
                    probability: LwwRegister::new(probability),
                    position: LwwRegister::new(position),
                    created_at: now,
                },
            )
            .map_err(|e| AppError::msg(format!("stages.insert: {e}")))?;
        app::emit!(Event::StagesChanged {});
        Ok(id)
    }

    /// Rename a stage and/or change its win probability.
    pub fn update_stage(
        &mut self,
        stage_id: String,
        name: String,
        probability: u32,
    ) -> app::Result<()> {
        validate_name("stage name", &name)?;
        validate_probability(probability)?;
        let mut guard = get_mut_or_404!(self.stages, stage_id, "stage");
        set_if_changed(&mut guard.name, name.trim().to_string());
        set_if_changed(&mut guard.probability, probability);
        drop(guard);
        app::emit!(Event::StagesChanged {});
        Ok(())
    }

    /// Reorder the pipeline. `stage_ids` must name every stage exactly once.
    pub fn reorder_stages(&mut self, stage_ids: Vec<String>) -> app::Result<()> {
        let mut current: Vec<String> = self.list_stages()?.into_iter().map(|s| s.id).collect();
        let mut given = stage_ids.clone();
        current.sort();
        given.sort();
        if current != given {
            return Err(invalid("stage_ids must list every stage exactly once"));
        }
        for (position, id) in stage_ids.iter().enumerate() {
            let mut guard = get_mut_or_404!(self.stages, *id, "stage");
            set_if_changed(&mut guard.position, position as u32);
        }
        app::emit!(Event::StagesChanged {});
        Ok(())
    }

    /// Remove a stage. Refused while any open deal sits in it, and for the last
    /// remaining stage — a pipeline always has somewhere to put a deal. A deal
    /// moved into it concurrently is not lost: the board shows a deal whose
    /// stage is gone in the first stage (see `deal_view`).
    pub fn delete_stage(&mut self, stage_id: String) -> app::Result<()> {
        if !self.stage_exists(&stage_id)? {
            return Err(not_found("stage", &stage_id));
        }
        if self.list_stages()?.len() <= 1 {
            return Err(invalid("a pipeline needs at least one stage"));
        }
        let occupied = self
            .deals
            .query("stage_id")
            .eq(stage_id.as_str())
            .entries()?
            .iter()
            .any(|(_, d)| d.status.get() == "open");
        if occupied {
            return Err(invalid("move the open deals out of this stage first"));
        }
        for id in self
            .automations
            .query("stage_id")
            .eq(stage_id.as_str())
            .keys()?
        {
            self.automations
                .remove(&id)
                .map_err(|e| AppError::msg(format!("automations.remove: {e}")))?;
        }
        self.stages
            .remove(&stage_id)
            .map_err(|e| AppError::msg(format!("stages.remove: {e}")))?;
        app::emit!(Event::StagesChanged {});
        Ok(())
    }

    // ── Deals ───────────────────────────────────────────────────────────────

    /// Add a deal to a stage. Returns its id. Runs the stage's automations.
    //
    // Scoped allow, not a refactor: each argument is a named field in the
    // generated client and in every merobox `args:` payload, so collapsing them
    // into a struct would change the ABI for a lint's sake.
    #[allow(clippy::too_many_arguments)]
    pub fn create_deal(
        &mut self,
        title: String,
        value: u64,
        organization: String,
        contact_id: Option<String>,
        stage_id: String,
        owner: Option<String>,
        expected_close: Option<u64>,
        source: String,
    ) -> app::Result<String> {
        validate_name("title", &title)?;
        validate_optional_name("organization", &organization)?;
        validate_optional_name("source", &source)?;
        if !self.stage_exists(&stage_id)? {
            return Err(not_found("stage", &stage_id));
        }
        let contact_id = normalize_opt(contact_id);
        if let Some(cid) = &contact_id {
            if !self.contact_exists(cid)? {
                return Err(not_found("contact", cid));
            }
        }
        let now = now_ms();
        let id = new_id("deal", now);
        let deal = Deal {
            id: id.clone(),
            title: LwwRegister::new(title.trim().to_string()),
            value: LwwRegister::new(value),
            organization: LwwRegister::new(organization.trim().to_string()),
            contact_id: LwwRegister::new(contact_id),
            owner: LwwRegister::new(normalize_opt(owner)),
            stage_id: LwwRegister::new(stage_id.clone()),
            status: LwwRegister::new("open".to_string()),
            lost_reason: LwwRegister::new(String::new()),
            expected_close: LwwRegister::new(expected_close),
            source: LwwRegister::new(source.trim().to_string()),
            stage_entered_at: LwwRegister::new(now),
            closed_at: LwwRegister::new(None),
            created_at: now,
        };
        self.deals
            .insert(id.clone(), deal)
            .map_err(|e| AppError::msg(format!("deals.insert: {e}")))?;
        self.record_creator(&id, now)?;
        app::emit!(Event::DealCreated {
            id: &id,
            stage_id: &stage_id,
        });
        self.run_automations(&id, &stage_id, now)?;
        Ok(id)
    }

    /// Edit a deal's fields. Only fields whose value differs are written, so a
    /// concurrent teammate edit to another field survives.
    #[allow(clippy::too_many_arguments)]
    pub fn update_deal(
        &mut self,
        deal_id: String,
        title: String,
        value: u64,
        organization: String,
        contact_id: Option<String>,
        owner: Option<String>,
        expected_close: Option<u64>,
        source: String,
    ) -> app::Result<()> {
        validate_name("title", &title)?;
        validate_optional_name("organization", &organization)?;
        validate_optional_name("source", &source)?;
        let contact_id = normalize_opt(contact_id);
        if let Some(cid) = &contact_id {
            if !self.contact_exists(cid)? {
                return Err(not_found("contact", cid));
            }
        }
        update_or_404!(self.deals, deal_id, "deal", |d| {
            set_if_changed(&mut d.title, title.trim().to_string());
            set_if_changed(&mut d.value, value);
            set_if_changed(&mut d.organization, organization.trim().to_string());
            set_if_changed(&mut d.contact_id, contact_id);
            set_if_changed(&mut d.owner, normalize_opt(owner));
            set_if_changed(&mut d.expected_close, expected_close);
            set_if_changed(&mut d.source, source.trim().to_string());
        });
        app::emit!(Event::DealUpdated { id: &deal_id });
        Ok(())
    }

    /// Move an open deal to another stage and run that stage's automations.
    /// Moving to the stage it is already in is a no-op.
    pub fn move_deal(&mut self, deal_id: String, stage_id: String) -> app::Result<()> {
        if !self.stage_exists(&stage_id)? {
            return Err(not_found("stage", &stage_id));
        }
        let now = now_ms();
        let deal = self.load_deal(&deal_id)?;
        if deal.status.get() != "open" {
            return Err(invalid("reopen a closed deal before moving it"));
        }
        if deal.stage_id.get() == &stage_id {
            return Ok(());
        }
        update_or_404!(self.deals, deal_id, "deal", |d| {
            d.stage_id.set(stage_id.clone());
            d.stage_entered_at.set(now);
        });
        app::emit!(Event::DealMoved {
            id: &deal_id,
            stage_id: &stage_id,
        });
        self.run_automations(&deal_id, &stage_id, now)
    }

    /// Close a deal as won.
    pub fn mark_won(&mut self, deal_id: String) -> app::Result<()> {
        self.close_deal(deal_id, "won", String::new())
    }

    /// Close a deal as lost, with the reason (feeds the lost-reasons report).
    pub fn mark_lost(&mut self, deal_id: String, reason: String) -> app::Result<()> {
        validate_optional_name("reason", &reason)?;
        self.close_deal(deal_id, "lost", reason.trim().to_string())
    }

    /// Put a closed deal back on the board, in the stage it closed from.
    pub fn reopen_deal(&mut self, deal_id: String) -> app::Result<()> {
        let now = now_ms();
        if self.load_deal(&deal_id)?.status.get() == "open" {
            return Ok(());
        }
        update_or_404!(self.deals, deal_id, "deal", |d| {
            d.status.set("open".to_string());
            d.lost_reason.set(String::new());
            d.closed_at.set(None);
            d.stage_entered_at.set(now);
        });
        app::emit!(Event::DealStatusChanged {
            id: &deal_id,
            status: "open",
        });
        Ok(())
    }

    /// Deals, optionally filtered by status, stage and owner, newest first.
    ///
    /// The most selective filter given is an index seek; the others filter
    /// what it returns.
    pub fn list_deals(
        &self,
        status: Option<String>,
        stage_id: Option<String>,
        owner: Option<String>,
    ) -> app::Result<Vec<DealView>> {
        let rows: Vec<(String, Deal)> = if let Some(s) = &stage_id {
            self.deals.query("stage_id").eq(s.as_str()).entries()?
        } else if let Some(o) = &owner {
            self.deals.query("owner").eq(o.as_str()).entries()?
        } else if let Some(s) = &status {
            self.deals.query("status").eq(s.as_str()).entries()?
        } else {
            self.deals
                .entries()
                .map_err(|e| AppError::msg(format!("deals.entries: {e}")))?
                .collect()
        };
        let index = self.deal_index()?;
        let mut out: Vec<DealView> = rows
            .into_iter()
            .filter(|(_, d)| status.as_ref().is_none_or(|s| d.status.get() == s))
            .filter(|(_, d)| stage_id.as_ref().is_none_or(|s| d.stage_id.get() == s))
            .filter(|(_, d)| {
                owner
                    .as_ref()
                    .is_none_or(|o| d.owner.get().as_deref() == Some(o.as_str()))
            })
            .map(|(_, d)| deal_view(&d, &index, self.creator_of(&d.id)))
            .collect();
        out.sort_by(|a, b| (b.created_at, &b.id).cmp(&(a.created_at, &a.id)));
        Ok(out)
    }

    /// One deal with its person, activities (by due date) and notes (newest
    /// first). Reads only that deal's rows: its activities and notes are index
    /// seeks, its person one lookup.
    pub fn get_deal(&self, deal_id: String) -> app::Result<DealDetail> {
        let deal = self.load_deal(&deal_id)?;
        let activities: Vec<Activity> = self
            .activities
            .query("deal_id")
            .eq(deal_id.as_str())
            .entries()?
            .into_iter()
            .map(|(_, a)| a)
            .collect();
        let notes: Vec<(String, Note)> =
            self.notes.query("deal_id").eq(deal_id.as_str()).entries()?;

        let mut facts = BTreeMap::new();
        let mut f = DealFacts::default();
        for a in &activities {
            f.add_activity(a);
        }
        for (_, n) in &notes {
            f.last_touch = f.last_touch.max(Some(n.created_at));
        }
        let _ = facts.insert(deal_id.clone(), f);
        let contact = match deal.contact_id.get() {
            Some(cid) => self.contact_detail(cid)?,
            None => None,
        };
        let index = DealIndex {
            facts,
            contact_names: contact
                .iter()
                .map(|c| (c.id.clone(), c.name.clone()))
                .collect(),
            ..self.stage_index()?
        };
        let view = deal_view(&deal, &index, self.creator_of(&deal_id));

        let title = BTreeMap::from([(deal_id.clone(), deal.title.get().clone())]);
        let mut activities: Vec<ActivityView> = activities
            .iter()
            .map(|a| activity_view(a, &title, self.creator_of(&a.id)))
            .collect();
        activities.sort_by(|a, b| (a.due_at, &a.id).cmp(&(b.due_at, &b.id)));
        let mut notes: Vec<NoteView> = notes
            .iter()
            .map(|(key, n)| note_view(n, owner_hex(self.note_author(key, n))))
            .collect();
        notes.sort_by(|a, b| (b.created_at, &b.id).cmp(&(a.created_at, &a.id)));
        Ok(DealDetail {
            deal: view,
            contact,
            activities,
            notes,
        })
    }

    /// Delete a deal with its activities and its creator's notes. Only its
    /// creator may — checked against the creation stamp, which nobody can
    /// rewrite. Other members' notes are theirs to delete; they go dark with
    /// the deal.
    pub fn delete_deal(&mut self, deal_id: String) -> app::Result<()> {
        let _ = self.load_deal(&deal_id)?;
        if self.creator_of(&deal_id) != self.caller() {
            return Err(forbidden("only the creator may delete this deal"));
        }
        let activity_ids = self
            .activities
            .query("deal_id")
            .eq(deal_id.as_str())
            .keys()?;
        let note_ids = self.notes.query("deal_id").eq(deal_id.as_str()).keys()?;
        self.deals
            .remove(&deal_id)
            .map_err(|e| AppError::msg(format!("deals.remove: {e}")))?;
        for id in activity_ids {
            self.activities
                .remove(&id)
                .map_err(|e| AppError::msg(format!("activities.remove: {e}")))?;
        }
        for id in note_ids {
            if self.notes.owned_by_me(&id)? {
                let _ = self.notes.remove(&id)?;
            }
        }
        app::emit!(Event::DealDeleted { id: &deal_id });
        Ok(())
    }

    // ── Contacts ────────────────────────────────────────────────────────────

    pub fn create_contact(
        &mut self,
        name: String,
        email: String,
        phone: String,
        organization: String,
        job_title: String,
    ) -> app::Result<String> {
        validate_contact(&name, &email, &phone, &organization, &job_title)?;
        let now = now_ms();
        let id = new_id("contact", now);
        self.contacts
            .insert(
                id.clone(),
                Contact {
                    id: id.clone(),
                    name: LwwRegister::new(name.trim().to_string()),
                    email: LwwRegister::new(email.trim().to_string()),
                    phone: LwwRegister::new(phone.trim().to_string()),
                    organization: LwwRegister::new(organization.trim().to_string()),
                    job_title: LwwRegister::new(job_title.trim().to_string()),
                    created_at: now,
                },
            )
            .map_err(|e| AppError::msg(format!("contacts.insert: {e}")))?;
        self.record_creator(&id, now)?;
        app::emit!(Event::ContactChanged { id: &id });
        Ok(id)
    }

    pub fn update_contact(
        &mut self,
        contact_id: String,
        name: String,
        email: String,
        phone: String,
        organization: String,
        job_title: String,
    ) -> app::Result<()> {
        validate_contact(&name, &email, &phone, &organization, &job_title)?;
        let mut guard = get_mut_or_404!(self.contacts, contact_id, "contact");
        set_if_changed(&mut guard.name, name.trim().to_string());
        set_if_changed(&mut guard.email, email.trim().to_string());
        set_if_changed(&mut guard.phone, phone.trim().to_string());
        set_if_changed(&mut guard.organization, organization.trim().to_string());
        set_if_changed(&mut guard.job_title, job_title.trim().to_string());
        drop(guard);
        app::emit!(Event::ContactChanged { id: &contact_id });
        Ok(())
    }

    /// Delete a person. Only their creator may (the creation stamp, again).
    /// Deals keep their history but lose the link, so no deal points at
    /// someone who no longer exists.
    pub fn delete_contact(&mut self, contact_id: String) -> app::Result<()> {
        if !self.contact_exists(&contact_id)? {
            return Err(not_found("contact", &contact_id));
        }
        if self.creator_of(&contact_id) != self.caller() {
            return Err(forbidden("only the creator may delete this contact"));
        }
        let linked = self
            .deals
            .query("contact_id")
            .eq(contact_id.as_str())
            .keys()?;
        for id in linked {
            update_or_404!(self.deals, id, "deal", |d| d.contact_id.set(None));
        }
        self.contacts
            .remove(&contact_id)
            .map_err(|e| AppError::msg(format!("contacts.remove: {e}")))?;
        app::emit!(Event::ContactChanged { id: &contact_id });
        Ok(())
    }

    /// Everyone in the address book, by name, with their deal totals.
    pub fn list_contacts(&self) -> app::Result<Vec<ContactView>> {
        let mut open: BTreeMap<String, u32> = BTreeMap::new();
        let mut won: BTreeMap<String, u64> = BTreeMap::new();
        for (_, d) in self
            .deals
            .entries()
            .map_err(|e| AppError::msg(format!("deals.entries: {e}")))?
        {
            if let Some(cid) = d.contact_id.get() {
                match d.status.get().as_str() {
                    "open" => *open.entry(cid.clone()).or_default() += 1,
                    "won" => *won.entry(cid.clone()).or_default() += *d.value.get(),
                    _ => {}
                }
            }
        }
        let mut out: Vec<ContactView> = self
            .contacts
            .entries()
            .map_err(|e| AppError::msg(format!("contacts.entries: {e}")))?
            .map(|(id, c)| {
                contact_view(
                    &c,
                    open.get(&id).copied().unwrap_or(0),
                    won.get(&id).copied().unwrap_or(0),
                    self.creator_of(&id),
                )
            })
            .collect();
        out.sort_by(|a, b| (a.name.to_lowercase(), &a.id).cmp(&(b.name.to_lowercase(), &b.id)));
        Ok(out)
    }

    // ── Activities ──────────────────────────────────────────────────────────

    #[allow(clippy::too_many_arguments)]
    pub fn add_activity(
        &mut self,
        deal_id: Option<String>,
        contact_id: Option<String>,
        kind: String,
        subject: String,
        due_at: u64,
        owner: Option<String>,
        note: String,
    ) -> app::Result<String> {
        validate_kind(&kind)?;
        validate_name("subject", &subject)?;
        validate_text("note", &note)?;
        let deal_id = normalize_opt(deal_id);
        let contact_id = normalize_opt(contact_id);
        if let Some(did) = &deal_id {
            if !self.deal_exists(did)? {
                return Err(not_found("deal", did));
            }
        }
        if let Some(cid) = &contact_id {
            if !self.contact_exists(cid)? {
                return Err(not_found("contact", cid));
            }
        }
        let now = now_ms();
        let id = self.insert_activity(
            deal_id,
            contact_id,
            kind,
            subject.trim().to_string(),
            due_at,
            normalize_opt(owner),
            note.trim().to_string(),
            None,
            now,
        )?;
        app::emit!(Event::ActivityChanged { id: &id });
        Ok(id)
    }

    /// Mark an activity done (or undo that).
    pub fn set_activity_done(&mut self, activity_id: String, done: bool) -> app::Result<()> {
        let now = now_ms();
        update_or_404!(self.activities, activity_id, "activity", |a| {
            if *a.done.get() != done {
                a.done.set(done);
                a.done_at.set(if done { Some(now) } else { None });
            }
        });
        app::emit!(Event::ActivityChanged { id: &activity_id });
        Ok(())
    }

    /// Move an activity to a new due time.
    pub fn reschedule_activity(&mut self, activity_id: String, due_at: u64) -> app::Result<()> {
        update_or_404!(self.activities, activity_id, "activity", |a| {
            set_if_changed(&mut a.due_at, due_at)
        });
        app::emit!(Event::ActivityChanged { id: &activity_id });
        Ok(())
    }

    pub fn delete_activity(&mut self, activity_id: String) -> app::Result<()> {
        if self
            .activities
            .remove(&activity_id)
            .map_err(|e| AppError::msg(format!("activities.remove: {e}")))?
            .is_none()
        {
            return Err(not_found("activity", &activity_id));
        }
        app::emit!(Event::ActivityChanged { id: &activity_id });
        Ok(())
    }

    /// Activities, optionally for one deal and/or by done-ness, by due date.
    /// One deal's activities are an index seek.
    pub fn list_activities(
        &self,
        deal_id: Option<String>,
        done: Option<bool>,
    ) -> app::Result<Vec<ActivityView>> {
        let (rows, titles): (Vec<(String, Activity)>, BTreeMap<String, String>) = match &deal_id {
            Some(did) => (
                self.activities
                    .query("deal_id")
                    .eq(did.as_str())
                    .entries()?,
                self.deals
                    .get(did)?
                    .map(|d| (did.clone(), d.title.get().clone()))
                    .into_iter()
                    .collect(),
            ),
            None => (
                self.activities
                    .entries()
                    .map_err(|e| AppError::msg(format!("activities.entries: {e}")))?
                    .collect(),
                self.deals
                    .entries()
                    .map_err(|e| AppError::msg(format!("deals.entries: {e}")))?
                    .map(|(id, d)| (id, d.title.get().clone()))
                    .collect(),
            ),
        };
        let mut out: Vec<ActivityView> = rows
            .into_iter()
            .filter(|(_, a)| done.is_none_or(|want| *a.done.get() == want))
            .map(|(id, a)| activity_view(&a, &titles, self.creator_of(&id)))
            .collect();
        out.sort_by(|a, b| (a.due_at, &a.id).cmp(&(b.due_at, &b.id)));
        Ok(out)
    }

    // ── Notes ───────────────────────────────────────────────────────────────

    pub fn add_note(&mut self, deal_id: String, body: String) -> app::Result<String> {
        if body.trim().is_empty() {
            return Err(invalid("note must not be empty"));
        }
        validate_text("note", &body)?;
        if !self.deal_exists(&deal_id)? {
            return Err(not_found("deal", &deal_id));
        }
        let now = now_ms();
        let id = new_id("note", now);
        self.notes.insert(
            id.clone(),
            Note {
                id: id.clone(),
                deal_id: deal_id.clone(),
                body: body.trim().to_string(),
                created_at: now,
            },
        )?;
        app::emit!(Event::NoteChanged {
            id: &id,
            deal_id: &deal_id,
        });
        Ok(id)
    }

    /// Delete a note. Only its author may — the entry's owner, which every
    /// node checks when it applies the removal.
    pub fn delete_note(&mut self, note_id: String) -> app::Result<()> {
        // The caller's OWN note: keys are per owner, so another account's
        // note at this id is a different entry, theirs to delete.
        let Some(note) = self.notes.get(&note_id)? else {
            if self.notes.entries_at(&note_id)?.is_empty() {
                return Err(not_found("note", &note_id));
            }
            return Err(forbidden("only the author may delete this note"));
        };
        let _ = self.notes.remove(&note_id)?;
        app::emit!(Event::NoteChanged {
            id: &note_id,
            deal_id: &note.deal_id,
        });
        Ok(())
    }

    // ── Automations ─────────────────────────────────────────────────────────

    pub fn list_automations(&self) -> app::Result<Vec<AutomationView>> {
        let mut out: Vec<AutomationView> = self
            .automations
            .entries()
            .map_err(|e| AppError::msg(format!("automations.entries: {e}")))?
            .map(|(id, a)| automation_view(&a, self.creator_of(&id)))
            .collect();
        out.sort_by(|a, b| (a.created_at, &a.id).cmp(&(b.created_at, &b.id)));
        Ok(out)
    }

    /// "When a deal enters `stage_id`, schedule a `kind` activity called
    /// `subject`, due in `due_in_days` days." Returns the rule's id.
    pub fn add_automation(
        &mut self,
        stage_id: String,
        kind: String,
        subject: String,
        due_in_days: u32,
    ) -> app::Result<String> {
        if !self.stage_exists(&stage_id)? {
            return Err(not_found("stage", &stage_id));
        }
        validate_kind(&kind)?;
        validate_name("subject", &subject)?;
        if due_in_days > 365 {
            return Err(invalid("due_in_days must be at most 365"));
        }
        if self
            .automations
            .query("stage_id")
            .eq(stage_id.as_str())
            .count()?
            >= MAX_AUTOMATIONS_PER_STAGE
        {
            return Err(invalid("a stage can have at most 10 automations"));
        }
        let now = now_ms();
        let id = new_id("auto", now);
        self.automations
            .insert(
                id.clone(),
                Automation {
                    id: id.clone(),
                    stage_id,
                    kind,
                    subject: subject.trim().to_string(),
                    due_in_days,
                    enabled: LwwRegister::new(true),
                    created_at: now,
                },
            )
            .map_err(|e| AppError::msg(format!("automations.insert: {e}")))?;
        self.record_creator(&id, now)?;
        app::emit!(Event::AutomationsChanged {});
        Ok(id)
    }

    pub fn set_automation_enabled(
        &mut self,
        automation_id: String,
        enabled: bool,
    ) -> app::Result<()> {
        update_or_404!(self.automations, automation_id, "automation", |a| {
            set_if_changed(&mut a.enabled, enabled)
        });
        app::emit!(Event::AutomationsChanged {});
        Ok(())
    }

    pub fn delete_automation(&mut self, automation_id: String) -> app::Result<()> {
        if self
            .automations
            .remove(&automation_id)
            .map_err(|e| AppError::msg(format!("automations.remove: {e}")))?
            .is_none()
        {
            return Err(not_found("automation", &automation_id));
        }
        app::emit!(Event::AutomationsChanged {});
        Ok(())
    }
}

// ---------------------------------------------------------------------------
// Internal helpers
// ---------------------------------------------------------------------------

/// Per-deal activity facts, computed in ONE pass over activities and notes so
/// listing the board is O(deals + activities), not O(deals × activities).
#[derive(Default)]
struct DealFacts {
    next: Option<NextActivity>,
    open: u32,
    last_touch: Option<u64>,
}

impl DealFacts {
    fn add_activity(&mut self, a: &Activity) {
        if *a.done.get() {
            if let Some(at) = *a.done_at.get() {
                self.last_touch = self.last_touch.max(Some(at));
            }
        } else {
            self.open += 1;
            let due = *a.due_at.get();
            let sooner = self
                .next
                .as_ref()
                .is_none_or(|n| (due, &a.id) < (n.due_at, &n.id));
            if sooner {
                self.next = Some(NextActivity {
                    id: a.id.clone(),
                    kind: a.kind.clone(),
                    subject: a.subject.get().clone(),
                    due_at: due,
                });
            }
        }
    }
}

struct DealIndex {
    facts: BTreeMap<String, DealFacts>,
    stage_probability: BTreeMap<String, u32>,
    /// Where a deal whose stage was deleted under it is shown: the first stage.
    first_stage: Option<String>,
    contact_names: BTreeMap<String, String>,
}

impl Crm {
    /// The executing ACCOUNT, hex — what `created_by` / `author` hold and what
    /// the frontend compares against for "is this mine". An account, not the
    /// device: one person's laptop and phone are one author.
    fn caller(&self) -> String {
        AccountId::from(env::account_id()).to_string()
    }

    /// Who created a record: the owner stamp of its write-once creation entry,
    /// or `""` for one that has none (the seeded default stages).
    ///
    /// Keys are per owner (core rc.57), so a patched node can file a creation
    /// entry of its own under an id someone else created. Ids are random, so
    /// an honest record has exactly one; with more than one nobody can tell
    /// which came first, and the record has no creator (`""`) rather than
    /// letting the claimant win a tie-break.
    fn creator_of(&self, id: &str) -> String {
        match self.created_by.entries_at(&id.to_owned()).ok().as_deref() {
            Some([(owner, _)]) => owner.to_string(),
            _ => String::new(),
        }
    }

    /// The author of the note `note` at `key`: the holder of `key` whose
    /// entry it is. Keys are per owner, so a key-only `owner_of` would only
    /// ever name the caller; the row is matched against every holder's entry
    /// by its bytes.
    fn note_author(&self, key: &String, note: &Note) -> Option<AccountId> {
        let row = calimero_sdk::borsh::to_vec(note).ok()?;
        self.notes
            .entries_at(key)
            .ok()?
            .into_iter()
            .filter(|(_, held)| calimero_sdk::borsh::to_vec(held).is_ok_and(|b| b == row))
            .map(|(owner, _)| owner)
            .min()
    }

    fn record_creator(&mut self, id: &str, now: u64) -> app::Result<()> {
        self.created_by.insert(id.to_owned(), now)?;
        Ok(())
    }

    fn load_deal(&self, id: &str) -> app::Result<Deal> {
        self.deals
            .get(id)
            .map_err(|e| AppError::msg(format!("deals.get: {e}")))?
            .map(|d| (*d).clone())
            .ok_or_else(|| not_found("deal", id))
    }

    fn stage_exists(&self, id: &str) -> app::Result<bool> {
        self.stages
            .contains(id)
            .map_err(|e| AppError::msg(format!("stages.contains: {e}")))
    }

    fn deal_exists(&self, id: &str) -> app::Result<bool> {
        self.deals
            .contains(id)
            .map_err(|e| AppError::msg(format!("deals.contains: {e}")))
    }

    fn contact_exists(&self, id: &str) -> app::Result<bool> {
        self.contacts
            .contains(id)
            .map_err(|e| AppError::msg(format!("contacts.contains: {e}")))
    }

    /// One person, with their deal totals read through the `contact_id` index.
    fn contact_detail(&self, id: &str) -> app::Result<Option<ContactView>> {
        let Some(c) = self
            .contacts
            .get(id)
            .map_err(|e| AppError::msg(format!("contacts.get: {e}")))?
        else {
            return Ok(None);
        };
        let (mut open, mut won) = (0u32, 0u64);
        for (_, d) in self.deals.query("contact_id").eq(id).entries()? {
            match d.status.get().as_str() {
                "open" => open += 1,
                "won" => won += *d.value.get(),
                _ => {}
            }
        }
        Ok(Some(contact_view(&c, open, won, self.creator_of(id))))
    }

    fn close_deal(&mut self, deal_id: String, status: &str, reason: String) -> app::Result<()> {
        let now = now_ms();
        update_or_404!(self.deals, deal_id, "deal", |d| {
            d.status.set(status.to_string());
            d.lost_reason.set(reason);
            d.closed_at.set(Some(now));
        });
        app::emit!(Event::DealStatusChanged {
            id: &deal_id,
            status,
        });
        Ok(())
    }

    #[allow(clippy::too_many_arguments)]
    fn insert_activity(
        &mut self,
        deal_id: Option<String>,
        contact_id: Option<String>,
        kind: String,
        subject: String,
        due_at: u64,
        owner: Option<String>,
        note: String,
        automation_id: Option<String>,
        now: u64,
    ) -> app::Result<String> {
        let id = new_id("activity", now);
        self.activities
            .insert(
                id.clone(),
                Activity {
                    id: id.clone(),
                    deal_id,
                    contact_id,
                    kind,
                    subject: LwwRegister::new(subject),
                    due_at: LwwRegister::new(due_at),
                    done: LwwRegister::new(false),
                    done_at: LwwRegister::new(None),
                    owner: LwwRegister::new(owner),
                    note: LwwRegister::new(note),
                    automation_id,
                    created_at: now,
                },
            )
            .map_err(|e| AppError::msg(format!("activities.insert: {e}")))?;
        self.record_creator(&id, now)?;
        Ok(id)
    }

    /// Schedule the stage's enabled automations against the deal — the first
    /// `MAX_AUTOMATIONS_PER_STAGE` of them, oldest first, however many the
    /// stage holds. The activity is owned by the deal's owner, so the
    /// follow-up lands on the right person's list.
    fn run_automations(&mut self, deal_id: &str, stage_id: &str, now: u64) -> app::Result<()> {
        let mut rules: Vec<Automation> = self
            .automations
            .query("stage_id")
            .eq(stage_id)
            .entries()?
            .into_iter()
            .map(|(_, a)| a)
            .filter(|a| *a.enabled.get())
            .collect();
        if rules.is_empty() {
            return Ok(());
        }
        rules.sort_by(|a, b| (a.created_at, &a.id).cmp(&(b.created_at, &b.id)));
        rules.truncate(MAX_AUTOMATIONS_PER_STAGE);
        let (owner, contact_id) = self
            .deals
            .get(deal_id)
            .map_err(|e| AppError::msg(format!("deals.get: {e}")))?
            .map(|d| (d.owner.get().clone(), d.contact_id.get().clone()))
            .unwrap_or((None, None));
        for rule in rules {
            self.insert_activity(
                Some(deal_id.to_string()),
                contact_id.clone(),
                rule.kind.clone(),
                rule.subject.clone(),
                now + u64::from(rule.due_in_days.min(365)) * DAY_MS,
                owner.clone(),
                String::new(),
                Some(rule.id.clone()),
                now,
            )?;
            app::emit!(Event::AutomationFired {
                automation_id: &rule.id,
                deal_id,
            });
        }
        Ok(())
    }

    /// Stage probabilities and the first stage — small, read whole.
    fn stage_index(&self) -> app::Result<DealIndex> {
        let stages = self.list_stages()?;
        Ok(DealIndex {
            facts: BTreeMap::new(),
            first_stage: stages.first().map(|s| s.id.clone()),
            stage_probability: stages.into_iter().map(|s| (s.id, s.probability)).collect(),
            contact_names: BTreeMap::new(),
        })
    }

    fn deal_index(&self) -> app::Result<DealIndex> {
        let mut facts: BTreeMap<String, DealFacts> = BTreeMap::new();
        for (_, a) in self
            .activities
            .entries()
            .map_err(|e| AppError::msg(format!("activities.entries: {e}")))?
        {
            let Some(did) = a.deal_id.clone() else {
                continue;
            };
            facts.entry(did).or_default().add_activity(&a);
        }
        for (_, n) in self.notes.entries()? {
            let f = facts.entry(n.deal_id.clone()).or_default();
            f.last_touch = f.last_touch.max(Some(n.created_at));
        }
        let contact_names = self
            .contacts
            .entries()
            .map_err(|e| AppError::msg(format!("contacts.entries: {e}")))?
            .map(|(id, c)| (id, c.name.get().clone()))
            .collect();
        Ok(DealIndex {
            facts,
            contact_names,
            ..self.stage_index()?
        })
    }
}

fn owner_hex(owner: Option<AccountId>) -> String {
    owner.map(|o| o.to_string()).unwrap_or_default()
}

fn deal_view(d: &Deal, index: &DealIndex, created_by: String) -> DealView {
    let status = d.status.get().clone();
    // A deal moved into a stage while someone deleted it would otherwise sit in
    // a column that no longer exists, invisible on every board.
    let stage_id = if index.stage_probability.contains_key(d.stage_id.get()) {
        d.stage_id.get().clone()
    } else {
        index
            .first_stage
            .clone()
            .unwrap_or_else(|| d.stage_id.get().clone())
    };
    let probability = match status.as_str() {
        "won" => 100,
        "lost" => 0,
        _ => index.stage_probability.get(&stage_id).copied().unwrap_or(0),
    };
    let facts = index.facts.get(&d.id);
    let contact_id = d.contact_id.get().clone();
    DealView {
        id: d.id.clone(),
        title: d.title.get().clone(),
        value: *d.value.get(),
        organization: d.organization.get().clone(),
        contact_name: contact_id
            .as_ref()
            .and_then(|c| index.contact_names.get(c).cloned()),
        contact_id,
        owner: d.owner.get().clone(),
        stage_id,
        status,
        lost_reason: d.lost_reason.get().clone(),
        expected_close: *d.expected_close.get(),
        source: d.source.get().clone(),
        probability,
        stage_entered_at: *d.stage_entered_at.get(),
        closed_at: *d.closed_at.get(),
        next_activity: facts.and_then(|f| f.next.clone()),
        open_activities: facts.map(|f| f.open).unwrap_or(0),
        last_touch_at: facts.and_then(|f| f.last_touch),
        created_by,
        created_at: d.created_at,
    }
}

fn stage_view(s: &Stage) -> StageView {
    StageView {
        id: s.id.clone(),
        name: s.name.get().clone(),
        // Clamped on read: `validate_probability` only binds honest writers.
        probability: (*s.probability.get()).min(100),
        position: *s.position.get(),
    }
}

fn contact_view(c: &Contact, open_deals: u32, won_value: u64, created_by: String) -> ContactView {
    ContactView {
        id: c.id.clone(),
        name: c.name.get().clone(),
        email: c.email.get().clone(),
        phone: c.phone.get().clone(),
        organization: c.organization.get().clone(),
        job_title: c.job_title.get().clone(),
        open_deals,
        won_value,
        created_by,
        created_at: c.created_at,
    }
}

fn activity_view(
    a: &Activity,
    titles: &BTreeMap<String, String>,
    created_by: String,
) -> ActivityView {
    ActivityView {
        id: a.id.clone(),
        deal_title: a.deal_id.as_ref().and_then(|d| titles.get(d).cloned()),
        deal_id: a.deal_id.clone(),
        contact_id: a.contact_id.clone(),
        kind: a.kind.clone(),
        subject: a.subject.get().clone(),
        due_at: *a.due_at.get(),
        done: *a.done.get(),
        done_at: *a.done_at.get(),
        owner: a.owner.get().clone(),
        note: a.note.get().clone(),
        automation_id: a.automation_id.clone(),
        created_by,
        created_at: a.created_at,
    }
}

fn note_view(n: &Note, author: String) -> NoteView {
    NoteView {
        id: n.id.clone(),
        deal_id: n.deal_id.clone(),
        author,
        body: n.body.clone(),
        created_at: n.created_at,
    }
}

fn automation_view(a: &Automation, created_by: String) -> AutomationView {
    AutomationView {
        id: a.id.clone(),
        stage_id: a.stage_id.clone(),
        kind: a.kind.clone(),
        subject: a.subject.clone(),
        due_in_days: a.due_in_days,
        enabled: *a.enabled.get(),
        created_by,
        created_at: a.created_at,
    }
}

/// Write a register only when the value actually changes (see module docs).
fn set_if_changed<T: PartialEq>(reg: &mut LwwRegister<T>, value: T) {
    if reg.get() != &value {
        reg.set(value);
    }
}

fn now_ms() -> u64 {
    storage_env::time_now() / 1_000_000
}

/// `{prefix}-{ms}-{8 hex}` — sortable by creation, collision-safe across peers.
fn new_id(prefix: &str, now: u64) -> String {
    let mut nonce = [0u8; 4];
    env::random_bytes(&mut nonce);
    format!("{prefix}-{now}-{}", hex::encode(nonce))
}

/// `Some("")` / `Some("  ")` mean "none" — the form sends empty strings.
fn normalize_opt(v: Option<String>) -> Option<String> {
    v.map(|s| s.trim().to_string()).filter(|s| !s.is_empty())
}

fn not_found(what: &str, id: &str) -> AppError {
    AppError::msg(format!("not found: {what} {id}"))
}

fn invalid(msg: &str) -> AppError {
    AppError::msg(format!("invalid input: {msg}"))
}

fn forbidden(msg: &str) -> AppError {
    AppError::msg(format!("forbidden: {msg}"))
}

fn validate_name(field: &str, v: &str) -> app::Result<()> {
    if v.trim().is_empty() {
        return Err(invalid(&format!("{field} must not be empty")));
    }
    validate_optional_name(field, v)
}

fn validate_optional_name(field: &str, v: &str) -> app::Result<()> {
    if v.trim().chars().count() > MAX_NAME_LEN {
        return Err(invalid(&format!(
            "{field} must be at most {MAX_NAME_LEN} characters"
        )));
    }
    Ok(())
}

fn validate_text(field: &str, v: &str) -> app::Result<()> {
    if v.chars().count() > MAX_TEXT_LEN {
        return Err(invalid(&format!(
            "{field} must be at most {MAX_TEXT_LEN} characters"
        )));
    }
    Ok(())
}

fn validate_probability(p: u32) -> app::Result<()> {
    if p > 100 {
        return Err(invalid("probability must be between 0 and 100"));
    }
    Ok(())
}

fn validate_kind(kind: &str) -> app::Result<()> {
    if ACTIVITY_KINDS.contains(&kind) {
        Ok(())
    } else {
        Err(invalid(&format!("kind must be one of {ACTIVITY_KINDS:?}")))
    }
}

fn validate_contact(
    name: &str,
    email: &str,
    phone: &str,
    organization: &str,
    job_title: &str,
) -> app::Result<()> {
    validate_name("name", name)?;
    validate_optional_name("email", email)?;
    validate_optional_name("phone", phone)?;
    validate_optional_name("organization", organization)?;
    validate_optional_name("job_title", job_title)?;
    let email = email.trim();
    if !email.is_empty() && (!email.contains('@') || email.contains(' ')) {
        return Err(invalid("email must look like name@example.com"));
    }
    Ok(())
}

// ---------------------------------------------------------------------------
// In-process tests — one TestHost roundtrip per mutation.
// ---------------------------------------------------------------------------

#[cfg(test)]
mod tests {
    use calimero_sdk::testing::TestHost;

    use super::*;

    /// Another PERSON: an account and a device of their own. `call_as` alone
    /// would be the creator's second device, which the gates rightly let in.
    const OTHER: [u8; 32] = [0x22; 32];
    const CREATOR_PHONE: [u8; 32] = [0x33; 32];

    fn deal(app: &mut TestHost<Crm>, title: &str, value: u64, stage: &str) -> String {
        app.call(|s| {
            s.create_deal(
                title.into(),
                value,
                "Acme".into(),
                None,
                stage.into(),
                Some("alice".into()),
                None,
                "referral".into(),
            )
        })
        .unwrap()
    }

    #[test]
    fn init_seeds_ordered_default_stages_and_settings() {
        let app = TestHost::new(Crm::init);
        let stages = app.view(|s| s.list_stages()).unwrap();
        let names: Vec<&str> = stages.iter().map(|s| s.name.as_str()).collect();
        assert_eq!(
            names,
            ["Lead in", "Qualified", "Meeting", "Proposal", "Negotiation"]
        );
        assert!(stages
            .windows(2)
            .all(|w| w[0].probability < w[1].probability));
        let settings = app.view(|s| s.get_settings()).unwrap();
        assert_eq!(settings.currency, "USD");
        assert_eq!(settings.rotting_days, 14);
    }

    #[test]
    fn create_deal_lists_open_with_stage_probability() {
        let mut app = TestHost::new(Crm::init);
        let id = deal(&mut app, "Big one", 12_000, "stage-proposal");
        let deals = app.view(|s| s.list_deals(None, None, None)).unwrap();
        assert_eq!(deals.len(), 1);
        let d = &deals[0];
        assert_eq!(d.id, id);
        assert_eq!(d.status, "open");
        assert_eq!(d.value, 12_000);
        assert_eq!(d.probability, 60);
        assert_eq!(d.owner.as_deref(), Some("alice"));
        assert!(d.next_activity.is_none());
    }

    #[test]
    fn create_deal_rejects_unknown_stage_contact_and_blank_title() {
        let mut app = TestHost::new(Crm::init);
        let bad = |app: &mut TestHost<Crm>, title: &str, stage: &str, contact: Option<&str>| {
            app.call(|s| {
                s.create_deal(
                    title.into(),
                    1,
                    String::new(),
                    contact.map(Into::into),
                    stage.into(),
                    None,
                    None,
                    String::new(),
                )
            })
            .is_err()
        };
        assert!(bad(&mut app, "x", "stage-nope", None));
        assert!(bad(&mut app, "x", "stage-lead", Some("contact-nope")));
        assert!(bad(&mut app, "   ", "stage-lead", None));
    }

    #[test]
    fn move_close_and_reopen_deal() {
        let mut app = TestHost::new(Crm::init);
        let id = deal(&mut app, "D", 500, "stage-lead");
        app.call(|s| s.move_deal(id.clone(), "stage-negotiation".into()))
            .unwrap();
        let d = app.view(|s| s.get_deal(id.clone())).unwrap().deal;
        assert_eq!(d.stage_id, "stage-negotiation");
        assert_eq!(d.probability, 80);

        app.call(|s| s.mark_lost(id.clone(), "Price".into()))
            .unwrap();
        let d = app.view(|s| s.get_deal(id.clone())).unwrap().deal;
        assert_eq!((d.status.as_str(), d.probability), ("lost", 0));
        assert_eq!(d.lost_reason, "Price");
        assert!(d.closed_at.is_some());
        // A closed deal can't be dragged around the board.
        assert!(app
            .call(|s| s.move_deal(id.clone(), "stage-lead".into()))
            .is_err());

        app.call(|s| s.reopen_deal(id.clone())).unwrap();
        let d = app.view(|s| s.get_deal(id.clone())).unwrap().deal;
        assert_eq!(d.status, "open");
        assert_eq!(d.stage_id, "stage-negotiation");
        assert_eq!(d.lost_reason, "");

        app.call(|s| s.mark_won(id.clone())).unwrap();
        let won = app
            .view(|s| s.list_deals(Some("won".into()), None, None))
            .unwrap();
        assert_eq!(won.len(), 1);
        assert_eq!(won[0].probability, 100);
    }

    #[test]
    fn list_deals_filters() {
        let mut app = TestHost::new(Crm::init);
        let a = deal(&mut app, "A", 1, "stage-lead");
        let _b = deal(&mut app, "B", 2, "stage-meeting");
        app.call(|s| {
            s.update_deal(
                a.clone(),
                "A".into(),
                1,
                "Acme".into(),
                None,
                Some("bob".into()),
                None,
                "referral".into(),
            )
        })
        .unwrap();
        let lead = app
            .view(|s| s.list_deals(None, Some("stage-lead".into()), None))
            .unwrap();
        assert_eq!(lead.len(), 1);
        assert_eq!(lead[0].id, a);
        let bob = app
            .view(|s| s.list_deals(None, None, Some("bob".into())))
            .unwrap();
        assert_eq!(bob.len(), 1);
        assert_eq!(bob[0].id, a);
        assert!(app
            .view(|s| s.list_deals(Some("won".into()), None, None))
            .unwrap()
            .is_empty());
    }

    #[test]
    fn update_deal_edits_fields_and_links_contact() {
        let mut app = TestHost::new(Crm::init);
        let id = deal(&mut app, "Old", 10, "stage-lead");
        let c = app
            .call(|s| {
                s.create_contact(
                    "Ada Lovelace".into(),
                    "ada@example.com".into(),
                    "".into(),
                    "Analytical".into(),
                    "CTO".into(),
                )
            })
            .unwrap();
        app.call(|s| {
            s.update_deal(
                id.clone(),
                "New".into(),
                99,
                "Analytical".into(),
                Some(c.clone()),
                None,
                Some(1_800_000_000_000),
                "".into(),
            )
        })
        .unwrap();
        let detail = app.view(|s| s.get_deal(id.clone())).unwrap();
        assert_eq!(detail.deal.title, "New");
        assert_eq!(detail.deal.value, 99);
        assert_eq!(detail.deal.owner, None);
        assert_eq!(detail.deal.contact_name.as_deref(), Some("Ada Lovelace"));
        assert_eq!(detail.deal.expected_close, Some(1_800_000_000_000));
        assert_eq!(detail.contact.unwrap().open_deals, 1);
    }

    #[test]
    fn activities_drive_next_step_and_last_touch() {
        let mut app = TestHost::new(Crm::init);
        let id = deal(&mut app, "D", 1, "stage-lead");
        let later = app
            .call(|s| {
                s.add_activity(
                    Some(id.clone()),
                    None,
                    "meeting".into(),
                    "Demo".into(),
                    2_000,
                    None,
                    "".into(),
                )
            })
            .unwrap();
        let sooner = app
            .call(|s| {
                s.add_activity(
                    Some(id.clone()),
                    None,
                    "call".into(),
                    "Intro call".into(),
                    1_000,
                    None,
                    "".into(),
                )
            })
            .unwrap();
        let d = app.view(|s| s.get_deal(id.clone())).unwrap().deal;
        assert_eq!(d.open_activities, 2);
        assert_eq!(d.next_activity.unwrap().id, sooner);
        assert_eq!(d.last_touch_at, None);

        app.call(|s| s.set_activity_done(sooner.clone(), true))
            .unwrap();
        let d = app.view(|s| s.get_deal(id.clone())).unwrap().deal;
        assert_eq!(d.open_activities, 1);
        assert_eq!(d.next_activity.unwrap().id, later);
        assert!(d.last_touch_at.is_some());

        app.call(|s| s.reschedule_activity(later.clone(), 5_000))
            .unwrap();
        let open = app.view(|s| s.list_activities(None, Some(false))).unwrap();
        assert_eq!(open.len(), 1);
        assert_eq!(open[0].due_at, 5_000);
        assert_eq!(open[0].deal_title.as_deref(), Some("D"));

        app.call(|s| s.delete_activity(later.clone())).unwrap();
        assert_eq!(
            app.view(|s| s.list_activities(None, None)).unwrap().len(),
            1
        );
        assert!(app
            .call(|s| s.add_activity(None, None, "fax".into(), "x".into(), 0, None, "".into()))
            .is_err());
    }

    #[test]
    fn automation_schedules_follow_up_on_stage_entry() {
        let mut app = TestHost::new(Crm::init);
        let rule = app
            .call(|s| {
                s.add_automation(
                    "stage-proposal".into(),
                    "email".into(),
                    "Send proposal".into(),
                    2,
                )
            })
            .unwrap();
        let id = deal(&mut app, "D", 1, "stage-lead");
        assert_eq!(
            app.view(|s| s.get_deal(id.clone()))
                .unwrap()
                .activities
                .len(),
            0
        );

        app.call(|s| s.move_deal(id.clone(), "stage-proposal".into()))
            .unwrap();
        let acts = app.view(|s| s.get_deal(id.clone())).unwrap().activities;
        assert_eq!(acts.len(), 1);
        assert_eq!(acts[0].subject, "Send proposal");
        assert_eq!(acts[0].automation_id.as_deref(), Some(rule.as_str()));
        assert_eq!(acts[0].owner.as_deref(), Some("alice"));

        // Created directly in the stage also fires; a disabled rule does not.
        deal(&mut app, "E", 1, "stage-proposal");
        app.call(|s| s.set_automation_enabled(rule.clone(), false))
            .unwrap();
        deal(&mut app, "F", 1, "stage-proposal");
        assert_eq!(
            app.view(|s| s.list_activities(None, None)).unwrap().len(),
            2
        );

        app.call(|s| s.delete_automation(rule.clone())).unwrap();
        assert!(app.view(|s| s.list_automations()).unwrap().is_empty());
    }

    #[test]
    fn stages_add_update_reorder_delete() {
        let mut app = TestHost::new(Crm::init);
        let won_soon = app
            .call(|s| s.add_stage("Contract sent".into(), 90))
            .unwrap();
        assert!(app.call(|s| s.add_stage("x".into(), 101)).is_err());
        app.call(|s| s.update_stage(won_soon.clone(), "Contract out".into(), 95))
            .unwrap();
        let stages = app.view(|s| s.list_stages()).unwrap();
        let last = stages.last().unwrap();
        assert_eq!((last.name.as_str(), last.probability), ("Contract out", 95));

        let mut ids: Vec<String> = stages.iter().map(|s| s.id.clone()).collect();
        ids.reverse();
        app.call(|s| s.reorder_stages(ids.clone())).unwrap();
        let first = app.view(|s| s.list_stages()).unwrap()[0].id.clone();
        assert_eq!(first, won_soon);
        assert!(app
            .call(|s| s.reorder_stages(vec!["stage-lead".into()]))
            .is_err());

        // Occupied stages can't be removed; empty ones can, with their rules.
        let d = deal(&mut app, "D", 1, "stage-lead");
        assert!(app.call(|s| s.delete_stage("stage-lead".into())).is_err());
        app.call(|s| s.mark_won(d)).unwrap();
        app.call(|s| s.add_automation("stage-lead".into(), "task".into(), "t".into(), 0))
            .unwrap();
        app.call(|s| s.delete_stage("stage-lead".into())).unwrap();
        assert!(app.view(|s| s.list_automations()).unwrap().is_empty());
        assert_eq!(app.view(|s| s.list_stages()).unwrap().len(), 5);
    }

    #[test]
    fn settings_validate() {
        let mut app = TestHost::new(Crm::init);
        app.call(|s| s.set_currency("eur".into())).unwrap();
        assert!(app.call(|s| s.set_currency("EURO".into())).is_err());
        app.call(|s| s.set_rotting_days(7)).unwrap();
        assert!(app.call(|s| s.set_rotting_days(0)).is_err());
        let settings = app.view(|s| s.get_settings()).unwrap();
        assert_eq!(
            (settings.currency.as_str(), settings.rotting_days),
            ("EUR", 7)
        );
    }

    #[test]
    fn contacts_crud_and_delete_unlinks_deals() {
        let mut app = TestHost::new(Crm::init);
        assert!(app
            .call(|s| s.create_contact(
                "X".into(),
                "not-an-email".into(),
                "".into(),
                "".into(),
                "".into()
            ))
            .is_err());
        let c = app
            .call(|s| {
                s.create_contact(
                    "Grace".into(),
                    "".into(),
                    "+1 555".into(),
                    "Navy".into(),
                    "".into(),
                )
            })
            .unwrap();
        app.call(|s| {
            s.update_contact(
                c.clone(),
                "Grace Hopper".into(),
                "g@navy.mil".into(),
                "+1 555".into(),
                "Navy".into(),
                "RADM".into(),
            )
        })
        .unwrap();
        let d = app
            .call(|s| {
                s.create_deal(
                    "D".into(),
                    7,
                    "Navy".into(),
                    Some(c.clone()),
                    "stage-lead".into(),
                    None,
                    None,
                    "".into(),
                )
            })
            .unwrap();
        app.call(|s| s.mark_won(d.clone())).unwrap();
        let contacts = app.view(|s| s.list_contacts()).unwrap();
        assert_eq!(contacts[0].name, "Grace Hopper");
        assert_eq!(contacts[0].won_value, 7);

        assert!(app
            .call_as_account(OTHER, OTHER, |s| s.delete_contact(c.clone()))
            .is_err());
        app.call(|s| s.delete_contact(c.clone())).unwrap();
        assert!(app.view(|s| s.list_contacts()).unwrap().is_empty());
        assert_eq!(app.view(|s| s.get_deal(d)).unwrap().deal.contact_id, None);
    }

    #[test]
    fn notes_are_author_gated() {
        let mut app = TestHost::new(Crm::init);
        let d = deal(&mut app, "D", 1, "stage-lead");
        let n = app
            .call(|s| s.add_note(d.clone(), "Budget approved".into()))
            .unwrap();
        assert!(app.call(|s| s.add_note(d.clone(), " ".into())).is_err());
        let detail = app.view(|s| s.get_deal(d.clone())).unwrap();
        assert_eq!(detail.notes[0].body, "Budget approved");
        assert!(detail.deal.last_touch_at.is_some());
        assert!(app
            .call_as_account(OTHER, OTHER, |s| s.delete_note(n.clone()))
            .is_err());
        app.call(|s| s.delete_note(n)).unwrap();
        assert!(app.view(|s| s.get_deal(d)).unwrap().notes.is_empty());
    }

    #[test]
    fn delete_deal_is_creator_gated_and_cascades() {
        let mut app = TestHost::new(Crm::init);
        let d = deal(&mut app, "D", 1, "stage-lead");
        let a = app
            .call(|s| {
                s.add_activity(
                    Some(d.clone()),
                    None,
                    "task".into(),
                    "t".into(),
                    0,
                    None,
                    "".into(),
                )
            })
            .unwrap();
        let n = app.call(|s| s.add_note(d.clone(), "n".into())).unwrap();
        assert!(app
            .call_as_account(OTHER, OTHER, |s| s.delete_deal(d.clone()))
            .is_err());
        app.call(|s| s.delete_deal(d.clone())).unwrap();
        assert!(app.view(|s| s.get_deal(d.clone())).is_err());
        assert!(!app.view(|s| s.activities.contains(&a).unwrap()));
        assert!(!app.view(|s| s.notes.contains(&n).unwrap()));
    }

    // ── Storage-enforced authorship (holds against a patched node) ───────────

    #[test]
    fn a_creators_second_device_is_still_the_creator() {
        let mut app = TestHost::new(Crm::init);
        let d = deal(&mut app, "D", 1, "stage-lead");
        app.call_as(CREATOR_PHONE, |s| s.delete_deal(d)).unwrap();
    }

    #[test]
    fn nobody_else_rewrites_or_removes_a_note_and_the_author_is_the_stamp() {
        let mut app = TestHost::new(Crm::init);
        let d = deal(&mut app, "D", 1, "stage-lead");
        let n = app
            .call(|s| s.add_note(d.clone(), "Budget approved".into()))
            .unwrap();
        assert!(app
            .call_as_account(OTHER, OTHER, |s| s
                .notes
                .modify(&n, |note| note.body = "Budget cut".into()))
            .is_err());
        // Keys are per owner: OTHER's key-only remove names OTHER's own note
        // at the id, of which there is none, and delete_note refuses.
        assert!(app
            .call_as_account(OTHER, OTHER, |s| s.notes.remove(&n))
            .unwrap()
            .is_none());
        assert!(app
            .call_as_account(OTHER, OTHER, |s| s.delete_note(n.clone()))
            .is_err());
        let me = AccountId::from(app.account_id()).to_string();
        let notes = app.view(|s| s.get_deal(d)).unwrap().notes;
        assert_eq!(notes[0].body, "Budget approved");
        assert_eq!(notes[0].author, me);
    }

    #[test]
    fn a_records_creator_cannot_be_rewritten() {
        let mut app = TestHost::new(Crm::init);
        let d = deal(&mut app, "D", 1, "stage-lead");
        let me = AccountId::from(app.account_id()).to_string();
        assert_eq!(
            app.view(|s| s.get_deal(d.clone())).unwrap().deal.created_by,
            me
        );
        // The creator cannot rewrite their own creation entry.
        assert!(app.call(|s| s.created_by.insert(d.clone(), 0)).is_err());
        // Another member's patched node tries to claim the deal with a second
        // creation entry. Keys are per owner, so it lands as OTHER's own
        // entry; with two nobody can tell which came first, so the deal has no
        // creator, and OTHER gains nothing by it.
        app.call_as_account(OTHER, OTHER, |s| s.created_by.insert(d.clone(), 0))
            .unwrap();
        assert_eq!(
            app.view(|s| s.get_deal(d.clone())).unwrap().deal.created_by,
            ""
        );
        assert!(app
            .call_as_account(OTHER, OTHER, |s| s.delete_deal(d.clone()))
            .is_err());
        // Teammates still edit the shared deal itself — that is the board.
        app.call_as_account(OTHER, OTHER, |s| {
            s.move_deal(d.clone(), "stage-meeting".into())
        })
        .unwrap();
    }

    #[test]
    fn a_stage_runs_at_most_ten_automations() {
        let mut app = TestHost::new(Crm::init);
        for i in 0..MAX_AUTOMATIONS_PER_STAGE {
            app.call(|s| {
                s.add_automation("stage-proposal".into(), "task".into(), format!("t{i}"), 1)
            })
            .unwrap();
        }
        assert!(app
            .call(|s| s.add_automation("stage-proposal".into(), "task".into(), "x".into(), 1))
            .is_err());
        // A patched node plants more directly; a move still writes only ten.
        app.call(|s| {
            s.automations.insert(
                "auto-planted".into(),
                Automation {
                    id: "auto-planted".into(),
                    stage_id: "stage-proposal".into(),
                    kind: "task".into(),
                    subject: "spam".into(),
                    due_in_days: u32::MAX,
                    enabled: LwwRegister::new(true),
                    created_at: u64::MAX,
                },
            )
        })
        .unwrap();
        let d = deal(&mut app, "D", 1, "stage-lead");
        app.call(|s| s.move_deal(d.clone(), "stage-proposal".into()))
            .unwrap();
        let acts = app.view(|s| s.get_deal(d)).unwrap().activities;
        assert_eq!(acts.len(), MAX_AUTOMATIONS_PER_STAGE);
        assert!(acts.iter().all(|a| a.subject != "spam"));
    }

    #[test]
    fn out_of_range_values_written_around_the_api_are_clamped_on_read() {
        let mut app = TestHost::new(Crm::init);
        app.call(|s| {
            let mut stage = s.stages.get_mut("stage-lead")?.expect("seeded");
            stage.probability.set(1_000);
            drop(stage);
            s.rotting_days.set(0);
            Ok::<_, calimero_storage::collections::StoreError>(())
        })
        .unwrap();
        let lead = app.view(|s| s.list_stages()).unwrap()[0].clone();
        assert_eq!(lead.probability, 100);
        assert_eq!(app.view(|s| s.get_settings()).unwrap().rotting_days, 1);
    }

    #[test]
    fn a_deal_whose_stage_was_deleted_shows_in_the_first_stage() {
        let mut app = TestHost::new(Crm::init);
        let d = deal(&mut app, "D", 1, "stage-meeting");
        // As if the stage were deleted concurrently with the move into it.
        app.call(|s| s.stages.remove("stage-meeting")).unwrap();
        let view = app.view(|s| s.get_deal(d)).unwrap().deal;
        assert_eq!(view.stage_id, "stage-lead");
        assert_eq!(view.probability, 10);
    }
}
