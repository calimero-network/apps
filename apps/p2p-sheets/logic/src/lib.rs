//! Spreadsheet service for p2p-sheets.
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
use calimero_storage::address::Id;
use calimero_storage::collections::crdt_meta::MergeError;
use calimero_storage::collections::rekey::RekeyTarget;
use calimero_storage::collections::{AuthoredMap, LwwRegister, Mergeable, UnorderedMap};
use calimero_storage::env as storage_env;
use p2p_sheets_recalc::recalc;
use p2p_sheets_types::{generate_id, validate_label, validate_sheet_name, Error};

pub mod events;
use events::Event;

// ---------------------------------------------------------------------------
// Internal data structs (Borsh-only — stored in collections)
// ---------------------------------------------------------------------------

/// A sheet tab stored in the shared UnorderedMap.
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

// Flat record (no nested Calimero collections) -> no-op re-key; required by
// the `Mergeable: RekeyTarget` supertrait bound (rc.9+).
impl RekeyTarget for SheetData {
    fn rekey_relative_to(&mut self, _parent_id: Id) {}
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

// Flat record (no nested Calimero collections) -> no-op re-key; required by
// the `Mergeable: RekeyTarget` supertrait bound (rc.9+).
impl RekeyTarget for CellData {
    fn rekey_relative_to(&mut self, _parent_id: Id) {}
}

impl Mergeable for CellData {
    fn merge(&mut self, other: &Self) -> Result<(), MergeError> {
        // LWW: newer update wins; deterministic tie-break by raw_value.
        if other.updated_at > self.updated_at
            || (other.updated_at == self.updated_at && other.raw_value > self.raw_value)
        {
            self.raw_value = other.raw_value.clone();
            self.format = other.format.clone();
            self.updated_at = other.updated_at;
        }
        Ok(())
    }
}

/// A cursor stored in the per-author AuthoredMap (keyed by author pubkey b58).
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

// Flat record (no nested Calimero collections) -> no-op re-key; required by
// the `Mergeable: RekeyTarget` supertrait bound (rc.9+).
impl RekeyTarget for CursorData {
    fn rekey_relative_to(&mut self, _parent_id: Id) {}
}

impl Mergeable for CursorData {
    fn merge(&mut self, other: &Self) -> Result<(), MergeError> {
        // Last update wins — the author only writes their own cursor.
        if other.updated_at > self.updated_at
            || (other.updated_at == self.updated_at && other.sheet_id > self.sheet_id)
        {
            self.sheet_id = other.sheet_id.clone();
            self.row = other.row;
            self.col = other.col;
            self.color = other.color.clone();
            self.updated_at = other.updated_at;
        }
        Ok(())
    }
}

// ---------------------------------------------------------------------------
// View types returned to callers (must derive Serialize + Deserialize)
// ---------------------------------------------------------------------------

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(crate = "calimero_sdk::serde")]
pub struct Sheet {
    pub id: String,
    pub name: String,
    pub position: u32,
    pub created_at: u64,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(crate = "calimero_sdk::serde")]
pub struct Cell {
    pub id: String,
    pub sheet_id: String,
    pub row: u32,
    pub col: u32,
    pub raw_value: String,
    pub computed_value: String,
    pub format: String,
    pub updated_at: u64,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(crate = "calimero_sdk::serde")]
#[serde(tag = "kind")]
pub enum CellOp {
    Set {
        row: u32,
        col: u32,
        raw_value: String,
    },
    Format {
        row: u32,
        col: u32,
        format: String,
    },
    Clear {
        row: u32,
        col: u32,
    },
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(crate = "calimero_sdk::serde")]
pub struct Cursor {
    /// Same as `author` — the pubkey b58 that uniquely identifies this cursor.
    pub id: String,
    pub author: String,
    pub sheet_id: String,
    pub row: u32,
    pub col: u32,
    pub color: String,
    pub updated_at: u64,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(crate = "calimero_sdk::serde")]
pub struct FunctionDef {
    pub name: String,
    pub syntax: String,
    pub description: String,
    pub example: String,
}

// ---------------------------------------------------------------------------
// State
// ---------------------------------------------------------------------------

// `#[app::state]` injects borsh derives itself (SDK 0.11+).
#[app::state(emits = for<'a> Event<'a>)]
pub struct Spreadsheet {
    /// Set once by `init_project`; empty until then.
    project_id: LwwRegister<String>,
    project_name: LwwRegister<String>,
    project_created_at: LwwRegister<u64>,
    /// Sheet tabs keyed by sheet id.
    sheets: UnorderedMap<String, SheetData>,
    /// Cells keyed by `"{sheet_id}|{row}|{col}"`.
    cells: UnorderedMap<String, CellData>,
    /// Live cursors keyed by author pubkey hex (one entry per connected user).
    cursors: AuthoredMap<String, CursorData>,
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
            cursors: AuthoredMap::new_with_field_name("spreadsheet:cursors"),
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
        if removed.is_none() {
            return Err(AppError::from(Error::NotFound(sheet_id.clone())));
        }
        // Remove all cells belonging to this sheet.
        let prefix = format!("{sheet_id}|");
        let orphan_keys: Vec<String> = self
            .cells
            .entries()
            .map_err(|e| AppError::msg(format!("cells.entries: {e}")))?
            .filter_map(|(k, _)| {
                if k.starts_with(&prefix) {
                    Some(k)
                } else {
                    None
                }
            })
            .collect();
        for k in orphan_keys {
            self.cells
                .remove(&k)
                .map_err(|e| AppError::msg(format!("cells.remove: {e}")))?;
        }
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

