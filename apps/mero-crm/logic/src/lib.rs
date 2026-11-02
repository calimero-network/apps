//! Mero CRM: one sales pipeline, shared by the team that works it, on core's
//! component SDK (`calimero-app-sdk`).
//!
//! One app instance is one pipeline. It holds the stages, the deals moving
//! through them, the people behind those deals, the activities scheduled
//! against them, the notes, and the automations that schedule follow-ups when
//! a deal enters a stage. The app runs on its cluster's leader, which applies
//! every write in one replicated log, so the state is plain tables and v1's
//! CRDT plumbing (a `LwwRegister` per field, hand-written `Mergeable`, writing
//! only the fields that changed, owner stamps on write-once entries) has
//! nothing left to decide:
//!
//! | v1 (`calimero-storage`) | here |
//! |---|---|
//! | `UnorderedMap<String, Stage>` | `stages` table (at most 12 rows) |
//! | `IndexedMap<String, Deal>`, `#[index]` on contact, owner, stage, status | `deals` table; `byCreated`, `byStage`, `byOwner`, `byStatus`, `byStatusStage`, `byOwnerStatus`, `byContact` indexes; maintained `perStageStatus`, `perContactStatus` counts; full-text search on title, organization, source |
//! | `UnorderedMap<String, Contact>` | `contacts` table; `byName`, `byEmail` indexes; full-text search on name, email, phone, organization, job title |
//! | `IndexedMap<String, Activity>`, `#[index]` on deal | `activities` table; `byDeal`, `byDealOpen`, `byDealDoneAt`, `byDue`, `byDoneDue` indexes; a maintained `perDealDone` count |
//! | `Authored<IndexedMap<String, Note>>` | `notes` table, `author` a field, `byDeal` index |
//! | `IndexedMap<String, Automation>`, `#[index]` on stage | `automations` table, `byStage` index, maintained `perStage` count |
//! | `WriteOnce<UnorderedMap<String, u64>>` creation stamps | a `createdBy` field on each record |
//! | `LwwRegister<String>` currency, `LwwRegister<u32>` rotting days | `Cell<String>`, `Cell<u32>` |
//! | (new) | `leads`: `UnorderedMap<(source, sourceRef), LeadResult>`, what `submitLead` made |
//!
//! Lists are pages (`{ items, next }`), and every per-deal or per-person fact
//! a view shows is an index seek or a maintained count: no call reads a whole
//! table.
//!
//! # Hand-off from Mero Forms
//!
//! `submitLead` is open to other apps of the organization
//! (`#[app::allow(app = "*")]`): Mero Forms sends a response with
//! `env::xcall` / `env::xcall_call`, the CRM finds or files the person by
//! email, adds a deal and a note, and remembers `(sender, sourceRef)` so a
//! retried delivery makes nothing twice. The method is in the README.
//!
//! # Who may do what
//!
//! The organization decides who reaches the app: its owner, admins, members
//! and guests. Every one of them may read and work the whole board (stages,
//! deals, people, activities, automations, settings): that is what makes it a
//! shared pipeline, as in v1. The rules v1 kept in storage are checks here, in
//! the method, against `env::caller()`, before anything is written:
//!
//! - only a deal's or a contact's creator may delete it (`deleteDeal`,
//!   `deleteContact`): anyone else gets `Forbidden`;
//! - only a note's author may delete it (`deleteNote`): anyone else gets
//!   `Forbidden`;
//! - a deal, person or note another app created (`app:<id>`) has no account
//!   to ask, so the org's owner and admins may delete it.
//!
//! Every write goes through a method, so there is no "patched node" to defend
//! against: v1's forged-write tests are the same calls made as another account.
//!
//! Everything a client sees differently from v1 (camelCase method and argument
//! names, 64-bit integers as decimal strings, the error shape, list sizes) is
//! in `apps/mero-crm/README.md`, "What changed in the port".

use std::collections::BTreeMap;

use calimero_app_sdk::env::Caller;
use calimero_app_sdk::prelude::*;
use serde::Serialize;

// ── domain constants ─────────────────────────────────────────────────────────

/// Deal lifecycle. A deal is `open` while it sits in a stage; closing it takes
/// it off the board without losing which stage it closed from.
pub const DEAL_STATUSES: [&str; 3] = ["open", "won", "lost"];
/// Activity kinds: the five every CRM in the category converges on.
pub const ACTIVITY_KINDS: [&str; 5] = ["call", "meeting", "task", "email", "deadline"];
/// The pipeline a new instance starts with: (id, name, win probability %).
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
/// Rules one stage may carry; `addAutomation` refuses the next one.
const MAX_AUTOMATIONS_PER_STAGE: u32 = 10;
const MAX_NAME_LEN: usize = 120;
const MAX_TEXT_LEN: usize = 10_000;
const DAY_MS: u64 = 86_400_000;
/// The most rows one list page returns: one page of a table.
pub const PAGE: u32 = 1000;
/// A list page's size when the caller names none.
const DEFAULT_PAGE: u32 = 100;

// ── stored records ───────────────────────────────────────────────────────────

/// A column of the pipeline. At most [`MAX_STAGES`], so read whole.
#[derive(Record)]
#[table(key = "id")]
pub struct Stage {
    /// `stage-<ms>-<8 hex>`, or one of the seeded `stage-lead` … ids.
    pub id: String,
    pub name: String,
    /// Win probability in percent, 0..=100. Drives the weighted forecast.
    pub probability: u32,
    /// Sort key. `reorderStages` rewrites every stage's position in one call.
    pub position: u32,
    /// Unix milliseconds; 0 for the seeded stages.
    pub created_at: u64,
}

/// A deal: an opportunity with a value, moving through the stages.
#[derive(Record)]
#[table(
    key = "id",
    index(by_created = ["created_at"]),
    index(by_stage = ["stage_id", "created_at"]),
    index(by_owner = ["owner", "created_at"]),
    index(by_status = ["status", "created_at"]),
    index(by_status_stage = ["status", "stage_id", "created_at"]),
    index(by_owner_status = ["owner", "status", "created_at"]),
    index(by_contact = ["contact_id", "status"]),
    count(per_stage_status = ["stage_id", "status"]),
    count(per_contact_status = ["contact_id", "status"]),
    search = ["title", "organization", "source"],
)]
pub struct Deal {
    /// `deal-<ms>-<8 hex>`.
    pub id: String,
    pub title: String,
    /// Whole units of the pipeline currency.
    pub value: u64,
    pub organization: String,
    pub contact_id: Option<String>,
    /// A display name (a member alias), not an account.
    pub owner: Option<String>,
    pub stage_id: String,
    /// One of [`DEAL_STATUSES`].
    pub status: String,
    pub lost_reason: String,
    /// Expected close date, Unix milliseconds.
    pub expected_close: Option<u64>,
    /// Where the deal came from (referral, inbound, outbound, event, …).
    pub source: String,
    /// When the deal entered its current stage: what "rotting" measures.
    pub stage_entered_at: u64,
    pub closed_at: Option<u64>,
    /// The creator's account, or `app:<id>` when another app's `submitLead`
    /// created it. Only the creator may delete the deal; one an app created,
    /// the org's owner and admins.
    pub created_by: String,
    pub created_at: u64,
}

/// A person the team sells to.
#[derive(Record)]
#[table(
    key = "id",
    index(by_name = ["name_key"]),
    index(by_email = ["email_key"]),
    search = ["name", "email", "phone", "organization", "job_title"],
)]
pub struct Contact {
    /// `contact-<ms>-<8 hex>`.
    pub id: String,
    pub name: String,
    /// `name` lower-cased: the address book's order.
    pub name_key: String,
    pub email: String,
    /// `email` trimmed and lower-cased, `None` when empty: how `submitLead`
    /// finds the person a second response from the same address belongs to.
    pub email_key: Option<String>,
    pub phone: String,
    pub organization: String,
    pub job_title: String,
    /// As `Deal::created_by`: the creator's account, or `app:<id>`.
    pub created_by: String,
    pub created_at: u64,
}

