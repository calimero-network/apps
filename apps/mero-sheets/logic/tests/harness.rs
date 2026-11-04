//! The workbook on core's real wasmtime engine (`TestApp`): v1's `TestHost`
//! tests, method family by method family; v1's merge tests as what they become
//! under one log; and the access and wire checks v1 could not express.

#![cfg(not(target_arch = "wasm32"))]

mod common;

use calimero_sdk::testing::{Failure, Org, TestApp};
use serde_json::{json, Value};

/// The owner (the workbook's first owner), members `bob` and `cy`, guest `gus`.
fn app() -> TestApp {
    common::app(Org::new().members(["bob", "cy"]).guests(["gus"]))
}

fn call(t: &mut TestApp, who: &str, method: &str, args: Value) -> Value {
    t.as_(who)
        .call(method, args)
        .unwrap_or_else(|e| panic!("{who} {method}: {e:?}"))
}

fn view(t: &mut TestApp, who: &str, method: &str, args: Value) -> Value {
    t.as_(who)
        .view(method, args)
        .unwrap_or_else(|e| panic!("{who} {method}: {e:?}"))
}

fn fails(result: Result<Value, Failure>) -> (String, Value) {
    match result {
        Err(Failure::App { code, fields }) => (code, fields),
        other => panic!("expected an app error, got {other:?}"),
    }
}

fn code(result: Result<Value, Failure>) -> String {
    fails(result).0
}

fn s(v: &Value) -> String {
    v.as_str().expect("a string").to_owned()
}

/// A workbook named "P" with one sheet; answers the sheet id.
fn workbook(t: &mut TestApp) -> String {
    let _ = call(t, "owner", "initProject", json!({ "name": "P" }));
    s(&call(t, "owner", "createSheet", json!({ "name": "S" })))
}

fn set(
    t: &mut TestApp,
    who: &str,
    sheet: &str,
    row: &str,
    col: &str,
    raw: &str,
) -> Result<Value, Failure> {
    t.as_(who).call(
        "setCell",
        json!({ "sheetId": sheet, "rowId": row, "colId": col, "rawValue": raw }),
    )
}

fn cells(t: &mut TestApp, sheet: &str) -> Vec<Value> {
    view(t, "owner", "getCells", json!({ "sheetId": sheet }))
        .as_array()
        .expect("cells")
        .clone()
}

fn computed(t: &mut TestApp, sheet: &str, row: &str, col: &str) -> String {
    cells(t, sheet)
        .into_iter()
        .find(|c| c["row_id"] == json!(row) && c["col_id"] == json!(col))
        .map(|c| s(&c["computed_value"]))
        .unwrap_or_else(|| panic!("no cell {row}/{col}"))
}

fn join(t: &mut TestApp, who: &str, nickname: &str) {
    let _ = call(t, who, "join", json!({ "nickname": nickname }));
}

fn event_names(t: &TestApp, who: &str) -> Vec<String> {
    t.events_for(who).into_iter().map(|(n, _)| n).collect()
}

// ── project and members ─────────────────────────────────────────────────────

#[test]
fn init_project_names_the_workbook_once_and_get_project_reads_it() {
    let mut t = app();
    let before = view(&mut t, "bob", "getProject", json!({}));
    assert_eq!(before["name"], json!(""));
    let id = s(&before["id"]);
    assert!(id.starts_with("proj-"), "{id}");
    // Nanoseconds, as v1 answered, and a decimal string on the wire.
    assert_eq!(
        before["created_at"],
        json!((common::T0 * 1_000_000).to_string())
    );
    assert_eq!(
        call(&mut t, "owner", "initProject", json!({ "name": "Budget" })),
        json!(id)
    );
    assert_eq!(
        view(&mut t, "bob", "getProject", json!({}))["name"],
        json!("Budget")
    );
    assert_eq!(
        code(
            t.as_("owner")
                .call("initProject", json!({ "name": "Again" }))
        ),
        "Invalid"
    );
    assert!(event_names(&t, "bob").contains(&"ProjectInitialized".to_owned()));
}

#[test]
fn only_an_owner_names_the_workbook() {
    let mut t = app();
    let (c, f) = fails(t.as_("bob").call("initProject", json!({ "name": "Mine" })));
    assert_eq!(c, "Forbidden");
    assert!(f["message"].as_str().unwrap().contains("only an owner"));
}

#[test]
fn join_records_a_nickname_idempotently_and_whoami_is_the_account() {
    let mut t = app();
    assert_eq!(view(&mut t, "bob", "whoami", json!({})), json!("bob"));
    join(&mut t, "bob", "  Bob  ");
    t.advance(1000);
    join(&mut t, "owner", "Ada");
    t.advance(1000);
    join(&mut t, "bob", "Bobby");
    let members = view(&mut t, "cy", "getMembers", json!({}));
    let members = members.as_array().unwrap();
    assert_eq!(members.len(), 2);
    // Oldest arrival first; a rename does not move bob.
    assert_eq!(members[0]["id"], json!("bob"));
    assert_eq!(members[0]["nickname"], json!("Bobby"));
    assert_eq!(members[0]["account"], json!("bob"));
    assert_eq!(members[0]["role"], json!("editor"));
    assert_ne!(members[0]["joined_at"], members[0]["updated_at"]);
    assert_eq!(members[1]["role"], json!("owner"));
    let names = event_names(&t, "cy");
    assert!(names.contains(&"MemberJoined".to_owned()));
    assert!(names.contains(&"MemberRenamed".to_owned()));
    for bad in ["   ", &"x".repeat(65)] {
        assert_eq!(
            code(t.as_("bob").call("join", json!({ "nickname": bad }))),
            "Invalid"
        );
    }
}

// ── sheets ──────────────────────────────────────────────────────────────────

#[test]
fn sheets_are_created_renamed_listed_and_deleted() {
    let mut t = app();
    let a = workbook(&mut t);
    let b = s(&call(&mut t, "bob", "createSheet", json!({ "name": "S" })));
    let list = view(&mut t, "owner", "listSheets", json!({}));
    let names: Vec<_> = list
        .as_array()
        .unwrap()
        .iter()
        .map(|x| s(&x["name"]))
        .collect();
    assert_eq!(names, ["S", "S (2)"]);
    assert_eq!(list[1]["position"], json!(1));
    assert_eq!(
        code(
            t.as_("owner")
                .call("renameSheet", json!({ "sheetId": b, "newName": "S" }))
        ),
        "Invalid"
    );
    let _ = call(
        &mut t,
        "owner",
        "renameSheet",
        json!({ "sheetId": a, "newName": "S" }),
    );
    assert_eq!(
        code(
            t.as_("owner")
                .call("renameSheet", json!({ "sheetId": a, "newName": "a!b" }))
        ),
        "Invalid"
    );
    let _ = call(
        &mut t,
        "owner",
        "renameSheet",
        json!({ "sheetId": b, "newName": "Data" }),
    );
    let _ = call(&mut t, "owner", "deleteSheet", json!({ "sheetId": a }));
    let list = view(&mut t, "owner", "listSheets", json!({}));
    assert_eq!(list.as_array().unwrap().len(), 1);
    assert_eq!(list[0]["name"], json!("Data"));
    assert_eq!(
        code(t.as_("owner").call("deleteSheet", json!({ "sheetId": a }))),
        "NotFound"
    );
    assert_eq!(view(&mut t, "owner", "exportAll", json!({})), list);
}

