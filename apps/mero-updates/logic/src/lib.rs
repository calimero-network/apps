//! Mero Updates — investor updates and investor relations, peer to peer.
//!
//! The shape of Visible / Cabal / Paperstreet, rebuilt on a context instead of
//! a SaaS database. One context is one AUDIENCE (e.g. "All investors",
//! "Board"): the company's team publishes updates into it, and every member of
//! it — investors, advisors — reads, reacts, comments, answers asks and asks
//! questions back. The audience is the membership; there is no send list that
//! could leak, because there is nothing to send — the update is already on the
//! reader's own node.
//!
//! ── The model ────────────────────────────────────────────────────────────────
//!
//! * **Team vs readers.** The context creator is the first admin. Admins grant
//!   the `team` role (co-founders, finance lead). Team members publish updates,
//!   manage categories, triage asks and see engagement. Everyone else is a
//!   reader. The role registry is an `AccessControl`, so a grant from a
//!   non-admin is rejected AT MERGE, not only by the API guard.
//! * **Posts** are either an `update` (team only: sections, KPIs, asks) or a
//!   `question` (anyone: investor-initiated, which is what makes this two-way
//!   rather than a newsletter). Both carry comments and reactions.
//! * **Categories** are the team's own taxonomy ("Monthly", "Fundraising",
//!   "Product"…). Readers can mute the ones they do not care about.
//! * **Asks** are structured requests inside an update (intro, hire, customer,
//!   advice, fundraising). A reader answers one with an **offer** of help in one
//!   click; the team accepts it, and accepted offers become **contributions**
//!   the next update can thank.
//! * **Reads** are recorded per account, which is the peer-to-peer version of
//!   open tracking — and, unlike a tracking pixel, one a reader can see being
//!   recorded.
//! * **Drafts** live in `#[app::private]` storage: node-local, never
//!   replicated. An unpublished update cannot leak to investors because it never
//!   leaves the author's node.
//!
//! ⚠️ What "team only" means for WRITES. The role REGISTRY is merge-verified
//! (a forged grant does not converge). The checks on publishing, triage and
//! moderation are the contract's own guards, and they run on the WRITER'S node
//! against that node's copy of the registry — so a demotion binds only once it
//! has replicated to the demoted member's node (logic/workflows/e2e.yml waits
//! for exactly that, after a run showed a publish slipping through without
//! it). Gating the post maps themselves at merge (a writer set rotated with the
//! team) is the next step, and is listed in the app README.
//!
//! ⚠️ Everything outside drafts replicates to every member of the context.
//! "Team only" views (offer lists, engagement) are a presentation filter, not
//! confidentiality: a reader's node holds the same rows. A truly confidential
//! audience is a separate context with its own membership — which is why the
//! frontend models audiences as separate contexts.

use std::str::FromStr;

use calimero_sdk::abi::AbiType;
use calimero_sdk::borsh::{self, BorshDeserialize, BorshSerialize};
use calimero_sdk::serde::{Deserialize, Serialize};
use calimero_sdk::types::Error as AppError;
use calimero_sdk::{app, env, AccountId};
use calimero_storage::collections::crdt_meta::MergeError;
use calimero_storage::collections::{AccessControl, Mergeable, UnorderedMap};

// ── Limits ───────────────────────────────────────────────────────────────────
//
// Every field replicates to every member, so an unbounded field is an
// unbounded broadcast.

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

/// The role an admin grants to co-authors. Admins are implicitly team.
const ROLE_TEAM: &str = "team";

pub const KIND_UPDATE: &str = "update";
pub const KIND_QUESTION: &str = "question";

/// A fixed palette rather than free text: one tap to react, and a reaction row
/// that cannot be used to smuggle arbitrary strings into every reader's view.
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

/// Wall-clock MILLISECONDS.
///
/// `env::time_now()` is nanoseconds, and a nanosecond timestamp (~1.8e18) is
/// past 2^53: JSON-decoded in the browser it silently loses its low digits, so
/// two different timestamps can compare equal in the UI. Milliseconds fit a JS
/// number exactly and are what `Date` takes. Merges never depend on sub-ms
/// order — `lww` breaks every tie by content.
fn now_ms() -> u64 {
    env::time_now() / 1_000_000
}

/// Whole-record last-writer-wins over a TOTAL order.
///
/// `at` alone is not total: two devices writing in the same millisecond would
/// each keep their own value under "take other on greater", and the replicas
/// would never agree again. The borsh bytes break the tie identically on every
/// node.
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

/// One block of an update: "Highlights", "Lowlights", "Product", "Thanks"…
#[derive(
    AbiType, Debug, Clone, PartialEq, BorshSerialize, BorshDeserialize, Serialize, Deserialize,
)]
#[borsh(crate = "calimero_sdk::borsh")]
#[serde(crate = "calimero_sdk::serde")]
pub struct Section {
    /// A template hint ("highlights", "lowlights", "product", "team", "text"…).
    /// Free text so templates can evolve without a contract release.
    pub kind: String,
    pub title: String,
    pub body: String,
}

/// One KPI as reported in one update.
///
/// `value` is a STRING on purpose: founders write "$1.2M", "38%", "12.5k", and
/// the number they meant is the frontend's to parse. The contract keeps what
/// was reported, exactly as reported.
#[derive(
    AbiType, Debug, Clone, PartialEq, BorshSerialize, BorshDeserialize, Serialize, Deserialize,
)]
#[borsh(crate = "calimero_sdk::borsh")]
#[serde(crate = "calimero_sdk::serde")]
pub struct Metric {
    pub name: String,
    pub value: String,
    pub unit: String,
}

/// An update or a question.
///
/// Three independent merge axes: CONTENT (the author's edits, by `edited_at`),
/// STATUS (the team's triage of a question, by `status_at`) and the tombstone
/// (OR). Folding status into content would let an author's typo fix silently
/// undo "answered", or the reverse.
#[app::mergeable(id = "mero_updates::Post")]
#[derive(AbiType, Debug, Clone, BorshSerialize, BorshDeserialize, Serialize, Deserialize)]
#[borsh(crate = "calimero_sdk::borsh")]
#[serde(crate = "calimero_sdk::serde")]
pub struct Post {
    pub id: String,
    pub kind: String,
    pub author: String,
    pub content: PostContent,
    pub edited_at: u64,
    pub created_at: u64,
    pub status: String,
    pub status_at: u64,
    pub deleted: bool,
}

#[derive(
    AbiType, Debug, Clone, PartialEq, BorshSerialize, BorshDeserialize, Serialize, Deserialize,
)]
#[borsh(crate = "calimero_sdk::borsh")]
#[serde(crate = "calimero_sdk::serde")]
pub struct PostContent {
    pub title: String,
    pub summary: String,
    pub category_id: String,
    pub sections: Vec<Section>,
    pub metrics: Vec<Metric>,
}

impl Mergeable for Post {
    fn merge(&mut self, other: &Self) -> std::result::Result<(), MergeError> {
        let deleted = self.deleted || other.deleted;
        lww(
            &mut self.content,
            self.edited_at,
            &other.content,
            other.edited_at,
        );
        self.edited_at = self.edited_at.max(other.edited_at);
        lww(
            &mut self.status,
            self.status_at,
            &other.status,
            other.status_at,
        );
        self.status_at = self.status_at.max(other.status_at);
        self.deleted = deleted;
        Ok(())
    }
}

/// A structured request inside an update. Same three axes as `Post`.
#[app::mergeable(id = "mero_updates::Ask")]
#[derive(AbiType, Debug, Clone, BorshSerialize, BorshDeserialize, Serialize, Deserialize)]
#[borsh(crate = "calimero_sdk::borsh")]
#[serde(crate = "calimero_sdk::serde")]
pub struct Ask {
    pub id: String,
    pub post_id: String,
    pub content: AskContent,
    pub edited_at: u64,
    pub created_at: u64,
    pub status: String,
    pub status_at: u64,
    pub deleted: bool,
}

#[derive(
    AbiType, Debug, Clone, PartialEq, BorshSerialize, BorshDeserialize, Serialize, Deserialize,
)]
#[borsh(crate = "calimero_sdk::borsh")]
#[serde(crate = "calimero_sdk::serde")]
pub struct AskContent {
    pub kind: String,
    pub title: String,
    pub detail: String,
}

impl Mergeable for Ask {
    fn merge(&mut self, other: &Self) -> std::result::Result<(), MergeError> {
        let deleted = self.deleted || other.deleted;
        lww(
            &mut self.content,
            self.edited_at,
            &other.content,
            other.edited_at,
        );
        self.edited_at = self.edited_at.max(other.edited_at);
        lww(
            &mut self.status,
            self.status_at,
            &other.status,
            other.status_at,
        );
        self.status_at = self.status_at.max(other.status_at);
        self.deleted = deleted;
        Ok(())
    }
}

/// One reader's offer to help with one ask. Keyed `"<ask_id>|<account>"`.
///
/// Two writers, two axes: the HELPER owns `note`/`withdrawn` (by `updated_at`),
/// the TEAM owns `status` (by `status_at`). Accepting an offer must not be
/// undone by the helper fixing a typo in their note, and vice versa.
#[app::mergeable(id = "mero_updates::Offer")]
#[derive(AbiType, Debug, Clone, BorshSerialize, BorshDeserialize, Serialize, Deserialize)]
#[borsh(crate = "calimero_sdk::borsh")]
#[serde(crate = "calimero_sdk::serde")]
pub struct Offer {
    pub ask_id: String,
    pub account: String,
    pub helper: OfferByHelper,
    pub updated_at: u64,
    pub created_at: u64,
    pub status: String,
    pub status_at: u64,
}