/// Something someone has to do: a call, a meeting, a task, an email, a deadline.
#[derive(Record)]
#[table(
    key = "id",
    index(by_deal = ["deal_id", "due_at"]),
    index(by_deal_open = ["deal_id", "done", "due_at"]),
    index(by_deal_done_at = ["deal_id", "done_at"]),
    index(by_due = ["due_at"]),
    index(by_done_due = ["done", "due_at"]),
    count(per_deal_done = ["deal_id", "done"]),
)]
pub struct Activity {
    /// `activity-<ms>-<8 hex>`.
    pub id: String,
    pub deal_id: Option<String>,
    pub contact_id: Option<String>,
    /// One of [`ACTIVITY_KINDS`].
    pub kind: String,
    pub subject: String,
    pub due_at: u64,
    pub done: bool,
    pub done_at: Option<u64>,
    pub owner: Option<String>,
    pub note: String,
    /// Set when an automation scheduled it rather than a person.
    pub automation_id: Option<String>,
    /// The creator's account, or `app:<id>` for the hand-off (`submitLead`).
    pub created_by: String,
    pub created_at: u64,
}

/// A note on a deal. Immutable once written; only its author may delete it.
#[derive(Record)]
#[table(key = "id", index(by_deal = ["deal_id", "created_at"]))]
pub struct Note {
    /// `note-<ms>-<8 hex>`.
    pub id: String,
    pub deal_id: String,
    /// The writer's account, or `app:<id>` for a hand-off's note.
    pub author: String,
    pub body: String,
    pub created_at: u64,
}

/// "When a deal enters `stage_id`, schedule a `kind` activity called `subject`,
/// due `due_in_days` later."
#[derive(Record)]
#[table(
    key = "id",
    index(by_stage = ["stage_id", "created_at"]),
    count(per_stage = ["stage_id"]),
)]
pub struct Automation {
    /// `auto-<ms>-<8 hex>`.
    pub id: String,
    pub stage_id: String,
    pub kind: String,
    pub subject: String,
    pub due_in_days: u32,
    pub enabled: bool,
    pub created_by: String,
    pub created_at: u64,
}

// ── results ──────────────────────────────────────────────────────────────────
//
// v1's answer shapes, field for field: snake_case names, as the frontend and
// every integration read them. The one wire difference is that a `u64` is a
// decimal string (D20).

#[derive(Debug, Clone, Serialize)]
pub struct StageView {
    pub id: String,
    pub name: String,
    pub probability: u32,
    pub position: u32,
}

/// The earliest open activity on a deal: the "next step" the board shows.
#[derive(Debug, Clone, Serialize)]
pub struct NextActivity {
    pub id: String,
    pub kind: String,
    pub subject: String,
    #[serde(with = "calimero_app_sdk::json::u64_str")]
    pub due_at: u64,
}

#[derive(Debug, Clone, Serialize)]
pub struct DealView {
    pub id: String,
    pub title: String,
    #[serde(with = "calimero_app_sdk::json::u64_str")]
    pub value: u64,
    pub organization: String,
    pub contact_id: Option<String>,
    /// The linked person's name, resolved here so the board needs no join.
    pub contact_name: Option<String>,
    pub owner: Option<String>,
    pub stage_id: String,
    pub status: String,
    pub lost_reason: String,
    #[serde(with = "calimero_app_sdk::json::opt_u64_str")]
    pub expected_close: Option<u64>,
    pub source: String,
    /// Win probability: the stage's while open, 100 when won, 0 when lost.
    pub probability: u32,
    #[serde(with = "calimero_app_sdk::json::u64_str")]
    pub stage_entered_at: u64,
    #[serde(with = "calimero_app_sdk::json::opt_u64_str")]
    pub closed_at: Option<u64>,
    pub next_activity: Option<NextActivity>,
    pub open_activities: u32,
    /// The most recent completed activity or note, if any.
    #[serde(with = "calimero_app_sdk::json::opt_u64_str")]
    pub last_touch_at: Option<u64>,
    pub created_by: String,
    #[serde(with = "calimero_app_sdk::json::u64_str")]
    pub created_at: u64,
}

#[derive(Debug, Clone, Serialize)]
pub struct ContactView {
    pub id: String,
    pub name: String,
    pub email: String,
    pub phone: String,
    pub organization: String,
    pub job_title: String,
    pub open_deals: u32,
    #[serde(with = "calimero_app_sdk::json::u64_str")]
    pub won_value: u64,
    pub created_by: String,
    #[serde(with = "calimero_app_sdk::json::u64_str")]
    pub created_at: u64,
}

#[derive(Debug, Clone, Serialize)]
pub struct ActivityView {
    pub id: String,
    pub deal_id: Option<String>,
    /// The deal's title, resolved here so the to-do list needs no join.
    pub deal_title: Option<String>,
    pub contact_id: Option<String>,
    pub kind: String,
    pub subject: String,
    #[serde(with = "calimero_app_sdk::json::u64_str")]
    pub due_at: u64,
    pub done: bool,
    #[serde(with = "calimero_app_sdk::json::opt_u64_str")]
    pub done_at: Option<u64>,
    pub owner: Option<String>,
    pub note: String,
    pub automation_id: Option<String>,
    pub created_by: String,
    #[serde(with = "calimero_app_sdk::json::u64_str")]
    pub created_at: u64,
}

#[derive(Debug, Clone, Serialize)]
pub struct NoteView {
    pub id: String,
    pub deal_id: String,
    pub author: String,
    pub body: String,
    #[serde(with = "calimero_app_sdk::json::u64_str")]
    pub created_at: u64,
}

#[derive(Debug, Clone, Serialize)]
pub struct AutomationView {
    pub id: String,
    pub stage_id: String,
    pub kind: String,
    pub subject: String,
    pub due_in_days: u32,
    pub enabled: bool,
    pub created_by: String,
    #[serde(with = "calimero_app_sdk::json::u64_str")]
    pub created_at: u64,
}

/// A deal with everything the detail page shows.
#[derive(Debug, Clone, Serialize)]
pub struct DealDetail {
    pub deal: DealView,
    pub contact: Option<ContactView>,
    /// By due date; at most the first 1,000.
    pub activities: Vec<ActivityView>,
    /// Newest first; at most the newest 1,000.
    pub notes: Vec<NoteView>,
}

/// One page of a list view: at most `limit` rows (a filtered page may hold
/// fewer), and the cursor of the next page, `null` after the last.
#[derive(Debug, Clone, Serialize)]
pub struct ListPage<T> {
    pub items: Vec<T>,
    pub next: Option<String>,
}

/// One page of search hits, best first, and how many matched in all.
#[derive(Debug, Clone, Serialize)]
pub struct SearchPage<T> {
    pub items: Vec<T>,
    /// The `cursor` of the next page, `null` after the last.
    pub next: Option<u32>,
    #[serde(with = "calimero_app_sdk::json::u64_str")]
    pub total: u64,
}

/// What `submitLead` did.
#[derive(Debug, Clone, Serialize, serde::Deserialize, PartialEq, Eq)]
pub struct LeadResult {
    /// The deal the lead became.
    pub deal_id: String,
    /// The person: the one already filed under the lead's email, or a new one.
    pub contact_id: String,
    /// Whether `contact_id` is a person this call created.
    pub contact_created: bool,
    /// `true` when this source had already sent this `sourceRef`: nothing was
    /// written, and the ids are the first hand-off's.
    pub duplicate: bool,
}

#[derive(Debug, Clone, Serialize)]
pub struct Settings {
    pub currency: String,
    pub rotting_days: u32,
}

// ── state ────────────────────────────────────────────────────────────────────

/// The pipeline.
#[app::state(version = 1)]
pub struct Crm {
    stages: Table<Stage>,
    deals: Table<Deal>,
    contacts: Table<Contact>,
    activities: Table<Activity>,
    notes: Table<Note>,
    automations: Table<Automation>,
    /// A three-letter code; `USD` from `init`.
    currency: Cell<String>,
    /// 1..=365; 14 from `init`.
    rotting_days: Cell<u32>,
    /// `(source, sourceRef)` → what the hand-off made, so a retried or repeated
    /// `submitLead` makes nothing twice. `source` is the sending app's id or
    /// the calling account. One entry per lead.
    leads: UnorderedMap<(String, String), LeadResult>,
}

