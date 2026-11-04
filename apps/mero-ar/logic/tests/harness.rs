//! The room on core's real wasmtime engine (`TestApp`): the 0.x `TestHost`
//! tests of the core 1.0 semantics method for method, and the access and wire
//! checks the iOS client relies on.

#![cfg(not(target_arch = "wasm32"))]

mod common;

use calimero_sdk::testing::{Failure, Org, TestApp};
use serde_json::{json, Value};

/// The owner (the room's creator, so its owner and only admin), members `bob`
/// and `cy`, an org admin `ada`, the org's owner is `owner`, and a guest `gus`.
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

/// A cube as the iOS client sends it: every field present, the
/// contract-stamped ones forged.
fn cube(id: &str) -> Value {
    json!({
        "id": id,
        "data": { "kind": "cube" },
        "transform": {
            "position": { "x": 0.0, "y": 0.0, "z": -1.0 },
            "rotation": { "x": 0.0, "y": 0.0, "z": 0.0, "w": 1.0 },
            "scale": { "x": 1.0, "y": 1.0, "z": 1.0 }
        },
        "color": "3A86FF",
        "lockedBy": "someone",
        "createdBy": "forged",
        "createdAt": 1,
        "updatedAt": 1,
        "version": 0
    })
}

fn object(t: &mut TestApp, id: &str) -> Value {
    view(t, "owner", "getObject", json!({ "id": id }))
}

// ── The 0.x core 1.0 tests ───────────────────────────────────────────────────

#[test]
fn the_creator_is_admin_and_attribution_comes_from_the_caller() {
    let mut t = app();
    assert_eq!(view(&mut t, "owner", "whoami", json!({})), json!("owner"));
    assert_eq!(view(&mut t, "owner", "myRole", json!({})), json!("admin"));

    assert_eq!(
        call(
            &mut t,
            "owner",
            "addObject",
            json!({ "object": cube("o1") })
        ),
        json!("o1")
    );
    let placed = object(&mut t, "o1");
    assert_eq!(
        placed["createdBy"],
        json!("owner"),
        "a client cannot attribute an object"
    );
    assert_eq!(
        placed["lockedBy"],
        json!(null),
        "a client cannot pre-lock an object"
    );
    assert_eq!(
        placed["createdAt"],
        json!(common::T0),
        "the leader stamps the record, as a JSON number"
    );
    assert_eq!(placed["version"], json!(1));
}

#[test]
fn a_viewer_cannot_edit_but_an_org_admin_can() {
    let mut t = app();
    assert_eq!(view(&mut t, "bob", "myRole", json!({})), json!("viewer"));
    assert_eq!(view(&mut t, "bob", "canEdit", json!({})), json!(false));
    assert_eq!(
        code(
            t.as_("bob")
                .call("addObject", json!({ "object": cube("o1") }))
        ),
        "Forbidden"
    );

    assert_eq!(view(&mut t, "ada", "myRole", json!({})), json!("admin"));
    assert_eq!(view(&mut t, "ada", "canEdit", json!({})), json!(true));
    call(&mut t, "ada", "addObject", json!({ "object": cube("o1") }));
    call(&mut t, "ada", "clearObjects", json!({}));
    assert_eq!(view(&mut t, "ada", "getObjects", json!({})), json!([]));
    // An org admin is not a room admin: the roster shows the room's own roles.
    assert_eq!(
        view(&mut t, "owner", "getRole", json!({ "member": "ada" })),
        json!("viewer")
    );
}

#[test]
fn an_org_admin_breaks_a_lock_a_member_cannot() {
    let mut t = app();
    call(
        &mut t,
        "owner",
        "addObject",
        json!({ "object": cube("o1") }),
    );
    call(&mut t, "owner", "lockObject", json!({ "id": "o1" }));
    assert_eq!(object(&mut t, "o1")["lockedBy"], json!("owner"));

    call(&mut t, "owner", "grantEditor", json!({ "member": "bob" }));
    call(&mut t, "bob", "unlockObject", json!({ "id": "o1" }));
    assert_eq!(object(&mut t, "o1")["lockedBy"], json!("owner"));
    // Nor may bob move, recolour or delete what the owner holds.
    call(
        &mut t,
        "bob",
        "updateColor",
        json!({ "id": "o1", "color": "FF006E" }),
    );
    call(&mut t, "bob", "deleteObject", json!({ "id": "o1" }));
    assert_eq!(object(&mut t, "o1")["color"], json!("3A86FF"));

    call(&mut t, "ada", "unlockObject", json!({ "id": "o1" }));
    assert_eq!(object(&mut t, "o1")["lockedBy"], json!(null));
}