    // ── Non-emitting storage helpers ─────────────────────────────────────────
    // These do the storage-only work (no event). Single-cell methods verify the
    // sheet + emit their own per-cell event; `apply_cell_ops` verifies once and
    // emits ONE batch event. Keeping the emit OUT of the storage path is what lets
    // a bulk apply of N cells stay a single commit under the runtime's per-commit
    // event cap (`max_events` = 100) instead of overflowing at ~1 event/cell.

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

    /// Store a raw value (literal or formula — both stored verbatim; `get_cells`
    /// derives formulas on read). Preserves any existing format. No event.
    fn store_value(
        &mut self,
        sheet_id: &str,
        row: u32,
        col: u32,
        raw_value: String,
    ) -> app::Result<String> {
        let key = Spreadsheet::cell_key(sheet_id, row, col);
        let now = storage_env::time_now();
        let exists = self
            .cells
            .get(&key)
            .map_err(|e| AppError::msg(format!("cells.get: {e}")))?
            .is_some();
        if exists {
            let mut guard = self
                .cells
                .get_mut(&key)
                .map_err(|e| AppError::msg(format!("cells.get_mut: {e}")))?
                .unwrap();
            guard.raw_value = raw_value;
            guard.updated_at = now;
        } else {
            self.cells
                .insert(
                    key.clone(),
                    CellData {
                        id: key.clone(),
                        sheet_id: sheet_id.to_string(),
                        row,
                        col,
                        raw_value,
                        format: String::new(),
                        updated_at: now,
                    },
                )
                .map_err(|e| AppError::msg(format!("cells.insert: {e}")))?;
        }
        Ok(key)
    }

    /// Store only the display format, preserving any existing value. Creates the
    /// cell (empty value) if absent. No event.
    fn store_format(
        &mut self,
        sheet_id: &str,
        row: u32,
        col: u32,
        format: String,
    ) -> app::Result<String> {
        let key = Spreadsheet::cell_key(sheet_id, row, col);
        let now = storage_env::time_now();
        let exists = self
            .cells
            .get(&key)
            .map_err(|e| AppError::msg(format!("cells.get: {e}")))?
            .is_some();
        if exists {
            let mut guard = self
                .cells
                .get_mut(&key)
                .map_err(|e| AppError::msg(format!("cells.get_mut: {e}")))?
                .unwrap();
            guard.format = format;
            guard.updated_at = now;
        } else {
            self.cells
                .insert(
                    key.clone(),
                    CellData {
                        id: key.clone(),
                        sheet_id: sheet_id.to_string(),
                        row,
                        col,
                        raw_value: String::new(),
                        format,
                        updated_at: now,
                    },
                )
                .map_err(|e| AppError::msg(format!("cells.insert: {e}")))?;
        }
        Ok(key)
    }

    /// Soft-clear: blank the cell in place rather than removing it (removing
    /// tombstones the deterministic CRDT key, blocking a later re-write to the
    /// same coordinate). A fully-blank cell is treated as absent everywhere. No event.
    fn store_clear(&mut self, sheet_id: &str, row: u32, col: u32) -> app::Result<()> {
        let key = Spreadsheet::cell_key(sheet_id, row, col);
        if let Some(mut guard) = self
            .cells
            .get_mut(&key)
            .map_err(|e| AppError::msg(format!("cells.get_mut: {e}")))?
        {
            guard.raw_value = String::new();
            guard.format = String::new();
            guard.updated_at = storage_env::time_now();
        }
        Ok(())
    }

    pub fn set_cell(
        &mut self,
        sheet_id: String,
        row: u32,
        col: u32,
        raw_value: String,
    ) -> app::Result<String> {
        self.require_sheet(&sheet_id)?;
        let key = self.store_value(&sheet_id, row, col, raw_value)?;
        app::emit!(Event::CellUpdated {
            id: &key,
            sheet_id: &sheet_id
        });
        Ok(key)
    }

    pub fn set_cell_formula(
        &mut self,
        sheet_id: String,
        row: u32,
        col: u32,
        formula: String,
    ) -> app::Result<String> {
        self.require_sheet(&sheet_id)?;
        // Store the raw formula; `get_cells` derives its value (and every
        // dependent) on read, so one code path handles same- and cross-sheet refs.
        let key = self.store_value(&sheet_id, row, col, formula)?;
        app::emit!(Event::CellUpdated {
            id: &key,
            sheet_id: &sheet_id
        });
        Ok(key)
    }

    /// Set only the display format of a cell, preserving its value. Creates the
    /// cell (empty value) if it does not exist yet, so you can format ahead of
    /// typing. `format` is a keyword like "number"/"currency"/"percent"/"date"
    /// ("" = Automatic).
    pub fn set_cell_format(
        &mut self,
        sheet_id: String,
        row: u32,
        col: u32,
        format: String,
    ) -> app::Result<String> {
        self.require_sheet(&sheet_id)?;
        let key = self.store_format(&sheet_id, row, col, format)?;
        app::emit!(Event::CellUpdated {
            id: &key,
            sheet_id: &sheet_id
        });
        Ok(key)
    }

    pub fn clear_cell(&mut self, sheet_id: String, row: u32, col: u32) -> app::Result<()> {
        self.store_clear(&sheet_id, row, col)?;
        app::emit!(Event::CellCleared {
            sheet_id: &sheet_id,
            row,
            col,
        });
        Ok(())
    }