#[app::logic]
impl Crm {
    /// The default pipeline: five stages, USD, a 14-day rotting threshold. The
    /// node runs it once, as the owner, when the app is created.
    #[app::init]
    pub fn init() -> app::Result<Self> {
        let mut crm = Self::load();
        for (position, (id, name, probability)) in DEFAULT_STAGES.iter().enumerate() {
            crm.stages.insert(Stage {
                id: (*id).to_owned(),
                name: (*name).to_owned(),
                probability: *probability,
                position: position as u32,
                created_at: 0,
            })?;
        }
        crm.currency.set(&DEFAULT_CURRENCY.to_owned())?;
        crm.rotting_days.set(&DEFAULT_ROTTING_DAYS)?;
        Ok(crm)
    }

    // ── settings ─────────────────────────────────────────────────────────────

    /// The pipeline currency and rotting threshold.
    #[app::view]
    pub fn get_settings(&self) -> app::Result<Settings> {
        Ok(Settings {
            currency: self
                .currency
                .get()?
                .unwrap_or_else(|| DEFAULT_CURRENCY.to_owned()),
            rotting_days: self
                .rotting_days
                .get()?
                .unwrap_or(DEFAULT_ROTTING_DAYS)
                .clamp(1, 365),
        })
    }

    /// Sets the pipeline currency: a three-letter ISO 4217 code such as `EUR`
    /// (any case; stored upper case). `Invalid` otherwise. Emits
    /// `SettingsChanged`.
    pub fn set_currency(&mut self, currency: String) -> app::Result<()> {
        let code = currency.trim().to_ascii_uppercase();
        if code.len() != 3 || !code.chars().all(|c| c.is_ascii_alphabetic()) {
            return Err(invalid("currency must be a three-letter code such as USD"));
        }
        self.currency.set(&code)?;
        env::emit(Event::SettingsChanged, Audience::All)?;
        Ok(())
    }

    /// Days without activity before an open deal is flagged as rotting
    /// (1..=365, else `Invalid`). Emits `SettingsChanged`.
    pub fn set_rotting_days(&mut self, days: u32) -> app::Result<()> {
        if !(1..=365).contains(&days) {
            return Err(invalid("rotting_days must be between 1 and 365"));
        }
        self.rotting_days.set(&days)?;
        env::emit(Event::SettingsChanged, Audience::All)?;
        Ok(())
    }

    // ── stages ───────────────────────────────────────────────────────────────

    /// Stages in pipeline order.
    #[app::view]
    pub fn list_stages(&self) -> app::Result<Vec<StageView>> {
        Ok(self.sorted_stages()?.iter().map(stage_view).collect())
    }

    /// Appends a stage at the end of the pipeline and returns its id. A name
    /// of 1 to 120 characters, a probability of 0 to 100, at most 12 stages.
    /// Emits `StagesChanged`.
    pub fn add_stage(&mut self, name: String, probability: u32) -> app::Result<String> {
        validate_name("stage name", &name)?;
        validate_probability(probability)?;
        let existing = self.sorted_stages()?;
        if existing.len() >= MAX_STAGES {
            return Err(invalid("a pipeline can have at most 12 stages"));
        }
        let position = existing.last().map(|s| s.position + 1).unwrap_or(0);
        let now = env::time_now();
        let id = new_id("stage", now);
        self.stages.insert(Stage {
            id: id.clone(),
            name: name.trim().to_owned(),
            probability,
            position,
            created_at: now,
        })?;
        env::emit(Event::StagesChanged, Audience::All)?;
        Ok(id)
    }

    /// Renames a stage and sets its win probability. `NotFound` for an unknown
    /// stage. Emits `StagesChanged`.
    pub fn update_stage(
        &mut self,
        stage_id: String,
        name: String,
        probability: u32,
    ) -> app::Result<()> {
        validate_name("stage name", &name)?;
        validate_probability(probability)?;
        let name = name.trim().to_owned();
        if !self.stages.update(&stage_id, |s| {
            s.name = name;
            s.probability = probability;
        })? {
            return Err(not_found("stage", &stage_id));
        }
        env::emit(Event::StagesChanged, Audience::All)?;
        Ok(())
    }

    /// Reorders the pipeline. `stageIds` must name every stage exactly once
    /// (else `Invalid`). Emits `StagesChanged`.
    pub fn reorder_stages(&mut self, stage_ids: Vec<String>) -> app::Result<()> {
        let mut current: Vec<String> = self.sorted_stages()?.into_iter().map(|s| s.id).collect();
        let mut given = stage_ids.clone();
        current.sort();
        given.sort();
        if current != given {
            return Err(invalid("stage_ids must list every stage exactly once"));
        }
        for (position, id) in stage_ids.iter().enumerate() {
            let _ = self.stages.update(id, |s| s.position = position as u32)?;
        }
        env::emit(Event::StagesChanged, Audience::All)?;
        Ok(())
    }

    /// Removes a stage with its automations. Refused (`Invalid`) while any
    /// open deal sits in it, and for the last remaining stage: a pipeline
    /// always has somewhere to put a deal. A closed deal that closed from it
    /// and is reopened later is shown in the first stage (see `deal_view`).
    /// Emits `StagesChanged`.
    pub fn delete_stage(&mut self, stage_id: String) -> app::Result<()> {
        if !self.stages.contains(&stage_id)? {
            return Err(not_found("stage", &stage_id));
        }
        if self.sorted_stages()?.len() <= 1 {
            return Err(invalid("a pipeline needs at least one stage"));
        }
        let open = self.deals.count(
            "perStageStatus",
            &[
                KeyPart::Str(stage_id.clone()),
                KeyPart::Str("open".to_owned()),
            ],
        )?;
        if open > 0 {
            return Err(invalid("move the open deals out of this stage first"));
        }
        for rule in self.stage_rules(&stage_id)? {
            let _ = self.automations.remove(&rule.id)?;
        }
        let _ = self.stages.remove(&stage_id)?;
        env::emit(Event::StagesChanged, Audience::All)?;
        Ok(())
    }

    // ── deals ────────────────────────────────────────────────────────────────

