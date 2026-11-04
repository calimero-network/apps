//! The world on core's real wasmtime engine (`TestApp`): v1's `TestHost` tests
//! method for method, the storage-level write rules v1 relied on as method
//! checks, and the access and wire checks v1 could not express.

#![cfg(not(target_arch = "wasm32"))]

mod common;

use calimero_sdk::testing::{Failure, Org, TestApp};
use serde_json::{json, Value};

/// The owner founds the world ("surface", seed 42, created at 1000); alice and
/// bob are members, gus a guest.
fn world() -> TestApp {
    let mut t = common::app(Org::new().members(["alice", "bob"]).guests(["gus"]));
    call(
        &mut t,
        "owner",
        "createWorld",
        json!({ "name": "surface", "seed": 42, "now": 1000 }),
    );
    t
}

fn call(t: &mut TestApp, who: &str, method: &str, args: Value) -> Value {
    t.as_(who)
        .call(method, args)
        .unwrap_or_else(|e| panic!("{who} {method}: {e:?}"))
}

fn view(t: &mut TestApp, method: &str, args: Value) -> Value {
    t.as_("owner")
        .view(method, args)
        .unwrap_or_else(|e| panic!("{method}: {e:?}"))
}

fn app_error(code: &str, fields: Value) -> Failure {
    Failure::App {
        code: code.to_owned(),
        fields,
    }
}

fn is_app_error(r: &Result<Value, Failure>, want: &str) -> bool {
    matches!(r, Err(Failure::App { code, .. }) if code == want)
}

fn tr(name: &str, x: f64) -> Value {
    json!({ "name": name, "x": x, "y": 60.0, "dir": 1.0, "sel": 0, "action": "walking" })
}

fn edit(x: i32, y: i32, t: u8) -> Value {
    json!({ "x": x, "y": y, "t": t })
}

fn set_tiles(t: &mut TestApp, who: &str, edits: Vec<Value>, now: u32) -> Value {
    call(t, who, "setTiles", json!({ "edits": edits, "now": now }))
}

/// Every override, page after page, as a client reads them.
fn overrides(t: &mut TestApp) -> Vec<(String, u64)> {
    let mut out = Vec::new();
    let mut args = json!({});
    loop {
        let page = view(t, "getOverrides", args);
        for e in page["items"].as_array().expect("items") {
            out.push((
                e["k"].as_str().expect("k").to_owned(),
                e["t"].as_u64().expect("t"),
            ));
        }
        match page["next"].as_str() {
            Some(next) => args = json!({ "cursor": next }),
            None => return out,
        }
    }
}

fn players(t: &mut TestApp, now: u32) -> Vec<Value> {
    view(t, "getPlayers", json!({ "now": now }))
        .as_array()
        .expect("an array")
        .clone()
}

fn player(t: &mut TestApp, id: &str, now: u32) -> Value {
    players(t, now)
        .into_iter()
        .find(|p| p["id"] == id)
        .unwrap_or_else(|| panic!("{id} is not in the roster"))
}

fn names(t: &TestApp, who: &str) -> Vec<String> {
    t.events_for(who).into_iter().map(|(n, _)| n).collect()
}

// ── v1's TestHost tests ──────────────────────────────────────────────────────

#[test]
fn world_meta_returns_the_founding_params() {
    let mut t = world();
    assert_eq!(
        view(&mut t, "worldMeta", json!({})),
        json!({ "name": "surface", "seed": 42, "createdAt": 1000 })
    );
    assert_eq!(names(&t, "alice"), ["Initialized"]);
}

#[test]
fn set_tiles_roundtrips_and_digging_stores_air() {
    let mut t = world();
    let applied = set_tiles(&mut t, "alice", vec![edit(5, 60, 7), edit(6, 61, 0)], 1000);
    assert_eq!(applied, json!(2));
    assert_eq!(
        overrides(&mut t),
        [("5,60".to_owned(), 7), ("6,61".to_owned(), 0)]
    );
    assert_eq!(
        view(&mut t, "getOverrides", json!({})),
        json!({ "items": [{ "k": "5,60", "t": 7 }, { "k": "6,61", "t": 0 }], "next": null })
    );
}

