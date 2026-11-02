//! Mero Sheets: a collaborative spreadsheet on core's component SDK
//! (`calimero-app-sdk`). One app instance is one workbook.
//!
//! Sheets, cells with formulas (the `mero-sheets-recalc` engine, shared with
//! the browser), inserted and deleted rows and columns, named ranges, styles,
//! conditional formats and validations, charts, comments, notes, attachments,
//! workbook roles and protected ranges, an activity log, private sheets and
//! linked workbooks.
//!
//! The app runs on its cluster's leader, which applies every write in one
//! replicated log, so state is plain maps: v1's hand-written `Mergeable`
//! rules, owner-stamped keys (`Moderated`, `WriteOnce`, `UserStorage`) and
//! writer sets (`SharedStorage`, `AccessControl`) have nothing left to decide.
//! What they enforced is checked here, in each method, against `env::caller()`.
//!
//! | v1 (`calimero-storage`) | here |
//! |---|---|
//! | `Frozen<Founding>` | `founding: Cell<Founding>`, written once in `init` |
//! | `SharedStorage<LwwRegister<String>>` (the name, owners write) | `projectName: Cell<String>`, owners only |
//! | `AccessControl` (admins = owners, named roles `viewer` / `commenter`) | `owners: Set<account>` (the app owner at `init`) + `roles: UnorderedMap<account, role>` |
//! | `UserStorage<MemberData>` | `members: UnorderedMap<account, MemberData>`, written only for the caller |
//! | `SortedMap` / `UnorderedMap` keyed `"{sheet}\|{row}\|{col}"` (cells, formats, cell meta, styles, axes, sizes) | the same keys in `UnorderedMap<String, _>`; one sheet is `starts_with("{sheet}\|")` |
//! | `WriteOnce<IndexedMap<String, ActivityData>>`, author = owner stamp | `activity: UnorderedMap<(at, author, nonce), ActivityData>`, read newest first from `since` |
//! | `Moderated<UnorderedMap<String, CommentData>>` + `resolved` registers | `comments` (with an `author` field) + `resolved: Set<id>` |
//! | `UnorderedMap<String, RichText<DefaultMarks>>` | `notes: UnorderedMap<String, NoteDoc>` (formatted runs; see `notes.rs`) |
//! | `SharedStorage<IndexedMap<String, ProtectionData>>` | `protections: UnorderedMap<id, ProtectionData>`, owners only |
//! | `IndexedMap<String, RuleData>`, `UnorderedMap<String, ChartData>` | the same maps |
//! | `Moderated<…AttachmentData>`, `Moderated<IndexedMap<…PublicationData>>` | maps with a `created_by` field |
//! | `#[app::private] Scratch` (node-local) | `privateSheets` / `privateCells`, keyed by the caller's account |
//!
//! Who may do what is v1's: the workbook's owners (the app owner first) name
//! it, change roles and protect ranges; editors change cells and structure;
//! commenters comment; viewers read. The organization decides who reaches the
//! workbook at all. Everything a client sees differently from v1 is in
//! `apps/mero-sheets/README.md`, "What changed in the port".

use std::collections::{BTreeMap, BTreeSet};

use calimero_app_sdk::prelude::*;
use calimero_app_sdk::StorageError;
use serde::{Deserialize, Serialize};

use mero_sheets_recalc::{formula, layout, recalc, rules};
use mero_sheets_types::{generate_id, validate_label, validate_sheet_name};

mod notes;
pub use notes::{NoteChange, NoteDoc, Span};

// ---------------------------------------------------------------------------
// Limits
// ---------------------------------------------------------------------------

/// The most ops one `applyCellOps` (or style, size, axis) call accepts.
pub const MAX_OPS_PER_APPLY: usize = 100;
/// The largest attachment recorded, in bytes.
pub const MAX_ATTACHMENT_BYTES: u64 = 50 * 1024 * 1024;
/// The most cells one link carries, and the longest value.
pub const MAX_LINK_CELLS: u32 = 2000;
const MAX_LINK_VALUE_CHARS: usize = 256;
/// The most rows and columns a sheet can freeze.
pub const MAX_FROZEN: u32 = 20;
/// Row and column sizes, in pixels.
pub const MIN_AXIS_SIZE: u32 = 16;
pub const MAX_AXIS_SIZE: u32 = 1000;
/// How many cell changes one activity entry keeps.
pub const MAX_LOGGED_CHANGES: usize = 50;
/// The longest comment accepted, in characters.
pub const MAX_COMMENT_CHARS: usize = 2000;
/// The longest cell note accepted, in characters.
pub const MAX_NOTE_CHARS: usize = 5000;
/// How much of a note `getNotedCells` returns as its preview.
const NOTE_PREVIEW_CHARS: usize = 200;
/// The most activity entries one `getActivity` returns.
const MAX_ACTIVITY: u32 = 500;
/// Rows read per storage page.
const PAGE: u32 = 1000;

// ---------------------------------------------------------------------------
// Stored values
// ---------------------------------------------------------------------------

/// What a workbook is from the moment it exists: its id and creation time.
#[derive(Clone, Debug, Default, Serialize, Deserialize)]
pub struct Founding {
    pub id: String,
    pub created_at: u64,
}

#[derive(Clone, Debug, Serialize, Deserialize)]
pub struct SheetData {
    pub id: String,
    pub name: String,
    /// Tab ordering hint (lower = further left).
    pub position: u32,
    pub created_at: u64,
    pub updated_at: u64,
}

/// A cell's raw value, keyed `"{sheet_id}|{row_id}|{col_id}"`.
#[derive(Clone, Debug, Serialize, Deserialize)]
pub struct CellData {
    pub id: String,
    pub sheet_id: String,
    pub raw_value: String,
    pub updated_at: u64,
}

#[derive(Clone, Debug, Serialize, Deserialize)]
pub struct MemberData {
    pub nickname: String,
    pub joined_at: u64,
    pub updated_at: u64,
}

/// A protected range: only owners and the listed editors may change its cells.
/// All four corners empty protects the whole sheet.
#[derive(Clone, Debug, Serialize, Deserialize)]
pub struct ProtectionData {
    pub sheet_id: String,
    pub top_row_id: String,
    pub left_col_id: String,
    pub bottom_row_id: String,
    pub right_col_id: String,
    pub description: String,
    /// Member ids allowed to edit it besides owners. Bounded by the
    /// workbook's members (`protectRange` keeps the first 1,000).
    pub editors: Vec<String>,
    pub created_by: String,
    pub updated_at: u64,
}

#[derive(Clone, Debug, Serialize, Deserialize)]
pub struct SizeData {
    pub size: u32,
    pub updated_at: u64,
}

#[derive(Clone, Debug, Serialize, Deserialize)]
pub struct SheetViewData {
    pub frozen_rows: u32,
    pub frozen_cols: u32,
    pub updated_at: u64,
}

/// A cell's style: one value per field (at most the eight style fields).
#[derive(Clone, Debug, Default, Serialize, Deserialize)]
pub struct StyleData {
    pub fields: BTreeMap<String, String>,
}

#[derive(Clone, Debug, Serialize, Deserialize)]
pub struct RuleData {
    pub sheet_id: String,
    pub top_row_id: String,
    pub left_col_id: String,
    pub bottom_row_id: String,
    pub right_col_id: String,
    pub kind: String,
    pub condition: String,
    /// At most 2,000 characters in all (`check_rule`).
    pub args: Vec<String>,
    /// Style fields: at most the eight there are.
    pub style: BTreeMap<String, String>,
    pub strict: bool,
    /// Members an alert tells; each must be a member (`check_rule`).
    pub recipients: Vec<String>,
    pub created_by: String,
    pub updated_at: u64,
}

#[derive(Clone, Debug, Serialize, Deserialize)]
pub struct ChartData {
    pub sheet_id: String,
    pub top_row_id: String,
    pub left_col_id: String,
    pub bottom_row_id: String,
    pub right_col_id: String,
    pub kind: String,
    pub title: String,
    pub created_by: String,
    pub updated_at: u64,
}

/// A file attached to a cell. The bytes are a blob in the node's per-app
/// blob store (uploaded by the client); this is its record.
#[derive(Clone, Debug, Serialize, Deserialize)]
pub struct AttachmentData {
    pub sheet_id: String,
    pub row_id: String,
    pub col_id: String,
    pub blob_id: String,
    pub name: String,
    pub size: u64,
    pub mime: String,
    pub created_by: String,
    pub created_at: u64,
}

/// A range this workbook links to another workbook (the source side).
#[derive(Clone, Debug, Serialize, Deserialize)]
pub struct PublicationData {
    pub sheet_id: String,
    pub top_row_id: String,
    pub left_col_id: String,
    pub bottom_row_id: String,
    pub right_col_id: String,
    /// The receiving workbook (an app instance id).
    pub target_context: String,
    pub name: String,
    pub created_by: String,
}

/// A range pushed here from another workbook (the receiving side), shown as a
/// read-only sheet whose id is the key. Values are row-major, at most
/// [`MAX_LINK_CELLS`] of at most 256 characters.
#[derive(Clone, Debug, Serialize, Deserialize)]
pub struct LinkedData {
    pub source_context: String,
    pub source_name: String,
    pub name: String,
    pub rows: u32,
    pub cols: u32,
    pub values: Vec<String>,
    /// The account that delivered the last push.
    pub pushed_by: String,
    pub created_at: u64,
    /// Removed here: later pushes are ignored.
    pub blocked: bool,
    /// Withdrawn by the source.
    pub deleted: bool,
    pub updated_at: u64,
}

/// The cells of an alert rule that met its condition when last checked.
/// Bounded by the rule's range.
#[derive(Clone, Debug, Serialize, Deserialize)]
pub struct AlertState {
    pub cells: Vec<String>,
    pub updated_at: u64,
}

#[derive(Clone, Debug, Serialize, Deserialize)]
pub struct AxisData {
    /// Fractional position: decimal digits, compared as strings.
    pub pos: String,
    pub deleted: bool,
    pub updated_at: u64,
}

#[derive(Clone, Debug, Serialize, Deserialize)]
pub struct FormatData {
    /// Empty means Automatic.
    pub format: String,
    pub updated_at: u64,
}

/// Keyed by the upper-case name; an empty target means deleted.
#[derive(Clone, Debug, Serialize, Deserialize)]
pub struct NamedRangeData {
    pub name: String,
    pub target: String,
    pub updated_at: u64,
}

#[derive(Clone, Debug, Serialize, Deserialize)]
pub struct CellMeta {
    pub author: String,
    pub at: u64,
}

/// One cell's change within an activity entry.
#[derive(Clone, Debug, PartialEq, Serialize, Deserialize)]
pub struct CellChange {
    pub row_id: String,
    pub col_id: String,
    pub before_raw: String,
    pub before_format: String,
    pub after_raw: String,
    pub after_format: String,
}

#[derive(Clone, Debug, Serialize, Deserialize)]
pub struct ActivityData {
    pub sheet_id: String,
    pub kind: String,
    pub summary: String,
    pub count: u32,
    /// At most [`MAX_LOGGED_CHANGES`].
    pub changes: Vec<CellChange>,
}

#[derive(Clone, Debug, Serialize, Deserialize)]
pub struct CommentData {
    pub sheet_id: String,
    pub row_id: String,
    pub col_id: String,
    pub author: String,
    pub text: String,
    /// Members named with `@nickname`: bounded by the text's length.
    pub mentions: Vec<String>,
    pub parent: String,
    pub created_at: u64,
    pub updated_at: u64,
}

#[derive(Clone, Debug, Serialize, Deserialize)]
pub struct ScratchSheet {
    pub name: String,
    pub position: u32,
    pub created_at: u64,
}

#[derive(Clone, Debug, Serialize, Deserialize)]
pub struct ScratchCell {
    pub raw_value: String,
    pub format: String,
    pub updated_at: u64,
}

// ---------------------------------------------------------------------------
// Arguments and results (v1's field names; u64 as decimal strings)
// ---------------------------------------------------------------------------

#[derive(Clone, Debug, Serialize)]
pub struct Project {
    pub id: String,
    /// Empty until `initProject` runs.
    pub name: String,
    #[serde(with = "calimero_app_sdk::json::u64_str")]
    pub created_at: u64,
}

#[derive(Clone, Debug, Serialize)]
pub struct Member {
    /// The member's account (`whoami`).
    pub id: String,
    pub nickname: String,
    #[serde(with = "calimero_app_sdk::json::u64_str")]
    pub joined_at: u64,
    #[serde(with = "calimero_app_sdk::json::u64_str")]
    pub updated_at: u64,
    /// The same value as `id`.
    pub account: String,
    /// `owner`, `editor`, `commenter` or `viewer`.
    pub role: String,
}

#[derive(Clone, Debug, Serialize, Deserialize)]
pub struct StyleOp {
    pub row_id: String,
    pub col_id: String,
    pub field: String,
    pub value: String,
}

#[derive(Clone, Debug, Serialize)]
pub struct CellStyle {
    pub sheet_id: String,
    pub row_id: String,
    pub col_id: String,
    pub style: BTreeMap<String, String>,
}

#[derive(Clone, Debug, Serialize, Deserialize)]
pub struct RuleInput {
    pub sheet_id: String,
    pub top_row_id: String,
    pub left_col_id: String,
    pub bottom_row_id: String,
    pub right_col_id: String,
    /// `format`, `scale`, `validate` or `alert`.
    pub kind: String,
    pub condition: String,
    pub args: Vec<String>,
    pub style: BTreeMap<String, String>,
    pub strict: bool,
    pub recipients: Vec<String>,
}

#[derive(Clone, Debug, Serialize, Deserialize)]
pub struct ChartInput {
    pub sheet_id: String,
    pub top_row_id: String,
    pub left_col_id: String,
    pub bottom_row_id: String,
    pub right_col_id: String,
    pub kind: String,
    pub title: String,
}

#[derive(Clone, Debug, Serialize)]
pub struct Chart {
    pub id: String,
    pub chart: ChartInput,
    pub created_by: String,
}

#[derive(Clone, Debug, Serialize)]
pub struct Attachment {
    pub id: String,
    pub sheet_id: String,
    pub row_id: String,
    pub col_id: String,
    pub blob_id: String,
    pub name: String,
    #[serde(with = "calimero_app_sdk::json::u64_str")]
    pub size: u64,
    pub mime: String,
    pub created_by: String,
    #[serde(with = "calimero_app_sdk::json::u64_str")]
    pub created_at: u64,
}

#[derive(Clone, Debug, Serialize)]
pub struct Publication {
    pub id: String,
    pub sheet_id: String,
    pub top_row_id: String,
    pub left_col_id: String,
    pub bottom_row_id: String,
    pub right_col_id: String,
    pub target_context: String,
    pub name: String,
    pub created_by: String,
}

