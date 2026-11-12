//! Mero Updates: investor updates and investor relations, on core's component
//! SDK (`calimero-sdk`).
//!
//! The shape of Visible / Cabal / Paperstreet, on an app instance instead of a
//! SaaS database. One instance is one AUDIENCE ("All investors", "Board") in a
//! company's organization: the company's team publishes updates into it, and
//! everyone the organization lets in (investors, advisors) reads, reacts,
//! comments, answers asks and asks questions back.
//!
//! ── The model ────────────────────────────────────────────────────────────────
//!
//! * **Team vs readers.** Admins are the instance's owner (its creator) and the
//!   organization's owner and admins. Admins add the `team` (co-founders, a
//!   finance lead). Team members publish updates, manage categories, triage asks
//!   and see engagement. Everyone else the organization lets in is a reader.
//! * **Posts** are either an `update` (team only: sections, KPIs, asks) or a
//!   `question` (anyone: investor-initiated). Both carry comments and reactions.
//! * **Categories** are the team's taxonomy; readers can mute the ones they do
//!   not care about.
//! * **Asks** are structured requests inside an update. A reader answers one
//!   with an **offer**; the team accepts it, and accepted offers become
//!   **contributions** the next update can thank.
//! * **Reads** are recorded per account: open tracking a reader can see.
//! * **Drafts** are the author's own: kept per account and returned only to it
//!   (v1 kept them in node-local `#[app::private]` storage, which the component
//!   SDK does not have; see the README).
//!
//! ── Who can write what ───────────────────────────────────────────────────────
//!
//! The app runs on its cluster's leader, which applies every write in one
//! replicated log, so there is no patched node to defend against and nothing
//! to merge: v1's `AccessControl`, `SharedStorage`, `Moderated`, `Authored` and
//! `UserStorage` write rules are checks in each method, against
//! `env::caller()`, before anything is written:
//!
//! * team data (settings, categories, updates, asks, the triage of questions and
//!   offers) is written only by the team (`Forbidden` otherwise);
//! * a question or a comment records its `author`; the author edits it, the
//!   author or the team deletes it;
//! * reactions, reads, offers, profiles, mutes and drafts are keyed by the
//!   caller's own account, so nobody acts in someone else's name.
//!
//! ⚠️ "Team only" views (every offer on an ask, the engagement report) are
//! answered to the team only; the rest of an audience is readable by everyone
//! the organization lets into the instance.

use std::collections::{BTreeMap, BTreeSet};

use calimero_sdk::env::{Caller, OrgRole};
use calimero_sdk::json::u64_str;
use calimero_sdk::prelude::*;
use calimero_sdk::StorageError;
use serde::{Deserialize, Serialize};

// ── Limits ───────────────────────────────────────────────────────────────────

const MAX_TITLE: usize = 200;
const MAX_SUMMARY: usize = 1_000;
const MAX_BODY: usize = 20_000;
const MAX_SHORT: usize = 80;
const MAX_NAME: usize = 64;
const MAX_SECTIONS: usize = 20;
const MAX_METRICS: usize = 30;
const MAX_ASKS: usize = 10;
const MAX_CATEGORIES: usize = 50;
const MAX_DRAFT: usize = 100_000;
const MAX_PAGE: usize = 100;
const DEFAULT_PAGE: usize = 20;
/// Rows per storage read; every list below reads page after page.
const PAGE: u32 = 1000;

pub const KIND_UPDATE: &str = "update";
pub const KIND_QUESTION: &str = "question";

/// A fixed palette: one tap to react, and no free text in every reader's view.
const REACTIONS: &[&str] = &["👍", "🎉", "❤️", "🚀", "👀", "🙏"];

const ASK_KINDS: &[&str] = &[
    "intro",
    "hire",
    "customer",
    "advice",
    "fundraising",
    "other",
];
const ASK_STATUSES: &[&str] = &["open", "resolved"];
const QUESTION_STATUSES: &[&str] = &["open", "answered"];
const OFFER_STATUSES: &[&str] = &["offered", "accepted", "declined"];

// ── Stored records ───────────────────────────────────────────────────────────

/// One block of an update: "Highlights", "Lowlights", "Product", "Thanks"…
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize, AbiType)]
#[serde(deny_unknown_fields)]
pub struct Section {
    /// A template hint ("highlights", "product", "text"…), free text.
    pub kind: String,
    pub title: String,
    pub body: String,
}

/// One KPI as reported in one update. `value` is a string on purpose ("$1.2M",
/// "38%"): the contract keeps what was reported, exactly as reported.
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize, AbiType)]
#[serde(deny_unknown_fields)]
pub struct Metric {
    pub name: String,
    pub value: String,
    pub unit: String,
}

/// An update or a question, as stored. A plain value in a map (not a table
/// record): it carries its sections and metrics, and a record cannot hold a
/// list. Both lists are short and bounded (see each field); everything that
/// grows with use (asks, offers, comments, reactions, reads) is its own table,
/// indexed on the post id and read in pages.
#[derive(Debug, Clone, Serialize, Deserialize)]
struct Post {
    id: String,
    kind: String,
    /// The account that published or asked it.
    author: String,
    title: String,
    summary: String,
    category_id: String,
    /// At most `MAX_SECTIONS` (20), enforced by `validate_update` on every
    /// publish and edit (a question holds at most one).
    sections: Vec<Section>,
    /// At most `MAX_METRICS` (30), enforced by `validate_update` (a question
    /// holds none).
    metrics: Vec<Metric>,
    edited_at: u64,
    created_at: u64,
    /// `published` for an update; `open` / `answered` for a question.
    status: String,
    status_at: u64,
    /// An update is tombstoned (its asks go with it); a question is removed.
    deleted: bool,
}

/// A structured request inside an update.
#[derive(Record, Clone)]
#[table(key = "id", index(by_post = ["post_id", "created_at"]))]
pub struct Ask {
    pub id: String,
    pub post_id: String,
    pub kind: String,
    pub title: String,
    pub detail: String,
    pub status: String,
    pub created_at: u64,
    pub edited_at: u64,
    pub status_at: u64,
    pub deleted: bool,
}

/// One reader's offer to help with one ask, keyed by the ask and the helper's
/// account. The helper writes `note` / `withdrawn`; the team writes `status`.
#[derive(Record, Clone)]
#[table(
    key = ["ask_id", "account"],
    index(by_ask = ["ask_id", "created_at"]),
    index(by_account = ["account", "ask_id"]),
)]
pub struct Offer {
    pub ask_id: String,
    pub account: String,
    pub note: String,
    pub withdrawn: bool,
    /// `offered`, `accepted` or `declined`.
    pub status: String,
    pub status_at: u64,
    pub created_at: u64,
    pub updated_at: u64,
}

/// A reply on a post. One level of nesting via `parent_id` ("" for top level).
#[derive(Record, Clone)]
#[table(
    key = "id",
    index(thread = ["post_id", "created_at"]),
    count(per_post = ["post_id"]),
    count(per_author = ["author"]),
)]
pub struct Comment {
    pub id: String,
    pub post_id: String,
    pub parent_id: String,
    pub author: String,
    pub body: String,
    pub created_at: u64,
    pub edited_at: u64,
}

/// One account's one emoji on one post. Present while it is on.
#[derive(Record, Clone)]
#[table(
    key = ["post_id", "account", "emoji"],
    count(per_emoji = ["post_id", "emoji"]),
)]
pub struct Reaction {
    pub post_id: String,
    pub account: String,
    pub emoji: String,
    pub updated_at: u64,
}

/// A read receipt: first and latest open of one post by one account.
#[derive(Record, Clone)]
#[table(
    key = ["post_id", "account"],
    index(by_post = ["post_id", "first_at"]),
    index(by_account = ["account", "post_id"]),
    count(per_post = ["post_id"]),
)]
pub struct Read {
    pub post_id: String,
    pub account: String,
    pub first_at: u64,
    pub last_at: u64,
}

/// Who a member says they are. A claim, not an identity: the account is the
/// only thing that authorises anything.
#[derive(Record, Clone)]
#[table(key = "account")]
pub struct Profile {
    pub account: String,
    pub name: String,
    /// Fund, firm or company: "Seed Capital", "Angel".
    pub firm: String,
    pub joined_at: u64,
    pub updated_at: u64,
}

