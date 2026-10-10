//! The contract's own rules, driven through `TestHost`: real CRDT state, no node
//! and no wasm. The creator is the harness's default account; a second PERSON is
//! `call_as_account`, because every rule here is about who may change the scene.

use calimero_sdk::testing::TestHost;
use calimero_sdk::AccountId;

use crate::{
    validate_mesh, Environment, Material, MeroModels, MeshData, SceneObject, Vec3, MAX_BATCH,
    MAX_VERTICES,
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

fn triangle(id: &str) -> MeshData {
    MeshData {
        id: id.to_owned(),
        positions: vec![0.0, 0.0, 0.0, 1.0, 0.0, 0.0, 0.0, 1.0, 0.0],
        indices: vec![0, 1, 2],
        updated_at: 0,
    }
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

    app.call(|s| s.delete_objects(vec!["b".to_owned()]))
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
        .call_as_account(BOB, BOB_DEVICE, |s| s.delete_objects(vec!["a".to_owned()]))
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
    app.call(|s| s.delete_objects(vec!["a".to_owned()]))
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
fn meshes_are_versioned_listed_without_vertices_and_deleted_with_their_object() {
    let mut app = scene();
    let mut obj = cube("m");
    obj.kind = "mesh".to_owned();
    app.call(|s| s.put_objects(vec![obj], at(1))).expect("add");
    app.call(|s| s.put_mesh(triangle("m"), at(2)))
        .expect("mesh");

    let stamps = app.view(|s| s.list_meshes());
    assert_eq!(stamps.len(), 1);
    assert_eq!(stamps[0].vertex_count, 3);
    assert_eq!(stamps[0].triangle_count, 1);
    let first = stamps[0].updated_at;

    app.call(|s| s.put_mesh(triangle("m"), at(1)))
        .expect("again");
    assert!(app.view(|s| s.list_meshes())[0].updated_at > first);
    assert_eq!(
        app.view(|s| s.get_meshes(vec!["m".to_owned(), "nope".to_owned()]))
            .len(),
        1
    );

    app.call(|s| s.delete_objects(vec!["m".to_owned()]))
        .expect("delete");
    assert!(app.view(|s| s.list_meshes()).is_empty());
}

#[test]
fn a_malformed_mesh_is_refused() {
    let mut bad_index = triangle("m");
    bad_index.indices = vec![0, 1, 3];
    assert!(validate_mesh(&bad_index).is_err());

    let mut ragged = triangle("m");
    ragged.positions.pop();
    assert!(validate_mesh(&ragged).is_err());

    let mut inf = triangle("m");
    inf.positions[4] = f32::INFINITY;
    assert!(validate_mesh(&inf).is_err());

    let huge = MeshData {
        id: "m".to_owned(),
        positions: vec![0.0; (MAX_VERTICES + 1) * 3],
        indices: Vec::new(),
        updated_at: 0,
    };
    assert!(validate_mesh(&huge).is_err());
    assert!(validate_mesh(&triangle("m")).is_ok());
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

    app.call(|s| s.delete_objects(vec!["a".to_owned()]))
        .expect("delete");
    assert_eq!(kinds(&app), vec!["ObjectsDeleted"]);
}
