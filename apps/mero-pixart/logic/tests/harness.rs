//! MeroPixArt on core's real wasmtime engine (`TestApp`): v1's `TestHost` tests
//! method for method, v1's merge and forged-write tests as what they become
//! under one log and method checks, the tiled pixels and the exports (blobs),
//! and the access and wire checks v1 could not express.

#![cfg(not(target_arch = "wasm32"))]

mod common;

use calimero_app_sdk::testing::{Failure, Org, TestApp};
use serde_json::{json, Value};

/// The owner (the document's admin), members `bob` and `cy`, a guest `gus`.
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

fn layer_json(id: &str, kind: &str, index: u32) -> Value {
    json!({
        "id": id,
        "name": "Layer",
        "kind": kind,
        "parentId": null,
        "layerIndex": index,
        "visible": true,
        "locked": false,
        "opacity": 100,
        "blendMode": "normal",
        "x": "0",
        "y": "0",
        "width": 100,
        "height": 100,
        "rotation": 0,
        "scaleX": 100,
        "scaleY": 100,
        "fill": "",
        "adjustments": {},
        "text": null,
        // what a v1 client still sends: ignored
        "blobId": "",
        "createdBy": "someone-else",
        "createdAt": "1",
        "updatedAt": "1",
    })
}

fn add(t: &mut TestApp, who: &str, id: &str, index: u32) -> Result<Value, Failure> {
    t.as_(who).call(
        "addLayer",
        json!({ "layer": layer_json(id, "raster", index) }),
    )
}

fn add_group(t: &mut TestApp, id: &str, parent: Option<&str>, index: u32) {
    let mut l = layer_json(id, "group", index);
    l["parentId"] = json!(parent);
    call(t, "owner", "addLayer", json!({ "layer": l }));
}

fn layer(t: &mut TestApp, id: &str) -> Value {
    view(t, "owner", "getLayer", json!({ "id": id }))
}

fn layers(t: &mut TestApp) -> Vec<Value> {
    view(t, "owner", "getLayers", json!({}))["items"]
        .as_array()
        .expect("items")
        .clone()
}

fn layer_ids(t: &mut TestApp) -> Vec<String> {
    layers(t)
        .iter()
        .map(|l| l["id"].as_str().expect("id").to_owned())
        .collect()
}

fn tiles(t: &mut TestApp, id: &str, mask: bool) -> Vec<Value> {
    view(t, "bob", "getLayerTiles", json!({ "id": id, "mask": mask }))["items"]
        .as_array()
        .expect("items")
        .clone()
}

fn png(t: &mut TestApp, seed: u8) -> String {
    t.upload_blob(&[0x89, b'P', b'N', b'G', seed], "image/png")
}

fn write(
    t: &mut TestApp,
    who: &str,
    id: &str,
    w: u32,
    h: u32,
    tiles: Value,
) -> Result<Value, Failure> {
    t.as_(who).call(
        "updateLayerContent",
        json!({ "id": id, "width": w, "height": h, "tiles": tiles, "updatedAt": "5" }),
    )
}

fn names(t: &TestApp, who: &str) -> Vec<String> {
    t.events_for(who).into_iter().map(|(n, _)| n).collect()
}

// ── roles and the document ───────────────────────────────────────────────────

#[test]
fn creator_is_admin_and_can_edit() {
    let mut t = app();
    assert_eq!(view(&mut t, "owner", "myRole", json!({})), json!("admin"));
    assert_eq!(view(&mut t, "owner", "canEdit", json!({})), json!(true));
    assert_eq!(view(&mut t, "bob", "myRole", json!({})), json!("viewer"));
    assert_eq!(view(&mut t, "bob", "canEdit", json!({})), json!(false));
}

#[test]
fn document_defaults_and_resize() {
    let mut t = app();
    let doc = view(&mut t, "bob", "getDocument", json!({}));
    assert_eq!(
        doc,
        json!({
            "name": "", "description": "", "width": 1280, "height": 720,
            "background": "#00000000", "layerCount": 0, "memberCount": 0, "owner": "owner",
        })
    );
    call(
        &mut t,
        "owner",
        "updateDocument",
        json!({ "name": "Poster", "description": "d", "width": 1024, "height": 768 }),
    );
    let doc = view(&mut t, "bob", "getDocument", json!({}));
    assert_eq!(doc["name"], json!("Poster"));
    assert_eq!(doc["description"], json!("d"));
    assert_eq!(
        (doc["width"].clone(), doc["height"].clone()),
        (json!(1024), json!(768))
    );
    assert_eq!(doc["background"], json!("#00000000"), "untouched");
    assert_eq!(names(&t, "bob"), ["DocumentUpdated"]);
    // A size outside 1..=8192 is refused and changes nothing.
    for (w, h) in [(0, 10), (10, 8193)] {
        let r = t
            .as_("owner")
            .call("updateDocument", json!({ "width": w, "height": h }));
        assert_eq!(code(r), "Invalid");
    }
    assert_eq!(
        view(&mut t, "bob", "getDocument", json!({}))["width"],
        json!(1024)
    );
}

#[test]
fn only_owner_changes_the_document_even_as_an_editor() {
    let mut t = app();
    call(&mut t, "owner", "grantEditor", json!({ "member": "bob" }));
    let r = t
        .as_("bob")
        .call("updateDocument", json!({ "name": "mine" }));
    assert_eq!(code(r), "Forbidden");
    let r = t.as_("bob").call("updateDocument", json!({ "width": 10 }));
    assert_eq!(code(r), "Forbidden");
    assert_eq!(
        view(&mut t, "bob", "getDocument", json!({}))["name"],
        json!("")
    );
}