/// What a link pushes to its workbook: the client delivers it there with
/// `receiveLink` (core rc.7 has no cross-app call for components).
#[derive(Clone, Debug, Serialize)]
pub struct LinkPush {
    pub publication_id: String,
    pub target_context: String,
    pub name: String,
    pub source_name: String,
    pub rows: u32,
    pub cols: u32,
    pub values: Vec<String>,
}

#[derive(Clone, Debug, Serialize)]
pub struct Link {
    pub id: String,
    pub source_context: String,
    pub source_name: String,
    pub name: String,
    pub rows: u32,
    pub cols: u32,
    #[serde(with = "calimero_app_sdk::json::u64_str")]
    pub updated_at: u64,
}

#[derive(Clone, Debug, Serialize)]
pub struct Rule {
    pub id: String,
    pub rule: RuleInput,
    pub created_by: String,
}

#[derive(Clone, Debug, Serialize, Deserialize)]
pub struct AxisSize {
    /// `row` or `col`.
    pub axis: String,
    pub id: String,
    pub size: u32,
}

#[derive(Clone, Debug, Serialize)]
pub struct SheetView {
    pub sheet_id: String,
    pub frozen_rows: u32,
    pub frozen_cols: u32,
    pub sizes: Vec<AxisSize>,
}

#[derive(Clone, Debug, Serialize)]
pub struct Protection {
    pub id: String,
    pub sheet_id: String,
    pub top_row_id: String,
    pub left_col_id: String,
    pub bottom_row_id: String,
    pub right_col_id: String,
    pub description: String,
    pub editors: Vec<String>,
    pub created_by: String,
}

#[derive(Clone, Debug, Serialize)]
pub struct Sheet {
    pub id: String,
    pub name: String,
    pub position: u32,
    #[serde(with = "calimero_app_sdk::json::u64_str")]
    pub created_at: u64,
    /// For a linked sheet, the name of the workbook it comes from.
    pub linked_from: String,
}

/// A cell, by row and column id.
#[derive(Clone, Debug, Serialize)]
pub struct Cell {
    pub id: String,
    pub sheet_id: String,
    pub row_id: String,
    pub col_id: String,
    pub raw_value: String,
    pub computed_value: String,
    pub format: String,
    #[serde(with = "calimero_app_sdk::json::u64_str")]
    pub updated_at: u64,
    pub last_editor: String,
    #[serde(with = "calimero_app_sdk::json::u64_str")]
    pub last_edited_at: u64,
}

#[derive(Clone, Debug, Serialize)]
pub struct NotedCell {
    pub sheet_id: String,
    pub row_id: String,
    pub col_id: String,
    pub preview: String,
}

#[derive(Clone, Debug, Serialize)]
pub struct Comment {
    pub id: String,
    pub sheet_id: String,
    pub row_id: String,
    pub col_id: String,
    pub author: String,
    pub text: String,
    pub mentions: Vec<String>,
    pub parent: String,
    pub resolved: bool,
    #[serde(with = "calimero_app_sdk::json::u64_str")]
    pub created_at: u64,
    #[serde(with = "calimero_app_sdk::json::u64_str")]
    pub updated_at: u64,
}

#[derive(Clone, Debug, Serialize)]
pub struct ActivityEntry {
    pub id: String,
    pub author: String,
    #[serde(with = "calimero_app_sdk::json::u64_str")]
    pub at: u64,
    pub sheet_id: String,
    pub kind: String,
    pub summary: String,
    pub count: u32,
    pub changes: Vec<CellChange>,
}

/// v1's adjacently tagged `{ name, payload }` form.
#[derive(Clone, Debug, Serialize, Deserialize)]
#[serde(tag = "name", content = "payload")]
pub enum CellOp {
    Set {
        row_id: String,
        col_id: String,
        raw_value: String,
    },
    Format {
        row_id: String,
        col_id: String,
        format: String,
    },
    Clear {
        row_id: String,
        col_id: String,
    },
}

#[derive(Clone, Debug, Serialize, Deserialize)]
#[serde(tag = "name", content = "payload")]
pub enum AxisOp {
    InsertRow { id: String, pos: String },
    InsertCol { id: String, pos: String },
    DeleteRow { id: String },
    DeleteCol { id: String },
    RestoreRow { id: String },
    RestoreCol { id: String },
}

#[derive(Clone, Debug, Serialize)]
pub struct AxisEntryView {
    pub id: String,
    pub pos: String,
    pub deleted: bool,
}

#[derive(Clone, Debug, Serialize)]
pub struct SheetLayout {
    pub sheet_id: String,
    pub rows: Vec<AxisEntryView>,
    pub cols: Vec<AxisEntryView>,
}

#[derive(Clone, Debug, Serialize)]
pub struct NamedRange {
    pub name: String,
    pub target: String,
}

#[derive(Clone, Debug, Serialize)]
pub struct FunctionDef {
    pub name: String,
    pub category: String,
    pub syntax: String,
    pub description: String,
    pub example: String,
}

// ---------------------------------------------------------------------------
// State
// ---------------------------------------------------------------------------

/// The workbook.
#[app::state(version = 1)]
pub struct Spreadsheet {
    /// The workbook's id and creation time, fixed in `init`.
    founding: calimero_app_sdk::Cell<Founding>,
    /// The workbook's name, set once by `initProject`. Owners only.
    project_name: calimero_app_sdk::Cell<String>,
    /// The workbook's owners: the app's owner at `init`, then whoever an
    /// owner makes one.
    owners: Set<String>,
    /// `viewer` or `commenter` by account; anyone else (not an owner) edits.
    roles: UnorderedMap<String, String>,
    sheets: UnorderedMap<String, SheetData>,
    /// Keyed `"{sheet_id}|{row_id}|{col_id}"`, so one sheet is one prefix.
    cells: UnorderedMap<String, CellData>,
    /// Chosen nicknames by account, each written only by its account.
    members: UnorderedMap<String, MemberData>,
    /// Keyed `"{sheet_id}|r|{id}"` / `"{sheet_id}|c|{id}"`.
    axes: UnorderedMap<String, AxisData>,
    formats: UnorderedMap<String, FormatData>,
    names: UnorderedMap<String, NamedRangeData>,
    cell_meta: UnorderedMap<String, CellMeta>,
    /// `(at, author, nonce)`: written once, read newest first.
    activity: UnorderedMap<(u64, String, String), ActivityData>,
    comments: UnorderedMap<String, CommentData>,
    /// Comment ids whose thread is resolved.
    resolved: Set<String>,
    notes: UnorderedMap<String, NoteDoc>,
    protections: UnorderedMap<String, ProtectionData>,
    sizes: UnorderedMap<String, SizeData>,
    views: UnorderedMap<String, SheetViewData>,
    styles: UnorderedMap<String, StyleData>,
    rules: UnorderedMap<String, RuleData>,
    charts: UnorderedMap<String, ChartData>,
    attachments: UnorderedMap<String, AttachmentData>,
    publications: UnorderedMap<String, PublicationData>,
    linked: UnorderedMap<String, LinkedData>,
    alert_state: UnorderedMap<String, AlertState>,
    /// Each account's private sheets, `(account, sheet id)`.
    private_sheets: UnorderedMap<(String, String), ScratchSheet>,
    /// Their cells, `(account, "{sheet}|{row}|{col}")`.
    private_cells: UnorderedMap<(String, String), ScratchCell>,
}

/// A typed failure: `422 APP_ERROR` with `{ code, fields: { message } }`.
#[app::error]
pub enum Error {
    /// No such sheet, cell, comment, member, rule, ….
    NotFound { message: String },
    /// The arguments break a rule of the workbook.
    Invalid { message: String },
    /// The caller's role (or authorship) does not allow it.
    Forbidden { message: String },
}

/// A change, emitted to everyone the workbook reaches.
#[app::event]
pub enum Event {
    ProjectInitialized {
        id: String,
        name: String,
    },
    SheetCreated {
        id: String,
        name: String,
    },
    SheetRenamed {
        id: String,
        name: String,
    },
    SheetDeleted {
        id: String,
    },
    CellUpdated {
        id: String,
        sheet_id: String,
    },
    CellCleared {
        sheet_id: String,
        row_id: String,
        col_id: String,
    },
    CellsChanged {
        sheet_id: String,
        count: u32,
    },
    AxesChanged {
        sheet_id: String,
        count: u32,
    },
    NamedRangesChanged {
        name: String,
    },
    CommentAdded {
        id: String,
        sheet_id: String,
        author: String,
        mentions: Vec<String>,
    },
    CommentChanged {
        id: String,
        sheet_id: String,
    },
    RolesChanged {
        member_id: String,
    },
    ProtectionsChanged {
        sheet_id: String,
    },
    PublicationsChanged {
        sheet_id: String,
    },
    LinkedChanged {
        sheet_id: String,
    },
    AlertTriggered {
        rule_id: String,
        sheet_id: String,
        recipients: Vec<String>,
        message: String,
    },
    AttachmentsChanged {
        sheet_id: String,
    },
    ChartsChanged {
        sheet_id: String,
    },
    StylesChanged {
        sheet_id: String,
    },
    RulesChanged {
        sheet_id: String,
    },
    SheetViewChanged {
        sheet_id: String,
    },
    NoteChanged {
        sheet_id: String,
        row_id: String,
        col_id: String,
    },
    MemberJoined {
        id: String,
        nickname: String,
    },
    MemberRenamed {
        id: String,
        nickname: String,
    },
}

