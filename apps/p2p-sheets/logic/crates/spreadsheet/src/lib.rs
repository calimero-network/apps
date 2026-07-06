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
        let mut guard = self
            .sheets
            .get_mut(&sheet_id)
            .map_err(|e| AppError::msg(format!("sheets.get_mut: {e}")))?
            .ok_or_else(|| AppError::from(Error::NotFound(sheet_id.clone())))?;
        let now = storage_env::time_now();
        guard.name = new_name.clone();
        guard.updated_at = now;
        drop(guard);
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
        // Snapshot current cell values for formula evaluation.
        let cell_snapshot: Vec<(String, String)> = self
            .cells
            .entries()
            .map_err(|e| AppError::msg(format!("cells.entries: {e}")))?
            .filter_map(|(k, d)| {
                if d.sheet_id == sheet_id {
                    Some((k, d.computed_value.clone()))
                } else {
                    None
                }
            })
            .collect();
        let computed = formula::evaluate(&formula, |r, c| {
            let k = Spreadsheet::cell_key(&sheet_id, r, c);
            cell_snapshot
                .iter()
                .find(|(key, _)| key == &k)
                .map(|(_, v)| v.clone())
        });
        let key = Spreadsheet::cell_key(&sheet_id, row, col);
        let now = storage_env::time_now();
        let data = CellData {
            id: key.clone(),
            sheet_id: sheet_id.clone(),
            row,
            col,
            raw_value: formula,
            computed_value: computed,
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
    /// `formula` should start with `=`. `get_value` maps `(row, col)` — both
    /// 0-indexed as used by the API — to the cell's current computed value.
    /// Cell references in formulas use 1-indexed rows and A-Z columns
    /// (e.g. `A1` → row 0, col 0).
    pub fn evaluate(formula: &str, get_value: impl Fn(u32, u32) -> Option<String>) -> String {
        let expr = formula.trim().strip_prefix('=').unwrap_or(formula).trim();
        eval_to_string(expr, &get_value)
    }

    /// Evaluate an expression to its display string.
    fn eval_to_string(expr: &str, get_value: &impl Fn(u32, u32) -> Option<String>) -> String {
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

        // Bare cell reference holding non-numeric text.
        if let Some((row, col)) = parse_cell_ref(expr) {
            return get_value(row, col).unwrap_or_default();
        }

        "#VALUE!".to_string()
    }

    /// If `expr` is exactly a single `NAME(args)` call, evaluate it; else
    /// `None` (so `SUM(..)+1` and bare arithmetic fall to the number parser).
    fn try_function(expr: &str, get_value: &impl Fn(u32, u32) -> Option<String>) -> Option<String> {
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
    fn collect_arg_values(args: &str, get_value: &impl Fn(u32, u32) -> Option<String>) -> Vec<f64> {
        let mut nums = Vec::new();
        for arg in split_args(args) {
            let arg = arg.trim();
            if arg.is_empty() {
                continue;
            }
            if arg.contains(':') {
                for (r, c) in expand_range(arg) {
                    if let Some(raw) = get_value(r, c) {
                        if let Ok(n) = raw.trim().parse::<f64>() {
                            nums.push(n);
                        }
                    }
                }
            } else if let Some(n) = eval_number(arg, get_value) {
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

    fn eval_number(expr: &str, gv: &impl Fn(u32, u32) -> Option<String>) -> Option<f64> {
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

    fn parse_add(c: &[char], p: &mut usize, gv: &impl Fn(u32, u32) -> Option<String>) -> Option<f64> {
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

    fn parse_mul(c: &[char], p: &mut usize, gv: &impl Fn(u32, u32) -> Option<String>) -> Option<f64> {
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

    fn parse_factor(c: &[char], p: &mut usize, gv: &impl Fn(u32, u32) -> Option<String>) -> Option<f64> {
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

    /// A leading alphabetic run is either a function call `NAME(...)` or a cell
    /// reference `A1`.
    fn parse_ident(c: &[char], p: &mut usize, gv: &impl Fn(u32, u32) -> Option<String>) -> Option<f64> {
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
            eval_to_string(&call, gv).trim().parse::<f64>().ok()
        } else {
            // Cell reference: column letters followed by row digits.
            let dstart = *p;
            while *p < c.len() && c[*p].is_ascii_digit() {
                *p += 1;
            }
            if *p == dstart {
                return None; // letters with no row digits — not a cell ref
            }
            let refstr: String = c[start..*p].iter().collect();
            let (row, col) = parse_cell_ref(&refstr)?;
            match gv(row, col) {
                // Empty / missing cell counts as 0 in arithmetic; non-numeric
                // text makes the surrounding expression non-numeric (None).
                Some(val) => {
                    let t = val.trim();
                    if t.is_empty() { Some(0.0) } else { t.parse::<f64>().ok() }
                }
                None => Some(0.0),
            }
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
    fn expand_range(range: &str) -> Vec<(u32, u32)> {
        let parts: Vec<&str> = range.split(':').collect();
        match parts.as_slice() {
            [single] => parse_cell_ref(single.trim())
                .map(|rc| vec![rc])
                .unwrap_or_default(),
            [start, end] => {
                match (parse_cell_ref(start.trim()), parse_cell_ref(end.trim())) {
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
    fn formula_arithmetic_literals() {
        let gv = |_r: u32, _c: u32| None;
        assert_eq!(formula::evaluate("=3+4", &gv), "7");
        assert_eq!(formula::evaluate("=SUM(3+4)", &gv), "7");
        assert_eq!(formula::evaluate("=10-4", &gv), "6");
        assert_eq!(formula::evaluate("=2*3", &gv), "6");
        assert_eq!(formula::evaluate("=8/2", &gv), "4");
        assert_eq!(formula::evaluate("=(1+2)*3", &gv), "9");
        assert_eq!(formula::evaluate("=2+3*4", &gv), "14"); // precedence
    }

    #[test]
    fn formula_arithmetic_with_cells_and_args() {
        // A1 = 10 (row 0, col 0), A2 = 20 (row 1, col 0)
        let gv = |r: u32, c: u32| match (r, c) {
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
