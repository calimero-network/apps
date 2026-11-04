//! Mero Docs on core's real wasmtime engine (`TestApp`): v1's `TestHost` tests
//! for the docs and registry services method for method, v1's merge and
//! forged-write tests as what they become under one log and method checks, and
//! the access and wire checks v1 could not express.

#![cfg(not(target_arch = "wasm32"))]

mod common;

use calimero_sdk::testing::{Failure, Org, TestApp};
use serde_json::{json, Value};

/// The owner (the folder's moderator, the registry's owner), members `bob`
/// and `cy`, and a guest, `gus`.
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

fn code(result: Result<Value, Failure>) -> String {
    match result {
        Err(Failure::App { code, .. }) => code,
        other => panic!("expected an app error, got {other:?}"),
    }
}

fn s(v: &Value) -> String {
    v.as_str().expect("a string").to_owned()
}

fn doc(t: &mut TestApp, who: &str, title: &str) -> String {
    s(&call(t, who, "createDoc", json!({ "title": title })))
}

fn title(t: &mut TestApp, doc: &str) -> String {
    s(&view(t, "owner", "getTitle", json!({ "doc": doc })))
}

fn digest(t: &mut TestApp, doc: &str) -> String {
    s(&view(t, "owner", "getStateDigest", json!({ "doc": doc })))
}

fn block(t: &mut TestApp, doc: &str, after: Option<&str>, kind: &str) -> String {
    s(&call(
        t,
        "owner",
        "insertBlock",
        json!({ "doc": doc, "after": after, "kind": kind, "depth": 0 }),
    ))
}

fn type_text(t: &mut TestApp, doc: &str, block: &str, at: u32, text: &str) -> String {
    let ops = if at == 0 {
        json!([{ "insert": text }])
    } else {
        json!([{ "retain": at }, { "insert": text }])
    };
    s(&call(
        t,
        "owner",
        "applyDelta",
        json!({ "doc": doc, "block": block, "ops": ops }),
    ))
}

fn text(t: &mut TestApp, doc: &str, block: &str) -> String {
    s(&view(
        t,
        "owner",
        "getText",
        json!({ "doc": doc, "block": block }),
    ))
}

fn spans(t: &mut TestApp, doc: &str, block: &str) -> Value {
    view(
        t,
        "owner",
        "getBlockDelta",
        json!({ "doc": doc, "block": block }),
    )
}

/// Each character's id as `replica:counter`, as the web app keys them.
fn char_ids(runs: &Value) -> Vec<String> {
    runs.as_array()
        .expect("runs")
        .iter()
        .flat_map(|r| {
            let (rep, c, n) = (
                r["replica"].as_str().unwrap().to_owned(),
                r["counter"].as_u64().unwrap(),
                r["len"].as_u64().unwrap(),
            );
            (0..n).map(move |i| format!("{rep}:{}", c + i))
        })
        .collect()
}

fn names(t: &TestApp, who: &str) -> Vec<String> {
    t.events_for(who).into_iter().map(|(n, _)| n).collect()
}

// ── title ────────────────────────────────────────────────────────────────────

#[test]
fn create_doc_seeds_the_title() {
    let mut t = app();
    let d = doc(&mut t, "owner", "Plan");
    assert_eq!(title(&mut t, &d), "Plan");
    let got = view(&mut t, "bob", "getDoc", json!({ "id": d }));
    assert_eq!(got["title"], json!("Plan"));
    assert_eq!(got["createdBy"], json!("owner"));
    assert_eq!(got["updatedBy"], json!("owner"));
    assert_eq!(got["createdAt"], json!(common::T0.to_string()));
    assert_eq!(got["archived"], json!(false));
    assert_eq!(got["tags"], json!([]));
    assert_eq!(
        t.events_for("bob"),
        [("DocCreated".to_owned(), json!({ "id": d }))]
    );
}

#[test]
fn a_title_delta_indexes_unicode_scalar_values() {
    let mut t = app();
    let d = doc(&mut t, "owner", "h\u{e9}llo");
    call(
        &mut t,
        "owner",
        "titleApplyDelta",
        json!({ "doc": d, "ops": [{ "retain": 2 }, { "insert": "-" }] }),
    );
    assert_eq!(title(&mut t, &d), "h\u{e9}-llo");
}

#[test]
fn a_zwj_sequence_is_five_addressable_scalars() {
    const FAMILY: &str = "\u{1F468}\u{200D}\u{1F469}\u{200D}\u{1F467}";
    let mut t = app();
    let d = doc(&mut t, "owner", FAMILY);
    let state = view(&mut t, "owner", "getTitleState", json!({ "doc": d }));
    assert_eq!(char_ids(&state["ids"]).len(), 5);
    call(
        &mut t,
        "owner",
        "titleApplyDelta",
        json!({ "doc": d, "ops": [{ "retain": 5 }, { "insert": "!" }] }),
    );
    assert_eq!(title(&mut t, &d), format!("{FAMILY}!"));
}

#[test]
fn title_undo_restores_the_previous_text_and_redo_reapplies_it() {
    let mut t = app();
    let d = doc(&mut t, "owner", "Draft");
    let undo = call(
        &mut t,
        "owner",
        "titleApplyDelta",
        json!({ "doc": d, "ops": [{ "delete": 2 }, { "insert": "Cr" }] }),
    );
    assert_eq!(title(&mut t, &d), "Craft");
    let redo = call(
        &mut t,
        "owner",
        "titleUndo",
        json!({ "doc": d, "token": undo }),
    );
    assert_eq!(title(&mut t, &d), "Draft");
    call(
        &mut t,
        "owner",
        "titleUndo",
        json!({ "doc": d, "token": redo }),
    );
    assert_eq!(title(&mut t, &d), "Craft");
}