fn not_found(message: impl Into<String>) -> AppError {
    Error::NotFound {
        message: message.into(),
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

/// The shared crate's validation errors as this app's.
fn types_err(e: mero_sheets_types::Error) -> AppError {
    match e {
        mero_sheets_types::Error::NotFound(m) => not_found(m),
        mero_sheets_types::Error::Invalid(m) => invalid(m),
        mero_sheets_types::Error::Forbidden(m) => forbidden(m),
    }
}

fn emit(event: Event) -> app::Result<()> {
    env::emit(event, Audience::All)
}

#[app::logic]
#[allow(clippy::too_many_arguments)]
impl Spreadsheet {
    /// The empty workbook; the app's owner is its first owner.
    #[app::init]
    pub fn init() -> app::Result<Self> {
        let mut s = Self::load();
        let now = now();
        s.founding.set(&Founding {
            id: generate_id("proj", now, &nonce()),
            created_at: now,
        })?;
        let _ = s.owners.insert(&env::app_owner())?;
        Ok(s)
    }

    // ---- Project ----

    /// Name the workbook, once. Owners only. Returns the workbook's id.
    pub fn init_project(&mut self, name: String) -> app::Result<String> {
        self.require_owner("name the workbook")?;
        if !self.project_name.get()?.unwrap_or_default().is_empty() {
            return Err(invalid("project already initialised"));
        }
        validate_label(&name).map_err(types_err)?;
        self.project_name.set(&name)?;
        let id = self.founding()?.id;
        emit(Event::ProjectInitialized {
            id: id.clone(),
            name,
        })?;
        Ok(id)
    }

    /// The project's id, name (empty until `initProject`) and creation time.
    #[app::view]
    pub fn get_project(&self) -> app::Result<Project> {
        let founding = self.founding()?;
        Ok(Project {
            id: founding.id,
            name: self.project_name.get()?.unwrap_or_default(),
            created_at: founding.created_at,
        })
    }

    // ---- Members ----

    /// The caller's account: the id its roster row, comments and cursor carry.
    #[app::view]
    pub fn whoami(&self) -> app::Result<String> {
        me()
    }

    /// Announce the caller under a nickname, or rename it. Idempotent;
    /// `joined_at` is kept across calls.
    pub fn join(&mut self, nickname: String) -> app::Result<()> {
        let nickname = nickname.trim().to_string();
        validate_label(&nickname).map_err(types_err)?;
        let me = me()?;
        let now = now();
        let existing = self.members.get(&me)?;
        let joined_at = existing.as_ref().map_or(now, |m| m.joined_at);
        let _ = self.members.insert(
            &me,
            &MemberData {
                nickname: nickname.clone(),
                joined_at,
                updated_at: now,
            },
        )?;
        emit(if existing.is_none() {
            Event::MemberJoined { id: me, nickname }
        } else {
            Event::MemberRenamed { id: me, nickname }
        })
    }

    /// Everyone who has announced themselves, oldest arrival first.
    #[app::view]
    pub fn get_members(&self) -> app::Result<Vec<Member>> {
        let mut members = Vec::new();
        for (id, d) in all(|o| self.members.page(o))? {
            members.push(Member {
                account: id.clone(),
                role: self.role_of(&id)?.as_str().into(),
                id,
                nickname: d.nickname,
                joined_at: d.joined_at,
                updated_at: d.updated_at,
            });
        }
        members.sort_by(|a, b| a.joined_at.cmp(&b.joined_at).then(a.id.cmp(&b.id)));
        Ok(members)
    }

    // ---- Sheets ----

    /// Add a sheet; a taken name gets ` (2)`, ` (3)`, …. Editors. Returns its id.
    pub fn create_sheet(&mut self, name: String) -> app::Result<String> {
        self.require_role(Role::Editor)?;
        validate_sheet_name(&name).map_err(types_err)?;
        let name = self.unique_sheet_name(&name, None)?;
        let now = now();
        let id = generate_id("sheet", now, &nonce());
        let position = u32::try_from(self.sheets.len()?).unwrap_or(u32::MAX);
        let _ = self.sheets.insert(
            &id,
            &SheetData {
                id: id.clone(),
                name: name.clone(),
                position,
                created_at: now,
                updated_at: now,
            },
        )?;
        self.log(&id, "sheet", format!("added sheet {name}"), 0, Vec::new())?;
        emit(Event::SheetCreated {
            id: id.clone(),
            name,
        })?;
        Ok(id)
    }

    /// Rename a sheet; a name another sheet has is refused.
    pub fn rename_sheet(&mut self, sheet_id: String, new_name: String) -> app::Result<()> {
        self.require_sheet_writable(&sheet_id)?;
        validate_sheet_name(&new_name).map_err(types_err)?;
        let collides = all(|o| self.sheets.page(o))?
            .into_iter()
            .any(|(id, d)| id != sheet_id && d.name == new_name);
        if collides {
            return Err(invalid(format!(
                "a sheet named '{new_name}' already exists"
            )));
        }
        let mut sheet = self
            .sheets
            .get(&sheet_id)?
            .ok_or_else(|| not_found(sheet_id.clone()))?;
        sheet.name = new_name.clone();
        sheet.updated_at = now();
        let _ = self.sheets.insert(&sheet_id, &sheet)?;
        self.log(
            &sheet_id,
            "sheet",
            format!("renamed a sheet to {new_name}"),
            0,
            Vec::new(),
        )?;
        emit(Event::SheetRenamed {
            id: sheet_id,
            name: new_name,
        })
    }

    /// Delete a sheet. Its cells stay stored and are never read again.
    pub fn delete_sheet(&mut self, sheet_id: String) -> app::Result<()> {
        self.require_sheet_writable(&sheet_id)?;
        let Some(removed) = self.sheets.remove(&sheet_id)? else {
            return Err(not_found(sheet_id));
        };
        self.log(
            &sheet_id,
            "sheet",
            format!("deleted sheet {}", removed.name),
            0,
            Vec::new(),
        )?;
        emit(Event::SheetDeleted { id: sheet_id })
    }

    /// The workbook's sheets in tab order, then the linked ones.
    #[app::view]
    pub fn list_sheets(&self) -> app::Result<Vec<Sheet>> {
        let mut out: Vec<Sheet> = all(|o| self.sheets.page(o))?
            .into_iter()
            .map(|(_, d)| Sheet {
                id: d.id,
                name: d.name,
                position: d.position,
                created_at: d.created_at,
                linked_from: String::new(),
            })
            .collect();
        out.sort_by_key(|s| (s.position, s.created_at));
        let base = u32::try_from(out.len()).unwrap_or(u32::MAX);
        let mut linked: Vec<Sheet> = self
            .live_links()?
            .into_iter()
            .map(|(id, l)| Sheet {
                id,
                name: l.name,
                position: 0,
                created_at: l.created_at,
                linked_from: l.source_name,
            })
            .collect();
        linked.sort_by(|a, b| (a.created_at, &a.id).cmp(&(b.created_at, &b.id)));
        for (i, s) in linked.iter_mut().enumerate() {
            s.position = base.saturating_add(u32::try_from(i).unwrap_or(u32::MAX));
        }
        out.extend(linked);
        Ok(out)
    }

    // ---- Cells ----

    /// Set a cell's raw value (a literal or a formula). Returns the cell's key.
    pub fn set_cell(
        &mut self,
        sheet_id: String,
        row_id: String,
        col_id: String,
        raw_value: String,
    ) -> app::Result<String> {
        let key = cell_key(&sheet_id, &row_id, &col_id);
        self.edit_cells(
            &sheet_id,
            vec![CellOp::Set {
                row_id,
                col_id,
                raw_value,
            }],
        )?;
        emit(Event::CellUpdated {
            id: key.clone(),
            sheet_id,
        })?;
        Ok(key)
    }

    /// Set only a cell's display format ("" = Automatic), keeping its value.
    pub fn set_cell_format(
        &mut self,
        sheet_id: String,
        row_id: String,
        col_id: String,
        format: String,
    ) -> app::Result<String> {
        let key = cell_key(&sheet_id, &row_id, &col_id);
        self.edit_cells(
            &sheet_id,
            vec![CellOp::Format {
                row_id,
                col_id,
                format,
            }],
        )?;
        emit(Event::CellUpdated {
            id: key.clone(),
            sheet_id,
        })?;
        Ok(key)
    }

    /// Blank a cell's value and format.
    pub fn clear_cell(
        &mut self,
        sheet_id: String,
        row_id: String,
        col_id: String,
    ) -> app::Result<()> {
        self.edit_cells(
            &sheet_id,
            vec![CellOp::Clear {
                row_id: row_id.clone(),
                col_id: col_id.clone(),
            }],
        )?;
        emit(Event::CellCleared {
            sheet_id,
            row_id,
            col_id,
        })
    }

    /// Apply up to [`MAX_OPS_PER_APPLY`] cell ops to one sheet in one call,
    /// with one `CellsChanged` event.
    pub fn apply_cell_ops(&mut self, sheet_id: String, ops: Vec<CellOp>) -> app::Result<()> {
        if ops.len() > MAX_OPS_PER_APPLY {
            return Err(invalid(format!(
                "{} cell ops in one apply_cell_ops; the limit is {MAX_OPS_PER_APPLY}, split the batch",
                ops.len()
            )));
        }
        let count = u32::try_from(ops.len()).unwrap_or(u32::MAX);
        self.edit_cells(&sheet_id, ops)?;
        emit(Event::CellsChanged { sheet_id, count })
    }

    /// Activity since `since` (nanoseconds), newest first, at most `limit`
    /// (capped at 500) entries.
    #[app::view]
    pub fn get_activity(&self, since: u64, limit: u32) -> app::Result<Vec<ActivityEntry>> {
        let limit = limit.min(MAX_ACTIVITY);
        if limit == 0 {
            return Ok(Vec::new());
        }
        let page = self.activity.page(
            FindOpts::default()
                .from(vec![since.to_key_part()])
                .reverse()
                .limit(limit),
        )?;
        Ok(page
            .items
            .into_iter()
            .map(|((at, author, nonce), d)| ActivityEntry {
                id: format!("{at:020}|{author}|{nonce}"),
                author,
                at,
                sheet_id: d.sheet_id,
                kind: d.kind,
                summary: d.summary,
                count: d.count,
                changes: d.changes,
            })
            .collect())
    }

    // ---- Comments ----

    /// Comment on a cell, or reply to a comment (`parent`). Commenters and up.
    /// `@nickname` mentions a member. Returns the comment id.
    pub fn add_comment(
        &mut self,
        sheet_id: String,
        row_id: String,
        col_id: String,
        text: String,
        parent: String,
    ) -> app::Result<String> {
        self.require_role(Role::Commenter)?;
        self.require_sheet(&sheet_id)?;
        check_id(&row_id)?;
        check_id(&col_id)?;
        let text = check_comment(text)?;
        if !parent.is_empty() && !self.comments.contains(&parent)? {
            return Err(not_found(parent));
        }
        let author = me()?;
        let now = now();
        let id = generate_id("comment", now, &nonce());
        let mentions = self.mentions_in(&text)?;
        let _ = self.comments.insert(
            &id,
            &CommentData {
                sheet_id: sheet_id.clone(),
                row_id,
                col_id,
                author: author.clone(),
                text,
                mentions: mentions.clone(),
                parent: parent.clone(),
                created_at: now,
                updated_at: now,
            },
        )?;
        let summary = if parent.is_empty() {
            "commented"
        } else {
            "replied to a comment"
        };
        self.log(&sheet_id, "comment", summary.to_string(), 0, Vec::new())?;
        emit(Event::CommentAdded {
            id: id.clone(),
            sheet_id,
            author,
            mentions,
        })?;
        Ok(id)
    }

    /// Change a comment's text. Only its author may.
    pub fn edit_comment(&mut self, id: String, text: String) -> app::Result<()> {
        let text = check_comment(text)?;
        let mentions = self.mentions_in(&text)?;
        let mut c = self
            .comments
            .get(&id)?
            .ok_or_else(|| not_found(id.clone()))?;
        if c.author != me()? {
            return Err(forbidden("only its author can change a comment"));
        }
        c.text = text;
        c.mentions = mentions;
        c.updated_at = now();
        let _ = self.comments.insert(&id, &c)?;
        emit(Event::CommentChanged {
            id,
            sheet_id: c.sheet_id,
        })
    }

    /// Resolve or reopen a comment thread. Commenters and up.
    pub fn set_comment_resolved(&mut self, id: String, resolved: bool) -> app::Result<()> {
        self.require_role(Role::Commenter)?;
        let c = self
            .comments
            .get(&id)?
            .ok_or_else(|| not_found(id.clone()))?;
        let _ = if resolved {
            self.resolved.insert(&id)?
        } else {
            self.resolved.remove(&id)?
        };
        emit(Event::CommentChanged {
            id,
            sheet_id: c.sheet_id,
        })
    }

    /// Delete a comment. Its author or an owner may.
    pub fn delete_comment(&mut self, id: String) -> app::Result<()> {
        let c = self
            .comments
            .get(&id)?
            .ok_or_else(|| not_found(id.clone()))?;
        let me = me()?;
        if c.author != me && !self.owners.contains(&me)? {
            return Err(forbidden(
                "only its author or an owner can delete a comment",
            ));
        }
        let _ = self.comments.remove(&id)?;
        let _ = self.resolved.remove(&id)?;
        emit(Event::CommentChanged {
            id,
            sheet_id: c.sheet_id,
        })
    }

    /// Every comment, oldest first.
    #[app::view]
    pub fn get_comments(&self) -> app::Result<Vec<Comment>> {
        let mut out = Vec::new();
        for (id, c) in all(|o| self.comments.page(o))? {
            out.push(Comment {
                resolved: self.resolved.contains(&id)?,
                id,
                sheet_id: c.sheet_id,
                row_id: c.row_id,
                col_id: c.col_id,
                author: c.author,
                text: c.text,
                mentions: c.mentions,
                parent: c.parent,
                created_at: c.created_at,
                updated_at: c.updated_at,
            });
        }
        out.sort_by(|a, b| (a.created_at, &a.id).cmp(&(b.created_at, &b.id)));
        Ok(out)
    }

    // ---- Notes ----

    /// Edit a cell's note with one Quill-shaped delta (text and formatting).
    /// Formats: `bold`, `italic`, `underline`, `strike`, `code`, `highlight`,
    /// `link`. At most [`MAX_NOTE_CHARS`] characters.
    pub fn edit_note(
        &mut self,
        sheet_id: String,
        row_id: String,
        col_id: String,
        ops: Vec<NoteChange>,
    ) -> app::Result<()> {
        self.require_sheet(&sheet_id)?;
        check_id(&row_id)?;
        check_id(&col_id)?;
        self.require_cells_writable(&sheet_id, [(row_id.as_str(), col_id.as_str())])?;
        let key = cell_key(&sheet_id, &row_id, &col_id);
        let mut note = self.notes.get(&key)?.unwrap_or_default();
        let (added, removed) = ops.iter().fold((0usize, 0usize), |(a, r), op| match op {
            NoteChange::Insert { insert, .. } => (a + insert.chars().count(), r),
            NoteChange::Delete { delete } => (a, r.saturating_add(*delete)),
            NoteChange::Retain { .. } => (a, r),
        });
        if (note.len() + added).saturating_sub(removed) > MAX_NOTE_CHARS {
            return Err(invalid(format!(
                "a note is at most {MAX_NOTE_CHARS} characters"
            )));
        }
        note.apply(&ops)
            .map_err(|e| invalid(format!("note edit: {e}")))?;
        if note.runs.is_empty() {
            let _ = self.notes.remove(&key)?;
        } else {
            let _ = self.notes.insert(&key, &note)?;
        }
        emit(Event::NoteChanged {
            sheet_id,
            row_id,
            col_id,
        })
    }

    /// A cell's note as formatted runs; empty when it has none.
    #[app::view]
    pub fn get_note(
        &self,
        sheet_id: String,
        row_id: String,
        col_id: String,
    ) -> app::Result<Vec<Span>> {
        Ok(self
            .notes
            .get(&cell_key(&sheet_id, &row_id, &col_id))?
            .map(|n| n.runs)
            .unwrap_or_default())
    }

    /// Every cell with a non-empty note, with the start of its text.
    #[app::view]
    pub fn get_noted_cells(&self) -> app::Result<Vec<NotedCell>> {
        let mut out = Vec::new();
        for (key, note) in all(|o| self.notes.page(o))? {
            let text = note.text();
            let Some((sheet_id, row_id, col_id)) = split_key(&key) else {
                continue;
            };
            if text.trim().is_empty() {
                continue;
            }
            out.push(NotedCell {
                sheet_id: sheet_id.to_string(),
                row_id: row_id.to_string(),
                col_id: col_id.to_string(),
                preview: text.chars().take(NOTE_PREVIEW_CHARS).collect(),
            });
        }
        Ok(out)
    }

    // ---- Roles and protected ranges ----

    /// Set a member's workbook role: `owner`, `editor`, `commenter` or
    /// `viewer`. Owners only; the last owner stays one.
    pub fn set_role(&mut self, member_id: String, role: String) -> app::Result<()> {
        let Some(new_role) = Role::parse(&role) else {
            return Err(invalid(format!(
                "{role:?} is not a role: owner, editor, commenter or viewer"
            )));
        };
        self.require_owner("change roles")?;
        let Some(member) = self.members.get(&member_id)? else {
            return Err(not_found(member_id));
        };
        let was_owner = self.owners.contains(&member_id)?;
        if was_owner && new_role != Role::Owner && self.owners.len()? == 1 {
            return Err(invalid(
                "a workbook keeps at least one owner: make someone else an owner first",
            ));
        }
        match new_role {
            Role::Viewer | Role::Commenter => {
                let _ = self
                    .roles
                    .insert(&member_id, &new_role.as_str().to_string())?;
            }
            Role::Editor | Role::Owner => {
                let _ = self.roles.remove(&member_id)?;
            }
        }
        let _ = if new_role == Role::Owner {
            self.owners.insert(&member_id)?
        } else {
            self.owners.remove(&member_id)?
        };
        self.log(
            "",
            "role",
            format!(
                "made {} {} {}",
                member.nickname,
                article(new_role),
                new_role.as_str()
            ),
            0,
            Vec::new(),
        )?;
        emit(Event::RolesChanged { member_id })
    }

    /// Protect a range (corner row and column ids; all four empty for the
    /// whole sheet): only owners and `editors` may then change its cells.
    /// Owners only. Returns the protection id.
    pub fn protect_range(
        &mut self,
        sheet_id: String,
        top_row_id: String,
        left_col_id: String,
        bottom_row_id: String,
        right_col_id: String,
        description: String,
        editors: Vec<String>,
    ) -> app::Result<String> {
        self.require_owner("manage protected ranges")?;
        self.require_sheet(&sheet_id)?;
        let corners = [&top_row_id, &left_col_id, &bottom_row_id, &right_col_id];
        if !corners.iter().all(|c| c.is_empty()) {
            for c in corners {
                check_id(c)?;
            }
        }
        let description = check_description(description)?;
        let editors = check_editors(editors)?;
        let now = now();
        let id = generate_id("prot", now, &nonce());
        let _ = self.protections.insert(
            &id,
            &ProtectionData {
                sheet_id: sheet_id.clone(),
                top_row_id,
                left_col_id,
                bottom_row_id,
                right_col_id,
                description,
                editors,
                created_by: me()?,
                updated_at: now,
            },
        )?;
        self.log(
            &sheet_id,
            "protect",
            "protected a range".into(),
            0,
            Vec::new(),
        )?;
        emit(Event::ProtectionsChanged { sheet_id })?;
        Ok(id)
    }

    /// Change who may edit a protected range, and its description. Owners only.
    pub fn update_protection(
        &mut self,
        id: String,
        description: String,
        editors: Vec<String>,
    ) -> app::Result<()> {
        self.require_owner("manage protected ranges")?;
        let description = check_description(description)?;
        let editors = check_editors(editors)?;
        let mut p = self
            .protections
            .get(&id)?
            .ok_or_else(|| not_found(id.clone()))?;
        p.description = description;
        p.editors = editors;
        p.updated_at = now();
        let _ = self.protections.insert(&id, &p)?;
        self.log(
            &p.sheet_id,
            "protect",
            "changed a protected range".into(),
            0,
            Vec::new(),
        )?;
        emit(Event::ProtectionsChanged {
            sheet_id: p.sheet_id,
        })
    }

    /// Remove a protection. Owners only.
    pub fn remove_protection(&mut self, id: String) -> app::Result<()> {
        self.require_owner("manage protected ranges")?;
        let Some(p) = self.protections.remove(&id)? else {
            return Err(not_found(id));
        };
        self.log(
            &p.sheet_id,
            "protect",
            "removed a protected range".into(),
            0,
            Vec::new(),
        )?;
        emit(Event::ProtectionsChanged {
            sheet_id: p.sheet_id,
        })
    }

    /// Every protected range.
    #[app::view]
    pub fn get_protections(&self) -> app::Result<Vec<Protection>> {
        Ok(all(|o| self.protections.page(o))?
            .into_iter()
            .map(|(id, p)| Protection {
                id,
                sheet_id: p.sheet_id,
                top_row_id: p.top_row_id,
                left_col_id: p.left_col_id,
                bottom_row_id: p.bottom_row_id,
                right_col_id: p.right_col_id,
                description: p.description,
                editors: p.editors,
                created_by: p.created_by,
            })
            .collect())
    }

    // ---- Styles and rules ----

    /// Change cells' styles: bold, italic, underline, strike, wrap (`1`),
    /// color and fill (`#rrggbb`), align (`left`, `center`, `right`); an
    /// empty value clears the field.
    pub fn apply_style_ops(&mut self, sheet_id: String, ops: Vec<StyleOp>) -> app::Result<()> {
        if ops.len() > MAX_OPS_PER_APPLY {
            return Err(invalid(format!(
                "{} style ops in one call; the limit is {MAX_OPS_PER_APPLY}",
                ops.len()
            )));
        }
        self.require_sheet(&sheet_id)?;
        for op in &ops {
            check_id(&op.row_id)?;
            check_id(&op.col_id)?;
            check_style_field(&op.field, &op.value)?;
        }
        self.require_cells_writable(
            &sheet_id,
            ops.iter().map(|o| (o.row_id.as_str(), o.col_id.as_str())),
        )?;
        let mut by_cell: BTreeMap<String, Vec<StyleOp>> = BTreeMap::new();
        for op in ops {
            by_cell
                .entry(cell_key(&sheet_id, &op.row_id, &op.col_id))
                .or_default()
                .push(op);
        }
        let count = u32::try_from(by_cell.len()).unwrap_or(u32::MAX);
        for (key, cell_ops) in by_cell {
            let mut style = self.styles.get(&key)?.unwrap_or_default();
            for op in cell_ops {
                if op.value.is_empty() {
                    let _ = style.fields.remove(&op.field);
                } else {
                    let _ = style.fields.insert(op.field, op.value);
                }
            }
            let _ = if style.fields.is_empty() {
                self.styles.remove(&key)?
            } else {
                self.styles.insert(&key, &style)?
            };
        }
        self.log(
            &sheet_id,
            "style",
            format!(
                "formatted {count} cell{}",
                if count == 1 { "" } else { "s" }
            ),
            count,
            Vec::new(),
        )?;
        emit(Event::StylesChanged { sheet_id })
    }

    /// Every styled cell, with its set fields.
    #[app::view]
    pub fn get_styles(&self) -> app::Result<Vec<CellStyle>> {
        Ok(all(|o| self.styles.page(o))?
            .into_iter()
            .filter_map(|(key, s)| {
                let (sheet_id, row_id, col_id) = split_key(&key)?;
                (!s.fields.is_empty()).then(|| CellStyle {
                    sheet_id: sheet_id.to_string(),
                    row_id: row_id.to_string(),
                    col_id: col_id.to_string(),
                    style: s.fields,
                })
            })
            .collect())
    }

    /// Add a conditional format, colour scale, validation or alert. Editors.
    pub fn add_rule(&mut self, rule: RuleInput) -> app::Result<String> {
        self.require_role(Role::Editor)?;
        self.check_rule(&rule)?;
        let now = now();
        let id = generate_id("rule", now, &nonce());
        let sheet_id = rule.sheet_id.clone();
        self.put_rule(&id, rule, now)?;
        self.log(&sheet_id, "rule", "added a rule".into(), 0, Vec::new())?;
        emit(Event::RulesChanged { sheet_id })?;
        Ok(id)
    }

    /// Replace a rule. Editors.
    pub fn update_rule(&mut self, id: String, rule: RuleInput) -> app::Result<()> {
        self.require_role(Role::Editor)?;
        self.check_rule(&rule)?;
        let _ = self.live_rule(&id)?;
        let sheet_id = rule.sheet_id.clone();
        self.put_rule(&id, rule, now())?;
        self.log(&sheet_id, "rule", "changed a rule".into(), 0, Vec::new())?;
        emit(Event::RulesChanged { sheet_id })
    }

    /// Remove a rule. Editors.
    pub fn remove_rule(&mut self, id: String) -> app::Result<()> {
        self.require_role(Role::Editor)?;
        let rule = self.live_rule(&id)?;
        let _ = self.rules.remove(&id)?;
        let _ = self.alert_state.remove(&id)?;
        self.log(
            &rule.sheet_id,
            "rule",
            "removed a rule".into(),
            0,
            Vec::new(),
        )?;
        emit(Event::RulesChanged {
            sheet_id: rule.sheet_id,
        })
    }

    /// Every rule.
    #[app::view]
    pub fn get_rules(&self) -> app::Result<Vec<Rule>> {
        Ok(all(|o| self.rules.page(o))?
            .into_iter()
            .map(|(id, r)| Rule {
                id,
                created_by: r.created_by,
                rule: RuleInput {
                    sheet_id: r.sheet_id,
                    top_row_id: r.top_row_id,
                    left_col_id: r.left_col_id,
                    bottom_row_id: r.bottom_row_id,
                    right_col_id: r.right_col_id,
                    kind: r.kind,
                    condition: r.condition,
                    args: r.args,
                    style: r.style,
                    strict: r.strict,
                    recipients: r.recipients,
                },
            })
            .collect())
    }

    // ---- Linked workbooks ----
    //
    // v1 pushed a range's values to another workbook with a cross-context
    // call the node ran after the commit. Core 1.0.0-rc.7 has no cross-app
    // call for components, so the client delivers: it reads `pushPublication`
    // here and calls `receiveLink` on the target workbook, as itself.

    /// Link a range to another workbook (its app instance id), where it shows
    /// as a read-only sheet called `name`. Editors. Returns the link's id.
    pub fn publish_range(
        &mut self,
        sheet_id: String,
        top_row_id: String,
        left_col_id: String,
        bottom_row_id: String,
        right_col_id: String,
        target_context: String,
        name: String,
    ) -> app::Result<String> {
        self.require_role(Role::Editor)?;
        self.require_sheet(&sheet_id)?;
        for c in [&top_row_id, &left_col_id, &bottom_row_id, &right_col_id] {
            check_id(c)?;
        }
        check_workbook_id(&target_context)?;
        if target_context == env::app_id() {
            return Err(invalid("a workbook cannot link to itself"));
        }
        validate_sheet_name(&name).map_err(types_err)?;
        let id = generate_id("pub", now(), &nonce());
        let publication = PublicationData {
            sheet_id: sheet_id.clone(),
            top_row_id,
            left_col_id,
            bottom_row_id,
            right_col_id,
            target_context,
            name: name.clone(),
            created_by: me()?,
        };
        // Refuses a range whose rows are gone or that is too large, as v1's
        // first push did.
        let _ = self.link_push(&id, &publication)?;
        let _ = self.publications.insert(&id, &publication)?;
        self.log(
            &sheet_id,
            "link",
            format!("linked a range as {name:?}"),
            0,
            Vec::new(),
        )?;
        emit(Event::PublicationsChanged { sheet_id })?;
        Ok(id)
    }

    /// A link's current values, for the client to deliver to its workbook
    /// with `receiveLink`. Editors.
    #[app::view]
    pub fn push_publication(&self, id: String) -> app::Result<LinkPush> {
        self.require_role(Role::Editor)?;
        let p = self.live_publication(&id)?;
        self.link_push(&id, &p)
    }

    /// Stop a link. Whoever linked it, or an owner, may. The client removes
    /// its sheet from the other workbook with `dropLink`.
    pub fn unpublish(&mut self, id: String) -> app::Result<()> {
        self.require_role(Role::Editor)?;
        let p = self.live_publication(&id)?;
        let me = me()?;
        if p.created_by != me && !self.owners.contains(&me)? {
            return Err(forbidden(
                "only whoever linked a range, or an owner, can stop the link",
            ));
        }
        let _ = self.publications.remove(&id)?;
        emit(Event::PublicationsChanged {
            sheet_id: p.sheet_id,
        })
    }

    /// Every live link from this workbook: those whose maker may still edit.
    #[app::view]
    pub fn get_publications(&self) -> app::Result<Vec<Publication>> {
        let mut out = Vec::new();
        for (id, p) in all(|o| self.publications.page(o))? {
            if self.role_of(&p.created_by)? < Role::Editor {
                continue;
            }
            out.push(Publication {
                id,
                sheet_id: p.sheet_id,
                top_row_id: p.top_row_id,
                left_col_id: p.left_col_id,
                bottom_row_id: p.bottom_row_id,
                right_col_id: p.right_col_id,
                target_context: p.target_context,
                name: p.name,
                created_by: p.created_by,
            });
        }
        Ok(out)
    }

    /// Receive a linked range from another workbook (`fromContext`, its app
    /// instance id). Editors of this workbook: the person relaying it.
    pub fn receive_link(
        &mut self,
        from_context: String,
        publication_id: String,
        name: String,
        source_name: String,
        rows: u32,
        cols: u32,
        values: Vec<String>,
    ) -> app::Result<()> {
        self.require_role(Role::Editor)?;
        check_workbook_id(&from_context)?;
        check_publication_id(&publication_id)?;
        if from_context == env::app_id() {
            return Err(invalid("a workbook cannot link to itself"));
        }
        if rows.saturating_mul(cols) > MAX_LINK_CELLS
            || values.len() != (rows.saturating_mul(cols)) as usize
        {
            return Err(invalid("a link's values do not match its size"));
        }
        validate_sheet_name(&name).map_err(types_err)?;
        let id = link_id(&from_context, &publication_id);
        let existing = self.linked.get(&id)?;
        if existing.as_ref().is_some_and(|l| l.blocked) {
            return Ok(());
        }
        let now = now();
        let _ = self.linked.insert(
            &id,
            &LinkedData {
                source_context: from_context,
                source_name: source_name.chars().take(100).collect(),
                name,
                rows,
                cols,
                values: values.iter().map(|v| link_value(v)).collect(),
                pushed_by: me()?,
                created_at: existing.map_or(now, |l| l.created_at),
                blocked: false,
                deleted: false,
                updated_at: now,
            },
        )?;
        emit(Event::LinkedChanged { sheet_id: id })
    }

    /// The source withdrew a link: remove its sheet. Editors.
    pub fn drop_link(&mut self, from_context: String, publication_id: String) -> app::Result<()> {
        self.require_role(Role::Editor)?;
        check_workbook_id(&from_context)?;
        check_publication_id(&publication_id)?;
        let id = link_id(&from_context, &publication_id);
        if let Some(mut l) = self.linked.get(&id)? {
            l.deleted = true;
            l.updated_at = now();
            let _ = self.linked.insert(&id, &l)?;
            emit(Event::LinkedChanged { sheet_id: id })?;
        }
        Ok(())
    }

    /// Remove a linked sheet here; later pushes of it are ignored. Editors.
    pub fn unlink(&mut self, id: String) -> app::Result<()> {
        self.require_role(Role::Editor)?;
        let Some(mut l) = self.linked.get(&id)? else {
            return Err(not_found(id));
        };
        l.blocked = true;
        l.updated_at = now();
        let _ = self.linked.insert(&id, &l)?;
        emit(Event::LinkedChanged { sheet_id: id })
    }

    /// Every live link into this workbook.
    #[app::view]
    pub fn get_links(&self) -> app::Result<Vec<Link>> {
        Ok(self
            .live_links()?
            .into_iter()
            .map(|(id, l)| Link {
                id,
                source_context: l.source_context,
                source_name: l.source_name,
                name: l.name,
                rows: l.rows,
                cols: l.cols,
                updated_at: l.updated_at,
            })
            .collect())
    }

    // ---- Attachments ----

    /// Record a file attached to a cell. Upload the bytes to the app's blob
    /// store first; this stores what the cell shows. Returns its id.
    pub fn add_attachment(
        &mut self,
        sheet_id: String,
        row_id: String,
        col_id: String,
        blob_id: String,
        name: String,
        size: u64,
        mime: String,
    ) -> app::Result<String> {
        self.require_sheet(&sheet_id)?;
        check_id(&row_id)?;
        check_id(&col_id)?;
        self.require_cells_writable(&sheet_id, [(row_id.as_str(), col_id.as_str())])?;
        if blob_id.is_empty()
            || blob_id.len() > 128
            || !blob_id
                .bytes()
                .all(|b| b.is_ascii_alphanumeric() || b == b'-' || b == b'_')
        {
            return Err(invalid(format!("{blob_id:?} is not a blob id")));
        }
        let name = name.trim().to_string();
        if name.is_empty() || name.chars().count() > 200 {
            return Err(invalid("a file name is 1 to 200 characters"));
        }
        if size > MAX_ATTACHMENT_BYTES {
            return Err(invalid(format!(
                "an attachment is at most {} MB",
                MAX_ATTACHMENT_BYTES / 1024 / 1024
            )));
        }
        if mime.len() > 100 {
            return Err(invalid("a media type is at most 100 characters"));
        }
        let now = now();
        let id = generate_id("file", now, &nonce());
        let _ = self.attachments.insert(
            &id,
            &AttachmentData {
                sheet_id: sheet_id.clone(),
                row_id,
                col_id,
                blob_id,
                name: name.clone(),
                size,
                mime,
                created_by: me()?,
                created_at: now,
            },
        )?;
        self.log(&sheet_id, "file", format!("attached {name}"), 0, Vec::new())?;
        emit(Event::AttachmentsChanged { sheet_id })?;
        Ok(id)
    }

    /// Remove an attachment. Whoever attached it, or an owner, may.
    pub fn remove_attachment(&mut self, id: String) -> app::Result<()> {
        let Some(a) = self.attachments.get(&id)? else {
            return Err(not_found(id));
        };
        self.require_role(Role::Editor)?;
        let me = me()?;
        if a.created_by != me && !self.owners.contains(&me)? {
            return Err(forbidden(
                "only whoever attached a file, or an owner, can remove it",
            ));
        }
        let _ = self.attachments.remove(&id)?;
        self.log(
            &a.sheet_id,
            "file",
            format!("removed {}", a.name),
            0,
            Vec::new(),
        )?;
        emit(Event::AttachmentsChanged {
            sheet_id: a.sheet_id,
        })
    }

    /// Every attachment, oldest first.
    #[app::view]
    pub fn get_attachments(&self) -> app::Result<Vec<Attachment>> {
        let mut out: Vec<Attachment> = all(|o| self.attachments.page(o))?
            .into_iter()
            .map(|(id, a)| Attachment {
                id,
                sheet_id: a.sheet_id,
                row_id: a.row_id,
                col_id: a.col_id,
                blob_id: a.blob_id,
                name: a.name,
                size: a.size,
                mime: a.mime,
                created_by: a.created_by,
                created_at: a.created_at,
            })
            .collect();
        out.sort_by(|a, b| (a.created_at, &a.id).cmp(&(b.created_at, &b.id)));
        Ok(out)
    }

    // ---- Charts ----

    /// Chart a range. Editors. Returns the chart's id.
    pub fn add_chart(&mut self, chart: ChartInput) -> app::Result<String> {
        self.require_role(Role::Editor)?;
        self.check_chart(&chart)?;
        let now = now();
        let id = generate_id("chart", now, &nonce());
        self.put_chart(&id, chart, now)?;
        Ok(id)
    }

    /// Replace a chart's range, kind or title. Editors.
    pub fn update_chart(&mut self, id: String, chart: ChartInput) -> app::Result<()> {
        self.require_role(Role::Editor)?;
        self.check_chart(&chart)?;
        let _ = self.live_chart(&id)?;
        self.put_chart(&id, chart, now())
    }

    /// Remove a chart. Editors.
    pub fn remove_chart(&mut self, id: String) -> app::Result<()> {
        self.require_role(Role::Editor)?;
        let chart = self.live_chart(&id)?;
        let _ = self.charts.remove(&id)?;
        emit(Event::ChartsChanged {
            sheet_id: chart.sheet_id,
        })
    }

    /// Every chart.
    #[app::view]
    pub fn get_charts(&self) -> app::Result<Vec<Chart>> {
        Ok(all(|o| self.charts.page(o))?
            .into_iter()
            .map(|(id, c)| Chart {
                id,
                created_by: c.created_by,
                chart: ChartInput {
                    sheet_id: c.sheet_id,
                    top_row_id: c.top_row_id,
                    left_col_id: c.left_col_id,
                    bottom_row_id: c.bottom_row_id,
                    right_col_id: c.right_col_id,
                    kind: c.kind,
                    title: c.title,
                },
            })
            .collect())
    }

    // ---- Sheet view: sizes and frozen panes ----

    /// Resize rows and columns (`axis` `row` or `col`, size in pixels). Editors.
    pub fn set_sizes(&mut self, sheet_id: String, sizes: Vec<AxisSize>) -> app::Result<()> {
        self.require_role(Role::Editor)?;
        self.require_sheet(&sheet_id)?;
        if sizes.len() > MAX_OPS_PER_APPLY {
            return Err(invalid(format!(
                "{} sizes in one call; the limit is {MAX_OPS_PER_APPLY}",
                sizes.len()
            )));
        }
        let now = now();
        for s in sizes {
            let axis = match s.axis.as_str() {
                "row" => 'r',
                "col" => 'c',
                other => return Err(invalid(format!("axis is row or col, got {other:?}"))),
            };
            check_id(&s.id)?;
            if !(MIN_AXIS_SIZE..=MAX_AXIS_SIZE).contains(&s.size) {
                return Err(invalid(format!(
                    "a size is {MIN_AXIS_SIZE} to {MAX_AXIS_SIZE} pixels, got {}",
                    s.size
                )));
            }
            let _ = self.sizes.insert(
                &format!("{sheet_id}|{axis}|{}", s.id),
                &SizeData {
                    size: s.size,
                    updated_at: now,
                },
            )?;
        }
        emit(Event::SheetViewChanged { sheet_id })
    }

    /// Freeze the first `rows` rows and `cols` columns (0 unfreezes). Editors.
    pub fn set_frozen(&mut self, sheet_id: String, rows: u32, cols: u32) -> app::Result<()> {
        self.require_role(Role::Editor)?;
        self.require_sheet(&sheet_id)?;
        if rows > MAX_FROZEN || cols > MAX_FROZEN {
            return Err(invalid(format!(
                "a sheet freezes at most {MAX_FROZEN} rows and {MAX_FROZEN} columns"
            )));
        }
        let _ = self.views.insert(
            &sheet_id,
            &SheetViewData {
                frozen_rows: rows,
                frozen_cols: cols,
                updated_at: now(),
            },
        )?;
        emit(Event::SheetViewChanged { sheet_id })
    }

    /// Every sheet's frozen panes and resized rows and columns.
    #[app::view]
    pub fn get_sheet_views(&self) -> app::Result<Vec<SheetView>> {
        let mut by_sheet: BTreeMap<String, SheetView> = BTreeMap::new();
        let blank = |sheet_id: &str| SheetView {
            sheet_id: sheet_id.to_string(),
            frozen_rows: 0,
            frozen_cols: 0,
            sizes: Vec::new(),
        };
        for (sheet_id, v) in all(|o| self.views.page(o))? {
            let view = by_sheet
                .entry(sheet_id.clone())
                .or_insert_with(|| blank(&sheet_id));
            view.frozen_rows = v.frozen_rows;
            view.frozen_cols = v.frozen_cols;
        }
        for (key, d) in all(|o| self.sizes.page(o))? {
            let Some((sheet_id, axis, id)) = split_key(&key) else {
                continue;
            };
            let axis = if axis == "r" { "row" } else { "col" };
            by_sheet
                .entry(sheet_id.to_string())
                .or_insert_with(|| blank(sheet_id))
                .sizes
                .push(AxisSize {
                    axis: axis.into(),
                    id: id.to_string(),
                    size: d.size,
                });
        }
        Ok(by_sheet.into_values().collect())
    }

    // ---- Private sheets ----
    //
    // v1 kept these in node-local private storage. Here they are the
    // caller's own rows in the workbook's state: no method shows them to
    // anyone else, and no role is needed (a viewer has private sheets too).

    /// Make a private sheet. Returns its id.
    pub fn create_private_sheet(&mut self, name: String) -> app::Result<String> {
        validate_sheet_name(&name).map_err(types_err)?;
        let me = me()?;
        let now = now();
        let id = generate_id("private", now, &nonce());
        let position = u32::try_from(self.my_private_sheets(&me)?.len()).unwrap_or(u32::MAX);
        let _ = self.private_sheets.insert(
            &(me, id.clone()),
            &ScratchSheet {
                name,
                position,
                created_at: now,
            },
        )?;
        Ok(id)
    }

    /// Rename one of the caller's private sheets.
    pub fn rename_private_sheet(&mut self, sheet_id: String, name: String) -> app::Result<()> {
        validate_sheet_name(&name).map_err(types_err)?;
        let key = (me()?, sheet_id);
        let Some(mut sheet) = self.private_sheets.get(&key)? else {
            return Err(not_found(key.1));
        };
        sheet.name = name;
        let _ = self.private_sheets.insert(&key, &sheet)?;
        Ok(())
    }

    /// Delete one of the caller's private sheets and its cells.
    pub fn delete_private_sheet(&mut self, sheet_id: String) -> app::Result<()> {
        let me = me()?;
        if self
            .private_sheets
            .remove(&(me.clone(), sheet_id.clone()))?
            .is_none()
        {
            return Err(not_found(sheet_id));
        }
        let prefix = [
            KeyPart::Str(me.clone()),
            KeyPart::Str(format!("{sheet_id}|")),
        ];
        for ((_, key), _) in all(|o| self.private_cells.starts_with(&prefix, o))? {
            let _ = self.private_cells.remove(&(me.clone(), key))?;
        }
        Ok(())
    }

    /// Write cells of one of the caller's private sheets: the same ops as
    /// `applyCellOps`, on implicit (position) row and column ids.
    pub fn apply_private_cell_ops(
        &mut self,
        sheet_id: String,
        ops: Vec<CellOp>,
    ) -> app::Result<()> {
        let me = me()?;
        if !self
            .private_sheets
            .contains(&(me.clone(), sheet_id.clone()))?
        {
            return Err(not_found(sheet_id));
        }
        if ops.len() > MAX_OPS_PER_APPLY {
            return Err(invalid(format!(
                "{} cell ops in one call; the limit is {MAX_OPS_PER_APPLY}, split the batch",
                ops.len()
            )));
        }
        let now = now();
        for op in ops {
            let (row_id, col_id) = op_cell(&op);
            if layout::implicit_index(row_id).is_none() || layout::implicit_index(col_id).is_none()
            {
                return Err(invalid(format!(
                    "a private sheet has no inserted rows or columns: {row_id}/{col_id}"
                )));
            }
            let key = (me.clone(), cell_key(&sheet_id, row_id, col_id));
            let mut cell = self.private_cells.get(&key)?.unwrap_or(ScratchCell {
                raw_value: String::new(),
                format: String::new(),
                updated_at: now,
            });
            match op {
                CellOp::Set { raw_value, .. } => cell.raw_value = raw_value,
                CellOp::Format { format, .. } => cell.format = format,
                CellOp::Clear { .. } => {
                    let _ = self.private_cells.remove(&key)?;
                    continue;
                }
            }
            cell.updated_at = now;
            let _ = if cell.raw_value.is_empty() && cell.format.is_empty() {
                self.private_cells.remove(&key)?
            } else {
                self.private_cells.insert(&key, &cell)?
            };
        }
        Ok(())
    }

    /// The caller's private sheets, in the order they were made.
    #[app::view]
    pub fn get_private_sheets(&self) -> app::Result<Vec<Sheet>> {
        let mut out: Vec<Sheet> = self
            .my_private_sheets(&me()?)?
            .into_iter()
            .map(|((_, id), s)| Sheet {
                id,
                name: s.name,
                position: s.position,
                created_at: s.created_at,
                linked_from: String::new(),
            })
            .collect();
        out.sort_by(|a, b| (a.created_at, &a.id).cmp(&(b.created_at, &b.id)));
        Ok(out)
    }

    /// Every cell of the caller's private sheets. `computed_value` is empty:
    /// the client evaluates them, with the shared sheets they read.
    #[app::view]
    pub fn get_private_cells(&self) -> app::Result<Vec<Cell>> {
        let prefix = [KeyPart::Str(me()?)];
        Ok(all(|o| self.private_cells.prefix(&prefix, o))?
            .into_iter()
            .filter_map(|((_, key), c)| {
                let (sheet_id, row_id, col_id) = split_key(&key)?;
                Some(Cell {
                    id: key.clone(),
                    sheet_id: sheet_id.to_string(),
                    row_id: row_id.to_string(),
                    col_id: col_id.to_string(),
                    raw_value: c.raw_value,
                    computed_value: String::new(),
                    format: c.format,
                    updated_at: c.updated_at,
                    last_editor: String::new(),
                    last_edited_at: 0,
                })
            })
            .collect())
    }

    // ---- Rows and columns ----

    /// Insert, delete or restore rows and columns; each op is one write.
    /// The client picks ids (a letter first) and fractional positions.
    pub fn apply_axis_ops(&mut self, sheet_id: String, ops: Vec<AxisOp>) -> app::Result<()> {
        if ops.len() > MAX_OPS_PER_APPLY {
            return Err(invalid(format!(
                "{} axis ops in one apply_axis_ops; the limit is {MAX_OPS_PER_APPLY}",
                ops.len()
            )));
        }
        self.require_sheet(&sheet_id)?;
        let deleting: Vec<(char, &str)> = ops
            .iter()
            .filter_map(|op| match op {
                AxisOp::DeleteRow { id } => Some(('r', id.as_str())),
                AxisOp::DeleteCol { id } => Some(('c', id.as_str())),
                _ => None,
            })
            .collect();
        self.require_axes_writable(&sheet_id, &deleting)?;
        let count = u32::try_from(ops.len()).unwrap_or(u32::MAX);
        let now = now();
        let mut tally: BTreeMap<(&str, &str), u32> = BTreeMap::new();
        for op in &ops {
            let entry = match op {
                AxisOp::InsertRow { .. } => ("inserted", "row"),
                AxisOp::InsertCol { .. } => ("inserted", "column"),
                AxisOp::DeleteRow { .. } => ("deleted", "row"),
                AxisOp::DeleteCol { .. } => ("deleted", "column"),
                AxisOp::RestoreRow { .. } => ("restored", "row"),
                AxisOp::RestoreCol { .. } => ("restored", "column"),
            };
            *tally.entry(entry).or_default() += 1;
        }
        let summary = tally
            .iter()
            .map(|((verb, noun), n)| format!("{verb} {n} {noun}{}", if *n == 1 { "" } else { "s" }))
            .collect::<Vec<_>>()
            .join(", ");
        let kind = if tally.keys().any(|(_, noun)| *noun == "row") {
            "rows"
        } else {
            "cols"
        };
        for op in ops {
            let (axis, id, insert_pos, deleted) = match op {
                AxisOp::InsertRow { id, pos } => ('r', id, Some(pos), false),
                AxisOp::InsertCol { id, pos } => ('c', id, Some(pos), false),
                AxisOp::DeleteRow { id } => ('r', id, None, true),
                AxisOp::DeleteCol { id } => ('c', id, None, true),
                AxisOp::RestoreRow { id } => ('r', id, None, false),
                AxisOp::RestoreCol { id } => ('c', id, None, false),
            };
            check_id(&id)?;
            let key = format!("{sheet_id}|{axis}|{id}");
            let existing = self.axes.get(&key)?;
            match (insert_pos, existing) {
                (Some(pos), existing) => {
                    if layout::implicit_index(&id).is_some()
                        || !id.starts_with(|c: char| c.is_ascii_alphabetic())
                    {
                        return Err(invalid(format!(
                            "a new row/column id must start with a letter, got {id:?}"
                        )));
                    }
                    if pos.is_empty() || !pos.bytes().all(|b| b.is_ascii_digit()) {
                        return Err(invalid(format!(
                            "a position is decimal digits, got {pos:?}"
                        )));
                    }
                    if existing.is_some() {
                        return Err(invalid(format!("{id} already exists")));
                    }
                    let _ = self.axes.insert(
                        &key,
                        &AxisData {
                            pos,
                            deleted: false,
                            updated_at: now,
                        },
                    )?;
                }
                (None, Some(mut entry)) => {
                    entry.deleted = deleted;
                    entry.updated_at = now;
                    let _ = self.axes.insert(&key, &entry)?;
                }
                // An implicit row that was never deleted is already there.
                (None, None) if !deleted => {}
                // Deleting an implicit row writes its tombstone at its fixed position.
                (None, None) => {
                    let k = layout::implicit_index(&id).ok_or_else(|| not_found(id.clone()))?;
                    let _ = self.axes.insert(
                        &key,
                        &AxisData {
                            pos: layout::implicit_pos(k),
                            deleted: true,
                            updated_at: now,
                        },
                    )?;
                }
            }
        }
        self.log(&sheet_id, kind, summary, 0, Vec::new())?;
        emit(Event::AxesChanged {
            sheet_id: sheet_id.clone(),
            count,
        })?;
        self.after_change(&sheet_id)
    }

    /// Every sheet's explicit row and column entries.
    #[app::view]
    pub fn get_layouts(&self) -> app::Result<Vec<SheetLayout>> {
        Ok(layouts(all(|o| self.axes.page(o))?))
    }

    // ---- Named ranges ----

    /// Define or redefine a named range (`target` in stored form). Editors.
    pub fn set_named_range(&mut self, name: String, target: String) -> app::Result<()> {
        self.require_role(Role::Editor)?;
        let name = name.trim().to_string();
        if !formula::is_valid_name(&name) {
            return Err(invalid(format!(
                "{name:?} cannot be a name: use letters, digits and _, starting with a letter or _, \
                 and not something that reads as a cell, a column or TRUE/FALSE"
            )));
        }
        if !formula::is_reference(&target) {
            return Err(invalid(format!(
                "{target:?} is not a cell or range reference"
            )));
        }
        self.store_name(name, target)
    }

    /// Delete a named range. Editors.
    pub fn delete_named_range(&mut self, name: String) -> app::Result<()> {
        self.require_role(Role::Editor)?;
        let key = name.trim().to_ascii_uppercase();
        if self.names.remove(&key)?.is_none() {
            return Err(not_found(name));
        }
        let name = name.trim().to_string();
        self.log(
            "",
            "name",
            format!("deleted the name {name}"),
            0,
            Vec::new(),
        )?;
        emit(Event::NamedRangesChanged { name })
    }

    /// Every named range, sorted by name.
    #[app::view]
    pub fn get_named_ranges(&self) -> app::Result<Vec<NamedRange>> {
        let mut out: Vec<NamedRange> = all(|o| self.names.page(o))?
            .into_iter()
            .map(|(_, d)| NamedRange {
                name: d.name,
                target: d.target,
            })
            .collect();
        out.sort_by(|a, b| {
            a.name
                .to_ascii_uppercase()
                .cmp(&b.name.to_ascii_uppercase())
        });
        Ok(out)
    }

    // ---- Reading cells ----

    /// One sheet's cells with computed values. Evaluates the sheet and the
    /// sheets it transitively references.
    #[app::view]
    pub fn get_cells(&self, sheet_id: String) -> app::Result<Vec<Cell>> {
        let env = self.formula_env()?;
        let (stored, sheet_ids) = self.closure_cells(&sheet_id, &env)?;
        let computed = evaluate(&stored, sheet_ids, env);
        let mut out = self.cells_from_stored(
            stored.into_iter().filter(|d| d.sheet_id == sheet_id),
            &computed,
        )?;
        out.sort_by(|a, b| (&a.row_id, &a.col_id).cmp(&(&b.row_id, &b.col_id)));
        Ok(out)
    }

    /// Every non-blank cell across all sheets, raw and computed.
    #[app::view]
    pub fn get_all_cells(&self) -> app::Result<Vec<Cell>> {
        let sheet_ids = self.live_sheet_ids()?;
        let mut stored = Vec::new();
        for id in &sheet_ids {
            stored.extend(self.stored_cells(id)?);
        }
        let computed = evaluate(&stored, sheet_ids, self.formula_env()?);
        let mut out = self.cells_from_stored(stored, &computed)?;
        out.sort_by(|a, b| {
            (&a.sheet_id, &a.row_id, &a.col_id).cmp(&(&b.sheet_id, &b.row_id, &b.col_id))
        });
        Ok(out)
    }

    // ---- Function help ----

    /// Every formula function, sorted by name.
    #[app::view]
    pub fn get_functions(&self) -> app::Result<Vec<FunctionDef>> {
        Ok(builtin_functions())
    }

    /// The functions whose name starts with `prefix` (case ignored).
    #[app::view]
    pub fn search_functions(&self, prefix: String) -> app::Result<Vec<FunctionDef>> {
        let upper = prefix.to_uppercase();
        Ok(builtin_functions()
            .into_iter()
            .filter(|f| f.name.starts_with(&upper))
            .collect())
    }

    // ---- Export ----

    /// All sheets (as `listSheets`); the client assembles the file.
    #[app::view]
    pub fn export_all(&self) -> app::Result<Vec<Sheet>> {
        self.list_sheets()
    }
}

// ---------------------------------------------------------------------------
// Private helpers
// ---------------------------------------------------------------------------

/// What a role may do.
#[derive(Clone, Copy, Debug, PartialEq, Eq, PartialOrd, Ord)]
enum Role {
    Viewer,
    Commenter,
    Editor,
    Owner,
}

impl Role {
    fn parse(s: &str) -> Option<Role> {
        Some(match s {
            "owner" => Role::Owner,
            "editor" => Role::Editor,
            "commenter" => Role::Commenter,
            "viewer" => Role::Viewer,
            _ => return None,
        })
    }

    fn as_str(self) -> &'static str {
        match self {
            Role::Owner => "owner",
            Role::Editor => "editor",
            Role::Commenter => "commenter",
            Role::Viewer => "viewer",
        }
    }
}

impl Spreadsheet {
    fn founding(&self) -> app::Result<Founding> {
        Ok(self.founding.get()?.unwrap_or_default())
    }

    fn unique_sheet_name(&self, desired: &str, exclude_id: Option<&str>) -> app::Result<String> {
        let existing: Vec<String> = all(|o| self.sheets.page(o))?
            .into_iter()
            .filter(|(id, _)| exclude_id != Some(id.as_str()))
            .map(|(_, d)| d.name)
            .collect();
        if !existing.iter().any(|n| n == desired) {
            return Ok(desired.to_string());
        }
        let mut n = 2u32;
        loop {
            let cand = format!("{desired} ({n})");
            if !existing.contains(&cand) {
                return Ok(cand);
            }
            n += 1;
        }
    }

    fn require_sheet(&self, sheet_id: &str) -> app::Result<()> {
        if !self.sheets.contains(&sheet_id.to_string())? {
            return Err(not_found(sheet_id));
        }
        Ok(())
    }

    /// Store a raw value; the format is left as it is. Creates the cell.
    fn store_value(
        &mut self,
        sheet_id: &str,
        row_id: &str,
        col_id: &str,
        raw_value: String,
    ) -> app::Result<String> {
        check_id(row_id)?;
        check_id(col_id)?;
        let key = cell_key(sheet_id, row_id, col_id);
        let _ = self.cells.insert(
            &key,
            &CellData {
                id: key.clone(),
                sheet_id: sheet_id.to_string(),
                raw_value,
                updated_at: now(),
            },
        )?;
        Ok(key)
    }

    /// Store only the display format; an absent cell is created empty.
    fn store_format(
        &mut self,
        sheet_id: &str,
        row_id: &str,
        col_id: &str,
        format: String,
    ) -> app::Result<()> {
        let key = cell_key(sheet_id, row_id, col_id);
        if !self.cells.contains(&key)? {
            let _ = self.store_value(sheet_id, row_id, col_id, String::new())?;
        }
        let _ = self.formats.insert(
            &key,
            &FormatData {
                format,
                updated_at: now(),
            },
        )?;
        Ok(())
    }

    /// Blank value and format.
    fn store_clear(&mut self, sheet_id: &str, row_id: &str, col_id: &str) -> app::Result<()> {
        let key = cell_key(sheet_id, row_id, col_id);
        if !self.cells.contains(&key)? {
            return Ok(());
        }
        let _ = self.store_value(sheet_id, row_id, col_id, String::new())?;
        self.store_format(sheet_id, row_id, col_id, String::new())
    }

    /// A cell's raw value and format.
    fn cell_state(&self, key: &String) -> app::Result<(String, String)> {
        let raw = self
            .cells
            .get(key)?
            .map(|c| c.raw_value)
            .unwrap_or_default();
        let format = self.formats.get(key)?.map(|f| f.format).unwrap_or_default();
        Ok((raw, format))
    }

    /// Apply cell ops and record them: each changed cell's last editor, and
    /// one activity entry for the batch.
    fn edit_cells(&mut self, sheet_id: &str, ops: Vec<CellOp>) -> app::Result<()> {
        self.require_sheet(sheet_id)?;
        let mut touched: BTreeMap<String, (String, String, (String, String))> = BTreeMap::new();
        for op in &ops {
            let (row_id, col_id) = op_cell(op);
            let key = cell_key(sheet_id, row_id, col_id);
            if let std::collections::btree_map::Entry::Vacant(slot) = touched.entry(key) {
                let before = self.cell_state(slot.key())?;
                let _ = slot.insert((row_id.to_string(), col_id.to_string(), before));
            }
        }
        self.require_cells_writable(
            sheet_id,
            touched.values().map(|(r, c, _)| (r.as_str(), c.as_str())),
        )?;
        self.require_valid_values(sheet_id, &ops)?;
        for op in ops {
            match op {
                CellOp::Set {
                    row_id,
                    col_id,
                    raw_value,
                } => {
                    let _ = self.store_value(sheet_id, &row_id, &col_id, raw_value)?;
                }
                CellOp::Format {
                    row_id,
                    col_id,
                    format,
                } => self.store_format(sheet_id, &row_id, &col_id, format)?,
                CellOp::Clear { row_id, col_id } => self.store_clear(sheet_id, &row_id, &col_id)?,
            }
        }
        let author = me()?;
        let at = now();
        let mut changes = Vec::new();
        for (key, (row_id, col_id, before)) in touched {
            let after = self.cell_state(&key)?;
            if after == before {
                continue;
            }
            let _ = self.cell_meta.insert(
                &key,
                &CellMeta {
                    author: author.clone(),
                    at,
                },
            )?;
            changes.push(CellChange {
                row_id,
                col_id,
                before_raw: before.0,
                before_format: before.1,
                after_raw: after.0,
                after_format: after.1,
            });
        }
        if changes.is_empty() {
            return Ok(());
        }
        let count = u32::try_from(changes.len()).unwrap_or(u32::MAX);
        let summary = match changes.as_slice() {
            [one] if one.after_raw.is_empty() && one.after_format.is_empty() => {
                "cleared a cell".to_string()
            }
            [one] if one.before_raw == one.after_raw => {
                format!("formatted a cell as {}", display_format(&one.after_format))
            }
            [_] => "edited a cell".to_string(),
            _ => format!("changed {count} cells"),
        };
        changes.truncate(MAX_LOGGED_CHANGES);
        self.log(sheet_id, "cells", summary, count, changes)?;
        self.after_change(sheet_id)
    }

    /// Append an activity entry, authored by the caller.
    fn log(
        &mut self,
        sheet_id: &str,
        kind: &str,
        summary: String,
        count: u32,
        changes: Vec<CellChange>,
    ) -> app::Result<()> {
        let key = (now(), me()?, hex(&nonce()));
        let _ = self.activity.insert(
            &key,
            &ActivityData {
                sheet_id: sheet_id.to_string(),
                kind: kind.to_string(),
                summary,
                count,
                changes,
            },
        )?;
        Ok(())
    }

    /// Members named in `text` as `@nickname` (longest nickname wins, case
    /// ignored; a nickname may contain spaces).
    fn mentions_in(&self, text: &str) -> app::Result<Vec<String>> {
        if !text.contains('@') {
            return Ok(Vec::new());
        }
        let mut members: Vec<(String, String)> = all(|o| self.members.page(o))?
            .into_iter()
            .map(|(id, m)| (m.nickname.to_lowercase(), id))
            .collect();
        members.sort_by(|a, b| b.0.len().cmp(&a.0.len()).then(a.1.cmp(&b.1)));
        let lower = text.to_lowercase();
        let mut found = Vec::new();
        for (at, _) in lower.match_indices('@') {
            let rest = &lower[at + 1..];
            if let Some((_, id)) = members.iter().find(|(nick, _)| {
                rest.starts_with(nick.as_str())
                    && !rest[nick.len()..].starts_with(|c: char| c.is_alphanumeric())
            }) {
                if !found.contains(id) {
                    found.push(id.clone());
                }
            }
        }
        Ok(found)
    }

    fn check_rule(&self, rule: &RuleInput) -> app::Result<()> {
        self.require_sheet(&rule.sheet_id)?;
        for c in [
            &rule.top_row_id,
            &rule.left_col_id,
            &rule.bottom_row_id,
            &rule.right_col_id,
        ] {
            check_id(c)?;
        }
        match rule.kind.as_str() {
            "format" => {
                if !rules::is_valid(&rule.condition, &rule.args) {
                    return Err(invalid("that condition does not take those values"));
                }
                if rule.style.is_empty() {
                    return Err(invalid("a conditional format needs a style"));
                }
                for (field, value) in &rule.style {
                    check_style_field(field, value)?;
                }
            }
            "scale" => {
                if rule.args.len() != 2 {
                    return Err(invalid("a colour scale takes two colours"));
                }
                for colour in &rule.args {
                    check_style_field("fill", colour)?;
                }
            }
            "validate" => {
                if !rules::is_valid(&rule.condition, &rule.args) {
                    return Err(invalid("that condition does not take those values"));
                }
            }
            "alert" => {
                if !rules::is_valid(&rule.condition, &rule.args) {
                    return Err(invalid("that condition does not take those values"));
                }
                if rule.recipients.is_empty() {
                    return Err(invalid("an alert tells at least one member"));
                }
                for m in &rule.recipients {
                    if !self.members.contains(m)? {
                        return Err(not_found(m.clone()));
                    }
                }
            }
            _ => return Err(invalid("a rule is format, scale, validate or alert")),
        }
        if rule.args.iter().map(String::len).sum::<usize>() > 2000 {
            return Err(invalid("a rule's values are at most 2000 characters"));
        }
        Ok(())
    }

    fn put_rule(&mut self, id: &str, rule: RuleInput, now: u64) -> app::Result<()> {
        let _ = self.rules.insert(
            &id.to_string(),
            &RuleData {
                sheet_id: rule.sheet_id,
                top_row_id: rule.top_row_id,
                left_col_id: rule.left_col_id,
                bottom_row_id: rule.bottom_row_id,
                right_col_id: rule.right_col_id,
                kind: rule.kind,
                condition: rule.condition,
                args: rule.args,
                style: rule.style,
                strict: rule.strict,
                recipients: rule.recipients,
                created_by: me()?,
                updated_at: now,
            },
        )?;
        Ok(())
    }

    fn live_rule(&self, id: &str) -> app::Result<RuleData> {
        self.rules
            .get(&id.to_string())?
            .ok_or_else(|| not_found(id))
    }

    /// A sheet's rules of one kind.
    fn rules_of(&self, sheet_id: &str, kind: &str) -> app::Result<Vec<(String, RuleData)>> {
        Ok(all(|o| self.rules.page(o))?
            .into_iter()
            .filter(|(_, r)| r.sheet_id == sheet_id && r.kind == kind)
            .collect())
    }

    /// Refuse a literal a strict validation over its cell would not accept.
    fn require_valid_values(&self, sheet_id: &str, ops: &[CellOp]) -> app::Result<()> {
        let strict: Vec<RuleData> = self
            .rules_of(sheet_id, "validate")?
            .into_iter()
            .map(|(_, r)| r)
            .filter(|r| r.strict)
            .collect();
        if strict.is_empty() {
            return Ok(());
        }
        let l = self.sheet_layout(sheet_id)?;
        for op in ops {
            let CellOp::Set {
                row_id,
                col_id,
                raw_value,
            } = op
            else {
                continue;
            };
            if raw_value.starts_with('=') {
                continue;
            }
            let (Some(r), Some(c)) = (l.rows.index_of(row_id), l.cols.index_of(col_id)) else {
                continue;
            };
            for rule in &strict {
                let inside = corner_rect(
                    [
                        &rule.top_row_id,
                        &rule.left_col_id,
                        &rule.bottom_row_id,
                        &rule.right_col_id,
                    ],
                    &l,
                )
                .is_some_and(|x| x.contains(r, c));
                if inside && !rules::matches(&rule.condition, &rule.args, raw_value) {
                    return Err(invalid(format!(
                        "{}{} must be {}",
                        formula::col_label(c as u32),
                        r + 1,
                        rules::describe(&rule.condition, &rule.args)
                    )));
                }
            }
        }
        Ok(())
    }

    fn check_chart(&self, chart: &ChartInput) -> app::Result<()> {
        self.require_sheet(&chart.sheet_id)?;
        for c in [
            &chart.top_row_id,
            &chart.left_col_id,
            &chart.bottom_row_id,
            &chart.right_col_id,
        ] {
            check_id(c)?;
        }
        if !matches!(chart.kind.as_str(), "bar" | "line") {
            return Err(invalid("a chart is bar or line"));
        }
        if chart.title.chars().count() > 120 {
            return Err(invalid("a chart title is at most 120 characters"));
        }
        Ok(())
    }

    fn put_chart(&mut self, id: &str, chart: ChartInput, now: u64) -> app::Result<()> {
        let sheet_id = chart.sheet_id.clone();
        let _ = self.charts.insert(
            &id.to_string(),
            &ChartData {
                sheet_id: chart.sheet_id,
                top_row_id: chart.top_row_id,
                left_col_id: chart.left_col_id,
                bottom_row_id: chart.bottom_row_id,
                right_col_id: chart.right_col_id,
                kind: chart.kind,
                title: chart.title.trim().to_string(),
                created_by: me()?,
                updated_at: now,
            },
        )?;
        emit(Event::ChartsChanged { sheet_id })
    }

    fn live_chart(&self, id: &str) -> app::Result<ChartData> {
        self.charts
            .get(&id.to_string())?
            .ok_or_else(|| not_found(id))
    }

    fn my_private_sheets(&self, me: &str) -> app::Result<Vec<((String, String), ScratchSheet)>> {
        let prefix = [KeyPart::Str(me.to_string())];
        all(|o| self.private_sheets.prefix(&prefix, o))
    }

    fn store_name(&mut self, name: String, target: String) -> app::Result<()> {
        let _ = self.names.insert(
            &name.to_ascii_uppercase(),
            &NamedRangeData {
                name: name.clone(),
                target,
                updated_at: now(),
            },
        )?;
        self.log(
            "",
            "name",
            format!("defined the name {name}"),
            0,
            Vec::new(),
        )?;
        emit(Event::NamedRangesChanged { name })
    }

    /// The live sheet ids: the workbook's own and the linked ones.
    fn live_sheet_ids(&self) -> app::Result<BTreeSet<String>> {
        let mut ids: BTreeSet<String> = all(|o| self.sheets.page(o))?
            .into_iter()
            .map(|(id, _)| id)
            .collect();
        ids.extend(self.live_links()?.into_iter().map(|(id, _)| id));
        Ok(ids)
    }

    /// One live sheet's stored cells, or a linked sheet's pushed values as
    /// literal cells by position.
    fn stored_cells(&self, sheet_id: &str) -> app::Result<Vec<CellData>> {
        if let Some(l) = self
            .linked
            .get(&sheet_id.to_string())?
            .filter(|l| !l.deleted && !l.blocked)
        {
            let mut out = Vec::new();
            for r in 0..l.rows {
                for c in 0..l.cols {
                    let Some(v) = l.values.get((r * l.cols + c) as usize) else {
                        continue;
                    };
                    if v.is_empty() {
                        continue;
                    }
                    out.push(CellData {
                        id: cell_key(sheet_id, &r.to_string(), &c.to_string()),
                        sheet_id: sheet_id.to_string(),
                        raw_value: v.clone(),
                        updated_at: l.updated_at,
                    });
                }
            }
            return Ok(out);
        }
        let prefix = [KeyPart::Str(format!("{sheet_id}|"))];
        Ok(all(|o| self.cells.starts_with(&prefix, o))?
            .into_iter()
            .map(|(_, d)| d)
            .collect())
    }

    /// The cells of `sheet_id` and of every sheet its formulas reach, and the
    /// live sheet ids.
    fn closure_cells(
        &self,
        sheet_id: &str,
        env: &formula::Env,
    ) -> app::Result<(Vec<CellData>, BTreeSet<String>)> {
        let sheet_ids = self.live_sheet_ids()?;
        let mut stored = Vec::new();
        let _ = recalc::sheet_closure(env, sheet_id, |s| {
            if !sheet_ids.contains(s) {
                return Ok(Vec::new());
            }
            let cells = self.stored_cells(s)?;
            let raws = cells.iter().map(|d| d.raw_value.clone()).collect();
            stored.extend(cells);
            Ok::<_, AppError>(raws)
        })?;
        Ok((stored, sheet_ids))
    }

    /// The cells to show: format applied, computed value looked up, fully
    /// blank cells hidden.
    fn cells_from_stored(
        &self,
        stored: impl IntoIterator<Item = CellData>,
        computed: &BTreeMap<recalc::CellRef, String>,
    ) -> app::Result<Vec<Cell>> {
        let mut out = Vec::new();
        for d in stored {
            let format = self
                .formats
                .get(&d.id)?
                .map(|f| f.format)
                .unwrap_or_default();
            if d.raw_value.is_empty() && format.is_empty() {
                continue;
            }
            let Some((_, row_id, col_id)) = split_key(&d.id) else {
                continue;
            };
            let (row_id, col_id) = (row_id.to_string(), col_id.to_string());
            let computed_value = computed
                .get(&recalc::CellRef {
                    sheet_id: d.sheet_id.clone(),
                    row: row_id.clone(),
                    col: col_id.clone(),
                })
                .cloned()
                .unwrap_or_else(|| d.raw_value.clone());
            let edited = self.cell_meta.get(&d.id)?;
            let last_editor = edited
                .as_ref()
                .map(|m| m.author.clone())
                .unwrap_or_default();
            let last_edited_at = edited.map_or(d.updated_at, |m| m.at);
            out.push(Cell {
                id: d.id,
                sheet_id: d.sheet_id,
                row_id,
                col_id,
                raw_value: d.raw_value,
                computed_value,
                format,
                updated_at: d.updated_at,
                last_editor,
                last_edited_at,
            });
        }
        Ok(out)
    }

    /// What formulas see besides cells: the clock, the named ranges and each
    /// sheet's row and column order.
    fn formula_env(&self) -> app::Result<formula::Env> {
        let names = all(|o| self.names.page(o))?
            .into_iter()
            .map(|(k, d)| (k, d.target))
            .collect();
        let layouts = layouts(all(|o| self.axes.page(o))?)
            .into_iter()
            .map(|l| (l.sheet_id.clone(), build_layout(l)))
            .collect();
        Ok(formula::Env {
            now_ms: env::time_now(),
            names,
            layouts,
        })
    }

    /// Work that follows a change to a sheet: check its alerts (evaluating the
    /// sheet only when it has any). v1 also pushed its links here; now the
    /// client that made the change relays them.
    fn after_change(&mut self, sheet_id: &str) -> app::Result<()> {
        let alerts = self.rules_of(sheet_id, "alert")?;
        if alerts.is_empty() {
            return Ok(());
        }
        let values = self.sheet_values(sheet_id)?;
        for (id, rule) in alerts {
            self.check_alert(&id, &rule, &values)?;
        }
        Ok(())
    }

    /// A sheet's computed values by (row id, column id), with its layout.
    fn sheet_values(&self, sheet_id: &str) -> app::Result<SheetValues> {
        let env = self.formula_env()?;
        let (stored, sheet_ids) = self.closure_cells(sheet_id, &env)?;
        let computed = evaluate(&stored, sheet_ids, env);
        let values = computed
            .into_iter()
            .filter(|(k, _)| k.sheet_id == sheet_id)
            .map(|(k, v)| ((k.row, k.col), v))
            .collect();
        Ok(SheetValues {
            values,
            layout: self.sheet_layout(sheet_id)?,
        })
    }

    /// A link's current values, as v1 pushed them.
    fn link_push(&self, id: &str, p: &PublicationData) -> app::Result<LinkPush> {
        let sheet = self.sheet_values(&p.sheet_id)?;
        let rect = corner_rect(
            [
                &p.top_row_id,
                &p.left_col_id,
                &p.bottom_row_id,
                &p.right_col_id,
            ],
            &sheet.layout,
        )
        .ok_or_else(|| invalid("the linked range's rows or columns are gone"))?;
        let rows = u32::try_from(rect.bottom - rect.top + 1).unwrap_or(u32::MAX);
        let cols = u32::try_from(rect.right - rect.left + 1).unwrap_or(u32::MAX);
        if rows.saturating_mul(cols) > MAX_LINK_CELLS {
            return Err(invalid(format!(
                "a link carries at most {MAX_LINK_CELLS} cells"
            )));
        }
        let mut values = Vec::with_capacity((rows * cols) as usize);
        for r in rect.top..=rect.bottom {
            for c in rect.left..=rect.right {
                let key = (
                    sheet
                        .layout
                        .rows
                        .id_at(r)
                        .map(|x| x.into_owned())
                        .unwrap_or_default(),
                    sheet
                        .layout
                        .cols
                        .id_at(c)
                        .map(|x| x.into_owned())
                        .unwrap_or_default(),
                );
                values.push(link_value(
                    sheet.values.get(&key).map(String::as_str).unwrap_or(""),
                ));
            }
        }
        Ok(LinkPush {
            publication_id: id.to_string(),
            target_context: p.target_context.clone(),
            name: p.name.clone(),
            source_name: self.project_name.get()?.unwrap_or_default(),
            rows,
            cols,
            values,
        })
    }

    fn live_links(&self) -> app::Result<Vec<(String, LinkedData)>> {
        Ok(all(|o| self.linked.page(o))?
            .into_iter()
            .filter(|(_, l)| !l.deleted && !l.blocked)
            .collect())
    }

    /// A link whose maker may still edit; `NotFound` otherwise.
    fn live_publication(&self, id: &str) -> app::Result<PublicationData> {
        match self.publications.get(&id.to_string())? {
            Some(p) if self.role_of(&p.created_by)? >= Role::Editor => Ok(p),
            _ => Err(not_found(id)),
        }
    }

    /// Tell an alert's recipients about cells that now meet its condition.
    fn check_alert(&mut self, id: &str, rule: &RuleData, sheet: &SheetValues) -> app::Result<()> {
        let Some(rect) = corner_rect(
            [
                &rule.top_row_id,
                &rule.left_col_id,
                &rule.bottom_row_id,
                &rule.right_col_id,
            ],
            &sheet.layout,
        ) else {
            return Ok(());
        };
        let mut matching = Vec::new();
        for r in rect.top..=rect.bottom.min(formula::MAX_ROWS as usize - 1) {
            for c in rect.left..=rect.right.min(formula::MAX_COLS as usize - 1) {
                let (Some(row_id), Some(col_id)) =
                    (sheet.layout.rows.id_at(r), sheet.layout.cols.id_at(c))
                else {
                    continue;
                };
                let v = sheet
                    .values
                    .get(&(row_id.into_owned(), col_id.into_owned()))
                    .map(String::as_str)
                    .unwrap_or("");
                if !v.is_empty() && rules::matches(&rule.condition, &rule.args, v) {
                    matching.push(format!("{}{}", formula::col_label(c as u32), r + 1));
                }
            }
        }
        let key = id.to_string();
        let before = self
            .alert_state
            .get(&key)?
            .map(|s| s.cells)
            .unwrap_or_default();
        if matching == before {
            return Ok(());
        }
        let fresh: Vec<String> = matching
            .iter()
            .filter(|c| !before.contains(c))
            .cloned()
            .collect();
        let _ = self.alert_state.insert(
            &key,
            &AlertState {
                cells: matching,
                updated_at: now(),
            },
        )?;
        if !fresh.is_empty() {
            let message = format!(
                "{} {} {}",
                fresh.iter().take(5).cloned().collect::<Vec<_>>().join(", "),
                if fresh.len() == 1 {
                    "is now"
                } else {
                    "are now"
                },
                rules::describe(&rule.condition, &rule.args)
            );
            emit(Event::AlertTriggered {
                rule_id: key,
                sheet_id: rule.sheet_id.clone(),
                recipients: rule.recipients.clone(),
                message,
            })?;
        }
        Ok(())
    }

    /// A member's role: an owner; else `viewer` or `commenter` if set; else
    /// an editor.
    fn role_of(&self, member: &str) -> app::Result<Role> {
        let member = member.to_string();
        if self.owners.contains(&member)? {
            return Ok(Role::Owner);
        }
        Ok(match self.roles.get(&member)?.as_deref() {
            Some("viewer") => Role::Viewer,
            Some("commenter") => Role::Commenter,
            _ => Role::Editor,
        })
    }

    /// The caller's role, if it is at least `at_least`.
    fn require_role(&self, at_least: Role) -> app::Result<Role> {
        let role = self.role_of(&me()?)?;
        if role < at_least {
            return Err(forbidden(format!(
                "you are {} {} in this workbook",
                article(role),
                role.as_str()
            )));
        }
        Ok(role)
    }

    /// Refuse unless the caller is an owner.
    fn require_owner(&self, what: &str) -> app::Result<()> {
        if self.require_role(Role::Viewer)? != Role::Owner {
            return Err(forbidden(format!("only an owner can {what}")));
        }
        Ok(())
    }

    /// The protected ranges on a sheet that stop the caller: none for an
    /// owner, none the caller is listed on. Errors if the caller may not edit.
    fn binding_protections(&self, sheet_id: &str) -> app::Result<Vec<ProtectionData>> {
        if self.require_role(Role::Editor)? == Role::Owner {
            return Ok(Vec::new());
        }
        let me = me()?;
        Ok(all(|o| self.protections.page(o))?
            .into_iter()
            .map(|(_, p)| p)
            .filter(|p| p.sheet_id == sheet_id && !p.editors.contains(&me))
            .collect())
    }

    /// One sheet's layout.
    fn sheet_layout(&self, sheet_id: &str) -> app::Result<layout::Layout> {
        let prefix = [KeyPart::Str(format!("{sheet_id}|"))];
        let axes = all(|o| self.axes.starts_with(&prefix, o))?;
        Ok(layouts(axes)
            .into_iter()
            .next()
            .map(build_layout)
            .unwrap_or_else(|| layout::Layout::identity(formula::MAX_ROWS, formula::MAX_COLS)))
    }

    /// Refuse if any of these cells is in a range protected from the caller.
    fn require_cells_writable<'a>(
        &self,
        sheet_id: &str,
        cells: impl IntoIterator<Item = (&'a str, &'a str)>,
    ) -> app::Result<()> {
        let binding = self.binding_protections(sheet_id)?;
        if binding.is_empty() {
            return Ok(());
        }
        let l = self.sheet_layout(sheet_id)?;
        for (row_id, col_id) in cells {
            let (Some(r), Some(c)) = (l.rows.index_of(row_id), l.cols.index_of(col_id)) else {
                continue;
            };
            if let Some(p) = binding
                .iter()
                .find(|p| protected_rect(p, &l).is_some_and(|x| x.contains(r, c)))
            {
                return Err(forbidden(format!(
                    "{}{} is in a protected range{}",
                    formula::col_label(c as u32),
                    r + 1,
                    describe(p)
                )));
            }
        }
        Ok(())
    }

    /// Refuse deleting a row or column through a range protected from the caller.
    fn require_axes_writable(&self, sheet_id: &str, deleting: &[(char, &str)]) -> app::Result<()> {
        let binding = self.binding_protections(sheet_id)?;
        if binding.is_empty() || deleting.is_empty() {
            return Ok(());
        }
        let l = self.sheet_layout(sheet_id)?;
        for &(axis, id) in deleting {
            let at = if axis == 'r' {
                l.rows.index_of(id)
            } else {
                l.cols.index_of(id)
            };
            let Some(at) = at else { continue };
            let hit = binding.iter().find(|p| {
                protected_rect(p, &l).is_some_and(|x| {
                    if axis == 'r' {
                        (x.top..=x.bottom).contains(&at)
                    } else {
                        (x.left..=x.right).contains(&at)
                    }
                })
            });
            if let Some(p) = hit {
                return Err(forbidden(format!(
                    "that {} runs through a protected range{}",
                    if axis == 'r' { "row" } else { "column" },
                    describe(p)
                )));
            }
        }
        Ok(())
    }

    /// Refuse renaming or deleting a sheet protected as a whole from the caller.
    fn require_sheet_writable(&self, sheet_id: &str) -> app::Result<()> {
        self.require_sheet(sheet_id)?;
        if let Some(p) = self
            .binding_protections(sheet_id)?
            .iter()
            .find(|p| is_whole_sheet(p))
        {
            return Err(forbidden(format!("this sheet is protected{}", describe(p))));
        }
        Ok(())
    }
}

