//! The contract's own rules, driven through `TestHost`: real CRDT state, no node
//! and no wasm. The creator is the harness's default account; a second PERSON is
//! `call_as_account`, because every rule here is about who may change the scene.

use calimero_sdk::testing::TestHost;
use calimero_sdk::AccountId;

use crate::{
    validate_mesh_ref, Environment, Material, MeroModels, MeshRef, SceneObject, TextureRef, Vec3,
    MAX_BATCH, MAX_VERTICES,
};

const BOB: [u8; 32] = [0xB0; 32];
const BOB_DEVICE: [u8; 32] = [0xB1; 32];

fn at(step: u64) -> u64 {
    1_700_000_000_000 + step * 1_000
}

fn scene() -> TestHost<MeroModels> {
    TestHost::new(|| MeroModels::init("Robot".to_owned()))
}

fn bob() -> String {
    AccountId::from(BOB).to_string()
}

fn material() -> Material {
    Material {
        color: "#c8ccd4".to_owned(),
        metalness: 0.0,
        roughness: 0.6,
        opacity: 1.0,
        emissive: "#000000".to_owned(),
        wireframe: false,
        flat_shading: false,
        base_color_map: String::new(),
        normal_map: String::new(),
        normal_scale: 1.0,
        orm_map: String::new(),
        emissive_map: String::new(),
    }
}

fn cube(id: &str) -> SceneObject {
    SceneObject {
        id: id.to_owned(),
        name: "Cube".to_owned(),
        kind: "cube".to_owned(),
        parent: String::new(),
        position: Vec3::ZERO,
        rotation: Vec3::ZERO,
        scale: Vec3::ONE,
        visible: true,
        material: material(),
        segments: 32,
        intensity: 0.0,
        created_by: "forged".to_owned(),
        created_at: 0,
        updated_at: 0,
    }
}

fn child(id: &str, parent: &str) -> SceneObject {
    SceneObject {
        parent: parent.to_owned(),
        ..cube(id)
    }
}

/// A blob id: 64 hex characters, distinct per `n`.
fn blob(n: u8) -> String {
    format!("{n:02x}").repeat(32)
}

fn mesh_ref(id: &str, n: u8) -> MeshRef {
    MeshRef {
        id: id.to_owned(),
        blob_id: blob(n),
        size: 1_024,
        vertex_count: 3,
        triangle_count: 1,
        has_uvs: false,
        author: "forged".to_owned(),
        message: String::new(),
        updated_at: 0,
    }
}

fn texture(id: &str, n: u8) -> TextureRef {
    TextureRef {
        id: id.to_owned(),
        name: "Albedo".to_owned(),
        blob_id: blob(n),
        size: 4_096,
        width: 2_048,
        height: 2_048,
        mime: "image/png".to_owned(),
        color_space: "srgb".to_owned(),
        author: String::new(),
        message: String::new(),
        updated_at: 0,
    }
}

fn triangle(id: &str) -> MeshRef {
    mesh_ref(id, 1)
}

#[test]
fn a_new_scene_is_empty_and_its_creator_is_admin() {
    let app = scene();
    let info = app.view(|s| s.get_scene());
    assert_eq!(info.name, "Robot");
    assert_eq!(info.object_count, 0);
    assert_eq!(info.my_role, "admin");
    assert_eq!(info.environment.background, "#24262b");
}

#[test]
fn an_editor_adds_moves_and_deletes_objects() {
    let mut app = scene();
    app.call(|s| s.put_objects(vec![cube("a"), cube("b")], at(1)))
        .expect("add");
    assert_eq!(app.view(|s| s.get_objects()).len(), 2);

    let mut moved = cube("a");
    moved.position = Vec3 {
        x: 2.0,
        y: 0.5,
        z: -1.0,
    };
    app.call(|s| s.put_objects(vec![moved], at(2)))
        .expect("move");
    let a = app
        .view(|s| s.get_objects_by_ids(vec!["a".to_owned()]))
        .remove(0);
    assert_eq!(a.position.x, 2.0);

    app.call(|s| s.delete_objects(vec!["b".to_owned()], at(9)))
        .expect("delete");
    let ids: Vec<String> = app
        .view(|s| s.get_objects())
        .into_iter()
        .map(|o| o.id)
        .collect();
    assert_eq!(ids, vec!["a".to_owned()]);
}

