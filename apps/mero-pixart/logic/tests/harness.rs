//! The document on core's real wasmtime engine (`TestApp`): v1's `TestHost`
//! tests method for method, v1's storage-level write rules as the method checks
//! they became (a forged write is now a call the method refuses), and the access
//! and wire checks v1 could not express.

#![cfg(not(target_arch = "wasm32"))]

mod common;

use calimero_app_sdk::testing::{Failure, Org, TestApp};
use serde_json::{json, Value};

/// The owner, an org admin, two members and a guest.
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

fn blob(c: char) -> String {
    c.to_string().repeat(64)
}

fn layer(id: &str) -> Value {
    json!({
        "id": id,
        "name": "Layer",
        "kind": "raster",
        "layerIndex": 0,
        "visible": true,
        "locked": false,
        "opacity": 100,
        "blendMode": "normal",
        "x": 0,
        "y": 0,
        "width": 100,
        "height": 100,
        "rotation": 0,
        "scaleX": 100,
        "scaleY": 100,
        "adjustments": {
            "brightness": 0, "contrast": 0, "saturation": 0, "hue": 0,
            "exposure": 0, "blur": 0, "invert": false
        },
        "createdBy": "someone-else",
        "createdAt": 1,
        "updatedAt": 1,
    })
}

fn with(mut v: Value, key: &str, value: Value) -> Value {
    v[key] = value;
    v
}

fn get_layer(t: &mut TestApp, id: &str) -> Value {
    view(t, "owner", "getLayer", json!({ "id": id }))
}

fn layer_ids(t: &mut TestApp) -> Vec<String> {
    view(t, "owner", "getLayers", json!({}))
        .as_array()
        .unwrap()
        .iter()
        .map(|l| l["id"].as_str().unwrap().to_owned())
        .collect()
}

fn add(t: &mut TestApp, l: Value) {
    let _ = call(t, "owner", "addLayer", json!({ "layer": l }));
}

// ── document ─────────────────────────────────────────────────────────────────

#[test]
fn creator_owns_the_document_and_can_edit() {
    let mut t = app();
    assert_eq!(view(&mut t, "owner", "myRole", json!({})), json!("admin"));
    assert_eq!(view(&mut t, "owner", "canEdit", json!({})), json!(true));
    let doc = view(&mut t, "bob", "getDocument", json!({}));
    assert_eq!(doc["owner"], json!("owner"));
}

#[test]
fn init_without_arguments_is_an_untitled_hd_canvas() {
    let mut t = app();
    let doc = view(&mut t, "owner", "getDocument", json!({}));
    assert_eq!(
        doc,
        json!({
            "name": "Untitled",
            "description": "",
            "width": 1280,
            "height": 720,
            "background": "#00000000",
            "layerCount": 0,
            "memberCount": 0,
            "owner": "owner",
        })
    );
}

#[test]
fn only_the_owner_renames_and_resizes() {
    let mut t = app();
    let _ = call(
        &mut t,
        "owner",
        "updateDocument",
        json!({ "name": "Poster", "width": 1024, "height": 768 }),
    );
    let doc = view(&mut t, "bob", "getDocument", json!({}));
    assert_eq!(
        (&doc["name"], &doc["width"], &doc["height"]),
        (&json!("Poster"), &json!(1024), &json!(768))
    );
    // An org admin edits layers but does not own the document.
    for who in ["ada", "bob", "gus"] {
        assert_eq!(
            code(t.as_(who).call("updateDocument", json!({ "name": "mine" }))),
            "OwnerOnly",
            "{who}"
        );
    }
    let _ = call(
        &mut t,
        "owner",
        "updateDocument",
        json!({ "background": "#ffffffff" }),
    );
    let doc = view(&mut t, "owner", "getDocument", json!({}));
    assert_eq!(doc["name"], json!("Poster"));
    assert_eq!(doc["background"], json!("#ffffffff"));
    assert!(t
        .events_for("bob")
        .iter()
        .any(|(n, _)| n == "DocumentUpdated"));
}

