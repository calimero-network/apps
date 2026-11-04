//! The scene on core's real wasmtime engine (`TestApp`): v1's `TestHost` tests
//! (`src/tests.rs`) method for method — objects, meshes and textures with their
//! history, check-outs, members and roles — then what v1 kept in storage-level
//! write rules (capability maps every node re-checked at merge), as method
//! checks: the same calls made as someone the method refuses. v1's convergence
//! tests (`tests/converge.rs`) become what they mean under one log: every
//! editor's write survives, and one object holds the later write whole. Then
//! the access and wire checks v1 could not express.

#![cfg(not(target_arch = "wasm32"))]

mod common;

use std::sync::OnceLock;

use calimero_sdk::testing::{Failure, Org, TestApp};
use serde_json::{json, Value};

const OWNER: &str = "owner";
/// An admin of the org: an admin of every scene in it.
const ADA: &str = "ada";
const BOB: &str = "bob";
const CAROL: &str = "carol";
const GUEST: &str = "gus";

/// How many blobs `app()` uploads: `blob(1)` to `blob(BLOBS)`.
const BLOBS: u8 = 4;

/// The ids of the blobs `app()` uploads. A blob id is its content's SHA-256, so
/// they are the same in every `TestApp`.
static BLOB_IDS: OnceLock<Vec<String>> = OnceLock::new();

/// The id of blob `n` (1..=BLOBS), one the app holds: since core 1.0.0-rc.8
/// (#4815) the runtime refuses a stored reference to a blob the app does not
/// hold (`HostDenied`), so a made-up id no longer works.
fn blob(n: u8) -> String {
    BLOB_IDS.get().expect("app() uploads the blobs first")[usize::from(n) - 1].clone()
}

fn org() -> Org {
    Org::new()
        .admins([ADA])
        .members([BOB, CAROL])
        .guests([GUEST])
}

fn app() -> TestApp {
    let mut t = common::app(org());
    let ids: Vec<String> = (1..=BLOBS)
        .map(|n| t.upload_blob(&[n], "model/gltf-binary"))
        .collect();
    let _ = BLOB_IDS.set(ids);
    t
}

fn now(ms: u64) -> String {
    (common::T0 + ms).to_string()
}

fn ok(r: Result<Value, Failure>) -> Value {
    r.unwrap_or_else(|f| panic!("expected ok, got {f:?}"))
}

fn code(r: Result<Value, Failure>) -> String {
    match r {
        Err(Failure::App { code, .. }) => code,
        other => panic!("expected an app error, got {other:?}"),
    }
}

fn message(r: Result<Value, Failure>) -> String {
    match r {
        Err(Failure::App { fields, .. }) => fields["message"].as_str().unwrap_or("").to_owned(),
        other => panic!("expected an app error, got {other:?}"),
    }
}

fn object(id: &str, kind: &str) -> Value {
    json!({
        "id": id, "name": id, "kind": kind, "parent": "",
        "position": { "x": 0.0, "y": 0.5, "z": 0.0 },
        "rotation": { "x": 0.0, "y": 0.0, "z": 0.0 },
        "scale": { "x": 1.0, "y": 1.0, "z": 1.0 },
        "visible": true,
        "material": {
            "color": "#c8ccd4", "metalness": 0.0, "roughness": 0.6, "opacity": 1.0,
            "emissive": "#000000", "wireframe": false, "flat_shading": false,
            "base_color_map": "", "normal_map": "", "normal_scale": 1.0, "orm_map": "", "emissive_map": ""
        },
        "segments": 32, "intensity": 0.0, "created_by": "", "created_at": 0, "updated_at": 0
    })
}

fn child(id: &str, parent: &str) -> Value {
    let mut o = object(id, "cube");
    o["parent"] = json!(parent);
    o
}

fn mesh(id: &str, blob_id: &str, size: u64) -> Value {
    json!({
        "id": id, "blob_id": blob_id, "size": size, "vertex_count": 3, "triangle_count": 1,
        "has_uvs": false, "author": "", "message": "blockout", "updated_at": 0
    })
}

fn texture(id: &str, name: &str, blob_id: &str) -> Value {
    json!({
        "id": id, "name": name, "blob_id": blob_id, "size": 524288, "width": 2048, "height": 2048,
        "mime": "image/png", "color_space": "srgb", "author": "", "message": "", "updated_at": 0
    })
}

