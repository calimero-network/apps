//! The space on core's real wasmtime engine (`TestApp`): the 0.x `TestHost`
//! tests of the core 1.0 semantics method for method, and the access and wire
//! checks the iOS client relies on.

#![cfg(not(target_arch = "wasm32"))]

mod common;

use calimero_sdk::testing::{Failure, Org, TestApp};
use serde_json::{json, Value};

/// Members `alice` and `bob`, an org admin `ada`, and a guest `gus`. The
/// harness's `owner` owns the app and the org.
fn app() -> TestApp {
    common::app(
        Org::new()
            .admins(["ada"])
            .members(["alice", "bob"])
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

/// `updateLocation`'s arguments: `timestamp` is a u64, so a decimal string.
fn fix(tracker: &str, lat: f64, lng: f64, ts: u64) -> Value {
    json!({
        "trackerId": tracker,
        "latitude": lat, "longitude": lng, "altitude": 0.0,
        "speed": 0.0, "heading": 0.0, "battery": 90,
        "timestamp": ts.to_string()
    })
}

fn tracker(t: &mut TestApp, id: &str) -> Value {
    view(t, "alice", "getTracker", json!({ "id": id }))
}

// ── The 0.x core 1.0 tests ───────────────────────────────────────────────────

#[test]
fn owner_and_member_ids_come_from_the_caller() {
    let mut t = app();
    call(&mut t, "alice", "join", json!({ "username": "alice" }));
    assert_eq!(
        call(
            &mut t,
            "alice",
            "createTracker",
            json!({ "id": "t1", "name": "Phone" })
        ),
        json!("t1")
    );
    assert_eq!(tracker(&mut t, "t1")["ownerId"], json!("alice"));
    assert_eq!(tracker(&mut t, "t1")["createdAt"], json!(common::T0));
    let members = view(&mut t, "bob", "getMembers", json!({}));
    assert_eq!(members.as_array().map(Vec::len), Some(1));
    assert_eq!(members[0]["id"], json!("alice"));
    assert_eq!(
        view(&mut t, "alice", "whoami", json!({})),
        json!({ "memberId": "alice", "org": calimero_sdk::testing::ORG_ID, "orgRole": "member" })
    );
}

#[test]
fn only_the_owner_reports_a_trackers_location() {
    let mut t = app();
    call(
        &mut t,
        "alice",
        "createTracker",
        json!({ "id": "t1", "name": "Phone" }),
    );

    assert_eq!(
        code(t.as_("bob").call("updateLocation", fix("t1", 1.0, 2.0, 10))),
        "Forbidden",
        "another member must not move my pin"
    );
    // Not even an org admin may forge a sighting.
    assert_eq!(
        code(t.as_("ada").call("updateLocation", fix("t1", 1.0, 2.0, 10))),
        "Forbidden"
    );

    call(&mut t, "alice", "updateLocation", fix("t1", 1.0, 2.0, 10));
    let latest = tracker(&mut t, "t1")["latest"].clone();
    assert_eq!(
        (latest["latitude"].clone(), latest["longitude"].clone()),
        (json!(1.0), json!(2.0))
    );
    assert_eq!(
        latest["timestamp"],
        json!(10),
        "a record keeps JSON numbers"
    );
    let history = view(
        &mut t,
        "bob",
        "getHistory",
        json!({ "trackerId": "t1", "since": "0" }),
    );
    assert_eq!(history.as_array().map(Vec::len), Some(1));
}

#[test]
fn an_org_admin_moderates_but_a_member_cannot() {
    let mut t = app();
    call(
        &mut t,
        "alice",
        "createTracker",
        json!({ "id": "t1", "name": "Phone" }),
    );

    assert_eq!(
        code(t.as_("bob").call("deleteTracker", json!({ "id": "t1" }))),
        "Forbidden"
    );
    assert_eq!(
        code(t.as_("bob").call("renameSpace", json!({ "name": "Mine" }))),
        "Forbidden"
    );
    assert_ne!(tracker(&mut t, "t1"), json!(null));

    call(&mut t, "ada", "deleteTracker", json!({ "id": "t1" }));
    call(&mut t, "ada", "renameSpace", json!({ "name": "Ours" }));
    assert_eq!(tracker(&mut t, "t1"), json!(null));
    assert_eq!(
        view(&mut t, "bob", "getSpace", json!({}))["name"],
        json!("Ours")
    );
    assert_eq!(
        view(&mut t, "ada", "whoami", json!({}))["orgRole"],
        json!("admin")
    );
}

#[test]
fn a_member_may_leave_a_group_but_not_remove_others() {
    let mut t = app();
    call(
        &mut t,
        "alice",
        "createGroup",
        json!({ "id": "g1", "name": "Hike" }),
    );
    call(
        &mut t,
        "alice",
        "addGroupMember",
        json!({ "groupId": "g1", "memberId": "bob" }),
    );

    assert_eq!(
        code(t.as_("bob").call(
            "removeGroupMember",
            json!({ "groupId": "g1", "memberId": "alice" })
        )),
        "Forbidden"
    );
    call(
        &mut t,
        "bob",
        "removeGroupMember",
        json!({ "groupId": "g1", "memberId": "bob" }),
    );
    let groups = view(&mut t, "alice", "getGroups", json!({}));
    assert_eq!(groups[0]["memberIds"], json!(["alice"]));
}

#[test]
fn record_clocks_only_move_forward() {
    let mut t = app();
    call(
        &mut t,
        "alice",
        "createTracker",
        json!({ "id": "t1", "name": "a" }),
    );
    let first = tracker(&mut t, "t1")["updatedAt"].as_u64();
    call(
        &mut t,
        "alice",
        "renameTracker",
        json!({ "id": "t1", "name": "b" }),
    );
    let second = tracker(&mut t, "t1");
    assert!(second["updatedAt"].as_u64() > first);
    assert_eq!(second["name"], json!("b"));
}

#[test]
fn events_carry_a_named_id() {
    let mut t = app();
    call(
        &mut t,
        "alice",
        "createTracker",
        json!({ "id": "t1", "name": "a" }),
    );
    assert_eq!(
        t.events_for("bob"),
        [("TrackerCreated".to_owned(), json!({ "id": "t1" }))]
    );
}

// ── Trackers, history, sharing ───────────────────────────────────────────────

#[test]
fn create_is_idempotent_and_keeps_the_first_owner() {
    let mut t = app();
    call(
        &mut t,
        "alice",
        "createTracker",
        json!({ "id": "t1", "name": "Phone" }),
    );
    assert_eq!(
        call(
            &mut t,
            "bob",
            "createTracker",
            json!({ "id": "t1", "name": "Stolen" })
        ),
        json!("t1")
    );
    assert_eq!(tracker(&mut t, "t1")["ownerId"], json!("alice"));
    assert_eq!(tracker(&mut t, "t1")["name"], json!("Phone"));
    assert_eq!(names(&t, "bob"), ["TrackerCreated"]);
}

#[test]
fn a_stale_fix_is_history_but_not_the_latest() {
    let mut t = app();
    call(
        &mut t,
        "alice",
        "createTracker",
        json!({ "id": "t1", "name": "Phone" }),
    );
    call(&mut t, "alice", "updateLocation", fix("t1", 1.0, 1.0, 200));
    call(&mut t, "alice", "updateLocation", fix("t1", 2.0, 2.0, 100));
    assert_eq!(tracker(&mut t, "t1")["latest"]["timestamp"], json!(200));
    let all = view(
        &mut t,
        "alice",
        "getHistory",
        json!({ "trackerId": "t1", "since": "0" }),
    );
    assert_eq!(all.as_array().map(Vec::len), Some(2));
    let recent = view(
        &mut t,
        "alice",
        "getHistory",
        json!({ "trackerId": "t1", "since": "150" }),
    );
    assert_eq!(
        recent,
        json!([{ "latitude": 1.0, "longitude": 1.0, "timestamp": 200 }])
    );

    assert_eq!(
        code(
            t.as_("alice")
                .call("updateLocation", fix("t1", 91.0, 0.0, 300))
        ),
        "Invalid"
    );
    // An unknown tracker is ignored.
    call(
        &mut t,
        "alice",
        "updateLocation",
        fix("nope", 1.0, 1.0, 300),
    );
    assert_eq!(
        names(&t, "bob"),
        ["TrackerCreated", "TrackerUpdated", "TrackerUpdated"]
    );
}

#[test]
fn history_keeps_the_newest_samples() {
    let mut t = app();
    call(
        &mut t,
        "alice",
        "createTracker",
        json!({ "id": "t1", "name": "Phone" }),
    );
    for ts in 1..=505u64 {
        call(&mut t, "alice", "updateLocation", fix("t1", 1.0, 1.0, ts));
    }
    let all = view(
        &mut t,
        "alice",
        "getHistory",
        json!({ "trackerId": "t1", "since": "0" }),
    );
    let all = all.as_array().expect("a list");
    assert_eq!(all.len(), 500);
    assert_eq!(all[0]["timestamp"], json!(6));
    assert_eq!(all[499]["timestamp"], json!(505));
}

#[test]
fn sharing_is_the_owners_and_a_viewer_may_leave() {
    let mut t = app();
    call(
        &mut t,
        "alice",
        "createTracker",
        json!({ "id": "t1", "name": "Phone" }),
    );
    let share = json!({ "trackerId": "t1", "userId": "bob" });
    assert_eq!(
        code(t.as_("bob").call("shareTracker", share.clone())),
        "Forbidden"
    );
    call(&mut t, "alice", "shareTracker", share.clone());
    call(&mut t, "alice", "shareTracker", share.clone());
    assert_eq!(tracker(&mut t, "t1")["viewers"], json!(["bob"]));

    let unshare_alice = json!({ "trackerId": "t1", "userId": "alice" });
    assert_eq!(
        code(t.as_("bob").call("unshareTracker", unshare_alice)),
        "Forbidden"
    );
    call(&mut t, "bob", "unshareTracker", share);
    assert_eq!(tracker(&mut t, "t1")["viewers"], json!([]));
}

// ── Geofences and presence ───────────────────────────────────────────────────

#[test]
fn geofences_are_validated_and_their_creators() {
    let mut t = app();
    let home = json!({ "id": "g1", "name": "Home", "centerLat": 45.0, "centerLng": 16.0, "radius": 100.0 });
    assert_eq!(
        call(&mut t, "alice", "createGeofence", home.clone()),
        json!("g1")
    );
    assert_eq!(
        code(t.as_("bob").call("createGeofence", home.clone())),
        "Forbidden"
    );
    assert_eq!(
        code(t.as_("bob").call("deleteGeofence", json!({ "id": "g1" }))),
        "Forbidden"
    );

    let mut flat = home.clone();
    flat["radius"] = json!(0.0);
    assert_eq!(code(t.as_("alice").call("createGeofence", flat)), "Invalid");
    let mut off = home;
    off["centerLng"] = json!(181.0);
    assert_eq!(code(t.as_("alice").call("createGeofence", off)), "Invalid");

    for kind in ["enter", "exit", "linger"] {
        call(
            &mut t,
            "bob",
            "reportGeofenceEvent",
            json!({ "geofenceId": "g1", "kind": kind }),
        );
    }
    call(
        &mut t,
        "bob",
        "reportGeofenceEvent",
        json!({ "geofenceId": "nope", "kind": "enter" }),
    );
    call(&mut t, "ada", "deleteGeofence", json!({ "id": "g1" }));
    assert_eq!(view(&mut t, "alice", "getGeofences", json!({})), json!([]));
    assert_eq!(
        names(&t, "alice"),
        [
            "GeofenceCreated",
            "GeofenceEntered",
            "GeofenceExited",
            "GeofenceDeleted"
        ]
    );
}

#[test]
fn presence_is_one_entry_per_member() {
    let mut t = app();
    call(&mut t, "bob", "updatePresence", json!({ "online": true }));
    call(&mut t, "bob", "updatePresence", json!({ "online": false }));
    let presence = view(&mut t, "alice", "getPresence", json!({}));
    assert_eq!(
        presence,
        json!([{ "userId": "bob", "online": false, "lastSeen": common::T0 + 1 }])
    );
}

// ── Access and wire ──────────────────────────────────────────────────────────

#[test]
fn who_reaches_the_space() {
    let mut t = app();
    call(&mut t, "gus", "join", json!({ "username": "Gus" }));
    assert_eq!(
        view(&mut t, "gus", "whoami", json!({}))["orgRole"],
        json!("guest")
    );
    assert_eq!(
        t.anonymous().view("getSpace", json!({})),
        Err(Failure::Refused {
            status: 401,
            code: "UNAUTHENTICATED".to_owned()
        })
    );
    assert_eq!(
        t.as_("mallory").view("getSpace", json!({})),
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
        code(t.as_("alice").view("get_space", json!({}))),
        "UnknownMethod"
    );
    assert_eq!(
        code(t.as_("alice").call(
            "createTracker",
            json!({ "id": "t1", "name": "a", "owner_id": "x" })
        )),
        "BadArgs"
    );
    // A u64 parameter sent as a JSON number is refused.
    let mut numeric = fix("t1", 1.0, 1.0, 5);
    numeric["timestamp"] = json!(5);
    assert_eq!(
        code(t.as_("alice").call("updateLocation", numeric)),
        "BadArgs"
    );
    assert_eq!(
        code(t.as_("alice").view("join", json!({ "username": "x" }))),
        "NotAView"
    );
}