#[derive(
    AbiType, Debug, Clone, PartialEq, BorshSerialize, BorshDeserialize, Serialize, Deserialize,
)]
#[borsh(crate = "calimero_sdk::borsh")]
#[serde(crate = "calimero_sdk::serde")]
pub struct OfferByHelper {
    pub note: String,
    pub withdrawn: bool,
}

impl Mergeable for Offer {
    fn merge(&mut self, other: &Self) -> std::result::Result<(), MergeError> {
        lww(
            &mut self.helper,
            self.updated_at,
            &other.helper,
            other.updated_at,
        );
        self.updated_at = self.updated_at.max(other.updated_at);
        lww(
            &mut self.status,
            self.status_at,
            &other.status,
            other.status_at,
        );
        self.status_at = self.status_at.max(other.status_at);
        self.created_at = self.created_at.min(other.created_at);
        Ok(())
    }
}

/// A reply on a post. One level of nesting via `parent_id` ("" for top level).
#[app::mergeable(id = "mero_updates::Comment")]
#[derive(AbiType, Debug, Clone, BorshSerialize, BorshDeserialize, Serialize, Deserialize)]
#[borsh(crate = "calimero_sdk::borsh")]
#[serde(crate = "calimero_sdk::serde")]
pub struct Comment {
    pub id: String,
    pub post_id: String,
    pub parent_id: String,
    pub author: String,
    pub body: String,
    pub created_at: u64,
    pub edited_at: u64,
    pub deleted: bool,
}

impl Mergeable for Comment {
    fn merge(&mut self, other: &Self) -> std::result::Result<(), MergeError> {
        let deleted = self.deleted || other.deleted;
        let mut body = self.body.clone();
        lww(&mut body, self.edited_at, &other.body, other.edited_at);
        self.body = body;
        self.edited_at = self.edited_at.max(other.edited_at);
        self.deleted = deleted;
        Ok(())
    }
}

/// One account's one emoji on one post. Keyed `"<post_id>|<account>|<emoji>"`,
/// so reacting twice cannot count twice and a second device is the same person.
#[app::mergeable(id = "mero_updates::Reaction")]
#[derive(AbiType, Debug, Clone, BorshSerialize, BorshDeserialize, Serialize, Deserialize)]
#[borsh(crate = "calimero_sdk::borsh")]
#[serde(crate = "calimero_sdk::serde")]
pub struct Reaction {
    pub post_id: String,
    pub account: String,
    pub emoji: String,
    pub on: bool,
    pub updated_at: u64,
}

impl Mergeable for Reaction {
    fn merge(&mut self, other: &Self) -> std::result::Result<(), MergeError> {
        let (mine, theirs) = (self.on, other.on);
        let mut on = mine;
        lww(&mut on, self.updated_at, &theirs, other.updated_at);
        self.on = on;
        self.updated_at = self.updated_at.max(other.updated_at);
        Ok(())
    }
}

/// A read receipt. Keyed `"<post_id>|<account>"`. Both ends are monotone
/// (first read = min, latest = max), so this merges without any clock
/// tie-break at all.
#[app::mergeable(id = "mero_updates::Read")]
#[derive(AbiType, Debug, Clone, BorshSerialize, BorshDeserialize, Serialize, Deserialize)]
#[borsh(crate = "calimero_sdk::borsh")]
#[serde(crate = "calimero_sdk::serde")]
pub struct Read {
    pub post_id: String,
    pub account: String,
    pub first_at: u64,
    pub last_at: u64,
}

impl Mergeable for Read {
    fn merge(&mut self, other: &Self) -> std::result::Result<(), MergeError> {
        self.first_at = self.first_at.min(other.first_at);
        self.last_at = self.last_at.max(other.last_at);
        Ok(())
    }
}

/// Who a member says they are. A claim, not an identity: the account id is
/// the only thing that authorises anything.
#[app::mergeable(id = "mero_updates::Profile")]
#[derive(AbiType, Debug, Clone, BorshSerialize, BorshDeserialize, Serialize, Deserialize)]
#[borsh(crate = "calimero_sdk::borsh")]
#[serde(crate = "calimero_sdk::serde")]
pub struct Profile {
    pub account: String,
    pub name: String,
    /// Fund, firm or company — "Seed Capital", "Angel".
    pub firm: String,
    /// Which categories this reader has muted.
    pub muted: Vec<String>,
    pub joined_at: u64,
    pub updated_at: u64,
}

impl Mergeable for Profile {
    fn merge(&mut self, other: &Self) -> std::result::Result<(), MergeError> {
        let joined = self.joined_at.min(other.joined_at);
        let at = self.updated_at;
        lww(self, at, other, other.updated_at);
        self.joined_at = joined;
        Ok(())
    }
}

#[app::mergeable(id = "mero_updates::Category")]
#[derive(AbiType, Debug, Clone, BorshSerialize, BorshDeserialize, Serialize, Deserialize)]
#[borsh(crate = "calimero_sdk::borsh")]
#[serde(crate = "calimero_sdk::serde")]
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

impl Mergeable for Category {
    fn merge(&mut self, other: &Self) -> std::result::Result<(), MergeError> {
        let archived = self.archived || other.archived;
        let created = self.created_at.min(other.created_at);
        let at = self.edited_at;
        lww(self, at, other, other.edited_at);
        self.archived = archived;
        self.created_at = created;
        Ok(())
    }
}

/// Audience-wide settings, stored under the single key `"main"`.
#[app::mergeable(id = "mero_updates::Settings")]
#[derive(AbiType, Debug, Clone, BorshSerialize, BorshDeserialize, Serialize, Deserialize)]
#[borsh(crate = "calimero_sdk::borsh")]
#[serde(crate = "calimero_sdk::serde")]
pub struct Settings {
    pub company_name: String,
    /// How often the team means to write, in days. 0 = no cadence. Drives the
    /// "next update due" nudge — Visible's recurring-update reminder, without a
    /// server to send it.
    pub cadence_days: u32,
    pub updated_at: u64,
}

impl Mergeable for Settings {
    fn merge(&mut self, other: &Self) -> std::result::Result<(), MergeError> {
        let at = self.updated_at;
        lww(self, at, other, other.updated_at);
        Ok(())
    }
}

/// A saved, unpublished update. Node-local — see `Drafts`.
#[derive(Debug, Clone, BorshSerialize, BorshDeserialize)]
#[borsh(crate = "calimero_sdk::borsh")]
pub struct Draft {
    pub id: String,
    pub title: String,
    /// The composer's own JSON. Opaque here: the contract never publishes a
    /// draft, the frontend reads it back and calls `publish_update`.
    pub payload: String,
    pub updated_at: u64,
}

/// Node-local drafts. NEVER replicated — an unpublished update does not exist
/// anywhere but the author's node, so it cannot reach an investor early.
#[derive(BorshSerialize, BorshDeserialize, Debug)]
#[borsh(crate = "calimero_sdk::borsh")]
#[app::private]
pub struct Drafts {
    drafts: UnorderedMap<String, Draft>,
}

impl Default for Drafts {
    fn default() -> Self {
        Self {
            drafts: UnorderedMap::new(),
        }
    }
}

// ── Inputs ───────────────────────────────────────────────────────────────────

#[derive(AbiType, Debug, Clone, Serialize, Deserialize)]
#[serde(crate = "calimero_sdk::serde")]
pub struct AskInput {
    /// Set to edit an existing ask of this update; `None` creates one.
    pub id: Option<String>,
    pub kind: String,
    pub title: String,
    pub detail: String,
}

#[derive(AbiType, Debug, Clone, Serialize, Deserialize)]
#[serde(crate = "calimero_sdk::serde")]
pub struct UpdateInput {
    pub title: String,
    pub summary: String,
    pub category_id: String,
    pub sections: Vec<Section>,
    pub metrics: Vec<Metric>,
    pub asks: Vec<AskInput>,
}

// ── Views ────────────────────────────────────────────────────────────────────

#[derive(AbiType, Debug, Clone, Serialize, Deserialize)]
#[serde(crate = "calimero_sdk::serde")]
pub struct MeView {
    pub account: String,
    pub name: String,
    pub firm: String,
    pub is_admin: bool,
    pub is_team: bool,
    pub muted: Vec<String>,
}

#[derive(AbiType, Debug, Clone, Serialize, Deserialize)]
#[serde(crate = "calimero_sdk::serde")]
pub struct PersonView {
    pub account: String,
    pub name: String,
    pub firm: String,
    pub is_admin: bool,
    pub is_team: bool,
    pub joined_at: u64,
    /// Updates this person has opened, out of `updates_total`.
    pub updates_read: u64,
    pub updates_total: u64,
    pub last_read_at: u64,
    pub comments: u64,
    pub offers: u64,
    pub accepted_offers: u64,
}