    /// Adds a deal to a stage, created by the caller, and returns its id. Runs
    /// the stage's automations. `NotFound` for an unknown stage or contact;
    /// `Invalid` for a blank title or a field over 120 characters. Emits
    /// `DealCreated`, then `AutomationFired` per rule that ran.
    // Each argument is a named field of the ABI; a params struct would change it.
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
        let created_by = account()?;
        validate_name("title", &title)?;
        validate_optional_name("organization", &organization)?;
        validate_optional_name("source", &source)?;
        if !self.stages.contains(&stage_id)? {
            return Err(not_found("stage", &stage_id));
        }
        let contact_id = normalize_opt(contact_id);
        if let Some(cid) = &contact_id {
            if !self.contacts.contains(cid)? {
                return Err(not_found("contact", cid));
            }
        }
        let now = env::time_now();
        let id = new_id("deal", now);
        self.deals.insert(Deal {
            id: id.clone(),
            title: title.trim().to_owned(),
            value,
            organization: organization.trim().to_owned(),
            contact_id,
            owner: normalize_opt(owner),
            stage_id: stage_id.clone(),
            status: "open".to_owned(),
            lost_reason: String::new(),
            expected_close,
            source: source.trim().to_owned(),
            stage_entered_at: now,
            closed_at: None,
            created_by,
            created_at: now,
        })?;
        env::emit(
            Event::DealCreated {
                id: id.clone(),
                stage_id: stage_id.clone(),
            },
            Audience::All,
        )?;
        self.run_automations(&id, &stage_id, now)?;
        Ok(id)
    }

    /// Edits a deal's fields (every one is written). `NotFound` for an unknown
    /// deal or contact. Emits `DealUpdated`.
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
            if !self.contacts.contains(cid)? {
                return Err(not_found("contact", cid));
            }
        }
        let owner = normalize_opt(owner);
        if !self.deals.update(&deal_id, |d| {
            d.title = title.trim().to_owned();
            d.value = value;
            d.organization = organization.trim().to_owned();
            d.contact_id = contact_id;
            d.owner = owner;
            d.expected_close = expected_close;
            d.source = source.trim().to_owned();
        })? {
            return Err(not_found("deal", &deal_id));
        }
        env::emit(Event::DealUpdated { id: deal_id }, Audience::All)?;
        Ok(())
    }

    /// Moves an open deal to another stage and runs that stage's automations.
    /// Moving to the stage it is already in is a no-op; a closed deal is
    /// `Invalid`. Emits `DealMoved`, then `AutomationFired` per rule that ran.
    pub fn move_deal(&mut self, deal_id: String, stage_id: String) -> app::Result<()> {
        if !self.stages.contains(&stage_id)? {
            return Err(not_found("stage", &stage_id));
        }
        let deal = self.load_deal(&deal_id)?;
        if deal.status != "open" {
            return Err(invalid("reopen a closed deal before moving it"));
        }
        if deal.stage_id == stage_id {
            return Ok(());
        }
        let now = env::time_now();
        let next = stage_id.clone();
        let _ = self.deals.update(&deal_id, |d| {
            d.stage_id = next;
            d.stage_entered_at = now;
        })?;
        env::emit(
            Event::DealMoved {
                id: deal_id.clone(),
                stage_id: stage_id.clone(),
            },
            Audience::All,
        )?;
        self.run_automations(&deal_id, &stage_id, now)
    }

    /// Closes a deal as won. Emits `DealStatusChanged`.
    pub fn mark_won(&mut self, deal_id: String) -> app::Result<()> {
        self.close_deal(deal_id, "won", String::new())
    }

    /// Closes a deal as lost, with the reason (at most 120 characters; it
    /// feeds the lost-reasons report). Emits `DealStatusChanged`.
    pub fn mark_lost(&mut self, deal_id: String, reason: String) -> app::Result<()> {
        validate_optional_name("reason", &reason)?;
        self.close_deal(deal_id, "lost", reason.trim().to_owned())
    }

    /// Puts a closed deal back on the board, in the stage it closed from. An
    /// open deal is left as it is. Emits `DealStatusChanged`.
    pub fn reopen_deal(&mut self, deal_id: String) -> app::Result<()> {
        if self.load_deal(&deal_id)?.status == "open" {
            return Ok(());
        }
        let now = env::time_now();
        let _ = self.deals.update(&deal_id, |d| {
            d.status = "open".to_owned();
            d.lost_reason = String::new();
            d.closed_at = None;
            d.stage_entered_at = now;
        })?;
        env::emit(
            Event::DealStatusChanged {
                id: deal_id,
                status: "open".to_owned(),
            },
            Audience::All,
        )?;
        Ok(())
    }

    /// Deals, optionally filtered by exact `status`, `stageId` and `owner`
    /// (`null` for no filter), newest first, one page: at most `limit` (1 to
    /// 1,000; 100 when `null`), from `cursor` (the `next` of the previous
    /// page). Every combination of filters but `stageId` with `owner` is one
    /// index seek; with both, the stage's deals are read and the owner's kept,
    /// so such a page may hold fewer than `limit` while `next` is set.
    #[app::view]
    pub fn list_deals(
        &self,
        status: Option<String>,
        stage_id: Option<String>,
        owner: Option<String>,
        cursor: Option<String>,
        limit: Option<u32>,
    ) -> app::Result<ListPage<DealView>> {
        let s = |v: &String| KeyPart::Str(v.clone());
        let (index, prefix) = match (&status, &stage_id, &owner) {
            (Some(st), Some(sg), _) => ("byStatusStage", vec![s(st), s(sg)]),
            (None, Some(sg), _) => ("byStage", vec![s(sg)]),
            (Some(st), None, Some(o)) => ("byOwnerStatus", vec![s(o), s(st)]),
            (None, None, Some(o)) => ("byOwner", vec![s(o)]),
            (Some(st), None, None) => ("byStatus", vec![s(st)]),
            (None, None, None) => ("byCreated", Vec::new()),
        };
        let page = self
            .deals
            .find(index, &prefix, page_opts(cursor, limit)?.reverse())?;
        let stages = self.stage_index()?;
        let items = page
            .items
            .iter()
            .filter(|d| {
                owner
                    .as_ref()
                    .is_none_or(|o| d.owner.as_deref() == Some(o.as_str()))
            })
            .map(|d| self.deal_view(d, &stages))
            .collect::<app::Result<_>>()?;
        Ok(ListPage {
            items,
            next: page.next,
        })
    }

    /// Deals whose title, organization or source match `text` (every word;
    /// the last as a prefix, for search as you type), best first: at most
    /// `limit` (1 to 100; 20 when `null`) from `cursor`.
    #[app::view]
    pub fn search_deals(
        &self,
        text: String,
        cursor: Option<u32>,
        limit: Option<u32>,
    ) -> app::Result<SearchPage<DealView>> {
        let found = self.deals.search(&text, search_opts(cursor, limit)?)?;
        let stages = self.stage_index()?;
        Ok(SearchPage {
            items: found
                .items
                .iter()
                .map(|f| self.deal_view(&f.record, &stages))
                .collect::<app::Result<_>>()?,
            next: found.next,
            total: found.total,
        })
    }

    /// One deal with its person, activities (by due date) and notes (newest
    /// first), at most 1,000 of each. `NotFound` for an unknown deal.
    #[app::view]
    pub fn get_deal(&self, deal_id: String) -> app::Result<DealDetail> {
        let deal = self.load_deal(&deal_id)?;
        let activities = self.deal_activities(&deal_id)?;
        let notes = self
            .notes
            .find(
                "byDeal",
                &[KeyPart::Str(deal_id.clone())],
                FindOpts::default().limit(PAGE).reverse(),
            )?
            .items;
        let contact = match &deal.contact_id {
            Some(cid) => self.contact_detail(cid)?,
            None => None,
        };
        let title = BTreeMap::from([(deal_id.clone(), deal.title.clone())]);
        let activities = activities
            .iter()
            .map(|a| activity_view(a, &title))
            .collect();
        Ok(DealDetail {
            deal: self.deal_view(&deal, &self.stage_index()?)?,
            contact,
            activities,
            notes: notes.iter().map(note_view).collect(),
        })
    }

    /// Deletes a deal with its activities and notes. Only its creator may
    /// (for a deal another app handed over, the org's owner and admins):
    /// anyone else gets `Forbidden`. Emits `DealDeleted`.
    pub fn delete_deal(&mut self, deal_id: String) -> app::Result<()> {
        let deal = self.load_deal(&deal_id)?;
        if !may_delete(&deal.created_by)? {
            return Err(forbidden("only the creator may delete this deal"));
        }
        // Collect a page, then remove it: never mutate under a cursor.
        loop {
            let page = self.activities.find(
                "byDeal",
                &[KeyPart::Str(deal_id.clone())],
                FindOpts::default().limit(PAGE),
            )?;
            if page.items.is_empty() {
                break;
            }
            for a in page.items {
                let _ = self.activities.remove(&a.id)?;
            }
        }
        loop {
            let page = self.notes.find(
                "byDeal",
                &[KeyPart::Str(deal_id.clone())],
                FindOpts::default().limit(PAGE),
            )?;
            if page.items.is_empty() {
                break;
            }
            for n in page.items {
                let _ = self.notes.remove(&n.id)?;
            }
        }
        let _ = self.deals.remove(&deal_id)?;
        env::emit(Event::DealDeleted { id: deal_id }, Audience::All)?;
        Ok(())
    }

    // ── contacts ─────────────────────────────────────────────────────────────

    /// Adds a person, created by the caller, and returns their id. A name of 1
    /// to 120 characters, the other fields at most 120, an email that looks
    /// like one (or empty). Emits `ContactChanged`.
    pub fn create_contact(
        &mut self,
        name: String,
        email: String,
        phone: String,
        organization: String,
        job_title: String,
    ) -> app::Result<String> {
        let created_by = account()?;
        validate_contact(&name, &email, &phone, &organization, &job_title)?;
        let now = env::time_now();
        let id = new_id("contact", now);
        self.contacts.insert(Contact {
            id: id.clone(),
            name: name.trim().to_owned(),
            name_key: name_key(&name),
            email: email.trim().to_owned(),
            email_key: email_key(&email),
            phone: phone.trim().to_owned(),
            organization: organization.trim().to_owned(),
            job_title: job_title.trim().to_owned(),
            created_by,
            created_at: now,
        })?;
        env::emit(Event::ContactChanged { id: id.clone() }, Audience::All)?;
        Ok(id)
    }

    /// Edits a person (the same rules as `createContact`). `NotFound` for an
    /// unknown contact. Emits `ContactChanged`.
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
        if !self.contacts.update(&contact_id, |c| {
            c.name = name.trim().to_owned();
            c.name_key = name_key(&name);
            c.email = email.trim().to_owned();
            c.email_key = email_key(&email);
            c.phone = phone.trim().to_owned();
            c.organization = organization.trim().to_owned();
            c.job_title = job_title.trim().to_owned();
        })? {
            return Err(not_found("contact", &contact_id));
        }
        env::emit(Event::ContactChanged { id: contact_id }, Audience::All)?;
        Ok(())
    }

    /// Deletes a person. Only their creator may (for a person another app
    /// handed over, the org's owner and admins): anyone else gets `Forbidden`.
    /// Deals keep their history but lose the link. Emits `ContactChanged`.
    pub fn delete_contact(&mut self, contact_id: String) -> app::Result<()> {
        let Some(contact) = self.contacts.get(&contact_id)? else {
            return Err(not_found("contact", &contact_id));
        };
        if !may_delete(&contact.created_by)? {
            return Err(forbidden("only the creator may delete this contact"));
        }
        // Unlinking takes a deal out of this index, so the first page shrinks.
        loop {
            let page = self.deals.find(
                "byContact",
                &[KeyPart::Str(contact_id.clone())],
                FindOpts::default().limit(PAGE),
            )?;
            if page.items.is_empty() {
                break;
            }
            for d in page.items {
                let _ = self.deals.update(&d.id, |d| d.contact_id = None)?;
            }
        }
        let _ = self.contacts.remove(&contact_id)?;
        env::emit(Event::ContactChanged { id: contact_id }, Audience::All)?;
        Ok(())
    }

    /// The address book by name (case-insensitive), with each person's deal
    /// totals, one page: at most `limit` (1 to 1,000; 100 when `null`) from
    /// `cursor`. A person's won value sums at most their first 1,000 won deals.
    #[app::view]
    pub fn list_contacts(
        &self,
        cursor: Option<String>,
        limit: Option<u32>,
    ) -> app::Result<ListPage<ContactView>> {
        let page = self
            .contacts
            .find("byName", &[], page_opts(cursor, limit)?)?;
        Ok(ListPage {
            items: page
                .items
                .iter()
                .map(|c| self.contact_totals(c))
                .collect::<app::Result<_>>()?,
            next: page.next,
        })
    }

    /// People whose name, email, phone, organization or job title match
    /// `text` (every word; the last as a prefix), best first: at most `limit`
    /// (1 to 100; 20 when `null`) from `cursor`.
    #[app::view]
    pub fn search_contacts(
        &self,
        text: String,
        cursor: Option<u32>,
        limit: Option<u32>,
    ) -> app::Result<SearchPage<ContactView>> {
        let found = self.contacts.search(&text, search_opts(cursor, limit)?)?;
        Ok(SearchPage {
            items: found
                .items
                .iter()
                .map(|f| self.contact_totals(&f.record))
                .collect::<app::Result<_>>()?,
            next: found.next,
            total: found.total,
        })
    }

    /// The person filed under `email` (trimmed, any case), or `null`: what a
    /// hand-off reuses instead of creating a second one.
    #[app::view]
    pub fn find_contact_by_email(&self, email: String) -> app::Result<Option<ContactView>> {
        match self.contact_by_email(&email)? {
            Some(c) => Ok(Some(self.contact_totals(&c)?)),
            None => Ok(None),
        }
    }

    // ── activities ───────────────────────────────────────────────────────────

    /// Schedules an activity, on a deal, a person, both or neither, and returns
    /// its id. `kind` is one of `call`, `meeting`, `task`, `email`,
    /// `deadline`. Emits `ActivityChanged`.
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
        let created_by = account()?;
        validate_kind(&kind)?;
        validate_name("subject", &subject)?;
        validate_text("note", &note)?;
        let deal_id = normalize_opt(deal_id);
        let contact_id = normalize_opt(contact_id);
        if let Some(did) = &deal_id {
            if !self.deals.contains(did)? {
                return Err(not_found("deal", did));
            }
        }
        if let Some(cid) = &contact_id {
            if !self.contacts.contains(cid)? {
                return Err(not_found("contact", cid));
            }
        }
        let now = env::time_now();
        let id = new_id("activity", now);
        self.activities.insert(Activity {
            id: id.clone(),
            deal_id,
            contact_id,
            kind,
            subject: subject.trim().to_owned(),
            due_at,
            done: false,
            done_at: None,
            owner: normalize_opt(owner),
            note: note.trim().to_owned(),
            automation_id: None,
            created_by,
            created_at: now,
        })?;
        env::emit(Event::ActivityChanged { id: id.clone() }, Audience::All)?;
        Ok(id)
    }

    /// Marks an activity done (or undoes that). Emits `ActivityChanged`.
    pub fn set_activity_done(&mut self, activity_id: String, done: bool) -> app::Result<()> {
        let now = env::time_now();
        if !self.activities.update(&activity_id, |a| {
            if a.done != done {
                a.done = done;
                a.done_at = done.then_some(now);
            }
        })? {
            return Err(not_found("activity", &activity_id));
        }
        env::emit(Event::ActivityChanged { id: activity_id }, Audience::All)?;
        Ok(())
    }

    /// Moves an activity to a new due time. Emits `ActivityChanged`.
    pub fn reschedule_activity(&mut self, activity_id: String, due_at: u64) -> app::Result<()> {
        if !self
            .activities
            .update(&activity_id, |a| a.due_at = due_at)?
        {
            return Err(not_found("activity", &activity_id));
        }
        env::emit(Event::ActivityChanged { id: activity_id }, Audience::All)?;
        Ok(())
    }

    /// Deletes an activity. Any member may. Emits `ActivityChanged`.
    pub fn delete_activity(&mut self, activity_id: String) -> app::Result<()> {
        if !self.activities.remove(&activity_id)? {
            return Err(not_found("activity", &activity_id));
        }
        env::emit(Event::ActivityChanged { id: activity_id }, Audience::All)?;
        Ok(())
    }

    /// Activities, optionally for one deal and/or by done-ness, by due date,
    /// one page: at most `limit` (1 to 1,000; 100 when `null`) from `cursor`.
    /// Every combination is one index seek.
    #[app::view]
    pub fn list_activities(
        &self,
        deal_id: Option<String>,
        done: Option<bool>,
        cursor: Option<String>,
        limit: Option<u32>,
    ) -> app::Result<ListPage<ActivityView>> {
        let (index, prefix) = match (&deal_id, done) {
            (Some(d), Some(done)) => (
                "byDealOpen",
                vec![KeyPart::Str(d.clone()), KeyPart::Bool(done)],
            ),
            (Some(d), None) => ("byDeal", vec![KeyPart::Str(d.clone())]),
            (None, Some(done)) => ("byDoneDue", vec![KeyPart::Bool(done)]),
            (None, None) => ("byDue", Vec::new()),
        };
        let page = self
            .activities
            .find(index, &prefix, page_opts(cursor, limit)?)?;
        // The page's deals' titles: one read per deal it names.
        let mut titles = BTreeMap::new();
        for did in page.items.iter().filter_map(|a| a.deal_id.as_ref()) {
            if !titles.contains_key(did) {
                if let Some(d) = self.deals.get(did)? {
                    let _ = titles.insert(did.clone(), d.title);
                }
            }
        }
        Ok(ListPage {
            items: page
                .items
                .iter()
                .map(|a| activity_view(a, &titles))
                .collect(),
            next: page.next,
        })
    }

    // ── notes ────────────────────────────────────────────────────────────────

    /// Adds a note (not blank, at most 10,000 characters) to a deal as the
    /// caller and returns its id. Emits `NoteChanged`.
    pub fn add_note(&mut self, deal_id: String, body: String) -> app::Result<String> {
        let author = account()?;
        if body.trim().is_empty() {
            return Err(invalid("note must not be empty"));
        }
        validate_text("note", &body)?;
        if !self.deals.contains(&deal_id)? {
            return Err(not_found("deal", &deal_id));
        }
        let now = env::time_now();
        let id = new_id("note", now);
        self.notes.insert(Note {
            id: id.clone(),
            deal_id: deal_id.clone(),
            author,
            body: body.trim().to_owned(),
            created_at: now,
        })?;
        env::emit(
            Event::NoteChanged {
                id: id.clone(),
                deal_id,
            },
            Audience::All,
        )?;
        Ok(id)
    }

    /// Deletes a note. Only its author may (for a note another app handed
    /// over, the org's owner and admins): anyone else gets `Forbidden`.
    /// Emits `NoteChanged`.
    pub fn delete_note(&mut self, note_id: String) -> app::Result<()> {
        let Some(note) = self.notes.get(&note_id)? else {
            return Err(not_found("note", &note_id));
        };
        if !may_delete(&note.author)? {
            return Err(forbidden("only the author may delete this note"));
        }
        let _ = self.notes.remove(&note_id)?;
        env::emit(
            Event::NoteChanged {
                id: note_id,
                deal_id: note.deal_id,
            },
            Audience::All,
        )?;
        Ok(())
    }

    // ── hand-off from other apps ─────────────────────────────────────────────

    /// Files a lead another app collected (Mero Forms' "Send to CRM"), in one
    /// write: the person (the one already filed under `email`, else a new
    /// one), a deal for them in `stageId` (value 0, no owner) and, when `note`
    /// is not blank, a note on it with what was collected. Runs the stage's
    /// automations. Returns the ids.
    ///
    /// Callable by another app in the organization (`env::xcall` or
    /// `env::xcall_call`) and by any account the app reaches. Records it makes
    /// are created by `app:<id>` for an app, by the account otherwise.
    ///
    /// Idempotent per `(caller, sourceRef)`: a second call with a `sourceRef`
    /// the same caller already sent writes nothing and answers the first
    /// call's ids with `duplicate: true`, so an xcall the platform retries
    /// makes one deal. `sourceRef` is the sender's own id for the lead (a form
    /// response id), 1 to 120 characters.
    ///
    /// `title` falls back to `name` when blank; the fields follow
    /// `createContact`, `createDeal` and `addNote` (names and titles at most
    /// 120 characters, the note at most 10,000). `NotFound` for an unknown
    /// stage, `Invalid` for a bad field. Emits `ContactChanged` (a new person),
    /// `DealCreated`, `NoteChanged` (a note), `AutomationFired` per rule that
    /// ran, then `LeadReceived`.
    #[app::allow(app = "*")]
    #[allow(clippy::too_many_arguments)]
    pub fn submit_lead(
        &mut self,
        source_ref: String,
        stage_id: String,
        name: String,
        email: String,
        phone: String,
        organization: String,
        job_title: String,
        title: String,
        source: String,
        note: String,
    ) -> app::Result<LeadResult> {
        let by = actor()?;
        let source_ref = source_ref.trim().to_owned();
        validate_name("source_ref", &source_ref)?;
        let key = (by.clone(), source_ref.clone());
        if let Some(first) = self.leads.get(&key)? {
            return Ok(LeadResult {
                duplicate: true,
                ..first
            });
        }
        validate_contact(&name, &email, &phone, &organization, &job_title)?;
        let title = if title.trim().is_empty() {
            name.clone()
        } else {
            title
        };
        validate_name("title", &title)?;
        validate_optional_name("source", &source)?;
        validate_text("note", &note)?;
        if !self.stages.contains(&stage_id)? {
            return Err(not_found("stage", &stage_id));
        }
        let now = env::time_now();

        let (contact_id, contact_created) = match self.contact_by_email(&email)? {
            Some(c) => (c.id, false),
            None => {
                let id = new_id("contact", now);
                self.contacts.insert(Contact {
                    id: id.clone(),
                    name: name.trim().to_owned(),
                    name_key: name_key(&name),
                    email: email.trim().to_owned(),
                    email_key: email_key(&email),
                    phone: phone.trim().to_owned(),
                    organization: organization.trim().to_owned(),
                    job_title: job_title.trim().to_owned(),
                    created_by: by.clone(),
                    created_at: now,
                })?;
                env::emit(Event::ContactChanged { id: id.clone() }, Audience::All)?;
                (id, true)
            }
        };

        let deal_id = new_id("deal", now);
        self.deals.insert(Deal {
            id: deal_id.clone(),
            title: title.trim().to_owned(),
            value: 0,
            organization: organization.trim().to_owned(),
            contact_id: Some(contact_id.clone()),
            owner: None,
            stage_id: stage_id.clone(),
            status: "open".to_owned(),
            lost_reason: String::new(),
            expected_close: None,
            source: source.trim().to_owned(),
            stage_entered_at: now,
            closed_at: None,
            created_by: by.clone(),
            created_at: now,
        })?;
        env::emit(
            Event::DealCreated {
                id: deal_id.clone(),
                stage_id: stage_id.clone(),
            },
            Audience::All,
        )?;

        if !note.trim().is_empty() {
            let id = new_id("note", now);
            self.notes.insert(Note {
                id: id.clone(),
                deal_id: deal_id.clone(),
                author: by.clone(),
                body: note.trim().to_owned(),
                created_at: now,
            })?;
            env::emit(
                Event::NoteChanged {
                    id,
                    deal_id: deal_id.clone(),
                },
                Audience::All,
            )?;
        }
        self.run_automations(&deal_id, &stage_id, now)?;

        let result = LeadResult {
            deal_id: deal_id.clone(),
            contact_id: contact_id.clone(),
            contact_created,
            duplicate: false,
        };
        let _ = self.leads.insert(&key, &result)?;
        env::emit(
            Event::LeadReceived {
                deal_id,
                contact_id,
                source: by,
                source_ref,
            },
            Audience::All,
        )?;
        Ok(result)
    }

    // ── automations ──────────────────────────────────────────────────────────

    /// Every automation rule, oldest first (at most 12 stages × 10 rules).
    #[app::view]
    pub fn list_automations(&self) -> app::Result<Vec<AutomationView>> {
        // 12 stages × 10 rules: one page holds them all.
        let mut out: Vec<AutomationView> = self
            .automations
            .scan(FindOpts::default().limit(PAGE))?
            .items
            .iter()
            .map(automation_view)
            .collect();
        out.sort_by(|a, b| (a.created_at, &a.id).cmp(&(b.created_at, &b.id)));
        Ok(out)
    }

    /// "When a deal enters `stageId`, schedule a `kind` activity called
    /// `subject`, due in `dueInDays` days (at most 365)." At most 10 per
    /// stage. Returns the rule's id. Emits `AutomationsChanged`.
    pub fn add_automation(
        &mut self,
        stage_id: String,
        kind: String,
        subject: String,
        due_in_days: u32,
    ) -> app::Result<String> {
        let created_by = account()?;
        if !self.stages.contains(&stage_id)? {
            return Err(not_found("stage", &stage_id));
        }
        validate_kind(&kind)?;
        validate_name("subject", &subject)?;
        if due_in_days > 365 {
            return Err(invalid("due_in_days must be at most 365"));
        }
        if self
            .automations
            .count("perStage", &[KeyPart::Str(stage_id.clone())])?
            >= u64::from(MAX_AUTOMATIONS_PER_STAGE)
        {
            return Err(invalid("a stage can have at most 10 automations"));
        }
        let now = env::time_now();
        let id = new_id("auto", now);
        self.automations.insert(Automation {
            id: id.clone(),
            stage_id,
            kind,
            subject: subject.trim().to_owned(),
            due_in_days,
            enabled: true,
            created_by,
            created_at: now,
        })?;
        env::emit(Event::AutomationsChanged, Audience::All)?;
        Ok(id)
    }

    /// Turns a rule on or off. Emits `AutomationsChanged`.
    pub fn set_automation_enabled(
        &mut self,
        automation_id: String,
        enabled: bool,
    ) -> app::Result<()> {
        if !self
            .automations
            .update(&automation_id, |a| a.enabled = enabled)?
        {
            return Err(not_found("automation", &automation_id));
        }
        env::emit(Event::AutomationsChanged, Audience::All)?;
        Ok(())
    }

    /// Deletes a rule. Any member may. Emits `AutomationsChanged`.
    pub fn delete_automation(&mut self, automation_id: String) -> app::Result<()> {
        if !self.automations.remove(&automation_id)? {
            return Err(not_found("automation", &automation_id));
        }
        env::emit(Event::AutomationsChanged, Audience::All)?;
        Ok(())
    }

    // ── internal ─────────────────────────────────────────────────────────────

    /// Every stage, in pipeline order (at most 12, one page).
    fn sorted_stages(&self) -> app::Result<Vec<Stage>> {
        let mut stages = self.stages.scan(FindOpts::default().limit(PAGE))?.items;
        stages.sort_by(|a, b| (a.position, &a.id).cmp(&(b.position, &b.id)));
        Ok(stages)
    }

    /// A stage's rules, oldest first (at most 10, one page).
    fn stage_rules(&self, stage_id: &str) -> app::Result<Vec<Automation>> {
        Ok(self
            .automations
            .find(
                "byStage",
                &[KeyPart::Str(stage_id.to_owned())],
                FindOpts::default().limit(PAGE),
            )?
            .items)
    }

    /// A deal's activities, by due date: at most the first 1,000.
    fn deal_activities(&self, deal_id: &str) -> app::Result<Vec<Activity>> {
        Ok(self
            .activities
            .find(
                "byDeal",
                &[KeyPart::Str(deal_id.to_owned())],
                FindOpts::default().limit(PAGE),
            )?
            .items)
    }

    fn load_deal(&self, id: &str) -> app::Result<Deal> {
        self.deals.get(id)?.ok_or_else(|| not_found("deal", id))
    }

    /// One person, with their deal totals.
    fn contact_detail(&self, id: &str) -> app::Result<Option<ContactView>> {
        match self.contacts.get(id)? {
            Some(c) => Ok(Some(self.contact_totals(&c)?)),
            None => Ok(None),
        }
    }

    /// A person's view: open deals from the maintained count, won value
    /// summed over their won deals (at most the first 1,000).
    fn contact_totals(&self, c: &Contact) -> app::Result<ContactView> {
        let of = |status: &str| vec![KeyPart::Str(c.id.clone()), KeyPart::Str(status.to_owned())];
        let open = self.deals.count("perContactStatus", &of("open"))?;
        let won: u64 = self
            .deals
            .find("byContact", &of("won"), FindOpts::default().limit(PAGE))?
            .items
            .iter()
            .map(|d| d.value)
            .fold(0, u64::saturating_add);
        Ok(contact_view(
            c,
            u32::try_from(open).unwrap_or(u32::MAX),
            won,
        ))
    }

    /// The person filed under `email` (trimmed, any case); none for a blank one.
    fn contact_by_email(&self, email: &str) -> app::Result<Option<Contact>> {
        let Some(key) = email_key(email) else {
            return Ok(None);
        };
        Ok(self
            .contacts
            .find(
                "byEmail",
                &[KeyPart::Str(key)],
                FindOpts::default().limit(1),
            )?
            .items
            .into_iter()
            .next())
    }

    fn close_deal(&mut self, deal_id: String, status: &str, reason: String) -> app::Result<()> {
        let now = env::time_now();
        let next = status.to_owned();
        if !self.deals.update(&deal_id, |d| {
            d.status = next;
            d.lost_reason = reason;
            d.closed_at = Some(now);
        })? {
            return Err(not_found("deal", &deal_id));
        }
        env::emit(
            Event::DealStatusChanged {
                id: deal_id,
                status: status.to_owned(),
            },
            Audience::All,
        )?;
        Ok(())
    }

    /// Schedules the stage's enabled rules against the deal, oldest rule
    /// first. The activity is owned by the deal's owner, so the follow-up lands
    /// on the right person's list, and is created by the caller who moved it.
    fn run_automations(&mut self, deal_id: &str, stage_id: &str, now: u64) -> app::Result<()> {
        let rules: Vec<Automation> = self
            .stage_rules(stage_id)?
            .into_iter()
            .filter(|a| a.enabled)
            .take(MAX_AUTOMATIONS_PER_STAGE as usize)
            .collect();
        if rules.is_empty() {
            return Ok(());
        }
        let created_by = actor()?;
        let (owner, contact_id) = self
            .deals
            .get(deal_id)?
            .map(|d| (d.owner, d.contact_id))
            .unwrap_or((None, None));
        for rule in rules {
            let id = new_id("activity", now);
            self.activities.insert(Activity {
                id,
                deal_id: Some(deal_id.to_owned()),
                contact_id: contact_id.clone(),
                kind: rule.kind.clone(),
                subject: rule.subject.clone(),
                due_at: now + u64::from(rule.due_in_days.min(365)) * DAY_MS,
                done: false,
                done_at: None,
                owner: owner.clone(),
                note: String::new(),
                automation_id: Some(rule.id.clone()),
                created_by: created_by.clone(),
                created_at: now,
            })?;
            env::emit(
                Event::AutomationFired {
                    automation_id: rule.id,
                    deal_id: deal_id.to_owned(),
                },
                Audience::All,
            )?;
        }
        Ok(())
    }

    /// Stage probabilities and the first stage: small, read whole.
    fn stage_index(&self) -> app::Result<StageIndex> {
        let stages = self.sorted_stages()?;
        Ok(StageIndex {
            first_stage: stages.first().map(|s| s.id.clone()),
            probability: stages
                .into_iter()
                .map(|s| (s.id, s.probability.min(100)))
                .collect(),
        })
    }

    /// A deal as the board shows it, its facts read through indexes: the
    /// open-activity count is maintained, the next step is the first open
    /// activity by due date, the last touch the latest completed activity or
    /// note, the person's name one read. A few reads per deal, never a scan.
    fn deal_view(&self, d: &Deal, stages: &StageIndex) -> app::Result<DealView> {
        let deal = || KeyPart::Str(d.id.clone());
        let open = self
            .activities
            .count("perDealDone", &[deal(), KeyPart::Bool(false)])?;
        let next = self
            .activities
            .find(
                "byDealOpen",
                &[deal(), KeyPart::Bool(false)],
                FindOpts::default().limit(1),
            )?
            .items
            .into_iter()
            .next()
            .map(|a| NextActivity {
                id: a.id,
                kind: a.kind,
                subject: a.subject,
                due_at: a.due_at,
            });
        let last_done = self
            .activities
            .find(
                "byDealDoneAt",
                &[deal()],
                FindOpts::default().limit(1).reverse(),
            )?
            .items
            .into_iter()
            .next()
            .and_then(|a| a.done_at);
        let last_note = self
            .notes
            .find("byDeal", &[deal()], FindOpts::default().limit(1).reverse())?
            .items
            .into_iter()
            .next()
            .map(|n| n.created_at);
        let contact_name = match &d.contact_id {
            Some(cid) => self.contacts.get(cid)?.map(|c| c.name),
            None => None,
        };
        // A closed deal reopened after its stage was deleted would otherwise
        // sit in a column that no longer exists, invisible on every board.
        let stage_id = if stages.probability.contains_key(&d.stage_id) {
            d.stage_id.clone()
        } else {
            stages
                .first_stage
                .clone()
                .unwrap_or_else(|| d.stage_id.clone())
        };
        let probability = match d.status.as_str() {
            "won" => 100,
            "lost" => 0,
            _ => stages.probability.get(&stage_id).copied().unwrap_or(0),
        };
        Ok(DealView {
            id: d.id.clone(),
            title: d.title.clone(),
            value: d.value,
            organization: d.organization.clone(),
            contact_id: d.contact_id.clone(),
            contact_name,
            owner: d.owner.clone(),
            stage_id,
            status: d.status.clone(),
            lost_reason: d.lost_reason.clone(),
            expected_close: d.expected_close,
            source: d.source.clone(),
            probability,
            stage_entered_at: d.stage_entered_at,
            closed_at: d.closed_at,
            next_activity: next,
            open_activities: u32::try_from(open).unwrap_or(u32::MAX),
            last_touch_at: last_done.max(last_note),
            created_by: d.created_by.clone(),
            created_at: d.created_at,
        })
    }
}

