//! Spreadsheet service for mero-sheets.
//!
//! Provides: project initialisation, sheet management (create/rename/delete/list),
//! cell editing with basic formula evaluation, live cursor tracking, built-in
//! function help, and data export.

use calimero_sdk::abi::AbiType;
use calimero_sdk::app;
use calimero_sdk::borsh::{BorshDeserialize, BorshSerialize};
use calimero_sdk::env;
use calimero_sdk::serde::{Deserialize, Serialize};
use calimero_sdk::types::Error as AppError;
use calimero_storage::collections::crdt_meta::MergeError;
use calimero_storage::collections::{AuthoredMap, LwwRegister, Mergeable, SortedMap, UnorderedMap};
use calimero_storage::env as storage_env;
use std::collections::{BTreeMap, HashSet};

use mero_sheets_recalc::{formula, layout, recalc};
use mero_sheets_types::{generate_id, validate_label, validate_sheet_name, Error};

pub mod events;
use events::Event;

// ---------------------------------------------------------------------------
// Internal data structs (Borsh-only — stored in collections)
// ---------------------------------------------------------------------------

/// A sheet tab stored in the shared UnorderedMap.
#[app::mergeable(id = "mero_sheets::SheetData")]
#[derive(Debug, Clone, BorshSerialize, BorshDeserialize, AbiType)]
#[borsh(crate = "calimero_sdk::borsh")]
pub struct SheetData {
    pub id: String,
    pub name: String,
    /// Tab ordering hint (lower = further left).
    pub position: u32,
    pub created_at: u64,
    /// Timestamp of the last rename — used for LWW name merge.
    pub updated_at: u64,
}

impl Mergeable for SheetData {
    fn merge(&mut self, other: &Self) -> Result<(), MergeError> {
        // created_at: keep the earlier value.
        if other.created_at < self.created_at {
            self.created_at = other.created_at;
        }
        // name: newer rename wins; tie-break lexicographically.
        if other.updated_at > self.updated_at
            || (other.updated_at == self.updated_at && other.name > self.name)
        {
            self.name = other.name.clone();
            self.updated_at = other.updated_at;
        }
        // position: lower index wins on conflict.
        if other.position < self.position {
            self.position = other.position;
        }
        Ok(())
    }
}

/// A single cell stored in the shared UnorderedMap.
/// Key: `"{sheet_id}|{row}|{col}"`.
#[app::mergeable(id = "mero_sheets::CellData")]
#[derive(Debug, Clone, BorshSerialize, BorshDeserialize, AbiType)]
#[borsh(crate = "calimero_sdk::borsh")]
pub struct CellData {
    /// Mirrors the map key for ABI convenience.
    pub id: String,
    pub sheet_id: String,
    pub row: u32,
    pub col: u32,
    /// Raw user input (may be a formula like `=SUM(A1:A5)`).
    pub raw_value: String,
    /// Display format for this cell (e.g. "number", "currency", "percent",
    /// "date"; empty = Automatic). Rendered client-side; does not affect
    /// evaluation. Colon-delimited for future options (e.g. "number:2").
    pub format: String,
    pub updated_at: u64,
}

impl Mergeable for CellData {
    fn merge(&mut self, other: &Self) -> Result<(), MergeError> {
        // LWW: newer update wins, tie-broken over EVERY field the branch
        // assigns. Tie-breaking on `raw_value` alone left `format` divergent —
        // two replicas that set the same value with different formats in one
        // clock tick each kept their own, and re-merging never closed it.
        if (other.updated_at, &other.raw_value, &other.format)
            > (self.updated_at, &self.raw_value, &self.format)
        {
            self.raw_value = other.raw_value.clone();
            self.format = other.format.clone();
            self.updated_at = other.updated_at;
        }
        Ok(())
    }
}

/// A cursor as v1 stored it, in a per-author AuthoredMap. Cursors are
/// ephemeral presence since v2; the type remains only so the v2 migration can
/// read the v1 state it drops them from.
#[app::mergeable(id = "mero_sheets::CursorData")]
#[derive(Debug, Clone, BorshSerialize, BorshDeserialize, AbiType)]
#[borsh(crate = "calimero_sdk::borsh")]
pub struct CursorData {
    pub sheet_id: String,
    pub row: u32,
    pub col: u32,
    /// Hex colour assigned deterministically from the author pubkey.
    pub color: String,
    pub updated_at: u64,
}

impl Mergeable for CursorData {
    fn merge(&mut self, other: &Self) -> Result<(), MergeError> {
        // Last update wins — the author only writes their own cursor. The
        // tie-break spans every assigned field, not just `sheet_id`, so an
        // exact clock tie cannot leave row/col/colour divergent.
        if (
            other.updated_at,
            &other.sheet_id,
            other.row,
            other.col,
            &other.color,
        ) > (
            self.updated_at,
            &self.sheet_id,
            self.row,
            self.col,
            &self.color,
        ) {
            self.sheet_id = other.sheet_id.clone();
            self.row = other.row;
            self.col = other.col;
            self.color = other.color.clone();
            self.updated_at = other.updated_at;
        }
        Ok(())
    }
}

/// A collaborator's chosen nickname, keyed by the same device hex the cursors
/// are keyed by (`caller_hex`).
///
/// This exists because the only thing the app could previously put next to a
/// cursor was a raw 64-hex device key, which answers no question anyone has.
/// A nickname has to live HERE and not in `localStorage`: localStorage is
/// per-browser, so a name kept there is visible to exactly the one person who
/// does not need it.
#[app::mergeable(id = "mero_sheets::MemberData")]
#[derive(Debug, Clone, BorshSerialize, BorshDeserialize, AbiType)]
#[borsh(crate = "calimero_sdk::borsh")]
pub struct MemberData {
    pub nickname: String,
    /// First time this device announced itself. Earliest wins on merge — a
    /// later rename must not look like a later arrival.
    pub joined_at: u64,
    pub updated_at: u64,
}

impl Mergeable for MemberData {
    fn merge(&mut self, other: &Self) -> Result<(), MergeError> {
        // Newer rename wins; an exact clock tie breaks on the nickname itself so
        // two devices of one account cannot settle on different strings. The
        // tie-break spans the assigned field, not a field beside it — an
        // equal-clock compare that ignores the value is how a write gets
        // silently discarded.
        if (other.updated_at, &other.nickname) > (self.updated_at, &self.nickname) {
            self.nickname = other.nickname.clone();
            self.updated_at = other.updated_at;
        }
        // Arrival is a minimum, not a last-write: whichever replica saw this
        // member first is the truth, regardless of which rename landed last.
        if other.joined_at < self.joined_at {
            self.joined_at = other.joined_at;
        }
        Ok(())
    }
}

/// One row or column added to a sheet, or one deleted. Keyed by
/// `"{sheet_id}|r|{id}"` / `"{sheet_id}|c|{id}"`; see the recalc crate's
/// `layout` module for how entries order a sheet.
#[app::mergeable(id = "mero_sheets::AxisData")]
#[derive(Debug, Clone, BorshSerialize, BorshDeserialize, AbiType)]
#[borsh(crate = "calimero_sdk::borsh")]
pub struct AxisData {
    /// Fractional position: decimal digits, compared as strings.
    pub pos: String,
    pub deleted: bool,
    pub updated_at: u64,
}

impl Mergeable for AxisData {
    fn merge(&mut self, other: &Self) -> Result<(), MergeError> {
        // Deleted or not is last-writer-wins, so an undo can restore a row;
        // an exact clock tie keeps it deleted.
        if (other.updated_at, other.deleted) > (self.updated_at, self.deleted) {
            self.deleted = other.deleted;
            self.updated_at = other.updated_at;
        }
        // A position is fixed when the id is created; the smaller string wins
        // so two replicas can never disagree on it.
        if self.pos.is_empty() || (!other.pos.is_empty() && other.pos < self.pos) {
            self.pos = other.pos.clone();
        }
        Ok(())
    }
}

/// A cell's display format, kept apart from its value so that formatting a
/// cell and typing in it at the same moment both survive. Keyed like the cell.
#[app::mergeable(id = "mero_sheets::FormatData")]
#[derive(Debug, Clone, BorshSerialize, BorshDeserialize, AbiType)]
#[borsh(crate = "calimero_sdk::borsh")]
pub struct FormatData {
    /// Empty means Automatic, and overrides a format the cell carried from v1.
    pub format: String,
    pub updated_at: u64,
}

impl Mergeable for FormatData {
    fn merge(&mut self, other: &Self) -> Result<(), MergeError> {
        if (other.updated_at, &other.format) > (self.updated_at, &self.format) {
            self.format = other.format.clone();
            self.updated_at = other.updated_at;
        }
        Ok(())
    }
}

/// A named range: a name that formulas can use in place of a reference.
/// Keyed by the upper-case name; an empty target means deleted (a removed key
/// would tombstone the name and block defining it again).
#[app::mergeable(id = "mero_sheets::NamedRangeData")]
#[derive(Debug, Clone, BorshSerialize, BorshDeserialize, AbiType)]
#[borsh(crate = "calimero_sdk::borsh")]
pub struct NamedRangeData {
    /// The name as it was typed, for display.
    pub name: String,
    /// A reference in stored form (`[sheet-id]!A1:B9`).
    pub target: String,
    pub updated_at: u64,
}

impl Mergeable for NamedRangeData {
    fn merge(&mut self, other: &Self) -> Result<(), MergeError> {
        if (other.updated_at, &other.target, &other.name)
            > (self.updated_at, &self.target, &self.name)
        {
            self.name = other.name.clone();
            self.target = other.target.clone();
            self.updated_at = other.updated_at;
        }
        Ok(())
    }
}

/// Who last changed a cell and when, keyed like the cell.
#[app::mergeable(id = "mero_sheets::CellMeta")]
#[derive(Debug, Clone, BorshSerialize, BorshDeserialize, AbiType)]
#[borsh(crate = "calimero_sdk::borsh")]
pub struct CellMeta {
    /// Member id (`whoami`).
    pub author: String,
    pub at: u64,
}

impl Mergeable for CellMeta {
    fn merge(&mut self, other: &Self) -> Result<(), MergeError> {
        if (other.at, &other.author) > (self.at, &self.author) {
            self.author = other.author.clone();
            self.at = other.at;
        }
        Ok(())
    }
}

/// One cell's change within an activity entry: its raw value and format
/// before and after.
#[derive(
    Debug, Clone, PartialEq, BorshSerialize, BorshDeserialize, Serialize, Deserialize, AbiType,
)]
#[borsh(crate = "calimero_sdk::borsh")]
#[serde(crate = "calimero_sdk::serde")]
pub struct CellChange {
    pub row_id: String,
    pub col_id: String,
    pub before_raw: String,
    pub before_format: String,
    pub after_raw: String,
    pub after_format: String,
}

/// One entry of the workbook's activity log: who did what, when. Keyed by
/// `"{at:020}|{author}|{nonce}"`, so the log reads in time order and a
/// "since" query is a range seek.
#[app::mergeable(id = "mero_sheets::ActivityData")]
#[derive(Debug, Clone, BorshSerialize, BorshDeserialize, AbiType)]
#[borsh(crate = "calimero_sdk::borsh")]
pub struct ActivityData {
    pub author: String,
    pub at: u64,
    /// Empty for workbook-level actions (a named range).
    pub sheet_id: String,
    /// `cells`, `rows`, `cols`, `sheet` or `name`.
    pub kind: String,
    pub summary: String,
    /// How many cells changed; `changes` holds at most [`MAX_LOGGED_CHANGES`].
    pub count: u32,
    pub changes: Vec<CellChange>,
}

impl Mergeable for ActivityData {
    fn merge(&mut self, _other: &Self) -> Result<(), MergeError> {
        // Entries are written once under a unique key and never changed.
        Ok(())
    }
}

/// How many cell changes one activity entry keeps (a 200-cell paste logs
/// its first 50 and the count).
pub const MAX_LOGGED_CHANGES: usize = 50;

/// A comment on a cell, or a reply to one. Keyed by comment id.
#[app::mergeable(id = "mero_sheets::CommentData")]
#[derive(Debug, Clone, BorshSerialize, BorshDeserialize, AbiType)]
#[borsh(crate = "calimero_sdk::borsh")]
pub struct CommentData {
    pub sheet_id: String,
    pub row_id: String,
    pub col_id: String,
    /// Member id of the author.
    pub author: String,
    pub text: String,
    /// Member ids named with `@nickname` in the text.
    pub mentions: Vec<String>,
    /// The comment this replies to; empty for a thread's first comment.
    pub parent: String,
    pub resolved: bool,
    pub deleted: bool,
    pub created_at: u64,
    pub updated_at: u64,
}

impl Mergeable for CommentData {
    fn merge(&mut self, other: &Self) -> Result<(), MergeError> {
        // Text, resolved and deleted change together, last writer wins; the
        // rest is fixed when the comment is made.
        if (other.updated_at, other.deleted, other.resolved, &other.text)
            > (self.updated_at, self.deleted, self.resolved, &self.text)
        {
            self.text = other.text.clone();
            self.mentions = other.mentions.clone();
            self.resolved = other.resolved;
            self.deleted = other.deleted;
            self.updated_at = other.updated_at;
        }
        Ok(())
    }
}

/// The longest comment accepted, in characters.
pub const MAX_COMMENT_CHARS: usize = 2000;

// ---------------------------------------------------------------------------
// View types returned to callers (must derive Serialize + Deserialize)
// ---------------------------------------------------------------------------

/// The project's own identity, as the UI titles it.
///
/// `init_project` has always written `project_name`, and until now NOTHING
/// could read it back — there was no view method over the register at all. That
/// is the whole reason the workspace list fell back to names cached in
/// `localStorage`, which meant every peer but the creator saw "Workspace 1".
#[derive(Debug, Clone, Serialize, Deserialize, AbiType)]
#[serde(crate = "calimero_sdk::serde")]
pub struct Project {
    /// Empty until `init_project` runs.
    pub id: String,
    pub name: String,
    pub created_at: u64,
}