    /// Apply a batch of cell operations to one sheet in a single mutation. One
    /// CRDT commit for the whole range op; values are derived on read. Emits ONE
    /// `CellsChanged` event for the whole batch (not one per cell) so an arbitrarily
    /// large batch stays under the runtime's per-commit event cap.
    pub fn apply_cell_ops(&mut self, sheet_id: String, ops: Vec<CellOp>) -> app::Result<()> {
        self.require_sheet(&sheet_id)?;
        let count = ops.len() as u32;
        for op in ops {
            match op {
                // Literal and formula both store the raw string verbatim
                // (`get_cells` derives formulas on read), so one path handles both.
                CellOp::Set {
                    row,
                    col,
                    raw_value,
                } => {
                    self.store_value(&sheet_id, row, col, raw_value)?;
                }
                CellOp::Format { row, col, format } => {
                    self.store_format(&sheet_id, row, col, format)?;
                }
                CellOp::Clear { row, col } => {
                    self.store_clear(&sheet_id, row, col)?;
                }
            }
        }
        app::emit!(Event::CellsChanged {
            sheet_id: &sheet_id,
            count
        });
        Ok(())
    }

    /// Shared by `get_cells`/`get_all_cells`: filters out fully-blank cells
    /// (see the cleared-cell note below) and builds the output `Cell` list,
    /// looking up each cell's computed value (falling back to its raw value
    /// when recalc has nothing for it, e.g. blank-but-formatted cells).
    /// Does not sort — callers sort with their own key.
    fn cells_from_stored(
        stored: impl IntoIterator<Item = CellData>,
        computed: &std::collections::BTreeMap<recalc::CellRef, String>,
    ) -> Vec<Cell> {
        stored
            .into_iter()
            .filter_map(|d| {
                // A cleared cell is kept in the map (blank in place) rather than
                // removed, so its coordinate can be re-written — removing it
                // tombstones the deterministic key and blocks re-insertion. Such
                // fully-blank cells are hidden here so consumers still see a
                // cleared cell as gone. A value-less but formatted cell stays.
                if d.raw_value.is_empty() && d.format.is_empty() {
                    return None;
                }
                // `d` is owned here, so its fields move into `Cell` directly
                // instead of being cloned. `raw_value` is only cloned in the
                // fallback branch (no computed value for this cell) — the
                // common case (a hit in `computed`) clones nothing.
                let cv = computed
                    .get(&recalc::CellRef {
                        sheet_id: d.sheet_id.clone(),
                        row: d.row,
                        col: d.col,
                    })
                    .cloned()
                    .unwrap_or_else(|| d.raw_value.clone());
                Some(Cell {
                    id: d.id,
                    sheet_id: d.sheet_id,
                    row: d.row,
                    col: d.col,
                    raw_value: d.raw_value,
                    computed_value: cv,
                    format: d.format,
                    updated_at: d.updated_at,
                })
            })
            .collect()
    }

    pub fn get_cells(&self, sheet_id: String) -> app::Result<Vec<Cell>> {
        // Collect all non-empty cells once; `stored` retains every cell (the
        // output for the requested sheet is filtered from it below).
        let mut all_inputs: std::collections::BTreeMap<recalc::CellRef, String> =
            std::collections::BTreeMap::new();
        let mut stored: Vec<CellData> = Vec::new();
        for (_k, d) in self
            .cells
            .entries()
            .map_err(|e| AppError::msg(format!("cells.entries: {e}")))?
        {
            if !d.raw_value.is_empty() {
                all_inputs.insert(
                    recalc::CellRef {
                        sheet_id: d.sheet_id.clone(),
                        row: d.row,
                        col: d.col,
                    },
                    d.raw_value.clone(),
                );
            }
            stored.push(d);
        }

        // Build the set of valid sheet ids for error detection.
        let sheet_ids: std::collections::HashSet<String> = self
            .sheets
            .entries()
            .map_err(|e| AppError::msg(format!("sheets.entries: {e}")))?
            .map(|(id, _)| id)
            .collect();

        // Sheet-level read scoping: evaluate only the requested sheet and the
        // sheets it transitively references. `sheet_ids` stays the FULL set so
        // unknown-sheet → #REF! detection is exact. Result is identical to a
        // whole-workbook eval (unreachable sheets cannot affect this sheet).
        let closure = recalc::sheet_closure(&all_inputs, &sheet_id);
        let inputs = recalc::WorkbookInputs {
            cells: all_inputs
                .into_iter()
                .filter(|(k, _)| closure.contains(&k.sheet_id))
                .collect(),
            sheet_ids,
        };
        let computed = recalc::evaluate(&inputs);

        // `d.sheet_id` mirrors the `"{sheet_id}|{row}|{col}"` map key (see
        // `cell_key`), so filtering on it is equivalent to the old
        // key-prefix check without needing to keep the map key around.
        let mut out = Spreadsheet::cells_from_stored(
            stored.into_iter().filter(|d| d.sheet_id == sheet_id),
            &computed,
        );
        out.sort_by_key(|c| (c.row, c.col));
        Ok(out)
    }

