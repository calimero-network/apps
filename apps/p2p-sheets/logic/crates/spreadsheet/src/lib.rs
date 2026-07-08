//! Spreadsheet service for p2p-sheets.
//!
//! Provides: project initialisation, sheet management (create/rename/delete/list),
//! cell editing with basic formula evaluation, live cursor tracking, built-in
//! function help, and data export.

use calimero_sdk::app;
use calimero_sdk::borsh::{BorshDeserialize, BorshSerialize};
use calimero_sdk::env;
use calimero_sdk::serde::{Deserialize, Serialize};
use calimero_sdk::types::Error as AppError;
use calimero_storage::collections::crdt_meta::MergeError;
use calimero_storage::collections::{AuthoredMap, LwwRegister, Mergeable, UnorderedMap};
use calimero_storage::env as storage_env;
use p2p_sheets_types::{generate_id, validate_label, Error};

pub mod events;
use events::Event;

// ---------------------------------------------------------------------------
// Internal data structs (Borsh-only — stored in collections)
// ---------------------------------------------------------------------------

/// A sheet tab stored in the shared UnorderedMap.
#[derive(Debug, Clone, BorshSerialize, BorshDeserialize)]
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
#[derive(Debug, Clone, BorshSerialize, BorshDeserialize)]
#[borsh(crate = "calimero_sdk::borsh")]
pub struct CellData {
    /// Mirrors the map key for ABI convenience.
    pub id: String,
    pub sheet_id: String,
    pub row: u32,
    pub col: u32,
    /// Raw user input (may be a formula like `=SUM(A1:A5)`).
    pub raw_value: String,
    /// Evaluated result (equals raw_value for non-formula cells).
    pub computed_value: String,
    /// Display format for this cell (e.g. "number", "currency", "percent",
    /// "date"; empty = Automatic). Rendered client-side; does not affect
    /// evaluation. Colon-delimited for future options (e.g. "number:2").
    pub format: String,
    pub updated_at: u64,
}

impl Mergeable for CellData {
    fn merge(&mut self, other: &Self) -> Result<(), MergeError> {
        // LWW: newer update wins; deterministic tie-break by raw_value.
        if other.updated_at > self.updated_at
            || (other.updated_at == self.updated_at && other.raw_value > self.raw_value)
        {
            self.raw_value = other.raw_value.clone();
            self.computed_value = other.computed_value.clone();
            self.format = other.format.clone();
            self.updated_at = other.updated_at;
        }
        Ok(())
    }
}