/// A typed failure: `422 APP_ERROR` with `{ code, fields }` on the wire. v1's
/// `"not found: …"`, `"invalid input: …"` and `"forbidden: …"` messages, with
/// the prefix as the code.
#[app::error]
pub enum Error {
    /// No `what` (`stage`, `deal`, `contact`, `activity`, `note`, `automation`)
    /// with this id.
    NotFound { what: String, id: String },
    /// An argument broke a rule; `message` says which.
    Invalid { message: String },
    /// The caller is not the record's creator or the note's author.
    Forbidden { message: String },
}

/// A change to the pipeline, emitted to everyone the app reaches after the
/// write that caused it. v1's events, with camelCase field names. The frontend
/// re-reads on any of them; they are the audit trail an integration follows.
#[app::event]
pub enum Event {
    /// A deal was added to the pipeline.
    DealCreated { id: String, stage_id: String },
    /// One of a deal's fields (title, value, contact, owner, …) changed.
    DealUpdated { id: String },
    /// A deal moved to another stage.
    DealMoved { id: String, stage_id: String },
    /// A deal was closed as won, closed as lost, or reopened.
    DealStatusChanged { id: String, status: String },
    /// A deal was deleted, with its activities and notes.
    DealDeleted { id: String },
    /// A person was added, edited or removed.
    ContactChanged { id: String },
    /// An activity was scheduled, completed, rescheduled or deleted.
    ActivityChanged { id: String },
    /// An automation scheduled an activity when a deal entered a stage.
    AutomationFired {
        automation_id: String,
        deal_id: String,
    },
    /// A note was added to or removed from a deal.
    NoteChanged { id: String, deal_id: String },
    /// A stage was added, renamed, re-weighted, reordered or removed.
    StagesChanged,
    /// An automation rule was added, toggled or removed.
    AutomationsChanged,
    /// The pipeline's currency or rotting threshold changed.
    SettingsChanged,
    /// Another app (or an account) handed over a lead with `submitLead`;
    /// `source` is `app:<id>` or the account.
    LeadReceived {
        deal_id: String,
        contact_id: String,
        source: String,
        source_ref: String,
    },
}