/// One collaborator, by the name they chose.
#[derive(Debug, Clone, Serialize, Deserialize, AbiType)]
#[serde(crate = "calimero_sdk::serde")]
pub struct Member {
    /// Device hex — the same key `Cursor.author` carries, so a roster and the
    /// live cursors join on it without a translation step.
    pub id: String,
    pub nickname: String,
    pub joined_at: u64,
    pub updated_at: u64,
}

#[derive(Debug, Clone, Serialize, Deserialize, AbiType)]
#[serde(crate = "calimero_sdk::serde")]
pub struct Sheet {
    pub id: String,
    pub name: String,
    pub position: u32,
    pub created_at: u64,
}

/// A cell, by row and column id. A legacy id is the cell's old 0-based
/// position; the client places ids with the sheet's layout (`get_layouts`).
#[derive(Debug, Clone, Serialize, Deserialize, AbiType)]
#[serde(crate = "calimero_sdk::serde")]
pub struct Cell {
    pub id: String,
    pub sheet_id: String,
    pub row_id: String,
    pub col_id: String,
    /// As stored: references name rows and columns by id.
    pub raw_value: String,
    pub computed_value: String,
    pub format: String,
    pub updated_at: u64,
    /// Member id of whoever last changed the cell; empty for a cell last
    /// written before the activity log existed.
    pub last_editor: String,
    pub last_edited_at: u64,
}

/// A live (not deleted) comment.
#[derive(Debug, Clone, Serialize, Deserialize, AbiType)]
#[serde(crate = "calimero_sdk::serde")]
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
    pub created_at: u64,
    pub updated_at: u64,
}

/// An activity-log entry, newest first from `get_activity`.
#[derive(Debug, Clone, Serialize, Deserialize, AbiType)]
#[serde(crate = "calimero_sdk::serde")]
pub struct ActivityEntry {
    pub id: String,
    pub author: String,
    pub at: u64,
    pub sheet_id: String,
    pub kind: String,
    pub summary: String,
    pub count: u32,
    pub changes: Vec<CellChange>,
}

#[derive(Debug, Clone, Serialize, Deserialize, AbiType)]
#[serde(crate = "calimero_sdk::serde")]
// Adjacently tagged as {name, payload} — the canonical calimero enum wire form
// that `AbiType` describes and `calimero-abi-codegen` generates a client for.
// (`tag = "kind"` produced a flat {kind, ...} wire the ABI never reflected, so
// the generated client and the contract disagreed on the wire.)
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

/// A structural edit: add a row or column at a fractional position, delete
/// one by id, or restore a deleted one (an undo). Every op is one write,
/// however many cells the sheet holds.
#[derive(Debug, Clone, Serialize, Deserialize, AbiType)]
#[serde(crate = "calimero_sdk::serde")]
#[serde(tag = "name", content = "payload")]
pub enum AxisOp {
    InsertRow { id: String, pos: String },
    InsertCol { id: String, pos: String },
    DeleteRow { id: String },
    DeleteCol { id: String },
    RestoreRow { id: String },
    RestoreCol { id: String },
}

/// One explicit row or column entry of a sheet.
#[derive(Debug, Clone, Serialize, Deserialize, AbiType)]
#[serde(crate = "calimero_sdk::serde")]
pub struct AxisEntryView {
    pub id: String,
    pub pos: String,
    pub deleted: bool,
}

/// A sheet's explicit row and column entries. A sheet with none has the
/// legacy layout: row id `k` at row `k`.
#[derive(Debug, Clone, Serialize, Deserialize, AbiType)]
#[serde(crate = "calimero_sdk::serde")]
pub struct SheetLayout {
    pub sheet_id: String,
    pub rows: Vec<AxisEntryView>,
    pub cols: Vec<AxisEntryView>,
}

#[derive(Debug, Clone, Serialize, Deserialize, AbiType)]
#[serde(crate = "calimero_sdk::serde")]
pub struct NamedRange {
    pub name: String,
    /// A reference in stored form.
    pub target: String,
}

#[derive(Debug, Clone, Serialize, Deserialize, AbiType)]
#[serde(crate = "calimero_sdk::serde")]
pub struct FunctionDef {
    pub name: String,
    pub category: String,
    pub syntax: String,
    pub description: String,
    pub example: String,
}

/// The most ops one `apply_cell_ops` call accepts; see its doc. Measured on a
/// 0.11.0-rc.43 node, with every op also stamping the cell's last editor: the
/// costliest op (a format on an empty cell: cell, format and editor writes)
/// fits 160 to a call and not 200, so 100 keeps a wide margin. A commit's cost
/// does not grow with the context's size (a 200-op commit took ~115 ms at 0
/// and at 4000 cells). The client's `MAX_OPS_PER_APPLY`
/// (app/src/spreadsheet/ops.ts) and the perf harness's `APPLY_CHUNK` split
/// batches to this size.
pub const MAX_OPS_PER_APPLY: usize = 100;

// ---------------------------------------------------------------------------
// State
// ---------------------------------------------------------------------------

/// Schema versions, as the migration event reports them.
const SCHEMA_V1: &str = "1";
const SCHEMA_V2: &str = "2";

// `#[app::state]` injects borsh derives itself (SDK 0.11+).
//
// v2 adds row/column ids (`axes`), per-field formats (`formats`) and named
// ranges (`names`), and drops v1's contract-stored cursors. Every v1
// collection is carried by id and no cell is rewritten, so the migration costs
// the same for a workbook of any size: rewriting cells in one execution would
// run out of gas past a few hundred of them.
#[app::state(version = 2, emits = for<'a> Event<'a>)]
#[derive(app::Migrate)]
#[migrate(
    from = SpreadsheetV1,
    emit = Event::Migrated { from_version: SCHEMA_V1, to_version: SCHEMA_V2 }
)]
pub struct Spreadsheet {
    /// Set once by `init_project`; empty until then.
    project_id: LwwRegister<String>,
    project_name: LwwRegister<String>,
    project_created_at: LwwRegister<u64>,
    /// Sheet tabs keyed by sheet id.
    sheets: UnorderedMap<String, SheetData>,
    /// Cells keyed by `"{sheet_id}|{row_id}|{col_id}"`. A v1 key
    /// (`"{sheet_id}|{row}|{col}"`) is the same cell: legacy ids are positions.
    cells: UnorderedMap<String, CellData>,
    /// Chosen nicknames keyed by device hex (`whoami`).
    ///
    /// An `UnorderedMap`, not an `AuthoredMap`: the roster must be readable by
    /// everyone and survive a member going away.
    members: UnorderedMap<String, MemberData>,
    /// Added and deleted rows and columns, keyed `"{sheet_id}|r|{id}"` and
    /// `"{sheet_id}|c|{id}"`.
    #[migrate(new = UnorderedMap::new_with_field_name("spreadsheet:axes"))]
    axes: UnorderedMap<String, AxisData>,
    /// Cell formats, keyed like `cells`. Where a cell has no entry, the format
    /// it carried from v1 (`CellData::format`) applies.
    #[migrate(new = UnorderedMap::new_with_field_name("spreadsheet:formats"))]
    formats: UnorderedMap<String, FormatData>,
    /// Named ranges keyed by upper-case name.
    #[migrate(new = UnorderedMap::new_with_field_name("spreadsheet:names"))]
    names: UnorderedMap<String, NamedRangeData>,
    /// Who last changed each cell, keyed like `cells`.
    #[migrate(new = UnorderedMap::new_with_field_name("spreadsheet:cell_meta"))]
    cell_meta: UnorderedMap<String, CellMeta>,
    /// The activity log, in time order.
    #[migrate(new = SortedMap::new_with_field_name("spreadsheet:activity"))]
    activity: SortedMap<String, ActivityData>,
    /// Cell comments and replies, keyed by comment id.
    #[migrate(new = UnorderedMap::new_with_field_name("spreadsheet:comments"))]
    comments: UnorderedMap<String, CommentData>,
}

/// The v1 state, read once by the v2 migration.
#[derive(BorshDeserialize)]
#[borsh(crate = "calimero_sdk::borsh")]
struct SpreadsheetV1 {
    project_id: LwwRegister<String>,
    project_name: LwwRegister<String>,
    project_created_at: LwwRegister<u64>,
    sheets: UnorderedMap<String, SheetData>,
    cells: UnorderedMap<String, CellData>,
    #[allow(dead_code, reason = "v1 field the v2 migration drops")]
    cursors: AuthoredMap<String, CursorData>,
    members: UnorderedMap<String, MemberData>,
}

#[app::logic]
impl Spreadsheet {
    #[app::init]
    pub fn init() -> Spreadsheet {
        Spreadsheet {
            project_id: LwwRegister::new(String::new()),
            project_name: LwwRegister::new(String::new()),
            project_created_at: LwwRegister::new(0),
            sheets: UnorderedMap::new_with_field_name("spreadsheet:sheets"),
            cells: UnorderedMap::new_with_field_name("spreadsheet:cells"),
            members: UnorderedMap::new_with_field_name("spreadsheet:members"),
            axes: UnorderedMap::new_with_field_name("spreadsheet:axes"),
            formats: UnorderedMap::new_with_field_name("spreadsheet:formats"),
            names: UnorderedMap::new_with_field_name("spreadsheet:names"),
            cell_meta: UnorderedMap::new_with_field_name("spreadsheet:cell_meta"),
            activity: SortedMap::new_with_field_name("spreadsheet:activity"),
            comments: UnorderedMap::new_with_field_name("spreadsheet:comments"),
        }
    }

    // ---- Project ----

    pub fn init_project(&mut self, name: String) -> app::Result<String> {
        if !self.project_id.get().is_empty() {
            return Err(AppError::from(Error::Invalid(
                "project already initialised".into(),
            )));
        }
        validate_label(&name).map_err(AppError::from)?;
        let now = storage_env::time_now();
        let mut nonce = [0u8; 4];
        env::random_bytes(&mut nonce);
        let id = generate_id("proj", now, &nonce);
        self.project_id.set(id.clone());
        self.project_name.set(name.clone());
        self.project_created_at.set(now);
        app::emit!(Event::ProjectInitialized {
            id: &id,
            name: &name,
        });
        Ok(id)
    }

    /// The project's id, name and creation time.
    ///
    /// New. `init_project` wrote the name into `project_name` from the first
    /// version of this contract and no method ever read it, so the name was
    /// replicated to every peer and visible to none of them.
    ///
    /// Never errors and never 404s: an uninitialised project is a real,
    /// transient state (a context exists the moment it is created, `init_project`
    /// lands a round-trip later) and it answers with empty strings so a caller
    /// can render a placeholder instead of an error.
    pub fn get_project(&self) -> app::Result<Project> {
        Ok(Project {
            id: self.project_id.get().clone(),
            name: self.project_name.get().clone(),
            created_at: *self.project_created_at.get(),
        })
    }

    // ---- Members ----

    /// The id THIS caller is known by in here — the key its cursor is authored
    /// by and its roster row is stored under.
    ///
    /// Exists so the frontend never has to guess which row is "me". It had been
    /// comparing `Cursor.author` against the context's executor public key,
    /// which is a different value from a different family: a device key and a
    /// context identity are both 64 hex, so the comparison type-checks, returns
    /// false forever, and shows the local user as a stranger in their own
    /// spreadsheet. Asking the contract costs one read and cannot be wrong.
    pub fn whoami(&self) -> app::Result<String> {
        Ok(self.caller_hex())
    }

    /// Announce this device under a chosen nickname, or rename it.
    ///
    /// Idempotent by design — it is called on every open, not only on the first
    /// one, because there is no reliable "first" for a replicated context and a
    /// join that only registers once leaves anyone whose first attempt failed
    /// permanently anonymous. `joined_at` is preserved across re-calls so a
    /// rename does not reorder the roster.
    pub fn join(&mut self, nickname: String) -> app::Result<()> {
        let nickname = nickname.trim().to_string();
        validate_label(&nickname).map_err(AppError::from)?;
        let me = self.caller_hex();
        let now = storage_env::time_now();

        let existing = self.members.get(&me)?;
        let joined_at = existing.as_ref().map_or(now, |m| m.joined_at);
        let is_new = existing.is_none();

        self.members.insert(
            me.clone(),
            MemberData {
                nickname: nickname.clone(),
                joined_at,
                updated_at: now,
            },
        )?;

        if is_new {
            app::emit!(Event::MemberJoined {
                id: &me,
                nickname: &nickname,
            });
        } else {
            app::emit!(Event::MemberRenamed {
                id: &me,
                nickname: &nickname,
            });
        }
        Ok(())
    }

    /// Everyone who has ever announced themselves, oldest arrival first.
    ///
    /// Sorted here rather than in the UI so every peer renders the same order;
    /// the map's own iteration order is not a stable thing to show a person.
    pub fn get_members(&self) -> app::Result<Vec<Member>> {
        let mut members: Vec<Member> = self
            .members
            .entries()?
            .map(|(id, d)| Member {
                id,
                nickname: d.nickname,
                joined_at: d.joined_at,
                updated_at: d.updated_at,
            })
            .collect();
        members.sort_by(|a, b| a.joined_at.cmp(&b.joined_at).then(a.id.cmp(&b.id)));
        Ok(members)
    }

    // ---- Sheets ----

    /// Make `desired` unique among existing sheet names (excluding `exclude_id`),
    /// auto-suffixing ` (2)`, ` (3)`, … on collision.
    fn unique_sheet_name(&self, desired: &str, exclude_id: Option<&str>) -> app::Result<String> {
        let existing: Vec<String> = self
            .sheets
            .entries()
            .map_err(|e| AppError::msg(format!("sheets.entries: {e}")))?
            .filter(|(id, _)| exclude_id != Some(id.as_str()))
            .map(|(_, d)| d.name.clone())
            .collect();
        if !existing.iter().any(|n| n == desired) {
            return Ok(desired.to_string());
        }
        for n in 2u32.. {
            let cand = format!("{desired} ({n})");
            if !existing.iter().any(|x| x == &cand) {
                return Ok(cand);
            }
        }
        Ok(desired.to_string()) // unreachable in practice
    }