fn put(t: &mut TestApp, who: &str, objects: Value, at: u64) -> Result<Value, Failure> {
    t.as_(who)
        .call("putObjects", json!({ "objects": objects, "now": now(at) }))
}

fn ids(v: &Value) -> Vec<String> {
    v.as_array()
        .unwrap()
        .iter()
        .map(|o| o["id"].as_str().unwrap().to_owned())
        .collect()
}

// ── objects ─────────────────────────────────────────────────────────────────

#[test]
fn objects_are_written_read_in_creation_order_and_keep_their_creator() {
    let mut t = app();
    let written = ok(put(
        &mut t,
        OWNER,
        json!([object("b", "cube"), object("a", "sphere")]),
        10,
    ));
    assert_eq!(written, json!(["b", "a"]));
    ok(put(&mut t, OWNER, json!([object("c", "point_light")]), 20));
    let all = ok(t.as_(BOB).view("getObjects", json!({})));
    // Same creation time orders by id.
    assert_eq!(ids(&all), ["a", "b", "c"]);
    assert_eq!(all[0]["created_by"], json!(OWNER));
    assert_eq!(all[0]["created_at"], json!(common::T0 + 10));

    // A rewrite by another editor keeps the creator and the creation time,
    // and moves the stamp past the stored one even when the clock is behind.
    ok(t.as_(OWNER).call("grantEditor", json!({ "member": BOB })));
    let mut moved = object("a", "sphere");
    moved["position"]["x"] = json!(3.0);
    moved["created_by"] = json!("someone-else");
    ok(put(&mut t, BOB, json!([moved]), 5));
    let a = ok(t
        .as_(OWNER)
        .view("getObjectsByIds", json!({ "ids": ["a", "zz"] })));
    assert_eq!(a.as_array().unwrap().len(), 1);
    assert_eq!(a[0]["position"]["x"], json!(3.0));
    assert_eq!(a[0]["created_by"], json!(OWNER));
    assert_eq!(a[0]["updated_at"], json!(common::T0 + 11));
}

#[test]
fn every_editors_write_survives_and_one_object_holds_the_later_write_whole() {
    // v1's convergence tests, under one log: two editors' different objects
    // both land; the same object ends as the write ordered last, never a mix.
    let mut t = app();
    ok(t.as_(OWNER).call("grantEditor", json!({ "member": BOB })));
    ok(put(&mut t, OWNER, json!([object("mine", "cube")]), 1));
    ok(put(&mut t, BOB, json!([object("bobs", "cone")]), 1));
    let mut first = object("shared", "cube");
    first["position"]["x"] = json!(1.0);
    first["material"]["color"] = json!("#ff0000");
    let mut second = object("shared", "cube");
    second["position"]["y"] = json!(2.0);
    ok(put(&mut t, OWNER, json!([first]), 2));
    ok(put(&mut t, BOB, json!([second.clone()]), 2));
    let all = ok(t.as_(CAROL).view("getObjects", json!({})));
    assert_eq!(ids(&all), ["bobs", "mine", "shared"]);
    let shared = &all[2];
    assert_eq!(shared["position"], second["position"]);
    assert_eq!(shared["material"]["color"], json!("#c8ccd4"));
}

#[test]
fn a_missing_parent_or_a_loop_reads_as_a_root() {
    let mut t = app();
    ok(put(
        &mut t,
        OWNER,
        json!([
            child("a", "b"),
            child("b", "a"),
            child("orphan", "gone"),
            object("root", "group"),
            child("leaf", "root")
        ]),
        1,
    ));
    let all = ok(t.as_(OWNER).view("getObjects", json!({})));
    let parent = |id: &str| {
        all.as_array()
            .unwrap()
            .iter()
            .find(|o| o["id"] == json!(id))
            .unwrap()["parent"]
            .clone()
    };
    assert_eq!(parent("a"), json!(""));
    assert_eq!(parent("b"), json!(""));
    assert_eq!(parent("orphan"), json!(""));
    assert_eq!(parent("leaf"), json!("root"));
    // As stored, by id.
    let raw = ok(t
        .as_(OWNER)
        .view("getObjectsByIds", json!({ "ids": ["a"] })));
    assert_eq!(raw[0]["parent"], json!("b"));
}