/// A cursor stored in the per-author AuthoredMap (keyed by author pubkey b58).
#[derive(Debug, Clone, BorshSerialize, BorshDeserialize)]
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
    /// Live cursors keyed by author pubkey b58 (one entry per connected user).
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

    pub fn create_sheet(&mut self, name: String) -> app::Result<String> {
        validate_label(&name).map_err(AppError::from)?;
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
        validate_label(&new_name).map_err(AppError::from)?;
        let now = storage_env::time_now();
        // Capture the old name before mutating so we can rewrite references.
        let old_name = {
            let guard = self
                .sheets
                .get_mut(&sheet_id)
                .map_err(|e| AppError::msg(format!("sheets.get_mut: {e}")))?
                .ok_or_else(|| AppError::from(Error::NotFound(sheet_id.clone())))?;
            let old = guard.name.clone();
            drop(guard);
            old
        };
        {
            let mut guard = self
                .sheets
                .get_mut(&sheet_id)
                .map_err(|e| AppError::msg(format!("sheets.get_mut: {e}")))?
                .unwrap();
            guard.name = new_name.clone();
            guard.updated_at = now;
        }

        // References resolve by sheet name, so a rename would orphan every
        // formula pointing at the old name. Rewrite them to follow the rename
        // (Excel/Sheets behaviour) so cross-sheet formulas keep resolving.
        if old_name != new_name {
            let updates: Vec<(String, String)> = self
                .cells
                .entries()
                .map_err(|e| AppError::msg(format!("cells.entries: {e}")))?
                .filter_map(|(k, d)| {
                    if !d.raw_value.trim_start().starts_with('=') {
                        return None;
                    }
                    let rewritten =
                        formula::rewrite_sheet_qualifiers(&d.raw_value, &old_name, &new_name);
                    (rewritten != d.raw_value).then_some((k, rewritten))
                })
                .collect();
            for (k, new_raw) in updates {
                if let Some(mut guard) = self
                    .cells
                    .get_mut(&k)
                    .map_err(|e| AppError::msg(format!("cells.get_mut: {e}")))?
                {
                    guard.raw_value = new_raw;
                    guard.updated_at = now;
                }
            }
        }

        app::emit!(Event::SheetRenamed {
            id: &sheet_id,
            name: &new_name,
        });
        // Refresh computed values: rewritten refs (and anything depending on
        // them) must re-evaluate against the new name.
        self.recompute_all()?;
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

    pub fn set_cell(
        &mut self,
        sheet_id: String,
        row: u32,
        col: u32,
        raw_value: String,
    ) -> app::Result<String> {
        // Verify the sheet exists.
        if self
            .sheets
            .get(&sheet_id)
            .map_err(|e| AppError::msg(format!("sheets.get: {e}")))?
            .is_none()
        {
            return Err(AppError::from(Error::NotFound(sheet_id.clone())));
        }
        let key = Spreadsheet::cell_key(&sheet_id, row, col);
        let now = storage_env::time_now();
        let data = CellData {
            id: key.clone(),
            sheet_id: sheet_id.clone(),
            row,
            col,
            raw_value: raw_value.clone(),
            computed_value: raw_value,
            format: String::new(),
            updated_at: now,
        };
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
            guard.raw_value = data.raw_value;
            guard.computed_value = data.computed_value;
            guard.updated_at = data.updated_at;
        } else {
            self.cells
                .insert(key.clone(), data)
                .map_err(|e| AppError::msg(format!("cells.insert: {e}")))?;
        }
        app::emit!(Event::CellUpdated {
            id: &key,
            sheet_id: &sheet_id,
        });
        // Recompute every formula (across all sheets) that may depend on this.
        self.recompute_all()?;
        Ok(key)
    }

    pub fn set_cell_formula(
        &mut self,
        sheet_id: String,
        row: u32,
        col: u32,
        formula: String,
    ) -> app::Result<String> {
        // Verify sheet exists.
        if self
            .sheets
            .get(&sheet_id)
            .map_err(|e| AppError::msg(format!("sheets.get: {e}")))?
            .is_none()
        {
            return Err(AppError::from(Error::NotFound(sheet_id.clone())));
        }
        let key = Spreadsheet::cell_key(&sheet_id, row, col);
        let now = storage_env::time_now();
        // Store the raw formula; `recompute_all` computes its value (and every
        // dependent), so a single code path handles same- and cross-sheet refs.
        let data = CellData {
            id: key.clone(),
            sheet_id: sheet_id.clone(),
            row,
            col,
            raw_value: formula.clone(),
            computed_value: formula,
            format: String::new(),
            updated_at: now,
        };
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
            guard.raw_value = data.raw_value;
            guard.computed_value = data.computed_value;
            guard.updated_at = data.updated_at;
        } else {
            self.cells
                .insert(key.clone(), data)
                .map_err(|e| AppError::msg(format!("cells.insert: {e}")))?;
        }
        app::emit!(Event::CellUpdated {
            id: &key,
            sheet_id: &sheet_id,
        });
        self.recompute_all()?;
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
        if self
            .sheets
            .get(&sheet_id)
            .map_err(|e| AppError::msg(format!("sheets.get: {e}")))?
            .is_none()
        {
            return Err(AppError::from(Error::NotFound(sheet_id.clone())));
        }
        let key = Spreadsheet::cell_key(&sheet_id, row, col);
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
            let data = CellData {
                id: key.clone(),
                sheet_id: sheet_id.clone(),
                row,
                col,
                raw_value: String::new(),
                computed_value: String::new(),
                format,
                updated_at: now,
            };
            self.cells
                .insert(key.clone(), data)
                .map_err(|e| AppError::msg(format!("cells.insert: {e}")))?;
        }
        app::emit!(Event::CellUpdated {
            id: &key,
            sheet_id: &sheet_id,
        });
        Ok(key)
    }

    pub fn clear_cell(&mut self, sheet_id: String, row: u32, col: u32) -> app::Result<()> {
        let key = Spreadsheet::cell_key(&sheet_id, row, col);
        self.cells
            .remove(&key)
            .map_err(|e| AppError::msg(format!("cells.remove: {e}")))?;
        app::emit!(Event::CellCleared {
            sheet_id: &sheet_id,
            row,
            col,
        });
        // Removing a cell can change formulas that referenced it.
        self.recompute_all()?;
        Ok(())
    }

    /// Re-evaluate every formula cell in the whole workbook until values
    /// stabilise, so a change to one cell propagates to all cells that
    /// (transitively) reference it — on the same sheet OR across sheets
    /// (`Data!A1`). Runs a bounded fixed-point iteration (safe against chains
    /// and terminating on circular references). Persists and emits only the
    /// cells whose computed value actually changed.
    fn recompute_all(&mut self) -> app::Result<()> {
        // Sheet name → id, so cross-sheet references resolve by name.
        let sheets: Vec<(String, String)> = self
            .sheets
            .entries()
            .map_err(|e| AppError::msg(format!("sheets.entries: {e}")))?
            .map(|(id, d)| (d.name.clone(), id))
            .collect();

        // Snapshot every cell: (key, sheet_id, row, col, raw, computed, original).
        let mut snap: Vec<(String, String, u32, u32, String, String, String)> = self
            .cells
            .entries()
            .map_err(|e| AppError::msg(format!("cells.entries: {e}")))?
            .map(|(k, d)| {
                (
                    k,
                    d.sheet_id.clone(),
                    d.row,
                    d.col,
                    d.raw_value.clone(),
                    d.computed_value.clone(),
                    d.computed_value.clone(),
                )
            })
            .collect();

        // Fixed-point: at most one pass per cell covers the longest acyclic
        // chain; the extra guard bounds cyclic references.
        let max_iter = snap.len() + 1;
        for _ in 0..max_iter {
            // Freeze current computed values for this pass's lookups.
            let lookup: Vec<(String, u32, u32, String)> = snap
                .iter()
                .map(|(_, sid, r, c, _, comp, _)| (sid.clone(), *r, *c, comp.clone()))
                .collect();
            let mut changed = false;
            for entry in snap.iter_mut() {
                if entry.4.trim_start().starts_with('=') {
                    let cur_sheet = entry.1.clone();
                    let raw = entry.4.clone();
                    // Set if the formula names a sheet that doesn't exist (e.g. a
                    // typo `Sheet1` for `Sheet 1`). Such a reference must surface
                    // as #REF!, not silently resolve every cell to empty (0).
                    let bad_sheet = core::cell::Cell::new(false);
                    let new_val = formula::evaluate(&raw, |sheet, r, c| {
                        // Resolve the sheet: named → its id, else the cell's own sheet.
                        let sid = match sheet {
                            Some(name) => match sheets.iter().find(|(n, _)| n == name) {
                                Some((_, id)) => id.as_str(),
                                None => {
                                    bad_sheet.set(true);
                                    return None;
                                }
                            },
                            None => cur_sheet.as_str(),
                        };
                        lookup
                            .iter()
                            .find(|(s, rr, cc, _)| s == sid && *rr == r && *cc == c)
                            .map(|(_, _, _, v)| v.clone())
                    });
                    let new_val = if bad_sheet.get() { "#REF!".to_string() } else { new_val };
                    if new_val != entry.5 {
                        entry.5 = new_val;
                        changed = true;
                    }
                }
            }
            if !changed {
                break;
            }
        }

        // Persist + emit the cells whose computed value changed.
        for (key, sid, _r, _c, _raw, computed, original) in snap {
            if computed != original {
                if let Some(mut guard) = self
                    .cells
                    .get_mut(&key)
                    .map_err(|e| AppError::msg(format!("cells.get_mut: {e}")))?
                {
                    guard.computed_value = computed;
                }
                app::emit!(Event::CellUpdated {
                    id: &key,
                    sheet_id: &sid,
                });
            }
        }
        Ok(())
    }

    pub fn get_cells(&self, sheet_id: String) -> app::Result<Vec<Cell>> {
        let prefix = format!("{sheet_id}|");
        let mut out: Vec<Cell> = self
            .cells
            .entries()
            .map_err(|e| AppError::msg(format!("cells.entries: {e}")))?
            .filter_map(|(k, d)| {
                if k.starts_with(&prefix) {
                    Some(Cell {
                        id: d.id.clone(),
                        sheet_id: d.sheet_id.clone(),
                        row: d.row,
                        col: d.col,
                        raw_value: d.raw_value.clone(),
                        computed_value: d.computed_value.clone(),
                        format: d.format.clone(),
                        updated_at: d.updated_at,
                    })
                } else {
                    None
                }
            })
            .collect();
        out.sort_by_key(|c| (c.row, c.col));
        Ok(out)
    }

    // ---- Cursors ----

    pub fn update_cursor(&mut self, sheet_id: String, row: u32, col: u32) -> app::Result<()> {
        let author = self.caller_b58();
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
        let author = self.caller_b58();
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
    fn caller_b58(&self) -> String {
        bs58::encode(env::executor_id()).into_string()
    }

    fn cell_key(sheet_id: &str, row: u32, col: u32) -> String {
        format!("{sheet_id}|{row}|{col}")
    }

    /// Deterministic colour derived from the author pubkey so it is stable
    /// across sessions without any server-side assignment.
    fn assign_color(pubkey_b58: &str) -> String {
        const PALETTE: &[&str] = &[
            "#E74C3C", "#3498DB", "#2ECC71", "#F39C12", "#9B59B6",
            "#1ABC9C", "#E67E22", "#34495E", "#E91E63", "#00BCD4",
            "#FF5722", "#8BC34A", "#607D8B", "#FF9800", "#673AB7",
        ];
        let idx = pubkey_b58
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
            description: "Returns one of two values depending on whether a condition is non-zero.".into(),
            example: "=IF(A1, B1, C1)".into(),
        },
    ]
}