#[test]
fn viewer_cannot_edit_editor_can() {
    let mut t = app();
    call(
        &mut t,
        "bob",
        "join",
        json!({ "username": "bob", "avatar": null, "timestamp": "1" }),
    );
    assert_eq!(code(add(&mut t, "bob", "l1", 0)), "Forbidden");
    assert!(layers(&mut t).is_empty());

    call(&mut t, "owner", "grantEditor", json!({ "member": "bob" }));
    assert_eq!(
        view(&mut t, "cy", "getRole", json!({ "member": "bob" })),
        json!("editor")
    );
    add(&mut t, "bob", "l1", 0).expect("an editor adds");
    assert_eq!(layers(&mut t).len(), 1);
    assert_eq!(
        layer(&mut t, "l1")["createdBy"],
        json!("bob"),
        "the caller, not the client's field"
    );

    call(&mut t, "owner", "revokeEditor", json!({ "member": "bob" }));
    let r = t.as_("bob").call("deleteLayer", json!({ "id": "l1" }));
    assert_eq!(code(r), "Forbidden");
    assert_eq!(layers(&mut t).len(), 1);
    assert_eq!(
        view(&mut t, "bob", "getRole", json!({ "member": "bob" })),
        json!("viewer")
    );
}

/// A member can be granted before they ever open the document.
#[test]
fn a_member_can_be_granted_before_they_ever_open_the_document() {
    let mut t = app();
    call(&mut t, "owner", "grantEditor", json!({ "member": "cy" }));
    assert_eq!(
        view(&mut t, "owner", "getRole", json!({ "member": "cy" })),
        json!("editor")
    );
    // `listRoles` lists the roster, which cy is not on yet.
    let roles = view(&mut t, "owner", "listRoles", json!({}));
    assert_eq!(roles, json!({ "items": [], "next": null }));
}

/// v1 refused a malformed member id; here a grant names an account of the
/// document's organization.
#[test]
fn grants_and_transfers_name_an_account_of_the_organization() {
    let mut t = app();
    for (method, arg) in [("grantEditor", "member"), ("transferOwnership", "newOwner")] {
        for who in ["mallory", ""] {
            let r = t.as_("owner").call(method, json!({ arg: who }));
            assert_eq!(code(r), "Invalid", "{method} {who:?}");
        }
    }
    // A guest is in the organization.
    call(&mut t, "owner", "grantEditor", json!({ "member": "gus" }));
    assert_eq!(view(&mut t, "gus", "canEdit", json!({})), json!(true));
}

#[test]
fn non_admin_cannot_grant_roles() {
    let mut t = app();
    call(&mut t, "owner", "grantEditor", json!({ "member": "bob" }));
    for method in ["grantEditor", "revokeEditor"] {
        let r = t.as_("bob").call(method, json!({ "member": "cy" }));
        assert_eq!(code(r), "Forbidden", "{method}");
    }
    assert_eq!(
        view(&mut t, "owner", "getRole", json!({ "member": "cy" })),
        json!("viewer")
    );
}

#[test]
fn ownership_transfer_moves_control() {
    let mut t = app();
    call(
        &mut t,
        "owner",
        "transferOwnership",
        json!({ "newOwner": "bob" }),
    );
    assert_eq!(
        view(&mut t, "cy", "getDocument", json!({}))["owner"],
        json!("bob")
    );
    assert_eq!(view(&mut t, "bob", "myRole", json!({})), json!("admin"));
    assert_eq!(view(&mut t, "owner", "myRole", json!({})), json!("viewer"));
    // The old owner lost every owner right, the new one has them.
    let r = t
        .as_("owner")
        .call("updateDocument", json!({ "name": "x" }));
    assert_eq!(code(r), "Forbidden");
    assert_eq!(code(add(&mut t, "owner", "l", 0)), "Forbidden");
    call(&mut t, "bob", "updateDocument", json!({ "name": "Bob's" }));
    add(&mut t, "bob", "l", 0).expect("the new admin edits");
    call(&mut t, "bob", "grantEditor", json!({ "member": "owner" }));
    assert_eq!(view(&mut t, "owner", "canEdit", json!({})), json!(true));
    let r = t
        .as_("owner")
        .call("transferOwnership", json!({ "newOwner": "owner" }));
    assert_eq!(code(r), "Forbidden");
    assert_eq!(names(&t, "cy")[0], "OwnerTransferred");
}

// ── members ──────────────────────────────────────────────────────────────────

#[test]
fn join_uses_signer_identity_not_client_arg() {
    let mut t = app();
    call(
        &mut t,
        "owner",
        "join",
        json!({ "username": "alice", "avatar": null, "timestamp": "7" }),
    );
    let members = view(&mut t, "bob", "getMembers", json!({}));
    assert_eq!(
        members,
        json!({ "items": [{
            "id": "owner", "username": "alice", "avatar": null,
            "joinedAt": "7", "usernameUpdatedAt": "7",
        }], "next": null })
    );
    assert_eq!(
        view(&mut t, "bob", "getDocument", json!({}))["memberCount"],
        json!(1)
    );
    assert_eq!(names(&t, "bob"), ["MemberJoined"]);
}