// ---------------------------------------------------------------------------
// Free helpers
// ---------------------------------------------------------------------------

/// The calling account: the member id roles, comments and cells name.
fn me() -> app::Result<String> {
    match env::caller() {
        Caller::Account(a) => Ok(a),
        Caller::ApiKey { account, .. } => Ok(account),
        _ => Err(AppError::login_required()),
    }
}

/// The clock in nanoseconds, as v1 stored and answered every time.
fn now() -> u64 {
    env::time_now().saturating_mul(1_000_000)
}

fn nonce() -> [u8; 4] {
    let bytes = env::random_bytes(4);
    let mut out = [0u8; 4];
    out.copy_from_slice(&bytes[..4]);
    out
}

fn hex(bytes: &[u8]) -> String {
    bytes.iter().map(|b| format!("{b:02x}")).collect()
}

/// Every page of a paged read (each page at most [`PAGE`] rows).
fn all<T>(mut read: impl FnMut(FindOpts) -> Result<Page<T>, StorageError>) -> app::Result<Vec<T>> {
    let mut out = Vec::new();
    let mut cursor: Option<String> = None;
    loop {
        let mut opts = FindOpts::default().limit(PAGE);
        if let Some(c) = cursor.take() {
            opts = opts.cursor(c);
        }
        let page = read(opts)?;
        out.extend(page.items);
        match page.next {
            Some(next) => cursor = Some(next),
            None => return Ok(out),
        }
    }
}