    pub fn create_sheet(&mut self, name: String) -> app::Result<String> {
        validate_sheet_name(&name).map_err(AppError::from)?;
        let name = self.unique_sheet_name(&name, None)?;
        let now = storage_env::time_now();
        let mut nonce = [0u8; 4];
        env::random_bytes(&mut nonce);
        let id = generate_id("sheet", now, &nonce);
        let position = self
            .sheets
            .len()
            .map_err(|e| AppError::msg(format!("sheets.len: {e}")))? as u32;
        let data = SheetData {
            id: id.clone(),
            name: name.clone(),
            position,
            created_at: now,
            updated_at: now,
        };
        self.sheets
            .insert(id.clone(), data)
            .map_err(|e| AppError::msg(format!("sheets.insert: {e}")))?;
        self.log(&id, "sheet", format!("added sheet {name}"), 0, Vec::new())?;
        app::emit!(Event::SheetCreated {
            id: &id,
            name: &name,
        });
        Ok(id)
    }

    pub fn rename_sheet(&mut self, sheet_id: String, new_name: String) -> app::Result<()> {
        validate_sheet_name(&new_name).map_err(AppError::from)?;
        // Reject a rename that collides with a DIFFERENT sheet (renaming to the
        // current name is a no-op below).
        let collides = self
            .sheets
            .entries()
            .map_err(|e| AppError::msg(format!("sheets.entries: {e}")))?
            .any(|(id, d)| id != sheet_id && d.name == new_name);
        if collides {
            return Err(AppError::from(Error::Invalid(format!(
                "a sheet named '{new_name}' already exists"
            ))));
        }
        let now = storage_env::time_now();
        {
            let mut guard = self
                .sheets
                .get_mut(&sheet_id)
                .map_err(|e| AppError::msg(format!("sheets.get_mut: {e}")))?
                .ok_or_else(|| AppError::from(Error::NotFound(sheet_id.clone())))?;
            guard.name = new_name.clone();
            guard.updated_at = now;
        }

        // Cross-sheet references are id-based ([id]!...), so a rename changes
        // no formula and no computed value: nothing to rewrite, nothing to
        // recompute.
        self.log(
            &sheet_id,
            "sheet",
            format!("renamed a sheet to {new_name}"),
            0,
            Vec::new(),
        )?;
        app::emit!(Event::SheetRenamed {
            id: &sheet_id,
            name: &new_name,
        });
        Ok(())
    }

    pub fn delete_sheet(&mut self, sheet_id: String) -> app::Result<()> {
        let removed = self
            .sheets
            .remove(&sheet_id)
            .map_err(|e| AppError::msg(format!("sheets.remove: {e}")))?;
        let Some(removed) = removed else {
            return Err(AppError::from(Error::NotFound(sheet_id.clone())));
        };
        self.log(
            &sheet_id,
            "sheet",
            format!("deleted sheet {}", removed.name),
            0,
            Vec::new(),
        )?;
        // The sheet's cells are left in storage and skipped on every read:
        // removing them one by one costs gas per cell, and a big sheet would
        // not fit one execution.
        app::emit!(Event::SheetDeleted { id: &sheet_id });
        Ok(())
    }

    pub fn list_sheets(&self) -> app::Result<Vec<Sheet>> {
        let mut out: Vec<Sheet> = self
            .sheets
            .entries()
            .map_err(|e| AppError::msg(format!("sheets.entries: {e}")))?
            .map(|(_, d)| Sheet {
                id: d.id.clone(),
                name: d.name.clone(),
                position: d.position,
                created_at: d.created_at,
            })
            .collect();
        out.sort_by_key(|s| (s.position, s.created_at));
        Ok(out)
    }

    // ---- Cells ----
    //
    // A cell is keyed by `"{sheet_id}|{row_id}|{col_id}"` (see the recalc
    // crate's `layout`): a legacy id is the old 0-based position, so every key
    // written before row/column ids existed still names the same cell.
    //
    // Storage helpers emit nothing. Single-cell methods emit their own event
    // and `apply_cell_ops` one for the whole batch, which keeps a bulk apply
    // under the runtime's per-execution event cap.

    fn require_sheet(&self, sheet_id: &str) -> app::Result<()> {
        if self
            .sheets
            .get(sheet_id)
            .map_err(|e| AppError::msg(format!("sheets.get: {e}")))?
            .is_none()
        {
            return Err(AppError::from(Error::NotFound(sheet_id.to_string())));
        }
        Ok(())
    }

    /// A row or column id goes into storage keys and stored formulas, so it
    /// must be short and alphanumeric.
    fn check_id(id: &str) -> app::Result<()> {
        if id.is_empty() || id.len() > 32 || !id.bytes().all(|b| b.is_ascii_alphanumeric()) {
            return Err(AppError::from(Error::Invalid(format!(
                "row/column id {id:?} must be 1-32 ASCII letters and digits"
            ))));
        }
        Ok(())
    }

    /// Store a raw value (literal or formula, stored verbatim). The format is
    /// not touched: it lives in `formats`. Creates the cell if absent. No event.
    fn store_value(
        &mut self,
        sheet_id: &str,
        row_id: &str,
        col_id: &str,
        raw_value: String,
    ) -> app::Result<String> {
        Spreadsheet::check_id(row_id)?;
        Spreadsheet::check_id(col_id)?;
        let key = Spreadsheet::cell_key(sheet_id, row_id, col_id);
        let now = storage_env::time_now();
        let exists = self
            .cells
            .get(&key)
            .map_err(|e| AppError::msg(format!("cells.get: {e}")))?
            .is_some();
        if exists {
            if let Some(mut guard) = self
                .cells
                .get_mut(&key)
                .map_err(|e| AppError::msg(format!("cells.get_mut: {e}")))?
            {
                guard.raw_value = raw_value;
                guard.updated_at = now;
            }
        } else {
            self.cells
                .insert(
                    key.clone(),
                    CellData {
                        id: key.clone(),
                        sheet_id: sheet_id.to_string(),
                        row: layout::legacy_index(row_id).unwrap_or(u32::MAX),
                        col: layout::legacy_index(col_id).unwrap_or(u32::MAX),
                        raw_value,
                        format: String::new(),
                        updated_at: now,
                    },
                )
                .map_err(|e| AppError::msg(format!("cells.insert: {e}")))?;
        }
        Ok(key)
    }

    /// Store only the display format, in its own register so it merges apart
    /// from the value. Creates an empty cell if absent, so a cell can be
    /// formatted before anything is typed in it. No event.
    fn store_format(
        &mut self,
        sheet_id: &str,
        row_id: &str,
        col_id: &str,
        format: String,
    ) -> app::Result<String> {
        let key = Spreadsheet::cell_key(sheet_id, row_id, col_id);
        let has_cell = self
            .cells
            .get(&key)
            .map_err(|e| AppError::msg(format!("cells.get: {e}")))?
            .is_some();
        if !has_cell {
            self.store_value(sheet_id, row_id, col_id, String::new())?;
        }
        let entry = FormatData {
            format,
            updated_at: storage_env::time_now(),
        };
        let exists = self
            .formats
            .get(&key)
            .map_err(|e| AppError::msg(format!("formats.get: {e}")))?
            .is_some();
        if exists {
            if let Some(mut guard) = self
                .formats
                .get_mut(&key)
                .map_err(|e| AppError::msg(format!("formats.get_mut: {e}")))?
            {
                *guard = entry;
            }
        } else {
            self.formats
                .insert(key.clone(), entry)
                .map_err(|e| AppError::msg(format!("formats.insert: {e}")))?;
        }
        Ok(key)
    }

    /// Soft-clear value and format: blank in place rather than removed, since
    /// removing tombstones the deterministic key and blocks a later write to
    /// the same cell. A fully blank cell is treated as absent everywhere.
    /// No event.
    fn store_clear(&mut self, sheet_id: &str, row_id: &str, col_id: &str) -> app::Result<()> {
        let key = Spreadsheet::cell_key(sheet_id, row_id, col_id);
        let exists = self
            .cells
            .get(&key)
            .map_err(|e| AppError::msg(format!("cells.get: {e}")))?
            .is_some();
        if !exists {
            return Ok(());
        }
        self.store_value(sheet_id, row_id, col_id, String::new())?;
        self.store_format(sheet_id, row_id, col_id, String::new())?;
        Ok(())
    }

    pub fn set_cell(
        &mut self,
        sheet_id: String,
        row_id: String,
        col_id: String,
        raw_value: String,
    ) -> app::Result<String> {
        let key = Spreadsheet::cell_key(&sheet_id, &row_id, &col_id);
        self.edit_cells(
            &sheet_id,
            vec![CellOp::Set {
                row_id,
                col_id,
                raw_value,
            }],
        )?;
        app::emit!(Event::CellUpdated {
            id: &key,
            sheet_id: &sheet_id
        });
        Ok(key)
    }