#[test]
fn ownership_transfer_moves_control() {
    let mut t = app();
    let _ = call(
        &mut t,
        "owner",
        "transferOwnership",
        json!({ "newOwner": "bob" }),
    );
    assert_eq!(view(&mut t, "bob", "myRole", json!({})), json!("admin"));
    // The previous owner keeps editing.
    assert_eq!(view(&mut t, "owner", "myRole", json!({})), json!("editor"));
    assert_eq!(
        code(
            t.as_("owner")
                .call("updateDocument", json!({ "name": "x" }))
        ),
        "OwnerOnly"
    );
    let _ = call(&mut t, "bob", "updateDocument", json!({ "name": "Bob's" }));
    assert_eq!(
        view(&mut t, "cy", "getDocument", json!({}))["owner"],
        json!("bob")
    );
    // Someone the team does not hold cannot be handed the document.
    assert_eq!(
        code(
            t.as_("bob")
                .call("transferOwnership", json!({ "newOwner": "mallory" }))
        ),
        "Invalid"
    );
}

// ── roles ────────────────────────────────────────────────────────────────────

#[test]
fn viewer_cannot_edit_editor_can() {
    let mut t = app();
    let _ = call(
        &mut t,
        "bob",
        "join",
        json!({ "username": "bob", "avatar": null, "timestamp": "1" }),
    );
    assert_eq!(view(&mut t, "bob", "myRole", json!({})), json!("viewer"));
    assert_eq!(
        code(
            t.as_("bob")
                .call("addLayer", json!({ "layer": layer("l1") }))
        ),
        "ViewOnly"
    );
    assert!(layer_ids(&mut t).is_empty());

    let _ = call(&mut t, "owner", "grantEditor", json!({ "member": "bob" }));
    assert_eq!(
        view(&mut t, "owner", "getRole", json!({ "member": "bob" })),
        json!("editor")
    );
    let _ = call(&mut t, "bob", "addLayer", json!({ "layer": layer("l1") }));
    assert_eq!(layer_ids(&mut t), ["l1"]);

    let _ = call(&mut t, "owner", "revokeEditor", json!({ "member": "bob" }));
    assert_eq!(
        code(t.as_("bob").call("deleteLayer", json!({ "id": "l1" }))),
        "ViewOnly"
    );
}

#[test]
fn org_owner_and_admins_edit_without_a_grant() {
    let mut t = app();
    assert_eq!(view(&mut t, "ada", "myRole", json!({})), json!("editor"));
    let _ = call(&mut t, "ada", "addLayer", json!({ "layer": layer("a1") }));
    // Revoking does not take it away: the org role decides.
    let _ = call(&mut t, "owner", "revokeEditor", json!({ "member": "ada" }));
    assert_eq!(view(&mut t, "ada", "canEdit", json!({})), json!(true));
}

#[test]
fn a_member_can_be_granted_before_they_ever_open_the_document() {
    let mut t = app();
    let _ = call(&mut t, "owner", "grantEditor", json!({ "member": "cy" }));
    assert_eq!(
        view(&mut t, "owner", "getRole", json!({ "member": "cy" })),
        json!("editor")
    );
    // A guest of the team may be made an editor too.
    let _ = call(&mut t, "owner", "grantEditor", json!({ "member": "gus" }));
    let _ = call(&mut t, "gus", "addLayer", json!({ "layer": layer("g1") }));
}

#[test]
fn a_grant_names_someone_the_team_holds() {
    let mut t = app();
    for member in ["", "mallory", &"x".repeat(300)] {
        assert_eq!(
            code(
                t.as_("owner")
                    .call("grantEditor", json!({ "member": member }))
            ),
            "Invalid",
            "{member:?}"
        );
    }
    assert_eq!(
        view(
            &mut t,
            "owner",
            "getRole",
            json!({ "member": "not-an-account" })
        ),
        json!("viewer")
    );
}

#[test]
fn only_the_owner_grants_roles() {
    let mut t = app();
    for who in ["ada", "bob", "gus"] {
        assert_eq!(
            code(t.as_(who).call("grantEditor", json!({ "member": "cy" }))),
            "OwnerOnly",
            "{who}"
        );
        assert_eq!(
            code(t.as_(who).call("revokeEditor", json!({ "member": "cy" }))),
            "OwnerOnly",
            "{who}"
        );
    }
}