#[test]
fn authorship_and_creation_time_come_from_the_first_write_not_the_client() {
    let mut app = scene();
    app.call(|s| s.put_objects(vec![cube("a")], at(1)))
        .expect("add");
    let first = app.view(|s| s.get_objects()).remove(0);
    assert_ne!(first.created_by, "forged");
    assert_eq!(first.created_at, at(1));

    // An editor rewriting the object cannot re-attribute it.
    let editor = bob();
    app.call(|s| s.grant_editor(editor)).expect("grant");
    let mut rewrite = cube("a");
    rewrite.created_at = 5;
    app.call_as_account(BOB, BOB_DEVICE, |s| s.put_objects(vec![rewrite], at(2)))
        .expect("rewrite");
    let after = app.view(|s| s.get_objects()).remove(0);
    assert_eq!(after.created_by, first.created_by);
    assert_eq!(after.created_at, at(1));
}

#[test]
fn a_write_from_a_slow_clock_still_lands() {
    // The record merges last-write-wins on `updated_at`. If the contract stored
    // the caller's clock as given, an edit from a machine that is behind would
    // lose the merge against the value it is replacing — on its own node.
    let mut app = scene();
    app.call(|s| s.put_objects(vec![cube("a")], at(10)))
        .expect("add");
    let mut moved = cube("a");
    moved.position.x = 7.0;
    app.call(|s| s.put_objects(vec![moved], at(1)))
        .expect("move");
    let a = app.view(|s| s.get_objects()).remove(0);
    assert_eq!(a.position.x, 7.0);
    assert!(a.updated_at > at(10));
}

#[test]
fn a_viewer_can_look_but_not_touch_until_granted_editor() {
    let mut app = scene();
    app.call(|s| s.put_objects(vec![cube("a")], at(1)))
        .expect("add");

    app.call_as_account(BOB, BOB_DEVICE, |s| s.join("Bob".to_owned(), at(2)))
        .expect("join");
    assert_eq!(
        app.call_as_account(BOB, BOB_DEVICE, |s| s.my_role()),
        "viewer"
    );
    assert!(app
        .call_as_account(BOB, BOB_DEVICE, |s| s.put_objects(vec![cube("b")], at(3)))
        .is_err());
    assert!(app
        .call_as_account(BOB, BOB_DEVICE, |s| s
            .delete_objects(vec!["a".to_owned()], at(9)))
        .is_err());
    assert!(app
        .call_as_account(BOB, BOB_DEVICE, |s| s.put_mesh(triangle("a"), at(3)))
        .is_err());
    // A viewer still sees the scene.
    assert_eq!(
        app.call_as_account(BOB, BOB_DEVICE, |s| s.get_objects())
            .len(),
        1
    );

    app.call(|s| s.grant_editor(bob())).expect("grant");
    app.call_as_account(BOB, BOB_DEVICE, |s| s.put_objects(vec![cube("b")], at(4)))
        .expect("an editor may add");
    let members = app.view(|s| s.get_members());
    assert_eq!(members.len(), 1);
    assert_eq!(members[0].role, "editor");

    app.call(|s| s.revoke_editor(bob())).expect("revoke");
    assert!(app
        .call_as_account(BOB, BOB_DEVICE, |s| s.put_objects(vec![cube("c")], at(5)))
        .is_err());
}

#[test]
fn only_an_admin_grants_roles_or_clears_the_scene() {
    let mut app = scene();
    app.call(|s| s.grant_editor(bob())).expect("grant");
    let third = AccountId::from([0x33u8; 32]).to_string();
    assert!(app
        .call_as_account(BOB, BOB_DEVICE, |s| s.grant_editor(third))
        .is_err());
    assert!(app
        .call_as_account(BOB, BOB_DEVICE, |s| s.clear_scene())
        .is_err());

    app.call(|s| s.put_objects(vec![cube("a")], at(1)))
        .expect("add");
    app.call(|s| s.put_mesh(triangle("a"), at(1)))
        .expect("mesh");
    app.call(|s| s.clear_scene()).expect("clear");
    assert!(app.view(|s| s.get_objects()).is_empty());
    assert!(app.view(|s| s.list_meshes()).is_empty());

    let err = format!(
        "{:?}",
        app.call(|s| s.grant_editor("nope".to_owned())).unwrap_err()
    );
    assert!(err.contains("not a member id"), "{err}");
}