#[test]
fn same_tile_upserts_never_duplicates() {
    let mut t = world();
    set_tiles(&mut t, "alice", vec![edit(1, 1, 3)], 1000);
    set_tiles(&mut t, "bob", vec![edit(1, 1, 0)], 1010);
    assert_eq!(overrides(&mut t), [("1,1".to_owned(), 0)]);
}

#[test]
fn out_of_bounds_edits_are_skipped() {
    let mut t = world();
    let applied = set_tiles(
        &mut t,
        "alice",
        vec![
            edit(-1, 0, 1),
            edit(0, 200, 1),
            edit(400, 0, 1),
            edit(10, 10, 1),
        ],
        1000,
    );
    assert_eq!(applied, json!(1));
    assert_eq!(overrides(&mut t), [("10,10".to_owned(), 1)]);
}

#[test]
fn oversized_batch_is_rejected_and_writes_nothing() {
    let mut t = world();
    let edits: Vec<Value> = (0..513).map(|i| edit(i % 100, 1, 1)).collect();
    assert_eq!(
        t.as_("alice")
            .call("setTiles", json!({ "edits": edits, "now": 1000 })),
        Err(app_error("TooManyEdits", json!({ "max": 512 })))
    );
    assert!(overrides(&mut t).is_empty());
    // 512 is still one batch.
    let edits: Vec<Value> = (0..512).map(|i| edit(i % 400, i / 400, 1)).collect();
    assert_eq!(set_tiles(&mut t, "alice", edits, 1000), json!(512));
}

#[test]
fn join_heartbeat_roster_lifecycle() {
    let mut t = world();
    let joined = call(
        &mut t,
        "alice",
        "join",
        json!({ "name": "Alice", "now": 1000 }),
    );
    assert_eq!(
        joined,
        json!({ "id": "alice", "name": "Alice", "x": 0.0, "y": 0.0, "dir": 1.0,
                "sel": 0, "action": "idle", "online": true })
    );
    call(
        &mut t,
        "alice",
        "heartbeat",
        json!({ "t": tr("Alice", 33.0), "now": 1003 }),
    );
    let roster = players(&mut t, 1005);
    assert_eq!(roster.len(), 1);
    assert_eq!(roster[0]["online"], json!(true));
    assert_eq!(roster[0]["x"], json!(33.0));

    call(&mut t, "alice", "leave", json!({ "now": 1010 }));
    assert_eq!(players(&mut t, 1011)[0]["online"], json!(false));
    assert_eq!(
        names(&t, "bob"),
        ["Initialized", "PlayerJoined", "PlayerLeft"]
    );
    assert_eq!(
        t.events_for("bob")[1],
        ("PlayerJoined".to_owned(), json!({ "0": "alice" }))
    );
}

#[test]
fn a_vanished_player_ages_out_and_self_heals() {
    let mut t = world();
    call(
        &mut t,
        "alice",
        "join",
        json!({ "name": "Alice", "now": 1000 }),
    );
    call(&mut t, "bob", "join", json!({ "name": "Bob", "now": 1000 }));
    // Alice goes silent without `leave`; nobody writes her row, she is offline
    // because her stamp aged out.
    call(
        &mut t,
        "bob",
        "heartbeat",
        json!({ "t": tr("Bob", 0.0), "now": 1075 }),
    );
    assert_eq!(player(&mut t, "alice", 1076)["online"], json!(false));

    call(
        &mut t,
        "alice",
        "heartbeat",
        json!({ "t": tr("Alice", 5.0), "now": 1080 }),
    );
    assert_eq!(
        player(&mut t, "alice", 1081)["online"],
        json!(true),
        "a silent player is back on the next heartbeat"
    );
}