#[test]
fn malformed_objects_are_refused_and_nothing_is_written() {
    let mut t = app();
    let mut bad_color = object("x", "cube");
    bad_color["material"]["color"] = json!("red");
    let mut self_parent = object("y", "cube");
    self_parent["parent"] = json!("y");
    for bad in [
        object("z", "teapot"),
        bad_color,
        self_parent,
        object("", "cube"),
    ] {
        assert_eq!(
            code(put(&mut t, OWNER, json!([object("ok", "cube"), bad]), 1)),
            "Invalid"
        );
    }
    assert_eq!(ok(t.as_(OWNER).view("getObjects", json!({}))), json!([]));

    // Out-of-range numbers are clamped, not refused.
    let mut wild = object("w", "cube");
    wild["material"]["metalness"] = json!(7.0);
    wild["segments"] = json!(1000);
    wild["name"] = json!("   ");
    ok(put(&mut t, OWNER, json!([wild]), 1));
    let w = &ok(t.as_(OWNER).view("getObjects", json!({})))[0];
    assert_eq!(w["material"]["metalness"], json!(1.0));
    assert_eq!(w["segments"], json!(128));
    assert_eq!(w["name"], json!("cube"));

    // More than 200 in one call.
    let many: Vec<Value> = (0..201).map(|i| object(&format!("o{i}"), "cube")).collect();
    assert_eq!(code(put(&mut t, OWNER, json!(many), 1)), "Invalid");
}

#[test]
fn a_scene_holds_at_most_2000_objects() {
    let mut t = app();
    for batch in 0..10 {
        let objs: Vec<Value> = (0..200)
            .map(|i| object(&format!("o{batch}-{i}"), "cube"))
            .collect();
        ok(put(&mut t, OWNER, json!(objs), 1));
    }
    let scene = ok(t.as_(OWNER).view("getScene", json!({})));
    assert_eq!(scene["object_count"], json!(2000));
    assert!(
        message(put(&mut t, OWNER, json!([object("one-more", "cube")]), 2))
            .contains("at most 2000")
    );
    // Rewriting one that exists is fine.
    ok(put(&mut t, OWNER, json!([object("o0-0", "sphere")]), 2));
    assert_eq!(
        ok(t.as_(OWNER).view("getObjects", json!({})))
            .as_array()
            .unwrap()
            .len(),
        2000
    );
}

#[test]
fn deleting_objects_drops_their_meshes_and_check_outs_but_keeps_history() {
    let mut t = app();
    ok(put(
        &mut t,
        OWNER,
        json!([object("m", "mesh"), object("n", "cube")]),
        1,
    ));
    ok(t.as_(OWNER).call(
        "putMesh",
        json!({ "mesh": mesh("m", &blob(1), 180), "now": now(2) }),
    ));
    ok(t.as_(OWNER).call(
        "checkOut",
        json!({ "ids": ["m"], "hours": 1, "now": now(3) }),
    ));
    ok(t.as_(OWNER).call(
        "deleteObjects",
        json!({ "ids": ["m", "gone"], "now": now(4) }),
    ));
    assert_eq!(ids(&ok(t.as_(OWNER).view("getObjects", json!({})))), ["n"]);
    assert_eq!(ok(t.as_(OWNER).view("listMeshes", json!({}))), json!([]));
    assert_eq!(
        ok(t.as_(OWNER).view("listLocks", json!({ "now": now(5) }))),
        json!([])
    );
    let history = ok(t.as_(OWNER).view("listHistory", json!({ "assetId": "m" })));
    assert_eq!(history.as_array().unwrap().len(), 1);
    assert_eq!(history[0]["current"], json!(false));
}

// ── meshes, textures, history ───────────────────────────────────────────────