/// v1 keyed the roster by account so a second device did not add a second
/// member; here an account joins once, and a second `join` changes nothing.
#[test]
fn joining_twice_keeps_one_membership() {
    let mut t = app();
    call(
        &mut t,
        "bob",
        "join",
        json!({ "username": "bob", "avatar": null, "timestamp": "1" }),
    );
    call(
        &mut t,
        "bob",
        "join",
        json!({ "username": "other", "avatar": "a", "timestamp": "2" }),
    );
    let members = view(&mut t, "owner", "getMembers", json!({}))["items"].clone();
    assert_eq!(members.as_array().map(Vec::len), Some(1));
    assert_eq!(members[0]["username"], json!("bob"));
    assert_eq!(names(&t, "owner"), ["MemberJoined"]);
}

/// v1 kept each roster entry in `UserStorage`, so nobody could rename anyone
/// else; here `updateMemberUsername` only ever writes the caller's own entry.
#[test]
fn nobody_renames_another_member() {
    let mut t = app();
    call(
        &mut t,
        "bob",
        "join",
        json!({ "username": "bob", "avatar": null, "timestamp": "1" }),
    );
    // cy is not on the roster: nothing happens, bob's name stands.
    call(
        &mut t,
        "cy",
        "updateMemberUsername",
        json!({ "username": "hacked", "timestamp": "9" }),
    );
    call(
        &mut t,
        "bob",
        "updateMemberUsername",
        json!({ "username": "Bobby", "timestamp": "3" }),
    );
    let members = view(&mut t, "owner", "getMembers", json!({}))["items"].clone();
    assert_eq!(members.as_array().map(Vec::len), Some(1));
    assert_eq!(members[0]["username"], json!("Bobby"));
    assert_eq!(members[0]["usernameUpdatedAt"], json!("3"));
    assert_eq!(members[0]["joinedAt"], json!("1"));
}

#[test]
fn list_roles_pairs_the_roster_with_roles() {
    let mut t = app();
    for who in ["owner", "bob", "cy"] {
        call(
            &mut t,
            who,
            "join",
            json!({ "username": who, "avatar": null, "timestamp": "1" }),
        );
    }
    call(&mut t, "owner", "grantEditor", json!({ "member": "bob" }));
    let roles = view(&mut t, "gus", "listRoles", json!({ "limit": 2 }));
    assert_eq!(
        roles["items"],
        json!([{ "member": "bob", "role": "editor" }, { "member": "cy", "role": "viewer" }])
    );
    let next = roles["next"].clone();
    assert!(next.is_string());
    let rest = view(
        &mut t,
        "gus",
        "listRoles",
        json!({ "cursor": next, "limit": 2 }),
    );
    assert_eq!(
        rest,
        json!({ "items": [{ "member": "owner", "role": "admin" }], "next": null })
    );
}

// ── layers ───────────────────────────────────────────────────────────────────

#[test]
fn a_layer_round_trips_in_v1_shape() {
    let mut t = app();
    let id = add(&mut t, "owner", "l1", 3).expect("add");
    assert_eq!(id, json!("l1"));
    let l = layer(&mut t, "l1");
    assert_eq!(l["kind"], json!("raster"));
    assert_eq!(l["layerIndex"], json!(3));
    assert_eq!(l["x"], json!("0"), "i64 as a decimal string");
    assert_eq!(l["createdAt"], json!("1"));
    assert_eq!(l["pixelsRev"], json!("0"));
    assert_eq!(l["hasMask"], json!(false));
    assert_eq!(
        l["adjustments"],
        json!({ "brightness": 0, "contrast": 0, "saturation": 0, "hue": 0, "exposure": 0,
                "blur": 0, "invert": false, "curves": "" })
    );
    assert_eq!(l["text"], json!(null));
    assert!(l.get("blobId").is_none());
    assert_eq!(layer(&mut t, "nope"), json!(null));
    assert_eq!(
        view(&mut t, "bob", "getDocument", json!({}))["layerCount"],
        json!(1)
    );
    assert_eq!(names(&t, "bob"), ["LayerAdded"]);
}

#[test]
fn update_layer_patches_only_what_it_is_given() {
    let mut t = app();
    add(&mut t, "owner", "l1", 0).expect("add");
    call(
        &mut t,
        "owner",
        "updateLayer",
        json!({ "id": "l1", "name": "Renamed", "opacity": 50, "x": "-12", "updatedAt": "9" }),
    );
    let l = layer(&mut t, "l1");
    assert_eq!(l["name"], json!("Renamed"));
    assert_eq!(l["opacity"], json!(50));
    assert_eq!(l["x"], json!("-12"));
    assert_eq!(l["visible"], json!(true), "untouched");
    assert_eq!(l["updatedAt"], json!("9"));
    // An unknown id changes nothing and emits nothing.
    call(
        &mut t,
        "owner",
        "updateLayer",
        json!({ "id": "nope", "updatedAt": "9" }),
    );
    assert_eq!(names(&t, "bob"), ["LayerAdded", "LayerUpdated"]);
}

#[test]
fn adjustments_and_text_update() {
    let mut t = app();
    add(&mut t, "owner", "l1", 0).expect("add");
    call(
        &mut t,
        "owner",
        "updateAdjustments",
        json!({ "id": "l1", "brightness": 20, "invert": true, "curves": "{\"r\":[]}", "updatedAt": "2" }),
    );
    let a = layer(&mut t, "l1")["adjustments"].clone();
    assert_eq!(a["brightness"], json!(20));
    assert_eq!(a["invert"], json!(true));
    assert_eq!(a["curves"], json!("{\"r\":[]}"));
    assert_eq!(a["contrast"], json!(0));

    call(
        &mut t,
        "owner",
        "updateText",
        json!({ "id": "l1", "content": "Hello", "bold": true, "updatedAt": "3" }),
    );
    assert_eq!(
        layer(&mut t, "l1")["text"],
        json!({ "content": "Hello", "fontFamily": "Inter", "fontSize": 48, "color": "#ffffff",
                "bold": true, "italic": false, "align": null })
    );
    call(
        &mut t,
        "owner",
        "updateText",
        json!({ "id": "l1", "align": "center", "updatedAt": "4" }),
    );
    let text = layer(&mut t, "l1")["text"].clone();
    assert_eq!(text["align"], json!("center"));
    assert_eq!(text["content"], json!("Hello"));
}