#[test]
fn skewed_fast_clock_cannot_knock_peers_offline() {
    let mut t = world();
    call(
        &mut t,
        "alice",
        "join",
        json!({ "name": "Alice", "now": 1000 }),
    );
    call(&mut t, "bob", "join", json!({ "name": "Bob", "now": 1000 }));
    // 10 minutes ahead.
    call(
        &mut t,
        "bob",
        "heartbeat",
        json!({ "t": tr("Bob", 0.0), "now": 1600 }),
    );
    call(
        &mut t,
        "alice",
        "heartbeat",
        json!({ "t": tr("Alice", 0.0), "now": 1002 }),
    );
    assert_eq!(player(&mut t, "alice", 1603)["online"], json!(true));
}

#[test]
fn backward_clock_never_freezes_liveness() {
    let mut t = world();
    call(
        &mut t,
        "alice",
        "join",
        json!({ "name": "Alice", "now": 5000 }),
    );
    call(
        &mut t,
        "alice",
        "heartbeat",
        json!({ "t": tr("Alice", 0.0), "now": 1000 }),
    );
    assert_eq!(players(&mut t, 5002)[0]["online"], json!(true));
}

#[test]
fn rejoin_preserves_position_and_takes_the_new_name() {
    let mut t = world();
    call(
        &mut t,
        "alice",
        "join",
        json!({ "name": "Alice", "now": 1000 }),
    );
    call(
        &mut t,
        "alice",
        "heartbeat",
        json!({ "t": tr("Alice", 42.0), "now": 1005 }),
    );
    let rejoined = call(
        &mut t,
        "alice",
        "join",
        json!({ "name": "Alice2", "now": 1010 }),
    );
    assert_eq!(rejoined["x"], json!(42.0), "position survives rejoin");
    let roster = players(&mut t, 1011);
    assert_eq!(roster.len(), 1);
    assert_eq!(roster[0]["x"], json!(42.0));
    assert_eq!(roster[0]["name"], json!("Alice2"));
}

/// v1 keyed an avatar by DEVICE, so one person on two machines was two
/// avatars. The component runtime names the caller's account only, so one
/// account is one avatar: a second session of the same account moves the same
/// row (listed in the README as a behavior change).
#[test]
fn one_account_is_one_avatar() {
    let mut t = world();
    call(
        &mut t,
        "alice",
        "heartbeat",
        json!({ "t": tr("Alice", 10.0), "now": 1000 }),
    );
    call(
        &mut t,
        "alice",
        "heartbeat",
        json!({ "t": tr("Alice", 90.0), "now": 1001 }),
    );
    let roster = players(&mut t, 1002);
    assert_eq!(roster.len(), 1);
    assert_eq!(roster[0]["x"], json!(90.0));
}

/// Two people are still two rows, each named by its account.
#[test]
fn two_accounts_are_two_players_in_join_order() {
    let mut t = world();
    call(&mut t, "bob", "join", json!({ "name": "Bob", "now": 1000 }));
    call(
        &mut t,
        "alice",
        "join",
        json!({ "name": "Alice", "now": 1001 }),
    );
    let roster = players(&mut t, 1002);
    let ids: Vec<&Value> = roster.iter().map(|p| &p["id"]).collect();
    assert_eq!(ids, [&json!("bob"), &json!("alice")], "join order");
}

#[test]
fn heartbeat_without_join_creates_a_live_row() {
    let mut t = world();
    call(
        &mut t,
        "alice",
        "heartbeat",
        json!({ "t": tr("Ghost", 1.0), "now": 1000 }),
    );
    let roster = players(&mut t, 1001);
    assert_eq!(roster.len(), 1);
    assert_eq!(roster[0]["online"], json!(true));
    assert_eq!(roster[0]["name"], json!("Ghost"));
    // The first heartbeat announces the player; the next ones are silent.
    call(
        &mut t,
        "alice",
        "heartbeat",
        json!({ "t": tr("Ghost", 2.0), "now": 1001 }),
    );
    assert_eq!(names(&t, "bob"), ["Initialized", "PlayerJoined"]);
}