    /// Every non-blank cell across ALL sheets, with raw + computed values —
    /// a single-call warm-store read for the client. Unlike `get_cells`
    /// (scoped to one sheet's closure), this evaluates the whole workbook
    /// once. `export_all` is metadata-only (sheets) and is unrelated.
    pub fn get_all_cells(&self) -> app::Result<Vec<Cell>> {
        let mut all_inputs: std::collections::BTreeMap<recalc::CellRef, String> =
            std::collections::BTreeMap::new();
        let mut stored: Vec<CellData> = Vec::new();
        for (_k, d) in self
            .cells
            .entries()
            .map_err(|e| AppError::msg(format!("cells.entries: {e}")))?
        {
            if !d.raw_value.is_empty() {
                all_inputs.insert(
                    recalc::CellRef {
                        sheet_id: d.sheet_id.clone(),
                        row: d.row,
                        col: d.col,
                    },
                    d.raw_value.clone(),
                );
            }
            stored.push(d);
        }
        let sheet_ids: std::collections::HashSet<String> = self
            .sheets
            .entries()
            .map_err(|e| AppError::msg(format!("sheets.entries: {e}")))?
            .map(|(id, _)| id)
            .collect();
        let computed = recalc::evaluate(&recalc::WorkbookInputs {
            cells: all_inputs,
            sheet_ids,
        });

        let mut out = Spreadsheet::cells_from_stored(stored, &computed);
        out.sort_by_key(|c| (c.sheet_id.clone(), c.row, c.col));
        Ok(out)
    }

    // ---- Cursors ----

    pub fn update_cursor(&mut self, sheet_id: String, row: u32, col: u32) -> app::Result<()> {
        let author = self.caller_hex();
        let color = Spreadsheet::assign_color(&author);
        let now = storage_env::time_now();
        let data = CursorData {
            sheet_id: sheet_id.clone(),
            row,
            col,
            color,
            updated_at: now,
        };
        let exists = self
            .cursors
            .contains(&author)
            .map_err(|e| AppError::msg(format!("cursors.contains: {e}")))?;
        if exists {
            self.cursors
                .update(&author, data)
                .map_err(|e| AppError::msg(format!("cursors.update: {e}")))?;
        } else {
            self.cursors
                .insert(author.clone(), data)
                .map_err(|e| AppError::msg(format!("cursors.insert: {e}")))?;
        }
        app::emit!(Event::CursorMoved {
            author: &author,
            sheet_id: &sheet_id,
        });
        Ok(())
    }

    pub fn remove_cursor(&mut self) -> app::Result<()> {
        let author = self.caller_hex();
        self.cursors
            .remove(&author)
            .map_err(|e| AppError::msg(format!("cursors.remove: {e}")))?;
        app::emit!(Event::CursorRemoved { author: &author });
        Ok(())
    }

    pub fn get_cursors(&self) -> app::Result<Vec<Cursor>> {
        let mut out: Vec<Cursor> = self
            .cursors
            .entries()
            .map_err(|e| AppError::msg(format!("cursors.entries: {e}")))?
            .map(|(author, d)| Cursor {
                id: author.clone(),
                author: author.clone(),
                sheet_id: d.sheet_id.clone(),
                row: d.row,
                col: d.col,
                color: d.color.clone(),
                updated_at: d.updated_at,
            })
            .collect();
        out.sort_by(|a, b| a.author.cmp(&b.author));
        Ok(out)
    }

    // ---- Function help ----

    pub fn get_functions(&self) -> app::Result<Vec<FunctionDef>> {
        let mut fns = builtin_functions();
        fns.sort_by(|a, b| a.name.cmp(&b.name));
        Ok(fns)
    }

    pub fn search_functions(&self, prefix: String) -> app::Result<Vec<FunctionDef>> {
        let upper = prefix.to_uppercase();
        let mut fns: Vec<FunctionDef> = builtin_functions()
            .into_iter()
            .filter(|f| f.name.starts_with(&upper))
            .collect();
        fns.sort_by(|a, b| a.name.cmp(&b.name));
        Ok(fns)
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
    /// This device's id, hex. A live cursor is per-INSTALLATION state — one
    /// entry per connected session — so it keys on the device, not the account
    /// (core's own rule: `device_id` is "right for per-writer state"). Was
    /// `bs58::encode(env::executor_id())`; rc.20 removed `executor_id` and rc.27
    /// removed base58 (core#3691).
    fn caller_hex(&self) -> String {
        hex::encode(env::device_id())
    }

    fn cell_key(sheet_id: &str, row: u32, col: u32) -> String {
        format!("{sheet_id}|{row}|{col}")
    }

    /// Deterministic colour derived from the author pubkey so it is stable
    /// across sessions without any server-side assignment.
    fn assign_color(pubkey_hex: &str) -> String {
        const PALETTE: &[&str] = &[
            "#E74C3C", "#3498DB", "#2ECC71", "#F39C12", "#9B59B6", "#1ABC9C", "#E67E22", "#34495E",
            "#E91E63", "#00BCD4", "#FF5722", "#8BC34A", "#607D8B", "#FF9800", "#673AB7",
        ];
        let idx = pubkey_hex
            .bytes()
            .fold(0usize, |acc, b| acc.wrapping_add(b as usize));
        PALETTE[idx % PALETTE.len()].to_string()
    }
}

// ---------------------------------------------------------------------------
// Built-in function list
// ---------------------------------------------------------------------------

fn builtin_functions() -> Vec<FunctionDef> {
    vec![
        FunctionDef {
            name: "SUM".into(),
            syntax: "SUM(range)".into(),
            description: "Adds all numeric values in a range.".into(),
            example: "=SUM(A1:A10)".into(),
        },
        FunctionDef {
            name: "AVERAGE".into(),
            syntax: "AVERAGE(range)".into(),
            description: "Returns the arithmetic mean of values in a range.".into(),
            example: "=AVERAGE(B1:B5)".into(),
        },
        FunctionDef {
            name: "MIN".into(),
            syntax: "MIN(range)".into(),
            description: "Returns the minimum numeric value in a range.".into(),
            example: "=MIN(C1:C10)".into(),
        },
        FunctionDef {
            name: "MAX".into(),
            syntax: "MAX(range)".into(),
            description: "Returns the maximum numeric value in a range.".into(),
            example: "=MAX(D1:D10)".into(),
        },
        FunctionDef {
            name: "COUNT".into(),
            syntax: "COUNT(range)".into(),
            description: "Counts the number of cells with numeric values in a range.".into(),
            example: "=COUNT(E1:E20)".into(),
        },
        FunctionDef {
            name: "IF".into(),
            syntax: "IF(condition, value_if_true, value_if_false)".into(),
            description: "Returns one of two values depending on whether a condition is non-zero."
                .into(),
            example: "=IF(A1, B1, C1)".into(),
        },
    ]
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
        app.call(|s| s.set_cell(sid.clone(), 0, 0, "42".into()))
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
            .call(|s| s.set_cell(sid.clone(), 0, 0, "1500".into()))
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
        app.call(|s| s.set_cell(sid.clone(), 0, 0, "1234.5".into()))
            .unwrap();
        app.call(|s| s.set_cell_format(sid.clone(), 0, 0, "currency".into()))
            .unwrap();
        let cells = app.view(|s| s.get_cells(sid.clone())).unwrap();
        let a1 = cells.iter().find(|c| c.row == 0 && c.col == 0).unwrap();
        assert_eq!(a1.format, "currency");
        assert_eq!(a1.raw_value, "1234.5", "value preserved when format is set");
    }