#[test]
fn presence_is_one_camera_per_member() {
    let mut t = app();
    let at = |x: f64| {
        json!({
            "cameraPosition": { "x": x, "y": 0.0, "z": 0.0 },
            "cameraRotation": { "x": 0.0, "y": 0.0, "z": 0.0, "w": 1.0 }
        })
    };
    call(&mut t, "bob", "updatePresence", at(1.0));
    call(&mut t, "bob", "updatePresence", at(2.0));
    let poses = view(&mut t, "owner", "getPresence", json!({}));
    let poses = poses.as_array().expect("a list");
    assert_eq!(poses.len(), 1);
    assert_eq!(poses[0]["member"], json!("bob"));
    assert_eq!(poses[0]["identity"], json!("bob"));
    assert_eq!(poses[0]["cameraPosition"]["x"], json!(2.0));
}

#[test]
fn edits_advance_the_leader_clock() {
    let mut t = app();
    call(
        &mut t,
        "owner",
        "addObject",
        json!({ "object": cube("o1") }),
    );
    let before = object(&mut t, "o1");
    t.advance(5);
    call(
        &mut t,
        "owner",
        "updateColor",
        json!({ "id": "o1", "color": "FF006E" }),
    );
    let after = object(&mut t, "o1");
    assert_eq!(after["color"], json!("FF006E"));
    assert!(after["updatedAt"].as_u64() > before["updatedAt"].as_u64());
    assert!(after["version"].as_u64() > before["version"].as_u64());

    // Without the clock moving, a record clock still never stands still.
    call(
        &mut t,
        "owner",
        "updateColor",
        json!({ "id": "o1", "color": "000000" }),
    );
    let again = object(&mut t, "o1");
    assert_eq!(
        again["updatedAt"].as_u64(),
        after["updatedAt"].as_u64().map(|v| v + 1)
    );
}

#[test]
fn events_carry_a_named_id() {
    let mut t = app();
    call(
        &mut t,
        "owner",
        "addObject",
        json!({ "object": cube("o1") }),
    );
    assert_eq!(
        t.events_for("bob"),
        [("ObjectAdded".to_owned(), json!({ "id": "o1" }))]
    );
}

// ── Roles and ownership ──────────────────────────────────────────────────────

#[test]
fn roles_are_granted_by_room_admins_to_accounts_of_the_org() {
    let mut t = app();
    // An org admin passes the edit gates but grants nothing.
    assert_eq!(
        code(t.as_("ada").call("grantEditor", json!({ "member": "bob" }))),
        "Forbidden"
    );
    // Someone outside the org cannot be named.
    assert_eq!(
        code(
            t.as_("owner")
                .call("grantEditor", json!({ "member": "mallory" }))
        ),
        "Invalid"
    );

    call(&mut t, "owner", "grantEditor", json!({ "member": "bob" }));
    assert_eq!(view(&mut t, "bob", "myRole", json!({})), json!("editor"));
    call(
        &mut t,
        "bob",
        "join",
        json!({ "username": "Bob", "avatar": null }),
    );
    call(
        &mut t,
        "cy",
        "join",
        json!({ "username": "Cy", "avatar": null }),
    );
    assert_eq!(
        view(&mut t, "owner", "listRoles", json!({})),
        json!([
            { "member": "bob", "role": "editor" },
            { "member": "cy", "role": "viewer" }
        ])
    );

    call(&mut t, "owner", "revokeEditor", json!({ "member": "bob" }));
    assert_eq!(view(&mut t, "bob", "myRole", json!({})), json!("viewer"));
    assert_eq!(
        names(&t, "cy"),
        ["RoleUpdated", "MemberJoined", "MemberJoined", "RoleUpdated"]
    );
}

#[test]
fn ownership_moves_the_name_and_the_admin_tier() {
    let mut t = app();
    assert_eq!(
        code(t.as_("bob").call("renameRoom", json!({ "name": "Mine" }))),
        "Forbidden"
    );
    call(&mut t, "owner", "renameRoom", json!({ "name": "Studio" }));
    assert_eq!(
        view(&mut t, "bob", "getRoom", json!({}))["name"],
        json!("Studio")
    );

    call(
        &mut t,
        "owner",
        "transferOwnership",
        json!({ "newOwner": "bob" }),
    );
    let room = view(&mut t, "bob", "getRoom", json!({}));
    assert_eq!(room["owner"], json!("bob"));
    assert_eq!(view(&mut t, "bob", "myRole", json!({})), json!("admin"));
    // The former owner is no longer a room admin (the harness's `owner` also
    // owns the org, so `myRole` still reads admin through the org).
    assert_eq!(
        view(&mut t, "bob", "getRole", json!({ "member": "owner" })),
        json!("viewer")
    );
    assert_eq!(
        code(
            t.as_("owner")
                .call("grantEditor", json!({ "member": "cy" }))
        ),
        "Forbidden"
    );
    assert_eq!(
        code(t.as_("owner").call("renameRoom", json!({ "name": "Back" }))),
        "Forbidden"
    );
    call(&mut t, "bob", "renameRoom", json!({ "name": "Bob's" }));
    assert_eq!(
        names(&t, "cy"),
        ["RoomUpdated", "OwnerTransferred", "RoomUpdated"]
    );
}