#[test]
fn heartbeat_after_leave_announces_the_return() {
    let mut t = world();
    call(
        &mut t,
        "alice",
        "join",
        json!({ "name": "Alice", "now": 1000 }),
    );
    call(&mut t, "alice", "leave", json!({ "now": 1001 }));
    call(
        &mut t,
        "alice",
        "heartbeat",
        json!({ "t": tr("Alice", 1.0), "now": 1002 }),
    );
    assert_eq!(
        names(&t, "bob"),
        ["Initialized", "PlayerJoined", "PlayerLeft", "PlayerJoined"]
    );
    assert_eq!(players(&mut t, 1003)[0]["online"], json!(true));
}

#[test]
fn leave_when_never_joined_is_a_no_op() {
    let mut t = world();
    assert_eq!(
        call(&mut t, "alice", "leave", json!({ "now": 1000 })),
        json!(null)
    );
    assert!(players(&mut t, 1001).is_empty());
    assert_eq!(names(&t, "bob"), ["Initialized"]);
}

/// v1's two-replica edit test, under one log: both members' edits land.
#[test]
fn edits_by_two_players_both_land() {
    let mut t = world();
    set_tiles(&mut t, "alice", vec![edit(1, 1, 3)], 1000);
    set_tiles(&mut t, "bob", vec![edit(2, 2, 8)], 1000);
    assert_eq!(
        overrides(&mut t),
        [("1,1".to_owned(), 3), ("2,2".to_owned(), 8)]
    );
    assert_eq!(
        t.events_for("owner")[1..],
        [
            ("TilesChanged".to_owned(), json!({ "0": "alice" })),
            ("TilesChanged".to_owned(), json!({ "0": "bob" })),
        ]
    );
}

#[test]
fn transform_fields_survive_the_roundtrip() {
    let mut t = world();
    call(
        &mut t,
        "alice",
        "heartbeat",
        json!({ "t": { "name": "Alice", "x": 1.25, "y": 60.5, "dir": -1.0, "sel": 7,
                       "action": "mining" }, "now": 1000 }),
    );
    let p = &players(&mut t, 1001)[0];
    assert_eq!((&p["x"], &p["y"]), (&json!(1.25), &json!(60.5)));
    assert_eq!(p["dir"], json!(-1.0));
    assert_eq!(p["sel"], json!(7));
    assert_eq!(p["action"], json!("mining"));
}

#[test]
fn empty_action_defaults_to_idle_and_join_starts_idle() {
    let mut t = world();
    call(
        &mut t,
        "alice",
        "join",
        json!({ "name": "Alice", "now": 1000 }),
    );
    assert_eq!(players(&mut t, 1001)[0]["action"], json!("idle"));
    // Old clients omit the field (serde default) or send it empty.
    call(
        &mut t,
        "alice",
        "heartbeat",
        json!({ "t": { "name": "Alice", "x": 1.0, "y": 60.0, "dir": 1.0, "sel": 0 }, "now": 1002 }),
    );
    assert_eq!(players(&mut t, 1003)[0]["action"], json!("idle"));
    call(
        &mut t,
        "alice",
        "heartbeat",
        json!({ "t": { "name": "Alice", "x": 1.0, "y": 60.0, "dir": 1.0, "sel": 0, "action": "" },
                "now": 1004 }),
    );
    assert_eq!(players(&mut t, 1005)[0]["action"], json!("idle"));
}

#[test]
fn empty_batch_applies_nothing_and_emits_nothing() {
    let mut t = world();
    assert_eq!(set_tiles(&mut t, "alice", vec![], 1000), json!(0));
    assert_eq!(
        set_tiles(&mut t, "alice", vec![edit(-5, -5, 1)], 1000),
        json!(0)
    );
    assert_eq!(names(&t, "bob"), ["Initialized"]);
}