#[test]
fn meshes_are_references_with_a_numbered_history_and_restores() {
    let mut t = app();
    ok(put(&mut t, OWNER, json!([object("m", "mesh")]), 1));
    ok(t.as_(OWNER).call(
        "putMesh",
        json!({ "mesh": mesh("m", &blob(1), 180), "now": now(10) }),
    ));
    ok(t.as_(OWNER).call(
        "putMesh",
        json!({ "mesh": mesh("m", &blob(2), 200), "now": now(5) }),
    ));
    let meshes = ok(t.as_(BOB).view("listMeshes", json!({})));
    assert_eq!(meshes[0]["blob_id"], json!(blob(2)));
    assert_eq!(meshes[0]["author"], json!(OWNER));
    // The slow clock still moved the stamp forward.
    assert_eq!(meshes[0]["updated_at"], json!(common::T0 + 11));

    // Restore v1: write its blob again.
    let mut restore = mesh("m", &blob(1), 180);
    restore["message"] = json!("Restored v1");
    ok(t.as_(OWNER)
        .call("putMesh", json!({ "mesh": restore, "now": now(20) })));
    let history = ok(t.as_(BOB).view("listHistory", json!({ "assetId": "m" })));
    let rows = history.as_array().unwrap();
    assert_eq!(rows.len(), 3);
    assert_eq!(
        rows.iter().map(|r| r["number"].clone()).collect::<Vec<_>>(),
        [json!(1), json!(2), json!(3)]
    );
    // Only the newest row with the current blob is current.
    assert_eq!(
        rows.iter()
            .map(|r| r["current"].clone())
            .collect::<Vec<_>>(),
        [json!(false), json!(false), json!(true)]
    );
    assert_eq!(rows[2]["message"], json!("Restored v1"));
    assert_eq!(rows[0]["kind"], json!("mesh"));
    assert_eq!(rows[0]["a"], json!(3));
    assert_eq!(
        ok(t.as_(OWNER).view("getScene", json!({})))["mesh_count"],
        json!(1)
    );
}

#[test]
fn a_blob_is_at_most_47_25_mib_and_named_by_lowercase_hex() {
    let mut t = app();
    // The largest blob a node keeps: (64 MiB − 1 MiB) / 4 × 3.
    let max = 49_545_216_u64;
    ok(t.as_(OWNER).call(
        "putMesh",
        json!({ "mesh": mesh("m", &blob(1), max), "now": now(1) }),
    ));
    assert!(message(t.as_(OWNER).call(
        "putMesh",
        json!({ "mesh": mesh("m", &blob(1), max + 1), "now": now(2) })
    ))
    .contains("47.25 MiB"));
    for bad in ["AB".repeat(32), "ab".repeat(31), "zz".repeat(32)] {
        assert_eq!(
            code(t.as_(OWNER).call(
                "putMesh",
                json!({ "mesh": mesh("m", &bad, 10), "now": now(3) })
            )),
            "Invalid"
        );
    }
    let mut big = mesh("m", &blob(1), 10);
    big["vertex_count"] = json!(4_000_001);
    assert_eq!(
        code(
            t.as_(OWNER)
                .call("putMesh", json!({ "mesh": big, "now": now(4) }))
        ),
        "Invalid"
    );
    let mut tex = texture("t", "Albedo", &blob(3));
    tex["size"] = json!(max + 1);
    assert_eq!(
        code(
            t.as_(OWNER)
                .call("putTexture", json!({ "texture": tex, "now": now(5) }))
        ),
        "Invalid"
    );
}

#[test]
fn textures_are_listed_by_name_versioned_and_deleted() {
    let mut t = app();
    ok(t.as_(OWNER).call(
        "putTexture",
        json!({ "texture": texture("t2", "Zinc", &blob(1)), "now": now(1) }),
    ));
    ok(t.as_(OWNER).call(
        "putTexture",
        json!({ "texture": texture("t1", "Albedo", &blob(2)), "now": now(2) }),
    ));
    ok(t.as_(OWNER).call(
        "putTexture",
        json!({ "texture": texture("t1", "Albedo", &blob(3)), "now": now(3) }),
    ));
    let list = ok(t.as_(BOB).view("listTextures", json!({})));
    assert_eq!(ids(&list), ["t1", "t2"]);
    assert_eq!(list[0]["blob_id"], json!(blob(3)));
    assert_eq!(list[0]["author"], json!(OWNER));
    let history = ok(t.as_(BOB).view("listHistory", json!({ "assetId": "t1" })));
    assert_eq!(history.as_array().unwrap().len(), 2);
    assert_eq!(history[1]["kind"], json!("texture"));
    assert_eq!(history[1]["a"], json!(2048));
    assert_eq!(history[1]["current"], json!(true));

    for (field, value) in [
        ("mime", json!("image/gif")),
        ("color_space", json!("cmyk")),
        ("width", json!(0)),
        ("height", json!(16_385)),
    ] {
        let mut bad = texture("t3", "Bad", &blob(4));
        bad[field] = value;
        assert_eq!(
            code(
                t.as_(OWNER)
                    .call("putTexture", json!({ "texture": bad, "now": now(4) }))
            ),
            "Invalid",
            "{field}"
        );
    }

    ok(t.as_(OWNER).call(
        "deleteTextures",
        json!({ "ids": ["t1", "nope"], "now": now(5) }),
    ));
    assert_eq!(ids(&ok(t.as_(BOB).view("listTextures", json!({})))), ["t2"]);
    // The history stays, with nothing current.
    let history = ok(t.as_(BOB).view("listHistory", json!({ "assetId": "t1" })));
    assert_eq!(history[1]["current"], json!(false));
}