#[test]
fn a_title_op_carrying_attributes_is_rejected() {
    let mut t = app();
    let d = doc(&mut t, "owner", "Plain");
    let r = t.as_("owner").call(
        "titleApplyDelta",
        json!({ "doc": d, "ops": [{ "insert": "x", "attributes": { "bold": "true" } }] }),
    );
    assert_eq!(code(r), "Invalid");
    assert_eq!(title(&mut t, &d), "Plain");
}

#[test]
fn edit_doc_replaces_the_whole_title() {
    let mut t = app();
    let d = doc(&mut t, "owner", "Old title");
    call(&mut t, "bob", "editDoc", json!({ "id": d, "title": "New" }));
    assert_eq!(title(&mut t, &d), "New");
    let got = view(&mut t, "owner", "getDoc", json!({ "id": d }));
    assert_eq!(got["updatedBy"], json!("bob"));
    assert_eq!(names(&t, "cy"), ["DocCreated", "TitleChanged", "DocEdited"]);
}

#[test]
fn a_title_longer_than_the_cap_is_refused() {
    let mut t = app();
    let long = "x".repeat(1025);
    assert_eq!(
        code(t.as_("owner").call("createDoc", json!({ "title": long }))),
        "Invalid"
    );
    let d = doc(&mut t, "owner", &"x".repeat(1024));
    let r = t.as_("owner").call(
        "titleApplyDelta",
        json!({ "doc": d, "ops": [{ "insert": "y" }] }),
    );
    assert_eq!(code(r), "Invalid");
}

#[test]
fn title_apply_delta_on_applies_onto_the_title_it_was_diffed_against() {
    let mut t = app();
    let d = doc(&mut t, "owner", "ab");
    let got = call(
        &mut t,
        "owner",
        "titleApplyDeltaOn",
        json!({ "doc": d, "base": "ab", "ops": [{ "retain": 2 }, { "insert": "c" }], "anchor": null }),
    );
    assert_eq!(got["applied"], json!(true));
    assert_eq!(got["text"], json!("abc"));
    assert_eq!(got["anchorPos"], json!(3));
    assert!(got["token"].is_string());
    // The anchor it hands back takes the next keystroke right there.
    let next = call(
        &mut t,
        "owner",
        "titleApplyDeltaOn",
        json!({ "doc": d, "base": "abc", "ops": [{ "retain": 3 }, { "insert": "d" }], "anchor": got["anchor"] }),
    );
    assert_eq!(next["applied"], json!(true));
    assert_eq!(title(&mut t, &d), "abcd");
}

#[test]
fn title_apply_delta_on_refuses_a_stale_base_and_hands_back_the_title() {
    let mut t = app();
    let d = doc(&mut t, "owner", "ab");
    call(&mut t, "bob", "editDoc", json!({ "id": d, "title": "xy" }));
    let got = call(
        &mut t,
        "owner",
        "titleApplyDeltaOn",
        json!({ "doc": d, "base": "ab", "ops": [{ "insert": "z" }], "anchor": null }),
    );
    assert_eq!(got["applied"], json!(false));
    assert_eq!(got["token"], Value::Null);
    assert_eq!(got["text"], json!("xy"));
    assert_eq!(char_ids(&got["ids"]).len(), 2);
    assert_eq!(title(&mut t, &d), "xy");
}

#[test]
fn an_anchored_write_away_from_its_anchor_is_refused_even_on_the_current_text() {
    let mut t = app();
    let d = doc(&mut t, "owner", "abcd");
    let anchor = view(
        &mut t,
        "owner",
        "titleAnchorAt",
        json!({ "doc": d, "position": 2, "before": false }),
    );
    let got = call(
        &mut t,
        "owner",
        "titleApplyDeltaOn",
        json!({ "doc": d, "base": "abcd", "ops": [{ "retain": 3 }, { "insert": "x" }], "anchor": anchor }),
    );
    assert_eq!(got["applied"], json!(false));
    assert_eq!(got["anchorPos"], json!(2));
    let not_insert = call(
        &mut t,
        "owner",
        "titleApplyDeltaOn",
        json!({ "doc": d, "base": "abcd", "ops": [{ "retain": 2 }, { "delete": 1 }], "anchor": anchor }),
    );
    assert_eq!(not_insert["applied"], json!(false));
}

#[test]
fn a_title_anchor_follows_its_letter_through_a_peers_edit() {
    let mut t = app();
    let d = doc(&mut t, "owner", "world");
    let anchors = json!([
        view(
            &mut t,
            "owner",
            "titleAnchorAt",
            json!({ "doc": d, "position": 1, "before": false })
        ),
        view(
            &mut t,
            "owner",
            "titleAnchorAt",
            json!({ "doc": d, "position": 5, "before": true })
        ),
        view(
            &mut t,
            "owner",
            "titleAnchorAt",
            json!({ "doc": d, "position": 0, "before": false })
        ),
    ]);
    call(
        &mut t,
        "bob",
        "titleApplyDelta",
        json!({ "doc": d, "ops": [{ "insert": "hello " }] }),
    );
    let at = view(
        &mut t,
        "owner",
        "titleResolve",
        json!({ "doc": d, "anchors": anchors }),
    );
    assert_eq!(at, json!([7, 11, 0]));
    let unknown = view(
        &mut t,
        "owner",
        "titleResolve",
        json!({ "doc": d, "anchors": ["a999999", "nonsense"] }),
    );
    assert_eq!(unknown, json!([null, null]));
}

#[test]
fn a_title_read_names_every_character_by_an_id_a_peer_insert_leaves_alone() {
    let mut t = app();
    let d = doc(&mut t, "owner", "ac");
    let before = char_ids(&view(&mut t, "owner", "getTitleState", json!({ "doc": d }))["ids"]);
    call(
        &mut t,
        "bob",
        "titleApplyDelta",
        json!({ "doc": d, "ops": [{ "retain": 1 }, { "insert": "b" }] }),
    );
    let after = char_ids(&view(&mut t, "owner", "getTitleState", json!({ "doc": d }))["ids"]);
    assert_eq!(after.len(), 3);
    assert_eq!(after[0], before[0]);
    assert_eq!(after[2], before[1]);
}