#[test]
fn world_edges_are_editable() {
    let mut t = world();
    let applied = set_tiles(
        &mut t,
        "alice",
        vec![edit(0, 0, 1), edit(399, 199, 1)],
        1000,
    );
    assert_eq!(applied, json!(2), "corner tiles are in bounds");
}

/// v1 stamped each tile and merged by stamp, so a later edit from a slow clock
/// had to win by a stamp bump. Under one log the later write simply wins,
/// whatever the clocks say.
#[test]
fn the_later_edit_wins_whatever_the_clocks() {
    let mut t = world();
    set_tiles(&mut t, "alice", vec![edit(2, 2, 7)], 9000);
    set_tiles(&mut t, "bob", vec![edit(2, 2, 4)], 1000);
    assert_eq!(overrides(&mut t), [("2,2".to_owned(), 4)]);
}

/// Building keeps the builder online: `setTiles` refreshes the caller's stamp.
#[test]
fn set_tiles_refreshes_the_builders_presence() {
    let mut t = world();
    call(
        &mut t,
        "alice",
        "join",
        json!({ "name": "Alice", "now": 1000 }),
    );
    set_tiles(&mut t, "alice", vec![edit(3, 3, 1)], 1020);
    assert_eq!(player(&mut t, "alice", 1025)["online"], json!(true));
}

/// A row stamped far in the future must not drag room time with it.
#[test]
fn a_far_future_stamp_does_not_hijack_room_time() {
    let mut t = world();
    call(
        &mut t,
        "bob",
        "heartbeat",
        json!({ "t": tr("Mallory", 0.0), "now": u32::MAX }),
    );
    call(
        &mut t,
        "alice",
        "heartbeat",
        json!({ "t": tr("Alice", 1.0), "now": 1000 }),
    );
    assert_eq!(
        player(&mut t, "alice", 1003)["online"],
        json!(true),
        "room time stayed on the real clock"
    );
    // Had the stamp been dragged to u32::MAX, alice would be offline at 1011.
    assert_eq!(player(&mut t, "alice", 1011)["online"], json!(false));
}

/// One answer is one page: 1,000 by default and at most, fewer with `limit`,
/// the next one from `cursor`, and the pages together are the whole diff.
#[test]
fn get_overrides_is_paged() {
    let mut t = world();
    for row in 0..5 {
        let edits: Vec<Value> = (0..400).map(|x| edit(x, row, 2)).collect();
        set_tiles(&mut t, "alice", edits, 1000);
    }
    let first = view(&mut t, "getOverrides", json!({}));
    assert_eq!(first["items"].as_array().map(Vec::len), Some(1000));
    assert_eq!(first["items"][0]["k"], json!("0,0"));
    assert!(first["next"].is_string());
    // `limit` past 1,000 is 1,000.
    let capped = view(&mut t, "getOverrides", json!({ "limit": 5000 }));
    assert_eq!(capped["items"].as_array().map(Vec::len), Some(1000));
    // A small page, then the one after it, continuing in key order.
    let small = view(&mut t, "getOverrides", json!({ "limit": 3 }));
    assert_eq!(small["items"].as_array().map(Vec::len), Some(3));
    let after = view(
        &mut t,
        "getOverrides",
        json!({ "cursor": small["next"], "limit": 3 }),
    );
    assert_eq!(after["items"][0], first["items"][3]);
    // Every page together: the whole diff, each tile once.
    let all = overrides(&mut t);
    assert_eq!(all.len(), 2000);
    let keys: std::collections::BTreeSet<&String> = all.iter().map(|(k, _)| k).collect();
    assert_eq!(keys.len(), 2000);
}

/// A cursor that is not one the app handed out reads nothing.
#[test]
fn a_forged_cursor_is_refused() {
    let mut t = world();
    set_tiles(&mut t, "alice", vec![edit(1, 1, 1)], 1000);
    assert!(t
        .as_("owner")
        .view("getOverrides", json!({ "cursor": "not-a-cursor" }))
        .is_err());
}