fn cell_key(sheet_id: &str, row_id: &str, col_id: &str) -> String {
    format!("{sheet_id}|{row_id}|{col_id}")
}

fn op_cell(op: &CellOp) -> (&str, &str) {
    match op {
        CellOp::Set { row_id, col_id, .. }
        | CellOp::Format { row_id, col_id, .. }
        | CellOp::Clear { row_id, col_id } => (row_id, col_id),
    }
}

/// A row or column id goes into storage keys and stored formulas.
fn check_id(id: &str) -> app::Result<()> {
    if id.is_empty() || id.len() > 32 || !id.bytes().all(|b| b.is_ascii_alphanumeric()) {
        return Err(invalid(format!(
            "row/column id {id:?} must be 1-32 ASCII letters and digits"
        )));
    }
    Ok(())
}

/// An app instance id, as a link names a workbook.
fn check_workbook_id(id: &str) -> app::Result<()> {
    if id.is_empty()
        || id.len() > 128
        || !id
            .bytes()
            .all(|b| b.is_ascii_alphanumeric() || b == b'-' || b == b'_')
    {
        return Err(invalid(format!("{id:?} is not a workbook id")));
    }
    Ok(())
}

fn check_publication_id(id: &str) -> app::Result<()> {
    if id.is_empty() || id.len() > 64 || !id.bytes().all(|b| b.is_ascii_alphanumeric() || b == b'-')
    {
        return Err(invalid(format!("{id:?} is not a link id")));
    }
    Ok(())
}