    #[test]
    fn setting_value_preserves_existing_format() {
        let mut app = make_app();
        app.call(|s| s.init_project("P".into())).unwrap();
        let sid = app.call(|s| s.create_sheet("S".into())).unwrap();
        // Format an empty cell, then type a value into it.
        app.call(|s| s.set_cell_format(sid.clone(), 0, 0, "percent".into()))
            .unwrap();
        app.call(|s| s.set_cell(sid.clone(), 0, 0, "0.25".into()))
            .unwrap();
        let cells = app.view(|s| s.get_cells(sid.clone())).unwrap();
        let a1 = cells.iter().find(|c| c.row == 0 && c.col == 0).unwrap();
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
        app.call(|s| s.set_cell(sid.clone(), 0, 0, "10".into()))
            .unwrap();
        app.call(|s| s.set_cell(sid.clone(), 1, 0, "20".into()))
            .unwrap();
        app.call(|s| s.set_cell(sid.clone(), 2, 0, "30".into()))
            .unwrap();
        // SUM(A1:A3) should be 60.
        let fid = app
            .call(|s| s.set_cell_formula(sid.clone(), 3, 0, "=SUM(A1:A3)".into()))
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
        app.call(|s| s.set_cell(sid.clone(), 0, 0, "10".into()))
            .unwrap(); // A1 = 10
        app.call(|s| s.set_cell(sid.clone(), 1, 0, "20".into()))
            .unwrap(); // A2 = 20
                       // $ anchors are evaluation no-ops: these must all compute like the bare refs.
        app.call(|s| s.set_cell_formula(sid.clone(), 0, 1, "=$A$1".into()))
            .unwrap(); // B1
        app.call(|s| s.set_cell_formula(sid.clone(), 1, 1, "=A$1+$A2".into()))
            .unwrap(); // B2
        app.call(|s| s.set_cell_formula(sid.clone(), 2, 1, "=SUM($A$1:$A$2)".into()))
            .unwrap(); // B3
        let cells = app.view(|s| s.get_cells(sid.clone())).unwrap();
        let get = |r: u32, c: u32| {
            cells
                .iter()
                .find(|x| x.row == r && x.col == c)
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
        app.call(|s| s.set_cell(sid.clone(), 0, 0, "1".into()))
            .unwrap(); // A1 = 1
        app.call(|s| s.set_cell(sid.clone(), 1, 0, "2".into()))
            .unwrap(); // A2 = 2
                       // A3 = SUM(A1,A2) = 3
        app.call(|s| s.set_cell_formula(sid.clone(), 2, 0, "=SUM(A1,A2)".into()))
            .unwrap();
        // B1 = A3 * 10 = 30 (chained: B1 → A3 → A2)
        app.call(|s| s.set_cell_formula(sid.clone(), 0, 1, "=A3*10".into()))
            .unwrap();

        // Change A2 to 5. A3 must recompute to 6, and B1 (which depends on A3)
        // must recompute to 60.
        app.call(|s| s.set_cell(sid.clone(), 1, 0, "5".into()))
            .unwrap();

        let cells = app.view(|s| s.get_cells(sid)).unwrap();
        let a3 = cells.iter().find(|c| c.row == 2 && c.col == 0).unwrap();
        let b1 = cells.iter().find(|c| c.row == 0 && c.col == 1).unwrap();
        assert_eq!(a3.computed_value, "6", "A3 = SUM(A1,A2) after A2→5");
        assert_eq!(b1.computed_value, "60", "B1 = A3*10 after chain recompute");
    }

    #[test]
    fn clearing_a_cell_recomputes_dependents() {
        let mut app = make_app();
        app.call(|s| s.init_project("P".into())).unwrap();
        let sid = app.call(|s| s.create_sheet("S".into())).unwrap();
        app.call(|s| s.set_cell(sid.clone(), 0, 0, "10".into()))
            .unwrap(); // A1
        app.call(|s| s.set_cell(sid.clone(), 1, 0, "20".into()))
            .unwrap(); // A2
        app.call(|s| s.set_cell_formula(sid.clone(), 2, 0, "=SUM(A1:A2)".into()))
            .unwrap(); // A3 = 30
                       // Clear A2 → A3 should recompute to 10.
        app.call(|s| s.clear_cell(sid.clone(), 1, 0)).unwrap();
        let cells = app.view(|s| s.get_cells(sid)).unwrap();
        let a3 = cells.iter().find(|c| c.row == 2 && c.col == 0).unwrap();
        assert_eq!(a3.computed_value, "10");
    }

    #[test]
    fn cross_sheet_cell_and_range_references() {
        let mut app = make_app();
        app.call(|s| s.init_project("P".into())).unwrap();
        let s1 = app.call(|s| s.create_sheet("Sheet1".into())).unwrap();
        let data = app.call(|s| s.create_sheet("Data".into())).unwrap();
        // Data!A1 = 10, Data!A2 = 20
        app.call(|s| s.set_cell(data.clone(), 0, 0, "10".into()))
            .unwrap();
        app.call(|s| s.set_cell(data.clone(), 1, 0, "20".into()))
            .unwrap();
        // Sheet1!B1 = =[data]!A1 + [data]!A2 → 30
        app.call(|s| s.set_cell_formula(s1.clone(), 0, 1, format!("=[{data}]!A1+[{data}]!A2")))
            .unwrap();
        // Sheet1!B2 = =SUM([data]!A1:A2) → 30
        app.call(|s| s.set_cell_formula(s1.clone(), 1, 1, format!("=SUM([{data}]!A1:A2)")))
            .unwrap();
        let cells = app.view(|s| s.get_cells(s1.clone())).unwrap();
        let b1 = cells.iter().find(|c| c.row == 0 && c.col == 1).unwrap();
        let b2 = cells.iter().find(|c| c.row == 1 && c.col == 1).unwrap();
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
        app.call(|s| s.set_cell_formula(sid.clone(), 0, 0, "=[sheet-does-not-exist]!A1".into()))
            .unwrap();
        // resolves to #REF! because no sheet has that id
        let cells = app.view(|s| s.get_cells(sid.clone())).unwrap();
        let a1 = cells.iter().find(|c| c.row == 0 && c.col == 0).unwrap();
        assert_eq!(a1.computed_value, "#REF!", "unknown sheet id → #REF!");
    }

    #[test]
    fn cross_sheet_recompute_propagates() {
        let mut app = make_app();
        app.call(|s| s.init_project("P".into())).unwrap();
        let a = app.call(|s| s.create_sheet("A".into())).unwrap();
        let b = app.call(|s| s.create_sheet("B".into())).unwrap();
        app.call(|s| s.set_cell(a.clone(), 0, 0, "5".into()))
            .unwrap(); // [a]!A1 = 5
        app.call(|s| s.set_cell_formula(b.clone(), 0, 0, format!("=[{a}]!A1*10")))
            .unwrap(); // [b]!A1 = 50
                       // Change [a]!A1 → 8; [b]!A1 (on the other sheet) must recompute to 80.
        app.call(|s| s.set_cell(a.clone(), 0, 0, "8".into()))
            .unwrap();
        let cells = app.view(|s| s.get_cells(b.clone())).unwrap();
        let a1 = cells.iter().find(|c| c.row == 0 && c.col == 0).unwrap();
        assert_eq!(a1.computed_value, "80");
    }

    #[test]
    fn clear_cell_removes_it() {
        let mut app = make_app();
        app.call(|s| s.init_project("P".into())).unwrap();
        let sid = app.call(|s| s.create_sheet("S".into())).unwrap();
        app.call(|s| s.set_cell(sid.clone(), 0, 0, "99".into()))
            .unwrap();
        app.call(|s| s.clear_cell(sid.clone(), 0, 0)).unwrap();
        let cells = app.view(|s| s.get_cells(sid)).unwrap();
        assert!(cells.is_empty());
    }

    #[test]
    fn cleared_cell_can_be_rewritten() {
        let mut app = make_app();
        app.call(|s| s.init_project("P".into())).unwrap();
        let sid = app.call(|s| s.create_sheet("S".into())).unwrap();
        app.call(|s| s.set_cell(sid.clone(), 0, 0, "first".into()))
            .unwrap();
        app.call(|s| s.clear_cell(sid.clone(), 0, 0)).unwrap();
        // Writing the same coordinate again after a clear must persist — a paste
        // or a fresh type into a previously-deleted cell.
        app.call(|s| s.set_cell(sid.clone(), 0, 0, "second".into()))
            .unwrap();
        let cells = app.view(|s| s.get_cells(sid)).unwrap();
        let a1 = cells.iter().find(|c| c.row == 0 && c.col == 0);
        assert!(
            a1.is_some(),
            "cell missing after re-write of a cleared cell"
        );
        assert_eq!(a1.unwrap().raw_value, "second");
    }

    #[test]
    fn apply_cell_ops_applies_mixed_batch() {
        let mut app = make_app();
        app.call(|s| s.init_project("P".into())).unwrap();
        let sid = app.call(|s| s.create_sheet("Sheet 1".into())).unwrap();
        app.call(|s| s.set_cell(sid.clone(), 5, 5, "old".into()))
            .unwrap();
        let ev_before = app.events().len();
        app.call(|s| {
            s.apply_cell_ops(
                sid.clone(),
                vec![
                    CellOp::Set {
                        row: 0,
                        col: 0,
                        raw_value: "7".into(),
                    },
                    CellOp::Set {
                        row: 1,
                        col: 0,
                        raw_value: "=A1*2".into(),
                    },
                    CellOp::Format {
                        row: 0,
                        col: 0,
                        format: "number".into(),
                    },
                    CellOp::Clear { row: 5, col: 5 },
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
        let a1 = cells.iter().find(|c| c.row == 0 && c.col == 0).unwrap();
        let a2 = cells.iter().find(|c| c.row == 1 && c.col == 0).unwrap();
        assert_eq!(a1.computed_value, "7");
        assert_eq!(a1.format, "number");
        assert_eq!(a2.computed_value, "14"); // derived on read
        assert!(
            cells.iter().all(|c| !(c.row == 5 && c.col == 5)),
            "cleared cell hidden"
        );
    }

    #[test]
    fn update_and_get_cursors() {
        let mut app = make_app();
        app.call(|s| s.init_project("P".into())).unwrap();
        let sid = app.call(|s| s.create_sheet("S".into())).unwrap();
        app.call(|s| s.update_cursor(sid.clone(), 2, 3)).unwrap();
        let cursors = app.view(|s| s.get_cursors()).unwrap();
        assert_eq!(cursors.len(), 1);
        assert_eq!(cursors[0].row, 2);
        assert_eq!(cursors[0].col, 3);
        assert_eq!(cursors[0].sheet_id, sid);
    }

    #[test]
    fn remove_cursor_clears_it() {
        let mut app = make_app();
        app.call(|s| s.init_project("P".into())).unwrap();
        let sid = app.call(|s| s.create_sheet("S".into())).unwrap();
        app.call(|s| s.update_cursor(sid, 0, 0)).unwrap();
        app.call(|s| s.remove_cursor()).unwrap();
        let cursors = app.view(|s| s.get_cursors()).unwrap();
        assert!(cursors.is_empty());
    }

    #[test]
    fn get_functions_returns_all() {
        let app = make_app();
        let fns = app.view(|s| s.get_functions()).unwrap();
        assert_eq!(fns.len(), 6);
        // Sorted alphabetically.
        assert_eq!(fns[0].name, "AVERAGE");
        assert_eq!(fns[5].name, "SUM");
    }

    #[test]
    fn search_functions_filters_by_prefix() {
        let app = make_app();
        let fns = app.view(|s| s.search_functions("SU".into())).unwrap();
        assert_eq!(fns.len(), 1);
        assert_eq!(fns[0].name, "SUM");
    }

    #[test]
    fn get_all_cells_spans_sheets_with_computed_values() {
        let mut app = make_app();
        app.call(|s| s.init_project("P".into())).unwrap();
        let s1 = app.call(|s| s.create_sheet("One".into())).unwrap();
        let s2 = app.call(|s| s.create_sheet("Two".into())).unwrap();
        app.call(|s| s.set_cell(s1.clone(), 0, 0, "10".into()))
            .unwrap();
        app.call(|s| s.set_cell(s2.clone(), 0, 0, format!("=[{s1}]!A1*2")))
            .unwrap();

        let all = app.view(|s| s.get_all_cells()).unwrap();
        // Both sheets' cells present; cross-sheet computed value derived (20).
        let c2 = all
            .iter()
            .find(|c| c.sheet_id == s2 && c.row == 0 && c.col == 0)
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
            .call(|s| s.set_cell("no-such-sheet".into(), 0, 0, "v".into()))
            .is_err());
    }

    #[test]
    fn formula_average_and_count() {
        let mut app = make_app();
        app.call(|s| s.init_project("P".into())).unwrap();
        let sid = app.call(|s| s.create_sheet("S".into())).unwrap();
        app.call(|s| s.set_cell(sid.clone(), 0, 0, "10".into()))
            .unwrap();
        app.call(|s| s.set_cell(sid.clone(), 1, 0, "20".into()))
            .unwrap();
        app.call(|s| s.set_cell_formula(sid.clone(), 2, 0, "=AVERAGE(A1:A2)".into()))
            .unwrap();
        app.call(|s| s.set_cell_formula(sid.clone(), 3, 0, "=COUNT(A1:A2)".into()))
            .unwrap();
        let cells = app.view(|s| s.get_cells(sid)).unwrap();
        let avg = cells.iter().find(|c| c.row == 2).unwrap();
        let cnt = cells.iter().find(|c| c.row == 3).unwrap();
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
        app.call(|s| s.set_cell(data.clone(), 0, 0, "10".into()))
            .unwrap();
        let formula = format!("=[{data}]!A1*2");
        app.call(|s| s.set_cell_formula(main.clone(), 0, 0, formula.clone()))
            .unwrap();
        let before = app.view(|s| s.get_cells(main.clone())).unwrap();
        let cell_before = before
            .iter()
            .find(|c| c.row == 0 && c.col == 0)
            .unwrap()
            .clone();
        assert_eq!(cell_before.computed_value, "20");

        app.call(|s| s.rename_sheet(data.clone(), "Renamed".into()))
            .unwrap();

        let after = app.view(|s| s.get_cells(main.clone())).unwrap();
        let cell_after = after.iter().find(|c| c.row == 0 && c.col == 0).unwrap();
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
        app.call(|s| s.set_cell(sid.clone(), 0, 0, "1".into()))
            .unwrap(); // A1 = 1
                       // B1 = SUM(A1, B1) — references itself; must not diverge into a number.
        app.call(|s| s.set_cell_formula(sid.clone(), 0, 1, "=SUM(A1,B1)".into()))
            .unwrap();
        let cells = app.view(|s| s.get_cells(sid.clone())).unwrap();
        let b1 = cells.iter().find(|c| c.row == 0 && c.col == 1).unwrap();
        assert_eq!(b1.computed_value, "#CYCLE!");
    }

    #[test]
    fn mutual_divergent_cycle_is_cycle_error() {
        let mut app = make_app();
        let sid = app.call(|s| s.create_sheet("Sheet 1".into())).unwrap();
        // A1 = B1 + 1, B1 = A1 + 1 — a mutual cycle that diverges.
        app.call(|s| s.set_cell_formula(sid.clone(), 0, 0, "=B1+1".into()))
            .unwrap();
        app.call(|s| s.set_cell_formula(sid.clone(), 0, 1, "=A1+1".into()))
            .unwrap();
        let cells = app.view(|s| s.get_cells(sid.clone())).unwrap();
        let a1 = cells.iter().find(|c| c.row == 0 && c.col == 0).unwrap();
        let b1 = cells.iter().find(|c| c.row == 0 && c.col == 1).unwrap();
        assert_eq!(a1.computed_value, "#CYCLE!");
        assert_eq!(b1.computed_value, "#CYCLE!");
    }

    #[test]
    fn long_acyclic_chain_still_converges() {
        let mut app = make_app();
        let sid = app.call(|s| s.create_sheet("Sheet 1".into())).unwrap();
        app.call(|s| s.set_cell(sid.clone(), 0, 0, "1".into()))
            .unwrap(); // A1 = 1
        app.call(|s| s.set_cell_formula(sid.clone(), 1, 0, "=A1+1".into()))
            .unwrap(); // A2
        app.call(|s| s.set_cell_formula(sid.clone(), 2, 0, "=A2+1".into()))
            .unwrap(); // A3
        let cells = app.view(|s| s.get_cells(sid.clone())).unwrap();
        let a3 = cells.iter().find(|c| c.row == 2 && c.col == 0).unwrap();
        // A well-formed chain must converge, never be misflagged as a cycle.
        assert_eq!(a3.computed_value, "3");
    }

    #[test]
    fn get_cells_derives_dependent_values_on_read() {
        let mut app = make_app();
        let sid = app.call(|s| s.create_sheet("Sheet 1".into())).unwrap();
        // Store inputs only — set_cell must NOT recompute.
        app.call(|s| s.set_cell(sid.clone(), 0, 0, "2".into()))
            .unwrap();
        app.call(|s| s.set_cell_formula(sid.clone(), 1, 0, "=A1*10".into()))
            .unwrap();
        let cells = app.view(|s| s.get_cells(sid.clone())).unwrap();
        let b = cells.iter().find(|c| c.row == 1 && c.col == 0).unwrap();
        assert_eq!(b.computed_value, "20", "dependent derived on read");
        // Change the precedent; the dependent re-derives with no extra write to B1.
        app.call(|s| s.set_cell(sid.clone(), 0, 0, "3".into()))
            .unwrap();
        let cells = app.view(|s| s.get_cells(sid.clone())).unwrap();
        let b = cells.iter().find(|c| c.row == 1 && c.col == 0).unwrap();
        assert_eq!(b.computed_value, "30");
    }

    #[test]
    fn get_cells_scoped_matches_cross_sheet_and_ignores_unrelated() {
        let mut app = make_app();
        let s1 = app.call(|s| s.create_sheet("Sheet 1".into())).unwrap();
        let s2 = app.call(|s| s.create_sheet("Sheet 2".into())).unwrap();
        let s3 = app.call(|s| s.create_sheet("Sheet 3".into())).unwrap();

        // S2!A1 = 5 ; S1!A1 = S2!A1 + 100 (cross-sheet dependency).
        app.call(|s| s.set_cell(s2.clone(), 0, 0, "5".into()))
            .unwrap();
        app.call(|s| s.set_cell_formula(s1.clone(), 0, 0, format!("=[{s2}]!A1+100")))
            .unwrap();
        // S3 has an unrelated self-cycle — must never affect S1's read.
        app.call(|s| s.set_cell_formula(s3.clone(), 0, 0, "=A1".into()))
            .unwrap();

        // Scoped get_cells(S1) still resolves the cross-sheet ref correctly.
        let s1_cells = app.view(|s| s.get_cells(s1.clone())).unwrap();
        let a1 = s1_cells.iter().find(|c| c.row == 0 && c.col == 0).unwrap();
        assert_eq!(a1.computed_value, "105");

        // get_cells(S3) still flags its own cycle — scoping doesn't hide it.
        let s3_cells = app.view(|s| s.get_cells(s3.clone())).unwrap();
        let c = s3_cells.iter().find(|c| c.row == 0 && c.col == 0).unwrap();
        assert_eq!(c.computed_value, "#CYCLE!");
    }

    #[test]
    fn get_cells_scoped_preserves_ref_to_missing_sheet() {
        let mut app = make_app();
        let s1 = app.call(|s| s.create_sheet("Sheet 1".into())).unwrap();
        // Reference a sheet id that does not exist → #REF! (all sheet ids are
        // passed to the evaluator, so this stays exact under scoping).
        app.call(|s| s.set_cell_formula(s1.clone(), 0, 0, "=[nope]!A1".into()))
            .unwrap();
        let cells = app.view(|s| s.get_cells(s1.clone())).unwrap();
        let a1 = cells.iter().find(|c| c.row == 0 && c.col == 0).unwrap();
        assert_eq!(a1.computed_value, "#REF!");
    }
}