// ── Members, comments, world map ─────────────────────────────────────────────

#[test]
fn a_member_joins_once_and_renames_only_themselves() {
    let mut t = app();
    call(
        &mut t,
        "bob",
        "join",
        json!({ "username": "Bob", "avatar": null }),
    );
    call(
        &mut t,
        "bob",
        "join",
        json!({ "username": "Robert", "avatar": null }),
    );
    let members = view(&mut t, "owner", "getMembers", json!({}));
    assert_eq!(
        members[0]["username"],
        json!("Bob"),
        "a second join changes nothing"
    );
    assert_eq!(members[0]["joinedAt"], json!(common::T0));

    call(
        &mut t,
        "bob",
        "updateMemberUsername",
        json!({ "username": "Robert" }),
    );
    call(
        &mut t,
        "cy",
        "updateMemberUsername",
        json!({ "username": "Not joined" }),
    );
    let members = view(&mut t, "owner", "getMembers", json!({}));
    assert_eq!(members.as_array().map(Vec::len), Some(1));
    assert_eq!(members[0]["username"], json!("Robert"));
    assert_eq!(
        view(&mut t, "owner", "getRoom", json!({}))["memberCount"],
        json!(1)
    );
}

#[test]
fn comments_are_deleted_by_their_author_or_an_admin() {
    let mut t = app();
    call(&mut t, "owner", "grantEditor", json!({ "member": "bob" }));
    call(&mut t, "owner", "grantEditor", json!({ "member": "cy" }));
    let note = |id: &str| json!({ "id": id, "text": "here", "position": { "x": 1.0, "y": 0.5, "z": 0.0 } });
    call(&mut t, "bob", "addComment", note("c1"));
    call(&mut t, "bob", "addComment", note("c2"));
    assert_eq!(
        view(&mut t, "owner", "getComments", json!({}))[0]["author"],
        json!("bob")
    );

    assert_eq!(
        code(t.as_("cy").call("deleteComment", json!({ "id": "c1" }))),
        "Forbidden"
    );
    assert_eq!(
        code(t.as_("gus").call("addComment", note("c3"))),
        "Forbidden"
    );
    call(&mut t, "bob", "deleteComment", json!({ "id": "c1" }));
    call(&mut t, "ada", "deleteComment", json!({ "id": "c2" }));
    assert_eq!(view(&mut t, "owner", "getComments", json!({})), json!([]));
}

#[test]
fn the_world_map_is_published_by_editors() {
    let mut t = app();
    assert_eq!(
        code(t.as_("bob").call("setWorldMap", json!({ "blobId": "map" }))),
        "Forbidden"
    );
    call(&mut t, "owner", "setWorldMap", json!({ "blobId": "map" }));
    assert_eq!(
        view(&mut t, "bob", "getRoom", json!({}))["worldMapBlob"],
        json!("map")
    );
    assert_eq!(names(&t, "bob"), ["AnchorsUpdated"]);
}

// ── Room scan ────────────────────────────────────────────────────────────────

fn scan(json_blob: &str) -> Value {
    json!({
        "jsonBlob": json_blob,
        // A u64 parameter is a decimal string on the wire.
        "jsonSize": "4096",
        "usdzBlob": null,
        "usdzSize": null,
        "width": 5.2, "length": 4.1, "height": 2.6,
        "objectCount": 6,
        "sample": false
    })
}

#[test]
fn a_scan_is_published_replaced_and_cleared() {
    let mut t = app();
    assert_eq!(view(&mut t, "bob", "getRoomScan", json!({})), json!(null));
    assert_eq!(
        code(t.as_("bob").call("setRoomScan", scan("a"))),
        "Forbidden"
    );
    assert_eq!(call(&mut t, "owner", "setRoomScan", scan("a")), json!("1"));
    assert_eq!(call(&mut t, "owner", "setRoomScan", scan("b")), json!("2"));
    let current = view(&mut t, "bob", "getRoomScan", json!({}));
    assert_eq!(current["jsonBlob"], json!("b"));
    assert_eq!(
        current["jsonSize"],
        json!(4096),
        "a record keeps JSON numbers"
    );
    assert_eq!(current["version"], json!(2));
    assert_eq!(current["scannedBy"], json!("owner"));
    assert_eq!(
        current["scannedAt"],
        json!(common::T0 + 1),
        "never behind the scan it replaces"
    );

    call(&mut t, "owner", "grantEditor", json!({ "member": "bob" }));
    assert_eq!(
        code(t.as_("bob").call("clearRoomScan", json!({}))),
        "Forbidden"
    );
    call(&mut t, "ada", "clearRoomScan", json!({}));
    assert_eq!(view(&mut t, "bob", "getRoomScan", json!({})), json!(null));
    assert_eq!(
        t.events_for("cy")
            .into_iter()
            .filter(|(n, _)| n == "RoomScanUpdated")
            .map(|(_, d)| d)
            .collect::<Vec<_>>(),
        [
            json!({ "id": "1" }),
            json!({ "id": "2" }),
            json!({ "id": "0" })
        ]
    );
}