#[test]
fn update_transform_patches_only_what_it_is_given() {
    let mut t = app();
    add(&mut t, "owner", "l1", 0).expect("add");
    call(
        &mut t,
        "owner",
        "updateTransform",
        json!({ "id": "l1", "rotation": 30, "flipH": true, "warp": "{\"tl\":[1,2]}", "updatedAt": "2" }),
    );
    let l = layer(&mut t, "l1");
    assert_eq!(l["rotation"], json!(30));
    assert_eq!(l["flipH"], json!(true));
    assert_eq!(l["flipV"], json!(false));
    assert_eq!(l["scaleX"], json!(100));
    assert_eq!(l["warp"], json!("{\"tl\":[1,2]}"));
    // Skew is clamped to a renderable range.
    call(
        &mut t,
        "owner",
        "updateTransform",
        json!({ "id": "l1", "skewX": 200, "skewY": -95, "updatedAt": "3" }),
    );
    let l = layer(&mut t, "l1");
    assert_eq!(
        (l["skewX"].clone(), l["skewY"].clone()),
        (json!(80), json!(-80))
    );
    // An empty warp clears it.
    call(
        &mut t,
        "owner",
        "updateTransform",
        json!({ "id": "l1", "warp": "", "updatedAt": "4" }),
    );
    assert_eq!(layer(&mut t, "l1")["warp"], json!(""));
    assert_eq!(layer(&mut t, "l1")["rotation"], json!(30));
}

#[test]
fn viewer_cannot_transform_a_layer() {
    let mut t = app();
    add(&mut t, "owner", "l1", 0).expect("add");
    let r = t.as_("bob").call(
        "updateTransform",
        json!({ "id": "l1", "rotation": 90, "updatedAt": "2" }),
    );
    assert_eq!(code(r), "Forbidden");
    assert_eq!(layer(&mut t, "l1")["rotation"], json!(0));
}

/// v1's last-writer-wins merge on `updatedAt`: one log orders every write, so
/// the later write is simply the one that holds.
#[test]
fn the_later_write_holds() {
    let mut t = app();
    call(&mut t, "owner", "grantEditor", json!({ "member": "bob" }));
    add(&mut t, "owner", "l1", 0).expect("add");
    call(
        &mut t,
        "owner",
        "updateLayer",
        json!({ "id": "l1", "name": "A", "updatedAt": "10" }),
    );
    call(
        &mut t,
        "bob",
        "updateLayer",
        json!({ "id": "l1", "name": "B", "updatedAt": "5" }),
    );
    assert_eq!(layer(&mut t, "l1")["name"], json!("B"));
}

#[test]
fn layers_answer_bottom_to_top_a_page_at_a_time() {
    let mut t = app();
    for (id, index) in [("c", 2), ("a", 0), ("b", 1)] {
        add(&mut t, "owner", id, index).expect("add");
    }
    assert_eq!(layer_ids(&mut t), ["a", "b", "c"]);
    let first = view(&mut t, "owner", "getLayers", json!({ "limit": 2 }));
    assert_eq!(first["items"].as_array().map(Vec::len), Some(2));
    let rest = view(
        &mut t,
        "owner",
        "getLayers",
        json!({ "cursor": first["next"], "limit": 2 }),
    );
    assert_eq!(rest["items"][0]["id"], json!("c"));
    assert_eq!(rest["next"], json!(null));
}

#[test]
fn adding_an_existing_id_replaces_the_layer_and_its_pixels() {
    let mut t = app();
    add(&mut t, "owner", "l1", 0).expect("add");
    let b = png(&mut t, 1);
    write(
        &mut t,
        "owner",
        "l1",
        100,
        100,
        json!([{ "tx": 0, "ty": 0, "blobId": b }]),
    )
    .expect("write");
    let mut again = layer_json("l1", "fill", 4);
    again["fill"] = json!("#ff0000");
    call(&mut t, "owner", "addLayer", json!({ "layer": again }));
    let l = layer(&mut t, "l1");
    assert_eq!(
        (l["kind"].clone(), l["pixelsRev"].clone()),
        (json!("fill"), json!("0"))
    );
    assert!(tiles(&mut t, "l1", false).is_empty());
    assert_eq!(t.blob_refs(&b), 0);
    assert_eq!(
        view(&mut t, "bob", "getDocument", json!({}))["layerCount"],
        json!(1)
    );
}

#[test]
fn a_document_holds_at_most_500_layers() {
    let mut t = app();
    for i in 0..500 {
        add(&mut t, "owner", &format!("l{i}"), i).expect("add");
    }
    let r = add(&mut t, "owner", "one-too-many", 0);
    assert_eq!(code(r), "TooMany");
    // Replacing one still works.
    add(&mut t, "owner", "l7", 7).expect("a replace is not a new layer");
}