#[derive(AbiType, Debug, Clone, Serialize, Deserialize)]
#[serde(crate = "calimero_sdk::serde")]
pub struct CategoryView {
    pub id: String,
    pub name: String,
    pub emoji: String,
    pub color: String,
    pub update_count: u64,
    pub unread_count: u64,
    pub muted: bool,
}

#[derive(AbiType, Debug, Clone, Serialize, Deserialize)]
#[serde(crate = "calimero_sdk::serde")]
pub struct ReactionCount {
    pub emoji: String,
    pub count: u64,
    pub mine: bool,
}

#[derive(AbiType, Debug, Clone, Serialize, Deserialize)]
#[serde(crate = "calimero_sdk::serde")]
pub struct OfferView {
    pub ask_id: String,
    pub account: String,
    pub name: String,
    pub firm: String,
    pub note: String,
    pub status: String,
    pub created_at: u64,
    pub updated_at: u64,
}

#[derive(AbiType, Debug, Clone, Serialize, Deserialize)]
#[serde(crate = "calimero_sdk::serde")]
pub struct AskView {
    pub id: String,
    pub post_id: String,
    pub post_title: String,
    pub kind: String,
    pub title: String,
    pub detail: String,
    pub status: String,
    pub created_at: u64,
    pub offer_count: u64,
    /// Every offer — for the TEAM only; empty for readers. A presentation
    /// filter, not confidentiality (see the module docs).
    pub offers: Vec<OfferView>,
    /// The caller's own offer, if any.
    pub my_offer: Option<OfferView>,
}

#[derive(AbiType, Debug, Clone, Serialize, Deserialize)]
#[serde(crate = "calimero_sdk::serde")]
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
    pub created_at: u64,
    pub edited_at: u64,
    pub comment_count: u64,
    pub ask_count: u64,
    pub open_ask_count: u64,
    pub metric_count: u64,
    pub read_count: u64,
    pub read_by_me: bool,
    pub reactions: Vec<ReactionCount>,
}

#[derive(AbiType, Debug, Clone, Serialize, Deserialize)]
#[serde(crate = "calimero_sdk::serde")]
pub struct PostView {
    pub card: PostCard,
    pub sections: Vec<Section>,
    pub metrics: Vec<Metric>,
    pub asks: Vec<AskView>,
}

#[derive(AbiType, Debug, Clone, Serialize, Deserialize)]
#[serde(crate = "calimero_sdk::serde")]
pub struct PostPage {
    pub items: Vec<PostCard>,
    pub next_cursor: Option<String>,
}

#[derive(AbiType, Debug, Clone, Serialize, Deserialize)]
#[serde(crate = "calimero_sdk::serde")]
pub struct CommentView {
    pub id: String,
    pub post_id: String,
    pub parent_id: String,
    pub author: String,
    pub author_name: String,
    pub author_is_team: bool,
    pub body: String,
    pub created_at: u64,
    pub edited_at: u64,
}

#[derive(AbiType, Debug, Clone, Serialize, Deserialize)]
#[serde(crate = "calimero_sdk::serde")]
pub struct MetricPoint {
    pub post_id: String,
    pub post_title: String,
    pub at: u64,
    pub value: String,
}

#[derive(AbiType, Debug, Clone, Serialize, Deserialize)]
#[serde(crate = "calimero_sdk::serde")]
pub struct MetricSeries {
    pub name: String,
    pub unit: String,
    /// Oldest first, one point per update that reported this metric.
    pub points: Vec<MetricPoint>,
}

#[derive(AbiType, Debug, Clone, Serialize, Deserialize)]
#[serde(crate = "calimero_sdk::serde")]
pub struct ContributionView {
    pub ask_id: String,
    pub ask_title: String,
    pub ask_kind: String,
    pub account: String,
    pub name: String,
    pub firm: String,
    pub note: String,
    pub accepted_at: u64,
}

#[derive(AbiType, Debug, Clone, Serialize, Deserialize)]
#[serde(crate = "calimero_sdk::serde")]
pub struct Overview {
    pub company_name: String,
    pub cadence_days: u32,
    /// When the latest update went out, 0 if none has.
    pub last_update_at: u64,
    /// `last_update_at + cadence`, 0 when there is no cadence or no update yet.
    pub next_due_at: u64,
    pub updates_total: u64,
    /// Unread updates in categories the caller has NOT muted.
    pub unread_updates: u64,
    pub open_asks: u64,
    pub open_questions: u64,
    pub people: u64,
    pub is_team: bool,
}

#[derive(AbiType, Debug, Clone, Serialize, Deserialize)]
#[serde(crate = "calimero_sdk::serde")]
pub struct ReaderView {
    pub account: String,
    pub name: String,
    pub firm: String,
    pub first_at: u64,
}

#[derive(AbiType, Debug, Clone, Serialize, Deserialize)]
#[serde(crate = "calimero_sdk::serde")]
pub struct EngagementRow {
    pub post_id: String,
    pub title: String,
    pub category_id: String,
    pub published_at: u64,
    pub readers: Vec<ReaderView>,
    /// Non-team members with a profile who have not opened it: the follow-up
    /// list.
    pub not_read: Vec<ReaderView>,
    pub reactions: u64,
    pub comments: u64,
    pub offers: u64,
}

#[derive(AbiType, Debug, Clone, Serialize, Deserialize)]
#[serde(crate = "calimero_sdk::serde")]
pub struct DraftView {
    pub id: String,
    pub title: String,
    pub payload: String,
    pub updated_at: u64,
}

// ── State ────────────────────────────────────────────────────────────────────

#[app::state(emits = for<'a> Event<'a>)]
pub struct MeroUpdates {
    /// Admin tier = the signed writer set; `team` grants are verified at merge.
    roles: AccessControl,
    settings: UnorderedMap<String, Settings>,
    categories: UnorderedMap<String, Category>,
    /// Flat maps keyed by id, carrying their parent's id — never a nested
    /// collection per parent, which would need deterministic re-keying to
    /// converge when two nodes create it independently.
    posts: UnorderedMap<String, Post>,
    asks: UnorderedMap<String, Ask>,
    offers: UnorderedMap<String, Offer>,
    comments: UnorderedMap<String, Comment>,
    reactions: UnorderedMap<String, Reaction>,
    reads: UnorderedMap<String, Read>,
    profiles: UnorderedMap<String, Profile>,
}