// ── views ────────────────────────────────────────────────────────────────────

/// The stages a deal view needs: probabilities and the first stage.
struct StageIndex {
    probability: BTreeMap<String, u32>,
    /// Where a deal whose stage was deleted under it is shown: the first stage.
    first_stage: Option<String>,
}

fn stage_view(s: &Stage) -> StageView {
    StageView {
        id: s.id.clone(),
        name: s.name.clone(),
        probability: s.probability.min(100),
        position: s.position,
    }
}

fn contact_view(c: &Contact, open_deals: u32, won_value: u64) -> ContactView {
    ContactView {
        id: c.id.clone(),
        name: c.name.clone(),
        email: c.email.clone(),
        phone: c.phone.clone(),
        organization: c.organization.clone(),
        job_title: c.job_title.clone(),
        open_deals,
        won_value,
        created_by: c.created_by.clone(),
        created_at: c.created_at,
    }
}

fn activity_view(a: &Activity, titles: &BTreeMap<String, String>) -> ActivityView {
    ActivityView {
        id: a.id.clone(),
        deal_title: a.deal_id.as_ref().and_then(|d| titles.get(d).cloned()),
        deal_id: a.deal_id.clone(),
        contact_id: a.contact_id.clone(),
        kind: a.kind.clone(),
        subject: a.subject.clone(),
        due_at: a.due_at,
        done: a.done,
        done_at: a.done_at,
        owner: a.owner.clone(),
        note: a.note.clone(),
        automation_id: a.automation_id.clone(),
        created_by: a.created_by.clone(),
        created_at: a.created_at,
    }
}