#[test]
fn bad_layers_are_refused() {
    let mut t = app();
    let mut bad_kind = layer_json("k", "sticker", 0);
    bad_kind["kind"] = json!("sticker");
    let mut too_big = layer_json("b", "raster", 0);
    too_big["width"] = json!(8193);
    let no_id = layer_json("", "raster", 0);
    for l in [bad_kind, too_big, no_id] {
        let r = t.as_("owner").call("addLayer", json!({ "layer": l }));
        assert_eq!(code(r), "Invalid");
    }
    assert!(layers(&mut t).is_empty());
}

// ── pixels: tiles ────────────────────────────────────────────────────────────

#[test]
fn a_stroke_writes_only_the_tiles_it_changed() {
    let mut t = app();
    add(&mut t, "owner", "l1", 0).expect("add");
    let (a, b, c) = (png(&mut t, 1), png(&mut t, 2), png(&mut t, 3));
    // A 600 x 300 raster: 3 x 2 tiles.
    write(
        &mut t,
        "owner",
        "l1",
        600,
        300,
        json!([{ "tx": 0, "ty": 0, "blobId": a }, { "tx": 2, "ty": 1, "blobId": b }]),
    )
    .expect("first write");
    let l = layer(&mut t, "l1");
    assert_eq!(
        (l["width"].clone(), l["height"].clone()),
        (json!(600), json!(300))
    );
    assert_eq!(l["pixelsRev"], json!("1"));
    assert_eq!(l["updatedAt"], json!("5"));

    // The stroke touches one tile.
    write(
        &mut t,
        "owner",
        "l1",
        600,
        300,
        json!([{ "tx": 0, "ty": 0, "blobId": c }]),
    )
    .expect("stroke");
    assert_eq!(
        tiles(&mut t, "l1", false),
        [
            json!({ "tx": 0, "ty": 0, "blobId": c }),
            json!({ "tx": 2, "ty": 1, "blobId": b }),
        ]
    );
    assert_eq!(layer(&mut t, "l1")["pixelsRev"], json!("2"));
    assert_eq!(
        t.blob_refs(&a),
        0,
        "the replaced tile no longer holds its blob"
    );
    assert_eq!(t.blob_refs(&c), 1);

    // An erased (now empty) tile is removed.
    write(
        &mut t,
        "owner",
        "l1",
        600,
        300,
        json!([{ "tx": 2, "ty": 1, "blobId": null }]),
    )
    .expect("erase");
    assert_eq!(
        tiles(&mut t, "l1", false),
        [json!({ "tx": 0, "ty": 0, "blobId": c })]
    );
    assert_eq!(
        names(&t, "cy"),
        ["LayerAdded", "LayerUpdated", "LayerUpdated", "LayerUpdated"]
    );
}

#[test]
fn shrinking_a_raster_drops_the_tiles_outside_it() {
    let mut t = app();
    add(&mut t, "owner", "l1", 0).expect("add");
    let (a, b) = (png(&mut t, 1), png(&mut t, 2));
    write(
        &mut t,
        "owner",
        "l1",
        512,
        512,
        json!([{ "tx": 0, "ty": 0, "blobId": a }, { "tx": 1, "ty": 1, "blobId": b }]),
    )
    .expect("write");
    // A crop to 256 x 300 keeps column 0 only.
    write(&mut t, "owner", "l1", 256, 300, json!([])).expect("crop");
    assert_eq!(
        tiles(&mut t, "l1", false),
        [json!({ "tx": 0, "ty": 0, "blobId": a })]
    );
}

#[test]
fn tile_writes_are_checked() {
    let mut t = app();
    add(&mut t, "owner", "l1", 0).expect("add");
    let a = png(&mut t, 1);
    // Outside the raster.
    let r = write(
        &mut t,
        "owner",
        "l1",
        256,
        256,
        json!([{ "tx": 1, "ty": 0, "blobId": a }]),
    );
    assert_eq!(code(r), "Invalid");
    // A blob the app does not hold, or not a blob id at all.
    for id in ["ab".repeat(32), "nope".to_owned()] {
        let r = write(
            &mut t,
            "owner",
            "l1",
            256,
            256,
            json!([{ "tx": 0, "ty": 0, "blobId": id }]),
        );
        assert_eq!(code(r), "UnknownBlob", "{id}");
    }
    // Sizes.
    let r = write(&mut t, "owner", "l1", 0, 256, json!([]));
    assert_eq!(code(r), "Invalid");
    let r = write(&mut t, "owner", "l1", 9000, 256, json!([]));
    assert_eq!(code(r), "Invalid");
    // An unknown layer.
    let r = write(&mut t, "owner", "nope", 256, 256, json!([]));
    assert_eq!(code(r), "NotFound");
    // A viewer.
    let r = write(
        &mut t,
        "bob",
        "l1",
        256,
        256,
        json!([{ "tx": 0, "ty": 0, "blobId": a }]),
    );
    assert_eq!(code(r), "Forbidden");
    assert!(tiles(&mut t, "l1", false).is_empty());
    assert_eq!(layer(&mut t, "l1")["pixelsRev"], json!("0"));
    let r = t.as_("bob").view("getLayerTiles", json!({ "id": "nope" }));
    assert_eq!(code(r), "NotFound");
}