/// Every call reads the whole roster to find room time, so a world keeps at
/// most 1,000 avatars: one page. A new account past that is `WorldFull`; an
/// account already in the world still plays.
#[test]
fn a_world_keeps_at_most_a_thousand_avatars() {
    let names: Vec<String> = (0..1001).map(|i| format!("p{i:04}")).collect();
    let mut t = common::app(Org::new().members(names.clone()));
    call(
        &mut t,
        "owner",
        "createWorld",
        json!({ "name": "busy", "seed": 1, "now": 1000 }),
    );
    for name in &names[..1000] {
        call(
            &mut t,
            name,
            "heartbeat",
            json!({ "t": tr(name, 1.0), "now": 1000 }),
        );
    }
    for (method, args) in [
        ("join", json!({ "name": "late", "now": 1001 })),
        ("heartbeat", json!({ "t": tr("late", 1.0), "now": 1001 })),
    ] {
        assert_eq!(
            t.as_("p1000").call(method, args),
            Err(app_error("WorldFull", json!({ "max": 1000 }))),
            "{method}"
        );
    }
    call(
        &mut t,
        "p0000",
        "join",
        json!({ "name": "back", "now": 1002 }),
    );
    assert_eq!(players(&mut t, 1003).len(), 1000);
}

// ── v1's storage write rules, as method checks ───────────────────────────────

/// v1: `meta` was `Frozen` (written at init, never again). Now: only the owner
/// founds the world, once.
#[test]
fn only_the_owner_founds_the_world_and_only_once() {
    let mut t = common::app(Org::new().admins(["ada"]).members(["alice"]));
    assert_eq!(
        t.as_("owner").view("worldMeta", json!({})),
        Err(app_error("NoWorld", json!({})))
    );
    for who in ["ada", "alice"] {
        assert_eq!(
            t.as_(who)
                .call("createWorld", json!({ "name": "x", "seed": 1, "now": 1 })),
            Err(app_error("Forbidden", json!({}))),
            "{who}"
        );
    }
    call(
        &mut t,
        "owner",
        "createWorld",
        json!({ "name": "surface", "seed": 42, "now": 1000 }),
    );
    assert_eq!(
        t.as_("owner").call(
            "createWorld",
            json!({ "name": "other", "seed": 7, "now": 2000 })
        ),
        Err(app_error("WorldExists", json!({})))
    );
    assert_eq!(
        view(&mut t, "worldMeta", json!({})),
        json!({ "name": "surface", "seed": 42, "createdAt": 1000 })
    );
}

/// Before the world is founded, writes are refused and reads are empty.
#[test]
fn nothing_is_written_before_the_world_exists() {
    let mut t = common::app(Org::new().members(["alice"]));
    for (method, args) in [
        ("setTiles", json!({ "edits": [edit(1, 1, 1)], "now": 1 })),
        ("join", json!({ "name": "A", "now": 1 })),
        ("heartbeat", json!({ "t": tr("A", 1.0), "now": 1 })),
        ("leave", json!({ "now": 1 })),
    ] {
        assert_eq!(
            t.as_("alice").call(method, args),
            Err(app_error("NoWorld", json!({}))),
            "{method}"
        );
    }
    assert_eq!(
        view(&mut t, "getOverrides", json!({})),
        json!({ "items": [], "next": null })
    );
    assert_eq!(view(&mut t, "getPlayers", json!({ "now": 1 })), json!([]));
}