// ---------------------------------------------------------------------------
// Formula evaluator
// ---------------------------------------------------------------------------

mod formula {
    /// Evaluate a spreadsheet formula string.
    ///
    /// `formula` should start with `=`. `get_value(sheet, row, col)` maps a cell
    /// to its current computed value: `sheet` is `None` for a reference on the
    /// current sheet, or `Some(name)` for a cross-sheet reference (`Data!A1` or
    /// `'My Sheet'!A1`). Rows/cols are 0-indexed as used by the API; references
    /// use 1-indexed rows and A-Z columns (e.g. `A1` → row 0, col 0).
    pub fn evaluate(formula: &str, get_value: impl Fn(Option<&str>, u32, u32) -> Option<String>) -> String {
        let expr = formula.trim().strip_prefix('=').unwrap_or(formula).trim();
        // `$` marks an absolute reference (a fill/copy anchor). It has no effect
        // on evaluation, so strip it and `=$A$1` evaluates exactly like `=A1`.
        let expr = expr.replace('$', "");
        eval_to_string(&expr, &get_value)
    }

    /// Evaluate an expression to its display string.
    fn eval_to_string(expr: &str, get_value: &impl Fn(Option<&str>, u32, u32) -> Option<String>) -> String {
        let expr = expr.trim();
        if expr.is_empty() {
            return String::new();
        }

        // String literal in double quotes.
        if expr.len() >= 2 && expr.starts_with('"') && expr.ends_with('"') {
            return expr[1..expr.len() - 1].to_string();
        }

        // A single top-level function call — evaluated here so it can return
        // string results (IF) and specific error strings (#DIV/0!, #NAME?).
        if let Some(result) = try_function(expr, get_value) {
            return result;
        }

        // Numeric expression: arithmetic (`+ - * /`, parens, unary), cell
        // references, numeric literals, and functions used as operands.
        if let Some(n) = eval_number(expr, get_value) {
            return format_num(n);
        }

        // Bare cell reference holding non-numeric text (possibly cross-sheet).
        let (sheet, rest) = split_sheet_qualifier(expr);
        if let Some((row, col)) = parse_cell_ref(&rest) {
            return get_value(sheet.as_deref(), row, col).unwrap_or_default();
        }

        "#VALUE!".to_string()
    }

    /// Split an optional `Sheet!` / `'Sheet Name'!` prefix off a reference.
    /// Returns `(sheet_name, rest)` — `sheet_name` is `None` for a same-sheet
    /// reference. Quoted names may contain spaces.
    fn split_sheet_qualifier(s: &str) -> (Option<String>, String) {
        let s = s.trim();
        if s.starts_with('\'') {
            // Quoted sheet name. An internal apostrophe is doubled (`''`), the
            // Excel/Sheets convention emitted by the frontend `sheetPrefix`, so a
            // lone `'` is the terminator and `''` collapses to one literal `'`.
            let chars: Vec<char> = s.chars().collect();
            let mut i = 1; // past the opening quote
            let mut name = String::new();
            loop {
                match chars.get(i) {
                    Some('\'') if chars.get(i + 1) == Some(&'\'') => {
                        name.push('\'');
                        i += 2;
                    }
                    Some('\'') => {
                        i += 1; // closing quote
                        break;
                    }
                    Some(&ch) => {
                        name.push(ch);
                        i += 1;
                    }
                    None => return (None, s.to_string()), // unterminated
                }
            }
            let rest: String = chars[i..].iter().collect();
            if let Some(cell) = rest.trim_start().strip_prefix('!') {
                return (Some(name), cell.trim().to_string());
            }
            return (None, s.to_string());
        }
        if let Some(pos) = s.find('!') {
            let name = s[..pos].trim();
            if !name.is_empty() {
                return (Some(name.to_string()), s[pos + 1..].trim().to_string());
            }
        }
        (None, s.to_string())
    }

    /// Sheet-name prefix for a reference: bare when the name is a simple
    /// identifier (`Data!`), single-quoted with internal `'` doubled otherwise
    /// (`'Q3 Budget'!`). Mirrors the frontend `sheetPrefix` so refs are written
    /// identically whichever side produces them.
    pub fn sheet_prefix(name: &str) -> String {
        let simple = name
            .chars()
            .next()
            .is_some_and(|c| c.is_ascii_alphabetic())
            && name.chars().all(|c| c.is_ascii_alphanumeric());
        if simple {
            format!("{name}!")
        } else {
            format!("'{}'!", name.replace('\'', "''"))
        }
    }

    /// Rewrite every sheet qualifier that names `old` so it references `new`
    /// instead, leaving the rest of the formula untouched. Handles bare (`Old!`)
    /// and quoted (`'Old Name'!`, `''`-escaped) qualifiers, and re-quotes `new`
    /// as needed. A longer name sharing a prefix (`Sheet10` vs `Sheet1`) is left
    /// alone because bare matches are whole-token. Used when a sheet is renamed
    /// so references follow it (Excel/Sheets behaviour).
    pub fn rewrite_sheet_qualifiers(formula: &str, old: &str, new: &str) -> String {
        let chars: Vec<char> = formula.chars().collect();
        let mut out = String::with_capacity(formula.len());
        let mut i = 0;
        while i < chars.len() {
            let ch = chars[i];
            if ch == '\'' {
                // Quoted name: read to the closing lone quote, collapsing `''`.
                let mut j = i + 1;
                let mut name = String::new();
                let mut terminated = false;
                while j < chars.len() {
                    if chars[j] == '\'' {
                        if chars.get(j + 1) == Some(&'\'') {
                            name.push('\'');
                            j += 2;
                        } else {
                            j += 1; // closing quote
                            terminated = true;
                            break;
                        }
                    } else {
                        name.push(chars[j]);
                        j += 1;
                    }
                }
                if terminated && chars.get(j) == Some(&'!') && name == old {
                    out.push_str(&sheet_prefix(new));
                    i = j + 1; // past the '!'
                    continue;
                }
                // Not a matching qualifier — emit the original span verbatim.
                out.extend(&chars[i..j]);
                i = j;
                continue;
            }
            if ch.is_ascii_alphabetic() {
                // Bare identifier run; a trailing '!' makes it a sheet qualifier.
                let start = i;
                let mut j = i;
                while j < chars.len() && chars[j].is_ascii_alphanumeric() {
                    j += 1;
                }
                let word: String = chars[start..j].iter().collect();
                if chars.get(j) == Some(&'!') && word == old {
                    out.push_str(&sheet_prefix(new));
                    i = j + 1;
                    continue;
                }
                out.push_str(&word);
                i = j;
                continue;
            }
            out.push(ch);
            i += 1;
        }
        out
    }