#[test]
fn a_mask_is_set_painted_and_cleared() {
    let mut t = app();
    add(&mut t, "owner", "l1", 0).expect("add");
    let (m1, m2) = (png(&mut t, 7), png(&mut t, 8));
    call(
        &mut t,
        "owner",
        "updateLayerMask",
        json!({ "id": "l1", "tiles": [{ "tx": 0, "ty": 0, "blobId": m1 }], "updatedAt": "2" }),
    );
    let l = layer(&mut t, "l1");
    assert_eq!(
        (l["hasMask"].clone(), l["maskRev"].clone()),
        (json!(true), json!("1"))
    );
    assert_eq!(
        tiles(&mut t, "l1", true),
        [json!({ "tx": 0, "ty": 0, "blobId": m1 })]
    );
    assert!(
        tiles(&mut t, "l1", false).is_empty(),
        "the pixels are another plane"
    );
    call(
        &mut t,
        "owner",
        "updateLayerMask",
        json!({ "id": "l1", "tiles": [{ "tx": 0, "ty": 0, "blobId": m2 }], "updatedAt": "3" }),
    );
    assert_eq!(
        tiles(&mut t, "l1", true),
        [json!({ "tx": 0, "ty": 0, "blobId": m2 })]
    );
    call(
        &mut t,
        "owner",
        "updateLayerMask",
        json!({ "id": "l1", "tiles": null, "updatedAt": "4" }),
    );
    let l = layer(&mut t, "l1");
    assert_eq!(
        (l["hasMask"].clone(), l["maskRev"].clone()),
        (json!(false), json!("3"))
    );
    assert!(tiles(&mut t, "l1", true).is_empty());
    assert_eq!(t.blob_refs(&m2), 0);
    // The mask covers the layer's own 100 x 100: one tile.
    let r = t.as_("owner").call(
        "updateLayerMask",
        json!({ "id": "l1", "tiles": [{ "tx": 1, "ty": 0, "blobId": m1 }], "updatedAt": "5" }),
    );
    assert_eq!(code(r), "Invalid");
}

#[test]
fn tiles_load_a_page_at_a_time() {
    let mut t = app();
    add(&mut t, "owner", "l1", 0).expect("add");
    let mut writes = Vec::new();
    for tx in 0..4u32 {
        for ty in 0..4u32 {
            let b = png(&mut t, (tx * 4 + ty) as u8);
            writes.push(json!({ "tx": tx, "ty": ty, "blobId": b }));
        }
    }
    write(&mut t, "owner", "l1", 1024, 1024, json!(writes)).expect("write");
    let mut seen = 0;
    let mut cursor = json!(null);
    loop {
        let page = view(
            &mut t,
            "owner",
            "getLayerTiles",
            json!({ "id": "l1", "cursor": cursor, "limit": 5 }),
        );
        seen += page["items"].as_array().map_or(0, Vec::len);
        if page["next"].is_null() {
            break;
        }
        cursor = page["next"].clone();
    }
    assert_eq!(seen, 16);
}

// ── tree and stack ───────────────────────────────────────────────────────────

#[test]
fn deleting_group_reparents_children_and_drops_pixels() {
    let mut t = app();
    add_group(&mut t, "g", None, 0);
    let mut child = layer_json("c", "raster", 1);
    child["parentId"] = json!("g");
    call(&mut t, "owner", "addLayer", json!({ "layer": child }));
    let b = png(&mut t, 1);
    write(
        &mut t,
        "owner",
        "g",
        256,
        256,
        json!([{ "tx": 0, "ty": 0, "blobId": b }]),
    )
    .expect("write");
    call(&mut t, "owner", "deleteLayer", json!({ "id": "g" }));
    assert_eq!(layer_ids(&mut t), ["c"]);
    assert_eq!(layer(&mut t, "c")["parentId"], json!(null));
    assert_eq!(t.blob_refs(&b), 0);
    // Deleting what is not there is not an error.
    call(&mut t, "owner", "deleteLayer", json!({ "id": "g" }));
}

#[test]
fn deleting_a_nested_group_only_reparents_its_own_children() {
    let mut t = app();
    add_group(&mut t, "outer", None, 0);
    add_group(&mut t, "inner", Some("outer"), 1);
    let mut leaf = layer_json("leaf", "raster", 2);
    leaf["parentId"] = json!("inner");
    call(&mut t, "owner", "addLayer", json!({ "layer": leaf }));
    let mut sibling = layer_json("sib", "raster", 3);
    sibling["parentId"] = json!("outer");
    call(&mut t, "owner", "addLayer", json!({ "layer": sibling }));
    call(&mut t, "owner", "deleteLayer", json!({ "id": "inner" }));
    assert_eq!(layer(&mut t, "leaf")["parentId"], json!(null));
    assert_eq!(layer(&mut t, "sib")["parentId"], json!("outer"));
}

#[test]
fn move_layers_reparents_a_whole_selection_at_once() {
    let mut t = app();
    add_group(&mut t, "g", None, 0);
    add(&mut t, "owner", "a", 1).expect("add");
    add(&mut t, "owner", "b", 2).expect("add");
    call(
        &mut t,
        "owner",
        "moveLayers",
        json!({ "moves": [["a", "g"], ["b", "g"]], "updatedAt": "4" }),
    );
    assert_eq!(layer(&mut t, "a")["parentId"], json!("g"));
    assert_eq!(layer(&mut t, "b")["parentId"], json!("g"));
    assert_eq!(layer(&mut t, "b")["updatedAt"], json!("4"));
    call(
        &mut t,
        "owner",
        "moveLayers",
        json!({ "moves": [["a", null]], "updatedAt": "5" }),
    );
    assert_eq!(layer(&mut t, "a")["parentId"], json!(null));
    assert_eq!(
        names(&t, "bob").last().map(String::as_str),
        Some("LayersReordered")
    );
}