#[test]
fn a_scan_must_name_its_model_and_be_room_sized() {
    let mut t = app();
    assert_eq!(
        code(t.as_("owner").call("setRoomScan", scan(" "))),
        "Invalid"
    );
    let mut huge = scan("a");
    huge["width"] = json!(61.0);
    assert_eq!(code(t.as_("owner").call("setRoomScan", huge)), "Invalid");
    let mut flat = scan("a");
    flat["height"] = json!(0.0);
    assert_eq!(code(t.as_("owner").call("setRoomScan", flat)), "Invalid");
    assert_eq!(view(&mut t, "owner", "getRoomScan", json!({})), json!(null));
}

// ── Objects ──────────────────────────────────────────────────────────────────

#[test]
fn furniture_must_name_a_catalogue_item() {
    let mut t = app();
    let mut sofa = cube("f1");
    sofa["data"] = json!({ "kind": "furniture", "item": "sofa" });
    call(&mut t, "owner", "addObject", json!({ "object": sofa }));
    assert_eq!(
        object(&mut t, "f1")["data"],
        json!({ "kind": "furniture", "item": "sofa" })
    );
    let mut nameless = cube("f2");
    nameless["data"] = json!({ "kind": "furniture", "item": "" });
    assert_eq!(
        code(
            t.as_("owner")
                .call("addObject", json!({ "object": nameless }))
        ),
        "Invalid"
    );
}

#[test]
fn a_transform_moves_an_object_and_the_room_counts_it() {
    let mut t = app();
    call(
        &mut t,
        "owner",
        "addObject",
        json!({ "object": cube("o1") }),
    );
    let moved = json!({
        "position": { "x": 1.5, "y": 0.0, "z": -2.0 },
        "rotation": { "x": 0.0, "y": 0.6, "z": 0.0, "w": 0.8 },
        "scale": { "x": 2.0, "y": 2.0, "z": 2.0 }
    });
    call(
        &mut t,
        "owner",
        "updateTransform",
        json!({ "id": "o1", "transform": moved.clone() }),
    );
    assert_eq!(object(&mut t, "o1")["transform"], moved);
    let room = view(&mut t, "owner", "getRoom", json!({}));
    assert_eq!(room["objectCount"], json!(1));
    assert_eq!(room["version"], json!(2));

    call(&mut t, "owner", "deleteObject", json!({ "id": "o1" }));
    assert_eq!(object(&mut t, "o1"), json!(null));
    assert_eq!(
        names(&t, "bob"),
        ["ObjectAdded", "ObjectUpdated", "ObjectDeleted"]
    );
}

// ── Access and wire ──────────────────────────────────────────────────────────

#[test]
fn who_reaches_the_room() {
    let mut t = app();
    // A guest reaches the room as a viewer.
    assert_eq!(view(&mut t, "gus", "myRole", json!({})), json!("viewer"));
    call(
        &mut t,
        "gus",
        "join",
        json!({ "username": "Gus", "avatar": null }),
    );
    assert_eq!(
        t.anonymous().view("getRoom", json!({})),
        Err(Failure::Refused {
            status: 401,
            code: "UNAUTHENTICATED".to_owned()
        })
    );
    assert_eq!(
        t.as_("mallory").view("getRoom", json!({})),
        Err(Failure::Refused {
            status: 404,
            code: "NOT_FOUND".to_owned()
        })
    );
}

#[test]
fn methods_and_arguments_are_camel_case() {
    let mut t = app();
    assert_eq!(
        code(t.as_("owner").view("get_room", json!({}))),
        "UnknownMethod"
    );
    assert_eq!(
        code(
            t.as_("owner")
                .call("setWorldMap", json!({ "blob_id": "map" }))
        ),
        "BadArgs"
    );
    // A u64 parameter sent as a JSON number is refused.
    let mut numeric = scan("a");
    numeric["jsonSize"] = json!(4096);
    assert_eq!(code(t.as_("owner").call("setRoomScan", numeric)), "BadArgs");
    // Reads are views; a write is not.
    assert_eq!(
        code(
            t.as_("owner")
                .view("join", json!({ "username": "x", "avatar": null }))
        ),
        "NotAView"
    );
}