fn check_comment(text: String) -> app::Result<String> {
    let text = text.trim().to_string();
    if text.is_empty() || text.chars().count() > MAX_COMMENT_CHARS {
        return Err(invalid(format!(
            "a comment is 1 to {MAX_COMMENT_CHARS} characters"
        )));
    }
    Ok(text)
}

fn check_description(description: String) -> app::Result<String> {
    let description = description.trim().to_string();
    if description.chars().count() > 200 {
        return Err(invalid("a description is at most 200 characters"));
    }
    Ok(description)
}

/// A protection's editor list, bounded so it fits one stored value.
fn check_editors(editors: Vec<String>) -> app::Result<Vec<String>> {
    if editors.len() > 1000 {
        return Err(invalid("a protected range lists at most 1000 editors"));
    }
    Ok(editors)
}

/// Style fields and what each takes (besides empty, which clears it).
fn check_style_field(field: &str, value: &str) -> app::Result<()> {
    let ok = value.is_empty()
        || match field {
            "bold" | "italic" | "underline" | "strike" | "wrap" => value == "1",
            "color" | "fill" => {
                value.len() == 7
                    && value.starts_with('#')
                    && value[1..].bytes().all(|b| b.is_ascii_hexdigit())
            }
            "align" => matches!(value, "left" | "center" | "right"),
            _ => {
                return Err(invalid(format!(
            "{field:?} is not a style: bold, italic, underline, strike, wrap, color, fill or align"
        )))
            }
        };
    if ok {
        Ok(())
    } else {
        Err(invalid(format!("{value:?} is not a value for {field}")))
    }
}