    /// Set only the display format of a cell, preserving its value. `format`
    /// is a keyword like "number"/"currency"/"percent"/"date" ("" = Automatic).
    pub fn set_cell_format(
        &mut self,
        sheet_id: String,
        row_id: String,
        col_id: String,
        format: String,
    ) -> app::Result<String> {
        let key = Spreadsheet::cell_key(&sheet_id, &row_id, &col_id);
        self.edit_cells(
            &sheet_id,
            vec![CellOp::Format {
                row_id,
                col_id,
                format,
            }],
        )?;
        app::emit!(Event::CellUpdated {
            id: &key,
            sheet_id: &sheet_id
        });
        Ok(key)
    }

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
        app::emit!(Event::CellCleared {
            sheet_id: &sheet_id,
            row_id: &row_id,
            col_id: &col_id,
        });
        Ok(())
    }

    /// Apply a batch of cell operations to one sheet in a single mutation, with
    /// ONE `CellsChanged` event for the whole batch.
    ///
    /// At most [`MAX_OPS_PER_APPLY`] ops. One execution has a fixed gas budget
    /// (1e9 points on 0.11.0-rc.43), and a batch that exhausts it fails as a
    /// whole with nothing written. Refusing early says why; callers split
    /// larger range ops.
    pub fn apply_cell_ops(&mut self, sheet_id: String, ops: Vec<CellOp>) -> app::Result<()> {
        if ops.len() > MAX_OPS_PER_APPLY {
            return Err(AppError::from(Error::Invalid(format!(
                "{} cell ops in one apply_cell_ops; the limit is {MAX_OPS_PER_APPLY}, split the batch",
                ops.len()
            ))));
        }
        let count = ops.len() as u32;
        self.edit_cells(&sheet_id, ops)?;
        app::emit!(Event::CellsChanged {
            sheet_id: &sheet_id,
            count
        });
        Ok(())
    }

    /// A cell's raw value and effective format.
    fn cell_state(&self, key: &str) -> app::Result<(String, String)> {
        let cell = self
            .cells
            .get(key)
            .map_err(|e| AppError::msg(format!("cells.get: {e}")))?;
        let format = self
            .formats
            .get(key)
            .map_err(|e| AppError::msg(format!("formats.get: {e}")))?;
        Ok(match (cell, format) {
            (Some(c), Some(f)) => (c.raw_value.clone(), f.format.clone()),
            (Some(c), None) => (c.raw_value.clone(), c.format.clone()),
            (None, Some(f)) => (String::new(), f.format.clone()),
            (None, None) => (String::new(), String::new()),
        })
    }

    /// Apply cell ops and record them: each changed cell's last editor, and
    /// one activity entry for the whole batch.
    fn edit_cells(&mut self, sheet_id: &str, ops: Vec<CellOp>) -> app::Result<()> {
        self.require_sheet(sheet_id)?;
        let mut touched: BTreeMap<String, (String, String, (String, String))> = BTreeMap::new();
        for op in &ops {
            let (row_id, col_id) = match op {
                CellOp::Set { row_id, col_id, .. }
                | CellOp::Format { row_id, col_id, .. }
                | CellOp::Clear { row_id, col_id } => (row_id, col_id),
            };
            let key = Spreadsheet::cell_key(sheet_id, row_id, col_id);
            if let std::collections::btree_map::Entry::Vacant(slot) = touched.entry(key) {
                let before = self.cell_state(slot.key())?;
                slot.insert((row_id.clone(), col_id.clone(), before));
            }
        }
        for op in ops {
            match op {
                CellOp::Set {
                    row_id,
                    col_id,
                    raw_value,
                } => {
                    self.store_value(sheet_id, &row_id, &col_id, raw_value)?;
                }
                CellOp::Format {
                    row_id,
                    col_id,
                    format,
                } => {
                    self.store_format(sheet_id, &row_id, &col_id, format)?;
                }
                CellOp::Clear { row_id, col_id } => {
                    self.store_clear(sheet_id, &row_id, &col_id)?;
                }
            }
        }
        let author = self.caller_hex();
        let at = storage_env::time_now();
        let mut changes = Vec::new();
        for (key, (row_id, col_id, before)) in touched {
            let after = self.cell_state(&key)?;
            if after == before {
                continue;
            }
            let meta = CellMeta {
                author: author.clone(),
                at,
            };
            self.put(|s| &mut s.cell_meta, key, meta)?;
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
        let count = changes.len() as u32;
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
        self.log(sheet_id, "cells", summary, count, changes)
    }

    /// Insert or replace a map entry.
    fn put<V>(
        &mut self,
        map: impl Fn(&mut Self) -> &mut UnorderedMap<String, V>,
        key: String,
        value: V,
    ) -> app::Result<()>
    where
        V: BorshSerialize + BorshDeserialize + Mergeable,
    {
        let exists = map(self)
            .get(&key)
            .map_err(|e| AppError::msg(format!("get: {e}")))?
            .is_some();
        if exists {
            if let Some(mut guard) = map(self)
                .get_mut(&key)
                .map_err(|e| AppError::msg(format!("get_mut: {e}")))?
            {
                *guard = value;
            }
        } else {
            map(self)
                .insert(key, value)
                .map_err(|e| AppError::msg(format!("insert: {e}")))?;
        }
        Ok(())
    }

    /// Append an activity entry.
    fn log(
        &mut self,
        sheet_id: &str,
        kind: &str,
        summary: String,
        count: u32,
        changes: Vec<CellChange>,
    ) -> app::Result<()> {
        let author = self.caller_hex();
        let at = storage_env::time_now();
        let mut nonce = [0u8; 4];
        env::random_bytes(&mut nonce);
        let key = format!("{at:020}|{author}|{}", hex::encode(nonce));
        self.activity
            .insert(
                key,
                ActivityData {
                    author,
                    at,
                    sheet_id: sheet_id.to_string(),
                    kind: kind.to_string(),
                    summary,
                    count,
                    changes,
                },
            )
            .map_err(|e| AppError::msg(format!("activity.insert: {e}")))?;
        Ok(())
    }

    /// Activity since `since` (nanoseconds), newest first, at most `limit`
    /// (capped at 500) entries.
    pub fn get_activity(&self, since: u64, limit: u32) -> app::Result<Vec<ActivityEntry>> {
        let mut out: Vec<ActivityEntry> = self
            .activity
            .range(format!("{since:020}")..)
            .map_err(|e| AppError::msg(format!("activity.range: {e}")))?
            .map(|(id, d)| ActivityEntry {
                id,
                author: d.author,
                at: d.at,
                sheet_id: d.sheet_id,
                kind: d.kind,
                summary: d.summary,
                count: d.count,
                changes: d.changes,
            })
            .collect();
        out.reverse();
        out.truncate(limit.min(500) as usize);
        Ok(out)
    }

    // ---- Comments ----

    /// Comment on a cell, or reply to a comment (`parent`). `@nickname` in the
    /// text mentions that member: the `CommentAdded` event carries their ids,
    /// and their client tells them. Returns the comment id.
    pub fn add_comment(
        &mut self,
        sheet_id: String,
        row_id: String,
        col_id: String,
        text: String,
        parent: String,
    ) -> app::Result<String> {
        self.require_sheet(&sheet_id)?;
        Spreadsheet::check_id(&row_id)?;
        Spreadsheet::check_id(&col_id)?;
        let text = Spreadsheet::check_comment(text)?;
        if !parent.is_empty() && self.live_comment(&parent)?.is_none() {
            return Err(AppError::from(Error::NotFound(parent)));
        }
        let author = self.caller_hex();
        let now = storage_env::time_now();
        let mut nonce = [0u8; 4];
        env::random_bytes(&mut nonce);
        let id = generate_id("comment", now, &nonce);
        let mentions = self.mentions_in(&text)?;
        self.comments
            .insert(
                id.clone(),
                CommentData {
                    sheet_id: sheet_id.clone(),
                    row_id,
                    col_id,
                    author: author.clone(),
                    text,
                    mentions: mentions.clone(),
                    parent: parent.clone(),
                    resolved: false,
                    deleted: false,
                    created_at: now,
                    updated_at: now,
                },
            )
            .map_err(|e| AppError::msg(format!("comments.insert: {e}")))?;
        let summary = if parent.is_empty() {
            "commented"
        } else {
            "replied to a comment"
        };
        self.log(&sheet_id, "comment", summary.to_string(), 0, Vec::new())?;
        app::emit!(Event::CommentAdded {
            id: &id,
            sheet_id: &sheet_id,
            author: &author,
            mentions: &mentions,
        });
        Ok(id)
    }

    /// Change a comment's text. Only its author may.
    pub fn edit_comment(&mut self, id: String, text: String) -> app::Result<()> {
        let text = Spreadsheet::check_comment(text)?;
        let mentions = self.mentions_in(&text)?;
        self.change_comment(&id, true, |c| {
            c.text = text;
            c.mentions = mentions;
        })
    }

    /// Resolve or reopen a comment thread. Anyone in the workbook may.
    pub fn set_comment_resolved(&mut self, id: String, resolved: bool) -> app::Result<()> {
        self.change_comment(&id, false, |c| c.resolved = resolved)
    }

    /// Delete a comment. Only its author may.
    pub fn delete_comment(&mut self, id: String) -> app::Result<()> {
        self.change_comment(&id, true, |c| c.deleted = true)
    }

    /// Every live comment, oldest first.
    pub fn get_comments(&self) -> app::Result<Vec<Comment>> {
        let mut out: Vec<Comment> = self
            .comments
            .entries()
            .map_err(|e| AppError::msg(format!("comments.entries: {e}")))?
            .filter(|(_, c)| !c.deleted)
            .map(|(id, c)| Comment {
                id,
                sheet_id: c.sheet_id,
                row_id: c.row_id,
                col_id: c.col_id,
                author: c.author,
                text: c.text,
                mentions: c.mentions,
                parent: c.parent,
                resolved: c.resolved,
                created_at: c.created_at,
                updated_at: c.updated_at,
            })
            .collect();
        out.sort_by(|a, b| (a.created_at, &a.id).cmp(&(b.created_at, &b.id)));
        Ok(out)
    }

    fn check_comment(text: String) -> app::Result<String> {
        let text = text.trim().to_string();
        if text.is_empty() || text.chars().count() > MAX_COMMENT_CHARS {
            return Err(AppError::from(Error::Invalid(format!(
                "a comment is 1 to {MAX_COMMENT_CHARS} characters"
            ))));
        }
        Ok(text)
    }

    fn live_comment(&self, id: &str) -> app::Result<Option<CommentData>> {
        Ok(self
            .comments
            .get(id)
            .map_err(|e| AppError::msg(format!("comments.get: {e}")))?
            .filter(|c| !c.deleted)
            .map(|c| c.clone()))
    }

    /// Apply `f` to a live comment, as its author if `author_only`.
    fn change_comment(
        &mut self,
        id: &str,
        author_only: bool,
        f: impl FnOnce(&mut CommentData),
    ) -> app::Result<()> {
        let Some(current) = self.live_comment(id)? else {
            return Err(AppError::from(Error::NotFound(id.to_string())));
        };
        if author_only && current.author != self.caller_hex() {
            return Err(AppError::from(Error::Forbidden(
                "only its author can change a comment".into(),
            )));
        }
        let sheet_id = current.sheet_id.clone();
        if let Some(mut guard) = self
            .comments
            .get_mut(id)
            .map_err(|e| AppError::msg(format!("comments.get_mut: {e}")))?
        {
            f(&mut guard);
            guard.updated_at = storage_env::time_now();
        }
        app::emit!(Event::CommentChanged {
            id,
            sheet_id: &sheet_id
        });
        Ok(())
    }

    /// Members named in `text` as `@nickname` (longest nickname wins, case
    /// ignored; a nickname may contain spaces).
    fn mentions_in(&self, text: &str) -> app::Result<Vec<String>> {
        let mut members: Vec<(String, String)> = self
            .members
            .entries()
            .map_err(|e| AppError::msg(format!("members.entries: {e}")))?
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

    // ---- Rows and columns ----

    /// Insert or delete rows and columns. Each op is one write, whatever the
    /// sheet holds: cells keep their keys, and formulas that name rows by id
    /// keep pointing at the same cells. A deleted row's cells stay stored but
    /// out of the layout, so references to them read `#REF!`.
    ///
    /// The client picks ids (letters first, never a legacy number) and
    /// positions (see the recalc crate's `layout`).
    pub fn apply_axis_ops(&mut self, sheet_id: String, ops: Vec<AxisOp>) -> app::Result<()> {
        if ops.len() > MAX_OPS_PER_APPLY {
            return Err(AppError::from(Error::Invalid(format!(
                "{} axis ops in one apply_axis_ops; the limit is {MAX_OPS_PER_APPLY}",
                ops.len()
            ))));
        }
        self.require_sheet(&sheet_id)?;
        let count = ops.len() as u32;
        let now = storage_env::time_now();
        // "inserted 2 rows, deleted 1 column", for the activity log.
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
            Spreadsheet::check_id(&id)?;
            let key = format!("{sheet_id}|{axis}|{id}");
            let existing = self
                .axes
                .get(&key)
                .map_err(|e| AppError::msg(format!("axes.get: {e}")))?;
            match insert_pos {
                Some(pos) => {
                    if layout::legacy_index(&id).is_some()
                        || !id.starts_with(|c: char| c.is_ascii_alphabetic())
                    {
                        return Err(AppError::from(Error::Invalid(format!(
                            "a new row/column id must start with a letter, got {id:?}"
                        ))));
                    }
                    if pos.is_empty() || !pos.bytes().all(|b| b.is_ascii_digit()) {
                        return Err(AppError::from(Error::Invalid(format!(
                            "a position is decimal digits, got {pos:?}"
                        ))));
                    }
                    if existing.is_some() {
                        return Err(AppError::from(Error::Invalid(format!(
                            "{id} already exists"
                        ))));
                    }
                    self.axes
                        .insert(
                            key,
                            AxisData {
                                pos,
                                deleted: false,
                                updated_at: now,
                            },
                        )
                        .map_err(|e| AppError::msg(format!("axes.insert: {e}")))?;
                }
                None if existing.is_some() => {
                    if let Some(mut guard) = self
                        .axes
                        .get_mut(&key)
                        .map_err(|e| AppError::msg(format!("axes.get_mut: {e}")))?
                    {
                        guard.deleted = deleted;
                        guard.updated_at = now;
                    }
                }
                // A legacy row that was never deleted is already there.
                None if !deleted => {}
                // Deleting a legacy row writes its tombstone at its fixed position.
                None => {
                    let k = layout::legacy_index(&id)
                        .ok_or_else(|| AppError::from(Error::NotFound(id.clone())))?;
                    self.axes
                        .insert(
                            key,
                            AxisData {
                                pos: layout::legacy_pos(k),
                                deleted: true,
                                updated_at: now,
                            },
                        )
                        .map_err(|e| AppError::msg(format!("axes.insert: {e}")))?;
                }
            }
        }
        self.log(&sheet_id, kind, summary, 0, Vec::new())?;
        app::emit!(Event::AxesChanged {
            sheet_id: &sheet_id,
            count
        });
        Ok(())
    }

    /// Every sheet's explicit row and column entries.
    pub fn get_layouts(&self) -> app::Result<Vec<SheetLayout>> {
        let mut by_sheet: BTreeMap<String, SheetLayout> = BTreeMap::new();
        for (key, d) in self
            .axes
            .entries()
            .map_err(|e| AppError::msg(format!("axes.entries: {e}")))?
        {
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
        Ok(by_sheet.into_values().collect())
    }

    // ---- Named ranges ----

    /// Define or redefine a named range. `target` is a reference in stored form.
    pub fn set_named_range(&mut self, name: String, target: String) -> app::Result<()> {
        let name = name.trim().to_string();
        if !formula::is_valid_name(&name) {
            return Err(AppError::from(Error::Invalid(format!(
                "{name:?} cannot be a name: use letters, digits and _, starting with a letter or _, \
                 and not something that reads as a cell, a column or TRUE/FALSE"
            ))));
        }
        if !formula::is_reference(&target) {
            return Err(AppError::from(Error::Invalid(format!(
                "{target:?} is not a cell or range reference"
            ))));
        }
        self.store_name(name, target)
    }

    pub fn delete_named_range(&mut self, name: String) -> app::Result<()> {
        let key = name.trim().to_ascii_uppercase();
        let existing = self
            .names
            .get(&key)
            .map_err(|e| AppError::msg(format!("names.get: {e}")))?;
        if existing.is_none_or(|d| d.target.is_empty()) {
            return Err(AppError::from(Error::NotFound(name)));
        }
        self.store_name(name.trim().to_string(), String::new())
    }

    fn store_name(&mut self, name: String, target: String) -> app::Result<()> {
        let key = name.to_ascii_uppercase();
        let entry_target_empty = target.is_empty();
        let entry = NamedRangeData {
            name: name.clone(),
            target,
            updated_at: storage_env::time_now(),
        };
        let exists = self
            .names
            .get(&key)
            .map_err(|e| AppError::msg(format!("names.get: {e}")))?
            .is_some();
        if exists {
            if let Some(mut guard) = self
                .names
                .get_mut(&key)
                .map_err(|e| AppError::msg(format!("names.get_mut: {e}")))?
            {
                *guard = entry;
            }
        } else {
            self.names
                .insert(key, entry)
                .map_err(|e| AppError::msg(format!("names.insert: {e}")))?;
        }
        let summary = if entry_target_empty {
            format!("deleted the name {name}")
        } else {
            format!("defined the name {name}")
        };
        self.log("", "name", summary, 0, Vec::new())?;
        app::emit!(Event::NamedRangesChanged { name: &name });
        Ok(())
    }

    /// Every defined named range, sorted by name.
    pub fn get_named_ranges(&self) -> app::Result<Vec<NamedRange>> {
        let mut out: Vec<NamedRange> = self
            .names
            .entries()
            .map_err(|e| AppError::msg(format!("names.entries: {e}")))?
            .filter(|(_, d)| !d.target.is_empty())
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

    /// Every stored cell of a live sheet, the recalc input of each non-blank
    /// one, and the live sheet ids, read in one pass.
    fn read_cells(&self) -> app::Result<StoredCells> {
        let sheet_ids: HashSet<String> = self
            .sheets
            .entries()
            .map_err(|e| AppError::msg(format!("sheets.entries: {e}")))?
            .map(|(id, _)| id)
            .collect();
        let mut inputs = BTreeMap::new();
        let mut stored = Vec::new();
        for (key, d) in self
            .cells
            .entries()
            .map_err(|e| AppError::msg(format!("cells.entries: {e}")))?
        {
            // A deleted sheet's cells are left behind rather than removed one
            // by one (which would not fit one execution's gas for a big sheet).
            if !sheet_ids.contains(&d.sheet_id) {
                continue;
            }
            let Some((_, row_id, col_id)) = split_key(&key) else {
                continue;
            };
            if !d.raw_value.is_empty() {
                inputs.insert(
                    recalc::CellRef {
                        sheet_id: d.sheet_id.clone(),
                        row: row_id.to_string(),
                        col: col_id.to_string(),
                    },
                    d.raw_value.clone(),
                );
            }
            stored.push(d);
        }
        Ok((stored, inputs, sheet_ids))
    }

    /// The cells to show: effective format applied, computed value looked up,
    /// fully blank cells (no value and no format) hidden.
    fn cells_from_stored(
        &self,
        stored: impl IntoIterator<Item = CellData>,
        computed: &BTreeMap<recalc::CellRef, String>,
    ) -> app::Result<Vec<Cell>> {
        let formats: BTreeMap<String, String> = self
            .formats
            .entries()
            .map_err(|e| AppError::msg(format!("formats.entries: {e}")))?
            .map(|(k, f)| (k, f.format))
            .collect();
        let meta: BTreeMap<String, CellMeta> = self
            .cell_meta
            .entries()
            .map_err(|e| AppError::msg(format!("cell_meta.entries: {e}")))?
            .collect();
        let mut out = Vec::new();
        for d in stored {
            let format = formats.get(&d.id).cloned().unwrap_or(d.format);
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
            let edited = meta.get(&d.id);
            let last_editor = edited.map(|m| m.author.clone()).unwrap_or_default();
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

    /// One sheet's cells with computed values. Evaluates only the sheet and
    /// the sheets it transitively references, which gives the same values as
    /// evaluating the whole workbook.
    pub fn get_cells(&self, sheet_id: String) -> app::Result<Vec<Cell>> {
        let (stored, all_inputs, sheet_ids) = self.read_cells()?;
        let env = self.formula_env()?;
        let closure = recalc::sheet_closure(&all_inputs, &env, &sheet_id);
        let computed = recalc::evaluate(&recalc::WorkbookInputs {
            cells: all_inputs
                .into_iter()
                .filter(|(k, _)| closure.contains(&k.sheet_id))
                .collect(),
            sheet_ids,
            env,
        });
        let mut out = self.cells_from_stored(
            stored.into_iter().filter(|d| d.sheet_id == sheet_id),
            &computed,
        )?;
        out.sort_by(|a, b| (&a.row_id, &a.col_id).cmp(&(&b.row_id, &b.col_id)));
        Ok(out)
    }

    /// Every non-blank cell across all sheets, raw and computed: the client's
    /// warm store, read in one call.
    pub fn get_all_cells(&self) -> app::Result<Vec<Cell>> {
        let (stored, cells, sheet_ids) = self.read_cells()?;
        let computed = recalc::evaluate(&recalc::WorkbookInputs {
            cells,
            sheet_ids,
            env: self.formula_env()?,
        });
        let mut out = self.cells_from_stored(stored, &computed)?;
        out.sort_by(|a, b| {
            (&a.sheet_id, &a.row_id, &a.col_id).cmp(&(&b.sheet_id, &b.row_id, &b.col_id))
        });
        Ok(out)
    }

    // ---- Function help ----

    /// Every formula function, sorted by name.
    pub fn get_functions(&self) -> app::Result<Vec<FunctionDef>> {
        Ok(builtin_functions())
    }

    pub fn search_functions(&self, prefix: String) -> app::Result<Vec<FunctionDef>> {
        let upper = prefix.to_uppercase();
        Ok(builtin_functions()
            .into_iter()
            .filter(|f| f.name.starts_with(&upper))
            .collect())
    }

    // ---- Export ----

    /// Returns all sheets (same as list_sheets). The frontend assembles CSV
    /// by calling get_cells per sheet.
    pub fn export_all(&self) -> app::Result<Vec<Sheet>> {
        self.list_sheets()
    }
}

// ---------------------------------------------------------------------------
// Private helpers
// ---------------------------------------------------------------------------

impl Spreadsheet {
    /// This device's id, hex: the key a member's nickname is stored under and
    /// the id their live cursor carries. Keyed on the device, not the account
    /// (core's own rule: `device_id` is "right for per-writer state"). Was
    /// `bs58::encode(env::executor_id())`; rc.20 removed `executor_id` and rc.27
    /// removed base58 (core#3691).
    fn caller_hex(&self) -> String {
        hex::encode(env::device_id())
    }

    /// What formulas see besides cells: the execution's clock (so `NOW()` and
    /// `TODAY()` read the node's time; `time_now` is nanoseconds), the named
    /// ranges, and each sheet's row and column order.
    fn formula_env(&self) -> app::Result<formula::Env> {
        let names = self
            .names
            .entries()
            .map_err(|e| AppError::msg(format!("names.entries: {e}")))?
            .filter(|(_, d)| !d.target.is_empty())
            .map(|(k, d)| (k, d.target))
            .collect();
        let layouts = self
            .get_layouts()?
            .into_iter()
            .map(|l| {
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
                (l.sheet_id, layout::Layout { rows, cols })
            })
            .collect();
        Ok(formula::Env {
            now_ms: storage_env::time_now() / 1_000_000,
            names,
            layouts,
        })
    }

    fn cell_key(sheet_id: &str, row_id: &str, col_id: &str) -> String {
        format!("{sheet_id}|{row_id}|{col_id}")
    }
}

/// A format keyword as the activity log says it.
fn display_format(format: &str) -> &str {
    if format.is_empty() {
        "Automatic"
    } else {
        format
    }
}

/// See `Spreadsheet::read_cells`.
type StoredCells = (
    Vec<CellData>,
    BTreeMap<recalc::CellRef, String>,
    HashSet<String>,
);

/// `"{sheet}|{a}|{b}"` → its three parts. The sheet id is everything before
/// the last two separators; row, column and axis parts never contain one.
fn split_key(key: &str) -> Option<(&str, &str, &str)> {
    let mut parts = key.rsplitn(3, '|');
    let b = parts.next()?;
    let a = parts.next()?;
    let sheet = parts.next()?;
    Some((sheet, a, b))
}

// ---------------------------------------------------------------------------
// Built-in function list
// ---------------------------------------------------------------------------

/// The function help, straight from the engine's own catalog, so every
/// function listed is one the evaluator implements.
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

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

#[cfg(test)]
mod tests {
    use calimero_sdk::testing::TestHost;

    use super::*;

    fn make_app() -> TestHost<Spreadsheet> {
        TestHost::new(Spreadsheet::init)
    }

    #[test]
    fn init_project_sets_id_and_name() {
        let mut app = make_app();
        let id = app.call(|s| s.init_project("Q3 Budget".into())).unwrap();
        assert!(!id.is_empty());
        assert_eq!(app.events().len(), 1);
    }

    #[test]
    fn get_project_reads_back_the_name_init_project_wrote() {
        // The gap this closes: `project_name` was written from day one and no
        // method could read it, so every peer but the creator saw a placeholder.
        let mut app = make_app();
        let id = app.call(|s| s.init_project("Q3 Budget".into())).unwrap();
        let project = app.view(|s| s.get_project()).unwrap();
        assert_eq!(project.id, id);
        assert_eq!(project.name, "Q3 Budget");
        assert!(project.created_at > 0);
    }

    #[test]
    fn get_project_on_an_uninitialised_context_is_empty_not_an_error() {
        // A context exists before `init_project` lands. That window must render
        // a placeholder, not an error page.
        let app = make_app();
        let project = app.view(|s| s.get_project()).unwrap();
        assert_eq!(project.id, "");
        assert_eq!(project.name, "");
    }

    #[test]
    fn join_records_a_nickname_and_get_members_reads_it() {
        let mut app = make_app();
        app.call(|s| s.init_project("P".into())).unwrap();
        app.call(|s| s.join("Ada".into())).unwrap();
        let members = app.view(|s| s.get_members()).unwrap();
        assert_eq!(members.len(), 1);
        assert_eq!(members[0].nickname, "Ada");
        assert!(!members[0].id.is_empty());
    }

    #[test]
    fn join_is_idempotent_and_renames_in_place() {
        // Called on every open, not only the first — so a second call must
        // rename rather than add a second row for the same device.
        let mut app = make_app();
        app.call(|s| s.join("Ada".into())).unwrap();
        let first = app.view(|s| s.get_members()).unwrap()[0].joined_at;
        app.call(|s| s.join("Ada Lovelace".into())).unwrap();
        let members = app.view(|s| s.get_members()).unwrap();
        assert_eq!(members.len(), 1);
        assert_eq!(members[0].nickname, "Ada Lovelace");
        assert_eq!(
            members[0].joined_at, first,
            "a rename must not look like a later arrival"
        );
    }

    #[test]
    fn join_trims_and_rejects_an_empty_or_overlong_nickname() {
        let mut app = make_app();
        app.call(|s| s.join("  Ada  ".into())).unwrap();
        assert_eq!(app.view(|s| s.get_members()).unwrap()[0].nickname, "Ada");
        assert!(app.call(|s| s.join("   ".into())).is_err());
        assert!(app.call(|s| s.join("n".repeat(65))).is_err());
    }

    #[test]
    fn whoami_is_the_key_this_caller_writes_under() {
        let mut app = make_app();
        app.call(|s| s.init_project("P".into())).unwrap();
        app.call(|s| s.join("Ada".into())).unwrap();
        let me = app.view(|s| s.whoami()).unwrap();
        assert_eq!(me.len(), 64, "a device id is 64 hex since rc.27");
        assert_eq!(app.view(|s| s.get_members()).unwrap()[0].id, me);
    }

    #[test]
    fn member_merge_keeps_the_newer_name_and_the_earlier_arrival() {
        let mut mine = MemberData {
            nickname: "Ada".into(),
            joined_at: 100,
            updated_at: 100,
        };
        let theirs = MemberData {
            nickname: "Ada Lovelace".into(),
            joined_at: 50,
            updated_at: 200,
        };
        mine.merge(&theirs).unwrap();
        assert_eq!(mine.nickname, "Ada Lovelace");
        assert_eq!(mine.updated_at, 200);
        assert_eq!(mine.joined_at, 50);
    }

    #[test]
    fn member_merge_breaks_an_equal_clock_tie_on_the_nickname() {
        // An equal-clock compare that ignores the value silently discards one
        // side's write and leaves two replicas showing different names.
        let mut a = MemberData {
            nickname: "Ada".into(),
            joined_at: 10,
            updated_at: 100,
        };
        let mut b = MemberData {
            nickname: "Bob".into(),
            joined_at: 10,
            updated_at: 100,
        };
        let (a0, b0) = (a.clone(), b.clone());
        a.merge(&b0).unwrap();
        b.merge(&a0).unwrap();
        assert_eq!(a.nickname, b.nickname);
    }

    #[test]
    fn init_project_twice_errors() {
        let mut app = make_app();
        app.call(|s| s.init_project("First".into())).unwrap();
        assert!(app.call(|s| s.init_project("Second".into())).is_err());
    }

    #[test]
    fn create_and_list_sheets() {
        let mut app = make_app();
        app.call(|s| s.init_project("P".into())).unwrap();
        let sid = app.call(|s| s.create_sheet("Revenue".into())).unwrap();
        let sheets = app.view(|s| s.list_sheets()).unwrap();
        assert_eq!(sheets.len(), 1);
        assert_eq!(sheets[0].id, sid);
        assert_eq!(sheets[0].name, "Revenue");
    }

    #[test]
    fn rename_sheet_updates_name() {
        let mut app = make_app();
        app.call(|s| s.init_project("P".into())).unwrap();
        let sid = app.call(|s| s.create_sheet("Old".into())).unwrap();
        app.call(|s| s.rename_sheet(sid.clone(), "New".into()))
            .unwrap();
        let sheets = app.view(|s| s.list_sheets()).unwrap();
        assert_eq!(sheets[0].name, "New");
    }

    #[test]
    fn delete_sheet_removes_it_and_cells() {
        let mut app = make_app();
        app.call(|s| s.init_project("P".into())).unwrap();
        let sid = app.call(|s| s.create_sheet("Tab".into())).unwrap();
        app.call(|s| s.set_cell(sid.clone(), "0".into(), "0".into(), "42".into()))
            .unwrap();
        app.call(|s| s.delete_sheet(sid.clone())).unwrap();
        let sheets = app.view(|s| s.list_sheets()).unwrap();
        assert!(sheets.is_empty());
        let cells = app.view(|s| s.get_cells(sid)).unwrap();
        assert!(cells.is_empty());
    }

    #[test]
    fn set_cell_and_get_cells() {
        let mut app = make_app();
        app.call(|s| s.init_project("P".into())).unwrap();
        let sid = app.call(|s| s.create_sheet("Sheet1".into())).unwrap();
        let cid = app
            .call(|s| s.set_cell(sid.clone(), "0".into(), "0".into(), "1500".into()))
            .unwrap();
        let cells = app.view(|s| s.get_cells(sid)).unwrap();
        assert_eq!(cells.len(), 1);
        assert_eq!(cells[0].id, cid);
        assert_eq!(cells[0].raw_value, "1500");
        assert_eq!(cells[0].computed_value, "1500");
    }

    #[test]
    fn set_cell_format_persists_and_preserves_value() {
        let mut app = make_app();
        app.call(|s| s.init_project("P".into())).unwrap();
        let sid = app.call(|s| s.create_sheet("S".into())).unwrap();
        app.call(|s| s.set_cell(sid.clone(), "0".into(), "0".into(), "1234.5".into()))
            .unwrap();
        app.call(|s| s.set_cell_format(sid.clone(), "0".into(), "0".into(), "currency".into()))
            .unwrap();
        let cells = app.view(|s| s.get_cells(sid.clone())).unwrap();
        let a1 = cells
            .iter()
            .find(|c| c.row_id == "0" && c.col_id == "0")
            .unwrap();
        assert_eq!(a1.format, "currency");
        assert_eq!(a1.raw_value, "1234.5", "value preserved when format is set");
    }

    #[test]
    fn setting_value_preserves_existing_format() {
        let mut app = make_app();
        app.call(|s| s.init_project("P".into())).unwrap();
        let sid = app.call(|s| s.create_sheet("S".into())).unwrap();
        // Format an empty cell, then type a value into it.
        app.call(|s| s.set_cell_format(sid.clone(), "0".into(), "0".into(), "percent".into()))
            .unwrap();
        app.call(|s| s.set_cell(sid.clone(), "0".into(), "0".into(), "0.25".into()))
            .unwrap();
        let cells = app.view(|s| s.get_cells(sid.clone())).unwrap();
        let a1 = cells
            .iter()
            .find(|c| c.row_id == "0" && c.col_id == "0")
            .unwrap();
        assert_eq!(a1.format, "percent", "format survives a later value edit");
        assert_eq!(a1.computed_value, "0.25");
    }

    #[test]
    fn cell_merge_carries_format_from_winner() {
        let mut a = CellData {
            id: "k".into(),
            sheet_id: "s".into(),
            row: 0,
            col: 0,
            raw_value: "1".into(),
            format: String::new(),
            updated_at: 1,
        };
        let b = CellData {
            id: "k".into(),
            sheet_id: "s".into(),
            row: 0,
            col: 0,
            raw_value: "2".into(),
            format: "currency".into(),
            updated_at: 2,
        };
        a.merge(&b).unwrap();
        assert_eq!(a.raw_value, "2");
        assert_eq!(a.format, "currency", "LWW winner's format is kept");
    }

    #[test]
    fn set_cell_formula_sum_evaluates() {
        let mut app = make_app();
        app.call(|s| s.init_project("P".into())).unwrap();
        let sid = app.call(|s| s.create_sheet("S".into())).unwrap();
        // Seed A1..A3 with values 10, 20, 30.
        app.call(|s| s.set_cell(sid.clone(), "0".into(), "0".into(), "10".into()))
            .unwrap();
        app.call(|s| s.set_cell(sid.clone(), "1".into(), "0".into(), "20".into()))
            .unwrap();
        app.call(|s| s.set_cell(sid.clone(), "2".into(), "0".into(), "30".into()))
            .unwrap();
        // SUM(A1:A3) should be 60.
        let fid = app
            .call(|s| s.set_cell(sid.clone(), "3".into(), "0".into(), "=SUM(A1:A3)".into()))
            .unwrap();
        let cells = app.view(|s| s.get_cells(sid)).unwrap();
        let formula_cell = cells.iter().find(|c| c.id == fid).unwrap();
        assert_eq!(formula_cell.computed_value, "60");
    }

    #[test]
    fn absolute_refs_evaluate_like_relative() {
        let mut app = make_app();
        app.call(|s| s.init_project("P".into())).unwrap();
        let sid = app.call(|s| s.create_sheet("S".into())).unwrap();
        app.call(|s| s.set_cell(sid.clone(), "0".into(), "0".into(), "10".into()))
            .unwrap(); // A1 = 10
        app.call(|s| s.set_cell(sid.clone(), "1".into(), "0".into(), "20".into()))
            .unwrap(); // A2 = 20
                       // $ anchors are evaluation no-ops: these must all compute like the bare refs.
        app.call(|s| s.set_cell(sid.clone(), "0".into(), "1".into(), "=$A$1".into()))
            .unwrap(); // B1
        app.call(|s| s.set_cell(sid.clone(), "1".into(), "1".into(), "=A$1+$A2".into()))
            .unwrap(); // B2
        app.call(|s| {
            s.set_cell(
                sid.clone(),
                "2".into(),
                "1".into(),
                "=SUM($A$1:$A$2)".into(),
            )
        })
        .unwrap(); // B3
        let cells = app.view(|s| s.get_cells(sid.clone())).unwrap();
        let get = |r: u32, c: u32| {
            cells
                .iter()
                .find(|x| x.row_id == r.to_string() && x.col_id == c.to_string())
                .unwrap()
                .computed_value
                .clone()
        };
        assert_eq!(get(0, 1), "10", "=$A$1");
        assert_eq!(get(1, 1), "30", "=A$1+$A2");
        assert_eq!(get(2, 1), "30", "=SUM($A$1:$A$2)");
    }

    #[test]
    fn dependent_formulas_recompute_when_source_changes() {
        let mut app = make_app();
        app.call(|s| s.init_project("P".into())).unwrap();
        let sid = app.call(|s| s.create_sheet("S".into())).unwrap();
        app.call(|s| s.set_cell(sid.clone(), "0".into(), "0".into(), "1".into()))
            .unwrap(); // A1 = 1
        app.call(|s| s.set_cell(sid.clone(), "1".into(), "0".into(), "2".into()))
            .unwrap(); // A2 = 2
                       // A3 = SUM(A1,A2) = 3
        app.call(|s| s.set_cell(sid.clone(), "2".into(), "0".into(), "=SUM(A1,A2)".into()))
            .unwrap();
        // B1 = A3 * 10 = 30 (chained: B1 → A3 → A2)
        app.call(|s| s.set_cell(sid.clone(), "0".into(), "1".into(), "=A3*10".into()))
            .unwrap();

        // Change A2 to 5. A3 must recompute to 6, and B1 (which depends on A3)
        // must recompute to 60.
        app.call(|s| s.set_cell(sid.clone(), "1".into(), "0".into(), "5".into()))
            .unwrap();

        let cells = app.view(|s| s.get_cells(sid)).unwrap();
        let a3 = cells
            .iter()
            .find(|c| c.row_id == "2" && c.col_id == "0")
            .unwrap();
        let b1 = cells
            .iter()
            .find(|c| c.row_id == "0" && c.col_id == "1")
            .unwrap();
        assert_eq!(a3.computed_value, "6", "A3 = SUM(A1,A2) after A2→5");
        assert_eq!(b1.computed_value, "60", "B1 = A3*10 after chain recompute");
    }

    #[test]
    fn clearing_a_cell_recomputes_dependents() {
        let mut app = make_app();
        app.call(|s| s.init_project("P".into())).unwrap();
        let sid = app.call(|s| s.create_sheet("S".into())).unwrap();
        app.call(|s| s.set_cell(sid.clone(), "0".into(), "0".into(), "10".into()))
            .unwrap(); // A1
        app.call(|s| s.set_cell(sid.clone(), "1".into(), "0".into(), "20".into()))
            .unwrap(); // A2
        app.call(|s| s.set_cell(sid.clone(), "2".into(), "0".into(), "=SUM(A1:A2)".into()))
            .unwrap(); // A3 = 30
                       // Clear A2 → A3 should recompute to 10.
        app.call(|s| s.clear_cell(sid.clone(), "1".into(), "0".into()))
            .unwrap();
        let cells = app.view(|s| s.get_cells(sid)).unwrap();
        let a3 = cells
            .iter()
            .find(|c| c.row_id == "2" && c.col_id == "0")
            .unwrap();
        assert_eq!(a3.computed_value, "10");
    }

    #[test]
    fn cross_sheet_cell_and_range_references() {
        let mut app = make_app();
        app.call(|s| s.init_project("P".into())).unwrap();
        let s1 = app.call(|s| s.create_sheet("Sheet1".into())).unwrap();
        let data = app.call(|s| s.create_sheet("Data".into())).unwrap();
        // Data!A1 = 10, Data!A2 = 20
        app.call(|s| s.set_cell(data.clone(), "0".into(), "0".into(), "10".into()))
            .unwrap();
        app.call(|s| s.set_cell(data.clone(), "1".into(), "0".into(), "20".into()))
            .unwrap();
        // Sheet1!B1 = =[data]!A1 + [data]!A2 → 30
        app.call(|s| {
            s.set_cell(
                s1.clone(),
                "0".into(),
                "1".into(),
                format!("=[{data}]!A1+[{data}]!A2"),
            )
        })
        .unwrap();
        // Sheet1!B2 = =SUM([data]!A1:A2) → 30
        app.call(|s| {
            s.set_cell(
                s1.clone(),
                "1".into(),
                "1".into(),
                format!("=SUM([{data}]!A1:A2)"),
            )
        })
        .unwrap();
        let cells = app.view(|s| s.get_cells(s1.clone())).unwrap();
        let b1 = cells
            .iter()
            .find(|c| c.row_id == "0" && c.col_id == "1")
            .unwrap();
        let b2 = cells
            .iter()
            .find(|c| c.row_id == "1" && c.col_id == "1")
            .unwrap();
        assert_eq!(b1.computed_value, "30", "=[data]!A1+[data]!A2");
        assert_eq!(b2.computed_value, "30", "=SUM([data]!A1:A2)");
    }

    #[test]
    fn reference_to_unknown_sheet_is_ref_error() {
        let mut app = make_app();
        app.call(|s| s.init_project("P".into())).unwrap();
        let sid = app.call(|s| s.create_sheet("Sheet 1".into())).unwrap();
        // No sheet has this id, so the reference must surface as #REF!, not a
        // silent 0 that looks like the cell is empty.
        app.call(|s| {
            s.set_cell(
                sid.clone(),
                "0".into(),
                "0".into(),
                "=[sheet-does-not-exist]!A1".into(),
            )
        })
        .unwrap();
        // resolves to #REF! because no sheet has that id
        let cells = app.view(|s| s.get_cells(sid.clone())).unwrap();
        let a1 = cells
            .iter()
            .find(|c| c.row_id == "0" && c.col_id == "0")
            .unwrap();
        assert_eq!(a1.computed_value, "#REF!", "unknown sheet id → #REF!");
    }

    #[test]
    fn cross_sheet_recompute_propagates() {
        let mut app = make_app();
        app.call(|s| s.init_project("P".into())).unwrap();
        let a = app.call(|s| s.create_sheet("A".into())).unwrap();
        let b = app.call(|s| s.create_sheet("B".into())).unwrap();
        app.call(|s| s.set_cell(a.clone(), "0".into(), "0".into(), "5".into()))
            .unwrap(); // [a]!A1 = 5
        app.call(|s| s.set_cell(b.clone(), "0".into(), "0".into(), format!("=[{a}]!A1*10")))
            .unwrap(); // [b]!A1 = 50
                       // Change [a]!A1 → 8; [b]!A1 (on the other sheet) must recompute to 80.
        app.call(|s| s.set_cell(a.clone(), "0".into(), "0".into(), "8".into()))
            .unwrap();
        let cells = app.view(|s| s.get_cells(b.clone())).unwrap();
        let a1 = cells
            .iter()
            .find(|c| c.row_id == "0" && c.col_id == "0")
            .unwrap();
        assert_eq!(a1.computed_value, "80");
    }

    #[test]
    fn clear_cell_removes_it() {
        let mut app = make_app();
        app.call(|s| s.init_project("P".into())).unwrap();
        let sid = app.call(|s| s.create_sheet("S".into())).unwrap();
        app.call(|s| s.set_cell(sid.clone(), "0".into(), "0".into(), "99".into()))
            .unwrap();
        app.call(|s| s.clear_cell(sid.clone(), "0".into(), "0".into()))
            .unwrap();
        let cells = app.view(|s| s.get_cells(sid)).unwrap();
        assert!(cells.is_empty());
    }

    #[test]
    fn cleared_cell_can_be_rewritten() {
        let mut app = make_app();
        app.call(|s| s.init_project("P".into())).unwrap();
        let sid = app.call(|s| s.create_sheet("S".into())).unwrap();
        app.call(|s| s.set_cell(sid.clone(), "0".into(), "0".into(), "first".into()))
            .unwrap();
        app.call(|s| s.clear_cell(sid.clone(), "0".into(), "0".into()))
            .unwrap();
        // Writing the same coordinate again after a clear must persist — a paste
        // or a fresh type into a previously-deleted cell.
        app.call(|s| s.set_cell(sid.clone(), "0".into(), "0".into(), "second".into()))
            .unwrap();
        let cells = app.view(|s| s.get_cells(sid)).unwrap();
        let a1 = cells.iter().find(|c| c.row_id == "0" && c.col_id == "0");
        assert!(
            a1.is_some(),
            "cell missing after re-write of a cleared cell"
        );
        assert_eq!(a1.unwrap().raw_value, "second");
    }

    #[test]
    fn apply_cell_ops_refuses_an_oversized_batch() {
        let mut app = make_app();
        app.call(|s| s.init_project("P".into())).unwrap();
        let sid = app.call(|s| s.create_sheet("S".into())).unwrap();
        let ops = |n: usize| -> Vec<CellOp> {
            (0..n)
                .map(|i| CellOp::Set {
                    row_id: i.to_string(),
                    col_id: "0".into(),
                    raw_value: "1".into(),
                })
                .collect()
        };
        let err = app
            .call(|s| s.apply_cell_ops(sid.clone(), ops(MAX_OPS_PER_APPLY + 1)))
            .unwrap_err();
        assert!(format!("{err:?}").contains("split the batch"), "{err:?}");
        app.call(|s| s.apply_cell_ops(sid.clone(), ops(MAX_OPS_PER_APPLY)))
            .unwrap();
        let cells = app.view(|s| s.get_cells(sid)).unwrap();
        assert_eq!(cells.len(), MAX_OPS_PER_APPLY);
    }

    #[test]
    fn apply_cell_ops_applies_mixed_batch() {
        let mut app = make_app();
        app.call(|s| s.init_project("P".into())).unwrap();
        let sid = app.call(|s| s.create_sheet("Sheet 1".into())).unwrap();
        app.call(|s| s.set_cell(sid.clone(), "5".into(), "5".into(), "old".into()))
            .unwrap();
        let ev_before = app.events().len();
        app.call(|s| {
            s.apply_cell_ops(
                sid.clone(),
                vec![
                    CellOp::Set {
                        row_id: "0".into(),
                        col_id: "0".into(),
                        raw_value: "7".into(),
                    },
                    CellOp::Set {
                        row_id: "1".into(),
                        col_id: "0".into(),
                        raw_value: "=A1*2".into(),
                    },
                    CellOp::Format {
                        row_id: "0".into(),
                        col_id: "0".into(),
                        format: "number".into(),
                    },
                    CellOp::Clear {
                        row_id: "5".into(),
                        col_id: "5".into(),
                    },
                ],
            )
        })
        .unwrap();
        // ONE batch event for the whole apply (not one per op) — so a large batch
        // never trips the runtime's per-commit event cap (max_events = 100).
        assert_eq!(
            app.events().len() - ev_before,
            1,
            "one batch event, not one per op"
        );
        let cells = app.view(|s| s.get_cells(sid)).unwrap();
        let a1 = cells
            .iter()
            .find(|c| c.row_id == "0" && c.col_id == "0")
            .unwrap();
        let a2 = cells
            .iter()
            .find(|c| c.row_id == "1" && c.col_id == "0")
            .unwrap();
        assert_eq!(a1.computed_value, "7");
        assert_eq!(a1.format, "number");
        assert_eq!(a2.computed_value, "14"); // derived on read
        assert!(
            cells.iter().all(|c| !(c.row_id == "5" && c.col_id == "5")),
            "cleared cell hidden"
        );
    }

    #[test]
    fn get_functions_returns_all() {
        let app = make_app();
        let fns = app.view(|s| s.get_functions()).unwrap();
        // The engine's whole catalog, sorted alphabetically.
        assert_eq!(fns.len(), formula::CATALOG.len());
        assert!(fns.windows(2).all(|w| w[0].name < w[1].name));
        assert!(fns
            .iter()
            .any(|f| f.name == "VLOOKUP" && f.category == "Lookup"));
    }

    #[test]
    fn search_functions_filters_by_prefix() {
        let app = make_app();
        let fns = app.view(|s| s.search_functions("su".into())).unwrap();
        let names: Vec<&str> = fns.iter().map(|f| f.name.as_str()).collect();
        assert_eq!(
            names,
            ["SUBSTITUTE", "SUM", "SUMIF", "SUMIFS", "SUMPRODUCT"]
        );
    }

    #[test]
    fn get_all_cells_spans_sheets_with_computed_values() {
        let mut app = make_app();
        app.call(|s| s.init_project("P".into())).unwrap();
        let s1 = app.call(|s| s.create_sheet("One".into())).unwrap();
        let s2 = app.call(|s| s.create_sheet("Two".into())).unwrap();
        app.call(|s| s.set_cell(s1.clone(), "0".into(), "0".into(), "10".into()))
            .unwrap();
        app.call(|s| s.set_cell(s2.clone(), "0".into(), "0".into(), format!("=[{s1}]!A1*2")))
            .unwrap();

        let all = app.view(|s| s.get_all_cells()).unwrap();
        // Both sheets' cells present; cross-sheet computed value derived (20).
        let c2 = all
            .iter()
            .find(|c| c.sheet_id == s2 && c.row_id == "0" && c.col_id == "0")
            .unwrap();
        assert_eq!(c2.computed_value, "20");
        assert!(all.iter().any(|c| c.sheet_id == s1 && c.raw_value == "10"));
    }

    #[test]
    fn export_all_returns_sheets() {
        let mut app = make_app();
        app.call(|s| s.init_project("P".into())).unwrap();
        app.call(|s| s.create_sheet("A".into())).unwrap();
        app.call(|s| s.create_sheet("B".into())).unwrap();
        let sheets = app.view(|s| s.export_all()).unwrap();
        assert_eq!(sheets.len(), 2);
    }

    #[test]
    fn set_cell_unknown_sheet_errors() {
        let mut app = make_app();
        app.call(|s| s.init_project("P".into())).unwrap();
        assert!(app
            .call(|s| s.set_cell("no-such-sheet".into(), "0".into(), "0".into(), "v".into()))
            .is_err());
    }

    #[test]
    fn formula_average_and_count() {
        let mut app = make_app();
        app.call(|s| s.init_project("P".into())).unwrap();
        let sid = app.call(|s| s.create_sheet("S".into())).unwrap();
        app.call(|s| s.set_cell(sid.clone(), "0".into(), "0".into(), "10".into()))
            .unwrap();
        app.call(|s| s.set_cell(sid.clone(), "1".into(), "0".into(), "20".into()))
            .unwrap();
        app.call(|s| {
            s.set_cell(
                sid.clone(),
                "2".into(),
                "0".into(),
                "=AVERAGE(A1:A2)".into(),
            )
        })
        .unwrap();
        app.call(|s| s.set_cell(sid.clone(), "3".into(), "0".into(), "=COUNT(A1:A2)".into()))
            .unwrap();
        let cells = app.view(|s| s.get_cells(sid)).unwrap();
        let avg = cells.iter().find(|c| c.row_id == "2").unwrap();
        let cnt = cells.iter().find(|c| c.row_id == "3").unwrap();
        assert_eq!(avg.computed_value, "15");
        assert_eq!(cnt.computed_value, "2");
    }

    #[test]
    fn create_sheet_auto_suffixes_duplicate_names() {
        let mut app = make_app();
        app.call(|s| s.create_sheet("Sheet 1".into())).unwrap();
        app.call(|s| s.create_sheet("Sheet 1".into())).unwrap();
        app.call(|s| s.create_sheet("Sheet 1".into())).unwrap();
        let names: Vec<String> = app
            .call(|s| -> app::Result<Vec<String>> {
                Ok(s.list_sheets()?.into_iter().map(|x| x.name).collect())
            })
            .unwrap();
        assert!(names.contains(&"Sheet 1".to_string()));
        assert!(names.contains(&"Sheet 1 (2)".to_string()));
        assert!(names.contains(&"Sheet 1 (3)".to_string()));
    }

    #[test]
    fn rename_to_an_existing_name_is_rejected() {
        let mut app = make_app();
        let a = app.call(|s| s.create_sheet("Alpha".into())).unwrap();
        let _b = app.call(|s| s.create_sheet("Beta".into())).unwrap();
        assert!(app
            .call(|s| s.rename_sheet(a.clone(), "Beta".into()))
            .is_err());
    }

    #[test]
    fn rename_to_own_name_is_ok() {
        let mut app = make_app();
        let a = app.call(|s| s.create_sheet("Alpha".into())).unwrap();
        assert!(app
            .call(|s| s.rename_sheet(a.clone(), "Alpha".into()))
            .is_ok());
    }

    #[test]
    fn rename_rejects_forbidden_chars() {
        let mut app = make_app();
        let a = app.call(|s| s.create_sheet("Alpha".into())).unwrap();
        assert!(app
            .call(|s| s.rename_sheet(a.clone(), "Bad!Name".into()))
            .is_err());
    }

    #[test]
    fn rename_does_not_touch_formulas_or_values() {
        let mut app = make_app();
        let data = app.call(|s| s.create_sheet("Data".into())).unwrap();
        let main = app.call(|s| s.create_sheet("Main".into())).unwrap();
        app.call(|s| s.set_cell(data.clone(), "0".into(), "0".into(), "10".into()))
            .unwrap();
        let formula = format!("=[{data}]!A1*2");
        app.call(|s| s.set_cell(main.clone(), "0".into(), "0".into(), formula.clone()))
            .unwrap();
        let before = app.view(|s| s.get_cells(main.clone())).unwrap();
        let cell_before = before
            .iter()
            .find(|c| c.row_id == "0" && c.col_id == "0")
            .unwrap()
            .clone();
        assert_eq!(cell_before.computed_value, "20");

        app.call(|s| s.rename_sheet(data.clone(), "Renamed".into()))
            .unwrap();

        let after = app.view(|s| s.get_cells(main.clone())).unwrap();
        let cell_after = after
            .iter()
            .find(|c| c.row_id == "0" && c.col_id == "0")
            .unwrap();
        // raw formula unchanged (id-based), computed value unchanged.
        assert_eq!(
            cell_after.raw_value, formula,
            "rename must not rewrite the formula"
        );
        assert_eq!(
            cell_after.computed_value, "20",
            "rename must not change values"
        );
    }

    #[test]
    fn self_referential_formula_is_cycle_error() {
        let mut app = make_app();
        let sid = app.call(|s| s.create_sheet("Sheet 1".into())).unwrap();
        app.call(|s| s.set_cell(sid.clone(), "0".into(), "0".into(), "1".into()))
            .unwrap(); // A1 = 1
                       // B1 = SUM(A1, B1) — references itself; must not diverge into a number.
        app.call(|s| s.set_cell(sid.clone(), "0".into(), "1".into(), "=SUM(A1,B1)".into()))
            .unwrap();
        let cells = app.view(|s| s.get_cells(sid.clone())).unwrap();
        let b1 = cells
            .iter()
            .find(|c| c.row_id == "0" && c.col_id == "1")
            .unwrap();
        assert_eq!(b1.computed_value, "#CYCLE!");
    }

    #[test]
    fn mutual_divergent_cycle_is_cycle_error() {
        let mut app = make_app();
        let sid = app.call(|s| s.create_sheet("Sheet 1".into())).unwrap();
        // A1 = B1 + 1, B1 = A1 + 1 — a mutual cycle that diverges.
        app.call(|s| s.set_cell(sid.clone(), "0".into(), "0".into(), "=B1+1".into()))
            .unwrap();
        app.call(|s| s.set_cell(sid.clone(), "0".into(), "1".into(), "=A1+1".into()))
            .unwrap();
        let cells = app.view(|s| s.get_cells(sid.clone())).unwrap();
        let a1 = cells
            .iter()
            .find(|c| c.row_id == "0" && c.col_id == "0")
            .unwrap();
        let b1 = cells
            .iter()
            .find(|c| c.row_id == "0" && c.col_id == "1")
            .unwrap();
        assert_eq!(a1.computed_value, "#CYCLE!");
        assert_eq!(b1.computed_value, "#CYCLE!");
    }

    #[test]
    fn long_acyclic_chain_still_converges() {
        let mut app = make_app();
        let sid = app.call(|s| s.create_sheet("Sheet 1".into())).unwrap();
        app.call(|s| s.set_cell(sid.clone(), "0".into(), "0".into(), "1".into()))
            .unwrap(); // A1 = 1
        app.call(|s| s.set_cell(sid.clone(), "1".into(), "0".into(), "=A1+1".into()))
            .unwrap(); // A2
        app.call(|s| s.set_cell(sid.clone(), "2".into(), "0".into(), "=A2+1".into()))
            .unwrap(); // A3
        let cells = app.view(|s| s.get_cells(sid.clone())).unwrap();
        let a3 = cells
            .iter()
            .find(|c| c.row_id == "2" && c.col_id == "0")
            .unwrap();
        // A well-formed chain must converge, never be misflagged as a cycle.
        assert_eq!(a3.computed_value, "3");
    }

    #[test]
    fn get_cells_derives_dependent_values_on_read() {
        let mut app = make_app();
        let sid = app.call(|s| s.create_sheet("Sheet 1".into())).unwrap();
        // Store inputs only — set_cell must NOT recompute.
        app.call(|s| s.set_cell(sid.clone(), "0".into(), "0".into(), "2".into()))
            .unwrap();
        app.call(|s| s.set_cell(sid.clone(), "1".into(), "0".into(), "=A1*10".into()))
            .unwrap();
        let cells = app.view(|s| s.get_cells(sid.clone())).unwrap();
        let b = cells
            .iter()
            .find(|c| c.row_id == "1" && c.col_id == "0")
            .unwrap();
        assert_eq!(b.computed_value, "20", "dependent derived on read");
        // Change the precedent; the dependent re-derives with no extra write to B1.
        app.call(|s| s.set_cell(sid.clone(), "0".into(), "0".into(), "3".into()))
            .unwrap();
        let cells = app.view(|s| s.get_cells(sid.clone())).unwrap();
        let b = cells
            .iter()
            .find(|c| c.row_id == "1" && c.col_id == "0")
            .unwrap();
        assert_eq!(b.computed_value, "30");
    }

    #[test]
    fn get_cells_scoped_matches_cross_sheet_and_ignores_unrelated() {
        let mut app = make_app();
        let s1 = app.call(|s| s.create_sheet("Sheet 1".into())).unwrap();
        let s2 = app.call(|s| s.create_sheet("Sheet 2".into())).unwrap();
        let s3 = app.call(|s| s.create_sheet("Sheet 3".into())).unwrap();

        // S2!A1 = 5 ; S1!A1 = S2!A1 + 100 (cross-sheet dependency).
        app.call(|s| s.set_cell(s2.clone(), "0".into(), "0".into(), "5".into()))
            .unwrap();
        app.call(|s| {
            s.set_cell(
                s1.clone(),
                "0".into(),
                "0".into(),
                format!("=[{s2}]!A1+100"),
            )
        })
        .unwrap();
        // S3 has an unrelated self-cycle — must never affect S1's read.
        app.call(|s| s.set_cell(s3.clone(), "0".into(), "0".into(), "=A1".into()))
            .unwrap();

        // Scoped get_cells(S1) still resolves the cross-sheet ref correctly.
        let s1_cells = app.view(|s| s.get_cells(s1.clone())).unwrap();
        let a1 = s1_cells
            .iter()
            .find(|c| c.row_id == "0" && c.col_id == "0")
            .unwrap();
        assert_eq!(a1.computed_value, "105");

        // get_cells(S3) still flags its own cycle — scoping doesn't hide it.
        let s3_cells = app.view(|s| s.get_cells(s3.clone())).unwrap();
        let c = s3_cells
            .iter()
            .find(|c| c.row_id == "0" && c.col_id == "0")
            .unwrap();
        assert_eq!(c.computed_value, "#CYCLE!");
    }

    #[test]
    fn get_cells_scoped_preserves_ref_to_missing_sheet() {
        let mut app = make_app();
        let s1 = app.call(|s| s.create_sheet("Sheet 1".into())).unwrap();
        // Reference a sheet id that does not exist → #REF! (all sheet ids are
        // passed to the evaluator, so this stays exact under scoping).
        app.call(|s| s.set_cell(s1.clone(), "0".into(), "0".into(), "=[nope]!A1".into()))
            .unwrap();
        let cells = app.view(|s| s.get_cells(s1.clone())).unwrap();
        let a1 = cells
            .iter()
            .find(|c| c.row_id == "0" && c.col_id == "0")
            .unwrap();
        assert_eq!(a1.computed_value, "#REF!");
    }

    fn cell_at<'a>(cells: &'a [Cell], row_id: &str, col_id: &str) -> Option<&'a Cell> {
        cells
            .iter()
            .find(|c| c.row_id == row_id && c.col_id == col_id)
    }

    fn new_sheet(app: &mut TestHost<Spreadsheet>) -> String {
        app.call(|s| s.init_project("P".into())).unwrap();
        app.call(|s| s.create_sheet("S".into())).unwrap()
    }

    #[test]
    fn an_inserted_row_is_one_write_and_ranges_take_it_in() {
        let mut app = make_app();
        let sid = new_sheet(&mut app);
        for (r, v) in [("0", "1"), ("1", "2"), ("2", "3")] {
            app.call(|s| s.set_cell(sid.clone(), r.into(), "0".into(), v.into()))
                .unwrap();
        }
        app.call(|s| s.set_cell(sid.clone(), "0".into(), "1".into(), "=SUM(A1:A3)".into()))
            .unwrap();
        // A row between legacy rows 0 and 1, holding 10.
        let pos = format!("{}5", layout::legacy_pos(0));
        app.call(|s| {
            s.apply_axis_ops(
                sid.clone(),
                vec![AxisOp::InsertRow {
                    id: "nab".into(),
                    pos,
                }],
            )
        })
        .unwrap();
        app.call(|s| s.set_cell(sid.clone(), "nab".into(), "0".into(), "10".into()))
            .unwrap();
        let cells = app.view(|s| s.get_cells(sid.clone())).unwrap();
        assert_eq!(cell_at(&cells, "0", "1").unwrap().computed_value, "16");
        assert_eq!(cell_at(&cells, "nab", "0").unwrap().raw_value, "10");
        let layouts = app.view(|s| s.get_layouts()).unwrap();
        assert_eq!(layouts.len(), 1);
        assert_eq!(layouts[0].rows[0].id, "nab");
    }

    #[test]
    fn a_deleted_row_turns_references_to_it_into_ref_errors() {
        let mut app = make_app();
        let sid = new_sheet(&mut app);
        app.call(|s| s.set_cell(sid.clone(), "1".into(), "0".into(), "5".into()))
            .unwrap();
        app.call(|s| s.set_cell(sid.clone(), "0".into(), "1".into(), "=A2*2".into()))
            .unwrap();
        app.call(|s| s.apply_axis_ops(sid.clone(), vec![AxisOp::DeleteRow { id: "1".into() }]))
            .unwrap();
        let cells = app.view(|s| s.get_cells(sid.clone())).unwrap();
        assert_eq!(cell_at(&cells, "0", "1").unwrap().computed_value, "#REF!");
    }

    #[test]
    fn axis_ops_reject_bad_ids_and_positions() {
        let mut app = make_app();
        let sid = new_sheet(&mut app);
        let bad = [
            AxisOp::InsertRow {
                id: "7".into(),
                pos: "5".into(),
            },
            AxisOp::InsertRow {
                id: "n|x".into(),
                pos: "5".into(),
            },
            AxisOp::InsertCol {
                id: "nab".into(),
                pos: "".into(),
            },
            AxisOp::InsertCol {
                id: "nab".into(),
                pos: "1a".into(),
            },
            AxisOp::DeleteRow { id: "nzz".into() },
        ];
        for op in bad {
            assert!(
                app.call(|s| s.apply_axis_ops(sid.clone(), vec![op.clone()]))
                    .is_err(),
                "{op:?}"
            );
        }
    }

    #[test]
    fn a_value_write_leaves_a_concurrent_format_alone() {
        let mut app = make_app();
        let sid = new_sheet(&mut app);
        app.call(|s| s.set_cell_format(sid.clone(), "0".into(), "0".into(), "currency".into()))
            .unwrap();
        app.call(|s| s.set_cell(sid.clone(), "0".into(), "0".into(), "12".into()))
            .unwrap();
        let cells = app.view(|s| s.get_cells(sid.clone())).unwrap();
        let a1 = cell_at(&cells, "0", "0").unwrap();
        assert_eq!(
            (a1.raw_value.as_str(), a1.format.as_str()),
            ("12", "currency")
        );
        // The value lives in the cell, the format in its own register: a
        // replica that only changed the value cannot win over the format.
        let mut mine = FormatData {
            format: "currency".into(),
            updated_at: 5,
        };
        mine.merge(&FormatData {
            format: "percent".into(),
            updated_at: 9,
        })
        .unwrap();
        assert_eq!(mine.format, "percent");
    }

    #[test]
    fn a_v1_format_applies_until_overridden_and_clear_blanks_both() {
        let mut app = make_app();
        let sid = new_sheet(&mut app);
        app.call(|s| s.set_cell(sid.clone(), "0".into(), "0".into(), "3".into()))
            .unwrap();
        // A cell as v1 left it: its format inside the cell.
        app.call(|s| {
            let key = Spreadsheet::cell_key(&sid, "0", "0");
            s.cells.get_mut(&key).unwrap().unwrap().format = "percent".into();
            Ok::<(), AppError>(())
        })
        .unwrap();
        let cells = app.view(|s| s.get_cells(sid.clone())).unwrap();
        assert_eq!(cell_at(&cells, "0", "0").unwrap().format, "percent");
        app.call(|s| s.clear_cell(sid.clone(), "0".into(), "0".into()))
            .unwrap();
        let cells = app.view(|s| s.get_cells(sid.clone())).unwrap();
        assert!(cell_at(&cells, "0", "0").is_none());
    }

    #[test]
    fn axis_merge_is_last_writer_wins_and_keeps_the_smaller_position() {
        let mut a = AxisData {
            pos: "0000000015".into(),
            deleted: false,
            updated_at: 1,
        };
        a.merge(&AxisData {
            pos: "0000000014".into(),
            deleted: true,
            updated_at: 2,
        })
        .unwrap();
        assert!(a.deleted);
        assert_eq!(a.pos, "0000000014");
        a.merge(&AxisData {
            pos: "0000000019".into(),
            deleted: false,
            updated_at: 3,
        })
        .unwrap();
        // A newer restore wins over the delete.
        assert!(!a.deleted);
        assert_eq!(a.pos, "0000000014");
        // An older delete does not.
        a.merge(&AxisData {
            pos: "0000000014".into(),
            deleted: true,
            updated_at: 2,
        })
        .unwrap();
        assert!(!a.deleted);
    }

    #[test]
    fn a_restored_row_is_back_with_its_cells() {
        let mut app = make_app();
        let sid = new_sheet(&mut app);
        app.call(|s| s.set_cell(sid.clone(), "1".into(), "0".into(), "5".into()))
            .unwrap();
        app.call(|s| s.set_cell(sid.clone(), "0".into(), "1".into(), "=A2".into()))
            .unwrap();
        app.call(|s| s.apply_axis_ops(sid.clone(), vec![AxisOp::DeleteRow { id: "1".into() }]))
            .unwrap();
        let cells = app.view(|s| s.get_cells(sid.clone())).unwrap();
        assert_eq!(cell_at(&cells, "0", "1").unwrap().computed_value, "#REF!");
        app.call(|s| s.apply_axis_ops(sid.clone(), vec![AxisOp::RestoreRow { id: "1".into() }]))
            .unwrap();
        let cells = app.view(|s| s.get_cells(sid.clone())).unwrap();
        assert_eq!(cell_at(&cells, "0", "1").unwrap().computed_value, "5");
    }

    #[test]
    fn named_ranges_feed_formulas_and_can_be_deleted() {
        let mut app = make_app();
        let sid = new_sheet(&mut app);
        for (r, v) in [("0", "4"), ("1", "6")] {
            app.call(|s| s.set_cell(sid.clone(), r.into(), "1".into(), v.into()))
                .unwrap();
        }
        let target = format!("[{sid}]!B1:B2");
        app.call(|s| s.set_named_range("Costs".into(), target.clone()))
            .unwrap();
        app.call(|s| s.set_cell(sid.clone(), "0".into(), "0".into(), "=SUM(costs)".into()))
            .unwrap();
        let cells = app.view(|s| s.get_cells(sid.clone())).unwrap();
        assert_eq!(cell_at(&cells, "0", "0").unwrap().computed_value, "10");
        let names = app.view(|s| s.get_named_ranges()).unwrap();
        assert_eq!(
            (names[0].name.as_str(), names[0].target.as_str()),
            ("Costs", target.as_str())
        );

        app.call(|s| s.delete_named_range("COSTS".into())).unwrap();
        assert!(app.view(|s| s.get_named_ranges()).unwrap().is_empty());
        let cells = app.view(|s| s.get_cells(sid.clone())).unwrap();
        assert_eq!(cell_at(&cells, "0", "0").unwrap().computed_value, "#NAME?");
        // Defining it again after a delete works: the key was never removed.
        app.call(|s| s.set_named_range("Costs".into(), "B1".into()))
            .unwrap();
    }

    #[test]
    fn named_ranges_reject_bad_names_and_targets() {
        let mut app = make_app();
        new_sheet(&mut app);
        assert!(app
            .call(|s| s.set_named_range("Q1".into(), "A1".into()))
            .is_err());
        assert!(app
            .call(|s| s.set_named_range("Tax".into(), "A1+1".into()))
            .is_err());
        assert!(app.call(|s| s.delete_named_range("Nope".into())).is_err());
    }

    #[test]
    fn edits_are_logged_with_before_and_after_and_stamp_the_editor() {
        let mut app = make_app();
        let sid = new_sheet(&mut app);
        let me = app.view(|s| s.whoami()).unwrap();
        app.call(|s| s.set_cell(sid.clone(), "0".into(), "0".into(), "5".into()))
            .unwrap();
        app.call(|s| s.set_cell(sid.clone(), "0".into(), "0".into(), "7".into()))
            .unwrap();
        app.call(|s| s.set_cell_format(sid.clone(), "0".into(), "0".into(), "currency".into()))
            .unwrap();
        // Writing the same value again changes nothing and logs nothing.
        app.call(|s| s.set_cell(sid.clone(), "0".into(), "0".into(), "7".into()))
            .unwrap();
        let log = app.view(|s| s.get_activity(0, 100)).unwrap();
        let cell_entries: Vec<&ActivityEntry> = log.iter().filter(|e| e.kind == "cells").collect();
        assert_eq!(cell_entries.len(), 3, "{log:?}");
        // Newest first.
        assert_eq!(cell_entries[0].summary, "formatted a cell as currency");
        let edit = &cell_entries[1].changes[0];
        assert_eq!(
            (edit.before_raw.as_str(), edit.after_raw.as_str()),
            ("5", "7")
        );
        assert!(cell_entries.iter().all(|e| e.author == me));
        let cells = app.view(|s| s.get_cells(sid.clone())).unwrap();
        assert_eq!(cell_at(&cells, "0", "0").unwrap().last_editor, me);
        // The sheet creation was logged too.
        assert!(log
            .iter()
            .any(|e| e.kind == "sheet" && e.summary == "added sheet S"));
    }

    #[test]
    fn a_big_batch_logs_one_entry_with_the_count() {
        let mut app = make_app();
        let sid = new_sheet(&mut app);
        let ops: Vec<CellOp> = (0..90)
            .map(|i| CellOp::Set {
                row_id: i.to_string(),
                col_id: "0".into(),
                raw_value: "1".into(),
            })
            .collect();
        app.call(|s| s.apply_cell_ops(sid.clone(), ops)).unwrap();
        let log = app.view(|s| s.get_activity(0, 100)).unwrap();
        let entry = log.iter().find(|e| e.kind == "cells").unwrap();
        assert_eq!(entry.count, 90);
        assert_eq!(entry.summary, "changed 90 cells");
        assert_eq!(entry.changes.len(), MAX_LOGGED_CHANGES);
    }

    #[test]
    fn structural_and_name_actions_are_logged() {
        let mut app = make_app();
        let sid = new_sheet(&mut app);
        app.call(|s| {
            s.apply_axis_ops(
                sid.clone(),
                vec![
                    AxisOp::InsertRow {
                        id: "na".into(),
                        pos: "4".into(),
                    },
                    AxisOp::InsertRow {
                        id: "nb".into(),
                        pos: "3".into(),
                    },
                    AxisOp::DeleteCol { id: "2".into() },
                ],
            )
        })
        .unwrap();
        app.call(|s| s.set_named_range("Tax".into(), "A1".into()))
            .unwrap();
        let summaries: Vec<String> = app
            .view(|s| s.get_activity(0, 100))
            .unwrap()
            .into_iter()
            .map(|e| e.summary)
            .collect();
        assert!(
            summaries.contains(&"deleted 1 column, inserted 2 rows".to_string()),
            "{summaries:?}"
        );
        assert!(summaries.contains(&"defined the name Tax".to_string()));
    }

    #[test]
    fn comments_resolve_mentions_thread_and_resolve() {
        let mut app = make_app();
        let sid = new_sheet(&mut app);
        let ada = [7u8; 32];
        app.call_as(ada, |s| s.join("Ada Lovelace".into())).unwrap();
        app.call(|s| s.join("Sam".into())).unwrap();
        let ada_id = hex::encode(ada);
        let id = app
            .call(|s| {
                s.add_comment(
                    sid.clone(),
                    "0".into(),
                    "1".into(),
                    "@ada lovelace can you check this? cc @Nobody".into(),
                    String::new(),
                )
            })
            .unwrap();
        let reply = app
            .call_as(ada, |s| {
                s.add_comment(
                    sid.clone(),
                    "0".into(),
                    "1".into(),
                    "Looks right".into(),
                    id.clone(),
                )
            })
            .unwrap();
        let comments = app.view(|s| s.get_comments()).unwrap();
        assert_eq!(comments.len(), 2);
        assert_eq!(comments[0].mentions, vec![ada_id.clone()]);
        assert_eq!(comments[1].parent, id);
        assert!(app.events().iter().any(|e| e.kind == "CommentAdded"));

        // Anyone resolves; only the author edits or deletes.
        app.call_as(ada, |s| s.set_comment_resolved(id.clone(), true))
            .unwrap();
        assert!(app.view(|s| s.get_comments()).unwrap()[0].resolved);
        assert!(app
            .call(|s| s.edit_comment(reply.clone(), "no".into()))
            .is_err());
        assert!(app.call(|s| s.delete_comment(reply.clone())).is_err());
        app.call_as(ada, |s| s.delete_comment(reply.clone()))
            .unwrap();
        assert_eq!(app.view(|s| s.get_comments()).unwrap().len(), 1);
    }

    #[test]
    fn comments_reject_empty_text_and_unknown_parents() {
        let mut app = make_app();
        let sid = new_sheet(&mut app);
        assert!(app
            .call(|s| s.add_comment(
                sid.clone(),
                "0".into(),
                "0".into(),
                "   ".into(),
                String::new()
            ))
            .is_err());
        assert!(app
            .call(|s| s.add_comment(
                sid.clone(),
                "0".into(),
                "0".into(),
                "hi".into(),
                "nope".into()
            ))
            .is_err());
    }
}