#[test]
fn malformed_objects_are_refused_and_a_batch_is_all_or_nothing() {
    let mut app = scene();
    let mut bad_kind = cube("x");
    bad_kind.kind = "teapot".to_owned();
    let mut bad_color = cube("y");
    bad_color.material.color = "red".to_owned();
    let mut nan = cube("z");
    nan.position.y = f64::NAN;
    let own_parent = child("p", "p");

    for bad in [bad_kind, bad_color, nan, own_parent] {
        assert!(
            app.call(|s| s.put_objects(vec![cube("ok"), bad.clone()], at(1)))
                .is_err(),
            "{:?} should be refused",
            bad.id
        );
    }
    assert!(app.view(|s| s.get_objects()).is_empty());

    let too_many: Vec<SceneObject> = (0..=MAX_BATCH).map(|i| cube(&format!("o{i}"))).collect();
    assert!(app.call(|s| s.put_objects(too_many, at(1))).is_err());
}

#[test]
fn out_of_range_values_are_clamped_not_refused() {
    let mut app = scene();
    let mut obj = cube("a");
    obj.material.metalness = 4.0;
    obj.material.opacity = -1.0;
    obj.segments = 100_000;
    obj.name = "  \u{7}Gear  ".to_owned();
    app.call(|s| s.put_objects(vec![obj], at(1))).expect("add");
    let a = app.view(|s| s.get_objects()).remove(0);
    assert_eq!(a.material.metalness, 1.0);
    assert_eq!(a.material.opacity, 0.0);
    assert_eq!(a.segments, 128);
    assert_eq!(a.name, "Gear");
}

#[test]
fn a_missing_parent_or_a_loop_reads_as_a_root() {
    let mut app = scene();
    // a <- b <- c is a fine chain; d names a parent that does not exist; e and
    // f each name the other, the shape two concurrent re-parents can produce.
    app.call(|s| {
        s.put_objects(
            vec![
                cube("a"),
                child("b", "a"),
                child("c", "b"),
                child("d", "ghost"),
                child("e", "f"),
                child("f", "e"),
            ],
            at(1),
        )
    })
    .expect("add");
    let parents: Vec<(String, String)> = app
        .view(|s| s.get_objects())
        .into_iter()
        .map(|o| (o.id, o.parent))
        .collect();
    let parent = |id: &str| {
        parents
            .iter()
            .find(|(i, _)| i == id)
            .map(|(_, p)| p.clone())
            .unwrap()
    };
    assert_eq!(parent("b"), "a");
    assert_eq!(parent("c"), "b");
    assert_eq!(parent("d"), "");
    assert_eq!(parent("e"), "");
    assert_eq!(parent("f"), "");

    // Deleting a parent leaves its child in the scene, as a root.
    app.call(|s| s.delete_objects(vec!["a".to_owned()], at(9)))
        .expect("delete");
    assert_eq!(
        app.view(|s| s.get_objects())
            .into_iter()
            .find(|o| o.id == "b")
            .unwrap()
            .parent,
        ""
    );
}

#[test]
fn a_mesh_is_a_blob_reference_and_every_write_is_a_version() {
    let mut app = scene();
    let mut obj = cube("m");
    obj.kind = "mesh".to_owned();
    app.call(|s| s.put_objects(vec![obj], at(1))).expect("add");
    app.call(|s| s.put_mesh(mesh_ref("m", 1), at(2)))
        .expect("v1");
    let mut v2 = mesh_ref("m", 2);
    v2.vertex_count = 2_500_000;
    v2.triangle_count = 5_000_000;
    v2.size = 90_000_000;
    v2.message = "  high-res pass ".to_owned();
    app.call(|s| s.put_mesh(v2, at(3))).expect("v2");

    let refs = app.view(|s| s.list_meshes());
    assert_eq!(refs.len(), 1);
    assert_eq!(refs[0].blob_id, blob(2));
    assert_eq!(refs[0].vertex_count, 2_500_000);
    assert_ne!(
        refs[0].author, "forged",
        "the author is the caller, not what was sent"
    );

    let history = app.view(|s| s.list_history("m".to_owned()));
    let numbers: Vec<u32> = history.iter().map(|v| v.number).collect();
    assert_eq!(numbers, vec![1, 2]);
    assert!(!history[0].current && history[1].current);
    assert_eq!(history[1].message, "high-res pass");
    assert_eq!(history[1].a, 2_500_000);

    // Restoring is writing the old blob again: a third version, pointing at v1.
    let mut restore = mesh_ref("m", 1);
    restore.message = "Restored v1".to_owned();
    app.call(|s| s.put_mesh(restore, at(4))).expect("restore");
    let history = app.view(|s| s.list_history("m".to_owned()));
    assert_eq!(history.len(), 3);
    assert_eq!(history[2].blob_id, blob(1));
    assert!(
        history[2].current && !history[0].current,
        "the newest row of a blob is the current one"
    );

    // Deleting the object drops the reference but keeps the history, so an undo
    // can point the mesh at its blob again.
    app.call(|s| s.delete_objects(vec!["m".to_owned()], at(9)))
        .expect("delete");
    assert!(app.view(|s| s.list_meshes()).is_empty());
    assert_eq!(app.view(|s| s.list_history("m".to_owned())).len(), 3);
    assert!(app.view(|s| s.list_history("other".to_owned())).is_empty());
}