#[app::event]
pub enum Event<'a> {
    SettingsChanged,
    TeamChanged { account: &'a str },
    ProfileSet { account: &'a str },
    CategoryChanged { id: &'a str },
    UpdatePublished { id: &'a str },
    PostEdited { id: &'a str },
    PostDeleted { id: &'a str },
    QuestionAsked { id: &'a str },
    StatusChanged { post_id: &'a str },
    AskChanged { post_id: &'a str, ask_id: &'a str },
    OfferChanged { post_id: &'a str, ask_id: &'a str },
    Commented { post_id: &'a str, id: &'a str },
    Reacted { post_id: &'a str },
    Read { post_id: &'a str },
}

// ── Logic ────────────────────────────────────────────────────────────────────

#[app::logic]
impl MeroUpdates {
    /// No arguments: the frontend's context-creation flow sends `{}`. The
    /// creator becomes the first admin; everything else is configured after.
    #[app::init]
    pub fn init() -> MeroUpdates {
        MeroUpdates {
            // `new(caller)`, not `new_admin_caller()`: the latter reads the
            // STORAGE layer's executor, which the SDK's TestHost does not align
            // during init, so under test the creator came out a non-admin. The
            // SDK's account is the one every gate below compares against.
            roles: AccessControl::new(Self::caller_account()),
            settings: UnorderedMap::new(),
            categories: UnorderedMap::new(),
            posts: UnorderedMap::new(),
            asks: UnorderedMap::new(),
            offers: UnorderedMap::new(),
            comments: UnorderedMap::new(),
            reactions: UnorderedMap::new(),
            reads: UnorderedMap::new(),
            profiles: UnorderedMap::new(),
        }
    }

    // ── identity & roles ─────────────────────────────────────────────────────

    /// The caller as an ACCOUNT — one person across their laptop and phone.
    fn caller_account() -> AccountId {
        AccountId::from(env::account_id())
    }

    fn caller() -> String {
        Self::caller_account().to_string()
    }

    fn parse_account(account: &str) -> app::Result<AccountId> {
        AccountId::from_str(account.trim())
            .map_err(|_| AppError::msg(format!("not an account id: {account}")))
    }

    fn is_admin_str(&self, account: &str) -> bool {
        AccountId::from_str(account)
            .map(|a| self.roles.is_admin(&a))
            .unwrap_or(false)
    }

    fn is_team_str(&self, account: &str) -> bool {
        match AccountId::from_str(account) {
            Ok(a) => self.roles.is_admin(&a) || self.roles.has_role(ROLE_TEAM, &a).unwrap_or(false),
            Err(_) => false,
        }
    }

    fn require_team(&self) -> app::Result<()> {
        if self.is_team_str(&Self::caller()) {
            Ok(())
        } else {
            Err(AppError::msg("only the company team can do this"))
        }
    }

    fn require_admin(&self) -> app::Result<()> {
        if self.roles.is_admin(&Self::caller_account()) {
            Ok(())
        } else {
            Err(AppError::msg("only an admin can do this"))
        }
    }

    fn fresh_id() -> String {
        let mut buffer = [0u8; 16];
        env::random_bytes(&mut buffer);
        hex::encode(buffer)
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

    /// The caller's profile, or a fresh one. Every write a member makes
    /// registers them, so the team's people list includes readers who never
    /// set a name.
    fn touch_profile(&mut self, account: &str) -> app::Result<()> {
        if self
            .profiles
            .get(&account.to_owned())
            .map_err(|e| AppError::msg(format!("profiles.get failed: {e}")))?
            .is_some()
        {
            return Ok(());
        }
        let now = now_ms();
        self.profiles
            .insert(
                account.to_owned(),
                Profile {
                    account: account.to_owned(),
                    name: String::new(),
                    firm: String::new(),
                    muted: Vec::new(),
                    joined_at: now,
                    updated_at: now,
                },
            )
            .map_err(|e| AppError::msg(format!("profiles.insert failed: {e}")))?;
        Ok(())
    }

    fn profile_of(&self, account: &str) -> Option<Profile> {
        self.profiles
            .get(&account.to_owned())
            .ok()
            .flatten()
            .map(|p| (*p).clone())
    }

    fn name_of(&self, account: &str) -> (String, String) {
        self.profile_of(account)
            .map(|p| (p.name, p.firm))
            .unwrap_or_default()
    }

    pub fn get_me(&self) -> app::Result<MeView> {
        let account = Self::caller();
        let profile = self.profile_of(&account);
        Ok(MeView {
            is_admin: self.is_admin_str(&account),
            is_team: self.is_team_str(&account),
            name: profile.as_ref().map(|p| p.name.clone()).unwrap_or_default(),
            firm: profile.as_ref().map(|p| p.firm.clone()).unwrap_or_default(),
            muted: profile.map(|p| p.muted).unwrap_or_default(),
            account,
        })
    }

    /// Name yourself. No `account` argument: you can only describe yourself.
    pub fn set_profile(&mut self, name: String, firm: String) -> app::Result<()> {
        let name = name.trim().to_owned();
        let firm = firm.trim().to_owned();
        Self::check_len("name", &name, MAX_NAME, false)?;
        Self::check_len("firm", &firm, MAX_NAME, false)?;
        let account = Self::caller();
        let now = now_ms();
        let mut profile = self.profile_of(&account).unwrap_or(Profile {
            account: account.clone(),
            name: String::new(),
            firm: String::new(),
            muted: Vec::new(),
            joined_at: now,
            updated_at: now,
        });
        profile.name = name;
        profile.firm = firm;
        profile.updated_at = now;
        self.profiles
            .insert(account.clone(), profile)
            .map_err(|e| AppError::msg(format!("profiles.insert failed: {e}")))?;
        app::emit!(Event::ProfileSet { account: &account });
        Ok(())
    }

    /// Mute categories: their updates stop counting as unread for you. Replaces
    /// the whole set — the UI always has it in hand.
    pub fn set_muted_categories(&mut self, category_ids: Vec<String>) -> app::Result<()> {
        if category_ids.len() > MAX_CATEGORIES {
            return Err(AppError::msg("too many categories"));
        }
        let account = Self::caller();
        self.touch_profile(&account)?;
        let mut profile = self.profile_of(&account).expect("touched above");
        let mut ids = category_ids;
        ids.sort();
        ids.dedup();
        profile.muted = ids;
        profile.updated_at = now_ms();
        self.profiles
            .insert(account.clone(), profile)
            .map_err(|e| AppError::msg(format!("profiles.insert failed: {e}")))?;
        app::emit!(Event::ProfileSet { account: &account });
        Ok(())
    }

    /// Everyone this audience knows about: every admin and teammate, and every
    /// member who has written anything (a profile, a read, a comment…).
    pub fn list_people(&self) -> app::Result<Vec<PersonView>> {
        let updates: Vec<Post> = self.live_posts(Some(KIND_UPDATE))?;
        let total = updates.len() as u64;
        let update_ids: std::collections::BTreeSet<String> =
            updates.iter().map(|p| p.id.clone()).collect();

        let mut accounts: std::collections::BTreeSet<String> = std::collections::BTreeSet::new();
        for a in self.roles.admins() {
            let _ = accounts.insert(a.to_string());
        }
        for a in self
            .roles
            .members_of(ROLE_TEAM)
            .map_err(|e| AppError::msg(format!("roles.members_of failed: {e}")))?
        {
            let _ = accounts.insert(a.to_string());
        }
        for (k, _) in self
            .profiles
            .entries()
            .map_err(|e| AppError::msg(format!("profiles.entries failed: {e}")))?
        {
            let _ = accounts.insert(k);
        }

        let reads: Vec<Read> = self
            .reads
            .entries()
            .map_err(|e| AppError::msg(format!("reads.entries failed: {e}")))?
            .map(|(_, r)| r)
            .collect();
        let comments: Vec<Comment> = self
            .comments
            .entries()
            .map_err(|e| AppError::msg(format!("comments.entries failed: {e}")))?
            .map(|(_, c)| c)
            .filter(|c| !c.deleted)
            .collect();
        let offers: Vec<Offer> = self
            .offers
            .entries()
            .map_err(|e| AppError::msg(format!("offers.entries failed: {e}")))?
            .map(|(_, o)| o)
            .filter(|o| !o.helper.withdrawn)
            .collect();

        let mut out = Vec::with_capacity(accounts.len());
        for account in accounts {
            let profile = self.profile_of(&account);
            let mine = reads
                .iter()
                .filter(|r| r.account == account && update_ids.contains(&r.post_id));
            let (mut read, mut last) = (0u64, 0u64);
            for r in mine {
                read += 1;
                last = last.max(r.last_at);
            }
            out.push(PersonView {
                is_admin: self.is_admin_str(&account),
                is_team: self.is_team_str(&account),
                name: profile.as_ref().map(|p| p.name.clone()).unwrap_or_default(),
                firm: profile.as_ref().map(|p| p.firm.clone()).unwrap_or_default(),
                joined_at: profile.as_ref().map(|p| p.joined_at).unwrap_or_default(),
                updates_read: read,
                updates_total: total,
                last_read_at: last,
                comments: comments.iter().filter(|c| c.author == account).count() as u64,
                offers: offers.iter().filter(|o| o.account == account).count() as u64,
                accepted_offers: offers
                    .iter()
                    .filter(|o| o.account == account && o.status == "accepted")
                    .count() as u64,
                account,
            });
        }
        // Team first, then by name, then id — a total order on every replica.
        out.sort_by(|a, b| {
            (!a.is_team, a.name.to_lowercase(), &a.account).cmp(&(
                !b.is_team,
                b.name.to_lowercase(),
                &b.account,
            ))
        });
        Ok(out)
    }

    /// Make a member part of the team. Admin only — and enforced at MERGE by
    /// `AccessControl`, so a forged grant from a non-admin does not converge.
    pub fn add_teammate(&mut self, account: String) -> app::Result<()> {
        self.require_admin()?;
        let who = Self::parse_account(&account)?;
        self.roles
            .grant(ROLE_TEAM, who)
            .map_err(|e| AppError::msg(format!("grant failed: {e}")))?;
        let account = who.to_string();
        self.touch_profile(&account)?;
        app::emit!(Event::TeamChanged { account: &account });
        Ok(())
    }

    pub fn remove_teammate(&mut self, account: String) -> app::Result<()> {
        self.require_admin()?;
        let who = Self::parse_account(&account)?;
        self.roles
            .revoke(ROLE_TEAM, &who)
            .map_err(|e| AppError::msg(format!("revoke failed: {e}")))?;
        let account = who.to_string();
        app::emit!(Event::TeamChanged { account: &account });
        Ok(())
    }

    // ── settings ─────────────────────────────────────────────────────────────

    fn settings_or_default(&self) -> Settings {
        self.settings
            .get(&"main".to_owned())
            .ok()
            .flatten()
            .map(|s| (*s).clone())
            .unwrap_or(Settings {
                company_name: String::new(),
                cadence_days: 0,
                updated_at: 0,
            })
    }

    pub fn get_settings(&self) -> app::Result<Settings> {
        Ok(self.settings_or_default())
    }

    pub fn set_settings(&mut self, company_name: String, cadence_days: u32) -> app::Result<()> {
        self.require_team()?;
        let company_name = company_name.trim().to_owned();
        Self::check_len("company name", &company_name, MAX_NAME, false)?;
        if cadence_days > 366 {
            return Err(AppError::msg("cadence must be at most 366 days"));
        }
        self.settings
            .insert(
                "main".to_owned(),
                Settings {
                    company_name,
                    cadence_days,
                    updated_at: now_ms(),
                },
            )
            .map_err(|e| AppError::msg(format!("settings.insert failed: {e}")))?;
        app::emit!(Event::SettingsChanged);
        Ok(())
    }

    // ── categories ───────────────────────────────────────────────────────────

    fn check_category_fields(name: &str, emoji: &str, color: &str) -> app::Result<()> {
        Self::check_len("category name", name, MAX_SHORT, true)?;
        Self::check_len("emoji", emoji, 16, false)?;
        Self::check_len("color", color, 32, false)
    }

    fn load_category(&self, id: &str) -> app::Result<Category> {
        let c = self
            .categories
            .get(&id.to_owned())
            .map_err(|e| AppError::msg(format!("categories.get failed: {e}")))?
            .ok_or_else(|| AppError::msg(format!("no such category: {id}")))?;
        Ok((*c).clone())
    }

    pub fn create_category(
        &mut self,
        name: String,
        emoji: String,
        color: String,
    ) -> app::Result<String> {
        self.require_team()?;
        let name = name.trim().to_owned();
        Self::check_category_fields(&name, &emoji, &color)?;
        let live = self
            .categories
            .entries()
            .map_err(|e| AppError::msg(format!("categories.entries failed: {e}")))?
            .filter(|(_, c)| !c.archived)
            .count();
        if live >= MAX_CATEGORIES {
            return Err(AppError::msg(format!(
                "at most {MAX_CATEGORIES} categories"
            )));
        }
        let now = now_ms();
        let id = Self::fresh_id();
        self.categories
            .insert(
                id.clone(),
                Category {
                    id: id.clone(),
                    name,
                    emoji,
                    color,
                    created_at: now,
                    edited_at: now,
                    archived: false,
                },
            )
            .map_err(|e| AppError::msg(format!("categories.insert failed: {e}")))?;
        app::emit!(Event::CategoryChanged { id: &id });
        Ok(id)
    }

    pub fn edit_category(
        &mut self,
        category_id: String,
        name: String,
        emoji: String,
        color: String,
    ) -> app::Result<()> {
        self.require_team()?;
        let name = name.trim().to_owned();
        Self::check_category_fields(&name, &emoji, &color)?;
        let mut c = self.load_category(&category_id)?;
        if c.archived {
            return Err(AppError::msg("category is archived"));
        }
        c.name = name;
        c.emoji = emoji;
        c.color = color;
        c.edited_at = now_ms();
        self.categories
            .insert(category_id.clone(), c)
            .map_err(|e| AppError::msg(format!("categories.insert failed: {e}")))?;
        app::emit!(Event::CategoryChanged { id: &category_id });
        Ok(())
    }

    /// Archive, never remove: updates filed under it keep their label, and an
    /// archive is monotone so a concurrent rename cannot resurrect it.
    pub fn archive_category(&mut self, category_id: String) -> app::Result<()> {
        self.require_team()?;
        let mut c = self.load_category(&category_id)?;
        c.archived = true;
        c.edited_at = now_ms();
        self.categories
            .insert(category_id.clone(), c)
            .map_err(|e| AppError::msg(format!("categories.insert failed: {e}")))?;
        app::emit!(Event::CategoryChanged { id: &category_id });
        Ok(())
    }

    /// Live categories, oldest first, with per-caller unread counts.
    pub fn list_categories(&self) -> app::Result<Vec<CategoryView>> {
        let me = Self::caller();
        let muted = self.profile_of(&me).map(|p| p.muted).unwrap_or_default();
        let updates = self.live_posts(Some(KIND_UPDATE))?;
        let mut cats: Vec<Category> = self
            .categories
            .entries()
            .map_err(|e| AppError::msg(format!("categories.entries failed: {e}")))?
            .map(|(_, c)| c)
            .filter(|c| !c.archived)
            .collect();
        cats.sort_by(|a, b| (a.created_at, &a.id).cmp(&(b.created_at, &b.id)));
        let mut out = Vec::with_capacity(cats.len());
        for c in cats {
            let mut count = 0u64;
            let mut unread = 0u64;
            for p in updates.iter().filter(|p| p.content.category_id == c.id) {
                count += 1;
                if !self.has_read(&p.id, &me) {
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

    fn load_post(&self, post_id: &str) -> app::Result<Post> {
        let post = self
            .posts
            .get(&post_id.to_owned())
            .map_err(|e| AppError::msg(format!("posts.get failed: {e}")))?
            .ok_or_else(|| AppError::msg(format!("no such post: {post_id}")))?;
        let post = (*post).clone();
        if post.deleted {
            return Err(AppError::msg(format!("post is deleted: {post_id}")));
        }
        Ok(post)
    }

    fn live_posts(&self, kind: Option<&str>) -> app::Result<Vec<Post>> {
        Ok(self
            .posts
            .entries()
            .map_err(|e| AppError::msg(format!("posts.entries failed: {e}")))?
            .map(|(_, p)| p)
            .filter(|p| !p.deleted && kind.is_none_or(|k| p.kind == k))
            .collect())
    }

    fn validate_update(&self, input: &UpdateInput) -> app::Result<()> {
        Self::check_len("title", &input.title, MAX_TITLE, true)?;
        Self::check_len("summary", &input.summary, MAX_SUMMARY, false)?;
        if !input.category_id.is_empty() {
            let c = self.load_category(&input.category_id)?;
            if c.archived {
                return Err(AppError::msg("that category is archived"));
            }
        }
        if input.sections.len() > MAX_SECTIONS {
            return Err(AppError::msg(format!("at most {MAX_SECTIONS} sections")));
        }
        for s in &input.sections {
            Self::check_len("section kind", &s.kind, MAX_SHORT, false)?;
            Self::check_len("section title", &s.title, MAX_TITLE, false)?;
            Self::check_len("section body", &s.body, MAX_BODY, false)?;
        }
        if input.metrics.len() > MAX_METRICS {
            return Err(AppError::msg(format!("at most {MAX_METRICS} metrics")));
        }
        for m in &input.metrics {
            Self::check_len("metric name", &m.name, MAX_SHORT, true)?;
            Self::check_len("metric value", &m.value, MAX_SHORT, true)?;
            Self::check_len("metric unit", &m.unit, 16, false)?;
        }
        if input.asks.len() > MAX_ASKS {
            return Err(AppError::msg(format!("at most {MAX_ASKS} asks")));
        }
        for a in &input.asks {
            Self::check_one_of("ask kind", &a.kind, ASK_KINDS)?;
            Self::check_len("ask title", &a.title, MAX_TITLE, true)?;
            Self::check_len("ask detail", &a.detail, MAX_SUMMARY, false)?;
        }
        Ok(())
    }

    fn content_of(input: &UpdateInput) -> PostContent {
        PostContent {
            title: input.title.trim().to_owned(),
            summary: input.summary.clone(),
            category_id: input.category_id.clone(),
            // A section with nothing in it is a template placeholder the
            // founder skipped. Publishing it would render an empty heading.
            sections: input
                .sections
                .iter()
                .filter(|s| !s.body.trim().is_empty())
                .cloned()
                .collect(),
            metrics: input
                .metrics
                .iter()
                .map(|m| Metric {
                    name: m.name.trim().to_owned(),
                    value: m.value.trim().to_owned(),
                    unit: m.unit.trim().to_owned(),
                })
                .collect(),
        }
    }

    /// Publish an update to this audience. Team only.
    pub fn publish_update(&mut self, input: UpdateInput) -> app::Result<String> {
        self.require_team()?;
        self.validate_update(&input)?;
        let now = now_ms();
        let id = Self::fresh_id();
        let author = Self::caller();
        self.posts
            .insert(
                id.clone(),
                Post {
                    id: id.clone(),
                    kind: KIND_UPDATE.to_owned(),
                    author: author.clone(),
                    content: Self::content_of(&input),
                    edited_at: now,
                    created_at: now,
                    status: "published".to_owned(),
                    status_at: now,
                    deleted: false,
                },
            )
            .map_err(|e| AppError::msg(format!("posts.insert failed: {e}")))?;
        self.sync_asks(&id, &input.asks, now)?;
        // The author has, by definition, read it.
        self.record_read(&id, &author, now)?;
        app::emit!(Event::UpdatePublished { id: &id });
        Ok(id)
    }

    /// Replace an update's content. Any teammate may — updates are the
    /// company's voice, not one person's. Asks listed with an `id` are edited,
    /// without one are created, and this update's asks not listed are removed.
    pub fn edit_update(&mut self, post_id: String, input: UpdateInput) -> app::Result<()> {
        self.require_team()?;
        self.validate_update(&input)?;
        let mut post = self.load_post(&post_id)?;
        if post.kind != KIND_UPDATE {
            return Err(AppError::msg("not an update"));
        }
        let now = now_ms();
        post.content = Self::content_of(&input);
        post.edited_at = now;
        self.posts
            .insert(post_id.clone(), post)
            .map_err(|e| AppError::msg(format!("posts.insert failed: {e}")))?;
        self.sync_asks(&post_id, &input.asks, now)?;
        app::emit!(Event::PostEdited { id: &post_id });
        Ok(())
    }

    fn sync_asks(&mut self, post_id: &str, asks: &[AskInput], now: u64) -> app::Result<()> {
        let existing: Vec<Ask> = self
            .asks
            .entries()
            .map_err(|e| AppError::msg(format!("asks.entries failed: {e}")))?
            .map(|(_, a)| a)
            .filter(|a| a.post_id == post_id && !a.deleted)
            .collect();
        let kept: Vec<&str> = asks.iter().filter_map(|a| a.id.as_deref()).collect();

        for mut gone in existing
            .iter()
            .filter(|a| !kept.contains(&a.id.as_str()))
            .cloned()
        {
            gone.deleted = true;
            gone.edited_at = now;
            let id = gone.id.clone();
            self.asks
                .insert(id, gone)
                .map_err(|e| AppError::msg(format!("asks.insert failed: {e}")))?;
        }

        for input in asks {
            let content = AskContent {
                kind: input.kind.clone(),
                title: input.title.trim().to_owned(),
                detail: input.detail.clone(),
            };
            let ask = match &input.id {
                Some(id) => {
                    let mut ask =
                        existing
                            .iter()
                            .find(|a| &a.id == id)
                            .cloned()
                            .ok_or_else(|| {
                                AppError::msg(format!("no such ask on this update: {id}"))
                            })?;
                    if ask.content != content {
                        ask.content = content;
                        ask.edited_at = now;
                    }
                    ask
                }
                None => Ask {
                    id: Self::fresh_id(),
                    post_id: post_id.to_owned(),
                    content,
                    edited_at: now,
                    created_at: now,
                    status: "open".to_owned(),
                    status_at: now,
                    deleted: false,
                },
            };
            let id = ask.id.clone();
            self.asks
                .insert(id, ask)
                .map_err(|e| AppError::msg(format!("asks.insert failed: {e}")))?;
        }
        Ok(())
    }

    /// Ask the team something. Anyone in the audience may — this is the half of
    /// the conversation a newsletter tool does not have.
    pub fn ask_question(
        &mut self,
        title: String,
        body: String,
        category_id: Option<String>,
    ) -> app::Result<String> {
        Self::check_len("title", &title, MAX_TITLE, true)?;
        Self::check_len("body", &body, MAX_BODY, false)?;
        let category_id = category_id.unwrap_or_default();
        if !category_id.is_empty() {
            let _ = self.load_category(&category_id)?;
        }
        let now = now_ms();
        let id = Self::fresh_id();
        let author = Self::caller();
        self.touch_profile(&author)?;
        let sections = if body.trim().is_empty() {
            Vec::new()
        } else {
            vec![Section {
                kind: "text".to_owned(),
                title: String::new(),
                body,
            }]
        };
        self.posts
            .insert(
                id.clone(),
                Post {
                    id: id.clone(),
                    kind: KIND_QUESTION.to_owned(),
                    author: author.clone(),
                    content: PostContent {
                        title: title.trim().to_owned(),
                        summary: String::new(),
                        category_id,
                        sections,
                        metrics: Vec::new(),
                    },
                    edited_at: now,
                    created_at: now,
                    status: "open".to_owned(),
                    status_at: now,
                    deleted: false,
                },
            )
            .map_err(|e| AppError::msg(format!("posts.insert failed: {e}")))?;
        self.record_read(&id, &author, now)?;
        app::emit!(Event::QuestionAsked { id: &id });
        Ok(id)
    }

    /// Mark a question answered (or re-open it). Team only.
    pub fn set_question_status(&mut self, post_id: String, status: String) -> app::Result<()> {
        self.require_team()?;
        Self::check_one_of("status", &status, QUESTION_STATUSES)?;
        let mut post = self.load_post(&post_id)?;
        if post.kind != KIND_QUESTION {
            return Err(AppError::msg("not a question"));
        }
        post.status = status;
        post.status_at = now_ms();
        self.posts
            .insert(post_id.clone(), post)
            .map_err(|e| AppError::msg(format!("posts.insert failed: {e}")))?;
        app::emit!(Event::StatusChanged { post_id: &post_id });
        Ok(())
    }

    /// Tombstone a post. An update may be removed by any teammate; a question
    /// by its author or by the team (moderation).
    pub fn delete_post(&mut self, post_id: String) -> app::Result<()> {
        let mut post = self.load_post(&post_id)?;
        let me = Self::caller();
        let allowed = self.is_team_str(&me) || (post.kind == KIND_QUESTION && post.author == me);
        if !allowed {
            return Err(AppError::msg("you cannot delete this post"));
        }
        post.deleted = true;
        post.edited_at = now_ms();
        self.posts
            .insert(post_id.clone(), post)
            .map_err(|e| AppError::msg(format!("posts.insert failed: {e}")))?;
        app::emit!(Event::PostDeleted { id: &post_id });
        Ok(())
    }

    fn has_read(&self, post_id: &str, account: &str) -> bool {
        self.reads
            .get(&format!("{post_id}|{account}"))
            .ok()
            .flatten()
            .is_some()
    }

    fn reactions_for(&self, post_id: &str, me: &str) -> app::Result<Vec<ReactionCount>> {
        let mut counts: Vec<ReactionCount> = REACTIONS
            .iter()
            .map(|e| ReactionCount {
                emoji: (*e).to_owned(),
                count: 0,
                mine: false,
            })
            .collect();
        for (_, r) in self
            .reactions
            .entries()
            .map_err(|e| AppError::msg(format!("reactions.entries failed: {e}")))?
        {
            if r.post_id != post_id || !r.on {
                continue;
            }
            if let Some(slot) = counts.iter_mut().find(|c| c.emoji == r.emoji) {
                slot.count += 1;
                slot.mine |= r.account == me;
            }
        }
        Ok(counts)
    }

    fn card_of(&self, post: &Post, me: &str) -> app::Result<PostCard> {
        let comment_count = self
            .comments
            .entries()
            .map_err(|e| AppError::msg(format!("comments.entries failed: {e}")))?
            .filter(|(_, c)| c.post_id == post.id && !c.deleted)
            .count() as u64;
        let asks: Vec<Ask> = self.asks_of(&post.id)?;
        let read_count = self
            .reads
            .entries()
            .map_err(|e| AppError::msg(format!("reads.entries failed: {e}")))?
            .filter(|(_, r)| r.post_id == post.id)
            .count() as u64;
        let (author_name, _) = self.name_of(&post.author);
        Ok(PostCard {
            id: post.id.clone(),
            kind: post.kind.clone(),
            author_is_team: self.is_team_str(&post.author),
            author: post.author.clone(),
            author_name,
            title: post.content.title.clone(),
            summary: post.content.summary.clone(),
            category_id: post.content.category_id.clone(),
            status: post.status.clone(),
            created_at: post.created_at,
            edited_at: post.edited_at,
            comment_count,
            ask_count: asks.len() as u64,
            open_ask_count: asks.iter().filter(|a| a.status == "open").count() as u64,
            metric_count: post.content.metrics.len() as u64,
            read_count,
            read_by_me: self.has_read(&post.id, me),
            reactions: self.reactions_for(&post.id, me)?,
        })
    }

    fn asks_of(&self, post_id: &str) -> app::Result<Vec<Ask>> {
        let mut asks: Vec<Ask> = self
            .asks
            .entries()
            .map_err(|e| AppError::msg(format!("asks.entries failed: {e}")))?
            .map(|(_, a)| a)
            .filter(|a| a.post_id == post_id && !a.deleted)
            .collect();
        asks.sort_by(|a, b| (a.created_at, &a.id).cmp(&(b.created_at, &b.id)));
        Ok(asks)
    }

    fn offer_view(&self, o: &Offer) -> OfferView {
        let (name, firm) = self.name_of(&o.account);
        OfferView {
            ask_id: o.ask_id.clone(),
            account: o.account.clone(),
            name,
            firm,
            note: o.helper.note.clone(),
            status: o.status.clone(),
            created_at: o.created_at,
            updated_at: o.updated_at,
        }
    }

    fn ask_view(&self, ask: &Ask, post_title: &str, me: &str, team: bool) -> app::Result<AskView> {
        let mut offers: Vec<Offer> = self
            .offers
            .entries()
            .map_err(|e| AppError::msg(format!("offers.entries failed: {e}")))?
            .map(|(_, o)| o)
            .filter(|o| o.ask_id == ask.id && !o.helper.withdrawn)
            .collect();
        offers.sort_by(|a, b| (a.created_at, &a.account).cmp(&(b.created_at, &b.account)));
        let my_offer = offers
            .iter()
            .find(|o| o.account == me)
            .map(|o| self.offer_view(o));
        Ok(AskView {
            id: ask.id.clone(),
            post_id: ask.post_id.clone(),
            post_title: post_title.to_owned(),
            kind: ask.content.kind.clone(),
            title: ask.content.title.clone(),
            detail: ask.content.detail.clone(),
            status: ask.status.clone(),
            created_at: ask.created_at,
            offer_count: offers.len() as u64,
            offers: if team {
                offers.iter().map(|o| self.offer_view(o)).collect()
            } else {
                Vec::new()
            },
            my_offer,
        })
    }

    pub fn get_post(&self, post_id: String) -> app::Result<PostView> {
        let post = self.load_post(&post_id)?;
        let me = Self::caller();
        let team = self.is_team_str(&me);
        let mut asks = Vec::new();
        for a in self.asks_of(&post_id)? {
            asks.push(self.ask_view(&a, &post.content.title, &me, team)?);
        }
        Ok(PostView {
            card: self.card_of(&post, &me)?,
            sections: post.content.sections.clone(),
            metrics: post.content.metrics.clone(),
            asks,
        })
    }

    /// One page of posts, newest first.
    ///
    /// `kind` is `"update"`, `"question"` or `None` for both; `category_id`
    /// filters to one category. Keyset pagination: the cursor names the last
    /// row seen, so a post replicating in above it cannot shift the page.
    pub fn list_posts(
        &self,
        kind: Option<String>,
        category_id: Option<String>,
        cursor: Option<String>,
        limit: u32,
    ) -> app::Result<PostPage> {
        let limit = match limit as usize {
            0 => DEFAULT_PAGE,
            n if n > MAX_PAGE => MAX_PAGE,
            n => n,
        };
        let me = Self::caller();
        let mut rows = self.live_posts(kind.as_deref())?;
        if let Some(cat) = category_id.as_deref().filter(|c| !c.is_empty()) {
            rows.retain(|p| p.content.category_id == cat);
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

    fn record_read(&mut self, post_id: &str, account: &str, now: u64) -> app::Result<()> {
        let key = format!("{post_id}|{account}");
        let first_at = self
            .reads
            .get(&key)
            .map_err(|e| AppError::msg(format!("reads.get failed: {e}")))?
            .map(|r| r.first_at)
            .unwrap_or(now);
        self.reads
            .insert(
                key,
                Read {
                    post_id: post_id.to_owned(),
                    account: account.to_owned(),
                    first_at,
                    last_at: now,
                },
            )
            .map_err(|e| AppError::msg(format!("reads.insert failed: {e}")))?;
        Ok(())
    }

    /// Record that the caller opened a post. The frontend calls this when a
    /// post is shown — a read receipt the reader can see being taken.
    pub fn mark_read(&mut self, post_id: String) -> app::Result<()> {
        let _ = self.load_post(&post_id)?;
        let me = Self::caller();
        self.touch_profile(&me)?;
        self.record_read(&post_id, &me, now_ms())?;
        app::emit!(Event::Read { post_id: &post_id });
        Ok(())
    }

    /// Toggle one emoji on a post for the caller.
    pub fn react(&mut self, post_id: String, emoji: String, on: bool) -> app::Result<()> {
        Self::check_one_of("reaction", &emoji, REACTIONS)?;
        let _ = self.load_post(&post_id)?;
        let me = Self::caller();
        self.touch_profile(&me)?;
        self.reactions
            .insert(
                format!("{post_id}|{me}|{emoji}"),
                Reaction {
                    post_id: post_id.clone(),
                    account: me,
                    emoji,
                    on,
                    updated_at: now_ms(),
                },
            )
            .map_err(|e| AppError::msg(format!("reactions.insert failed: {e}")))?;
        app::emit!(Event::Reacted { post_id: &post_id });
        Ok(())
    }

    // ── comments ─────────────────────────────────────────────────────────────

    fn load_comment(&self, comment_id: &str) -> app::Result<Comment> {
        let c = self
            .comments
            .get(&comment_id.to_owned())
            .map_err(|e| AppError::msg(format!("comments.get failed: {e}")))?
            .ok_or_else(|| AppError::msg(format!("no such comment: {comment_id}")))?;
        let c = (*c).clone();
        if c.deleted {
            return Err(AppError::msg(format!("comment is deleted: {comment_id}")));
        }
        Ok(c)
    }

    /// Reply on a post. `parent_id` threads one level deep: replying to a reply
    /// attaches to that reply's parent, so a thread never becomes a staircase.
    pub fn add_comment(
        &mut self,
        post_id: String,
        parent_id: Option<String>,
        body: String,
    ) -> app::Result<String> {
        Self::check_len("comment", &body, MAX_BODY, true)?;
        let _ = self.load_post(&post_id)?;
        let parent_id = match parent_id.filter(|p| !p.is_empty()) {
            None => String::new(),
            Some(p) => {
                let parent = self.load_comment(&p)?;
                if parent.post_id != post_id {
                    return Err(AppError::msg("parent comment is on another post"));
                }
                if parent.parent_id.is_empty() {
                    parent.id
                } else {
                    parent.parent_id
                }
            }
        };
        let now = now_ms();
        let id = Self::fresh_id();
        let author = Self::caller();
        self.touch_profile(&author)?;
        self.comments
            .insert(
                id.clone(),
                Comment {
                    id: id.clone(),
                    post_id: post_id.clone(),
                    parent_id,
                    author,
                    body,
                    created_at: now,
                    edited_at: now,
                    deleted: false,
                },
            )
            .map_err(|e| AppError::msg(format!("comments.insert failed: {e}")))?;
        app::emit!(Event::Commented {
            post_id: &post_id,
            id: &id
        });
        Ok(id)
    }

    pub fn edit_comment(&mut self, comment_id: String, body: String) -> app::Result<()> {
        Self::check_len("comment", &body, MAX_BODY, true)?;
        let mut c = self.load_comment(&comment_id)?;
        if c.author != Self::caller() {
            return Err(AppError::msg("only the author can edit this comment"));
        }
        c.body = body;
        c.edited_at = now_ms();
        let post_id = c.post_id.clone();
        self.comments
            .insert(comment_id.clone(), c)
            .map_err(|e| AppError::msg(format!("comments.insert failed: {e}")))?;
        app::emit!(Event::Commented {
            post_id: &post_id,
            id: &comment_id
        });
        Ok(())
    }

    /// The author may delete their comment; the team may moderate any.
    pub fn delete_comment(&mut self, comment_id: String) -> app::Result<()> {
        let mut c = self.load_comment(&comment_id)?;
        let me = Self::caller();
        if c.author != me && !self.is_team_str(&me) {
            return Err(AppError::msg("you cannot delete this comment"));
        }
        c.deleted = true;
        c.edited_at = now_ms();
        let post_id = c.post_id.clone();
        self.comments
            .insert(comment_id.clone(), c)
            .map_err(|e| AppError::msg(format!("comments.insert failed: {e}")))?;
        app::emit!(Event::Commented {
            post_id: &post_id,
            id: &comment_id
        });
        Ok(())
    }

    /// A post's whole thread, oldest first. Replies follow their parent.
    pub fn list_comments(&self, post_id: String) -> app::Result<Vec<CommentView>> {
        let mut rows: Vec<Comment> = self
            .comments
            .entries()
            .map_err(|e| AppError::msg(format!("comments.entries failed: {e}")))?
            .map(|(_, c)| c)
            .filter(|c| c.post_id == post_id && !c.deleted)
            .collect();
        rows.sort_by(|a, b| (a.created_at, &a.id).cmp(&(b.created_at, &b.id)));
        Ok(rows
            .into_iter()
            .map(|c| {
                let (author_name, _) = self.name_of(&c.author);
                CommentView {
                    author_is_team: self.is_team_str(&c.author),
                    id: c.id,
                    post_id: c.post_id,
                    parent_id: c.parent_id,
                    author: c.author,
                    author_name,
                    body: c.body,
                    created_at: c.created_at,
                    edited_at: c.edited_at,
                }
            })
            .collect())
    }

    // ── asks & offers ────────────────────────────────────────────────────────

    fn load_ask(&self, ask_id: &str) -> app::Result<Ask> {
        let a = self
            .asks
            .get(&ask_id.to_owned())
            .map_err(|e| AppError::msg(format!("asks.get failed: {e}")))?
            .ok_or_else(|| AppError::msg(format!("no such ask: {ask_id}")))?;
        let a = (*a).clone();
        if a.deleted {
            return Err(AppError::msg(format!("ask is deleted: {ask_id}")));
        }
        Ok(a)
    }

    /// Every ask across every live update, newest first. `status` filters to
    /// `"open"` or `"resolved"`.
    pub fn list_asks(&self, status: Option<String>) -> app::Result<Vec<AskView>> {
        let me = Self::caller();
        let team = self.is_team_str(&me);
        let mut asks: Vec<Ask> = self
            .asks
            .entries()
            .map_err(|e| AppError::msg(format!("asks.entries failed: {e}")))?
            .map(|(_, a)| a)
            .filter(|a| !a.deleted && status.as_deref().is_none_or(|s| a.status == s))
            .collect();
        asks.sort_by(|a, b| (b.created_at, &b.id).cmp(&(a.created_at, &a.id)));
        let mut out = Vec::with_capacity(asks.len());
        for a in asks {
            // An ask on a deleted update is gone with it.
            let Ok(post) = self.load_post(&a.post_id) else {
                continue;
            };
            out.push(self.ask_view(&a, &post.content.title, &me, team)?);
        }
        Ok(out)
    }

    pub fn set_ask_status(&mut self, ask_id: String, status: String) -> app::Result<()> {
        self.require_team()?;
        Self::check_one_of("status", &status, ASK_STATUSES)?;
        let mut ask = self.load_ask(&ask_id)?;
        ask.status = status;
        ask.status_at = now_ms();
        let post_id = ask.post_id.clone();
        self.asks
            .insert(ask_id.clone(), ask)
            .map_err(|e| AppError::msg(format!("asks.insert failed: {e}")))?;
        app::emit!(Event::AskChanged {
            post_id: &post_id,
            ask_id: &ask_id
        });
        Ok(())
    }

    /// "I can help." One click, optional note. Offering again edits the note;
    /// one offer per account per ask.
    pub fn offer_help(&mut self, ask_id: String, note: String) -> app::Result<()> {
        Self::check_len("note", &note, MAX_SUMMARY, false)?;
        let ask = self.load_ask(&ask_id)?;
        if ask.status != "open" {
            return Err(AppError::msg("this ask is resolved"));
        }
        let me = Self::caller();
        self.touch_profile(&me)?;
        let key = format!("{ask_id}|{me}");
        let now = now_ms();
        let existing = self
            .offers
            .get(&key)
            .map_err(|e| AppError::msg(format!("offers.get failed: {e}")))?
            .map(|o| (*o).clone());
        let offer = match existing {
            Some(mut o) => {
                o.helper = OfferByHelper {
                    note,
                    withdrawn: false,
                };
                o.updated_at = now;
                o
            }
            None => Offer {
                ask_id: ask_id.clone(),
                account: me,
                helper: OfferByHelper {
                    note,
                    withdrawn: false,
                },
                updated_at: now,
                created_at: now,
                status: "offered".to_owned(),
                status_at: now,
            },
        };
        self.offers
            .insert(key, offer)
            .map_err(|e| AppError::msg(format!("offers.insert failed: {e}")))?;
        app::emit!(Event::OfferChanged {
            post_id: &ask.post_id,
            ask_id: &ask_id
        });
        Ok(())
    }

    pub fn withdraw_offer(&mut self, ask_id: String) -> app::Result<()> {
        let ask = self.load_ask(&ask_id)?;
        let key = format!("{ask_id}|{}", Self::caller());
        let mut offer = self
            .offers
            .get(&key)
            .map_err(|e| AppError::msg(format!("offers.get failed: {e}")))?
            .map(|o| (*o).clone())
            .ok_or_else(|| AppError::msg("you have not offered to help with this"))?;
        offer.helper.withdrawn = true;
        offer.updated_at = now_ms();
        self.offers
            .insert(key, offer)
            .map_err(|e| AppError::msg(format!("offers.insert failed: {e}")))?;
        app::emit!(Event::OfferChanged {
            post_id: &ask.post_id,
            ask_id: &ask_id
        });
        Ok(())
    }

    /// Accept or decline someone's offer. Team only. Accepted offers become
    /// contributions (`list_contributions`).
    pub fn set_offer_status(
        &mut self,
        ask_id: String,
        account: String,
        status: String,
    ) -> app::Result<()> {
        self.require_team()?;
        Self::check_one_of("status", &status, OFFER_STATUSES)?;
        let ask = self.load_ask(&ask_id)?;
        let account = Self::parse_account(&account)?.to_string();
        let key = format!("{ask_id}|{account}");
        let mut offer = self
            .offers
            .get(&key)
            .map_err(|e| AppError::msg(format!("offers.get failed: {e}")))?
            .map(|o| (*o).clone())
            .ok_or_else(|| AppError::msg("no such offer"))?;
        offer.status = status;
        offer.status_at = now_ms();
        self.offers
            .insert(key, offer)
            .map_err(|e| AppError::msg(format!("offers.insert failed: {e}")))?;
        app::emit!(Event::OfferChanged {
            post_id: &ask.post_id,
            ask_id: &ask_id
        });
        Ok(())
    }

    /// Accepted offers since `since` (unix ms; 0 for all), oldest first — what the
    /// next update's "Thank you" section is written from.
    pub fn list_contributions(&self, since: u64) -> app::Result<Vec<ContributionView>> {
        let mut out = Vec::new();
        for (_, o) in self
            .offers
            .entries()
            .map_err(|e| AppError::msg(format!("offers.entries failed: {e}")))?
        {
            if o.status != "accepted" || o.helper.withdrawn || o.status_at < since {
                continue;
            }
            let Ok(ask) = self.load_ask(&o.ask_id) else {
                continue;
            };
            let (name, firm) = self.name_of(&o.account);
            out.push(ContributionView {
                ask_id: o.ask_id.clone(),
                ask_title: ask.content.title,
                ask_kind: ask.content.kind,
                account: o.account.clone(),
                name,
                firm,
                note: o.helper.note.clone(),
                accepted_at: o.status_at,
            });
        }
        out.sort_by(|a, b| (a.accepted_at, &a.account).cmp(&(b.accepted_at, &b.account)));
        Ok(out)
    }

    // ── insight ──────────────────────────────────────────────────────────────

    /// Every KPI ever reported, one series per metric name (case-insensitive),
    /// oldest point first. The trend chart and "vs last update" deltas come
    /// from here, so founders never retype last month's number.
    pub fn list_metrics(&self) -> app::Result<Vec<MetricSeries>> {
        let mut updates = self.live_posts(Some(KIND_UPDATE))?;
        updates.sort_by(|a, b| (a.created_at, &a.id).cmp(&(b.created_at, &b.id)));
        let mut series: Vec<MetricSeries> = Vec::new();
        for p in &updates {
            for m in &p.content.metrics {
                let key = m.name.to_lowercase();
                let point = MetricPoint {
                    post_id: p.id.clone(),
                    post_title: p.content.title.clone(),
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
    pub fn get_overview(&self) -> app::Result<Overview> {
        let me = Self::caller();
        let settings = self.settings_or_default();
        let muted = self.profile_of(&me).map(|p| p.muted).unwrap_or_default();
        let posts = self.live_posts(None)?;
        let updates: Vec<&Post> = posts.iter().filter(|p| p.kind == KIND_UPDATE).collect();
        let last_update_at = updates.iter().map(|p| p.created_at).max().unwrap_or(0);
        let next_due_at = if settings.cadence_days == 0 || last_update_at == 0 {
            0
        } else {
            last_update_at + u64::from(settings.cadence_days) * 86_400_000
        };
        let unread_updates = updates
            .iter()
            .filter(|p| !muted.contains(&p.content.category_id) && !self.has_read(&p.id, &me))
            .count() as u64;
        let open_questions = posts
            .iter()
            .filter(|p| p.kind == KIND_QUESTION && p.status == "open")
            .count() as u64;
        let live_post_ids: std::collections::BTreeSet<&str> =
            updates.iter().map(|p| p.id.as_str()).collect();
        let open_asks = self
            .asks
            .entries()
            .map_err(|e| AppError::msg(format!("asks.entries failed: {e}")))?
            .filter(|(_, a)| {
                !a.deleted && a.status == "open" && live_post_ids.contains(a.post_id.as_str())
            })
            .count() as u64;
        let people = self
            .profiles
            .entries()
            .map_err(|e| AppError::msg(format!("profiles.entries failed: {e}")))?
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
            people,
            is_team: self.is_team_str(&me),
        })
    }

    /// Who read what — the team's follow-up list. Team only.
    pub fn get_engagement(&self) -> app::Result<Vec<EngagementRow>> {
        self.require_team()?;
        let mut updates = self.live_posts(Some(KIND_UPDATE))?;
        updates.sort_by(|a, b| (b.created_at, &b.id).cmp(&(a.created_at, &a.id)));
        let reads: Vec<Read> = self
            .reads
            .entries()
            .map_err(|e| AppError::msg(format!("reads.entries failed: {e}")))?
            .map(|(_, r)| r)
            .collect();
        let readers_pool: Vec<Profile> = self
            .profiles
            .entries()
            .map_err(|e| AppError::msg(format!("profiles.entries failed: {e}")))?
            .map(|(_, p)| p)
            .filter(|p| !self.is_team_str(&p.account))
            .collect();

        let mut out = Vec::with_capacity(updates.len());
        for p in updates {
            let mut readers: Vec<ReaderView> = reads
                .iter()
                .filter(|r| r.post_id == p.id && !self.is_team_str(&r.account))
                .map(|r| {
                    let (name, firm) = self.name_of(&r.account);
                    ReaderView {
                        account: r.account.clone(),
                        name,
                        firm,
                        first_at: r.first_at,
                    }
                })
                .collect();
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
            let ask_ids: Vec<String> = self.asks_of(&p.id)?.into_iter().map(|a| a.id).collect();
            let offers = self
                .offers
                .entries()
                .map_err(|e| AppError::msg(format!("offers.entries failed: {e}")))?
                .filter(|(_, o)| !o.helper.withdrawn && ask_ids.contains(&o.ask_id))
                .count() as u64;
            out.push(EngagementRow {
                post_id: p.id.clone(),
                title: p.content.title.clone(),
                category_id: p.content.category_id.clone(),
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

    // ── drafts (node-local) ──────────────────────────────────────────────────

    /// Save a draft on THIS node only. `&mut self` so the runtime commits the
    /// private write — a `&self` method's private writes are discarded.
    pub fn save_draft(
        &mut self,
        draft_id: Option<String>,
        title: String,
        payload: String,
    ) -> app::Result<String> {
        Self::check_len("draft title", &title, MAX_TITLE, false)?;
        Self::check_len("draft", &payload, MAX_DRAFT, false)?;
        let id = draft_id
            .filter(|d| !d.is_empty())
            .unwrap_or_else(Self::fresh_id);
        let mut drafts = Drafts::private_load_or_default()?;
        drafts.as_mut().drafts.insert(
            id.clone(),
            Draft {
                id: id.clone(),
                title,
                payload,
                updated_at: now_ms(),
            },
        )?;
        Ok(id)
    }

    /// This node's drafts, most recently touched first.
    pub fn list_drafts(&self) -> app::Result<Vec<DraftView>> {
        let drafts = Drafts::private_load_or_default()?;
        let mut out: Vec<DraftView> = drafts
            .drafts
            .entries()?
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

    pub fn delete_draft(&mut self, draft_id: String) -> app::Result<()> {
        let mut drafts = Drafts::private_load_or_default()?;
        let _ = drafts.as_mut().drafts.remove(&draft_id)?;
        Ok(())
    }
}

#[cfg(test)]
mod tests;