// ── cells and formulas ──────────────────────────────────────────────────────

#[test]
fn formulas_evaluate_and_recompute_on_read() {
    let mut t = app();
    let sid = workbook(&mut t);
    for (r, v) in [("0", "10"), ("1", "20"), ("2", "30")] {
        let _ = set(&mut t, "owner", &sid, r, "0", v).unwrap();
    }
    let key = set(&mut t, "owner", &sid, "3", "0", "=SUM(A1:A3)").unwrap();
    assert_eq!(key, json!(format!("{sid}|3|0")));
    assert_eq!(computed(&mut t, &sid, "3", "0"), "60");
    let _ = set(
        &mut t,
        "bob",
        &sid,
        "4",
        "0",
        "=AVERAGE(A1:A3)+COUNT(A1:A3)",
    )
    .unwrap();
    assert_eq!(computed(&mut t, &sid, "4", "0"), "23");
    let _ = set(&mut t, "owner", &sid, "0", "0", "40").unwrap();
    assert_eq!(computed(&mut t, &sid, "3", "0"), "90");
    let _ = call(
        &mut t,
        "owner",
        "clearCell",
        json!({ "sheetId": sid, "rowId": "0", "colId": "0" }),
    );
    assert_eq!(computed(&mut t, &sid, "3", "0"), "50");
    assert!(cells(&mut t, &sid)
        .iter()
        .all(|c| c["row_id"] != json!("0")));
    let _ = set(&mut t, "owner", &sid, "5", "0", "=A6").unwrap();
    assert_eq!(computed(&mut t, &sid, "5", "0"), "#CYCLE!");
}

#[test]
fn cross_sheet_references_and_unknown_sheets() {
    let mut t = app();
    let s1 = workbook(&mut t);
    let data = s(&call(
        &mut t,
        "owner",
        "createSheet",
        json!({ "name": "Data" }),
    ));
    let _ = set(&mut t, "owner", &data, "0", "0", "10").unwrap();
    let _ = set(&mut t, "owner", &data, "1", "0", "20").unwrap();
    let _ = set(
        &mut t,
        "owner",
        &s1,
        "0",
        "1",
        &format!("=[{data}]!A1+[{data}]!A2"),
    )
    .unwrap();
    let _ = set(
        &mut t,
        "owner",
        &s1,
        "1",
        "1",
        &format!("=SUM([{data}]!A1:A2)"),
    )
    .unwrap();
    let _ = set(&mut t, "owner", &s1, "2", "1", "=[nope]!A1").unwrap();
    assert_eq!(computed(&mut t, &s1, "0", "1"), "30");
    assert_eq!(computed(&mut t, &s1, "1", "1"), "30");
    assert_eq!(computed(&mut t, &s1, "2", "1"), "#REF!");
    let _ = set(&mut t, "owner", &data, "0", "0", "15").unwrap();
    assert_eq!(computed(&mut t, &s1, "0", "1"), "35");
    let all = view(&mut t, "owner", "getAllCells", json!({}));
    assert_eq!(all.as_array().unwrap().len(), 5);
}

#[test]
fn formats_keep_values_and_values_keep_formats() {
    let mut t = app();
    let sid = workbook(&mut t);
    let _ = call(
        &mut t,
        "owner",
        "setCellFormat",
        json!({ "sheetId": sid, "rowId": "0", "colId": "0", "format": "currency" }),
    );
    let _ = set(&mut t, "owner", &sid, "0", "0", "5").unwrap();
    let c = &cells(&mut t, &sid)[0];
    assert_eq!(
        (c["raw_value"].clone(), c["format"].clone()),
        (json!("5"), json!("currency"))
    );
    assert_eq!(c["last_editor"], json!("owner"));
    assert!(c["last_edited_at"].is_string());
}

#[test]
fn apply_cell_ops_applies_a_mixed_batch_and_refuses_an_oversized_one() {
    let mut t = app();
    let sid = workbook(&mut t);
    let ops = json!([
        { "name": "Set", "payload": { "row_id": "0", "col_id": "0", "raw_value": "1" } },
        { "name": "Set", "payload": { "row_id": "1", "col_id": "0", "raw_value": "=A1+1" } },
        { "name": "Format", "payload": { "row_id": "1", "col_id": "0", "format": "number" } },
        { "name": "Clear", "payload": { "row_id": "9", "col_id": "9" } },
    ]);
    let _ = call(
        &mut t,
        "bob",
        "applyCellOps",
        json!({ "sheetId": sid, "ops": ops }),
    );
    assert_eq!(computed(&mut t, &sid, "1", "0"), "2");
    assert_eq!(
        t.events_for("cy").last().unwrap(),
        &(
            "CellsChanged".to_owned(),
            json!({ "sheetId": sid, "count": 4 })
        )
    );
    let many: Vec<Value> = (0..101)
        .map(|i| json!({ "name": "Set", "payload": { "row_id": i.to_string(), "col_id": "0", "raw_value": "x" } }))
        .collect();
    assert_eq!(
        code(
            t.as_("bob")
                .call("applyCellOps", json!({ "sheetId": sid, "ops": many }))
        ),
        "Invalid"
    );
    assert_eq!(
        code(t.as_("bob").call(
            "setCell",
            json!({ "sheetId": "nope", "rowId": "0", "colId": "0", "rawValue": "1" })
        )),
        "NotFound"
    );
    assert_eq!(code(set(&mut t, "bob", &sid, "a|b", "0", "1")), "Invalid");
}

// ── rows, columns, named ranges ─────────────────────────────────────────────