#[test]
fn a_malformed_mesh_reference_is_refused() {
    let mut not_hex = triangle("m");
    not_hex.blob_id = "z".repeat(64);
    assert!(validate_mesh_ref(&not_hex).is_err());

    let mut short = triangle("m");
    short.blob_id = "ab".to_owned();
    assert!(validate_mesh_ref(&short).is_err());

    let mut huge = triangle("m");
    huge.vertex_count = MAX_VERTICES + 1;
    assert!(validate_mesh_ref(&huge).is_err());

    let mut empty = triangle("m");
    empty.size = 0;
    assert!(validate_mesh_ref(&empty).is_err());
    assert!(validate_mesh_ref(&triangle("m")).is_ok());
}

#[test]
fn textures_are_versioned_validated_and_deleted() {
    let mut app = scene();
    app.call(|s| s.put_texture(texture("t", 1), at(1)))
        .expect("add");
    app.call(|s| s.put_texture(texture("t", 2), at(2)))
        .expect("replace");
    let list = app.view(|s| s.list_textures());
    assert_eq!(list.len(), 1);
    assert_eq!(list[0].blob_id, blob(2));
    assert_eq!(app.view(|s| s.get_scene()).texture_count, 1);
    assert_eq!(app.view(|s| s.list_history("t".to_owned())).len(), 2);

    for bad in [
        TextureRef {
            mime: "image/gif".to_owned(),
            ..texture("x", 3)
        },
        TextureRef {
            color_space: "aces".to_owned(),
            ..texture("x", 3)
        },
        TextureRef {
            width: 20_000,
            ..texture("x", 3)
        },
        TextureRef {
            blob_id: "nope".to_owned(),
            ..texture("x", 3)
        },
    ] {
        assert!(
            app.call(|s| s.put_texture(bad.clone(), at(3))).is_err(),
            "{bad:?}"
        );
    }
    assert!(app
        .call_as_account(BOB, BOB_DEVICE, |s| s.put_texture(texture("y", 4), at(4)))
        .is_err());

    app.call(|s| s.delete_textures(vec!["t".to_owned()], at(5)))
        .expect("delete");
    assert!(app.view(|s| s.list_textures()).is_empty());
}

#[test]
fn a_check_out_keeps_other_editors_off_until_it_is_checked_in_or_lapses() {
    let mut app = scene();
    app.call(|s| s.grant_editor(bob())).expect("grant");
    app.call(|s| s.put_objects(vec![cube("a")], at(1)))
        .expect("add");

    // Bob checks the cube out for an hour.
    app.call_as_account(BOB, BOB_DEVICE, |s| {
        s.check_out(vec!["a".to_owned()], 1, at(2))
    })
    .expect("check out");
    let locks = app.view(|s| s.list_locks(at(3)));
    assert_eq!(locks.len(), 1);
    assert_eq!(locks[0].holder, bob());
    assert!(!locks[0].mine);

    // The admin cannot move it, delete it, give it a mesh, or check it out.
    let err = format!(
        "{:?}",
        app.call(|s| s.put_objects(vec![cube("a")], at(3)))
            .unwrap_err()
    );
    assert!(err.contains("checked out"), "{err}");
    assert!(app
        .call(|s| s.delete_objects(vec!["a".to_owned()], at(3)))
        .is_err());
    assert!(app.call(|s| s.put_mesh(mesh_ref("a", 1), at(3))).is_err());
    assert!(app
        .call(|s| s.check_out(vec!["a".to_owned()], 1, at(3)))
        .is_err());
    // Bob can.
    app.call_as_account(BOB, BOB_DEVICE, |s| s.put_objects(vec![cube("a")], at(4)))
        .expect("the holder edits");

    // An hour later the check-out has lapsed and nobody is held up by it.
    let later = at(2) + 3_600_001;
    assert!(app.view(|s| s.list_locks(later)).is_empty());
    app.call(|s| s.put_objects(vec![cube("a")], later))
        .expect("lapsed");
}