/// A category of updates.
#[derive(Record, Clone)]
#[table(key = "id", index(by_created = ["created_at"]))]
pub struct Category {
    pub id: String,
    pub name: String,
    pub emoji: String,
    /// A CSS colour token or hex. Presentation only.
    pub color: String,
    pub created_at: u64,
    pub edited_at: u64,
    pub archived: bool,
}

/// Audience-wide settings.
#[derive(Debug, Clone, Default, Serialize, Deserialize)]
struct StoredSettings {
    company_name: String,
    /// Days between updates; 0 = no cadence.
    cadence_days: u32,
    updated_at: u64,
}

/// A saved, unpublished update, keyed by its author and its id.
#[derive(Debug, Clone, Serialize, Deserialize)]
struct Draft {
    id: String,
    title: String,
    /// The composer's own JSON, opaque here.
    payload: String,
    updated_at: u64,
}

// ── Inputs ───────────────────────────────────────────────────────────────────

/// One ask in an update being published or edited.
#[derive(Debug, Clone, Serialize, Deserialize, AbiType)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct AskInput {
    /// Set to edit an existing ask of this update; `null` creates one.
    #[serde(default)]
    pub id: Option<String>,
    pub kind: String,
    pub title: String,
    pub detail: String,
}

/// The content of an update.
#[derive(Debug, Clone, Serialize, Deserialize, AbiType)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct UpdateInput {
    pub title: String,
    pub summary: String,
    pub category_id: String,
    pub sections: Vec<Section>,
    pub metrics: Vec<Metric>,
    pub asks: Vec<AskInput>,
}

// ── Results ──────────────────────────────────────────────────────────────────
//
// Plain serde structs with camelCase names; every `u64` is a decimal string
// (`json::u64_str`), as the component ABI sends 64-bit integers.

#[derive(Serialize, AbiType)]
#[serde(rename_all = "camelCase")]
pub struct Settings {
    pub company_name: String,
    pub cadence_days: u32,
    #[serde(with = "u64_str")]
    pub updated_at: u64,
}

#[derive(Serialize, AbiType)]
#[serde(rename_all = "camelCase")]
pub struct MeView {
    pub account: String,
    pub name: String,
    pub firm: String,
    pub is_admin: bool,
    pub is_team: bool,
    pub muted: Vec<String>,
}

#[derive(Serialize, AbiType)]
#[serde(rename_all = "camelCase")]
pub struct PersonView {
    pub account: String,
    pub name: String,
    pub firm: String,
    pub is_admin: bool,
    pub is_team: bool,
    #[serde(with = "u64_str")]
    pub joined_at: u64,
    /// Updates this person has opened, out of `updatesTotal`.
    #[serde(with = "u64_str")]
    pub updates_read: u64,
    #[serde(with = "u64_str")]
    pub updates_total: u64,
    #[serde(with = "u64_str")]
    pub last_read_at: u64,
    #[serde(with = "u64_str")]
    pub comments: u64,
    #[serde(with = "u64_str")]
    pub offers: u64,
    #[serde(with = "u64_str")]
    pub accepted_offers: u64,
}

#[derive(Serialize, AbiType)]
#[serde(rename_all = "camelCase")]
pub struct CategoryView {
    pub id: String,
    pub name: String,
    pub emoji: String,
    pub color: String,
    #[serde(with = "u64_str")]
    pub update_count: u64,
    #[serde(with = "u64_str")]
    pub unread_count: u64,
    pub muted: bool,
}

#[derive(Serialize, AbiType)]
#[serde(rename_all = "camelCase")]
pub struct ReactionCount {
    pub emoji: String,
    #[serde(with = "u64_str")]
    pub count: u64,
    pub mine: bool,
}

#[derive(Serialize, AbiType)]
#[serde(rename_all = "camelCase")]
pub struct OfferView {
    pub ask_id: String,
    pub account: String,
    pub name: String,
    pub firm: String,
    pub note: String,
    pub status: String,
    #[serde(with = "u64_str")]
    pub created_at: u64,
    #[serde(with = "u64_str")]
    pub updated_at: u64,
}

#[derive(Serialize, AbiType)]
#[serde(rename_all = "camelCase")]
pub struct AskView {
    pub id: String,
    pub post_id: String,
    pub post_title: String,
    pub kind: String,
    pub title: String,
    pub detail: String,
    pub status: String,
    #[serde(with = "u64_str")]
    pub created_at: u64,
    #[serde(with = "u64_str")]
    pub offer_count: u64,
    /// Every offer, for the TEAM only; empty for readers.
    pub offers: Vec<OfferView>,
    /// The caller's own offer, if any.
    pub my_offer: Option<OfferView>,
}

#[derive(Serialize, AbiType)]
#[serde(rename_all = "camelCase")]
pub struct PostCard {
    pub id: String,
    pub kind: String,
    pub author: String,
    pub author_name: String,
    pub author_is_team: bool,
    pub title: String,
    pub summary: String,
    pub category_id: String,
    pub status: String,
    #[serde(with = "u64_str")]
    pub created_at: u64,
    #[serde(with = "u64_str")]
    pub edited_at: u64,
    #[serde(with = "u64_str")]
    pub comment_count: u64,
    #[serde(with = "u64_str")]
    pub ask_count: u64,
    #[serde(with = "u64_str")]
    pub open_ask_count: u64,
    #[serde(with = "u64_str")]
    pub metric_count: u64,
    #[serde(with = "u64_str")]
    pub read_count: u64,
    pub read_by_me: bool,
    pub reactions: Vec<ReactionCount>,
}

#[derive(Serialize, AbiType)]
#[serde(rename_all = "camelCase")]
pub struct PostView {
    pub card: PostCard,
    pub sections: Vec<Section>,
    pub metrics: Vec<Metric>,
    pub asks: Vec<AskView>,
}

#[derive(Serialize, AbiType)]
#[serde(rename_all = "camelCase")]
pub struct PostPage {
    pub items: Vec<PostCard>,
    pub next_cursor: Option<String>,
}

#[derive(Serialize, AbiType)]
#[serde(rename_all = "camelCase")]
pub struct CommentView {
    pub id: String,
    pub post_id: String,
    pub parent_id: String,
    pub author: String,
    pub author_name: String,
    pub author_is_team: bool,
    pub body: String,
    #[serde(with = "u64_str")]
    pub created_at: u64,
    #[serde(with = "u64_str")]
    pub edited_at: u64,
}

#[derive(Serialize, AbiType)]
#[serde(rename_all = "camelCase")]
pub struct MetricPoint {
    pub post_id: String,
    pub post_title: String,
    #[serde(with = "u64_str")]
    pub at: u64,
    pub value: String,
}

#[derive(Serialize, AbiType)]
#[serde(rename_all = "camelCase")]
pub struct MetricSeries {
    pub name: String,
    pub unit: String,
    /// Oldest first, one point per update that reported this metric.
    pub points: Vec<MetricPoint>,
}

#[derive(Serialize, AbiType)]
#[serde(rename_all = "camelCase")]
pub struct ContributionView {
    pub ask_id: String,
    pub ask_title: String,
    pub ask_kind: String,
    pub account: String,
    pub name: String,
    pub firm: String,
    pub note: String,
    #[serde(with = "u64_str")]
    pub accepted_at: u64,
}

#[derive(Serialize, AbiType)]
#[serde(rename_all = "camelCase")]
pub struct Overview {
    pub company_name: String,
    pub cadence_days: u32,
    /// When the latest update went out, 0 if none has.
    #[serde(with = "u64_str")]
    pub last_update_at: u64,
    /// `lastUpdateAt + cadence`, 0 when there is no cadence or no update yet.
    #[serde(with = "u64_str")]
    pub next_due_at: u64,
    #[serde(with = "u64_str")]
    pub updates_total: u64,
    /// Unread updates in categories the caller has NOT muted.
    #[serde(with = "u64_str")]
    pub unread_updates: u64,
    #[serde(with = "u64_str")]
    pub open_asks: u64,
    #[serde(with = "u64_str")]
    pub open_questions: u64,
    #[serde(with = "u64_str")]
    pub people: u64,
    pub is_team: bool,
}

#[derive(Serialize, AbiType)]
#[serde(rename_all = "camelCase")]
pub struct ReaderView {
    pub account: String,
    pub name: String,
    pub firm: String,
    #[serde(with = "u64_str")]
    pub first_at: u64,
}