#[test]
fn an_inserted_row_widens_ranges_and_a_deleted_one_is_ref() {
    let mut t = app();
    let sid = workbook(&mut t);
    for (r, v) in [("0", "1"), ("1", "2"), ("2", "3")] {
        let _ = set(&mut t, "owner", &sid, r, "0", v).unwrap();
    }
    let _ = set(&mut t, "owner", &sid, "0", "1", "=SUM(A1:A3)").unwrap();
    let layouts = view(&mut t, "owner", "getLayouts", json!({}));
    assert_eq!(layouts, json!([]));
    // Between implicit rows 0 and 1 (positions are fixed-width decimals).
    let pos = format!("{}5", mero_sheets_recalc::layout::implicit_pos(0));
    let _ = call(
        &mut t,
        "owner",
        "applyAxisOps",
        json!({ "sheetId": sid, "ops": [{ "name": "InsertRow", "payload": { "id": "nab", "pos": pos } }] }),
    );
    let _ = set(&mut t, "owner", &sid, "nab", "0", "10").unwrap();
    assert_eq!(computed(&mut t, &sid, "0", "1"), "16");
    let layouts = view(&mut t, "owner", "getLayouts", json!({}));
    assert_eq!(layouts[0]["rows"][0]["id"], json!("nab"));

    let _ = set(&mut t, "owner", &sid, "5", "1", "=A2*2").unwrap();
    let _ = call(
        &mut t,
        "owner",
        "applyAxisOps",
        json!({ "sheetId": sid, "ops": [{ "name": "DeleteRow", "payload": { "id": "1" } }] }),
    );
    assert_eq!(computed(&mut t, &sid, "5", "1"), "#REF!");
    let _ = call(
        &mut t,
        "owner",
        "applyAxisOps",
        json!({ "sheetId": sid, "ops": [{ "name": "RestoreRow", "payload": { "id": "1" } }] }),
    );
    assert_eq!(computed(&mut t, &sid, "5", "1"), "4");
    for op in [
        json!({ "name": "InsertRow", "payload": { "id": "7", "pos": "1" } }),
        json!({ "name": "InsertRow", "payload": { "id": "x1", "pos": "1a" } }),
        json!({ "name": "InsertRow", "payload": { "id": "nab", "pos": "1" } }),
    ] {
        assert_eq!(
            code(
                t.as_("owner")
                    .call("applyAxisOps", json!({ "sheetId": sid, "ops": [op] }))
            ),
            "Invalid"
        );
    }
}

#[test]
fn named_ranges_feed_formulas_and_can_be_deleted() {
    let mut t = app();
    let sid = workbook(&mut t);
    let _ = set(&mut t, "owner", &sid, "0", "1", "4").unwrap();
    let _ = set(&mut t, "owner", &sid, "1", "1", "6").unwrap();
    let target = format!("[{sid}]!B1:B2");
    let _ = call(
        &mut t,
        "owner",
        "setNamedRange",
        json!({ "name": "Costs", "target": target }),
    );
    let _ = set(&mut t, "owner", &sid, "0", "0", "=SUM(costs)").unwrap();
    assert_eq!(computed(&mut t, &sid, "0", "0"), "10");
    assert_eq!(
        view(&mut t, "bob", "getNamedRanges", json!({})),
        json!([{ "name": "Costs", "target": target }])
    );
    let _ = call(
        &mut t,
        "owner",
        "deleteNamedRange",
        json!({ "name": "COSTS" }),
    );
    assert_eq!(view(&mut t, "bob", "getNamedRanges", json!({})), json!([]));
    assert_eq!(computed(&mut t, &sid, "0", "0"), "#NAME?");
    assert_eq!(
        code(
            t.as_("owner")
                .call("deleteNamedRange", json!({ "name": "Costs" }))
        ),
        "NotFound"
    );
    for (name, target) in [("A1", "B1"), ("1x", "B1"), ("ok", "not a ref")] {
        assert_eq!(
            code(
                t.as_("owner")
                    .call("setNamedRange", json!({ "name": name, "target": target }))
            ),
            "Invalid"
        );
    }
}

// ── activity ────────────────────────────────────────────────────────────────

#[test]
fn edits_are_logged_newest_first_with_their_author() {
    let mut t = app();
    let sid = workbook(&mut t);
    t.advance(10);
    let _ = set(&mut t, "bob", &sid, "0", "0", "1").unwrap();
    t.advance(10);
    let _ = set(&mut t, "bob", &sid, "0", "0", "2").unwrap();
    let log = view(
        &mut t,
        "cy",
        "getActivity",
        json!({ "since": "0", "limit": 10 }),
    );
    let log = log.as_array().unwrap();
    assert_eq!(log[0]["author"], json!("bob"));
    assert_eq!(log[0]["kind"], json!("cells"));
    assert_eq!(log[0]["summary"], json!("edited a cell"));
    assert_eq!(log[0]["changes"][0]["before_raw"], json!("1"));
    assert_eq!(log[0]["changes"][0]["after_raw"], json!("2"));
    assert_eq!(log.last().unwrap()["summary"], json!("added sheet S"));
    // `since` is nanoseconds, as `at` is.
    let since = ((common::T0 + 20) * 1_000_000).to_string();
    let recent = view(
        &mut t,
        "cy",
        "getActivity",
        json!({ "since": since, "limit": 10 }),
    );
    assert_eq!(recent.as_array().unwrap().len(), 1);
    let one = view(
        &mut t,
        "cy",
        "getActivity",
        json!({ "since": "0", "limit": 1 }),
    );
    assert_eq!(one.as_array().unwrap().len(), 1);
    // A big batch logs one entry with the count and at most 50 changes.
    let ops: Vec<Value> = (0..60)
        .map(|i| json!({ "name": "Set", "payload": { "row_id": i.to_string(), "col_id": "1", "raw_value": "x" } }))
        .collect();
    let _ = call(
        &mut t,
        "bob",
        "applyCellOps",
        json!({ "sheetId": sid, "ops": ops }),
    );
    let top = &view(
        &mut t,
        "cy",
        "getActivity",
        json!({ "since": "0", "limit": 1 }),
    )[0];
    assert_eq!(top["count"], json!(60));
    assert_eq!(top["changes"].as_array().unwrap().len(), 50);
}

// ── comments and notes ──────────────────────────────────────────────────────