// ── body ─────────────────────────────────────────────────────────────────────

#[test]
fn apply_delta_renders_into_the_digest() {
    let mut t = app();
    let d = doc(&mut t, "owner", "Doc");
    let b = block(&mut t, &d, None, "paragraph");
    type_text(&mut t, &d, &b, 0, "Hello");
    assert_eq!(digest(&mut t, &d), "paragraph/0{:Hello};");
}

#[test]
fn block_text_over_the_cap_is_refused() {
    let mut t = app();
    let d = doc(&mut t, "owner", "Doc");
    let b = block(&mut t, &d, None, "paragraph");
    let r = t.as_("owner").call(
        "applyDelta",
        json!({ "doc": d, "block": b, "ops": [{ "insert": "x".repeat(100_001) }] }),
    );
    assert_eq!(code(r), "Invalid");
    assert_eq!(text(&mut t, &d, &b), "");
}

#[test]
fn insert_attributes_are_the_inserted_texts_whole_formatting() {
    let mut t = app();
    let d = doc(&mut t, "owner", "Doc");
    let b = block(&mut t, &d, None, "paragraph");
    call(
        &mut t,
        "owner",
        "applyDelta",
        json!({ "doc": d, "block": b, "ops": [
            { "insert": "bold", "attributes": { "bold": "true" } },
            { "insert": " plain", "attributes": {} }
        ] }),
    );
    assert_eq!(
        spans(&mut t, &d, &b),
        json!([
            { "text": "bold", "attributes": { "bold": "true" } },
            { "text": " plain", "attributes": {} }
        ])
    );
    // Typed at the end of the bold run with an empty set: not bold.
    call(
        &mut t,
        "owner",
        "applyDelta",
        json!({ "doc": d, "block": b, "ops": [{ "retain": 4 }, { "insert": "!", "attributes": {} }] }),
    );
    assert_eq!(text(&mut t, &d, &b), "bold! plain");
    assert_eq!(
        spans(&mut t, &d, &b)[1],
        json!({ "text": "! plain", "attributes": {} })
    );
}

#[test]
fn a_retain_with_attributes_formats_and_undo_takes_it_back() {
    let mut t = app();
    let d = doc(&mut t, "owner", "Doc");
    let b = block(&mut t, &d, None, "paragraph");
    type_text(&mut t, &d, &b, 0, "Hello world");
    let before = digest(&mut t, &d);
    let undo = call(
        &mut t,
        "owner",
        "applyDelta",
        json!({ "doc": d, "block": b, "ops": [{ "retain": 6 }, { "retain": 5, "attributes": { "link": "https://x.y" } }] }),
    );
    assert_eq!(
        spans(&mut t, &d, &b),
        json!([
            { "text": "Hello ", "attributes": {} },
            { "text": "world", "attributes": { "link": "https://x.y" } }
        ])
    );
    let redo = call(
        &mut t,
        "owner",
        "undo",
        json!({ "doc": d, "block": b, "token": undo }),
    );
    assert_eq!(digest(&mut t, &d), before);
    call(
        &mut t,
        "owner",
        "undo",
        json!({ "doc": d, "block": b, "token": redo }),
    );
    assert_eq!(
        spans(&mut t, &d, &b)[1]["attributes"],
        json!({ "link": "https://x.y" })
    );
}

#[test]
fn undo_puts_deleted_formatted_text_back_where_it_was() {
    let mut t = app();
    let d = doc(&mut t, "owner", "Doc");
    let b = block(&mut t, &d, None, "paragraph");
    call(
        &mut t,
        "owner",
        "applyDelta",
        json!({ "doc": d, "block": b, "ops": [
            { "insert": "one ", "attributes": {} },
            { "insert": "two", "attributes": { "italic": "true" } },
            { "insert": " three", "attributes": {} }
        ] }),
    );
    let before = digest(&mut t, &d);
    let undo = call(
        &mut t,
        "owner",
        "applyDelta",
        json!({ "doc": d, "block": b, "ops": [{ "retain": 2 }, { "delete": 6 }] }),
    );
    assert_eq!(text(&mut t, &d, &b), "onthree");
    // A peer types meanwhile; the undo still lands where the text was.
    type_text(&mut t, &d, &b, 7, "!");
    let redo = call(
        &mut t,
        "owner",
        "undo",
        json!({ "doc": d, "block": b, "token": undo }),
    );
    assert_eq!(text(&mut t, &d, &b), "one two three!");
    call(
        &mut t,
        "owner",
        "applyDelta",
        json!({ "doc": d, "block": b, "ops": [{ "retain": 13 }, { "delete": 1 }] }),
    );
    assert_eq!(digest(&mut t, &d), before);
    call(
        &mut t,
        "owner",
        "undo",
        json!({ "doc": d, "block": b, "token": redo }),
    );
    assert_eq!(text(&mut t, &d, &b), "onthree");
}

#[test]
fn an_undeclared_mark_key_is_refused() {
    let mut t = app();
    let d = doc(&mut t, "owner", "Doc");
    let b = block(&mut t, &d, None, "paragraph");
    let r = t.as_("owner").call(
        "applyDelta",
        json!({ "doc": d, "block": b, "ops": [{ "insert": "x", "attributes": { "font": "serif" } }] }),
    );
    assert_eq!(code(r), "Invalid");
    let r = t.as_("owner").call(
        "mark",
        json!({ "doc": d, "block": b, "start": 0, "end": 0, "key": "font", "value": "x" }),
    );
    assert_eq!(code(r), "Invalid");
}