/// v1: another account writing into my `UserStorage` slot (a patched node) was
/// refused by storage. Now no method names a row: bob's every write lands on
/// bob's own row, and alice's stays hers.
#[test]
fn another_account_cannot_move_or_evict_my_avatar() {
    let mut t = world();
    call(
        &mut t,
        "alice",
        "heartbeat",
        json!({ "t": tr("Alice", 10.0), "now": 1000 }),
    );
    // Bob claims alice's name and leaves: it is bob's row that moves and leaves.
    call(
        &mut t,
        "bob",
        "heartbeat",
        json!({ "t": tr("Alice", 999.0), "now": 1001 }),
    );
    call(&mut t, "bob", "leave", json!({ "now": 1002 }));
    // An extra key naming a row is not an argument.
    assert!(is_app_error(
        &t.as_("bob")
            .call("leave", json!({ "now": 1003, "id": "alice" })),
        "BadArgs"
    ));
    let alice = player(&mut t, "alice", 1003);
    assert_eq!(alice["x"], json!(10.0));
    assert_eq!(alice["online"], json!(true));
    assert_eq!(player(&mut t, "bob", 1003)["online"], json!(false));
}

// ── what v1 could not check ──────────────────────────────────────────────────

/// The org decides who reaches the world: members, admins, the owner, and a
/// guest (as any member of a v1 context could play). Nobody else.
#[test]
fn who_reaches_the_world() {
    let mut t = world();
    assert_eq!(
        set_tiles(&mut t, "gus", vec![edit(7, 7, 1)], 1000),
        json!(1)
    );
    call(&mut t, "gus", "join", json!({ "name": "Gus", "now": 1000 }));

    let refused = |status, code: &str| {
        Err(Failure::Refused {
            status,
            code: code.to_owned(),
        })
    };
    assert_eq!(
        t.anonymous().view("getOverrides", json!({})),
        refused(401, "UNAUTHENTICATED")
    );
    assert_eq!(
        t.anonymous()
            .call("setTiles", json!({ "edits": [], "now": 1 })),
        refused(401, "UNAUTHENTICATED")
    );
    assert_eq!(
        t.as_("mallory")
            .call("setTiles", json!({ "edits": [edit(7, 7, 0)], "now": 1 })),
        refused(404, "NOT_FOUND")
    );
    assert_eq!(
        t.as_("mallory").view("getPlayers", json!({ "now": 1 })),
        refused(404, "NOT_FOUND")
    );
    assert_eq!(overrides(&mut t), [("7,7".to_owned(), 1)]);
}

/// Arguments are a JSON object of exactly the method's parameters.
#[test]
fn malformed_arguments_are_refused_before_anything_is_written() {
    let mut t = world();
    for args in [
        json!({ "edits": [edit(1, 1, 1)] }),
        json!({ "edits": [edit(1, 1, 1)], "now": 1, "extra": 1 }),
        json!({ "edits": [{ "x": 1, "y": 1 }], "now": 1 }),
        json!({ "edits": [edit(1, 1, 1)], "now": "1" }),
        json!({ "edits": [{ "x": 1, "y": 1, "t": 256 }], "now": 1 }),
        json!({ "edits": [edit(1, 1, 1)], "now": -1 }),
    ] {
        assert!(
            is_app_error(&t.as_("alice").call("setTiles", args.clone()), "BadArgs"),
            "{args}"
        );
    }
    assert!(overrides(&mut t).is_empty());
    assert_eq!(names(&t, "bob"), ["Initialized"]);
}

/// v1's snake_case names are not methods any more: the ABI's are camelCase.
#[test]
fn methods_are_reached_by_their_camel_case_names() {
    let mut t = world();
    for (method, args) in [
        ("set_tiles", json!({ "edits": [], "now": 1 })),
        ("world_meta", json!({})),
        ("get_players", json!({ "now": 1 })),
        ("init", json!({})),
    ] {
        let r = t.as_("alice").call(method, args);
        assert!(
            is_app_error(&r, "UnknownMethod") || is_app_error(&r, "WrongKind"),
            "{method}: {r:?}"
        );
    }
    // A write is not a view.
    assert!(is_app_error(
        &t.as_("alice")
            .view("join", json!({ "name": "A", "now": 1 })),
        "NotAView"
    ));
    // A view may run as a call.
    assert_eq!(
        call(&mut t, "alice", "worldMeta", json!({}))["seed"],
        json!(42)
    );
}