#[test]
fn the_history_view_keeps_the_newest_500() {
    let mut t = app();
    for i in 0..503_u64 {
        let id = t.upload_blob(&(i + 1).to_be_bytes(), "model/gltf-binary");
        ok(t.as_(OWNER).call(
            "putMesh",
            json!({ "mesh": mesh("m", &id, 10), "now": now(i) }),
        ));
    }
    let history = ok(t.as_(OWNER).view("listHistory", json!({ "assetId": "m" })));
    let rows = history.as_array().unwrap();
    assert_eq!(rows.len(), 500);
    assert_eq!(rows[0]["number"], json!(4));
    assert_eq!(rows[499]["number"], json!(503));
    assert_eq!(rows[499]["current"], json!(true));
}

// ── check-outs ──────────────────────────────────────────────────────────────

#[test]
fn a_check_out_holds_others_off_until_it_is_released_or_lapses() {
    let mut t = app();
    ok(t.as_(OWNER).call("grantEditor", json!({ "member": BOB })));
    ok(t.as_(BOB)
        .call("join", json!({ "name": "Bob", "now": now(0) })));
    ok(put(&mut t, OWNER, json!([object("a", "cube")]), 1));
    ok(t.as_(BOB).call(
        "checkOut",
        json!({ "ids": ["a"], "hours": 1, "now": now(2) }),
    ));

    // The holder writes; anyone else is refused, by name.
    ok(put(&mut t, BOB, json!([object("a", "cone")]), 3));
    let refused = put(&mut t, OWNER, json!([object("a", "torus")]), 4);
    assert!(message(refused.clone()).contains("checked out by Bob"));
    assert_eq!(code(refused), "Locked");
    assert_eq!(
        code(
            t.as_(OWNER)
                .call("deleteObjects", json!({ "ids": ["a"], "now": now(4) }))
        ),
        "Locked"
    );
    assert_eq!(
        code(t.as_(OWNER).call(
            "checkOut",
            json!({ "ids": ["a"], "hours": 1, "now": now(4) })
        )),
        "Locked"
    );

    let locks = ok(t.as_(BOB).view("listLocks", json!({ "now": now(5) })));
    assert_eq!(locks[0]["holder"], json!(BOB));
    assert_eq!(locks[0]["mine"], json!(true));
    assert_eq!(locks[0]["expires_at"], json!(common::T0 + 2 + 3_600_000));
    // Extending keeps `since`.
    ok(t.as_(BOB).call(
        "checkOut",
        json!({ "ids": ["a"], "hours": 500, "now": now(10) }),
    ));
    let locks = ok(t.as_(OWNER).view("listLocks", json!({ "now": now(11) })));
    assert_eq!(locks[0]["since"], json!(common::T0 + 2));
    assert_eq!(locks[0]["mine"], json!(false));
    // 168 hours at most.
    assert_eq!(
        locks[0]["expires_at"],
        json!(common::T0 + 10 + 168 * 3_600_000)
    );

    // Lapsed: the lock no longer holds, and is not listed.
    let later = 10 + 168 * 3_600_000 + 1;
    ok(put(&mut t, OWNER, json!([object("a", "torus")]), later));
    assert_eq!(
        ok(t.as_(OWNER).view("listLocks", json!({ "now": now(later) }))),
        json!([])
    );
}

#[test]
fn only_the_holder_or_an_admin_checks_an_asset_in() {
    let mut t = app();
    for who in [BOB, CAROL] {
        ok(t.as_(OWNER).call("grantEditor", json!({ "member": who })));
    }
    ok(t.as_(BOB).call(
        "checkOut",
        json!({ "ids": ["a", "b"], "hours": 8, "now": now(1) }),
    ));
    assert_eq!(
        code(t.as_(CAROL).call("checkIn", json!({ "ids": ["a"] }))),
        "Forbidden"
    );
    ok(t.as_(BOB)
        .call("checkIn", json!({ "ids": ["a", "never-locked"] })));
    // The org's admin breaks the rest.
    ok(t.as_(ADA).call("checkIn", json!({ "ids": ["b"] })));
    assert_eq!(
        ok(t.as_(BOB).view("listLocks", json!({ "now": now(2) }))),
        json!([])
    );
    assert_eq!(
        code(t.as_(BOB).call(
            "checkOut",
            json!({ "ids": [""], "hours": 1, "now": now(3) })
        )),
        "Invalid"
    );
}