#[test]
fn comments_mention_thread_resolve_and_are_kept_to_their_author() {
    let mut t = app();
    let sid = workbook(&mut t);
    join(&mut t, "bob", "Bob Smith");
    join(&mut t, "cy", "Cy");
    let id = s(&call(
        &mut t,
        "cy",
        "addComment",
        json!({ "sheetId": sid, "rowId": "0", "colId": "0", "text": "hi @bob smith and @CY", "parent": "" }),
    ));
    let (_, data) = t
        .events_for("owner")
        .into_iter()
        .rev()
        .find(|(n, _)| n == "CommentAdded")
        .unwrap();
    assert_eq!(data["mentions"], json!(["bob", "cy"]));
    let reply = s(&call(
        &mut t,
        "bob",
        "addComment",
        json!({ "sheetId": sid, "rowId": "0", "colId": "0", "text": "ok", "parent": id }),
    ));
    assert_eq!(
        code(t.as_("bob").call(
            "addComment",
            json!({ "sheetId": sid, "rowId": "0", "colId": "0", "text": "x", "parent": "nope" })
        )),
        "NotFound"
    );
    assert_eq!(
        code(t.as_("bob").call(
            "addComment",
            json!({ "sheetId": sid, "rowId": "0", "colId": "0", "text": "  ", "parent": "" })
        )),
        "Invalid"
    );
    assert_eq!(
        code(
            t.as_("bob")
                .call("editComment", json!({ "id": id, "text": "mine" }))
        ),
        "Forbidden"
    );
    let _ = call(
        &mut t,
        "cy",
        "editComment",
        json!({ "id": id, "text": "edited" }),
    );
    let _ = call(
        &mut t,
        "bob",
        "setCommentResolved",
        json!({ "id": id, "resolved": true }),
    );
    let all = view(&mut t, "owner", "getComments", json!({}));
    assert_eq!(all[0]["text"], json!("edited"));
    assert_eq!(all[0]["author"], json!("cy"));
    assert_eq!(all[0]["resolved"], json!(true));
    assert_eq!(all[1]["parent"], json!(id));
    assert_eq!(
        code(t.as_("bob").call("deleteComment", json!({ "id": id }))),
        "Forbidden"
    );
    let _ = call(&mut t, "owner", "deleteComment", json!({ "id": id }));
    let _ = call(&mut t, "bob", "deleteComment", json!({ "id": reply }));
    assert_eq!(view(&mut t, "owner", "getComments", json!({})), json!([]));
}

#[test]
fn a_note_takes_text_and_formatting_and_lists_its_cell() {
    let mut t = app();
    let sid = workbook(&mut t);
    let at = json!({ "sheetId": sid, "rowId": "1", "colId": "2" });
    let edit = |ops: Value| {
        let mut args = at.clone();
        args["ops"] = ops;
        args
    };
    let _ = call(
        &mut t,
        "bob",
        "editNote",
        edit(
            json!([{ "insert": "Check " }, { "insert": "this", "attributes": { "bold": "true" } }]),
        ),
    );
    assert_eq!(
        view(&mut t, "cy", "getNote", at.clone()),
        json!([{ "text": "Check " }, { "text": "this", "attributes": { "bold": "true" } }])
    );
    assert_eq!(
        view(&mut t, "cy", "getNotedCells", json!({})),
        json!([{ "sheet_id": sid, "row_id": "1", "col_id": "2", "preview": "Check this" }])
    );
    let _ = call(
        &mut t,
        "bob",
        "editNote",
        edit(json!([{ "retain": 6 }, { "retain": 4, "attributes": { "bold": null } }])),
    );
    assert_eq!(
        view(&mut t, "cy", "getNote", at.clone()),
        json!([{ "text": "Check this" }])
    );
    let long = "x".repeat(5001);
    assert_eq!(
        code(
            t.as_("bob")
                .call("editNote", edit(json!([{ "insert": long }])))
        ),
        "Invalid"
    );
    assert_eq!(
        code(
            t.as_("bob")
                .call("editNote", edit(json!([{ "delete": 99 }])))
        ),
        "Invalid"
    );
    let _ = call(&mut t, "bob", "editNote", edit(json!([{ "delete": 10 }])));
    assert_eq!(view(&mut t, "cy", "getNote", at.clone()), json!([]));
    assert_eq!(view(&mut t, "cy", "getNotedCells", json!({})), json!([]));
    assert!(event_names(&t, "cy").contains(&"NoteChanged".to_owned()));
}

// ── roles and protected ranges ──────────────────────────────────────────────

#[test]
fn viewers_cannot_edit_and_commenters_can_only_comment() {
    let mut t = app();
    let sid = workbook(&mut t);
    join(&mut t, "bob", "Bob");
    join(&mut t, "cy", "Cy");
    let _ = call(
        &mut t,
        "owner",
        "setRole",
        json!({ "memberId": "bob", "role": "viewer" }),
    );
    let _ = call(
        &mut t,
        "owner",
        "setRole",
        json!({ "memberId": "cy", "role": "commenter" }),
    );
    let (c, f) = fails(set(&mut t, "bob", &sid, "0", "0", "1"));
    assert_eq!(c, "Forbidden");
    assert_eq!(f["message"], json!("you are a viewer in this workbook"));
    assert_eq!(code(set(&mut t, "cy", &sid, "0", "0", "1")), "Forbidden");
    assert_eq!(
        code(t.as_("bob").call(
            "addComment",
            json!({ "sheetId": sid, "rowId": "0", "colId": "0", "text": "x", "parent": "" })
        )),
        "Forbidden"
    );
    let _ = call(
        &mut t,
        "cy",
        "addComment",
        json!({ "sheetId": sid, "rowId": "0", "colId": "0", "text": "x", "parent": "" }),
    );
    let roles: Vec<_> = view(&mut t, "owner", "getMembers", json!({}))
        .as_array()
        .unwrap()
        .iter()
        .map(|m| (s(&m["id"]), s(&m["role"])))
        .collect();
    assert!(roles.contains(&("bob".into(), "viewer".into())));
    assert!(roles.contains(&("cy".into(), "commenter".into())));
    assert_eq!(
        code(t.as_("bob").call("createSheet", json!({ "name": "X" }))),
        "Forbidden"
    );
}

#[test]
fn only_owners_change_roles_and_the_last_owner_stays() {
    let mut t = app();
    let _ = workbook(&mut t);
    join(&mut t, "owner", "Ada");
    join(&mut t, "bob", "Bob");
    assert_eq!(
        code(
            t.as_("bob")
                .call("setRole", json!({ "memberId": "owner", "role": "viewer" }))
        ),
        "Forbidden"
    );
    assert_eq!(
        code(
            t.as_("owner")
                .call("setRole", json!({ "memberId": "owner", "role": "editor" }))
        ),
        "Invalid"
    );
    assert_eq!(
        code(
            t.as_("owner")
                .call("setRole", json!({ "memberId": "bob", "role": "boss" }))
        ),
        "Invalid"
    );
    assert_eq!(
        code(
            t.as_("owner")
                .call("setRole", json!({ "memberId": "cy", "role": "viewer" }))
        ),
        "NotFound"
    );
    let _ = call(
        &mut t,
        "owner",
        "setRole",
        json!({ "memberId": "bob", "role": "owner" }),
    );
    // Now bob moderates and names; the first owner may step down.
    let _ = call(
        &mut t,
        "bob",
        "setRole",
        json!({ "memberId": "owner", "role": "viewer" }),
    );
    assert_eq!(
        code(
            t.as_("owner")
                .call("setRole", json!({ "memberId": "bob", "role": "editor" }))
        ),
        "Forbidden"
    );
    assert_eq!(
        code(t.as_("owner").call("protectRange", json!({ "sheetId": "x", "topRowId": "", "leftColId": "", "bottomRowId": "", "rightColId": "", "description": "", "editors": [] }))),
        "Forbidden"
    );
    let log = view(
        &mut t,
        "bob",
        "getActivity",
        json!({ "since": "0", "limit": 5 }),
    );
    assert!(log
        .as_array()
        .unwrap()
        .iter()
        .any(|e| e["summary"] == json!("made Ada a viewer")));
    assert!(event_names(&t, "cy").contains(&"RolesChanged".to_owned()));
}