#[test]
fn a_retain_past_the_end_is_refused() {
    let mut t = app();
    let d = doc(&mut t, "owner", "Doc");
    let b = block(&mut t, &d, None, "paragraph");
    type_text(&mut t, &d, &b, 0, "abc");
    let r = t.as_("owner").call(
        "applyDelta",
        json!({ "doc": d, "block": b, "ops": [{ "retain": 4 }, { "insert": "x" }] }),
    );
    assert_eq!(code(r), "Invalid");
    assert_eq!(text(&mut t, &d, &b), "abc");
}

#[test]
fn apply_delta_on_applies_onto_the_text_it_was_diffed_against() {
    let mut t = app();
    let d = doc(&mut t, "owner", "Doc");
    let b = block(&mut t, &d, None, "paragraph");
    type_text(&mut t, &d, &b, 0, "ab");
    let got = call(
        &mut t,
        "owner",
        "applyDeltaOn",
        json!({ "doc": d, "block": b, "base": "ab", "ops": [{ "retain": 1 }, { "insert": "x", "attributes": {} }], "anchor": null }),
    );
    assert_eq!(got["applied"], json!(true));
    assert_eq!(got["spans"], json!([{ "text": "axb", "attributes": {} }]));
    assert_eq!(got["anchorPos"], json!(2));
    assert_eq!(char_ids(&got["ids"]).len(), 3);
}

#[test]
fn apply_delta_on_refuses_a_stale_base_and_hands_back_the_current_text() {
    let mut t = app();
    let d = doc(&mut t, "owner", "Doc");
    let b = block(&mut t, &d, None, "paragraph");
    type_text(&mut t, &d, &b, 0, "ab");
    let got = call(
        &mut t,
        "owner",
        "applyDeltaOn",
        json!({ "doc": d, "block": b, "base": "a", "ops": [{ "insert": "x" }], "anchor": null }),
    );
    assert_eq!(got["applied"], json!(false));
    assert_eq!(got["spans"], json!([{ "text": "ab", "attributes": {} }]));
    assert_eq!(text(&mut t, &d, &b), "ab");
}

#[test]
fn a_block_read_names_every_character_by_an_id_a_peer_insert_leaves_alone() {
    let mut t = app();
    let d = doc(&mut t, "owner", "Doc");
    let b = block(&mut t, &d, None, "paragraph");
    type_text(&mut t, &d, &b, 0, "ac");
    let get = |t: &mut TestApp| {
        let doc = view(t, "owner", "getDocument", json!({ "doc": d }));
        char_ids(&doc[0]["ids"])
    };
    let before = get(&mut t);
    call(
        &mut t,
        "bob",
        "applyDelta",
        json!({ "doc": d, "block": b, "ops": [{ "retain": 1 }, { "insert": "b" }] }),
    );
    let after = get(&mut t);
    assert_eq!(after.len(), 3);
    assert_eq!(
        (after[0].clone(), after[2].clone()),
        (before[0].clone(), before[1].clone())
    );
}

#[test]
fn an_anchor_survives_an_edit_before_it() {
    let mut t = app();
    let d = doc(&mut t, "owner", "Doc");
    let b = block(&mut t, &d, None, "paragraph");
    type_text(&mut t, &d, &b, 0, "world");
    let a = view(
        &mut t,
        "owner",
        "anchorAt",
        json!({ "doc": d, "block": b, "position": 3, "before": true }),
    );
    type_text(&mut t, &d, &b, 0, "hello ");
    let at = view(
        &mut t,
        "owner",
        "resolveIds",
        json!({ "doc": d, "block": b, "anchors": [a] }),
    );
    assert_eq!(at, json!([9]));
}

#[test]
fn mark_renders_as_two_spans_over_the_marked_range() {
    let mut t = app();
    let d = doc(&mut t, "owner", "Doc");
    let b = block(&mut t, &d, None, "paragraph");
    type_text(&mut t, &d, &b, 0, "Hello world");
    let id = call(
        &mut t,
        "owner",
        "mark",
        json!({ "doc": d, "block": b, "start": 0, "end": 5, "key": "bold", "value": "true" }),
    );
    assert!(id.is_string());
    assert_eq!(
        spans(&mut t, &d, &b),
        json!([
            { "text": "Hello", "attributes": { "bold": "true" } },
            { "text": " world", "attributes": {} }
        ])
    );
    let empty = call(
        &mut t,
        "owner",
        "mark",
        json!({ "doc": d, "block": b, "start": 2, "end": 2, "key": "bold", "value": "true" }),
    );
    assert_eq!(empty, Value::Null);
}

#[test]
fn split_block_then_merge_blocks_round_trips_the_digest() {
    let mut t = app();
    let d = doc(&mut t, "owner", "Doc");
    let b = block(&mut t, &d, None, "heading");
    call(
        &mut t,
        "owner",
        "setAttr",
        json!({ "doc": d, "block": b, "key": "level", "value": "2" }),
    );
    call(
        &mut t,
        "owner",
        "applyDelta",
        json!({ "doc": d, "block": b, "ops": [{ "insert": "Head" , "attributes": {} }, { "insert": "tail", "attributes": { "bold": "true" } }] }),
    );
    let before = digest(&mut t, &d);
    let new = s(&call(
        &mut t,
        "owner",
        "splitBlock",
        json!({ "doc": d, "block": b, "at": 4 }),
    ));
    // The head keeps the id; the tail moves with its formatting and the block's attributes.
    assert_eq!(text(&mut t, &d, &b), "Head");
    let blocks = view(&mut t, "owner", "listBlocks", json!({ "doc": d }));
    assert_eq!(blocks, json!([b, new]));
    assert_eq!(
        digest(&mut t, &d),
        "heading/0[level=2]{:Head};heading/0[level=2]{bold=true:tail};"
    );
    call(
        &mut t,
        "owner",
        "mergeBlocks",
        json!({ "doc": d, "first": b, "second": new }),
    );
    assert_eq!(digest(&mut t, &d), before);
    assert_eq!(
        view(
            &mut t,
            "owner",
            "getBlock",
            json!({ "doc": d, "block": new })
        ),
        Value::Null
    );
    assert_eq!(
        code(
            t.as_("owner")
                .call("mergeBlocks", json!({ "doc": d, "first": b, "second": b }))
        ),
        "Invalid"
    );
}