#[test]
fn list_roles_names_every_member_on_the_roster() {
    let mut t = app();
    for who in ["owner", "bob", "cy"] {
        let _ = call(
            &mut t,
            who,
            "join",
            json!({ "username": who, "avatar": null, "timestamp": "1" }),
        );
    }
    let _ = call(&mut t, "owner", "grantEditor", json!({ "member": "cy" }));
    let roles = view(&mut t, "bob", "listRoles", json!({}));
    let mut pairs: Vec<(String, String)> = roles
        .as_array()
        .unwrap()
        .iter()
        .map(|r| {
            (
                r["member"].as_str().unwrap().to_owned(),
                r["role"].as_str().unwrap().to_owned(),
            )
        })
        .collect();
    pairs.sort();
    assert_eq!(
        pairs,
        [
            ("bob".to_owned(), "viewer".to_owned()),
            ("cy".to_owned(), "editor".to_owned()),
            ("owner".to_owned(), "admin".to_owned()),
        ]
    );
}

// ── members ──────────────────────────────────────────────────────────────────

#[test]
fn join_uses_the_caller_and_is_idempotent() {
    let mut t = app();
    let _ = call(
        &mut t,
        "bob",
        "join",
        json!({ "username": "alice", "avatar": null, "timestamp": "5" }),
    );
    let _ = call(
        &mut t,
        "bob",
        "join",
        json!({ "username": "again", "avatar": null, "timestamp": "6" }),
    );
    let members = view(&mut t, "owner", "getMembers", json!({}));
    assert_eq!(
        members,
        json!([{
            "id": "bob",
            "username": "alice",
            "avatar": null,
            "joinedAt": 5,
            "usernameUpdatedAt": 5,
        }])
    );
    assert_eq!(
        view(&mut t, "owner", "getDocument", json!({}))["memberCount"],
        json!(1)
    );
    let events: Vec<String> = t.events_for("cy").into_iter().map(|(n, _)| n).collect();
    assert_eq!(events, ["MemberJoined"]);
}

#[test]
fn nobody_renames_another_member() {
    let mut t = app();
    for who in ["bob", "cy"] {
        let _ = call(
            &mut t,
            who,
            "join",
            json!({ "username": who, "avatar": null, "timestamp": "1" }),
        );
    }
    let _ = call(
        &mut t,
        "bob",
        "updateMemberUsername",
        json!({ "username": "Bobby", "timestamp": "2" }),
    );
    // Someone not on the roster renames nobody.
    let _ = call(
        &mut t,
        "gus",
        "updateMemberUsername",
        json!({ "username": "x", "timestamp": "3" }),
    );
    let members = view(&mut t, "owner", "getMembers", json!({}));
    let names: Vec<(&str, &str)> = members
        .as_array()
        .unwrap()
        .iter()
        .map(|m| (m["id"].as_str().unwrap(), m["username"].as_str().unwrap()))
        .collect();
    assert_eq!(names, [("bob", "Bobby"), ("cy", "cy")]);
    assert_eq!(
        code(t.as_("bob").call(
            "updateMemberUsername",
            json!({ "username": "  ", "timestamp": "4" })
        )),
        "Invalid"
    );
}

// ── layers ───────────────────────────────────────────────────────────────────

#[test]
fn add_layer_stamps_the_caller_as_author() {
    let mut t = app();
    let _ = call(&mut t, "ada", "addLayer", json!({ "layer": layer("l1") }));
    assert_eq!(get_layer(&mut t, "l1")["createdBy"], json!("ada"));
    assert_eq!(get_layer(&mut t, "missing"), Value::Null);
}