#[test]
fn a_protected_range_stops_other_editors_and_follows_its_cells() {
    let mut t = app();
    let sid = workbook(&mut t);
    join(&mut t, "bob", "Bob");
    join(&mut t, "cy", "Cy");
    let id = s(&call(
        &mut t,
        "owner",
        "protectRange",
        json!({
            "sheetId": sid, "topRowId": "0", "leftColId": "0", "bottomRowId": "1", "rightColId": "1",
            "description": "Totals", "editors": ["cy"],
        }),
    ));
    let (c, f) = fails(set(&mut t, "bob", &sid, "1", "1", "x"));
    assert_eq!(c, "Forbidden");
    assert_eq!(
        f["message"],
        json!("B2 is in a protected range (\"Totals\")")
    );
    let _ = set(&mut t, "cy", &sid, "1", "1", "x").unwrap();
    let _ = set(&mut t, "owner", &sid, "1", "1", "y").unwrap();
    let _ = set(&mut t, "bob", &sid, "2", "2", "ok").unwrap();
    assert_eq!(
        code(t.as_("bob").call(
            "applyAxisOps",
            json!({ "sheetId": sid, "ops": [{ "name": "DeleteRow", "payload": { "id": "0" } }] })
        )),
        "Forbidden"
    );
    // An inserted row above moves the range with its cells.
    let _ = call(
        &mut t,
        "owner",
        "applyAxisOps",
        json!({ "sheetId": sid, "ops": [{ "name": "InsertRow", "payload": { "id": "top", "pos": "0" } }] }),
    );
    let _ = set(&mut t, "bob", &sid, "top", "0", "free").unwrap();
    assert_eq!(code(set(&mut t, "bob", &sid, "0", "0", "x")), "Forbidden");
    assert_eq!(
        code(t.as_("bob").call("protectRange", json!({
            "sheetId": sid, "topRowId": "", "leftColId": "", "bottomRowId": "", "rightColId": "",
            "description": "", "editors": [],
        }))),
        "Forbidden"
    );
    let _ = call(
        &mut t,
        "owner",
        "updateProtection",
        json!({ "id": id, "description": "Totals", "editors": ["bob"] }),
    );
    let _ = set(&mut t, "bob", &sid, "0", "0", "now ok").unwrap();
    let list = view(&mut t, "bob", "getProtections", json!({}));
    assert_eq!(list[0]["editors"], json!(["bob"]));
    assert_eq!(list[0]["created_by"], json!("owner"));
    let _ = call(&mut t, "owner", "removeProtection", json!({ "id": id }));
    assert_eq!(view(&mut t, "bob", "getProtections", json!({})), json!([]));
    assert_eq!(
        code(t.as_("owner").call("removeProtection", json!({ "id": id }))),
        "NotFound"
    );
}

#[test]
fn a_protected_sheet_cannot_be_renamed_or_deleted_by_others() {
    let mut t = app();
    let sid = workbook(&mut t);
    let _ = call(
        &mut t,
        "owner",
        "protectRange",
        json!({
            "sheetId": sid, "topRowId": "", "leftColId": "", "bottomRowId": "", "rightColId": "",
            "description": "", "editors": [],
        }),
    );
    assert_eq!(
        code(
            t.as_("bob")
                .call("renameSheet", json!({ "sheetId": sid, "newName": "X" }))
        ),
        "Forbidden"
    );
    assert_eq!(
        code(t.as_("bob").call("deleteSheet", json!({ "sheetId": sid }))),
        "Forbidden"
    );
    assert_eq!(
        code(set(&mut t, "bob", &sid, "500", "20", "x")),
        "Forbidden"
    );
    let _ = call(
        &mut t,
        "owner",
        "renameSheet",
        json!({ "sheetId": sid, "newName": "X" }),
    );
}

// ── private sheets ──────────────────────────────────────────────────────────

#[test]
fn a_private_sheet_is_its_owners_alone() {
    let mut t = app();
    let _ = workbook(&mut t);
    let pid = s(&call(
        &mut t,
        "bob",
        "createPrivateSheet",
        json!({ "name": "Scratch" }),
    ));
    let _ = call(
        &mut t,
        "bob",
        "applyPrivateCellOps",
        json!({ "sheetId": pid, "ops": [
            { "name": "Set", "payload": { "row_id": "0", "col_id": "0", "raw_value": "=1+1" } },
            { "name": "Format", "payload": { "row_id": "0", "col_id": "0", "format": "number" } },
        ] }),
    );
    let mine = view(&mut t, "bob", "getPrivateCells", json!({}));
    assert_eq!(mine[0]["raw_value"], json!("=1+1"));
    assert_eq!(mine[0]["format"], json!("number"));
    assert_eq!(
        view(&mut t, "bob", "getPrivateSheets", json!({}))[0]["name"],
        json!("Scratch")
    );
    assert_eq!(view(&mut t, "cy", "getPrivateSheets", json!({})), json!([]));
    assert_eq!(view(&mut t, "cy", "getPrivateCells", json!({})), json!([]));
    assert_eq!(
        code(
            t.as_("cy")
                .call("renamePrivateSheet", json!({ "sheetId": pid, "name": "x" }))
        ),
        "NotFound"
    );
    assert_eq!(
        code(t.as_("bob").call(
            "applyPrivateCellOps",
            json!({ "sheetId": pid, "ops": [
            { "name": "Set", "payload": { "row_id": "ab", "col_id": "0", "raw_value": "1" } },
        ] })
        )),
        "Invalid"
    );
    let _ = call(
        &mut t,
        "bob",
        "renamePrivateSheet",
        json!({ "sheetId": pid, "name": "Mine" }),
    );
    let _ = call(
        &mut t,
        "bob",
        "deletePrivateSheet",
        json!({ "sheetId": pid }),
    );
    assert_eq!(
        view(&mut t, "bob", "getPrivateSheets", json!({})),
        json!([])
    );
    assert_eq!(view(&mut t, "bob", "getPrivateCells", json!({})), json!([]));
    // A viewer has private sheets too, and nothing private is in the shared log.
    assert!(t
        .events_for("cy")
        .iter()
        .all(|(_, d)| !d.to_string().contains("Scratch")));
}