#[test]
fn structure_writes_land_in_the_digest() {
    let mut t = app();
    let d = doc(&mut t, "owner", "Doc");
    let b = block(&mut t, &d, None, "paragraph");
    call(
        &mut t,
        "owner",
        "setKind",
        json!({ "doc": d, "block": b, "kind": "bulletListItem" }),
    );
    call(
        &mut t,
        "owner",
        "setDepth",
        json!({ "doc": d, "block": b, "depth": 2 }),
    );
    call(
        &mut t,
        "owner",
        "setAttr",
        json!({ "doc": d, "block": b, "key": "a", "value": "1" }),
    );
    assert_eq!(digest(&mut t, &d), "bulletListItem/2[a=1];");
    call(
        &mut t,
        "owner",
        "setAttr",
        json!({ "doc": d, "block": b, "key": "a", "value": null }),
    );
    assert_eq!(digest(&mut t, &d), "bulletListItem/2;");
    call(
        &mut t,
        "owner",
        "deleteBlock",
        json!({ "doc": d, "block": b }),
    );
    assert_eq!(digest(&mut t, &d), "");
}

#[test]
fn move_block_reorders_the_document() {
    let mut t = app();
    let d = doc(&mut t, "owner", "Doc");
    let a = block(&mut t, &d, None, "paragraph");
    let b = block(&mut t, &d, Some(&a), "paragraph");
    let c = block(&mut t, &d, Some(&b), "paragraph");
    assert_eq!(
        view(&mut t, "owner", "listBlocks", json!({ "doc": d })),
        json!([a, b, c])
    );
    call(
        &mut t,
        "owner",
        "moveBlock",
        json!({ "doc": d, "block": c, "after": null }),
    );
    assert_eq!(
        view(&mut t, "owner", "listBlocks", json!({ "doc": d })),
        json!([c, a, b])
    );
    call(
        &mut t,
        "owner",
        "moveBlock",
        json!({ "doc": d, "block": c, "after": b }),
    );
    assert_eq!(
        view(&mut t, "owner", "listBlocks", json!({ "doc": d })),
        json!([a, b, c])
    );
    // A block inserted after a moved-away block's old place still lands after it.
    let e = block(&mut t, &d, Some(&a), "paragraph");
    assert_eq!(
        view(&mut t, "owner", "listBlocks", json!({ "doc": d })),
        json!([a, e, b, c])
    );
}

#[test]
fn every_body_event_names_the_document_and_the_block() {
    let mut t = app();
    let d = doc(&mut t, "owner", "Doc");
    let b = block(&mut t, &d, None, "paragraph");
    type_text(&mut t, &d, &b, 0, "x");
    call(
        &mut t,
        "owner",
        "setKind",
        json!({ "doc": d, "block": b, "kind": "heading" }),
    );
    call(
        &mut t,
        "owner",
        "mark",
        json!({ "doc": d, "block": b, "start": 0, "end": 1, "key": "bold", "value": "true" }),
    );
    call(
        &mut t,
        "owner",
        "moveBlock",
        json!({ "doc": d, "block": b, "after": null }),
    );
    call(
        &mut t,
        "owner",
        "deleteBlock",
        json!({ "doc": d, "block": b }),
    );
    for (name, data) in t.events_for("bob").into_iter().skip(1) {
        assert_eq!(data["doc"], json!(d), "{name}");
        assert_eq!(data["block"], json!(b), "{name}");
    }
    assert_eq!(
        names(&t, "bob"),
        [
            "DocCreated",
            "BlockInserted",
            "TextChanged",
            "BlockChanged",
            "MarkApplied",
            "BlockMoved",
            "BlockDeleted"
        ]
    );
}

#[test]
fn a_body_write_on_an_unknown_doc_or_block_is_not_found() {
    let mut t = app();
    let r = t.as_("owner").call(
        "insertBlock",
        json!({ "doc": "doc-missing", "after": null, "kind": "paragraph", "depth": 0 }),
    );
    assert_eq!(code(r), "NotFound");
    let d = doc(&mut t, "owner", "Doc");
    let r = t.as_("owner").call(
        "applyDelta",
        json!({ "doc": d, "block": "blk-missing", "ops": [{ "insert": "x" }] }),
    );
    assert_eq!(code(r), "NotFound");
    let r = t.as_("owner").call(
        "undo",
        json!({ "doc": d, "block": "b", "token": "not json" }),
    );
    assert_eq!(code(r), "Invalid");
}

#[test]
fn passage_count_counts_occurrences() {
    let mut t = app();
    let d = doc(&mut t, "owner", "Doc");
    let b = block(&mut t, &d, None, "paragraph");
    type_text(&mut t, &d, &b, 0, "la la land");
    assert_eq!(
        view(
            &mut t,
            "owner",
            "passageCount",
            json!({ "doc": d, "block": b, "needle": "la" })
        ),
        json!(3)
    );
}

// ── documents ────────────────────────────────────────────────────────────────

#[test]
fn create_doc_assigns_a_fresh_id_each_time_and_list_docs_returns_them() {
    let mut t = app();
    let a = doc(&mut t, "owner", "A");
    let b = doc(&mut t, "bob", "A");
    assert_ne!(a, b);
    let list = view(
        &mut t,
        "cy",
        "listDocs",
        json!({ "includeArchived": false }),
    );
    let mut ids: Vec<String> = list
        .as_array()
        .unwrap()
        .iter()
        .map(|d| s(&d["id"]))
        .collect();
    ids.sort();
    let mut want = vec![a, b];
    want.sort();
    assert_eq!(ids, want);
}