fn note_view(n: &Note) -> NoteView {
    NoteView {
        id: n.id.clone(),
        deal_id: n.deal_id.clone(),
        author: n.author.clone(),
        body: n.body.clone(),
        created_at: n.created_at,
    }
}

fn automation_view(a: &Automation) -> AutomationView {
    AutomationView {
        id: a.id.clone(),
        stage_id: a.stage_id.clone(),
        kind: a.kind.clone(),
        subject: a.subject.clone(),
        due_in_days: a.due_in_days,
        enabled: a.enabled,
        created_by: a.created_by.clone(),
        created_at: a.created_at,
    }
}

// ── helpers ──────────────────────────────────────────────────────────────────

/// The account the caller acts for (a signed-in account, or an API key acting
/// for one): what `created_by` and `author` record.
fn account() -> app::Result<String> {
    match env::caller() {
        Caller::Account(account) | Caller::ApiKey { account, .. } => Ok(account),
        Caller::Public | Caller::System | Caller::App(_) => Err(AppError::login_required()),
    }
}

/// Who a record is by: the account, or `app:<id>` for another app's xcall.
fn actor() -> app::Result<String> {
    match env::caller() {
        Caller::App(id) => Ok(format!("app:{id}")),
        _ => account(),
    }
}

/// Whether the caller may delete a record by `created_by`: its creator, or,
/// for one another app created, the org's owner and admins.
fn may_delete(created_by: &str) -> app::Result<bool> {
    let me = account()?;
    if created_by == me {
        return Ok(true);
    }
    Ok(created_by.starts_with("app:")
        && matches!(
            env::org_role(&me),
            Some(env::OrgRole::Admin | env::OrgRole::Owner)
        ))
}

