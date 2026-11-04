//! The board on core's real wasmtime engine (`TestApp`): v1's `TestHost` tests
//! method for method, v1's merge and forged-write tests as what they become
//! under one log and method checks, and the access, wire and fuel checks v1
//! could not express.

#![cfg(not(target_arch = "wasm32"))]

mod common;

use calimero_sdk::testing::{Failure, Org, TestApp};
use serde_json::{json, Value};

/// The owner (the board's creator, so its owner and only admin), members `bob`
/// and `cy`, an org admin `ada`, and a guest, `gus`.
fn app() -> TestApp {
    common::app(
        Org::new()
            .admins(["ada"])
            .members(["bob", "cy"])
            .guests(["gus"]),
    )
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

fn names(t: &TestApp, who: &str) -> Vec<String> {
    t.events_for(who).into_iter().map(|(n, _)| n).collect()
}

fn element(id: &str, layer: u32) -> Value {
    json!({
        "id": id,
        "data": { "kind": "rect" },
        "x": 0, "y": 0, "width": 10, "height": 10, "rotation": 0,
        "fill": "#fff", "stroke": "#000", "strokeWidth": 1, "opacity": 100,
        "layerIndex": layer,
        "createdBy": "creator",
        "createdAt": 1, "updatedAt": 1,
        "shadowColor": null, "shadowOffsetX": null, "shadowOffsetY": null, "shadowBlur": null,
        "label": null
    })
}

fn add(t: &mut TestApp, who: &str, id: &str, layer: u32) {
    call(
        t,
        who,
        "addElement",
        json!({ "element": element(id, layer) }),
    );
}

fn seed(t: &mut TestApp, ids: &[&str]) {
    for (i, id) in ids.iter().enumerate() {
        add(t, "owner", id, i as u32);
    }
}

fn elements(t: &mut TestApp) -> Vec<Value> {
    view(t, "owner", "getElements", json!({}))
        .as_array()
        .expect("a list")
        .clone()
}

/// `(id, layerIndex)` in the order `getElements` answers: paint order.
fn order(t: &mut TestApp) -> Vec<(String, u64)> {
    elements(t)
        .iter()
        .map(|e| {
            (
                e["id"].as_str().expect("id").to_owned(),
                e["layerIndex"].as_u64().expect("layer"),
            )
        })
        .collect()
}

fn ids(t: &mut TestApp) -> Vec<String> {
    order(t).into_iter().map(|(id, _)| id).collect()
}

fn role(t: &mut TestApp, of: &str) -> String {
    view(t, "owner", "getRole", json!({ "member": of }))
        .as_str()
        .expect("a role")
        .to_owned()
}

// ── board and roles ──────────────────────────────────────────────────────────

#[test]
fn the_creator_is_owner_and_admin_and_can_edit() {
    let mut t = app();
    assert_eq!(view(&mut t, "owner", "myRole", json!({})), json!("admin"));
    assert_eq!(view(&mut t, "owner", "canEdit", json!({})), json!(true));
    assert_eq!(
        view(&mut t, "bob", "getBoard", json!({})),
        json!({ "name": "", "description": "", "elementCount": 0, "memberCount": 0, "owner": "owner" })
    );
}

#[test]
fn only_the_owner_renames_the_board() {
    let mut t = app();
    call(
        &mut t,
        "owner",
        "updateBoard",
        json!({ "name": "Landing page", "description": "v2" }),
    );
    assert_eq!(
        code(t.as_("ada").call(
            "updateBoard",
            json!({ "name": "Hijacked", "description": null })
        )),
        "Forbidden"
    );
    call(
        &mut t,
        "owner",
        "updateBoard",
        json!({ "name": null, "description": "kept name" }),
    );
    let board = view(&mut t, "bob", "getBoard", json!({}));
    assert_eq!(board["name"], json!("Landing page"));
    assert_eq!(board["description"], json!("kept name"));
    assert_eq!(names(&t, "bob"), ["BoardUpdated", "BoardUpdated"]);
}

#[test]
fn a_viewer_cannot_edit_and_an_editor_can() {
    let mut t = app();
    call(
        &mut t,
        "bob",
        "join",
        json!({ "username": "bob", "avatar": null, "timestamp": "1" }),
    );
    assert_eq!(role(&mut t, "bob"), "viewer");
    assert_eq!(view(&mut t, "bob", "canEdit", json!({})), json!(false));
    assert_eq!(
        code(
            t.as_("bob")
                .call("addElement", json!({ "element": element("e1", 0) }))
        ),
        "Forbidden"
    );
    assert!(elements(&mut t).is_empty());

    call(&mut t, "owner", "grantEditor", json!({ "member": "bob" }));
    assert_eq!(role(&mut t, "bob"), "editor");
    add(&mut t, "bob", "e1", 0);
    assert_eq!(ids(&mut t), ["e1"]);

    call(&mut t, "owner", "revokeEditor", json!({ "member": "bob" }));
    assert_eq!(
        code(t.as_("bob").call("deleteElement", json!({ "id": "e1" }))),
        "Forbidden"
    );
    assert_eq!(ids(&mut t), ["e1"]);
}

/// v1's "team Admin implies canvas edit", which its web client granted board by
/// board, is the contract's own rule now.
#[test]
fn an_org_admin_edits_without_a_grant_but_does_not_administer() {
    let mut t = app();
    assert_eq!(role(&mut t, "ada"), "editor");
    add(&mut t, "ada", "a", 0);
    assert_eq!(
        code(t.as_("ada").call("grantEditor", json!({ "member": "bob" }))),
        "Forbidden"
    );
    assert_eq!(
        code(t.as_("ada").call("clearElements", json!({}))),
        "Forbidden"
    );
    // Revoking an explicit grant leaves an org admin's editing alone.
    call(&mut t, "owner", "revokeEditor", json!({ "member": "ada" }));
    assert_eq!(role(&mut t, "ada"), "editor");
}

/// A grant names an account of the org, joined to the board or not; a guest
/// can be made an editor too.
#[test]
fn a_grant_names_an_account_of_the_org() {
    let mut t = app();
    call(&mut t, "owner", "grantEditor", json!({ "member": "cy" }));
    assert_eq!(role(&mut t, "cy"), "editor");
    call(&mut t, "owner", "grantEditor", json!({ "member": "gus" }));
    add(&mut t, "gus", "g", 0);
    assert_eq!(
        code(
            t.as_("owner")
                .call("grantEditor", json!({ "member": "mallory" }))
        ),
        "Invalid"
    );
    assert_eq!(role(&mut t, "mallory"), "viewer");
    assert_eq!(role(&mut t, "not an account"), "viewer");
}

#[test]
fn only_an_admin_grants_or_revokes() {
    let mut t = app();
    call(&mut t, "owner", "grantEditor", json!({ "member": "bob" }));
    for method in ["grantEditor", "revokeEditor"] {
        assert_eq!(
            code(t.as_("bob").call(method, json!({ "member": "cy" }))),
            "Forbidden",
            "{method}"
        );
    }
}

#[test]
fn list_roles_carries_the_account_twice() {
    let mut t = app();
    for who in ["owner", "bob"] {
        call(
            &mut t,
            who,
            "join",
            json!({ "username": who, "avatar": null, "timestamp": "1" }),
        );
    }
    assert_eq!(
        view(&mut t, "cy", "listRoles", json!({})),
        json!([
            { "member": "bob", "role": "viewer", "account": "bob" },
            { "member": "owner", "role": "admin", "account": "owner" },
        ])
    );
}

#[test]
fn a_transfer_moves_ownership_and_admin() {
    let mut t = app();
    assert_eq!(
        code(
            t.as_("owner")
                .call("transferOwnership", json!({ "newOwner": "mallory" }))
        ),
        "Invalid"
    );
    call(
        &mut t,
        "owner",
        "transferOwnership",
        json!({ "newOwner": "bob" }),
    );
    assert_eq!(role(&mut t, "bob"), "admin");
    // No longer a board admin; still an editor, as the org's owner.
    assert_eq!(role(&mut t, "owner"), "editor");
    assert_eq!(
        view(&mut t, "cy", "getBoard", json!({}))["owner"],
        json!("bob")
    );
    // The former owner lost every admin power, the new one has them all.
    assert_eq!(
        code(
            t.as_("owner")
                .call("updateBoard", json!({ "name": "x", "description": null }))
        ),
        "Forbidden"
    );
    assert_eq!(
        code(
            t.as_("owner")
                .call("grantEditor", json!({ "member": "cy" }))
        ),
        "Forbidden"
    );
    call(&mut t, "bob", "grantEditor", json!({ "member": "cy" }));
    call(
        &mut t,
        "bob",
        "updateBoard",
        json!({ "name": "Bob's", "description": null }),
    );
    assert_eq!(
        t.events_for("cy")[0],
        ("OwnerTransferred".to_owned(), json!({ "member": "bob" }))
    );
}

// ── members ──────────────────────────────────────────────────────────────────

#[test]
fn join_is_the_callers_own_and_happens_once() {
    let mut t = app();
    call(
        &mut t,
        "bob",
        "join",
        json!({ "username": "Bob", "avatar": "https://a/b.png", "timestamp": "100" }),
    );
    call(
        &mut t,
        "bob",
        "join",
        json!({ "username": "again", "avatar": null, "timestamp": "200" }),
    );
    assert_eq!(
        view(&mut t, "cy", "getMembers", json!({})),
        json!([{ "id": "bob", "username": "Bob", "avatar": "https://a/b.png", "joinedAt": 100, "usernameUpdatedAt": 100 }])
    );
    assert_eq!(names(&t, "cy"), ["MemberJoined"]);
    assert_eq!(
        view(&mut t, "cy", "getBoard", json!({}))["memberCount"],
        json!(1)
    );
}

/// The later rename wins (one log orders them); nobody renames anyone else,
/// and a rename before joining does nothing.
#[test]
fn a_rename_is_the_callers_own() {
    let mut t = app();
    call(
        &mut t,
        "cy",
        "updateMemberUsername",
        json!({ "username": "ghost", "timestamp": "5" }),
    );
    assert_eq!(view(&mut t, "cy", "getMembers", json!({})), json!([]));
    call(
        &mut t,
        "bob",
        "join",
        json!({ "username": "old", "avatar": null, "timestamp": "100" }),
    );
    call(
        &mut t,
        "bob",
        "updateMemberUsername",
        json!({ "username": "new", "timestamp": "200" }),
    );
    let members = view(&mut t, "cy", "getMembers", json!({}));
    assert_eq!(members[0]["username"], json!("new"));
    assert_eq!(members[0]["joinedAt"], json!(100));
    assert_eq!(members[0]["usernameUpdatedAt"], json!(200));
    assert_eq!(names(&t, "cy"), ["MemberJoined", "MemberUsernameUpdated"]);
}

// ── elements ─────────────────────────────────────────────────────────────────

/// v1's element JSON exactly, numbers included: every kind round-trips.
#[test]
fn every_element_kind_round_trips() {
    let mut t = app();
    let kinds = [
        json!({ "kind": "rect" }),
        json!({ "kind": "circle" }),
        json!({ "kind": "line", "points": "0,0 10,10" }),
        json!({ "kind": "line" }),
        json!({ "kind": "arrow", "points": "0,0 5,5" }),
        json!({ "kind": "path", "points": "M 0 0 L 40 40 Z" }),
        json!({ "kind": "text", "content": "Hi", "fontSize": 24, "fontFamily": "sans-serif", "bold": true, "italic": false, "text_align": "center", "vertical_align": "top" }),
        json!({ "kind": "text", "content": "", "fontSize": 12, "fontFamily": "serif", "bold": false, "italic": true }),
        json!({ "kind": "image", "naturalWidth": 800, "naturalHeight": 600, "blobId": "ab".repeat(32) }),
        json!({ "kind": "svg", "naturalWidth": 10, "naturalHeight": 20, "blobId": "cd".repeat(32) }),
    ];
    for (i, data) in kinds.iter().enumerate() {
        let mut el = element(&format!("e{i}"), i as u32);
        el["data"] = data.clone();
        el["x"] = json!(-40);
        el["createdAt"] = json!(1_727_000_000_000_u64);
        el["updatedAt"] = json!(1_727_000_000_000_u64);
        el["label"] = json!("topbar/logo\u{1f}b=sticky");
        el["shadowColor"] = json!("rgba(0,0,0,0.3)");
        el["shadowOffsetY"] = json!(4);
        el["shadowBlur"] = json!(12);
        el["cornerRadius"] = json!(0);
        call(&mut t, "owner", "addElement", json!({ "element": el }));
        let mut expected = el.clone();
        expected["createdBy"] = json!("owner");
        let got = view(
            &mut t,
            "bob",
            "getElement",
            json!({ "id": format!("e{i}") }),
        );
        assert_eq!(got, expected, "{data}");
    }
    assert_eq!(
        view(&mut t, "bob", "getElement", json!({ "id": "nope" })),
        Value::Null
    );
}

#[test]
fn created_by_is_the_caller_and_survives_a_replace() {
    let mut t = app();
    call(&mut t, "owner", "grantEditor", json!({ "member": "bob" }));
    add(&mut t, "bob", "a", 0);
    add(&mut t, "owner", "a", 3);
    let a = view(&mut t, "cy", "getElement", json!({ "id": "a" }));
    assert_eq!(a["createdBy"], json!("bob"));
    assert_eq!(a["layerIndex"], json!(3));
    // A replace leaves one paint-order entry, not two.
    assert_eq!(order(&mut t), [("a".to_owned(), 3)]);
}

#[test]
fn update_element_patches_only_what_it_is_given() {
    let mut t = app();
    seed(&mut t, &["a"]);
    call(
        &mut t,
        "owner",
        "updateElement",
        json!({
            "id": "a", "x": "300", "y": null, "width": null, "height": 50, "rotation": null,
            "fill": "#22c55e", "stroke": null, "strokeWidth": null, "opacity": null,
            "cornerRadius": 8, "updatedAt": "99"
        }),
    );
    let a = view(&mut t, "owner", "getElement", json!({ "id": "a" }));
    assert_eq!(
        (&a["x"], &a["y"], &a["height"], &a["width"]),
        (&json!(300), &json!(0), &json!(50), &json!(10))
    );
    assert_eq!(a["fill"], json!("#22c55e"));
    assert_eq!(a["cornerRadius"], json!(8));
    assert_eq!(a["updatedAt"], json!(99));
    // Zero is a real corner radius, not "unset".
    call(
        &mut t,
        "owner",
        "updateElements",
        json!({ "patches": [{ "id": "a", "corner_radius": 0 }], "updatedAt": "100" }),
    );
    assert_eq!(
        view(&mut t, "owner", "getElement", json!({ "id": "a" }))["cornerRadius"],
        json!(0)
    );
    // An unknown id writes and emits nothing.
    let before = t.events_for("bob").len();
    call(
        &mut t,
        "owner",
        "updateElement",
        json!({ "id": "nope", "x": "1", "updatedAt": "1" }),
    );
    assert_eq!(t.events_for("bob").len(), before);
}

#[test]
fn text_style_shadow_and_label_updates() {
    let mut t = app();
    let mut text = element("t", 0);
    text["data"] = json!({ "kind": "text", "content": "Hello", "fontSize": 24, "fontFamily": "sans-serif", "bold": false, "italic": false });
    call(&mut t, "owner", "addElement", json!({ "element": text }));
    call(
        &mut t,
        "owner",
        "updateTextStyle",
        json!({
            "id": "t", "content": "Hello there", "fontFamily": null, "fontSize": 32, "bold": true,
            "italic": null, "textAlign": "center", "verticalAlign": null, "updatedAt": "5"
        }),
    );
    call(
        &mut t,
        "owner",
        "updateShadow",
        json!({ "id": "t", "shadowColor": "#000", "shadowOffsetX": 1, "shadowOffsetY": 2, "shadowBlur": 3, "updatedAt": "6" }),
    );
    call(
        &mut t,
        "owner",
        "updateElementLabel",
        json!({ "id": "t", "label": "screen/01 Sign in", "updatedAt": "7" }),
    );
    let got = view(&mut t, "owner", "getElement", json!({ "id": "t" }));
    assert_eq!(
        got["data"],
        json!({ "kind": "text", "content": "Hello there", "fontSize": 32, "fontFamily": "sans-serif", "bold": true, "italic": false, "text_align": "center" })
    );
    assert_eq!(
        (
            &got["shadowColor"],
            &got["shadowOffsetX"],
            &got["shadowBlur"]
        ),
        (&json!("#000"), &json!(1), &json!(3))
    );
    assert_eq!(got["label"], json!("screen/01 Sign in"));
    assert_eq!(got["updatedAt"], json!(7));
    // All four null removes the shadow; a null label clears it.
    call(
        &mut t,
        "owner",
        "updateShadow",
        json!({ "id": "t", "shadowColor": null, "shadowOffsetX": null, "shadowOffsetY": null, "shadowBlur": null, "updatedAt": "8" }),
    );
    call(
        &mut t,
        "owner",
        "updateElementLabel",
        json!({ "id": "t", "label": null, "updatedAt": "9" }),
    );
    let got = view(&mut t, "owner", "getElement", json!({ "id": "t" }));
    assert_eq!(got["shadowColor"], Value::Null);
    assert_eq!(got["label"], Value::Null);
    assert_eq!(
        names(&t, "bob"),
        [
            "ElementAdded",
            "ElementUpdated",
            "ElementUpdated",
            "ElementUpdated",
            "ElementUpdated",
            "ElementUpdated"
        ]
    );
}

// ── batches ──────────────────────────────────────────────────────────────────

fn many(n: usize) -> Vec<Value> {
    (0..n)
        .map(|i| element(&format!("id{i:04}"), i as u32))
        .collect()
}

#[test]
fn each_batch_is_one_call_and_one_event() {
    let mut t = app();
    let added = call(
        &mut t,
        "owner",
        "addElements",
        json!({ "elements": many(3) }),
    );
    assert_eq!(added, json!(["id0000", "id0001", "id0002"]));
    call(
        &mut t,
        "owner",
        "updateElements",
        json!({ "patches": [{ "id": "id0000", "fill": "#123456" }, { "id": "nope", "fill": "#000" }], "updatedAt": "5" }),
    );
    call(
        &mut t,
        "owner",
        "updateElementLabels",
        json!({ "labels": [{ "id": "id0001", "label": "batch-label" }, { "id": "nope", "label": null }], "updatedAt": "6" }),
    );
    let read = view(
        &mut t,
        "owner",
        "getElementsByIds",
        json!({ "ids": ["id0001", "nope", "id0000"] }),
    );
    assert_eq!(read[0]["label"], json!("batch-label"));
    assert_eq!(read[1]["fill"], json!("#123456"));
    assert_eq!(read.as_array().map(Vec::len), Some(2));
    call(
        &mut t,
        "owner",
        "deleteElements",
        json!({ "ids": ["id0000", "id0002", "gone"] }),
    );
    assert_eq!(ids(&mut t), ["id0001"]);
    assert_eq!(
        t.events_for("bob"),
        [
            (
                "ElementsAdded".to_owned(),
                json!({ "ids": ["id0000", "id0001", "id0002"] })
            ),
            ("ElementsUpdated".to_owned(), json!({ "ids": ["id0000"] })),
            ("ElementsUpdated".to_owned(), json!({ "ids": ["id0001"] })),
            (
                "ElementsDeleted".to_owned(),
                json!({ "ids": ["id0000", "id0002", "gone"] })
            ),
        ]
    );
}

#[test]
fn a_batch_over_the_cap_is_refused_whole_and_empty_ones_do_nothing() {
    let mut t = app();
    assert_eq!(
        code(
            t.as_("owner")
                .call("addElements", json!({ "elements": many(201) }))
        ),
        "Invalid"
    );
    assert!(elements(&mut t).is_empty());
    call(&mut t, "owner", "addElements", json!({ "elements": [] }));
    call(&mut t, "owner", "deleteElements", json!({ "ids": [] }));
    call(
        &mut t,
        "owner",
        "updateElements",
        json!({ "patches": [], "updatedAt": "1" }),
    );
    assert!(names(&t, "bob").is_empty());
    for (method, args) in [
        ("addElements", json!({ "elements": [element("a", 0)] })),
        ("updateElements", json!({ "patches": [], "updatedAt": "1" })),
        (
            "updateElementLabels",
            json!({ "labels": [], "updatedAt": "1" }),
        ),
        ("deleteElements", json!({ "ids": [] })),
    ] {
        assert_eq!(
            code(t.as_("bob").call(method, args)),
            "Forbidden",
            "{method}"
        );
    }
}

/// The largest batch fits one call, and a whole page of the canvas one read.
#[test]
fn the_largest_batch_and_a_full_page_fit_within_fuel() {
    let mut t = app();
    for chunk in 0..5 {
        let batch: Vec<Value> = (0..200)
            .map(|i| {
                element(
                    &format!("id{:04}", chunk * 200 + i),
                    (chunk * 200 + i) as u32,
                )
            })
            .collect();
        call(&mut t, "owner", "addElements", json!({ "elements": batch }));
    }
    let page = view(&mut t, "owner", "getElements", json!({}));
    assert_eq!(page.as_array().map(Vec::len), Some(1000));
    let first = view(
        &mut t,
        "owner",
        "getElementsPage",
        json!({ "cursor": null, "limit": 0 }),
    );
    assert_eq!(first["items"].as_array().map(Vec::len), Some(500));
    let second = view(
        &mut t,
        "owner",
        "getElementsPage",
        json!({ "cursor": first["nextCursor"], "limit": 500 }),
    );
    assert_eq!(second["items"][0]["id"], json!("id0500"));
    assert_eq!(second["nextCursor"], Value::Null);
    // Moving one layer on a 1,000-element board reads the order and writes two.
    call(
        &mut t,
        "owner",
        "setLayerIndex",
        json!({ "id": "id0500", "index": 501, "updatedAt": "2" }),
    );
    let ids: Vec<String> = (0..200).map(|i| format!("id{i:04}")).collect();
    call(&mut t, "owner", "deleteElements", json!({ "ids": ids }));
    assert_eq!(
        view(&mut t, "owner", "getBoard", json!({}))["elementCount"],
        json!(800)
    );
}

// ── layers ───────────────────────────────────────────────────────────────────

#[test]
fn set_layer_index_moves_one_step_without_duplicates() {
    let mut t = app();
    seed(&mut t, &["a", "b", "c"]);
    call(
        &mut t,
        "owner",
        "setLayerIndex",
        json!({ "id": "b", "index": 2, "updatedAt": "99" }),
    );
    let got = order(&mut t);
    let ids: Vec<&str> = got.iter().map(|(id, _)| id.as_str()).collect();
    assert_eq!(ids, ["a", "c", "b"], "one step up");
    let mut layers: Vec<u64> = got.iter().map(|(_, l)| *l).collect();
    layers.dedup();
    assert_eq!(layers.len(), 3, "no two elements share an index");
    assert_eq!(
        view(&mut t, "owner", "getElement", json!({ "id": "b" }))["updatedAt"],
        json!(99)
    );
}

#[test]
fn set_layer_index_clamps_ignores_unknown_ids_and_no_ops() {
    let mut t = app();
    seed(&mut t, &["a", "b"]);
    call(
        &mut t,
        "owner",
        "setLayerIndex",
        json!({ "id": "a", "index": 99, "updatedAt": "1" }),
    );
    assert_eq!(ids(&mut t), ["b", "a"]);
    let before = t.events_for("bob").len();
    for (id, index) in [("nope", 0), ("b", 0)] {
        call(
            &mut t,
            "owner",
            "setLayerIndex",
            json!({ "id": id, "index": index, "updatedAt": "1" }),
        );
    }
    assert_eq!(ids(&mut t), ["b", "a"]);
    assert_eq!(t.events_for("bob").len(), before);
    assert_eq!(
        code(t.as_("bob").call(
            "setLayerIndex",
            json!({ "id": "a", "index": 0, "updatedAt": "1" })
        )),
        "Forbidden"
    );
}

#[test]
fn front_and_back_move_only_that_element_when_there_is_room() {
    let mut t = app();
    for (id, layer) in [("a", 5), ("b", 6), ("c", 7)] {
        add(&mut t, "owner", id, layer);
    }
    call(&mut t, "owner", "sendToBack", json!({ "id": "c" }));
    assert_eq!(
        order(&mut t),
        [
            ("c".to_owned(), 4),
            ("a".to_owned(), 5),
            ("b".to_owned(), 6)
        ]
    );
    call(&mut t, "owner", "bringToFront", json!({ "id": "c" }));
    assert_eq!(
        order(&mut t),
        [
            ("a".to_owned(), 5),
            ("b".to_owned(), 6),
            ("c".to_owned(), 7)
        ]
    );
}

#[test]
fn send_to_back_on_a_dense_board_keeps_order() {
    let mut t = app();
    seed(&mut t, &["a", "b", "c"]);
    call(&mut t, "owner", "sendToBack", json!({ "id": "c" }));
    assert_eq!(ids(&mut t), ["c", "a", "b"]);
}

#[test]
fn front_and_back_with_an_unknown_id_write_and_emit_nothing() {
    let mut t = app();
    seed(&mut t, &["a", "b"]);
    let before = t.events_for("bob").len();
    call(&mut t, "owner", "sendToBack", json!({ "id": "gone" }));
    call(&mut t, "owner", "bringToFront", json!({ "id": "gone" }));
    assert_eq!(order(&mut t), [("a".to_owned(), 0), ("b".to_owned(), 1)]);
    assert_eq!(t.events_for("bob").len(), before);
}

#[test]
fn deleting_and_clearing_keep_the_paint_order_in_step() {
    let mut t = app();
    seed(&mut t, &["a", "b", "c"]);
    call(&mut t, "owner", "deleteElement", json!({ "id": "b" }));
    call(&mut t, "owner", "deleteElement", json!({ "id": "gone" }));
    assert_eq!(ids(&mut t), ["a", "c"]);
    assert_eq!(
        code(t.as_("ada").call("clearElements", json!({}))),
        "Forbidden"
    );
    call(&mut t, "owner", "clearElements", json!({}));
    assert!(elements(&mut t).is_empty());
    add(&mut t, "owner", "z", 0);
    assert_eq!(ids(&mut t), ["z"]);
    assert_eq!(
        names(&t, "bob"),
        [
            "ElementAdded",
            "ElementAdded",
            "ElementAdded",
            "ElementDeleted",
            "ElementDeleted",
            "LayerReordered",
            "ElementAdded"
        ]
    );
}

// ── comments ─────────────────────────────────────────────────────────────────

fn comment(t: &mut TestApp, who: &str, id: &str) {
    call(
        t,
        who,
        "addComment",
        json!({ "id": id, "x": "120", "y": "-90", "content": "Bigger logo?", "createdAt": "40" }),
    );
}

fn reply(t: &mut TestApp, who: &str, comment_id: &str, id: &str, at: u64) {
    call(
        t,
        who,
        "addReply",
        json!({ "commentId": comment_id, "replyId": id, "content": id, "createdAt": at.to_string() }),
    );
}

#[test]
fn a_comment_and_its_thread() {
    let mut t = app();
    call(&mut t, "owner", "grantEditor", json!({ "member": "bob" }));
    comment(&mut t, "bob", "c1");
    // Both replies posted "at once" survive, in time order.
    reply(&mut t, "owner", "c1", "r2", 60);
    reply(&mut t, "bob", "c1", "r1", 50);
    reply(&mut t, "bob", "missing", "r3", 70);
    assert_eq!(
        view(&mut t, "cy", "getComments", json!({})),
        json!([{
            "id": "c1", "x": 120, "y": -90, "content": "Bigger logo?", "author": "bob", "createdAt": 40,
            "replies": [
                { "id": "r1", "content": "r1", "author": "bob", "createdAt": 50 },
                { "id": "r2", "content": "r2", "author": "owner", "createdAt": 60 },
            ]
        }])
    );
    call(
        &mut t,
        "owner",
        "deleteReply",
        json!({ "commentId": "c1", "replyId": "r1" }),
    );
    let before = t.events_for("cy").len();
    call(
        &mut t,
        "owner",
        "deleteReply",
        json!({ "commentId": "c1", "replyId": "r1" }),
    );
    assert_eq!(t.events_for("cy").len(), before);
    assert_eq!(
        view(&mut t, "cy", "getComments", json!({}))[0]["replies"],
        json!([{ "id": "r2", "content": "r2", "author": "owner", "createdAt": 60 }])
    );
    // Replacing a comment keeps its thread; deleting it takes the thread too.
    comment(&mut t, "owner", "c1");
    assert_eq!(
        view(&mut t, "cy", "getComments", json!({}))[0]["replies"]
            .as_array()
            .map(Vec::len),
        Some(1)
    );
    call(&mut t, "owner", "deleteComment", json!({ "id": "c1" }));
    comment(&mut t, "owner", "c1");
    assert_eq!(
        view(&mut t, "cy", "getComments", json!({}))[0]["replies"],
        json!([])
    );
    assert_eq!(
        names(&t, "cy"),
        [
            "RoleUpdated",
            "CommentAdded",
            "CommentUpdated",
            "CommentUpdated",
            "CommentUpdated",
            "CommentAdded",
            "CommentDeleted",
            "CommentAdded"
        ]
    );
}

#[test]
fn viewers_cannot_comment_and_only_an_admin_clears() {
    let mut t = app();
    comment(&mut t, "owner", "c1");
    reply(&mut t, "owner", "c1", "r1", 1);
    for (method, args) in [
        (
            "addComment",
            json!({ "id": "c2", "x": "0", "y": "0", "content": "x", "createdAt": "1" }),
        ),
        (
            "addReply",
            json!({ "commentId": "c1", "replyId": "r", "content": "x", "createdAt": "1" }),
        ),
        ("deleteReply", json!({ "commentId": "c1", "replyId": "r1" })),
        ("deleteComment", json!({ "id": "c1" })),
        ("clearComments", json!({})),
    ] {
        assert_eq!(
            code(t.as_("bob").call(method, args)),
            "Forbidden",
            "{method}"
        );
    }
    call(&mut t, "owner", "clearComments", json!({}));
    assert_eq!(view(&mut t, "bob", "getComments", json!({})), json!([]));
}

// ── pointers ─────────────────────────────────────────────────────────────────

/// One pointer per account (v1: per device); anyone who reaches the board,
/// viewers and guests included, moves their own.
#[test]
fn a_pointer_belongs_to_whoever_moved_it() {
    let mut t = app();
    call(
        &mut t,
        "gus",
        "updateCursor",
        json!({ "x": "1", "y": "2", "updatedAt": "10" }),
    );
    call(
        &mut t,
        "gus",
        "updateCursor",
        json!({ "x": "-5", "y": "6", "updatedAt": "11" }),
    );
    call(
        &mut t,
        "bob",
        "updateCursor",
        json!({ "x": "0", "y": "0", "updatedAt": "12" }),
    );
    assert_eq!(
        view(&mut t, "cy", "getCursors", json!({})),
        json!([
            { "identity": "bob", "account": "bob", "x": 0, "y": 0, "updatedAt": 12 },
            { "identity": "gus", "account": "gus", "x": -5, "y": 6, "updatedAt": 11 },
        ])
    );
    assert_eq!(
        t.events_for("cy")[0],
        ("CursorMoved".to_owned(), json!({ "identity": "gus" }))
    );
}

// ── access and the wire ──────────────────────────────────────────────────────

/// The org decides who reaches the board; anonymous callers and outsiders are
/// refused before the app runs.
#[test]
fn who_reaches_the_board() {
    let mut t = app();
    seed(&mut t, &["a"]);
    assert_eq!(elements(&mut t).len(), 1);
    assert_eq!(
        view(&mut t, "gus", "getElements", json!({}))
            .as_array()
            .map(Vec::len),
        Some(1)
    );
    for (method, args) in [("getElements", json!({})), ("getBoard", json!({}))] {
        assert_eq!(
            t.anonymous().view(method, args.clone()),
            Err(Failure::Refused {
                status: 401,
                code: "UNAUTHENTICATED".to_owned()
            })
        );
        assert_eq!(
            t.as_("mallory").view(method, args),
            Err(Failure::Refused {
                status: 404,
                code: "NOT_FOUND".to_owned()
            })
        );
    }
    t.remove_member("bob");
    assert_eq!(
        t.as_("bob").call(
            "join",
            json!({ "username": "b", "avatar": null, "timestamp": "1" })
        ),
        Err(Failure::Refused {
            status: 404,
            code: "NOT_FOUND".to_owned()
        })
    );
}

#[test]
fn malformed_arguments_are_refused_before_anything_is_written() {
    let mut t = app();
    for args in [
        json!({ "element": { "id": "a" } }),
        json!({ "element": element("a", 0), "extra": 1 }),
        json!({ "element": { "id": "a", "data": { "kind": "hexagon" } } }),
    ] {
        assert_eq!(
            code(t.as_("owner").call("addElement", args.clone())),
            "BadArgs",
            "{args}"
        );
    }
    // A 64-bit argument is a decimal string, as v1's number is not.
    assert_eq!(
        code(t.as_("owner").call(
            "join",
            json!({ "username": "o", "avatar": null, "timestamp": 1 })
        )),
        "BadArgs"
    );
    assert!(elements(&mut t).is_empty());
    assert!(names(&t, "bob").is_empty());
}

/// v1's snake_case names are not methods any more; a write is not a view.
#[test]
fn methods_are_reached_by_their_camel_case_names() {
    let mut t = app();
    assert_eq!(
        code(t.as_("owner").view("get_elements", json!({}))),
        "UnknownMethod"
    );
    assert_eq!(
        code(
            t.as_("owner")
                .view("addElement", json!({ "element": element("a", 0) }))
        ),
        "NotAView"
    );
    t.as_("owner")
        .call("getBoard", json!({}))
        .expect("a view as a call");
}
