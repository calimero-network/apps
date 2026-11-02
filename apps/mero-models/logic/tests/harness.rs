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

use calimero_app_sdk::testing::{Failure, Org, TestApp};
use serde_json::{json, Value};

const OWNER: &str = "owner";
/// An admin of the org: an admin of every scene in it.
const ADA: &str = "ada";
const BOB: &str = "bob";
const CAROL: &str = "carol";
const GUEST: &str = "gus";

/// Uploads a blob of `size` bytes (at least 8), distinct per `n`, as a client
/// would before `putMesh`/`putTexture`, and answers its id.
fn up(t: &mut TestApp, n: u64, size: usize) -> String {
    let mut bytes = vec![0_u8; size.max(8)];
    bytes[..8].copy_from_slice(&n.to_le_bytes());
    t.upload_blob(&bytes, "application/octet-stream")
}

/// A well-formed blob id no upload produced.
fn never_uploaded() -> String {
    "ab".repeat(32)
}

fn org() -> Org {
    Org::new()
        .admins([ADA])
        .members([BOB, CAROL])
        .guests([GUEST])
}

fn app() -> TestApp {
    common::app(org())
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

fn texture(id: &str, name: &str, blob_id: &str, size: u64) -> Value {
    json!({
        "id": id, "name": name, "blob_id": blob_id, "size": size, "width": 2048, "height": 2048,
        "mime": "image/png", "color_space": "srgb", "author": "", "message": "", "updated_at": 0
    })
}

fn put(t: &mut TestApp, who: &str, objects: Value, at: u64) -> Result<Value, Failure> {
    t.as_(who)
        .call("putObjects", json!({ "objects": objects, "now": now(at) }))
}

/// The rows of one page (`{ items, next }`).
fn items(v: &Value) -> Value {
    assert!(v.get("next").is_some(), "not a page: {v}");
    v["items"].clone()
}

fn ids(v: &Value) -> Vec<String> {
    let v = if v.is_object() { &v["items"] } else { v };
    v.as_array()
        .unwrap()
        .iter()
        .map(|o| o["id"].as_str().unwrap().to_owned())
        .collect()
}

/// A view's whole answer, following `next` page by page.
fn all(t: &mut TestApp, who: &str, method: &str, mut args: Value) -> Vec<Value> {
    let mut out = Vec::new();
    loop {
        let page = ok(t.as_(who).view(method, args.clone()));
        out.extend(items(&page).as_array().unwrap().iter().cloned());
        match page["next"].as_str() {
            Some(next) => args["cursor"] = json!(next),
            None => return out,
        }
    }
}

fn put_mesh(t: &mut TestApp, who: &str, mesh: Value, at: u64) -> Result<Value, Failure> {
    t.as_(who)
        .call("putMesh", json!({ "mesh": mesh, "now": now(at) }))
}

fn put_texture(t: &mut TestApp, who: &str, texture: Value, at: u64) -> Result<Value, Failure> {
    t.as_(who)
        .call("putTexture", json!({ "texture": texture, "now": now(at) }))
}

// ── objects ─────────────────────────────────────────────────────────────────

#[test]
fn objects_are_written_read_in_id_order_and_keep_their_creator() {
    let mut t = app();
    let written = ok(put(
        &mut t,
        OWNER,
        json!([object("b", "cube"), object("a", "sphere")]),
        10,
    ));
    assert_eq!(written, json!(["b", "a"]));
    ok(put(&mut t, OWNER, json!([object("c", "point_light")]), 20));
    let all = items(&ok(t.as_(BOB).view("getObjects", json!({}))));
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
    let all = items(&ok(t.as_(CAROL).view("getObjects", json!({}))));
    assert_eq!(ids(&all), ["bobs", "mine", "shared"]);
    let shared = &all[2];
    assert_eq!(shared["position"], second["position"]);
    assert_eq!(shared["material"]["color"], json!("#c8ccd4"));
}

#[test]
fn parents_are_stored_as_written_and_resolved_by_the_reader() {
    // v1 resolved missing parents and loops inside `get_objects`. The answer
    // is paged now, so the reader resolves once it holds every page (the
    // frontend's adapter, `meroModels.ts`; pinned by `meroModels.test.ts`).
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
    let all = items(&ok(t.as_(OWNER).view("getObjects", json!({}))));
    let parent = |id: &str| {
        all.as_array()
            .unwrap()
            .iter()
            .find(|o| o["id"] == json!(id))
            .unwrap()["parent"]
            .clone()
    };
    assert_eq!(parent("a"), json!("b"));
    assert_eq!(parent("orphan"), json!("gone"));
    assert_eq!(parent("leaf"), json!("root"));
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
    assert_eq!(
        ok(t.as_(OWNER).view("getObjects", json!({}))),
        json!({ "items": [], "next": null })
    );

    // Out-of-range numbers are clamped, not refused.
    let mut wild = object("w", "cube");
    wild["material"]["metalness"] = json!(7.0);
    wild["segments"] = json!(1000);
    wild["name"] = json!("   ");
    ok(put(&mut t, OWNER, json!([wild]), 1));
    let w = &items(&ok(t.as_(OWNER).view("getObjects", json!({}))))[0];
    assert_eq!(w["material"]["metalness"], json!(1.0));
    assert_eq!(w["segments"], json!(128));
    assert_eq!(w["name"], json!("cube"));

    // More than 200 in one call.
    let many: Vec<Value> = (0..201).map(|i| object(&format!("o{i}"), "cube")).collect();
    assert_eq!(code(put(&mut t, OWNER, json!(many), 1)), "Invalid");
}

#[test]
fn a_scene_holds_at_most_2000_objects_read_in_pages() {
    let mut t = app();
    for batch in 0..10 {
        let objs: Vec<Value> = (0..200)
            .map(|i| object(&format!("o{batch}-{i:03}"), "cube"))
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
    ok(put(&mut t, OWNER, json!([object("o0-000", "sphere")]), 2));

    // One page is at most 1,000 rows; `limit` asks for fewer; `next` reads on.
    let first = ok(t.as_(OWNER).view("getObjects", json!({ "limit": 5000 })));
    assert_eq!(items(&first).as_array().unwrap().len(), 1000);
    assert!(first["next"].is_string());
    let small = ok(t.as_(OWNER).view("getObjects", json!({ "limit": 3 })));
    assert_eq!(ids(&small), ["o0-000", "o0-001", "o0-002"]);
    let after = ok(t
        .as_(OWNER)
        .view("getObjects", json!({ "cursor": small["next"], "limit": 1 })));
    assert_eq!(ids(&after), ["o0-003"]);
    let every = all(&mut t, OWNER, "getObjects", json!({}));
    assert_eq!(every.len(), 2000);
    assert_eq!(
        code(
            t.as_(OWNER)
                .view("getObjects", json!({ "cursor": "not-a-cursor" }))
        ),
        "Storage"
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
    let b1 = up(&mut t, 1, 180);
    ok(put_mesh(&mut t, OWNER, mesh("m", &b1, 180), 2));
    ok(t.as_(OWNER).call(
        "checkOut",
        json!({ "ids": ["m"], "hours": 1, "now": now(3) }),
    ));
    ok(t.as_(OWNER).call(
        "deleteObjects",
        json!({ "ids": ["m", "gone"], "now": now(4) }),
    ));
    assert_eq!(ids(&ok(t.as_(OWNER).view("getObjects", json!({})))), ["n"]);
    assert_eq!(
        items(&ok(t.as_(OWNER).view("listMeshes", json!({})))),
        json!([])
    );
    assert_eq!(
        items(&ok(t
            .as_(OWNER)
            .view("listLocks", json!({ "now": now(5) })))),
        json!([])
    );
    let history = ok(t.as_(OWNER).view("listHistory", json!({ "assetId": "m" })));
    assert_eq!(history.as_array().unwrap().len(), 1);
    assert_eq!(history[0]["current"], json!(false));
    // The history row still refers to the blob, so the node keeps it.
    assert_eq!(t.blob_refs(&b1), 1);
}

// ── meshes, textures, history ───────────────────────────────────────────────

#[test]
fn meshes_are_references_with_a_numbered_history_and_restores() {
    let mut t = app();
    ok(put(&mut t, OWNER, json!([object("m", "mesh")]), 1));
    let b1 = up(&mut t, 1, 180);
    let b2 = up(&mut t, 2, 200);
    ok(put_mesh(&mut t, OWNER, mesh("m", &b1, 180), 10));
    ok(put_mesh(&mut t, OWNER, mesh("m", &b2, 200), 5));
    let meshes = items(&ok(t.as_(BOB).view("listMeshes", json!({}))));
    assert_eq!(meshes[0]["blob_id"], json!(b2));
    assert_eq!(meshes[0]["author"], json!(OWNER));
    // The slow clock still moved the stamp forward.
    assert_eq!(meshes[0]["updated_at"], json!(common::T0 + 11));

    // Restore v1: write its blob again.
    let mut restore = mesh("m", &b1, 180);
    restore["message"] = json!("Restored v1");
    ok(put_mesh(&mut t, OWNER, restore, 20));
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
    // Retention: b1 is named by the mesh and by two history rows, b2 by one row.
    assert_eq!(t.blob_refs(&b1), 3);
    assert_eq!(t.blob_refs(&b2), 1);
}

#[test]
fn a_reference_names_a_blob_the_scene_holds_with_its_real_size() {
    let mut t = app();
    // A well-formed id no upload produced: refused, not stored (the host would
    // trap a run that stores it).
    let refused = put_mesh(&mut t, OWNER, mesh("m", &never_uploaded(), 10), 1);
    assert!(message(refused.clone()).contains("upload the mesh first"));
    assert_eq!(code(refused), "Invalid");
    assert_eq!(
        code(put_texture(
            &mut t,
            OWNER,
            texture("t", "T", &never_uploaded(), 10),
            1
        )),
        "Invalid"
    );
    // The size is the node's, not the client's claim.
    let b = up(&mut t, 7, 100);
    assert!(message(put_mesh(&mut t, OWNER, mesh("m", &b, 99), 2)).contains("is 100 bytes, not 99"));
    assert_eq!(
        code(put_texture(&mut t, OWNER, texture("t", "T", &b, 101), 2)),
        "Invalid"
    );
    ok(put_mesh(&mut t, OWNER, mesh("m", &b, 100), 3));
    assert_eq!(t.blob_refs(&b), 2);
}

#[test]
fn a_blob_is_at_most_47_25_mib_and_named_by_lowercase_hex() {
    let mut t = app();
    // The largest blob a node keeps: (64 MiB − 1 MiB) / 4 × 3.
    let max = 49_545_216_u64;
    let big_blob = up(&mut t, 1, max as usize);
    ok(put_mesh(&mut t, OWNER, mesh("m", &big_blob, max), 1));
    assert!(
        message(put_mesh(&mut t, OWNER, mesh("m", &big_blob, max + 1), 2)).contains("47.25 MiB")
    );
    let small = up(&mut t, 2, 10);
    for bad in [small.to_uppercase(), "ab".repeat(31), "zz".repeat(32)] {
        assert_eq!(
            code(put_mesh(&mut t, OWNER, mesh("m", &bad, 10), 3)),
            "Invalid"
        );
    }
    let mut big = mesh("m", &small, 10);
    big["vertex_count"] = json!(4_000_001);
    assert_eq!(code(put_mesh(&mut t, OWNER, big, 4)), "Invalid");
    let tex = texture("t", "Albedo", &small, max + 1);
    assert_eq!(code(put_texture(&mut t, OWNER, tex, 5)), "Invalid");
}

#[test]
fn textures_are_listed_versioned_and_deleted() {
    let mut t = app();
    let (b1, b2, b3) = (up(&mut t, 1, 64), up(&mut t, 2, 64), up(&mut t, 3, 64));
    ok(put_texture(
        &mut t,
        OWNER,
        texture("t2", "Zinc", &b1, 64),
        1,
    ));
    ok(put_texture(
        &mut t,
        OWNER,
        texture("t1", "Albedo", &b2, 64),
        2,
    ));
    ok(put_texture(
        &mut t,
        OWNER,
        texture("t1", "Albedo", &b3, 64),
        3,
    ));
    let list = items(&ok(t.as_(BOB).view("listTextures", json!({}))));
    assert_eq!(ids(&list), ["t1", "t2"]);
    assert_eq!(list[0]["blob_id"], json!(b3));
    assert_eq!(list[0]["author"], json!(OWNER));
    let history = ok(t.as_(BOB).view("listHistory", json!({ "assetId": "t1" })));
    assert_eq!(history.as_array().unwrap().len(), 2);
    assert_eq!(history[1]["kind"], json!("texture"));
    assert_eq!(history[1]["a"], json!(2048));
    assert_eq!(history[1]["current"], json!(true));

    let b4 = up(&mut t, 4, 64);
    for (field, value) in [
        ("mime", json!("image/gif")),
        ("color_space", json!("cmyk")),
        ("width", json!(0)),
        ("height", json!(16_385)),
    ] {
        let mut bad = texture("t3", "Bad", &b4, 64);
        bad[field] = value;
        assert_eq!(
            code(put_texture(&mut t, OWNER, bad, 4)),
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
        let b = up(&mut t, i, 10);
        ok(put_mesh(&mut t, OWNER, mesh("m", &b, 10), i));
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

    let locks = items(&ok(t.as_(BOB).view("listLocks", json!({ "now": now(5) }))));
    assert_eq!(locks[0]["holder"], json!(BOB));
    assert_eq!(locks[0]["mine"], json!(true));
    assert_eq!(locks[0]["expires_at"], json!(common::T0 + 2 + 3_600_000));
    // Extending keeps `since`.
    ok(t.as_(BOB).call(
        "checkOut",
        json!({ "ids": ["a"], "hours": 500, "now": now(10) }),
    ));
    let locks = items(&ok(t
        .as_(OWNER)
        .view("listLocks", json!({ "now": now(11) }))));
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
        items(&ok(t
            .as_(OWNER)
            .view("listLocks", json!({ "now": now(later) })))),
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
        items(&ok(t.as_(BOB).view("listLocks", json!({ "now": now(2) })))),
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
    // In account id order (the adapter sorts by join time).
    let members = ok(t.as_(CAROL).view("getMembers", json!({})));
    assert_eq!(
        members,
        json!({ "items": [
            { "id": BOB, "name": "Robert", "role": "viewer", "joined_at": common::T0 + 5 },
            { "id": GUEST, "name": "Guest", "role": "viewer", "joined_at": common::T0 + 6 },
            { "id": OWNER, "name": "Owner", "role": "admin", "joined_at": common::T0 + 7 },
        ], "next": null })
    );
    assert_eq!(
        ok(t.as_(OWNER).view("getScene", json!({})))["member_count"],
        json!(3)
    );
    let two = ok(t.as_(CAROL).view("getMembers", json!({ "limit": 2 })));
    assert_eq!(ids(&two), [BOB, GUEST]);
    assert_eq!(
        all(&mut t, CAROL, "getMembers", json!({ "limit": 2 })).len(),
        3
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
    let b = up(&mut t, 1, 10);
    assert_eq!(
        code(put_mesh(&mut t, BOB, mesh("a", &b, 10), 1)),
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
fn an_admin_clears_the_scene_and_its_blobs_are_released() {
    let mut t = app();
    ok(put(&mut t, OWNER, json!([object("m", "mesh")]), 1));
    let (b1, b2) = (up(&mut t, 1, 10), up(&mut t, 2, 64));
    ok(put_mesh(&mut t, OWNER, mesh("m", &b1, 10), 2));
    ok(put_texture(&mut t, OWNER, texture("t", "T", &b2, 64), 3));
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
        items(&ok(t
            .as_(OWNER)
            .view("listLocks", json!({ "now": now(5) })))),
        json!([])
    );
    // Nothing refers to the blobs any more: the node may collect them.
    assert_eq!((t.blob_refs(&b1), t.blob_refs(&b2)), (0, 0));
    // A new version starts from 1 again.
    let b3 = up(&mut t, 3, 10);
    ok(put_mesh(&mut t, OWNER, mesh("m", &b3, 10), 6));
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
        items(&ok(t.as_(OWNER).view("getMembers", json!({}))))[0]["joined_at"],
        json!(5)
    );
}