#[test]
fn get_doc_missing_is_not_found() {
    let mut t = app();
    let r = t.as_("owner").view("getDoc", json!({ "id": "doc-nope" }));
    assert_eq!(code(r), "NotFound");
}

#[test]
fn archive_hides_from_the_default_list_and_unarchive_restores() {
    let mut t = app();
    let d = doc(&mut t, "owner", "A");
    t.advance(5);
    call(&mut t, "bob", "archiveDoc", json!({ "id": d }));
    let got = view(&mut t, "owner", "getDoc", json!({ "id": d }));
    assert_eq!(got["archived"], json!(true));
    assert_eq!(got["updatedBy"], json!("bob"));
    assert_eq!(got["updatedAt"], json!((common::T0 + 5).to_string()));
    assert_eq!(
        view(
            &mut t,
            "owner",
            "listDocs",
            json!({ "includeArchived": false })
        ),
        json!([])
    );
    assert_eq!(
        view(
            &mut t,
            "owner",
            "listDocs",
            json!({ "includeArchived": true })
        )
        .as_array()
        .unwrap()
        .len(),
        1
    );
    call(&mut t, "owner", "unarchiveDoc", json!({ "id": d }));
    assert_eq!(
        view(
            &mut t,
            "owner",
            "listDocs",
            json!({ "includeArchived": false })
        )
        .as_array()
        .unwrap()
        .len(),
        1
    );
    assert_eq!(
        code(t.as_("owner").call("archiveDoc", json!({ "id": "doc-x" }))),
        "NotFound"
    );
}

#[test]
fn a_body_write_advances_updated_at_and_records_the_editor() {
    let mut t = app();
    let d = doc(&mut t, "owner", "A");
    t.advance(7);
    call(
        &mut t,
        "cy",
        "insertBlock",
        json!({ "doc": d, "after": null, "kind": "paragraph", "depth": 0 }),
    );
    let got = view(&mut t, "owner", "getDoc", json!({ "id": d }));
    assert_eq!(got["updatedAt"], json!((common::T0 + 7).to_string()));
    assert_eq!(got["updatedBy"], json!("cy"));
    assert_eq!(got["createdBy"], json!("owner"));
}

#[test]
fn tags_are_a_set_sorted_and_leave_the_last_editor() {
    let mut t = app();
    let d = doc(&mut t, "owner", "A");
    for tag in ["zeta", "alpha", "zeta"] {
        call(&mut t, "bob", "addTag", json!({ "id": d, "tag": tag }));
    }
    let got = view(&mut t, "owner", "getDoc", json!({ "id": d }));
    assert_eq!(got["tags"], json!(["alpha", "zeta"]));
    assert_eq!(got["updatedBy"], json!("owner"));
    call(
        &mut t,
        "bob",
        "removeTag",
        json!({ "id": d, "tag": "alpha" }),
    );
    call(
        &mut t,
        "bob",
        "removeTag",
        json!({ "id": d, "tag": "never-added" }),
    );
    let got = view(&mut t, "owner", "getDoc", json!({ "id": d }));
    assert_eq!(got["tags"], json!(["zeta"]));
    for bad in ["", "Launch", "a b", "a_b"] {
        assert_eq!(
            code(
                t.as_("owner")
                    .call("addTag", json!({ "id": d, "tag": bad }))
            ),
            "Invalid",
            "{bad:?}"
        );
    }
    assert_eq!(
        code(
            t.as_("owner")
                .call("addTag", json!({ "id": "doc-x", "tag": "a" }))
        ),
        "NotFound"
    );
    assert_eq!(
        code(
            t.as_("owner")
                .call("removeTag", json!({ "id": "doc-x", "tag": "a" }))
        ),
        "NotFound"
    );
}

#[test]
fn only_the_creator_or_the_moderator_deletes_a_doc() {
    let mut t = app();
    let d = doc(&mut t, "bob", "Bob's");
    let can = |t: &mut TestApp, who: &str| {
        view(t, who, "getDoc", json!({ "id": d }))["canDelete"].clone()
    };
    assert_eq!(can(&mut t, "bob"), json!(true));
    assert_eq!(can(&mut t, "owner"), json!(true));
    assert_eq!(can(&mut t, "cy"), json!(false));
    let r = t.as_("cy").call("deleteDoc", json!({ "id": d }));
    assert_eq!(code(r), "Forbidden");
    call(&mut t, "owner", "deleteDoc", json!({ "id": d }));
    assert_eq!(
        code(t.as_("bob").view("getDoc", json!({ "id": d }))),
        "NotFound"
    );
    assert_eq!(
        code(t.as_("bob").call("deleteDoc", json!({ "id": d }))),
        "NotFound"
    );
}

#[test]
fn delete_doc_removes_its_body_tags_and_comments() {
    let mut t = app();
    let d = doc(&mut t, "bob", "Doomed");
    let b = s(&call(
        &mut t,
        "bob",
        "insertBlock",
        json!({ "doc": d, "after": null, "kind": "paragraph", "depth": 0 }),
    ));
    call(
        &mut t,
        "bob",
        "applyDelta",
        json!({ "doc": d, "block": b, "ops": [{ "insert": "text" }] }),
    );
    call(&mut t, "bob", "addTag", json!({ "id": d, "tag": "x" }));
    let c = s(&call(
        &mut t,
        "cy",
        "addComment",
        json!({ "docId": d, "body": "hi" }),
    ));
    assert_eq!(view(&mut t, "owner", "commentCount", json!({})), json!("1"));
    call(&mut t, "bob", "deleteDoc", json!({ "id": d }));
    assert_eq!(view(&mut t, "owner", "commentCount", json!({})), json!("0"));
    assert_eq!(
        code(t.as_("owner").view("getComment", json!({ "id": c }))),
        "NotFound"
    );
    assert_eq!(
        view(&mut t, "owner", "listComments", json!({ "docId": d })),
        json!([])
    );
    assert_eq!(
        code(
            t.as_("owner")
                .view("getText", json!({ "doc": d, "block": b }))
        ),
        "NotFound"
    );
}