    /// If `expr` is exactly a single `NAME(args)` call, evaluate it; else
    /// `None` (so `SUM(..)+1` and bare arithmetic fall to the number parser).
    fn try_function(expr: &str, get_value: &impl Fn(Option<&str>, u32, u32) -> Option<String>) -> Option<String> {
        let paren = expr.find('(')?;
        let name = &expr[..paren];
        if name.is_empty() || !name.chars().all(|c| c.is_ascii_alphabetic()) {
            return None;
        }
        // The call must span the whole expression: strip the trailing ')' and
        // require the inner parens to balance. `SUM(A1:A2)+1` fails this (the
        // string doesn't end in ')'), so it's owned by the arithmetic parser.
        let inner = expr[paren + 1..].strip_suffix(')')?;
        if !parens_balanced(inner) {
            return None;
        }

        match name.to_uppercase().as_str() {
            "SUM" => Some(format_num(collect_arg_values(inner, get_value).iter().sum())),
            "AVERAGE" => {
                let vals = collect_arg_values(inner, get_value);
                if vals.is_empty() {
                    return Some("#DIV/0!".into());
                }
                Some(format_num(vals.iter().sum::<f64>() / vals.len() as f64))
            }
            "MIN" => {
                let min = collect_arg_values(inner, get_value)
                    .into_iter()
                    .fold(f64::INFINITY, f64::min);
                Some(if min.is_infinite() { "0".into() } else { format_num(min) })
            }
            "MAX" => {
                let max = collect_arg_values(inner, get_value)
                    .into_iter()
                    .fold(f64::NEG_INFINITY, f64::max);
                Some(if max.is_infinite() { "0".into() } else { format_num(max) })
            }
            "COUNT" => Some(collect_arg_values(inner, get_value).len().to_string()),
            "IF" => {
                // Split on top-level commas only.
                let args = split_args(inner);
                if args.len() != 3 {
                    return Some("#ARG!".into());
                }
                let cond = eval_to_string(args[0].trim(), get_value);
                let non_zero = cond.parse::<f64>().map(|n| n != 0.0).unwrap_or(!cond.is_empty());
                Some(eval_to_string(args[if non_zero { 1 } else { 2 }].trim(), get_value))
            }
            _ => Some("#NAME?".into()),
        }
    }

    /// Values contributed by a function's argument list. A range arg (`A1:B3`)
    /// expands to its numeric cells; every other comma-separated arg is
    /// evaluated as an expression (cell ref, number, or arithmetic) and
    /// contributes its numeric value — so `SUM(3+4)` and `SUM(A1, A2, 5)` work.
    fn collect_arg_values(args: &str, get_value: &impl Fn(Option<&str>, u32, u32) -> Option<String>) -> Vec<f64> {
        let mut nums = Vec::new();
        for arg in split_args(args) {
            let arg = arg.trim();
            if arg.is_empty() {
                continue;
            }
            if arg.contains(':') {
                // A range, possibly sheet-qualified (`Data!A1:A3`, `'S'!A:A`).
                let (sheet, rest) = split_sheet_qualifier(arg);
                for (r, c) in expand_range(&rest) {
                    if let Some(raw) = get_value(sheet.as_deref(), r, c) {
                        if let Ok(n) = raw.trim().parse::<f64>() {
                            nums.push(n);
                        }
                    }
                }
            } else if let Some(n) = eval_number(arg, get_value) {
                // Single cells (incl. cross-sheet), numbers and arithmetic go
                // through the number parser, which handles `Data!A1` itself.
                nums.push(n);
            }
        }
        nums
    }

    // ── Arithmetic expression parser (recursive descent) ──────────────────
    // add    := mul (('+' | '-') mul)*
    // mul    := factor (('*' | '/') factor)*
    // factor := number | cellref | NAME(args) | '(' add ')' | ('+' | '-') factor
    // Returns None on any parse error or non-numeric operand, so the caller can
    // fall back to string handling.

    fn eval_number(expr: &str, gv: &impl Fn(Option<&str>, u32, u32) -> Option<String>) -> Option<f64> {
        let chars: Vec<char> = expr.chars().collect();
        let mut p = 0usize;
        let v = parse_add(&chars, &mut p, gv)?;
        skip_ws(&chars, &mut p);
        if p == chars.len() { Some(v) } else { None } // reject trailing junk
    }

    fn skip_ws(c: &[char], p: &mut usize) {
        while *p < c.len() && c[*p].is_whitespace() {
            *p += 1;
        }
    }

    fn parse_add(c: &[char], p: &mut usize, gv: &impl Fn(Option<&str>, u32, u32) -> Option<String>) -> Option<f64> {
        let mut v = parse_mul(c, p, gv)?;
        loop {
            skip_ws(c, p);
            match c.get(*p) {
                Some('+') => { *p += 1; v += parse_mul(c, p, gv)?; }
                Some('-') => { *p += 1; v -= parse_mul(c, p, gv)?; }
                _ => break,
            }
        }
        Some(v)
    }

    fn parse_mul(c: &[char], p: &mut usize, gv: &impl Fn(Option<&str>, u32, u32) -> Option<String>) -> Option<f64> {
        let mut v = parse_factor(c, p, gv)?;
        loop {
            skip_ws(c, p);
            match c.get(*p) {
                Some('*') => { *p += 1; v *= parse_factor(c, p, gv)?; }
                Some('/') => {
                    *p += 1;
                    let d = parse_factor(c, p, gv)?;
                    if d == 0.0 {
                        return None; // #DIV/0! surfaces as a non-numeric result
                    }
                    v /= d;
                }
                _ => break,
            }
        }
        Some(v)
    }