// ── view: sizes, frozen panes; styles, rules, charts ────────────────────────

#[test]
fn sizes_and_frozen_panes_are_kept_per_sheet() {
    let mut t = app();
    let sid = workbook(&mut t);
    let _ = call(
        &mut t,
        "bob",
        "setSizes",
        json!({ "sheetId": sid, "sizes": [{ "axis": "row", "id": "0", "size": 40 }, { "axis": "col", "id": "1", "size": 200 }] }),
    );
    let _ = call(
        &mut t,
        "bob",
        "setFrozen",
        json!({ "sheetId": sid, "rows": 1, "cols": 2 }),
    );
    let views = view(&mut t, "cy", "getSheetViews", json!({}));
    assert_eq!(views[0]["frozen_rows"], json!(1));
    assert_eq!(views[0]["frozen_cols"], json!(2));
    assert_eq!(views[0]["sizes"].as_array().unwrap().len(), 2);
    for args in [
        json!({ "sheetId": sid, "sizes": [{ "axis": "row", "id": "0", "size": 2 }] }),
        json!({ "sheetId": sid, "sizes": [{ "axis": "z", "id": "0", "size": 40 }] }),
    ] {
        assert_eq!(code(t.as_("bob").call("setSizes", args)), "Invalid");
    }
    assert_eq!(
        code(t.as_("bob").call(
            "setFrozen",
            json!({ "sheetId": sid, "rows": 21, "cols": 0 })
        )),
        "Invalid"
    );
}

#[test]
fn styles_are_set_and_cleared_per_field() {
    let mut t = app();
    let sid = workbook(&mut t);
    let op = |field: &str, value: &str| json!({ "row_id": "0", "col_id": "0", "field": field, "value": value });
    let _ = call(
        &mut t,
        "bob",
        "applyStyleOps",
        json!({ "sheetId": sid, "ops": [op("bold", "1")] }),
    );
    let _ = call(
        &mut t,
        "cy",
        "applyStyleOps",
        json!({ "sheetId": sid, "ops": [op("fill", "#ff0000")] }),
    );
    assert_eq!(
        view(&mut t, "owner", "getStyles", json!({})),
        json!([{ "sheet_id": sid, "row_id": "0", "col_id": "0", "style": { "bold": "1", "fill": "#ff0000" } }])
    );
    let _ = call(
        &mut t,
        "bob",
        "applyStyleOps",
        json!({ "sheetId": sid, "ops": [op("bold", ""), op("fill", "")] }),
    );
    assert_eq!(view(&mut t, "owner", "getStyles", json!({})), json!([]));
    for bad in [op("font", "x"), op("bold", "yes"), op("color", "red")] {
        assert_eq!(
            code(
                t.as_("bob")
                    .call("applyStyleOps", json!({ "sheetId": sid, "ops": [bad] }))
            ),
            "Invalid"
        );
    }
}

fn rule(sid: &str, kind: &str, condition: &str, args: &[&str], strict: bool) -> Value {
    json!({
        "sheet_id": sid, "top_row_id": "0", "left_col_id": "0", "bottom_row_id": "9", "right_col_id": "0",
        "kind": kind, "condition": condition, "args": args,
        "style": if kind == "format" { json!({ "fill": "#00ff00" }) } else { json!({}) },
        "strict": strict, "recipients": [],
    })
}

#[test]
fn a_strict_validation_refuses_bad_values_and_a_loose_one_does_not() {
    let mut t = app();
    let sid = workbook(&mut t);
    let id = s(&call(
        &mut t,
        "bob",
        "addRule",
        json!({ "rule": rule(&sid, "validate", "gt", &["0"], true) }),
    ));
    let (c, f) = fails(set(&mut t, "bob", &sid, "1", "0", "-5"));
    assert_eq!(c, "Invalid");
    assert!(
        f["message"].as_str().unwrap().starts_with("A2 must be"),
        "{f}"
    );
    let _ = set(&mut t, "bob", &sid, "1", "0", "5").unwrap();
    let _ = set(&mut t, "bob", &sid, "1", "0", "=0-5").unwrap();
    let _ = set(&mut t, "bob", &sid, "1", "1", "-5").unwrap();
    let _ = call(
        &mut t,
        "bob",
        "updateRule",
        json!({ "id": id, "rule": rule(&sid, "validate", "gt", &["0"], false) }),
    );
    let _ = set(&mut t, "bob", &sid, "1", "0", "-5").unwrap();
    let rules = view(&mut t, "cy", "getRules", json!({}));
    assert_eq!(rules[0]["rule"]["strict"], json!(false));
    assert_eq!(rules[0]["created_by"], json!("bob"));
    let _ = call(&mut t, "bob", "removeRule", json!({ "id": id }));
    assert_eq!(view(&mut t, "cy", "getRules", json!({})), json!([]));
    assert_eq!(
        code(t.as_("bob").call("removeRule", json!({ "id": id }))),
        "NotFound"
    );
}

#[test]
fn rules_are_checked_when_made() {
    let mut t = app();
    let sid = workbook(&mut t);
    let mut no_style = rule(&sid, "format", "gt", &["1"], false);
    no_style["style"] = json!({});
    let mut no_one = rule(&sid, "alert", "gt", &["1"], false);
    no_one["recipients"] = json!([]);
    let mut stranger = rule(&sid, "alert", "gt", &["1"], false);
    stranger["recipients"] = json!(["zed"]);
    for (bad, want) in [
        (rule(&sid, "format", "gt", &[], false), "Invalid"),
        (no_style, "Invalid"),
        (rule(&sid, "scale", "", &["#000000"], false), "Invalid"),
        (rule(&sid, "nope", "gt", &["1"], false), "Invalid"),
        (no_one, "Invalid"),
        (stranger, "NotFound"),
        (rule("nosheet", "validate", "gt", &["1"], false), "NotFound"),
    ] {
        assert_eq!(
            code(t.as_("bob").call("addRule", json!({ "rule": bad }))),
            want
        );
    }
    let _ = call(
        &mut t,
        "bob",
        "addRule",
        json!({ "rule": rule(&sid, "scale", "", &["#000000", "#ffffff"], false) }),
    );
}