#[test]
fn search_finds_titles_and_bodies_by_word_prefix() {
    let mut t = app();
    let a = doc(&mut t, "owner", "Launch plan");
    let b = doc(&mut t, "owner", "Notes");
    let blk = block(&mut t, &b, None, "paragraph");
    type_text(&mut t, &b, &blk, 0, "We launch on Monday");
    let archived = doc(&mut t, "owner", "Launch retro");
    call(&mut t, "owner", "archiveDoc", json!({ "id": archived }));
    let page = view(
        &mut t,
        "bob",
        "searchDocs",
        json!({ "query": "LAUN", "includeArchived": false, "cursor": null, "limit": null }),
    );
    let hits: Vec<String> = page["hits"]
        .as_array()
        .unwrap()
        .iter()
        .map(|h| s(&h["id"]))
        .collect();
    // A title match scores double, so it comes first.
    assert_eq!(hits, [a, b.clone()]);
    assert_eq!(page["total"], json!("2"));
    assert_eq!(page["nextCursor"], Value::Null);
    assert_eq!(
        page["hits"][1]["snippet"],
        json!("We <b>launch</b> on Monday")
    );
    let first = view(
        &mut t,
        "bob",
        "searchDocs",
        json!({ "query": "launch", "includeArchived": true, "cursor": null, "limit": 1 }),
    );
    assert_eq!(first["total"], json!("3"));
    assert_eq!(first["nextCursor"], json!(1));
    let none = view(
        &mut t,
        "bob",
        "searchDocs",
        json!({ "query": "launch tuesday", "includeArchived": true, "cursor": null, "limit": null }),
    );
    assert_eq!(none["hits"], json!([]));
}

#[test]
fn search_docs_checks_its_input_before_reading() {
    let mut t = app();
    let blank = view(
        &mut t,
        "owner",
        "searchDocs",
        json!({ "query": "   ", "includeArchived": false, "cursor": null, "limit": null }),
    );
    assert_eq!(blank["hits"], json!([]));
    let r = t.as_("owner").view(
        "searchDocs",
        json!({ "query": "x".repeat(257), "includeArchived": false, "cursor": null, "limit": null }),
    );
    assert_eq!(code(r), "Invalid");
}

// ── comments ─────────────────────────────────────────────────────────────────

#[test]
fn a_comment_is_its_authors_and_the_moderator_removes_any() {
    let mut t = app();
    let d = doc(&mut t, "owner", "A");
    let c = s(&call(
        &mut t,
        "bob",
        "addComment",
        json!({ "docId": d, "body": "first" }),
    ));
    let got = view(&mut t, "cy", "getComment", json!({ "id": c }));
    assert_eq!(got["author"], json!("bob"));
    assert_eq!(got["docId"], json!(d));
    assert_eq!(got["body"], json!("first"));
    assert_eq!(
        view(&mut t, "cy", "commentSchemaVersion", json!({ "id": c })),
        json!(1)
    );
    assert_eq!(
        view(
            &mut t,
            "cy",
            "commentSchemaVersion",
            json!({ "id": "cmt-x" })
        ),
        Value::Null
    );
    assert_eq!(
        code(
            t.as_("cy")
                .call("editComment", json!({ "id": c, "body": "mine now" }))
        ),
        "Forbidden"
    );
    call(
        &mut t,
        "bob",
        "editComment",
        json!({ "id": c, "body": "edited" }),
    );
    assert_eq!(
        view(&mut t, "cy", "listComments", json!({ "docId": d }))[0]["body"],
        json!("edited")
    );
    assert_eq!(
        code(t.as_("cy").call("deleteComment", json!({ "id": c }))),
        "Forbidden"
    );
    call(&mut t, "owner", "deleteComment", json!({ "id": c }));
    assert_eq!(
        view(&mut t, "cy", "listComments", json!({ "docId": d })),
        json!([])
    );
    let own = s(&call(
        &mut t,
        "cy",
        "addComment",
        json!({ "docId": d, "body": "x" }),
    ));
    call(&mut t, "cy", "deleteComment", json!({ "id": own }));
    assert_eq!(
        names(&t, "bob")[1..],
        [
            "CommentAdded",
            "CommentEdited",
            "CommentDeleted",
            "CommentAdded",
            "CommentDeleted"
        ]
    );
}

#[test]
fn a_comment_over_the_cap_or_on_a_missing_doc_is_refused() {
    let mut t = app();
    let d = doc(&mut t, "owner", "A");
    let r = t.as_("bob").call(
        "addComment",
        json!({ "docId": d, "body": "x".repeat(10_001) }),
    );
    assert_eq!(code(r), "Invalid");
    let r = t
        .as_("bob")
        .call("addComment", json!({ "docId": "doc-x", "body": "hi" }));
    assert_eq!(code(r), "NotFound");
}

// ── registry ─────────────────────────────────────────────────────────────────