    fn parse_factor(c: &[char], p: &mut usize, gv: &impl Fn(Option<&str>, u32, u32) -> Option<String>) -> Option<f64> {
        skip_ws(c, p);
        match c.get(*p)? {
            '(' => {
                *p += 1;
                let v = parse_add(c, p, gv)?;
                skip_ws(c, p);
                if c.get(*p) != Some(&')') {
                    return None;
                }
                *p += 1;
                Some(v)
            }
            '-' => { *p += 1; Some(-parse_factor(c, p, gv)?) }
            '+' => { *p += 1; parse_factor(c, p, gv) }
            '\'' => parse_quoted_ref(c, p, gv),
            ch if ch.is_ascii_alphabetic() => parse_ident(c, p, gv),
            ch if ch.is_ascii_digit() || *ch == '.' => {
                let start = *p;
                while *p < c.len() && (c[*p].is_ascii_digit() || c[*p] == '.') {
                    *p += 1;
                }
                c[start..*p].iter().collect::<String>().parse::<f64>().ok()
            }
            _ => None,
        }
    }

    /// A leading alphabetic run is a function call `NAME(...)`, a plain cell
    /// reference `A1`, or an unquoted cross-sheet reference `Data!A1`.
    fn parse_ident(c: &[char], p: &mut usize, gv: &impl Fn(Option<&str>, u32, u32) -> Option<String>) -> Option<f64> {
        let start = *p;
        while *p < c.len() && c[*p].is_ascii_alphabetic() {
            *p += 1;
        }
        if c.get(*p) == Some(&'(') {
            // Function call — capture through the matching ')' and reuse the
            // string evaluator (handles SUM/AVERAGE/… nested in arithmetic).
            *p += 1;
            let mut depth = 1usize;
            while *p < c.len() && depth > 0 {
                match c[*p] {
                    '(' => depth += 1,
                    ')' => depth -= 1,
                    _ => {}
                }
                *p += 1;
            }
            if depth != 0 {
                return None;
            }
            let call: String = c[start..*p].iter().collect();
            return eval_to_string(&call, gv).trim().parse::<f64>().ok();
        }

        // Consume any trailing digits — part of a cell ref (`A1`) or an unquoted
        // sheet name (`Sheet2`).
        let digits_start = *p;
        while *p < c.len() && c[*p].is_ascii_digit() {
            *p += 1;
        }

        // Cross-sheet reference: `<name>!<cellref>`.
        if c.get(*p) == Some(&'!') {
            let name: String = c[start..*p].iter().collect();
            *p += 1; // consume '!'
            let cs = *p;
            while *p < c.len() && c[*p].is_ascii_uppercase() { *p += 1; }
            while *p < c.len() && c[*p].is_ascii_digit() { *p += 1; }
            let refstr: String = c[cs..*p].iter().collect();
            let (row, col) = parse_cell_ref(&refstr)?;
            return cell_num(gv, Some(&name), row, col);
        }

        // Plain same-sheet cell reference.
        if *p == digits_start {
            return None; // letters with no row digits — not a cell ref
        }
        let refstr: String = c[start..*p].iter().collect();
        let (row, col) = parse_cell_ref(&refstr)?;
        cell_num(gv, None, row, col)
    }

    /// Parse a quoted cross-sheet reference `'Sheet Name'!A1` as a number.
    fn parse_quoted_ref(c: &[char], p: &mut usize, gv: &impl Fn(Option<&str>, u32, u32) -> Option<String>) -> Option<f64> {
        *p += 1; // opening quote
        // Read the name, collapsing a doubled `''` into one literal apostrophe
        // and stopping at the first lone `'` (Excel/Sheets quoting).
        let mut name = String::new();
        loop {
            match c.get(*p) {
                Some('\'') if c.get(*p + 1) == Some(&'\'') => {
                    name.push('\'');
                    *p += 2;
                }
                Some('\'') => {
                    *p += 1; // closing quote
                    break;
                }
                Some(&ch) => {
                    name.push(ch);
                    *p += 1;
                }
                None => return None, // unterminated
            }
        }
        if c.get(*p) != Some(&'!') { return None; }
        *p += 1; // '!'
        let cs = *p;
        while *p < c.len() && c[*p].is_ascii_uppercase() { *p += 1; }
        while *p < c.len() && c[*p].is_ascii_digit() { *p += 1; }
        let refstr: String = c[cs..*p].iter().collect();
        let (row, col) = parse_cell_ref(&refstr)?;
        cell_num(gv, Some(&name), row, col)
    }

    /// Resolve a cell reference to a number for arithmetic: empty / missing → 0,
    /// non-numeric text → `None` (makes the surrounding expression non-numeric).
    fn cell_num(
        gv: &impl Fn(Option<&str>, u32, u32) -> Option<String>,
        sheet: Option<&str>,
        row: u32,
        col: u32,
    ) -> Option<f64> {
        match gv(sheet, row, col) {
            Some(val) => {
                let t = val.trim();
                if t.is_empty() { Some(0.0) } else { t.parse::<f64>().ok() }
            }
            None => Some(0.0),
        }
    }

    fn parens_balanced(s: &str) -> bool {
        let mut depth = 0i32;
        for ch in s.chars() {
            match ch {
                '(' => depth += 1,
                ')' => {
                    depth -= 1;
                    if depth < 0 {
                        return false;
                    }
                }
                _ => {}
            }
        }
        depth == 0
    }

    /// Expand a range string (`A1:B3` or `A1`) into `(row, col)` pairs.
    // Bounds for whole-column (`A:A`) and whole-row (`1:1`) references. The UI
    // grid is 26 columns (A–Z) × 50 rows; we scan a little past the visible rows
    // so column sums still pick up anything entered lower down. Empty cells
    // contribute nothing, so an over-estimate is harmless (only affects how far
    // we iterate, never the result).
    const MAX_ROWS: u32 = 1000;
    const MAX_COLS: u32 = 26;

    /// A bare column label (`A`..`Z`) → 0-based column index. `None` if the
    /// string isn't a single uppercase letter (so `A1` is not a column).
    fn parse_col_only(s: &str) -> Option<u32> {
        let mut chars = s.chars();
        let c = chars.next()?;
        if chars.next().is_some() || !c.is_ascii_uppercase() {
            return None;
        }
        Some(c as u32 - 'A' as u32)
    }

    /// A bare 1-based row number (`1`, `42`) → 0-based row index. `None` if the
    /// string isn't all digits.
    fn parse_row_only(s: &str) -> Option<u32> {
        if s.is_empty() || !s.chars().all(|c| c.is_ascii_digit()) {
            return None;
        }
        s.parse::<u32>().ok()?.checked_sub(1)
    }