#[test]
fn an_alert_tells_its_recipients_when_a_value_starts_meeting_it() {
    let mut t = app();
    let sid = workbook(&mut t);
    join(&mut t, "cy", "Cy");
    let mut alert = rule(&sid, "alert", "gt", &["100"], false);
    alert["recipients"] = json!(["cy"]);
    let rid = s(&call(&mut t, "bob", "addRule", json!({ "rule": alert })));
    let alerts = |t: &TestApp| -> Vec<Value> {
        t.events_for("cy")
            .into_iter()
            .filter(|(n, _)| n == "AlertTriggered")
            .map(|(_, d)| d)
            .collect()
    };
    let _ = set(&mut t, "bob", &sid, "1", "0", "50").unwrap();
    assert!(alerts(&t).is_empty());
    let _ = set(&mut t, "bob", &sid, "1", "0", "150").unwrap();
    let got = alerts(&t);
    assert_eq!(got.len(), 1);
    assert_eq!(got[0]["ruleId"], json!(rid));
    assert_eq!(got[0]["recipients"], json!(["cy"]));
    assert!(got[0]["message"].as_str().unwrap().starts_with("A2 is now"));
    // Still meeting it: no second alert. Dropping out and back in: a new one.
    let _ = set(&mut t, "bob", &sid, "1", "0", "151").unwrap();
    assert_eq!(alerts(&t).len(), 1);
    let _ = set(&mut t, "bob", &sid, "1", "0", "1").unwrap();
    let _ = set(&mut t, "bob", &sid, "1", "0", "200").unwrap();
    assert_eq!(alerts(&t).len(), 2);
}

#[test]
fn charts_are_added_changed_and_removed() {
    let mut t = app();
    let sid = workbook(&mut t);
    let chart = |kind: &str, title: &str| {
        json!({
            "sheet_id": sid, "top_row_id": "0", "left_col_id": "0", "bottom_row_id": "3", "right_col_id": "1",
            "kind": kind, "title": title,
        })
    };
    let id = s(&call(
        &mut t,
        "bob",
        "addChart",
        json!({ "chart": chart("bar", " Sales ") }),
    ));
    let _ = call(
        &mut t,
        "cy",
        "updateChart",
        json!({ "id": id, "chart": chart("line", "Sales") }),
    );
    let charts = view(&mut t, "owner", "getCharts", json!({}));
    assert_eq!(charts[0]["chart"]["kind"], json!("line"));
    assert_eq!(charts[0]["chart"]["title"], json!("Sales"));
    assert_eq!(charts[0]["created_by"], json!("cy"));
    assert_eq!(
        code(
            t.as_("bob")
                .call("addChart", json!({ "chart": chart("pie", "") }))
        ),
        "Invalid"
    );
    let _ = call(&mut t, "bob", "removeChart", json!({ "id": id }));
    assert_eq!(view(&mut t, "owner", "getCharts", json!({})), json!([]));
    assert_eq!(
        code(t.as_("bob").call("removeChart", json!({ "id": id }))),
        "NotFound"
    );
}

// ── attachments ─────────────────────────────────────────────────────────────

#[test]
fn attachments_are_recorded_and_removed_by_their_author_or_an_owner() {
    let mut t = app();
    let sid = workbook(&mut t);
    let add = |blob: &str, size: &str| {
        json!({
            "sheetId": sid, "rowId": "0", "colId": "0", "blobId": blob, "name": " report.pdf ",
            "size": size, "mime": "application/pdf",
        })
    };
    let id = s(&call(&mut t, "bob", "addAttachment", add("blob1", "1024")));
    let list = view(&mut t, "cy", "getAttachments", json!({}));
    assert_eq!(list[0]["name"], json!("report.pdf"));
    assert_eq!(list[0]["size"], json!("1024"));
    assert_eq!(list[0]["created_by"], json!("bob"));
    assert_eq!(
        code(t.as_("bob").call("addAttachment", add("bad id!", "1"))),
        "Invalid"
    );
    assert_eq!(
        code(t.as_("bob").call(
            "addAttachment",
            add("blob2", &(50u64 * 1024 * 1024 + 1).to_string())
        )),
        "Invalid"
    );
    assert_eq!(
        code(t.as_("cy").call("removeAttachment", json!({ "id": id }))),
        "Forbidden"
    );
    let _ = call(&mut t, "owner", "removeAttachment", json!({ "id": id }));
    assert_eq!(view(&mut t, "cy", "getAttachments", json!({})), json!([]));
    assert_eq!(
        code(t.as_("bob").call("removeAttachment", json!({ "id": id }))),
        "NotFound"
    );
}

// ── linked workbooks ────────────────────────────────────────────────────────

#[test]
fn a_link_is_published_read_for_delivery_and_stopped_by_its_author_or_an_owner() {
    let mut t = app();
    let sid = workbook(&mut t);
    let _ = set(&mut t, "bob", &sid, "0", "0", "Rate").unwrap();
    let _ = set(&mut t, "bob", &sid, "0", "1", "=1+0.5").unwrap();
    let publish = |target: &str| {
        json!({
            "sheetId": sid, "topRowId": "0", "leftColId": "0", "bottomRowId": "0", "rightColId": "1",
            "targetContext": target, "name": "Rates",
        })
    };
    let id = s(&call(&mut t, "bob", "publishRange", publish("other-app")));
    let push = view(&mut t, "cy", "pushPublication", json!({ "id": id }));
    assert_eq!(
        push,
        json!({
            "publication_id": id, "target_context": "other-app", "name": "Rates", "source_name": "P",
            "rows": 1, "cols": 2, "values": ["Rate", "1.5"],
        })
    );
    assert_eq!(
        view(&mut t, "cy", "getPublications", json!({}))[0]["created_by"],
        json!("bob")
    );
    assert_eq!(
        code(t.as_("bob").call("publishRange", publish("bad id"))),
        "Invalid"
    );
    assert_eq!(
        code(t.as_("cy").call("unpublish", json!({ "id": id }))),
        "Forbidden"
    );
    // A maker who may no longer edit: their link is no longer listed or pushed.
    join(&mut t, "bob", "Bob");
    let _ = call(
        &mut t,
        "owner",
        "setRole",
        json!({ "memberId": "bob", "role": "viewer" }),
    );
    assert_eq!(view(&mut t, "cy", "getPublications", json!({})), json!([]));
    assert_eq!(
        code(t.as_("cy").view("pushPublication", json!({ "id": id }))),
        "NotFound"
    );
    let _ = call(
        &mut t,
        "owner",
        "setRole",
        json!({ "memberId": "bob", "role": "editor" }),
    );
    let _ = call(&mut t, "owner", "unpublish", json!({ "id": id }));
    assert_eq!(view(&mut t, "cy", "getPublications", json!({})), json!([]));
}