#[test]
fn layer_content_and_adjustments_update() {
    let mut t = app();
    add(&mut t, layer("l1"));
    let _ = call(
        &mut t,
        "owner",
        "updateAdjustments",
        json!({
            "id": "l1", "brightness": 20, "contrast": -10, "saturation": 5,
            "hue": null, "exposure": null, "blur": null, "invert": true,
            "curves": null, "updatedAt": "2"
        }),
    );
    let l = get_layer(&mut t, "l1");
    assert_eq!(l["adjustments"]["brightness"], json!(20));
    assert_eq!(l["adjustments"]["contrast"], json!(-10));
    assert_eq!(l["adjustments"]["invert"], json!(true));
    assert_eq!(l["updatedAt"], json!(2));

    let _ = call(
        &mut t,
        "owner",
        "updateLayerContent",
        json!({ "id": "l1", "blobId": blob('a'), "width": 256, "height": 256, "updatedAt": "3" }),
    );
    let l = get_layer(&mut t, "l1");
    assert_eq!(
        (&l["width"], &l["height"], &l["blobId"]),
        (&json!(256), &json!(256), &json!(blob('a')))
    );

    let _ = call(
        &mut t,
        "owner",
        "updateLayerMask",
        json!({ "id": "l1", "maskBlobId": blob('b'), "updatedAt": "4" }),
    );
    assert_eq!(get_layer(&mut t, "l1")["maskBlobId"], json!(blob('b')));
    let _ = call(
        &mut t,
        "owner",
        "updateLayerMask",
        json!({ "id": "l1", "maskBlobId": null, "updatedAt": "5" }),
    );
    assert!(get_layer(&mut t, "l1").get("maskBlobId").is_none());
}

#[test]
fn a_blob_id_is_the_hex_id_the_upload_answered() {
    let mut t = app();
    // The base58 form the upload also answers, or anything else.
    for bad in [
        "8CKoWrFGQGkzmBq3wXc3P6jhjgCo2xu9ue1QaUxfYcPV",
        "ZZ",
        &blob('A'),
    ] {
        assert_eq!(
            code(t.as_("owner").call(
                "addLayer",
                json!({ "layer": with(layer("l1"), "blobId", json!(bad)) })
            )),
            "Invalid",
            "{bad}"
        );
    }
    add(&mut t, layer("l1"));
    assert_eq!(
        code(t.as_("owner").call(
            "updateLayerContent",
            json!({ "id": "l1", "blobId": "nope", "width": 1, "height": 1, "updatedAt": "2" })
        )),
        "Invalid"
    );
    assert_eq!(
        code(t.as_("owner").call(
            "updateLayerMask",
            json!({ "id": "l1", "maskBlobId": "nope", "updatedAt": "2" })
        )),
        "Invalid"
    );
}

#[test]
fn update_layer_patches_only_what_it_is_given() {
    let mut t = app();
    add(&mut t, layer("l1"));
    let _ = call(
        &mut t,
        "owner",
        "updateLayer",
        json!({
            "id": "l1", "name": "Sky", "opacity": 40, "x": "-12", "y": "7",
            "blendMode": "multiply", "updatedAt": "9"
        }),
    );
    let l = get_layer(&mut t, "l1");
    assert_eq!(l["name"], json!("Sky"));
    assert_eq!(l["opacity"], json!(40));
    assert_eq!((&l["x"], &l["y"]), (&json!(-12), &json!(7)));
    assert_eq!(l["blendMode"], json!("multiply"));
    assert_eq!(l["visible"], json!(true));
    assert_eq!(l["width"], json!(100));
    // An unknown layer changes nothing and is not an error (v1).
    let _ = call(
        &mut t,
        "owner",
        "updateLayer",
        json!({ "id": "nope", "name": "x", "updatedAt": "10" }),
    );
}

#[test]
fn update_text_creates_the_props_on_first_edit() {
    let mut t = app();
    add(&mut t, with(layer("t1"), "kind", json!("text")));
    let _ = call(
        &mut t,
        "owner",
        "updateText",
        json!({ "id": "t1", "content": "Hello", "bold": true, "align": "center", "updatedAt": "2" }),
    );
    let text = &get_layer(&mut t, "t1")["text"];
    assert_eq!(text["content"], json!("Hello"));
    assert_eq!(text["fontFamily"], json!("Inter"));
    assert_eq!(text["fontSize"], json!(48));
    assert_eq!(text["bold"], json!(true));
    assert_eq!(text["align"], json!("center"));
}