#[derive(Serialize, AbiType)]
#[serde(rename_all = "camelCase")]
pub struct EngagementRow {
    pub post_id: String,
    pub title: String,
    pub category_id: String,
    #[serde(with = "u64_str")]
    pub published_at: u64,
    pub readers: Vec<ReaderView>,
    /// Non-team members with a profile who have not opened it.
    pub not_read: Vec<ReaderView>,
    #[serde(with = "u64_str")]
    pub reactions: u64,
    #[serde(with = "u64_str")]
    pub comments: u64,
    #[serde(with = "u64_str")]
    pub offers: u64,
}

#[derive(Serialize, AbiType)]
#[serde(rename_all = "camelCase")]
pub struct DraftView {
    pub id: String,
    pub title: String,
    pub payload: String,
    #[serde(with = "u64_str")]
    pub updated_at: u64,
}

// ── State ────────────────────────────────────────────────────────────────────

/// One audience.
#[app::state(version = 1)]
pub struct MeroUpdates {
    /// Accounts an admin added to the team (admins are team without being here).
    teammates: Set<String>,
    settings: Cell<StoredSettings>,
    categories: Table<Category>,
    /// Updates by id. A tombstoned update stays, flagged `deleted`.
    updates: UnorderedMap<String, Post>,
    /// Questions by id.
    questions: UnorderedMap<String, Post>,
    asks: Table<Ask>,
    offers: Table<Offer>,
    comments: Table<Comment>,
    reactions: Table<Reaction>,
    reads: Table<Read>,
    profiles: Table<Profile>,
    /// The categories each account muted: at most `MAX_CATEGORIES` (50),
    /// enforced by `set_muted_categories`, which replaces the whole set.
    mutes: PerUser<Vec<String>>,
    /// Drafts by `(author account, draft id)`.
    drafts: UnorderedMap<(String, String), Draft>,
}

// ── Helpers ──────────────────────────────────────────────────────────────────

/// The account the caller acts for (a signed-in account, or an API key acting
/// for one).
fn account() -> app::Result<String> {
    match env::caller() {
        Caller::Account(account) | Caller::ApiKey { account, .. } => Ok(account),
        Caller::Public | Caller::System | Caller::App(_) => Err(AppError::login_required()),
    }
}

/// 16 random bytes as hex. Seeded per logged run, so a replay mints the same id.
fn fresh_id() -> String {
    env::random_bytes(16)
        .iter()
        .map(|b| format!("{b:02x}"))
        .collect()
}

fn invalid(message: impl Into<String>) -> AppError {
    Error::Invalid {
        message: message.into(),
    }
    .into()
}