// ── environment, members, roles ─────────────────────────────────────────────

#[test]
fn the_environment_defaults_and_editors_change_it() {
    let mut t = app();
    let scene = ok(t.as_(BOB).view("getScene", json!({})));
    assert_eq!(scene["name"], json!(""));
    assert_eq!(scene["environment"]["background"], json!("#24262b"));
    assert_eq!(scene["me"], json!(BOB));
    assert_eq!(scene["my_role"], json!("viewer"));

    let env = json!({
        "name": "  Robot\u{7}  ", "background": "#1d1f24", "ambient_color": "#ffffff",
        "ambient_intensity": 40.0, "updated_at": 0
    });
    ok(t.as_(OWNER).call(
        "setEnvironment",
        json!({ "environment": env, "now": now(1) }),
    ));
    let scene = ok(t.as_(BOB).view("getScene", json!({})));
    assert_eq!(scene["name"], json!("Robot"));
    assert_eq!(scene["environment"]["ambient_intensity"], json!(10.0));
    assert_eq!(scene["environment"]["updated_at"], json!(common::T0 + 1));

    let mut bad = env.clone();
    bad["background"] = json!("#12345");
    assert_eq!(
        code(t.as_(OWNER).call(
            "setEnvironment",
            json!({ "environment": bad, "now": now(2) })
        )),
        "Invalid"
    );
    assert_eq!(
        code(t.as_(BOB).call(
            "setEnvironment",
            json!({ "environment": env, "now": now(2) })
        )),
        "Forbidden"
    );
}

#[test]
fn members_join_under_a_name_and_are_listed_with_their_role() {
    let mut t = app();
    ok(t.as_(BOB)
        .call("join", json!({ "name": "Bob", "now": now(5) })));
    ok(t.as_(GUEST)
        .call("join", json!({ "name": "", "now": now(6) })));
    ok(t.as_(OWNER)
        .call("join", json!({ "name": "Owner", "now": now(7) })));
    // A rename keeps the join time.
    ok(t.as_(BOB)
        .call("join", json!({ "name": "Robert", "now": now(9) })));
    let members = ok(t.as_(CAROL).view("getMembers", json!({})));
    assert_eq!(
        members,
        json!([
            { "id": BOB, "name": "Robert", "role": "viewer", "joined_at": common::T0 + 5 },
            { "id": GUEST, "name": "Guest", "role": "viewer", "joined_at": common::T0 + 6 },
            { "id": OWNER, "name": "Owner", "role": "admin", "joined_at": common::T0 + 7 },
        ])
    );
    assert_eq!(
        ok(t.as_(OWNER).view("getScene", json!({})))["member_count"],
        json!(3)
    );
}

#[test]
fn the_owner_and_org_admins_grant_and_revoke_the_editor_role() {
    let mut t = app();
    assert_eq!(ok(t.as_(OWNER).view("myRole", json!({}))), json!("admin"));
    assert_eq!(ok(t.as_(ADA).view("myRole", json!({}))), json!("admin"));
    assert_eq!(ok(t.as_(BOB).view("myRole", json!({}))), json!("viewer"));

    // A viewer cannot change anything (v1: a forged write refused on apply).
    assert_eq!(
        code(put(&mut t, BOB, json!([object("a", "cube")]), 1)),
        "Forbidden"
    );
    assert_eq!(
        code(t.as_(BOB).call(
            "putMesh",
            json!({ "mesh": mesh("a", &blob(1), 10), "now": now(1) })
        )),
        "Forbidden"
    );
    assert_eq!(
        code(t.as_(BOB).call("grantEditor", json!({ "member": BOB }))),
        "Forbidden"
    );

    ok(t.as_(ADA).call("grantEditor", json!({ "member": BOB })));
    ok(t.as_(OWNER).call("grantEditor", json!({ "member": GUEST })));
    assert_eq!(ok(t.as_(BOB).view("myRole", json!({}))), json!("editor"));
    ok(put(&mut t, GUEST, json!([object("a", "cube")]), 1));
    // An editor is not an admin.
    assert_eq!(
        code(t.as_(BOB).call("grantEditor", json!({ "member": CAROL }))),
        "Forbidden"
    );
    assert_eq!(code(t.as_(BOB).call("clearScene", json!({}))), "Forbidden");

    ok(t.as_(OWNER).call("revokeEditor", json!({ "member": BOB })));
    assert_eq!(ok(t.as_(BOB).view("myRole", json!({}))), json!("viewer"));
    // Revoking an admin's editor role leaves them admin.
    ok(t.as_(OWNER).call("revokeEditor", json!({ "member": ADA })));
    assert_eq!(ok(t.as_(ADA).view("myRole", json!({}))), json!("admin"));

    // Only accounts of the org.
    assert_eq!(
        code(t.as_(OWNER).call("grantEditor", json!({ "member": "eve" }))),
        "Invalid"
    );
    assert_eq!(
        code(t.as_(OWNER).call("grantEditor", json!({ "member": "" }))),
        "Invalid"
    );
}