#[test]
fn the_owner_alone_names_managers() {
    let mut t = app();
    assert_eq!(view(&mut t, "bob", "getOwner", json!({})), json!("owner"));
    assert_eq!(
        code(t.as_("bob").call("addManager", json!({ "member": "cy" }))),
        "Forbidden"
    );
    call(&mut t, "owner", "addManager", json!({ "member": "cy" }));
    call(&mut t, "owner", "addManager", json!({ "member": "bob" }));
    assert_eq!(
        view(&mut t, "gus", "listManagers", json!({})),
        json!(["bob", "cy"])
    );
    assert_eq!(
        code(
            t.as_("owner")
                .call("addManager", json!({ "member": "owner" }))
        ),
        "Invalid"
    );
    assert_eq!(
        code(
            t.as_("owner")
                .call("addManager", json!({ "member": "mallory" }))
        ),
        "Invalid"
    );
    assert_eq!(
        code(
            t.as_("cy")
                .call("removeManager", json!({ "member": "bob" }))
        ),
        "Forbidden"
    );
    call(&mut t, "owner", "removeManager", json!({ "member": "bob" }));
    assert_eq!(
        code(
            t.as_("owner")
                .call("removeManager", json!({ "member": "bob" }))
        ),
        "NotFound"
    );
    assert_eq!(
        view(&mut t, "owner", "listManagers", json!({})),
        json!(["cy"])
    );
    assert_eq!(
        t.events_for("gus").last().cloned(),
        Some(("ManagerRemoved".to_owned(), json!({ "member": "bob" })))
    );
}

#[test]
fn tags_validate_and_a_deleted_tag_stays_deleted() {
    let mut t = app();
    call(
        &mut t,
        "bob",
        "setTag",
        json!({ "key": "launch", "name": "  Launch  ", "color": "#aabbcc" }),
    );
    assert_eq!(
        view(&mut t, "cy", "listTags", json!({})),
        json!([{ "key": "launch", "name": "Launch", "color": "#aabbcc", "deleted": false }])
    );
    for (key, name, color) in [
        ("Bad", "x", "#aabbcc"),
        ("ok", "", "#aabbcc"),
        ("ok", "x", "red"),
        ("ok", &"n".repeat(33), "#000000"),
    ] {
        assert_eq!(
            code(t.as_("bob").call(
                "setTag",
                json!({ "key": key, "name": name, "color": color })
            )),
            "Invalid"
        );
    }
    call(&mut t, "cy", "deleteTag", json!({ "key": "launch" }));
    assert_eq!(
        view(&mut t, "cy", "listTags", json!({}))[0]["deleted"],
        json!(true)
    );
    assert_eq!(
        code(t.as_("bob").call(
            "setTag",
            json!({ "key": "launch", "name": "Again", "color": "#000000" })
        )),
        "Invalid"
    );
    assert_eq!(
        code(t.as_("bob").call("deleteTag", json!({ "key": "never" }))),
        "NotFound"
    );
}

#[test]
fn a_view_keeps_its_first_saver() {
    let mut t = app();
    call(
        &mut t,
        "bob",
        "saveView",
        json!({ "id": "v-1", "name": "Mine", "query": "tag:x" }),
    );
    call(
        &mut t,
        "cy",
        "saveView",
        json!({ "id": "v-1", "name": "Renamed", "query": "tag:y" }),
    );
    assert_eq!(
        view(&mut t, "owner", "listViews", json!({})),
        json!([{ "id": "v-1", "name": "Renamed", "query": "tag:y", "createdBy": "bob" }])
    );
    for (id, name, query) in [
        ("bad id", "x", ""),
        ("ok", " ", ""),
        ("ok", "x", &"q".repeat(1001)),
    ] {
        assert_eq!(
            code(t.as_("bob").call(
                "saveView",
                json!({ "id": id, "name": name, "query": query })
            )),
            "Invalid"
        );
    }
    call(&mut t, "cy", "deleteView", json!({ "id": "v-1" }));
    assert_eq!(view(&mut t, "owner", "listViews", json!({})), json!([]));
    assert_eq!(
        code(t.as_("cy").call("deleteView", json!({ "id": "v-1" }))),
        "NotFound"
    );
}

// ── access and wire ──────────────────────────────────────────────────────────

#[test]
fn anonymous_callers_and_outsiders_are_refused_by_the_node() {
    let mut t = app();
    let d = doc(&mut t, "owner", "A");
    match t.anonymous().view("getDoc", json!({ "id": d })) {
        Err(Failure::Refused { status, code }) => {
            assert_eq!((status, code.as_str()), (401, "UNAUTHENTICATED"))
        }
        other => panic!("{other:?}"),
    }
    match t.as_("mallory").view("getDoc", json!({ "id": d })) {
        Err(Failure::Refused { status, code }) => {
            assert_eq!((status, code.as_str()), (404, "NOT_FOUND"))
        }
        other => panic!("{other:?}"),
    }
}

#[test]
fn a_guest_reads_and_writes_like_any_member_the_instance_reaches() {
    let mut t = app();
    let d = doc(&mut t, "gus", "Guest's");
    assert_eq!(
        view(&mut t, "bob", "getDoc", json!({ "id": d }))["createdBy"],
        json!("gus")
    );
}

#[test]
fn a_removed_member_is_refused() {
    let mut t = app();
    let d = doc(&mut t, "bob", "A");
    t.remove_member("bob");
    match t.as_("bob").view("getDoc", json!({ "id": d })) {
        Err(Failure::Refused { status, .. }) => assert_eq!(status, 404),
        other => panic!("{other:?}"),
    }
}

#[test]
fn bad_args_unknown_methods_and_views_are_refused() {
    let mut t = app();
    assert_eq!(code(t.as_("owner").call("createDoc", json!({}))), "BadArgs");
    assert_eq!(
        code(
            t.as_("owner")
                .call("createDoc", json!({ "title": "x", "extra": 1 }))
        ),
        "BadArgs"
    );
    assert_eq!(
        code(t.as_("owner").call("create_doc", json!({ "title": "x" }))),
        "UnknownMethod"
    );
    assert_eq!(
        code(t.as_("owner").view("createDoc", json!({ "title": "x" }))),
        "NotAView"
    );
}