#[test]
fn update_transform_patches_clamps_and_clears() {
    let mut t = app();
    add(&mut t, layer("l1"));
    let _ = call(
        &mut t,
        "owner",
        "updateTransform",
        json!({
            "id": "l1", "rotation": 30, "skewX": 200, "skewY": -200, "flipH": true,
            "warp": "{\"tl\":[1,2]}", "updatedAt": "2"
        }),
    );
    let l = get_layer(&mut t, "l1");
    assert_eq!(l["rotation"], json!(30));
    assert_eq!((&l["skewX"], &l["skewY"]), (&json!(80), &json!(-80)));
    assert_eq!(l["flipH"], json!(true));
    assert_eq!(l["flipV"], json!(false));
    assert_eq!(l["scaleX"], json!(100));
    assert_eq!(l["warp"], json!("{\"tl\":[1,2]}"));
    let _ = call(
        &mut t,
        "owner",
        "updateTransform",
        json!({ "id": "l1", "warp": "", "updatedAt": "3" }),
    );
    let l = get_layer(&mut t, "l1");
    assert!(l.get("warp").is_none());
    assert_eq!(l["rotation"], json!(30));
}

#[test]
fn every_layer_write_refuses_a_viewer() {
    let mut t = app();
    add(&mut t, layer("l1"));
    let writes = [
        ("addLayer", json!({ "layer": layer("l2") })),
        (
            "updateLayer",
            json!({ "id": "l1", "name": "x", "updatedAt": "2" }),
        ),
        (
            "updateTransform",
            json!({ "id": "l1", "rotation": 5, "updatedAt": "2" }),
        ),
        (
            "moveLayers",
            json!({ "moves": [["l1", null]], "updatedAt": "2" }),
        ),
        (
            "updateLayerContent",
            json!({ "id": "l1", "blobId": "", "width": 1, "height": 1, "updatedAt": "2" }),
        ),
        (
            "updateLayerMask",
            json!({ "id": "l1", "maskBlobId": null, "updatedAt": "2" }),
        ),
        (
            "updateAdjustments",
            json!({ "id": "l1", "hue": 4, "updatedAt": "2" }),
        ),
        (
            "updateText",
            json!({ "id": "l1", "content": "x", "updatedAt": "2" }),
        ),
        ("deleteLayer", json!({ "id": "l1" })),
        (
            "moveLayer",
            json!({ "id": "l1", "parentId": null, "layerIndex": 3, "updatedAt": "2" }),
        ),
        (
            "reorderLayers",
            json!({ "order": [["l1", 4]], "updatedAt": "2" }),
        ),
        ("bringToFront", json!({ "id": "l1", "updatedAt": "2" })),
        ("sendToBack", json!({ "id": "l1", "updatedAt": "2" })),
    ];
    for who in ["bob", "gus"] {
        for (method, args) in &writes {
            assert_eq!(
                code(t.as_(who).call(method, args.clone())),
                "ViewOnly",
                "{who} {method}"
            );
        }
        assert_eq!(code(t.as_(who).call("clearLayers", json!({}))), "OwnerOnly");
    }
    assert_eq!(get_layer(&mut t, "l1")["name"], json!("Layer"));
}

#[test]
fn deleting_a_group_reparents_only_its_own_children() {
    let mut t = app();
    add(&mut t, with(layer("outer"), "kind", json!("group")));
    add(
        &mut t,
        with(
            with(layer("inner"), "kind", json!("group")),
            "parentId",
            json!("outer"),
        ),
    );
    add(&mut t, with(layer("c1"), "parentId", json!("inner")));
    add(&mut t, with(layer("c2"), "parentId", json!("outer")));
    let _ = call(&mut t, "owner", "deleteLayer", json!({ "id": "inner" }));
    assert!(get_layer(&mut t, "c1").get("parentId").is_none());
    assert_eq!(get_layer(&mut t, "c2")["parentId"], json!("outer"));
    assert_eq!(get_layer(&mut t, "inner"), Value::Null);
}