    fn expand_range(range: &str) -> Vec<(u32, u32)> {
        let parts: Vec<&str> = range.split(':').collect();
        match parts.as_slice() {
            [single] => parse_cell_ref(single.trim())
                .map(|rc| vec![rc])
                .unwrap_or_default(),
            [start, end] => {
                let (s, e) = (start.trim(), end.trim());
                // Whole-column range: `A:A`, `A:C` → every row of those columns.
                if let (Some(c1), Some(c2)) = (parse_col_only(s), parse_col_only(e)) {
                    let mut cells = Vec::new();
                    for c in c1.min(c2)..=c1.max(c2) {
                        for r in 0..MAX_ROWS {
                            cells.push((r, c));
                        }
                    }
                    return cells;
                }
                // Whole-row range: `1:1`, `2:5` → every column of those rows.
                if let (Some(r1), Some(r2)) = (parse_row_only(s), parse_row_only(e)) {
                    let mut cells = Vec::new();
                    for r in r1.min(r2)..=r1.max(r2) {
                        for c in 0..MAX_COLS {
                            cells.push((r, c));
                        }
                    }
                    return cells;
                }
                // Ordinary cell range: `A1:C3`.
                match (parse_cell_ref(s), parse_cell_ref(e)) {
                    (Some((r1, c1)), Some((r2, c2))) => {
                        let mut cells = Vec::new();
                        for r in r1.min(r2)..=r1.max(r2) {
                            for c in c1.min(c2)..=c1.max(c2) {
                                cells.push((r, c));
                            }
                        }
                        cells
                    }
                    _ => vec![],
                }
            }
            _ => vec![],
        }
    }

    /// Parse a cell reference like `A1` → (row=0, col=0).
    /// Columns are A=0, B=1, …; rows are 1-indexed in the formula.
    fn parse_cell_ref(r: &str) -> Option<(u32, u32)> {
        let r = r.trim();
        let mut chars = r.chars();
        let col_char = chars.next()?;
        if !col_char.is_ascii_uppercase() {
            return None;
        }
        let col = col_char as u32 - 'A' as u32;
        let row_str: String = chars.collect();
        let row_1: u32 = row_str.parse().ok()?;
        let row = row_1.checked_sub(1)?;
        Some((row, col))
    }

    /// Split a comma-separated argument string respecting nested parentheses.
    fn split_args(s: &str) -> Vec<&str> {
        let mut args = Vec::new();
        let mut depth = 0usize;
        let mut start = 0;
        for (i, c) in s.char_indices() {
            match c {
                '(' => depth += 1,
                ')' => depth = depth.saturating_sub(1),
                ',' if depth == 0 => {
                    args.push(&s[start..i]);
                    start = i + 1;
                }
                _ => {}
            }
        }
        args.push(&s[start..]);
        args
    }

