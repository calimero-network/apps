//! JSON + wasm-bindgen boundary over the pure recalc engine.

use std::collections::{BTreeMap, HashSet};

use p2p_sheets_recalc::recalc::{evaluate as recalc_evaluate, CellRef, WorkbookInputs};
use serde::{Deserialize, Serialize};
use wasm_bindgen::prelude::wasm_bindgen;

#[derive(Deserialize)]
struct InputCell {
    sheet_id: String,
    row: u32,
    col: u32,
    raw_value: String,
}

#[derive(Deserialize)]
struct Input {
    cells: Vec<InputCell>,
    sheet_ids: Vec<String>,
}

#[derive(Serialize, Deserialize)]
pub struct OutputCell {
    pub sheet_id: String,
    pub row: u32,
    pub col: u32,
    pub computed_value: String,
}

/// Native, unit-testable core: parse input JSON, run the pure engine, serialize
/// the full computed map back. Identical result to `recalc::evaluate`.
pub fn evaluate_json(input: &str) -> String {
    // Malformed input degrades to an empty array so the wire shape always
    // deserializes as `Vec<OutputCell>` (design §5.1). The client falls back to
    // raw values, and the dev-mode WASM/node agreement assert surfaces real divergence.
    let parsed: Input = match serde_json::from_str(input) {
        Ok(v) => v,
        Err(_) => return "[]".to_string(),
    };
    let cells: BTreeMap<CellRef, String> = parsed
        .cells
        .into_iter()
        .map(|c| (CellRef { sheet_id: c.sheet_id, row: c.row, col: c.col }, c.raw_value))
        .collect();
    let sheet_ids: HashSet<String> = parsed.sheet_ids.into_iter().collect();
    let computed = recalc_evaluate(&WorkbookInputs { cells, sheet_ids });
    let out: Vec<OutputCell> = computed
        .into_iter()
        .map(|(k, v)| OutputCell { sheet_id: k.sheet_id, row: k.row, col: k.col, computed_value: v })
        .collect();
    serde_json::to_string(&out).unwrap_or_else(|_| "[]".to_string())
}

/// Browser entry point. Same signature the future warm/incremental engine keeps.
#[wasm_bindgen]
pub fn evaluate(input: &str) -> String {
    evaluate_json(input)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn evaluate_json_matches_native_chain() {
        // A1=1, A2=A1+4, A3=SUM(A1,A2) on sheet "s".
        let input = r#"{"cells":[
            {"sheet_id":"s","row":0,"col":0,"raw_value":"1"},
            {"sheet_id":"s","row":1,"col":0,"raw_value":"=A1+4"},
            {"sheet_id":"s","row":2,"col":0,"raw_value":"=SUM(A1,A2)"}
        ],"sheet_ids":["s"]}"#;
        let out = evaluate_json(input);
        // Parse back and look up A3 = 6.
        let parsed: Vec<OutputCell> = serde_json::from_str(&out).unwrap();
        let a3 = parsed.iter().find(|c| c.sheet_id == "s" && c.row == 2 && c.col == 0).unwrap();
        assert_eq!(a3.computed_value, "6");
    }

    #[test]
    fn evaluate_json_unknown_sheet_is_ref_error() {
        let input = r#"{"cells":[
            {"sheet_id":"s","row":0,"col":0,"raw_value":"=[gone]!A1"}
        ],"sheet_ids":["s"]}"#;
        let parsed: Vec<OutputCell> = serde_json::from_str(&evaluate_json(input)).unwrap();
        let c = parsed.iter().find(|c| c.row == 0 && c.col == 0).unwrap();
        assert_eq!(c.computed_value, "#REF!");
    }

    #[test]
    fn evaluate_json_malformed_input_returns_empty_array() {
        let out = evaluate_json("not json");
        assert_eq!(out, "[]");
        // And it deserializes as an empty Vec<OutputCell>, preserving the array contract.
        let parsed: Vec<OutputCell> = serde_json::from_str(&out).unwrap();
        assert!(parsed.is_empty());
    }
}