#[test]
fn move_layers_reparents_a_selection_and_refuses_a_cycle() {
    let mut t = app();
    add(&mut t, with(layer("g1"), "kind", json!("group")));
    add(
        &mut t,
        with(
            with(layer("g2"), "kind", json!("group")),
            "parentId",
            json!("g1"),
        ),
    );
    add(&mut t, layer("a"));
    add(&mut t, layer("b"));
    let _ = call(
        &mut t,
        "owner",
        "moveLayers",
        json!({
            "moves": [["a", "g2"], ["b", "g2"], ["g1", "g2"], ["g2", "g2"], ["ghost", "g1"]],
            "updatedAt": "5"
        }),
    );
    assert_eq!(get_layer(&mut t, "a")["parentId"], json!("g2"));
    assert_eq!(get_layer(&mut t, "b")["parentId"], json!("g2"));
    // g1 under its own child, and g2 under itself: both skipped.
    assert!(get_layer(&mut t, "g1").get("parentId").is_none());
    assert_eq!(get_layer(&mut t, "g2")["parentId"], json!("g1"));
    assert_eq!(get_layer(&mut t, "ghost"), Value::Null);
    let _ = call(
        &mut t,
        "owner",
        "moveLayers",
        json!({ "moves": [["a", null]], "updatedAt": "6" }),
    );
    assert!(get_layer(&mut t, "a").get("parentId").is_none());
}

#[test]
fn layers_read_bottom_to_top() {
    let mut t = app();
    add(&mut t, with(layer("c"), "layerIndex", json!(0)));
    add(&mut t, with(layer("a"), "layerIndex", json!(2)));
    add(&mut t, with(layer("b"), "layerIndex", json!(1)));
    assert_eq!(layer_ids(&mut t), ["c", "b", "a"]);
    let _ = call(
        &mut t,
        "owner",
        "reorderLayers",
        json!({ "order": [["a", 0], ["c", 5]], "updatedAt": "2" }),
    );
    assert_eq!(layer_ids(&mut t), ["a", "b", "c"]);
    let _ = call(
        &mut t,
        "owner",
        "moveLayer",
        json!({ "id": "a", "parentId": "b", "layerIndex": 9, "updatedAt": "3" }),
    );
    let a = get_layer(&mut t, "a");
    assert_eq!((&a["parentId"], &a["layerIndex"]), (&json!("b"), &json!(9)));
}

#[test]
fn bring_to_front_and_send_to_back() {
    let mut t = app();
    add(&mut t, with(layer("a"), "layerIndex", json!(3)));
    add(&mut t, with(layer("b"), "layerIndex", json!(4)));
    add(&mut t, with(layer("c"), "layerIndex", json!(5)));
    let _ = call(
        &mut t,
        "owner",
        "bringToFront",
        json!({ "id": "a", "updatedAt": "2" }),
    );
    assert_eq!(layer_ids(&mut t), ["b", "c", "a"]);
    assert_eq!(get_layer(&mut t, "a")["layerIndex"], json!(6));
    // Room below the bottom: only this layer moves.
    let _ = call(
        &mut t,
        "owner",
        "sendToBack",
        json!({ "id": "c", "updatedAt": "3" }),
    );
    assert_eq!(get_layer(&mut t, "c")["layerIndex"], json!(3));
    assert_eq!(get_layer(&mut t, "b")["layerIndex"], json!(4));
}

#[test]
fn send_to_back_at_zero_shifts_the_rest() {
    let mut t = app();
    add(&mut t, with(layer("a"), "layerIndex", json!(0)));
    add(&mut t, with(layer("b"), "layerIndex", json!(1)));
    let _ = call(
        &mut t,
        "owner",
        "sendToBack",
        json!({ "id": "b", "updatedAt": "3" }),
    );
    assert_eq!(layer_ids(&mut t), ["b", "a"]);
    assert_eq!(get_layer(&mut t, "b")["layerIndex"], json!(0));
    assert_eq!(get_layer(&mut t, "a")["layerIndex"], json!(1));
}