#[test]
fn a_received_link_is_a_read_only_sheet_formulas_can_use() {
    let mut t = app();
    let sid = workbook(&mut t);
    let deliver = |values: Value, rows: u32, cols: u32| {
        json!({
            "fromContext": "finance-app", "publicationId": "pub-1", "name": "Rates", "sourceName": "Finance",
            "rows": rows, "cols": cols, "values": values,
        })
    };
    let _ = call(
        &mut t,
        "bob",
        "receiveLink",
        deliver(json!(["Rate", "=1.5"]), 1, 2),
    );
    let sheets = view(&mut t, "cy", "listSheets", json!({}));
    let linked = sheets
        .as_array()
        .unwrap()
        .iter()
        .find(|x| x["name"] == json!("Rates"))
        .unwrap()
        .clone();
    assert_eq!(linked["linked_from"], json!("Finance"));
    let lid = s(&linked["id"]);
    assert_eq!(lid, "link-financeapp-pub-1");
    assert_eq!(cells(&mut t, &lid).len(), 2);
    let _ = set(&mut t, "bob", &sid, "0", "0", &format!("=[{lid}]!B1*4")).unwrap();
    assert_eq!(computed(&mut t, &sid, "0", "0"), "6");
    assert_eq!(code(set(&mut t, "bob", &lid, "0", "0", "x")), "NotFound");
    assert_eq!(
        view(&mut t, "cy", "getLinks", json!({}))[0]["rows"],
        json!(1)
    );
    assert_eq!(
        code(
            t.as_("bob")
                .call("receiveLink", deliver(json!(["x"]), 1, 2))
        ),
        "Invalid"
    );
    // Removed here, it stays removed however often it is pushed.
    let _ = call(&mut t, "bob", "unlink", json!({ "id": lid }));
    let _ = call(&mut t, "bob", "receiveLink", deliver(json!(["9"]), 1, 1));
    assert_eq!(view(&mut t, "cy", "getLinks", json!({})), json!([]));
    // Withdrawn by the source.
    let mut other = deliver(json!(["1"]), 1, 1);
    other["publicationId"] = json!("pub-2");
    let _ = call(&mut t, "bob", "receiveLink", other);
    let _ = call(
        &mut t,
        "bob",
        "dropLink",
        json!({ "fromContext": "finance-app", "publicationId": "pub-2" }),
    );
    assert_eq!(view(&mut t, "cy", "getLinks", json!({})), json!([]));
    // A viewer cannot relay a link in.
    join(&mut t, "cy", "Cy");
    let _ = call(
        &mut t,
        "owner",
        "setRole",
        json!({ "memberId": "cy", "role": "viewer" }),
    );
    assert_eq!(
        code(t.as_("cy").call("receiveLink", deliver(json!(["1"]), 1, 1))),
        "Forbidden"
    );
}

// ── functions ───────────────────────────────────────────────────────────────

#[test]
fn functions_are_listed_and_searched_by_prefix() {
    let mut t = app();
    let all = view(&mut t, "gus", "getFunctions", json!({}));
    assert!(all.as_array().unwrap().len() > 10);
    let sums = view(&mut t, "gus", "searchFunctions", json!({ "prefix": "su" }));
    assert!(sums
        .as_array()
        .unwrap()
        .iter()
        .all(|f| s(&f["name"]).starts_with("SU")));
    assert!(sums
        .as_array()
        .unwrap()
        .iter()
        .any(|f| f["name"] == json!("SUM")));
}

// ── one log: what v1's merge tests become ───────────────────────────────────

#[test]
fn every_members_write_survives_and_one_cell_holds_the_later_one() {
    let mut t = app();
    let sid = workbook(&mut t);
    let _ = set(&mut t, "bob", &sid, "0", "0", "bob's").unwrap();
    let _ = set(&mut t, "cy", &sid, "0", "1", "cy's").unwrap();
    let _ = set(&mut t, "bob", &sid, "1", "0", "first").unwrap();
    let _ = set(&mut t, "cy", &sid, "1", "0", "second").unwrap();
    let _ = call(
        &mut t,
        "owner",
        "setCellFormat",
        json!({ "sheetId": sid, "rowId": "0", "colId": "0", "format": "percent" }),
    );
    let all = cells(&mut t, &sid);
    assert_eq!(all.len(), 3);
    assert_eq!(computed(&mut t, &sid, "1", "0"), "second");
    let a1 = all
        .iter()
        .find(|c| c["id"] == json!(format!("{sid}|0|0")))
        .unwrap();
    assert_eq!(
        (a1["raw_value"].clone(), a1["format"].clone()),
        (json!("bob's"), json!("percent"))
    );
    assert_eq!(a1["last_editor"], json!("owner"));
}

// ── access and the wire ─────────────────────────────────────────────────────

#[test]
fn outsiders_and_anonymous_callers_are_refused_before_the_app_runs() {
    let mut t = app();
    let _ = workbook(&mut t);
    match t.anonymous().view("listSheets", json!({})) {
        Err(Failure::Refused { status: 401, .. }) => {}
        other => panic!("anonymous: {other:?}"),
    }
    match t.as_("zed").view("listSheets", json!({})) {
        Err(Failure::Refused { status: 404, .. }) => {}
        other => panic!("outsider: {other:?}"),
    }
}

#[test]
fn a_guest_reads_and_edits_as_v1_let_every_context_member() {
    let mut t = app();
    let sid = workbook(&mut t);
    let _ = set(&mut t, "gus", &sid, "0", "0", "guest").unwrap();
    assert_eq!(computed(&mut t, &sid, "0", "0"), "guest");
}

#[test]
fn wire_checks_unknown_methods_bad_args_and_views() {
    let mut t = app();
    let sid = workbook(&mut t);
    assert_eq!(code(t.as_("bob").call("nope", json!({}))), "UnknownMethod");
    // v1's snake_case names are refused.
    assert_eq!(
        code(t.as_("bob").view("list_sheets", json!({}))),
        "UnknownMethod"
    );
    assert_eq!(
        code(t.as_("bob").call(
            "setCell",
            json!({ "sheet_id": sid, "row_id": "0", "col_id": "0", "raw_value": "1" })
        )),
        "BadArgs"
    );
    assert_eq!(
        code(
            t.as_("bob")
                .view("getActivity", json!({ "since": 0, "limit": 1 }))
        ),
        "BadArgs"
    );
    assert_eq!(
        code(t.as_("bob").view(
            "setCell",
            json!({ "sheetId": sid, "rowId": "0", "colId": "0", "rawValue": "1" })
        )),
        "NotAView"
    );
}
