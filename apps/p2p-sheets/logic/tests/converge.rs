//! Convergence coverage for the spreadsheet service.
//!
//! `Spreadsheet` hand-writes `Mergeable` on `SheetData` and `CellData` (plain
//! struct fields, no nested CRDTs), so no `__calimero_register_rekey()` is
//! needed. The test exercises the `sheets` and `cells` `UnorderedMap` fields only.
//!
//! The `cursors: AuthoredMap` is seeded empty at genesis and never touched by
//! `.ops()` — the bare converge harness has no signing identity and cannot
//! reconcile `AuthoredMap` entries written concurrently.
//!
//! `#[serial]`: `converge_app` clears/repopulates the process-global merge
//! registry per run.

use calimero_storage::testing::converge_app;
use p2p_sheets::Spreadsheet;
use serial_test::serial;

#[test]
#[serial]
fn cell_updates_converge() {
    converge_app(|| {
        // Genesis seed: init project + create one sheet + set one cell.
        // All written under the single genesis identity (no concurrent ops here),
        // so the AuthoredMap (cursors) is never touched.
        let mut s = Spreadsheet::init();
        let _ = s.init_project("Test Project".into());
        let sheet_id = s.create_sheet("Sheet1".into()).unwrap();
        let _ = s.set_cell(sheet_id, 0, 0, "v0".into());
        s
    })
    .replicas(3)
    // Each replica concurrently rewrites the single seeded cell's value.
    // `set_cell` touches `cells: UnorderedMap` only — the `sheets` UnorderedMap
    // is read (to verify the sheet exists) but not written.
    .ops(|s| {
        let sheets = s.list_sheets().unwrap_or_default();
        if let Some(sheet) = sheets.into_iter().next() {
            let _ = s.set_cell(sheet.id, 0, 0, "v1".into());
        }
    })
    .invariant(
        "the seeded cell survives and holds the converged value",
        |s| {
            let sheets = s.list_sheets().unwrap_or_default();
            if sheets.len() != 1 {
                return false;
            }
            let cells = s.get_cells(sheets[0].id.clone()).unwrap_or_default();
            cells.len() == 1 && cells[0].computed_value == "v1"
        },
    )
    .assert_all_replicas_equal();
}

#[test]
#[serial]
fn sheet_renames_converge() {
    converge_app(|| {
        let mut s = Spreadsheet::init();
        let _ = s.init_project("Test Project".into());
        let _ = s.create_sheet("Original".into());
        s
    })
    .replicas(3)
    .ops(|s| {
        let sheets = s.list_sheets().unwrap_or_default();
        if let Some(sheet) = sheets.into_iter().next() {
            let _ = s.rename_sheet(sheet.id, "Renamed".into());
        }
    })
    .invariant("sheet name converges to the renamed value", |s| {
        let sheets = s.list_sheets().unwrap_or_default();
        sheets.len() == 1 && sheets[0].name == "Renamed"
    })
    .assert_all_replicas_equal();
}