    fn format_num(n: f64) -> String {
        if n.fract() == 0.0 && n.abs() < 1e15 {
            format!("{}", n as i64)
        } else {
            format!("{n}")
        }
    }
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
        let id = app
            .call(|s| s.init_project("Q3 Budget".into()))
            .unwrap();
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
        app.call(|s| s.set_cell(sid.clone(), 0, 0, "1234.5".into())).unwrap();
        app.call(|s| s.set_cell_format(sid.clone(), 0, 0, "currency".into())).unwrap();
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
        app.call(|s| s.set_cell_format(sid.clone(), 0, 0, "percent".into())).unwrap();
        app.call(|s| s.set_cell(sid.clone(), 0, 0, "0.25".into())).unwrap();
        let cells = app.view(|s| s.get_cells(sid.clone())).unwrap();
        let a1 = cells.iter().find(|c| c.row == 0 && c.col == 0).unwrap();
        assert_eq!(a1.format, "percent", "format survives a later value edit");
        assert_eq!(a1.computed_value, "0.25");
    }

    #[test]
    fn cell_merge_carries_format_from_winner() {
        let mut a = CellData {
            id: "k".into(), sheet_id: "s".into(), row: 0, col: 0,
            raw_value: "1".into(), computed_value: "1".into(),
            format: String::new(), updated_at: 1,
        };
        let b = CellData {
            id: "k".into(), sheet_id: "s".into(), row: 0, col: 0,
            raw_value: "2".into(), computed_value: "2".into(),
            format: "currency".into(), updated_at: 2,
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
        app.call(|s| s.set_cell(sid.clone(), 0, 0, "10".into())).unwrap(); // A1 = 10
        app.call(|s| s.set_cell(sid.clone(), 1, 0, "20".into())).unwrap(); // A2 = 20
        // $ anchors are evaluation no-ops: these must all compute like the bare refs.
        app.call(|s| s.set_cell_formula(sid.clone(), 0, 1, "=$A$1".into())).unwrap();     // B1
        app.call(|s| s.set_cell_formula(sid.clone(), 1, 1, "=A$1+$A2".into())).unwrap();   // B2
        app.call(|s| s.set_cell_formula(sid.clone(), 2, 1, "=SUM($A$1:$A$2)".into())).unwrap(); // B3
        let cells = app.view(|s| s.get_cells(sid.clone())).unwrap();
        let get = |r: u32, c: u32| cells.iter().find(|x| x.row == r && x.col == c).unwrap().computed_value.clone();
        assert_eq!(get(0, 1), "10", "=$A$1");
        assert_eq!(get(1, 1), "30", "=A$1+$A2");
        assert_eq!(get(2, 1), "30", "=SUM($A$1:$A$2)");
    }

    #[test]
    fn formula_arithmetic_literals() {
        let gv = |_s: Option<&str>, _r: u32, _c: u32| None;
        assert_eq!(formula::evaluate("=3+4", &gv), "7");
        assert_eq!(formula::evaluate("=SUM(3+4)", &gv), "7");
        assert_eq!(formula::evaluate("=10-4", &gv), "6");
        assert_eq!(formula::evaluate("=2*3", &gv), "6");
        assert_eq!(formula::evaluate("=8/2", &gv), "4");
        assert_eq!(formula::evaluate("=(1+2)*3", &gv), "9");
        assert_eq!(formula::evaluate("=2+3*4", &gv), "14"); // precedence
    }

    #[test]
    fn formula_whole_column_and_row_refs() {
        // Column A (col 0): A1=1, A2=2, A3=3.  Row 5 (index 4): B5=10, C5=20.
        let gv = |_s: Option<&str>, r: u32, c: u32| match (r, c) {
            (0, 0) => Some("1".to_string()),
            (1, 0) => Some("2".to_string()),
            (2, 0) => Some("3".to_string()),
            (4, 1) => Some("10".to_string()),
            (4, 2) => Some("20".to_string()),
            _ => None,
        };
        // Whole-column reference A:A
        assert_eq!(formula::evaluate("=SUM(A:A)", &gv), "6");
        assert_eq!(formula::evaluate("=COUNT(A:A)", &gv), "3");
        assert_eq!(formula::evaluate("=AVERAGE(A:A)", &gv), "2");
        assert_eq!(formula::evaluate("=MAX(A:A)", &gv), "3");
        assert_eq!(formula::evaluate("=MIN(A:A)", &gv), "1");
        // Whole-row reference 5:5 (1-based → row index 4)
        assert_eq!(formula::evaluate("=SUM(5:5)", &gv), "30");
        assert_eq!(formula::evaluate("=COUNT(5:5)", &gv), "2");
        // Multi-column range: col A (1+2+3=6) + col B (B5=10) = 16
        assert_eq!(formula::evaluate("=SUM(A:B)", &gv), "16");
    }

    #[test]
    fn formula_arithmetic_with_cells_and_args() {
        // A1 = 10 (row 0, col 0), A2 = 20 (row 1, col 0)
        let gv = |_s: Option<&str>, r: u32, c: u32| match (r, c) {
            (0, 0) => Some("10".to_string()),
            (1, 0) => Some("20".to_string()),
            _ => None,
        };
        assert_eq!(formula::evaluate("=A1+A2", &gv), "30");
        assert_eq!(formula::evaluate("=A1*2", &gv), "20");
        assert_eq!(formula::evaluate("=SUM(A1, A2, 5)", &gv), "35"); // comma args
        assert_eq!(formula::evaluate("=SUM(A1:A2)", &gv), "30"); // range still works
        assert_eq!(formula::evaluate("=SUM(A1:A2)+100", &gv), "130"); // function in arithmetic
    }

    #[test]
    fn dependent_formulas_recompute_when_source_changes() {
        let mut app = make_app();
        app.call(|s| s.init_project("P".into())).unwrap();
        let sid = app.call(|s| s.create_sheet("S".into())).unwrap();
        app.call(|s| s.set_cell(sid.clone(), 0, 0, "1".into())).unwrap(); // A1 = 1
        app.call(|s| s.set_cell(sid.clone(), 1, 0, "2".into())).unwrap(); // A2 = 2
        // A3 = SUM(A1,A2) = 3
        app.call(|s| s.set_cell_formula(sid.clone(), 2, 0, "=SUM(A1,A2)".into()))
            .unwrap();
        // B1 = A3 * 10 = 30 (chained: B1 → A3 → A2)
        app.call(|s| s.set_cell_formula(sid.clone(), 0, 1, "=A3*10".into()))
            .unwrap();

        // Change A2 to 5. A3 must recompute to 6, and B1 (which depends on A3)
        // must recompute to 60.
        app.call(|s| s.set_cell(sid.clone(), 1, 0, "5".into())).unwrap();

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
        app.call(|s| s.set_cell(sid.clone(), 0, 0, "10".into())).unwrap(); // A1
        app.call(|s| s.set_cell(sid.clone(), 1, 0, "20".into())).unwrap(); // A2
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
        app.call(|s| s.set_cell(data.clone(), 0, 0, "10".into())).unwrap();
        app.call(|s| s.set_cell(data.clone(), 1, 0, "20".into())).unwrap();
        // Sheet1!B1 = =Data!A1 + Data!A2 → 30
        app.call(|s| s.set_cell_formula(s1.clone(), 0, 1, "=Data!A1+Data!A2".into()))
            .unwrap();
        // Sheet1!B2 = =SUM(Data!A1:A2) → 30
        app.call(|s| s.set_cell_formula(s1.clone(), 1, 1, "=SUM(Data!A1:A2)".into()))
            .unwrap();
        let cells = app.view(|s| s.get_cells(s1.clone())).unwrap();
        let b1 = cells.iter().find(|c| c.row == 0 && c.col == 1).unwrap();
        let b2 = cells.iter().find(|c| c.row == 1 && c.col == 1).unwrap();
        assert_eq!(b1.computed_value, "30", "=Data!A1+Data!A2");
        assert_eq!(b2.computed_value, "30", "=SUM(Data!A1:A2)");
    }

    #[test]
    fn cross_sheet_quoted_name_with_space() {
        let mut app = make_app();
        app.call(|s| s.init_project("P".into())).unwrap();
        let s1 = app.call(|s| s.create_sheet("Sheet 1".into())).unwrap();
        let s2 = app.call(|s| s.create_sheet("Sheet 2".into())).unwrap();
        app.call(|s| s.set_cell(s1.clone(), 0, 0, "7".into())).unwrap(); // 'Sheet 1'!A1 = 7
        // Sheet 2!A1 = ='Sheet 1'!A1 * 2 → 14
        app.call(|s| s.set_cell_formula(s2.clone(), 0, 0, "='Sheet 1'!A1*2".into()))
            .unwrap();
        let cells = app.view(|s| s.get_cells(s2.clone())).unwrap();
        let a1 = cells.iter().find(|c| c.row == 0 && c.col == 0).unwrap();
        assert_eq!(a1.computed_value, "14");
    }

    #[test]
    fn cross_sheet_quoted_name_with_apostrophe() {
        let mut app = make_app();
        app.call(|s| s.init_project("P".into())).unwrap();
        // A sheet whose name contains an apostrophe. The frontend qualifies refs
        // to it as `'Bob''s data'!A1` (Excel/Sheets: internal `'` is doubled).
        let s1 = app.call(|s| s.create_sheet("Bob's data".into())).unwrap();
        let s2 = app.call(|s| s.create_sheet("Sheet 2".into())).unwrap();
        app.call(|s| s.set_cell(s1.clone(), 0, 0, "9".into())).unwrap(); // 'Bob''s data'!A1 = 9
        // Single ref and a range, both quoting the apostrophe name.
        app.call(|s| s.set_cell(s1.clone(), 1, 0, "1".into())).unwrap(); // A2 = 1
        app.call(|s| s.set_cell_formula(s2.clone(), 0, 0, "='Bob''s data'!A1*2".into()))
            .unwrap();
        app.call(|s| s.set_cell_formula(s2.clone(), 1, 0, "=SUM('Bob''s data'!A1:A2)".into()))
            .unwrap();
        let cells = app.view(|s| s.get_cells(s2.clone())).unwrap();
        let a1 = cells.iter().find(|c| c.row == 0 && c.col == 0).unwrap();
        let a2 = cells.iter().find(|c| c.row == 1 && c.col == 0).unwrap();
        assert_eq!(a1.computed_value, "18", "='Bob''s data'!A1*2");
        assert_eq!(a2.computed_value, "10", "=SUM('Bob''s data'!A1:A2)");
    }

    #[test]
    fn reference_to_unknown_sheet_is_ref_error() {
        let mut app = make_app();
        app.call(|s| s.init_project("P".into())).unwrap();
        // The default sheet name has a space: "Sheet 1".
        let s1 = app.call(|s| s.create_sheet("Sheet 1".into())).unwrap();
        let s2 = app.call(|s| s.create_sheet("Sheet 2".into())).unwrap();
        app.call(|s| s.set_cell(s1.clone(), 1, 3, "5".into())).unwrap(); // 'Sheet 1'!D2 = 5
        // Typo: `Sheet1` (no space) names no existing sheet. This must surface as
        // #REF!, not a silent 0 that looks like the cells are empty.
        app.call(|s| s.set_cell_formula(s2.clone(), 0, 0, "=SUM(Sheet1!D2:D6)".into()))
            .unwrap();
        // The correctly-quoted name resolves normally.
        app.call(|s| s.set_cell_formula(s2.clone(), 1, 0, "=SUM('Sheet 1'!D2:D6)".into()))
            .unwrap();
        let cells = app.view(|s| s.get_cells(s2.clone())).unwrap();
        let a1 = cells.iter().find(|c| c.row == 0 && c.col == 0).unwrap();
        let a2 = cells.iter().find(|c| c.row == 1 && c.col == 0).unwrap();
        assert_eq!(a1.computed_value, "#REF!", "unknown sheet name → #REF!");
        assert_eq!(a2.computed_value, "5", "'Sheet 1'!D2:D6 resolves");
    }

    #[test]
    fn renaming_a_sheet_rewrites_references_to_it() {
        let mut app = make_app();
        app.call(|s| s.init_project("P".into())).unwrap();
        let s1 = app.call(|s| s.create_sheet("Sheet 1".into())).unwrap();
        let s2 = app.call(|s| s.create_sheet("Sheet 2".into())).unwrap();
        app.call(|s| s.set_cell(s1.clone(), 0, 0, "10".into())).unwrap(); // 'Sheet 1'!A1 = 10
        app.call(|s| s.set_cell(s1.clone(), 1, 0, "20".into())).unwrap(); // 'Sheet 1'!A2 = 20
        app.call(|s| s.set_cell_formula(s2.clone(), 0, 0, "='Sheet 1'!A1+5".into()))
            .unwrap(); // 15
        app.call(|s| s.set_cell_formula(s2.clone(), 1, 0, "=SUM('Sheet 1'!A1:A2)".into()))
            .unwrap(); // 30
        // Rename the referenced sheet to a simple identifier → references follow
        // it, re-quoting appropriately (bare, since "Budget" needs no quotes).
        app.call(|s| s.rename_sheet(s1.clone(), "Budget".into())).unwrap();
        let cells = app.view(|s| s.get_cells(s2.clone())).unwrap();
        let a1 = cells.iter().find(|c| c.row == 0 && c.col == 0).unwrap();
        let a2 = cells.iter().find(|c| c.row == 1 && c.col == 0).unwrap();
        assert_eq!(a1.raw_value, "=Budget!A1+5", "single ref follows the rename");
        assert_eq!(a2.raw_value, "=SUM(Budget!A1:A2)", "range ref follows the rename");
        assert_eq!(a1.computed_value, "15", "still resolves after rename");
        assert_eq!(a2.computed_value, "30", "range still resolves after rename");
    }

    #[test]
    fn renaming_to_a_name_with_spaces_requotes_references() {
        let mut app = make_app();
        app.call(|s| s.init_project("P".into())).unwrap();
        let s1 = app.call(|s| s.create_sheet("Data".into())).unwrap();
        let s2 = app.call(|s| s.create_sheet("Main".into())).unwrap();
        app.call(|s| s.set_cell(s1.clone(), 0, 0, "7".into())).unwrap();
        app.call(|s| s.set_cell_formula(s2.clone(), 0, 0, "=Data!A1*2".into()))
            .unwrap(); // bare ref, 14
        // Rename to a name with a space → the reference must become quoted.
        app.call(|s| s.rename_sheet(s1.clone(), "Q3 Budget".into())).unwrap();
        let cells = app.view(|s| s.get_cells(s2.clone())).unwrap();
        let a1 = cells.iter().find(|c| c.row == 0 && c.col == 0).unwrap();
        assert_eq!(a1.raw_value, "='Q3 Budget'!A1*2", "bare ref becomes quoted");
        assert_eq!(a1.computed_value, "14", "still resolves");
    }

    #[test]
    fn renaming_does_not_touch_similarly_prefixed_sheet_names() {
        let mut app = make_app();
        app.call(|s| s.init_project("P".into())).unwrap();
        let s1 = app.call(|s| s.create_sheet("Sheet1".into())).unwrap();
        let s10 = app.call(|s| s.create_sheet("Sheet10".into())).unwrap();
        let s2 = app.call(|s| s.create_sheet("Main".into())).unwrap();
        app.call(|s| s.set_cell(s10.clone(), 0, 0, "3".into())).unwrap();
        app.call(|s| s.set_cell_formula(s2.clone(), 0, 0, "=Sheet10!A1".into()))
            .unwrap(); // references Sheet10, not Sheet1
        // Renaming "Sheet1" must not corrupt a reference to "Sheet10".
        app.call(|s| s.rename_sheet(s1.clone(), "X".into())).unwrap();
        let cells = app.view(|s| s.get_cells(s2.clone())).unwrap();
        let a1 = cells.iter().find(|c| c.row == 0 && c.col == 0).unwrap();
        assert_eq!(a1.raw_value, "=Sheet10!A1", "Sheet10 reference untouched");
        assert_eq!(a1.computed_value, "3");
    }

    #[test]
    fn cross_sheet_recompute_propagates() {
        let mut app = make_app();
        app.call(|s| s.init_project("P".into())).unwrap();
        let a = app.call(|s| s.create_sheet("A".into())).unwrap();
        let b = app.call(|s| s.create_sheet("B".into())).unwrap();
        app.call(|s| s.set_cell(a.clone(), 0, 0, "5".into())).unwrap(); // A!A1 = 5
        app.call(|s| s.set_cell_formula(b.clone(), 0, 0, "=A!A1*10".into()))
            .unwrap(); // B!A1 = 50
        // Change A!A1 → 8; B!A1 (on the other sheet) must recompute to 80.
        app.call(|s| s.set_cell(a.clone(), 0, 0, "8".into())).unwrap();
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
}