#[test]
fn move_layers_refuses_to_close_a_cycle() {
    let mut t = app();
    add_group(&mut t, "outer", None, 0);
    add_group(&mut t, "inner", Some("outer"), 1);
    call(
        &mut t,
        "owner",
        "moveLayers",
        json!({ "moves": [["outer", "inner"], ["inner", "inner"]], "updatedAt": "2" }),
    );
    assert_eq!(layer(&mut t, "outer")["parentId"], json!(null));
    assert_eq!(layer(&mut t, "inner")["parentId"], json!("outer"));
}

#[test]
fn move_layers_is_editor_gated_and_skips_unknown_ids() {
    let mut t = app();
    add(&mut t, "owner", "a", 0).expect("add");
    let r = t.as_("bob").call(
        "moveLayers",
        json!({ "moves": [["a", "x"]], "updatedAt": "2" }),
    );
    assert_eq!(code(r), "Forbidden");
    call(
        &mut t,
        "owner",
        "moveLayers",
        json!({ "moves": [["ghost", null]], "updatedAt": "2" }),
    );
    assert_eq!(layer_ids(&mut t), ["a"]);
}

#[test]
fn move_layer_and_reorder() {
    let mut t = app();
    add_group(&mut t, "g", None, 0);
    add(&mut t, "owner", "a", 1).expect("add");
    add(&mut t, "owner", "b", 2).expect("add");
    call(
        &mut t,
        "owner",
        "moveLayer",
        json!({ "id": "a", "parentId": "g", "layerIndex": 9, "updatedAt": "2" }),
    );
    let a = layer(&mut t, "a");
    assert_eq!(
        (a["parentId"].clone(), a["layerIndex"].clone()),
        (json!("g"), json!(9))
    );
    call(
        &mut t,
        "owner",
        "reorderLayers",
        json!({ "order": [["a", 0], ["b", 1], ["g", 2]], "updatedAt": "3" }),
    );
    assert_eq!(layer_ids(&mut t), ["a", "b", "g"]);
    let too_many: Vec<Value> = (0..501).map(|i| json!([format!("x{i}"), i])).collect();
    let r = t.as_("owner").call(
        "reorderLayers",
        json!({ "order": too_many, "updatedAt": "3" }),
    );
    assert_eq!(code(r), "Invalid");
}

#[test]
fn bring_to_front_goes_one_above_the_top() {
    let mut t = app();
    add(&mut t, "owner", "a", 0).expect("add");
    add(&mut t, "owner", "b", 5).expect("add");
    call(
        &mut t,
        "owner",
        "bringToFront",
        json!({ "id": "a", "updatedAt": "2" }),
    );
    assert_eq!(layer(&mut t, "a")["layerIndex"], json!(6));
    assert_eq!(layer_ids(&mut t), ["b", "a"]);
}

#[test]
fn send_to_back_with_room_below_moves_only_that_layer() {
    let mut t = app();
    add(&mut t, "owner", "a", 3).expect("add");
    add(&mut t, "owner", "b", 5).expect("add");
    call(
        &mut t,
        "owner",
        "sendToBack",
        json!({ "id": "b", "updatedAt": "2" }),
    );
    assert_eq!(layer(&mut t, "b")["layerIndex"], json!(2));
    assert_eq!(layer(&mut t, "a")["layerIndex"], json!(3));
    assert_eq!(layer(&mut t, "a")["updatedAt"], json!("1"), "untouched");
}

#[test]
fn send_to_back_at_zero_still_shifts_the_rest() {
    let mut t = app();
    add(&mut t, "owner", "a", 0).expect("add");
    add(&mut t, "owner", "b", 1).expect("add");
    add(&mut t, "owner", "c", 2).expect("add");
    call(
        &mut t,
        "owner",
        "sendToBack",
        json!({ "id": "c", "updatedAt": "2" }),
    );
    assert_eq!(layer_ids(&mut t), ["c", "a", "b"]);
    assert_eq!(layer(&mut t, "c")["layerIndex"], json!(0));
    assert_eq!(layer(&mut t, "a")["layerIndex"], json!(1));
    assert_eq!(layer(&mut t, "b")["layerIndex"], json!(2));
}

#[test]
fn clear_layers_is_the_owners_and_works_in_batches() {
    let mut t = app();
    call(&mut t, "owner", "grantEditor", json!({ "member": "bob" }));
    let r = t.as_("bob").call("clearLayers", json!({}));
    assert_eq!(code(r), "Forbidden");
    // Three full 8192 x 8192 rasters: 3 x 1,024 tiles, over one call's budget.
    let blob = png(&mut t, 1);
    let full: Vec<Value> = (0..32u32)
        .flat_map(|tx| (0..32u32).map(move |ty| (tx, ty)))
        .map(|(tx, ty)| json!({ "tx": tx, "ty": ty, "blobId": blob }))
        .collect();
    for id in ["a", "b", "c", "d", "e"] {
        add(&mut t, "owner", id, 0).expect("add");
        if id != "e" {
            write(&mut t, "owner", id, 8192, 8192, json!(full)).expect("write");
        }
    }
    let first = call(&mut t, "owner", "clearLayers", json!({}));
    assert_eq!(first["more"], json!(true));
    let mut removed = first["removed"].as_u64().expect("removed");
    assert!((1..5).contains(&removed));
    loop {
        let r = call(&mut t, "owner", "clearLayers", json!({}));
        removed += r["removed"].as_u64().expect("removed");
        if r["more"] == json!(false) {
            break;
        }
    }
    assert_eq!(removed, 5);
    assert!(layers(&mut t).is_empty());
    assert_eq!(t.blob_refs(&blob), 0);
    assert_eq!(
        view(&mut t, "bob", "getDocument", json!({}))["layerCount"],
        json!(0)
    );
}