/// The linked sheet id for a publication of a source workbook.
fn link_id(from: &str, publication_id: &str) -> String {
    let short: String = from
        .chars()
        .filter(char::is_ascii_alphanumeric)
        .take(12)
        .collect();
    format!("link-{short}-{publication_id}")
}

/// A value as a linked sheet keeps it: a literal, at most 256 characters.
fn link_value(v: &str) -> String {
    v.trim_start_matches('=')
        .chars()
        .take(MAX_LINK_VALUE_CHARS)
        .collect()
}

/// Evaluate stored cells: the recalc input of each non-blank one.
fn evaluate(
    stored: &[CellData],
    sheet_ids: BTreeSet<String>,
    env: formula::Env,
) -> BTreeMap<recalc::CellRef, String> {
    let cells = stored
        .iter()
        .filter(|d| !d.raw_value.is_empty())
        .filter_map(|d| {
            let (_, row, col) = split_key(&d.id)?;
            Some((
                recalc::CellRef {
                    sheet_id: d.sheet_id.clone(),
                    row: row.to_string(),
                    col: col.to_string(),
                },
                d.raw_value.clone(),
            ))
        })
        .collect();
    recalc::evaluate(&recalc::WorkbookInputs {
        cells,
        sheet_ids,
        env,
    })
}