#[test]
fn an_admin_clears_the_scene() {
    let mut t = app();
    ok(put(&mut t, OWNER, json!([object("m", "mesh")]), 1));
    ok(t.as_(OWNER).call(
        "putMesh",
        json!({ "mesh": mesh("m", &blob(1), 10), "now": now(2) }),
    ));
    ok(t.as_(OWNER).call(
        "putTexture",
        json!({ "texture": texture("t", "T", &blob(2)), "now": now(3) }),
    ));
    ok(t.as_(OWNER).call(
        "checkOut",
        json!({ "ids": ["m"], "hours": 1, "now": now(4) }),
    ));
    ok(t.as_(ADA).call("clearScene", json!({})));
    let scene = ok(t.as_(OWNER).view("getScene", json!({})));
    assert_eq!(
        (
            &scene["object_count"],
            &scene["mesh_count"],
            &scene["texture_count"]
        ),
        (&json!(0), &json!(0), &json!(0))
    );
    assert_eq!(
        ok(t.as_(OWNER).view("listHistory", json!({ "assetId": "m" }))),
        json!([])
    );
    assert_eq!(
        ok(t.as_(OWNER).view("listLocks", json!({ "now": now(5) }))),
        json!([])
    );
    // A new version starts from 1 again.
    ok(t.as_(OWNER).call(
        "putMesh",
        json!({ "mesh": mesh("m", &blob(3), 10), "now": now(6) }),
    ));
    assert_eq!(
        ok(t.as_(OWNER).view("listHistory", json!({ "assetId": "m" })))[0]["number"],
        json!(1)
    );
}

// ── access and wire checks ──────────────────────────────────────────────────

#[test]
fn the_platform_refuses_anonymous_callers_and_outsiders() {
    let mut t = app();
    assert_eq!(
        t.anonymous().view("getScene", json!({})),
        Err(Failure::Refused {
            status: 401,
            code: "UNAUTHENTICATED".to_owned()
        })
    );
    assert_eq!(
        t.as_("eve").view("getObjects", json!({})),
        Err(Failure::Refused {
            status: 404,
            code: "NOT_FOUND".to_owned()
        })
    );
    assert_eq!(
        t.as_("eve")
            .call("join", json!({ "name": "Eve", "now": now(1) })),
        Err(Failure::Refused {
            status: 404,
            code: "NOT_FOUND".to_owned()
        })
    );
}

#[test]
fn wire_errors() {
    let mut t = app();
    assert_eq!(
        code(t.as_(OWNER).view("noSuchMethod", json!({}))),
        "UnknownMethod"
    );
    assert_eq!(code(t.as_(OWNER).view("clearScene", json!({}))), "NotAView");
    // v1's snake_case names are unknown keys.
    assert_eq!(
        code(t.as_(OWNER).view("listHistory", json!({ "asset_id": "m" }))),
        "BadArgs"
    );
    // `now` is a u64: a decimal string, not a number.
    assert_eq!(
        code(t.as_(OWNER).call("join", json!({ "name": "A", "now": 5 }))),
        "BadArgs"
    );
    // Record fields keep v1's snake_case names and JSON numbers.
    ok(t.as_(OWNER)
        .call("join", json!({ "name": "A", "now": "5" })));
    assert_eq!(
        ok(t.as_(OWNER).view("getMembers", json!({})))[0]["joined_at"],
        json!(5)
    );
}