#[test]
fn only_the_holder_or_an_admin_checks_an_asset_back_in() {
    let mut app = scene();
    let carol = [0xC0; 32];
    app.call(|s| s.grant_editor(bob())).expect("grant");
    app.call(|s| s.grant_editor(AccountId::from(carol).to_string()))
        .expect("grant");
    app.call_as_account(BOB, BOB_DEVICE, |s| {
        s.check_out(vec!["a".to_owned()], 8, at(1))
    })
    .expect("bob");
    // Carol, an editor, cannot release Bob's check-out.
    assert!(app
        .call_as_account(carol, carol, |s| s.check_in(vec!["a".to_owned()]))
        .is_err());
    // The admin can — Bob went on holiday.
    app.call(|s| s.check_in(vec!["a".to_owned()]))
        .expect("admin breaks it");
    assert!(app.view(|s| s.list_locks(at(2))).is_empty());

    // Checking out again extends rather than restarts.
    app.call_as_account(BOB, BOB_DEVICE, |s| {
        s.check_out(vec!["a".to_owned()], 1, at(3))
    })
    .expect("again");
    app.call_as_account(BOB, BOB_DEVICE, |s| {
        s.check_out(vec!["a".to_owned()], 2, at(4))
    })
    .expect("extend");
    let lock = app.view(|s| s.list_locks(at(5))).remove(0);
    assert_eq!(lock.since, at(3));
    assert_eq!(lock.expires_at, at(4) + 2 * 3_600_000);
    app.call_as_account(BOB, BOB_DEVICE, |s| s.check_in(vec!["a".to_owned()]))
        .expect("check in");
    assert!(app.view(|s| s.list_locks(at(6))).is_empty());
}

#[test]
fn a_viewer_cannot_check_anything_out() {
    let mut app = scene();
    assert!(app
        .call_as_account(BOB, BOB_DEVICE, |s| s.check_out(
            vec!["a".to_owned()],
            1,
            at(1)
        ))
        .is_err());
}

#[test]
fn the_environment_renames_the_scene_and_is_validated() {
    let mut app = scene();
    let env = |name: &str, background: &str| Environment {
        name: name.to_owned(),
        background: background.to_owned(),
        ambient_color: "#ffffff".to_owned(),
        ambient_intensity: 99.0,
        updated_at: 0,
    };
    app.call(|s| s.set_environment(env("Mech", "#101010"), at(1)))
        .expect("set");
    let info = app.view(|s| s.get_scene());
    assert_eq!(info.name, "Mech");
    assert_eq!(info.environment.background, "#101010");
    assert_eq!(info.environment.ambient_intensity, 10.0);

    // An empty name falls back to the one the scene was created with.
    app.call(|s| s.set_environment(env("", "#101010"), at(2)))
        .expect("set");
    assert_eq!(app.view(|s| s.get_scene()).name, "Robot");

    assert!(app
        .call(|s| s.set_environment(env("x", "blue"), at(3)))
        .is_err());
    assert!(app
        .call_as_account(BOB, BOB_DEVICE, |s| s
            .set_environment(env("Hijack", "#000000"), at(4)))
        .is_err());
}

#[test]
fn a_member_renames_themselves_and_keeps_their_join_time() {
    let mut app = scene();
    app.call_as_account(BOB, BOB_DEVICE, |s| s.join("Bob".to_owned(), at(1)))
        .expect("join");
    app.call_as_account(BOB, BOB_DEVICE, |s| s.join("Robert".to_owned(), at(5)))
        .expect("rename");
    let members = app.view(|s| s.get_members());
    assert_eq!(members.len(), 1);
    assert_eq!(members[0].name, "Robert");
    assert_eq!(members[0].joined_at, at(1));
    assert_eq!(members[0].id, bob());
}

#[test]
fn every_change_emits_one_event_and_a_no_op_join_emits_none() {
    let mut app = scene();
    let _ = app.take_events();

    app.call(|s| s.put_objects(vec![cube("a")], at(1)))
        .expect("add");
    let kinds = |app: &TestHost<MeroModels>| -> Vec<String> {
        app.take_events().into_iter().map(|e| e.kind).collect()
    };
    assert_eq!(kinds(&app), vec!["ObjectsChanged"]);

    app.call(|s| s.put_mesh(triangle("a"), at(2)))
        .expect("mesh");
    assert_eq!(kinds(&app), vec!["MeshChanged"]);

    app.call(|s| s.join("Ada".to_owned(), at(3))).expect("join");
    assert_eq!(kinds(&app), vec!["MemberChanged"]);
    app.call(|s| s.join("Ada".to_owned(), at(4))).expect("join");
    assert!(kinds(&app).is_empty());

    app.call(|s| s.delete_objects(vec!["a".to_owned()], at(9)))
        .expect("delete");
    assert_eq!(kinds(&app), vec!["ObjectsDeleted"]);
}