/// Axis entries grouped into each sheet's layout.
fn layouts(axes: Vec<(String, AxisData)>) -> Vec<SheetLayout> {
    let mut by_sheet: BTreeMap<String, SheetLayout> = BTreeMap::new();
    for (key, d) in axes {
        let Some((sheet_id, axis, id)) = split_key(&key) else {
            continue;
        };
        let l = by_sheet
            .entry(sheet_id.to_string())
            .or_insert_with(|| SheetLayout {
                sheet_id: sheet_id.to_string(),
                rows: Vec::new(),
                cols: Vec::new(),
            });
        let entry = AxisEntryView {
            id: id.to_string(),
            pos: d.pos,
            deleted: d.deleted,
        };
        match axis {
            "r" => l.rows.push(entry),
            "c" => l.cols.push(entry),
            _ => {}
        }
    }
    by_sheet.into_values().collect()
}

/// A resolved rectangle of positions, inclusive.
struct Rect {
    top: usize,
    left: usize,
    bottom: usize,
    right: usize,
}

impl Rect {
    fn contains(&self, r: usize, c: usize) -> bool {
        (self.top..=self.bottom).contains(&r) && (self.left..=self.right).contains(&c)
    }
}

/// A sheet's computed values and its layout.
struct SheetValues {
    values: BTreeMap<(String, String), String>,
    layout: layout::Layout,
}

fn is_whole_sheet(p: &ProtectionData) -> bool {
    [
        &p.top_row_id,
        &p.left_col_id,
        &p.bottom_row_id,
        &p.right_col_id,
    ]
    .iter()
    .all(|c| c.is_empty())
}

/// Where a protection sits now, or `None` when a corner row or column is gone.
fn protected_rect(p: &ProtectionData, l: &layout::Layout) -> Option<Rect> {
    if is_whole_sheet(p) {
        return Some(Rect {
            top: 0,
            left: 0,
            bottom: usize::MAX,
            right: usize::MAX,
        });
    }
    corner_rect(
        [
            &p.top_row_id,
            &p.left_col_id,
            &p.bottom_row_id,
            &p.right_col_id,
        ],
        l,
    )
}

/// A range given by corner ids as positions, or `None` when one is gone.
fn corner_rect(corners: [&String; 4], l: &layout::Layout) -> Option<Rect> {
    let [top, left, bottom, right] = corners;
    let (r1, r2) = (l.rows.index_of(top)?, l.rows.index_of(bottom)?);
    let (c1, c2) = (l.cols.index_of(left)?, l.cols.index_of(right)?);
    Some(Rect {
        top: r1.min(r2),
        left: c1.min(c2),
        bottom: r1.max(r2),
        right: c1.max(c2),
    })
}

/// ` ("Totals")` for a protection with a description.
fn describe(p: &ProtectionData) -> String {
    if p.description.is_empty() {
        String::new()
    } else {
        format!(" ({:?})", p.description)
    }
}

fn article(role: Role) -> &'static str {
    if role == Role::Owner || role == Role::Editor {
        "an"
    } else {
        "a"
    }
}

/// A sheet's stored rows and columns as the engine's layout.
fn build_layout(l: SheetLayout) -> layout::Layout {
    let axis = |entries: Vec<AxisEntryView>| -> Vec<layout::AxisEntry> {
        entries
            .into_iter()
            .map(|e| layout::AxisEntry {
                id: e.id,
                pos: e.pos,
                deleted: e.deleted,
            })
            .collect()
    };
    let rows = layout::Axis::build(&axis(l.rows), formula::MAX_ROWS);
    let cols = layout::Axis::build(&axis(l.cols), formula::MAX_COLS);
    layout::Layout { rows, cols }
}

/// A format keyword as the activity log says it.
fn display_format(format: &str) -> &str {
    if format.is_empty() {
        "Automatic"
    } else {
        format
    }
}

/// `"{sheet}|{a}|{b}"` → its three parts.
fn split_key(key: &str) -> Option<(&str, &str, &str)> {
    let mut parts = key.rsplitn(3, '|');
    let b = parts.next()?;
    let a = parts.next()?;
    let sheet = parts.next()?;
    Some((sheet, a, b))
}

/// The function help, straight from the engine's catalog.
fn builtin_functions() -> Vec<FunctionDef> {
    formula::CATALOG
        .iter()
        .map(|f| FunctionDef {
            name: f.name.into(),
            category: f.category.into(),
            syntax: f.syntax.into(),
            description: f.description.into(),
            example: f.example.into(),
        })
        .collect()
}