fn not_found(message: impl Into<String>) -> AppError {
    Error::NotFound {
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

fn check_len(field: &str, value: &str, max: usize, required: bool) -> app::Result<()> {
    if required && value.trim().is_empty() {
        return Err(invalid(format!("{field} must not be empty")));
    }
    if value.len() > max {
        return Err(invalid(format!(
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
        Err(invalid(format!(
            "{field} must be one of {}, got {value:?}",
            allowed.join(", ")
        )))
    }
}

/// Every row of a paged read, page after page.
fn all_pages<T>(
    mut read: impl FnMut(FindOpts) -> Result<Page<T>, StorageError>,
) -> app::Result<Vec<T>> {
    let mut out = Vec::new();
    let mut opts = FindOpts::default().limit(PAGE);
    loop {
        let page = read(opts)?;
        out.extend(page.items);
        match page.next {
            Some(cursor) => opts = FindOpts::default().limit(PAGE).cursor(cursor),
            None => return Ok(out),
        }
    }
}

fn s(v: &str) -> KeyPart {
    KeyPart::Str(v.to_owned())
}

fn content_of(input: &UpdateInput) -> (String, String, String, Vec<Section>, Vec<Metric>) {
    (
        input.title.trim().to_owned(),
        input.summary.clone(),
        input.category_id.clone(),
        // A section with nothing in it is a template placeholder the founder
        // skipped: publishing it would render an empty heading.
        input
            .sections
            .iter()
            .filter(|s| !s.body.trim().is_empty())
            .cloned()
            .collect(),
        input
            .metrics
            .iter()
            .map(|m| Metric {
                name: m.name.trim().to_owned(),
                value: m.value.trim().to_owned(),
                unit: m.unit.trim().to_owned(),
            })
            .collect(),
    )
}

// ── Logic ────────────────────────────────────────────────────────────────────

#[app::logic]
impl MeroUpdates {
    /// The empty audience. The node runs it once, when the instance is created;
    /// it takes no arguments. Its creator (the instance's owner) is its first
    /// admin.
    #[app::init]
    pub fn init() -> app::Result<Self> {
        Ok(Self::load())
    }

    // ── identity & roles ─────────────────────────────────────────────────────

    /// The instance's owner, or an owner or admin of its organization.
    fn is_admin(&self, account: &str) -> bool {
        if account.is_empty() {
            return false;
        }
        account == env::app_owner()
            || matches!(
                env::org_role(account),
                Some(OrgRole::Admin | OrgRole::Owner)
            )
    }

    /// An admin, or an account an admin added to the team.
    fn is_team(&self, account: &str) -> bool {
        self.is_admin(account)
            || self
                .teammates
                .contains(&account.to_owned())
                .unwrap_or(false)
    }

    /// The caller, if they are on the team; `Forbidden` otherwise.
    fn require_team(&self) -> app::Result<String> {
        let me = account()?;
        if self.is_team(&me) {
            Ok(me)
        } else {
            Err(forbidden("only the company team can do this"))
        }
    }

    fn require_admin(&self) -> app::Result<String> {
        let me = account()?;
        if self.is_admin(&me) {
            Ok(me)
        } else {
            Err(forbidden("only an admin can do this"))
        }
    }

    /// The instance's owner and every teammate (the organization's admins are
    /// listed once they have written something).
    fn team_accounts(&self) -> app::Result<BTreeSet<String>> {
        let mut team: BTreeSet<String> =
            all_pages(|o| self.teammates.page(o))?.into_iter().collect();
        let _ = team.insert(env::app_owner());
        Ok(team)
    }

    /// Registers the caller with an empty profile if they have none: every
    /// write a member makes puts them on the team's people list.
    fn touch_profile(&mut self, me: &str) -> app::Result<()> {
        if self.profiles.contains(me)? {
            return Ok(());
        }
        let now = env::time_now();
        self.profiles.insert(Profile {
            account: me.to_owned(),
            name: String::new(),
            firm: String::new(),
            joined_at: now,
            updated_at: now,
        })?;
        Ok(())
    }

    fn muted_of(&self, account: &str) -> app::Result<Vec<String>> {
        Ok(self.mutes.get_for(account)?.unwrap_or_default())
    }

    fn name_of(&self, account: &str) -> app::Result<(String, String)> {
        Ok(self
            .profiles
            .get(account)?
            .map(|p| (p.name, p.firm))
            .unwrap_or_default())
    }

    /// The caller: their account, name, roles and muted categories.
    #[app::view]
    pub fn get_me(&self) -> app::Result<MeView> {
        let me = account()?;
        let profile = self.profiles.get(me.as_str())?;
        Ok(MeView {
            is_admin: self.is_admin(&me),
            is_team: self.is_team(&me),
            name: profile.as_ref().map(|p| p.name.clone()).unwrap_or_default(),
            firm: profile.as_ref().map(|p| p.firm.clone()).unwrap_or_default(),
            muted: self.muted_of(&me)?,
            account: me,
        })
    }

    /// Name yourself. No `account` argument: you can only describe yourself.
    /// Emits `ProfileSet`.
    pub fn set_profile(&mut self, name: String, firm: String) -> app::Result<()> {
        let me = account()?;
        let name = name.trim().to_owned();
        let firm = firm.trim().to_owned();
        check_len("name", &name, MAX_NAME, false)?;
        check_len("firm", &firm, MAX_NAME, false)?;
        let now = env::time_now();
        let joined_at = self.profiles.get(me.as_str())?.map_or(now, |p| p.joined_at);
        self.profiles.upsert(Profile {
            account: me.clone(),
            name,
            firm,
            joined_at,
            updated_at: now,
        })?;
        env::emit(Event::ProfileSet { account: me }, Audience::All)?;
        Ok(())
    }

    /// Mute categories: their updates stop counting as unread for you. Replaces
    /// the whole set. Emits `ProfileSet`.
    pub fn set_muted_categories(&mut self, category_ids: Vec<String>) -> app::Result<()> {
        let me = account()?;
        if category_ids.len() > MAX_CATEGORIES {
            return Err(invalid("too many categories"));
        }
        self.touch_profile(&me)?;
        let mut ids = category_ids;
        ids.sort();
        ids.dedup();
        let _ = self.mutes.set(&ids)?;
        env::emit(Event::ProfileSet { account: me }, Audience::All)?;
        Ok(())
    }

    /// Everyone this audience knows about: the owner, every teammate, and every
    /// member who has written anything (a profile, a read, a comment…). Team
    /// first, then by name, then by account.
    #[app::view]
    pub fn list_people(&self) -> app::Result<Vec<PersonView>> {
        let update_ids: BTreeSet<String> = self.live_updates()?.into_iter().map(|p| p.id).collect();
        let total = update_ids.len() as u64;

        let mut accounts = self.team_accounts()?;
        for p in all_pages(|o| self.profiles.scan(o))? {
            let _ = accounts.insert(p.account);
        }

        let mut out = Vec::with_capacity(accounts.len());
        for account in accounts {
            let profile = self.profiles.get(account.as_str())?;
            let (mut read, mut last) = (0u64, 0u64);
            for r in all_pages(|o| self.reads.find("byAccount", &[s(&account)], o))? {
                if update_ids.contains(&r.post_id) {
                    read += 1;
                    last = last.max(r.last_at);
                }
            }
            let offers: Vec<Offer> =
                all_pages(|o| self.offers.find("byAccount", &[s(&account)], o))?
                    .into_iter()
                    .filter(|o| !o.withdrawn)
                    .collect();
            out.push(PersonView {
                is_admin: self.is_admin(&account),
                is_team: self.is_team(&account),
                name: profile.as_ref().map(|p| p.name.clone()).unwrap_or_default(),
                firm: profile.as_ref().map(|p| p.firm.clone()).unwrap_or_default(),
                joined_at: profile.as_ref().map(|p| p.joined_at).unwrap_or_default(),
                updates_read: read,
                updates_total: total,
                last_read_at: last,
                comments: self.comments.count("perAuthor", &[s(&account)])?,
                offers: offers.len() as u64,
                accepted_offers: offers.iter().filter(|o| o.status == "accepted").count() as u64,
                account,
            });
        }
        out.sort_by(|a, b| {
            (!a.is_team, a.name.to_lowercase(), &a.account).cmp(&(
                !b.is_team,
                b.name.to_lowercase(),
                &b.account,
            ))
        });
        Ok(out)
    }

    /// Make a member of the organization part of the team. Admin only.
    /// `Invalid` for an account the organization does not hold. Emits
    /// `TeamChanged`.
    pub fn add_teammate(&mut self, account: String) -> app::Result<()> {
        let _ = self.require_admin()?;
        let who = account.trim().to_owned();
        if who.is_empty() || (env::org().is_some() && env::org_role(&who).is_none()) {
            return Err(invalid(format!("not a member of this company: {account}")));
        }
        let _ = self.teammates.insert(&who)?;
        env::emit(Event::TeamChanged { account: who }, Audience::All)?;
        Ok(())
    }

    /// Take a member off the team. Admin only. An admin stays team: their role
    /// comes from the organization. Emits `TeamChanged`.
    pub fn remove_teammate(&mut self, account: String) -> app::Result<()> {
        let _ = self.require_admin()?;
        let who = account.trim().to_owned();
        if who.is_empty() {
            return Err(invalid(format!("not an account id: {account}")));
        }
        let _ = self.teammates.remove(&who)?;
        env::emit(Event::TeamChanged { account: who }, Audience::All)?;
        Ok(())
    }

    // ── settings ─────────────────────────────────────────────────────────────

    fn settings_or_default(&self) -> app::Result<StoredSettings> {
        Ok(self.settings.get()?.unwrap_or_default())
    }

    /// The company name and cadence; empty and 0 until the team sets them.
    #[app::view]
    pub fn get_settings(&self) -> app::Result<Settings> {
        let s = self.settings_or_default()?;
        Ok(Settings {
            company_name: s.company_name,
            cadence_days: s.cadence_days,
            updated_at: s.updated_at,
        })
    }

    /// Team only. `cadenceDays` is at most 366 (0 = none). Emits
    /// `SettingsChanged`.
    pub fn set_settings(&mut self, company_name: String, cadence_days: u32) -> app::Result<()> {
        let _ = self.require_team()?;
        let company_name = company_name.trim().to_owned();
        check_len("company name", &company_name, MAX_NAME, false)?;
        if cadence_days > 366 {
            return Err(invalid("cadence must be at most 366 days"));
        }
        self.settings.set(&StoredSettings {
            company_name,
            cadence_days,
            updated_at: env::time_now(),
        })?;
        env::emit(Event::SettingsChanged, Audience::All)?;
        Ok(())
    }

    // ── categories ───────────────────────────────────────────────────────────

    fn check_category_fields(name: &str, emoji: &str, color: &str) -> app::Result<()> {
        check_len("category name", name, MAX_SHORT, true)?;
        check_len("emoji", emoji, 16, false)?;
        check_len("color", color, 32, false)
    }

    fn load_category(&self, id: &str) -> app::Result<Category> {
        self.categories
            .get(id)?
            .ok_or_else(|| not_found(format!("no such category: {id}")))
    }

    fn all_categories(&self) -> app::Result<Vec<Category>> {
        all_pages(|o| self.categories.find("byCreated", &[], o))
    }

    /// Team only; at most 50 live categories. Returns the new id. Emits
    /// `CategoryChanged`.
    pub fn create_category(
        &mut self,
        name: String,
        emoji: String,
        color: String,
    ) -> app::Result<String> {
        let _ = self.require_team()?;
        let name = name.trim().to_owned();
        Self::check_category_fields(&name, &emoji, &color)?;
        let live = self
            .all_categories()?
            .iter()
            .filter(|c| !c.archived)
            .count();
        if live >= MAX_CATEGORIES {
            return Err(invalid(format!("at most {MAX_CATEGORIES} categories")));
        }
        let now = env::time_now();
        let id = fresh_id();
        self.categories.insert(Category {
            id: id.clone(),
            name,
            emoji,
            color,
            created_at: now,
            edited_at: now,
            archived: false,
        })?;
        env::emit(Event::CategoryChanged { id: id.clone() }, Audience::All)?;
        Ok(id)
    }

    /// Team only; an archived category cannot be edited. Emits `CategoryChanged`.
    pub fn edit_category(
        &mut self,
        category_id: String,
        name: String,
        emoji: String,
        color: String,
    ) -> app::Result<()> {
        let _ = self.require_team()?;
        let name = name.trim().to_owned();
        Self::check_category_fields(&name, &emoji, &color)?;
        let c = self.load_category(&category_id)?;
        if c.archived {
            return Err(invalid("category is archived"));
        }
        let now = env::time_now();
        let _ = self.categories.update(category_id.as_str(), |c| {
            c.name = name;
            c.emoji = emoji;
            c.color = color;
            c.edited_at = now;
        })?;
        env::emit(Event::CategoryChanged { id: category_id }, Audience::All)?;
        Ok(())
    }

    /// Archive, never remove: updates filed under it keep their label. Team
    /// only. Emits `CategoryChanged`.
    pub fn archive_category(&mut self, category_id: String) -> app::Result<()> {
        let _ = self.require_team()?;
        let _ = self.load_category(&category_id)?;
        let now = env::time_now();
        let _ = self.categories.update(category_id.as_str(), |c| {
            c.archived = true;
            c.edited_at = now;
        })?;
        env::emit(Event::CategoryChanged { id: category_id }, Audience::All)?;
        Ok(())
    }

    /// Live categories, oldest first, with the caller's unread counts.
    #[app::view]
    pub fn list_categories(&self) -> app::Result<Vec<CategoryView>> {
        let me = account()?;
        let muted = self.muted_of(&me)?;
        let updates = self.live_updates()?;
        let mut cats: Vec<Category> = self
            .all_categories()?
            .into_iter()
            .filter(|c| !c.archived)
            .collect();
        cats.sort_by(|a, b| (a.created_at, &a.id).cmp(&(b.created_at, &b.id)));
        let mut out = Vec::with_capacity(cats.len());
        for c in cats {
            let mut count = 0u64;
            let mut unread = 0u64;
            for p in updates.iter().filter(|p| p.category_id == c.id) {
                count += 1;
                if !self.has_read(&p.id, &me)? {
                    unread += 1;
                }
            }
            out.push(CategoryView {
                muted: muted.contains(&c.id),
                update_count: count,
                unread_count: unread,
                id: c.id,
                name: c.name,
                emoji: c.emoji,
                color: c.color,
            });
        }
        Ok(out)
    }

    // ── posts ────────────────────────────────────────────────────────────────

    /// A live post by id: an update not deleted, or a question.
    fn load_post(&self, post_id: &str) -> app::Result<Post> {
        let key = post_id.to_owned();
        if let Some(post) = self.updates.get(&key)? {
            if post.deleted {
                return Err(not_found(format!("post is deleted: {post_id}")));
            }
            return Ok(post);
        }
        self.questions
            .get(&key)?
            .ok_or_else(|| not_found(format!("no such post: {post_id}")))
    }

    fn live_updates(&self) -> app::Result<Vec<Post>> {
        Ok(all_pages(|o| self.updates.page(o))?
            .into_iter()
            .map(|(_, p)| p)
            .filter(|p| !p.deleted)
            .collect())
    }

    fn live_posts(&self, kind: Option<&str>) -> app::Result<Vec<Post>> {
        let mut out = Vec::new();
        if kind.is_none_or(|k| k == KIND_UPDATE) {
            out.extend(self.live_updates()?);
        }
        if kind.is_none_or(|k| k == KIND_QUESTION) {
            out.extend(
                all_pages(|o| self.questions.page(o))?
                    .into_iter()
                    .map(|(_, p)| p),
            );
        }
        Ok(out)
    }

    fn validate_update(&self, input: &UpdateInput) -> app::Result<()> {
        check_len("title", &input.title, MAX_TITLE, true)?;
        check_len("summary", &input.summary, MAX_SUMMARY, false)?;
        if !input.category_id.is_empty() {
            let c = self.load_category(&input.category_id)?;
            if c.archived {
                return Err(invalid("that category is archived"));
            }
        }
        if input.sections.len() > MAX_SECTIONS {
            return Err(invalid(format!("at most {MAX_SECTIONS} sections")));
        }
        for s in &input.sections {
            check_len("section kind", &s.kind, MAX_SHORT, false)?;
            check_len("section title", &s.title, MAX_TITLE, false)?;
            check_len("section body", &s.body, MAX_BODY, false)?;
        }
        if input.metrics.len() > MAX_METRICS {
            return Err(invalid(format!("at most {MAX_METRICS} metrics")));
        }
        for m in &input.metrics {
            check_len("metric name", &m.name, MAX_SHORT, true)?;
            check_len("metric value", &m.value, MAX_SHORT, true)?;
            check_len("metric unit", &m.unit, 16, false)?;
        }
        if input.asks.len() > MAX_ASKS {
            return Err(invalid(format!("at most {MAX_ASKS} asks")));
        }
        for a in &input.asks {
            check_one_of("ask kind", &a.kind, ASK_KINDS)?;
            check_len("ask title", &a.title, MAX_TITLE, true)?;
            check_len("ask detail", &a.detail, MAX_SUMMARY, false)?;
        }
        Ok(())
    }

    /// Publish an update to this audience; returns its id. Team only. The
    /// author's own read is recorded. Emits `UpdatePublished`.
    pub fn publish_update(&mut self, input: UpdateInput) -> app::Result<String> {
        let me = self.require_team()?;
        self.validate_update(&input)?;
        let now = env::time_now();
        let id = fresh_id();
        let (title, summary, category_id, sections, metrics) = content_of(&input);
        let _ = self.updates.insert(
            &id,
            &Post {
                id: id.clone(),
                kind: KIND_UPDATE.to_owned(),
                author: me.clone(),
                title,
                summary,
                category_id,
                sections,
                metrics,
                edited_at: now,
                created_at: now,
                status: "published".to_owned(),
                status_at: now,
                deleted: false,
            },
        )?;
        self.sync_asks(&id, &input.asks, now)?;
        self.record_read(&id, &me, now)?;
        env::emit(Event::UpdatePublished { id: id.clone() }, Audience::All)?;
        Ok(id)
    }

    /// Replace an update's content. Any teammate may. Asks listed with an `id`
    /// are edited, without one are created, and this update's asks not listed
    /// are removed. Emits `PostEdited`.
    pub fn edit_update(&mut self, post_id: String, input: UpdateInput) -> app::Result<()> {
        let _ = self.require_team()?;
        self.validate_update(&input)?;
        let mut post = self.load_post(&post_id)?;
        if post.kind != KIND_UPDATE {
            return Err(invalid("not an update"));
        }
        let now = env::time_now();
        let (title, summary, category_id, sections, metrics) = content_of(&input);
        post.title = title;
        post.summary = summary;
        post.category_id = category_id;
        post.sections = sections;
        post.metrics = metrics;
        post.edited_at = now;
        let _ = self.updates.insert(&post_id, &post)?;
        self.sync_asks(&post_id, &input.asks, now)?;
        env::emit(Event::PostEdited { id: post_id }, Audience::All)?;
        Ok(())
    }

    fn sync_asks(&mut self, post_id: &str, asks: &[AskInput], now: u64) -> app::Result<()> {
        let existing = self.asks_of(post_id)?;
        let kept: Vec<&str> = asks.iter().filter_map(|a| a.id.as_deref()).collect();
        // Every listed id must be one of this update's asks, before any write.
        for id in &kept {
            if !existing.iter().any(|a| a.id == *id) {
                return Err(not_found(format!("no such ask on this update: {id}")));
            }
        }
        for gone in existing.iter().filter(|a| !kept.contains(&a.id.as_str())) {
            let _ = self.asks.update(gone.id.as_str(), |a| {
                a.deleted = true;
                a.edited_at = now;
            })?;
        }
        for input in asks {
            let title = input.title.trim().to_owned();
            match &input.id {
                Some(id) => {
                    let _ = self.asks.update(id.as_str(), |a| {
                        if a.kind != input.kind || a.title != title || a.detail != input.detail {
                            a.kind = input.kind.clone();
                            a.title = title;
                            a.detail = input.detail.clone();
                            a.edited_at = now;
                        }
                    })?;
                }
                None => self.asks.insert(Ask {
                    id: fresh_id(),
                    post_id: post_id.to_owned(),
                    kind: input.kind.clone(),
                    title,
                    detail: input.detail.clone(),
                    status: "open".to_owned(),
                    created_at: now,
                    edited_at: now,
                    status_at: now,
                    deleted: false,
                })?,
            }
        }
        Ok(())
    }

    /// Ask the team something; returns its id. Anyone in the audience may. The
    /// asker's own read is recorded. Emits `QuestionAsked`.
    pub fn ask_question(
        &mut self,
        title: String,
        body: String,
        category_id: Option<String>,
    ) -> app::Result<String> {
        let me = account()?;
        check_len("title", &title, MAX_TITLE, true)?;
        check_len("body", &body, MAX_BODY, false)?;
        let category_id = category_id.unwrap_or_default();
        if !category_id.is_empty() {
            let _ = self.load_category(&category_id)?;
        }
        let now = env::time_now();
        let id = fresh_id();
        self.touch_profile(&me)?;
        let sections = if body.trim().is_empty() {
            Vec::new()
        } else {
            vec![Section {
                kind: "text".to_owned(),
                title: String::new(),
                body,
            }]
        };
        let _ = self.questions.insert(
            &id,
            &Post {
                id: id.clone(),
                kind: KIND_QUESTION.to_owned(),
                author: me.clone(),
                title: title.trim().to_owned(),
                summary: String::new(),
                category_id,
                sections,
                metrics: Vec::new(),
                edited_at: now,
                created_at: now,
                status: "open".to_owned(),
                status_at: now,
                deleted: false,
            },
        )?;
        self.record_read(&id, &me, now)?;
        env::emit(Event::QuestionAsked { id: id.clone() }, Audience::All)?;
        Ok(id)
    }

    /// Mark a question `answered` (or `open` again). Team only. Emits
    /// `StatusChanged`.
    pub fn set_question_status(&mut self, post_id: String, status: String) -> app::Result<()> {
        let _ = self.require_team()?;
        check_one_of("status", &status, QUESTION_STATUSES)?;
        let mut post = self.load_post(&post_id)?;
        if post.kind != KIND_QUESTION {
            return Err(invalid("not a question"));
        }
        post.status = status;
        post.status_at = env::time_now();
        let _ = self.questions.insert(&post_id, &post)?;
        env::emit(Event::StatusChanged { post_id }, Audience::All)?;
        Ok(())
    }

    /// Delete a post. An update is tombstoned by any teammate; a question is
    /// removed by its author or by the team. Emits `PostDeleted`.
    pub fn delete_post(&mut self, post_id: String) -> app::Result<()> {
        let me = account()?;
        let mut post = self.load_post(&post_id)?;
        if post.kind == KIND_UPDATE {
            if !self.is_team(&me) {
                return Err(forbidden("you cannot delete this post"));
            }
            post.deleted = true;
            post.edited_at = env::time_now();
            let _ = self.updates.insert(&post_id, &post)?;
        } else {
            if post.author != me && !self.is_team(&me) {
                return Err(forbidden("you cannot delete this post"));
            }
            let _ = self.questions.remove(&post_id)?;
        }
        env::emit(Event::PostDeleted { id: post_id }, Audience::All)?;
        Ok(())
    }

    fn has_read(&self, post_id: &str, account: &str) -> app::Result<bool> {
        if account.is_empty() {
            return Ok(false);
        }
        Ok(self.reads.contains(&(post_id, account))?)
    }

    fn reactions_for(&self, post_id: &str, me: &str) -> app::Result<Vec<ReactionCount>> {
        let mut out = Vec::with_capacity(REACTIONS.len());
        for emoji in REACTIONS {
            out.push(ReactionCount {
                emoji: (*emoji).to_owned(),
                count: self.reactions.count("perEmoji", &[s(post_id), s(emoji)])?,
                mine: !me.is_empty() && self.reactions.contains(&(post_id, me, *emoji))?,
            });
        }
        Ok(out)
    }

    fn card_of(&self, post: &Post, me: &str) -> app::Result<PostCard> {
        let asks = self.asks_of(&post.id)?;
        let (author_name, _) = self.name_of(&post.author)?;
        Ok(PostCard {
            id: post.id.clone(),
            kind: post.kind.clone(),
            author_is_team: self.is_team(&post.author),
            author: post.author.clone(),
            author_name,
            title: post.title.clone(),
            summary: post.summary.clone(),
            category_id: post.category_id.clone(),
            status: post.status.clone(),
            created_at: post.created_at,
            edited_at: post.edited_at,
            comment_count: self.comments.count("perPost", &[s(&post.id)])?,
            ask_count: asks.len() as u64,
            open_ask_count: asks.iter().filter(|a| a.status == "open").count() as u64,
            metric_count: post.metrics.len() as u64,
            read_count: self.reads.count("perPost", &[s(&post.id)])?,
            read_by_me: self.has_read(&post.id, me)?,
            reactions: self.reactions_for(&post.id, me)?,
        })
    }

    /// An update's live asks, oldest first.
    fn asks_of(&self, post_id: &str) -> app::Result<Vec<Ask>> {
        Ok(all_pages(|o| self.asks.find("byPost", &[s(post_id)], o))?
            .into_iter()
            .filter(|a| !a.deleted)
            .collect())
    }

    fn offer_view(&self, o: &Offer) -> app::Result<OfferView> {
        let (name, firm) = self.name_of(&o.account)?;
        Ok(OfferView {
            ask_id: o.ask_id.clone(),
            account: o.account.clone(),
            name,
            firm,
            note: o.note.clone(),
            status: o.status.clone(),
            created_at: o.created_at,
            updated_at: o.updated_at,
        })
    }

    fn live_offers(&self, ask_id: &str) -> app::Result<Vec<Offer>> {
        let mut offers: Vec<Offer> = all_pages(|o| self.offers.find("byAsk", &[s(ask_id)], o))?
            .into_iter()
            .filter(|o| !o.withdrawn)
            .collect();
        offers.sort_by(|a, b| (a.created_at, &a.account).cmp(&(b.created_at, &b.account)));
        Ok(offers)
    }

    fn ask_view(&self, ask: &Ask, post_title: &str, me: &str, team: bool) -> app::Result<AskView> {
        let offers = self.live_offers(&ask.id)?;
        let my_offer = match offers.iter().find(|o| o.account == me) {
            Some(o) => Some(self.offer_view(o)?),
            None => None,
        };
        let mut all = Vec::new();
        if team {
            for o in &offers {
                all.push(self.offer_view(o)?);
            }
        }
        Ok(AskView {
            id: ask.id.clone(),
            post_id: ask.post_id.clone(),
            post_title: post_title.to_owned(),
            kind: ask.kind.clone(),
            title: ask.title.clone(),
            detail: ask.detail.clone(),
            status: ask.status.clone(),
            created_at: ask.created_at,
            offer_count: offers.len() as u64,
            offers: all,
            my_offer,
        })
    }

    /// One post with its sections, metrics and asks.
    #[app::view]
    pub fn get_post(&self, post_id: String) -> app::Result<PostView> {
        let me = account()?;
        let post = self.load_post(&post_id)?;
        let team = self.is_team(&me);
        let mut asks = Vec::new();
        for a in self.asks_of(&post_id)? {
            asks.push(self.ask_view(&a, &post.title, &me, team)?);
        }
        Ok(PostView {
            card: self.card_of(&post, &me)?,
            sections: post.sections.clone(),
            metrics: post.metrics.clone(),
            asks,
        })
    }

    /// One page of posts, newest first. `kind` is `"update"`, `"question"` or
    /// `null` for both; `categoryId` filters to one category; `limit` 0 means
    /// 20, at most 100. The cursor names the last post seen.
    #[app::view]
    pub fn list_posts(
        &self,
        kind: Option<String>,
        category_id: Option<String>,
        cursor: Option<String>,
        limit: u32,
    ) -> app::Result<PostPage> {
        let me = account()?;
        let limit = match limit as usize {
            0 => DEFAULT_PAGE,
            n if n > MAX_PAGE => MAX_PAGE,
            n => n,
        };
        let mut rows = self.live_posts(kind.as_deref())?;
        if let Some(cat) = category_id.as_deref().filter(|c| !c.is_empty()) {
            rows.retain(|p| p.category_id == cat);
        }
        rows.sort_by(|a, b| (b.created_at, &b.id).cmp(&(a.created_at, &a.id)));
        let start = match cursor {
            None => 0,
            Some(c) => rows.iter().position(|r| r.id == c).map_or(0, |i| i + 1),
        };
        let slice: Vec<&Post> = rows.iter().skip(start).take(limit).collect();
        let next_cursor = if start + slice.len() < rows.len() {
            slice.last().map(|p| p.id.clone())
        } else {
            None
        };
        let mut items = Vec::with_capacity(slice.len());
        for p in slice {
            items.push(self.card_of(p, &me)?);
        }
        Ok(PostPage { items, next_cursor })
    }

    /// The caller's own read receipt for a post.
    fn record_read(&mut self, post_id: &str, me: &str, now: u64) -> app::Result<()> {
        let updated = self.reads.update(&(post_id, me), |r| r.last_at = now)?;
        if !updated {
            self.reads.insert(Read {
                post_id: post_id.to_owned(),
                account: me.to_owned(),
                first_at: now,
                last_at: now,
            })?;
        }
        Ok(())
    }

    /// Record that the caller opened a post. Emits `Read`.
    pub fn mark_read(&mut self, post_id: String) -> app::Result<()> {
        let me = account()?;
        let _ = self.load_post(&post_id)?;
        self.touch_profile(&me)?;
        self.record_read(&post_id, &me, env::time_now())?;
        env::emit(Event::Read { post_id }, Audience::All)?;
        Ok(())
    }

    /// Turn one of the six emoji on or off on a post, for the caller. Emits
    /// `Reacted`.
    pub fn react(&mut self, post_id: String, emoji: String, on: bool) -> app::Result<()> {
        let me = account()?;
        check_one_of("reaction", &emoji, REACTIONS)?;
        let _ = self.load_post(&post_id)?;
        self.touch_profile(&me)?;
        if on {
            self.reactions.upsert(Reaction {
                post_id: post_id.clone(),
                account: me,
                emoji,
                updated_at: env::time_now(),
            })?;
        } else {
            let _ = self
                .reactions
                .remove(&(post_id.as_str(), me.as_str(), emoji.as_str()))?;
        }
        env::emit(Event::Reacted { post_id }, Audience::All)?;
        Ok(())
    }

    // ── comments ─────────────────────────────────────────────────────────────

    fn load_comment(&self, comment_id: &str) -> app::Result<Comment> {
        self.comments
            .get(comment_id)?
            .ok_or_else(|| not_found(format!("no such comment: {comment_id}")))
    }

    /// Reply on a post; returns the comment's id. Replying to a reply attaches
    /// to that reply's parent, so a thread is one level deep. Emits `Commented`.
    pub fn add_comment(
        &mut self,
        post_id: String,
        parent_id: Option<String>,
        body: String,
    ) -> app::Result<String> {
        let me = account()?;
        check_len("comment", &body, MAX_BODY, true)?;
        let _ = self.load_post(&post_id)?;
        let parent_id = match parent_id.filter(|p| !p.is_empty()) {
            None => String::new(),
            Some(p) => {
                let parent = self.load_comment(&p)?;
                if parent.post_id != post_id {
                    return Err(invalid("parent comment is on another post"));
                }
                if parent.parent_id.is_empty() {
                    parent.id
                } else {
                    parent.parent_id
                }
            }
        };
        let now = env::time_now();
        let id = fresh_id();
        self.touch_profile(&me)?;
        self.comments.insert(Comment {
            id: id.clone(),
            post_id: post_id.clone(),
            parent_id,
            author: me,
            body,
            created_at: now,
            edited_at: now,
        })?;
        env::emit(
            Event::Commented {
                post_id,
                id: id.clone(),
            },
            Audience::All,
        )?;
        Ok(id)
    }

    /// Only the author edits a comment. Emits `Commented`.
    pub fn edit_comment(&mut self, comment_id: String, body: String) -> app::Result<()> {
        let me = account()?;
        check_len("comment", &body, MAX_BODY, true)?;
        let c = self.load_comment(&comment_id)?;
        if c.author != me {
            return Err(forbidden("only the author can edit this comment"));
        }
        let now = env::time_now();
        let _ = self.comments.update(comment_id.as_str(), |c| {
            c.body = body;
            c.edited_at = now;
        })?;
        env::emit(
            Event::Commented {
                post_id: c.post_id,
                id: comment_id,
            },
            Audience::All,
        )?;
        Ok(())
    }

    /// The author may delete their comment; the team may remove any. Emits
    /// `Commented`.
    pub fn delete_comment(&mut self, comment_id: String) -> app::Result<()> {
        let me = account()?;
        let c = self.load_comment(&comment_id)?;
        if c.author != me && !self.is_team(&me) {
            return Err(forbidden("you cannot delete this comment"));
        }
        let _ = self.comments.remove(comment_id.as_str())?;
        env::emit(
            Event::Commented {
                post_id: c.post_id,
                id: comment_id,
            },
            Audience::All,
        )?;
        Ok(())
    }

    /// A post's whole thread, oldest first.
    #[app::view]
    pub fn list_comments(&self, post_id: String) -> app::Result<Vec<CommentView>> {
        let _ = account()?;
        let mut rows = all_pages(|o| self.comments.find("thread", &[s(&post_id)], o))?;
        rows.sort_by(|a, b| (a.created_at, &a.id).cmp(&(b.created_at, &b.id)));
        let mut out = Vec::with_capacity(rows.len());
        for c in rows {
            let (author_name, _) = self.name_of(&c.author)?;
            out.push(CommentView {
                author_is_team: self.is_team(&c.author),
                id: c.id,
                post_id: c.post_id,
                parent_id: c.parent_id,
                author: c.author,
                author_name,
                body: c.body,
                created_at: c.created_at,
                edited_at: c.edited_at,
            });
        }
        Ok(out)
    }

    // ── asks & offers ────────────────────────────────────────────────────────

    fn load_ask(&self, ask_id: &str) -> app::Result<Ask> {
        let a = self
            .asks
            .get(ask_id)?
            .ok_or_else(|| not_found(format!("no such ask: {ask_id}")))?;
        if a.deleted {
            return Err(not_found(format!("ask is deleted: {ask_id}")));
        }
        Ok(a)
    }

    /// Every ask across every live update, newest first. `status` filters to
    /// `"open"` or `"resolved"`.
    #[app::view]
    pub fn list_asks(&self, status: Option<String>) -> app::Result<Vec<AskView>> {
        let me = account()?;
        let team = self.is_team(&me);
        let mut asks: Vec<Ask> = all_pages(|o| self.asks.scan(o))?
            .into_iter()
            .filter(|a| !a.deleted && status.as_deref().is_none_or(|s| a.status == s))
            .collect();
        asks.sort_by(|a, b| (b.created_at, &b.id).cmp(&(a.created_at, &a.id)));
        let mut out = Vec::with_capacity(asks.len());
        for a in asks {
            // An ask on a deleted update is gone with it.
            let Ok(post) = self.load_post(&a.post_id) else {
                continue;
            };
            out.push(self.ask_view(&a, &post.title, &me, team)?);
        }
        Ok(out)
    }

    /// `open` or `resolved`. Team only. Emits `AskChanged`.
    pub fn set_ask_status(&mut self, ask_id: String, status: String) -> app::Result<()> {
        let _ = self.require_team()?;
        check_one_of("status", &status, ASK_STATUSES)?;
        let ask = self.load_ask(&ask_id)?;
        let now = env::time_now();
        let _ = self.asks.update(ask_id.as_str(), |a| {
            a.status = status;
            a.status_at = now;
        })?;
        env::emit(
            Event::AskChanged {
                post_id: ask.post_id,
                ask_id,
            },
            Audience::All,
        )?;
        Ok(())
    }

    /// "I can help." One click, optional note. Offering again edits the note
    /// (and takes back a withdrawal); one offer per account per ask. Only on an
    /// open ask. Emits `OfferChanged`.
    pub fn offer_help(&mut self, ask_id: String, note: String) -> app::Result<()> {
        let me = account()?;
        check_len("note", &note, MAX_SUMMARY, false)?;
        let ask = self.load_ask(&ask_id)?;
        if ask.status != "open" {
            return Err(invalid("this ask is resolved"));
        }
        self.touch_profile(&me)?;
        let now = env::time_now();
        let updated = self.offers.update(&(ask_id.as_str(), me.as_str()), |o| {
            o.note = note.clone();
            o.withdrawn = false;
            o.updated_at = now;
        })?;
        if !updated {
            self.offers.insert(Offer {
                ask_id: ask_id.clone(),
                account: me,
                note,
                withdrawn: false,
                status: "offered".to_owned(),
                status_at: now,
                created_at: now,
                updated_at: now,
            })?;
        }
        env::emit(
            Event::OfferChanged {
                post_id: ask.post_id,
                ask_id,
            },
            Audience::All,
        )?;
        Ok(())
    }

    /// Withdraw the caller's own offer. Emits `OfferChanged`.
    pub fn withdraw_offer(&mut self, ask_id: String) -> app::Result<()> {
        let me = account()?;
        let ask = self.load_ask(&ask_id)?;
        let now = env::time_now();
        let updated = self.offers.update(&(ask_id.as_str(), me.as_str()), |o| {
            o.withdrawn = true;
            o.updated_at = now;
        })?;
        if !updated {
            return Err(not_found("you have not offered to help with this"));
        }
        env::emit(
            Event::OfferChanged {
                post_id: ask.post_id,
                ask_id,
            },
            Audience::All,
        )?;
        Ok(())
    }

    /// Accept or decline someone's offer (`offered`, `accepted`, `declined`).
    /// Team only. Emits `OfferChanged`.
    pub fn set_offer_status(
        &mut self,
        ask_id: String,
        account: String,
        status: String,
    ) -> app::Result<()> {
        let _ = self.require_team()?;
        check_one_of("status", &status, OFFER_STATUSES)?;
        let ask = self.load_ask(&ask_id)?;
        let who = account.trim().to_owned();
        let now = env::time_now();
        let updated = self.offers.update(&(ask_id.as_str(), who.as_str()), |o| {
            o.status = status;
            o.status_at = now;
        })?;
        if !updated {
            return Err(not_found("no such offer"));
        }
        env::emit(
            Event::OfferChanged {
                post_id: ask.post_id,
                ask_id,
            },
            Audience::All,
        )?;
        Ok(())
    }

    /// Accepted offers since `since` (unix ms, a decimal string; `"0"` for all),
    /// oldest first: what the next update's "Thank you" section is written from.
    #[app::view]
    pub fn list_contributions(&self, since: u64) -> app::Result<Vec<ContributionView>> {
        let _ = account()?;
        let mut out = Vec::new();
        for o in all_pages(|o| self.offers.scan(o))? {
            if o.status != "accepted" || o.status_at < since || o.withdrawn {
                continue;
            }
            let Ok(ask) = self.load_ask(&o.ask_id) else {
                continue;
            };
            let (name, firm) = self.name_of(&o.account)?;
            out.push(ContributionView {
                ask_id: o.ask_id,
                ask_title: ask.title,
                ask_kind: ask.kind,
                account: o.account,
                name,
                firm,
                note: o.note,
                accepted_at: o.status_at,
            });
        }
        out.sort_by(|a, b| (a.accepted_at, &a.account).cmp(&(b.accepted_at, &b.account)));
        Ok(out)
    }

    // ── insight ──────────────────────────────────────────────────────────────

    /// Every KPI ever reported, one series per metric name (case-insensitive),
    /// oldest point first.
    #[app::view]
    pub fn list_metrics(&self) -> app::Result<Vec<MetricSeries>> {
        let _ = account()?;
        let mut updates = self.live_updates()?;
        updates.sort_by(|a, b| (a.created_at, &a.id).cmp(&(b.created_at, &b.id)));
        let mut series: Vec<MetricSeries> = Vec::new();
        for p in &updates {
            for m in &p.metrics {
                let key = m.name.to_lowercase();
                let point = MetricPoint {
                    post_id: p.id.clone(),
                    post_title: p.title.clone(),
                    at: p.created_at,
                    value: m.value.clone(),
                };
                match series.iter_mut().find(|s| s.name.to_lowercase() == key) {
                    Some(s) => {
                        // The latest spelling and unit win the label.
                        s.name = m.name.clone();
                        if !m.unit.is_empty() {
                            s.unit = m.unit.clone();
                        }
                        s.points.push(point);
                    }
                    None => series.push(MetricSeries {
                        name: m.name.clone(),
                        unit: m.unit.clone(),
                        points: vec![point],
                    }),
                }
            }
        }
        Ok(series)
    }

    /// The home screen in one call.
    #[app::view]
    pub fn get_overview(&self) -> app::Result<Overview> {
        let me = account()?;
        let settings = self.settings_or_default()?;
        let muted = self.muted_of(&me)?;
        let updates = self.live_updates()?;
        let last_update_at = updates.iter().map(|p| p.created_at).max().unwrap_or(0);
        let next_due_at = if settings.cadence_days == 0 || last_update_at == 0 {
            0
        } else {
            last_update_at + u64::from(settings.cadence_days) * 86_400_000
        };
        let mut unread_updates = 0u64;
        for p in &updates {
            if !muted.contains(&p.category_id) && !self.has_read(&p.id, &me)? {
                unread_updates += 1;
            }
        }
        let open_questions = all_pages(|o| self.questions.page(o))?
            .iter()
            .filter(|(_, q)| q.status == "open")
            .count() as u64;
        let live_post_ids: BTreeSet<&str> = updates.iter().map(|p| p.id.as_str()).collect();
        let open_asks = all_pages(|o| self.asks.scan(o))?
            .iter()
            .filter(|a| {
                !a.deleted && a.status == "open" && live_post_ids.contains(a.post_id.as_str())
            })
            .count() as u64;
        Ok(Overview {
            company_name: settings.company_name,
            cadence_days: settings.cadence_days,
            last_update_at,
            next_due_at,
            updates_total: updates.len() as u64,
            unread_updates,
            open_asks,
            open_questions,
            people: all_pages(|o| self.profiles.scan(o))?.len() as u64,
            is_team: self.is_team(&me),
        })
    }

    /// Who read what: the team's follow-up list, newest update first. Team only.
    #[app::view]
    pub fn get_engagement(&self) -> app::Result<Vec<EngagementRow>> {
        let _ = self.require_team()?;
        let mut updates = self.live_updates()?;
        updates.sort_by(|a, b| (b.created_at, &b.id).cmp(&(a.created_at, &a.id)));
        let readers_pool: Vec<Profile> = all_pages(|o| self.profiles.scan(o))?
            .into_iter()
            .filter(|p| !self.is_team(&p.account))
            .collect();
        let names: BTreeMap<&str, (&str, &str)> = readers_pool
            .iter()
            .map(|p| (p.account.as_str(), (p.name.as_str(), p.firm.as_str())))
            .collect();

        let mut out = Vec::with_capacity(updates.len());
        for p in updates {
            let mut readers = Vec::new();
            for r in all_pages(|o| self.reads.find("byPost", &[s(&p.id)], o))? {
                if self.is_team(&r.account) {
                    continue;
                }
                let (name, firm) = match names.get(r.account.as_str()) {
                    Some((n, f)) => ((*n).to_owned(), (*f).to_owned()),
                    None => self.name_of(&r.account)?,
                };
                readers.push(ReaderView {
                    account: r.account,
                    name,
                    firm,
                    first_at: r.first_at,
                });
            }
            readers.sort_by(|a, b| (a.first_at, &a.account).cmp(&(b.first_at, &b.account)));
            let not_read: Vec<ReaderView> = readers_pool
                .iter()
                .filter(|pr| !readers.iter().any(|r| r.account == pr.account))
                .map(|pr| ReaderView {
                    account: pr.account.clone(),
                    name: pr.name.clone(),
                    firm: pr.firm.clone(),
                    first_at: 0,
                })
                .collect();
            let card = self.card_of(&p, "")?;
            let mut offers = 0u64;
            for a in self.asks_of(&p.id)? {
                offers += self.live_offers(&a.id)?.len() as u64;
            }
            out.push(EngagementRow {
                post_id: p.id.clone(),
                title: p.title.clone(),
                category_id: p.category_id.clone(),
                published_at: p.created_at,
                readers,
                not_read,
                reactions: card.reactions.iter().map(|r| r.count).sum(),
                comments: card.comment_count,
                offers,
            });
        }
        Ok(out)
    }

    // ── drafts (the caller's own) ────────────────────────────────────────────

    /// Save a draft for the caller only; returns its id (a new one when
    /// `draftId` is `null` or empty). Nobody else can list or read it.
    pub fn save_draft(
        &mut self,
        draft_id: Option<String>,
        title: String,
        payload: String,
    ) -> app::Result<String> {
        let me = account()?;
        check_len("draft title", &title, MAX_TITLE, false)?;
        check_len("draft", &payload, MAX_DRAFT, false)?;
        let id = draft_id.filter(|d| !d.is_empty()).unwrap_or_else(fresh_id);
        let _ = self.drafts.insert(
            &(me, id.clone()),
            &Draft {
                id: id.clone(),
                title,
                payload,
                updated_at: env::time_now(),
            },
        )?;
        Ok(id)
    }

    /// The caller's drafts, most recently touched first.
    #[app::view]
    pub fn list_drafts(&self) -> app::Result<Vec<DraftView>> {
        let me = account()?;
        let mut out: Vec<DraftView> = all_pages(|o| self.drafts.prefix(&[s(&me)], o))?
            .into_iter()
            .map(|(_, d)| DraftView {
                id: d.id,
                title: d.title,
                payload: d.payload,
                updated_at: d.updated_at,
            })
            .collect();
        out.sort_by(|a, b| (b.updated_at, &b.id).cmp(&(a.updated_at, &a.id)));
        Ok(out)
    }

    /// Delete one of the caller's drafts (nothing happens for an unknown id).
    pub fn delete_draft(&mut self, draft_id: String) -> app::Result<()> {
        let me = account()?;
        let _ = self.drafts.remove(&(me, draft_id))?;
        Ok(())
    }
}

/// A typed failure: `422 APP_ERROR` with `{ code, fields: { message } }`. The
/// messages are v1's.
#[app::error]
pub enum Error {
    /// No such post, category, ask, comment, offer or draft.
    NotFound { message: String },
    /// An argument broke a rule (empty, too long, not one of the allowed values,
    /// an archived category, a resolved ask…).
    Invalid { message: String },
    /// The caller may not do this (not the team, not an admin, not the author).
    Forbidden { message: String },
}

/// A change to the audience, emitted to everyone the instance reaches after the
/// write that caused it. v1's events, with camelCase field names. They carry
/// ids only, so a guest who hears one learns nothing a read would not show.
#[app::event]
pub enum Event {
    SettingsChanged,
    TeamChanged { account: String },
    ProfileSet { account: String },
    CategoryChanged { id: String },
    UpdatePublished { id: String },
    PostEdited { id: String },
    PostDeleted { id: String },
    QuestionAsked { id: String },
    StatusChanged { post_id: String },
    AskChanged { post_id: String, ask_id: String },
    OfferChanged { post_id: String, ask_id: String },
    Commented { post_id: String, id: String },
    Reacted { post_id: String },
    Read { post_id: String },
}
