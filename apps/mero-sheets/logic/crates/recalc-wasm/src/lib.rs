//! JSON + wasm-bindgen boundary over the pure recalc engine.
//!
//! The browser keeps the workbook's structure here with [`set_structure`]:
//! each sheet's row and column entries and the named ranges. Everything else
//! reads it: [`evaluate`] computes values, [`to_display`] / [`to_stored`]
//! convert a formula between what a person types (positions) and what is
//! stored (row and column ids), and [`visible_order`] says which ids sit at
//! which positions, so the grid, the node and the browser all place a cell by
//! the same code.

use std::cell::RefCell;
use std::collections::{BTreeMap, HashSet};

use mero_sheets_recalc::formula::{self, Env, CATALOG};
use mero_sheets_recalc::layout::{Axis, AxisEntry, Layout};
use mero_sheets_recalc::recalc::{evaluate as recalc_evaluate, CellRef, WorkbookInputs};
use mero_sheets_recalc::rules;
use serde::{Deserialize, Serialize};
use wasm_bindgen::prelude::wasm_bindgen;

#[derive(Deserialize)]
struct InputCell {
    sheet_id: String,
    row_id: String,
    col_id: String,
    raw_value: String,
}

#[derive(Deserialize)]
struct Input {
    cells: Vec<InputCell>,
    sheet_ids: Vec<String>,
    /// The browser's clock, for `NOW()`/`TODAY()`.
    #[serde(default)]
    now_ms: u64,
}

#[derive(Serialize, Deserialize)]
pub struct OutputCell {
    pub sheet_id: String,
    pub row_id: String,
    pub col_id: String,
    pub computed_value: String,
}

#[derive(Deserialize)]
struct EntryIn {
    id: String,
    pos: String,
    deleted: bool,
}

#[derive(Deserialize)]
struct SheetLayoutIn {
    sheet_id: String,
    rows: Vec<EntryIn>,
    cols: Vec<EntryIn>,
}

#[derive(Deserialize)]
struct NameIn {
    name: String,
    target: String,
}

/// The contract's `get_layouts` and `get_named_ranges`, as one message.
#[derive(Deserialize)]
struct StructureIn {
    #[serde(default)]
    layouts: Vec<SheetLayoutIn>,
    #[serde(default)]
    names: Vec<NameIn>,
}

thread_local! {
    /// The workbook structure every call reads; the clock is per call.
    static ENV: RefCell<Env> = RefCell::new(Env::default());
}

fn entries(list: Vec<EntryIn>) -> Vec<AxisEntry> {
    list.into_iter()
        .map(|e| AxisEntry {
            id: e.id,
            pos: e.pos,
            deleted: e.deleted,
        })
        .collect()
}

/// Replace the workbook structure. Returns `false` (and keeps the old one)
/// when the JSON does not parse.
pub fn set_structure_json(input: &str) -> bool {
    let Ok(parsed) = serde_json::from_str::<StructureIn>(input) else {
        return false;
    };
    let layouts = parsed
        .layouts
        .into_iter()
        .map(|l| {
            let layout = Layout {
                rows: Axis::build(&entries(l.rows), formula::MAX_ROWS),
                cols: Axis::build(&entries(l.cols), formula::MAX_COLS),
            };
            (l.sheet_id, layout)
        })
        .collect();
    let names = parsed
        .names
        .into_iter()
        .filter(|n| !n.target.is_empty())
        .map(|n| (n.name.to_ascii_uppercase(), n.target))
        .collect();
    ENV.with(|env| {
        let mut env = env.borrow_mut();
        env.layouts = layouts;
        env.names = names;
    });
    true
}

/// Native, unit-testable core of [`evaluate`]: run the engine over every cell
/// with the current structure. Malformed input gives `[]`, which the client
/// treats as "no computed values" (it then shows raw values).
pub fn evaluate_json(input: &str) -> String {
    let parsed: Input = match serde_json::from_str(input) {
        Ok(v) => v,
        Err(_) => return "[]".to_string(),
    };
    let cells: BTreeMap<CellRef, String> = parsed
        .cells
        .into_iter()
        .map(|c| {
            (
                CellRef {
                    sheet_id: c.sheet_id,
                    row: c.row_id,
                    col: c.col_id,
                },
                c.raw_value,
            )
        })
        .collect();
    let sheet_ids: HashSet<String> = parsed.sheet_ids.into_iter().collect();
    let env = ENV.with(|env| Env {
        now_ms: parsed.now_ms,
        ..env.borrow().clone()
    });
    let computed = recalc_evaluate(&WorkbookInputs {
        cells,
        sheet_ids,
        env,
    });
    let out: Vec<OutputCell> = computed
        .into_iter()
        .map(|(k, v)| OutputCell {
            sheet_id: k.sheet_id,
            row_id: k.row,
            col_id: k.col,
            computed_value: v,
        })
        .collect();
    serde_json::to_string(&out).unwrap_or_else(|_| "[]".to_string())
}