// ── exports ──────────────────────────────────────────────────────────────────

#[test]
fn exports_are_blobs_anyone_may_record() {
    let mut t = app();
    let a = png(&mut t, 1);
    let first = call(
        &mut t,
        "gus",
        "addExport",
        json!({ "blobId": a, "name": "poster.png", "format": "png" }),
    );
    t.advance(10);
    let b = png(&mut t, 2);
    let second = call(
        &mut t,
        "bob",
        "addExport",
        json!({ "blobId": b, "name": "poster.jpg", "format": "jpeg" }),
    );
    let page = view(&mut t, "cy", "getExports", json!({}));
    let items = page["items"].as_array().expect("items").clone();
    assert_eq!(items.len(), 2);
    assert_eq!(items[0]["id"], second, "newest first");
    assert_eq!(items[0]["blobId"], json!(b));
    assert_eq!(items[0]["createdBy"], json!("bob"));
    assert_eq!(items[1]["id"], first);
    assert_eq!(items[1]["createdAt"], json!(common::T0.to_string()));
    assert_eq!(t.blob_refs(&a), 1, "the record keeps the file");

    // Only its creator or the owner deletes one.
    let r = t.as_("cy").call("deleteExport", json!({ "id": first }));
    assert_eq!(code(r), "Forbidden");
    call(&mut t, "gus", "deleteExport", json!({ "id": first }));
    call(&mut t, "owner", "deleteExport", json!({ "id": second }));
    assert_eq!(
        view(&mut t, "cy", "getExports", json!({}))["items"],
        json!([])
    );
    assert_eq!(t.blob_refs(&a), 0);
    let r = t.as_("owner").call("deleteExport", json!({ "id": first }));
    assert_eq!(code(r), "NotFound");

    let r = t.as_("bob").call(
        "addExport",
        json!({ "blobId": "ab".repeat(32), "name": "x", "format": "png" }),
    );
    assert_eq!(code(r), "UnknownBlob");
    let r = t.as_("bob").call(
        "addExport",
        json!({ "blobId": a, "name": "x", "format": "gif" }),
    );
    assert_eq!(code(r), "Invalid");
    assert_eq!(
        names(&t, "owner"),
        [
            "ExportAdded",
            "ExportAdded",
            "ExportDeleted",
            "ExportDeleted"
        ]
    );
}

// ── access and the wire ──────────────────────────────────────────────────────

#[test]
fn anonymous_callers_and_outsiders_are_refused_before_the_app_runs() {
    let mut t = app();
    for (method, args) in [
        ("getDocument", json!({})),
        ("getLayers", json!({})),
        ("myRole", json!({})),
    ] {
        match t.anonymous().view(method, args.clone()) {
            Err(Failure::Refused { status: 401, code }) => assert_eq!(code, "UNAUTHENTICATED"),
            other => panic!("anonymous {method}: {other:?}"),
        }
        match t.as_("mallory").view(method, args) {
            Err(Failure::Refused { status: 404, code }) => assert_eq!(code, "NOT_FOUND"),
            other => panic!("mallory {method}: {other:?}"),
        }
    }
    match t
        .as_("mallory")
        .call("addLayer", json!({ "layer": layer_json("x", "raster", 0) }))
    {
        Err(Failure::Refused { status: 404, .. }) => {}
        other => panic!("mallory addLayer: {other:?}"),
    }
}

#[test]
fn a_guest_reads_and_joins_but_does_not_edit() {
    let mut t = app();
    add(&mut t, "owner", "l1", 0).expect("add");
    assert_eq!(layer_ids(&mut t), ["l1"]);
    assert_eq!(
        view(&mut t, "gus", "getLayers", json!({}))["items"]
            .as_array()
            .map(Vec::len),
        Some(1)
    );
    call(
        &mut t,
        "gus",
        "join",
        json!({ "username": "Gus", "avatar": null, "timestamp": "1" }),
    );
    assert_eq!(code(add(&mut t, "gus", "g1", 0)), "Forbidden");
    let r = t.as_("gus").call("updateDocument", json!({ "name": "g" }));
    assert_eq!(code(r), "Forbidden");
    // Events go to everyone who reaches the app, guests included.
    assert_eq!(names(&t, "gus"), ["LayerAdded", "MemberJoined"]);
}

#[test]
fn bad_arguments_and_wrong_kinds_are_refused() {
    let mut t = app();
    // A u64 as a JSON number, an unknown key, a missing one.
    for args in [
        json!({ "username": "x", "avatar": null, "timestamp": 1 }),
        json!({ "username": "x", "avatar": null, "timestamp": "1", "extra": 1 }),
        json!({ "avatar": null, "timestamp": "1" }),
    ] {
        assert_eq!(code(t.as_("bob").call("join", args)), "BadArgs");
    }
    assert_eq!(
        code(t.as_("bob").call("getCursors", json!({}))),
        "UnknownMethod"
    );
    assert_eq!(
        code(t.as_("bob").call("updateCursor", json!({}))),
        "UnknownMethod"
    );
    assert_eq!(
        code(t.as_("bob").view(
            "join",
            json!({ "username": "x", "avatar": null, "timestamp": "1" })
        )),
        "NotAView"
    );
    // A view may run as a call.
    call(&mut t, "bob", "getDocument", json!({}));
}