/// A list view's page options: `limit` 1 to 1,000 (100 when unset).
fn page_opts(cursor: Option<String>, limit: Option<u32>) -> app::Result<FindOpts> {
    let limit = limit.unwrap_or(DEFAULT_PAGE);
    if !(1..=PAGE).contains(&limit) {
        return Err(invalid("limit must be between 1 and 1000"));
    }
    let opts = FindOpts::default().limit(limit);
    Ok(match cursor {
        Some(c) => opts.cursor(c),
        None => opts,
    })
}

/// A search view's options: `limit` 1 to 100 (20 when unset), the last word
/// matched as a prefix.
fn search_opts(cursor: Option<u32>, limit: Option<u32>) -> app::Result<SearchOpts> {
    let limit = limit.unwrap_or(20);
    if !(1..=100).contains(&limit) {
        return Err(invalid("limit must be between 1 and 100"));
    }
    let opts = SearchOpts::default().mode(SearchMode::Prefix).limit(limit);
    Ok(match cursor {
        Some(c) => opts.cursor(c),
        None => opts,
    })
}

fn name_key(name: &str) -> String {
    name.trim().to_lowercase()
}

fn email_key(email: &str) -> Option<String> {
    let e = email.trim().to_lowercase();
    (!e.is_empty()).then_some(e)
}

/// `{prefix}-{ms}-{8 hex}`, as v1 minted it. The random bytes are seeded per
/// logged run, so a replay mints the same id.
fn new_id(prefix: &str, now: u64) -> String {
    let hex: String = env::random_bytes(4)
        .iter()
        .map(|b| format!("{b:02x}"))
        .collect();
    format!("{prefix}-{now}-{hex}")
}

/// `Some("")` / `Some("  ")` mean "none": the form sends empty strings.
fn normalize_opt(v: Option<String>) -> Option<String> {
    v.map(|s| s.trim().to_owned()).filter(|s| !s.is_empty())
}

fn not_found(what: &str, id: &str) -> AppError {
    Error::NotFound {
        what: what.to_owned(),
        id: id.to_owned(),
    }
    .into()
}

fn invalid(message: impl Into<String>) -> AppError {
    Error::Invalid {
        message: message.into(),
    }
    .into()
}

fn forbidden(message: impl Into<String>) -> AppError {
    Error::Forbidden {
        message: message.into(),
    }
    .into()
}

fn validate_name(field: &str, v: &str) -> app::Result<()> {
    if v.trim().is_empty() {
        return Err(invalid(format!("{field} must not be empty")));
    }
    validate_optional_name(field, v)
}

fn validate_optional_name(field: &str, v: &str) -> app::Result<()> {
    if v.trim().chars().count() > MAX_NAME_LEN {
        return Err(invalid(format!(
            "{field} must be at most {MAX_NAME_LEN} characters"
        )));
    }
    Ok(())
}

fn validate_text(field: &str, v: &str) -> app::Result<()> {
    if v.chars().count() > MAX_TEXT_LEN {
        return Err(invalid(format!(
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
        Err(invalid(format!("kind must be one of {ACTIVITY_KINDS:?}")))
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