#[derive(Serialize)]
struct Order {
    rows: Vec<String>,
    cols: Vec<String>,
}

/// The ids at each visible position of a sheet, rows then columns.
pub fn visible_order_json(sheet_id: &str) -> String {
    let order = ENV.with(|env| {
        let env = env.borrow();
        let axis_ids = |a: &Axis| -> Vec<String> {
            (0..a.len())
                .filter_map(|i| a.id_at(i).map(|id| id.into_owned()))
                .collect()
        };
        match env.layouts.get(sheet_id) {
            Some(l) => Order {
                rows: axis_ids(&l.rows),
                cols: axis_ids(&l.cols),
            },
            None => Order {
                rows: axis_ids(&Axis::Identity(formula::MAX_ROWS)),
                cols: axis_ids(&Axis::Identity(formula::MAX_COLS)),
            },
        }
    });
    serde_json::to_string(&order).unwrap_or_else(|_| r#"{"rows":[],"cols":[]}"#.to_string())
}

#[derive(Serialize)]
struct FunctionOut {
    name: &'static str,
    category: &'static str,
    syntax: &'static str,
    description: &'static str,
    example: &'static str,
}

/// The engine's function catalog as JSON, in the contract's `FunctionDef`
/// shape, so the browser's function help needs no node round-trip and lists
/// exactly what this build evaluates.
pub fn functions_json() -> String {
    let out: Vec<FunctionOut> = CATALOG
        .iter()
        .map(|f| FunctionOut {
            name: f.name,
            category: f.category,
            syntax: f.syntax,
            description: f.description,
            example: f.example,
        })
        .collect();
    serde_json::to_string(&out).unwrap_or_else(|_| "[]".to_string())
}

/// Browser entry point for [`set_structure_json`].
#[wasm_bindgen]
pub fn set_structure(input: &str) -> bool {
    set_structure_json(input)
}

/// Browser entry point for [`evaluate_json`].
#[wasm_bindgen]
pub fn evaluate(input: &str) -> String {
    evaluate_json(input)
}

/// A formula as typed (positions) → as stored (ids), on sheet `home`.
#[wasm_bindgen]
pub fn to_stored(formula_text: &str, home: &str) -> String {
    ENV.with(|env| formula::to_stored(formula_text, home, &env.borrow()))
}

/// A formula as stored (ids) → as shown (positions), on sheet `home`.
#[wasm_bindgen]
pub fn to_display(formula_text: &str, home: &str) -> String {
    ENV.with(|env| formula::to_display(formula_text, home, &env.borrow()))
}

/// Browser entry point for [`visible_order_json`].
#[wasm_bindgen]
pub fn visible_order(sheet_id: &str) -> String {
    visible_order_json(sheet_id)
}

/// Browser entry point for [`functions_json`].
#[wasm_bindgen]
pub fn functions() -> String {
    functions_json()
}

/// Whether `value` meets a rule's condition (`args` a JSON array of strings):
/// the same test the contract applies to a strict validation.
#[wasm_bindgen]
pub fn condition_matches(condition: &str, args: &str, value: &str) -> bool {
    let args: Vec<String> = serde_json::from_str(args).unwrap_or_default();
    rules::matches(condition, &args, value)
}

/// What a value must be to meet a condition, in words.
#[wasm_bindgen]
pub fn condition_describe(condition: &str, args: &str) -> String {
    let args: Vec<String> = serde_json::from_str(args).unwrap_or_default();
    rules::describe(condition, &args)
}

#[cfg(test)]
mod tests {
    use super::*;

    fn structure_with_inserted_row() {
        assert!(set_structure_json(
            r#"{"layouts":[{"sheet_id":"s","rows":[{"id":"nab","pos":"50000000005","deleted":false}],"cols":[]}],
                "names":[{"name":"Top","target":"A1:A2"}]}"#
        ));
    }

    #[test]
    fn evaluate_json_matches_native_chain() {
        set_structure_json("{}");
        // A1=1, A2=A1+4, A3=SUM(A1,A2) on sheet "s".
        let input = r#"{"cells":[
            {"sheet_id":"s","row_id":"0","col_id":"0","raw_value":"1"},
            {"sheet_id":"s","row_id":"1","col_id":"0","raw_value":"=A1+4"},
            {"sheet_id":"s","row_id":"2","col_id":"0","raw_value":"=SUM(A1,A2)"}
        ],"sheet_ids":["s"]}"#;
        let parsed: Vec<OutputCell> = serde_json::from_str(&evaluate_json(input)).unwrap();
        let a3 = parsed
            .iter()
            .find(|c| c.row_id == "2" && c.col_id == "0")
            .unwrap();
        assert_eq!(a3.computed_value, "6");
    }

    #[test]
    fn evaluate_json_uses_the_structure() {
        structure_with_inserted_row();
        let input = r#"{"cells":[
            {"sheet_id":"s","row_id":"0","col_id":"0","raw_value":"1"},
            {"sheet_id":"s","row_id":"nab","col_id":"0","raw_value":"10"},
            {"sheet_id":"s","row_id":"1","col_id":"0","raw_value":"2"},
            {"sheet_id":"s","row_id":"0","col_id":"1","raw_value":"=SUM(Top)"}
        ],"sheet_ids":["s"]}"#;
        let parsed: Vec<OutputCell> = serde_json::from_str(&evaluate_json(input)).unwrap();
        let b1 = parsed
            .iter()
            .find(|c| c.row_id == "0" && c.col_id == "1")
            .unwrap();
        assert_eq!(b1.computed_value, "13");
    }

    #[test]
    fn conversions_and_order_follow_the_structure() {
        structure_with_inserted_row();
        assert_eq!(to_stored("=A2", "s"), "={r=nab;c=0}");
        assert_eq!(to_display("=A2", "s"), "=A3");
        let order: serde_json::Value = serde_json::from_str(&visible_order_json("s")).unwrap();
        assert_eq!(order["rows"][0], "0");
        assert_eq!(order["rows"][1], "nab");
        assert_eq!(order["rows"][2], "1");
        let other: serde_json::Value = serde_json::from_str(&visible_order_json("t")).unwrap();
        assert_eq!(other["rows"][1], "1");
    }

    #[test]
    fn a_bad_structure_is_refused_and_the_old_one_kept() {
        structure_with_inserted_row();
        assert!(!set_structure_json("not json"));
        assert_eq!(to_stored("=A2", "s"), "={r=nab;c=0}");
    }

    #[test]
    fn evaluate_json_unknown_sheet_is_ref_error() {
        set_structure_json("{}");
        let input = r#"{"cells":[
            {"sheet_id":"s","row_id":"0","col_id":"0","raw_value":"=[gone]!A1"}
        ],"sheet_ids":["s"]}"#;
        let parsed: Vec<OutputCell> = serde_json::from_str(&evaluate_json(input)).unwrap();
        assert_eq!(parsed[0].computed_value, "#REF!");
    }

    #[test]
    fn evaluate_json_reads_the_clock() {
        set_structure_json("{}");
        // 2026-09-25T12:00:00Z is serial 46290.5.
        let input = r#"{"cells":[
            {"sheet_id":"s","row_id":"0","col_id":"0","raw_value":"=TODAY()"}
        ],"sheet_ids":["s"],"now_ms":1790337600000}"#;
        let parsed: Vec<OutputCell> = serde_json::from_str(&evaluate_json(input)).unwrap();
        assert_eq!(parsed[0].computed_value, "46290");
    }

    #[test]
    fn functions_json_lists_the_catalog() {
        let parsed: Vec<serde_json::Value> = serde_json::from_str(&functions_json()).unwrap();
        assert_eq!(parsed.len(), CATALOG.len());
        assert_eq!(parsed[0]["name"], CATALOG[0].name);
        assert!(parsed[0]["category"].is_string());
    }

    #[test]
    fn evaluate_json_malformed_input_returns_empty_array() {
        let out = evaluate_json("not json");
        assert_eq!(out, "[]");
        let parsed: Vec<OutputCell> = serde_json::from_str(&out).unwrap();
        assert!(parsed.is_empty());
    }
}
