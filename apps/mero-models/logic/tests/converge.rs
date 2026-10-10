//! Two replicas, concurrent writes, one root hash.
//!
//! `src/tests.rs` drives one store. This is the case it cannot show: two
//! devices editing the SAME object at the same moment without having seen each
//! other, which a shared scene hits every time two people grab one cube. The
//! assertion is root-hash equality — what production sync relies on — plus an
//! invariant saying what a correct merge looks like.
//!
//! `one_account`: the replicas are two devices of the scene's creator, because
//! only an editor may write the scene at all and the harness has no way to
//! grant a role to another replica's account before the ops run.

use calimero_storage::testing::converge_app;
use mero_models::{Material, MeroModels, SceneObject, Vec3};

const NOW: u64 = 1_700_000_000_000;

fn scene() -> impl Fn() -> MeroModels {
    || MeroModels::init("Converging scene".to_owned())
}

fn cube(id: &str, x: f64, color: &str) -> SceneObject {
    SceneObject {
        id: id.to_owned(),
        name: "Cube".to_owned(),
        kind: "cube".to_owned(),
        parent: String::new(),
        position: Vec3 { x, y: 0.0, z: 0.0 },
        rotation: Vec3::ZERO,
        scale: Vec3::ONE,
        visible: true,
        material: Material {
            color: color.to_owned(),
            metalness: 0.0,
            roughness: 0.5,
            opacity: 1.0,
            emissive: "#000000".to_owned(),
            wireframe: false,
            flat_shading: false,
        },
        segments: 32,
        intensity: 0.0,
        created_by: String::new(),
        created_at: 0,
        updated_at: 0,
    }
}

#[test]
fn two_people_dragging_one_cube_agree_on_where_it_ended_up() {
    converge_app(scene())
        .one_account()
        .replicas(2)
        .ops(|s| {
            let _ = s.put_objects(vec![cube("shared", 1.0, "#ff0000")], NOW);
        })
        .ops(|s| {
            let _ = s.put_objects(vec![cube("shared", 5.0, "#00ff00")], NOW + 1);
        })
        .invariant("the cube exists exactly once", |s| {
            s.get_objects().iter().filter(|o| o.id == "shared").count() == 1
        })
        // WHICH write wins is the storage layer's call — it orders the two by
        // its own causal clock, not by the `updated_at` the contract stamps —
        // so the invariant is that one of them wins WHOLE. A merge that took
        // the position from one write and the colour from the other would be
        // a cube neither person made.
        .invariant("one write wins whole, never a mix of both", |s| {
            let o = s
                .get_objects()
                .into_iter()
                .find(|o| o.id == "shared")
                .unwrap();
            (o.position.x == 1.0 && o.material.color == "#ff0000")
                || (o.position.x == 5.0 && o.material.color == "#00ff00")
        })
        .assert_all_replicas_equal();
}

#[test]
fn concurrent_additions_of_different_objects_both_survive() {
    converge_app(scene())
        .one_account()
        .replicas(2)
        .ops(|s| {
            let _ = s.put_objects(vec![cube("left", -1.0, "#ff0000")], NOW);
        })
        .ops(|s| {
            let _ = s.put_objects(vec![cube("right", 1.0, "#0000ff")], NOW);
        })
        .invariant("both objects are in the scene", |s| {
            let ids: Vec<String> = s.get_objects().into_iter().map(|o| o.id).collect();
            ids.contains(&"left".to_owned()) && ids.contains(&"right".to_owned())
        })
        .assert_all_replicas_equal();
}

#[test]
fn concurrent_reparenting_into_a_loop_reads_as_two_roots_everywhere() {
    // Each replica makes one legal re-parent; together they form a cycle.
    converge_app(scene())
        .one_account()
        .replicas(2)
        .ops(|s| {
            let mut a = cube("a", 0.0, "#ffffff");
            a.parent = "b".to_owned();
            let b = cube("b", 0.0, "#ffffff");
            let _ = s.put_objects(vec![a, b], NOW);
        })
        .ops(|s| {
            let a = cube("a", 0.0, "#ffffff");
            let mut b = cube("b", 0.0, "#ffffff");
            b.parent = "a".to_owned();
            let _ = s.put_objects(vec![a, b], NOW);
        })
        .invariant("no object reads as inside a loop", |s| {
            let objs = s.get_objects();
            // Whatever merged, the reader never reports a cycle: if a is under
            // b, b is a root, and vice versa.
            let parent = |id: &str| objs.iter().find(|o| o.id == id).unwrap().parent.clone();
            !(parent("a") == "b" && parent("b") == "a")
        })
        .assert_all_replicas_equal();
}