#[test]
fn clear_layers_is_the_owners() {
    let mut t = app();
    add(&mut t, layer("a"));
    add(&mut t, layer("b"));
    assert_eq!(
        code(t.as_("ada").call("clearLayers", json!({}))),
        "OwnerOnly"
    );
    let _ = call(&mut t, "owner", "clearLayers", json!({}));
    assert!(layer_ids(&mut t).is_empty());
    assert_eq!(
        view(&mut t, "owner", "getDocument", json!({}))["layerCount"],
        json!(0)
    );
}

/// v1 merged two writes to one layer by `updatedAt`. One log orders them now:
/// the later call wins whatever clock it carries, and both members' layers
/// survive.
#[test]
fn every_editors_write_lands_and_the_later_one_wins() {
    let mut t = app();
    let _ = call(&mut t, "owner", "grantEditor", json!({ "member": "bob" }));
    add(&mut t, layer("shared"));
    let _ = call(&mut t, "bob", "addLayer", json!({ "layer": layer("bobs") }));
    let _ = call(
        &mut t,
        "bob",
        "updateLayer",
        json!({ "id": "shared", "name": "bob", "updatedAt": "100" }),
    );
    let _ = call(
        &mut t,
        "owner",
        "updateLayer",
        json!({ "id": "shared", "name": "owner", "updatedAt": "50" }),
    );
    assert_eq!(get_layer(&mut t, "shared")["name"], json!("owner"));
    assert_eq!(layer_ids(&mut t).len(), 2);
}

// ── cursors ──────────────────────────────────────────────────────────────────

#[test]
fn a_cursor_belongs_to_whoever_moved_it() {
    let mut t = app();
    let _ = call(
        &mut t,
        "gus",
        "updateCursor",
        json!({ "x": "10", "y": "-4", "updatedAt": "3" }),
    );
    let _ = call(
        &mut t,
        "gus",
        "updateCursor",
        json!({ "x": "80", "y": "80", "updatedAt": "4" }),
    );
    let _ = call(
        &mut t,
        "bob",
        "updateCursor",
        json!({ "x": "1", "y": "2", "updatedAt": "5" }),
    );
    let cursors = view(&mut t, "owner", "getCursors", json!({}));
    assert_eq!(
        cursors,
        json!([
            { "identity": "bob", "account": "bob", "x": 1, "y": 2, "updatedAt": 5 },
            { "identity": "gus", "account": "gus", "x": 80, "y": 80, "updatedAt": 4 },
        ])
    );
    assert!(t
        .events_for("cy")
        .iter()
        .any(|(n, d)| n == "CursorMoved" && d == &json!({ "identity": "gus" })));
}

// ── access and the wire ──────────────────────────────────────────────────────

#[test]
fn outsiders_and_anonymous_callers_are_refused_by_the_node() {
    let mut t = app();
    assert!(matches!(
        t.anonymous().view("getDocument", json!({})),
        Err(Failure::Refused { status: 401, .. })
    ));
    assert!(matches!(
        t.as_("mallory").view("getLayers", json!({})),
        Err(Failure::Refused { status: 404, .. })
    ));
    assert!(matches!(
        t.as_("mallory").call(
            "join",
            json!({ "username": "m", "avatar": null, "timestamp": "1" })
        ),
        Err(Failure::Refused { status: 404, .. })
    ));
}

#[test]
fn wire_checks() {
    let mut t = app();
    assert_eq!(
        code(
            t.as_("owner")
                .call("add_layer", json!({ "layer": layer("x") }))
        ),
        "UnknownMethod"
    );
    assert_eq!(
        code(
            t.as_("owner")
                .view("addLayer", json!({ "layer": layer("x") }))
        ),
        "NotAView"
    );
    // u64 arguments are decimal strings; v1's snake_case names are unknown keys.
    assert_eq!(
        code(t.as_("owner").call(
            "updateCursor",
            json!({ "x": "1", "y": "1", "updatedAt": 3 })
        )),
        "BadArgs"
    );
    assert_eq!(
        code(t.as_("owner").call(
            "updateCursor",
            json!({ "x": "1", "y": "1", "updated_at": "3" })
        )),
        "BadArgs"
    );
}
