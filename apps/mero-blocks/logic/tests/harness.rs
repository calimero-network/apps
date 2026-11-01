//! The world on core's real wasmtime engine (`TestApp`): v1's `TestHost` tests
//! method for method, v1's storage-level write rules as what they are now
//! (method checks, tried as another account), and the access and wire checks
//! v1 could not express.
//!
//! In the harness an account's id is its name (`"bob"`), so an avatar joined
//! without a device has `id == "bob"`, and with device `"laptop"` it is
//! `"bob/laptop"`. Every `u64` (`now`, `seed`, `createdAt`) is a decimal string.

#![cfg(not(target_arch = "wasm32"))]

mod common;

use calimero_app_sdk::testing::{Failure, Org, TestApp};
use serde_json::{json, Value};

/// The owner, two members (`alice`, `bob`) and a guest (`gus`).
fn world() -> TestApp {
    common::app(Org::new().members(["alice", "bob"]).guests(["gus"]))
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

fn edit(x: i32, y: i32, z: i32, b: u8) -> Value {
    json!({ "x": x, "y": y, "z": z, "b": b })
}

fn set_blocks(t: &mut TestApp, who: &str, edits: Vec<Value>, now: u64) -> Value {
    call(
        t,
        who,
        "setBlocks",
        json!({ "edits": edits, "now": now.to_string() }),
    )
}

fn tf(name: &str, x: f64) -> Value {
    json!({ "name": name, "x": x, "y": 30.0, "z": 64.0, "yaw": 0.0, "pitch": 0.0, "sel": 0 })
}

fn heartbeat(t: &mut TestApp, who: &str, transform: Value, now: u64) {
    call(
        t,
        who,
        "heartbeat",
        json!({ "t": transform, "now": now.to_string() }),
    );
}

fn join(t: &mut TestApp, who: &str, name: &str, now: u64) -> Value {
    call(
        t,
        who,
        "join",
        json!({ "name": name, "now": now.to_string() }),
    )
}

/// Every page of a paged view (`{ items, next }`), following `next`.
fn all_pages(t: &mut TestApp, method: &str, args: Value) -> Vec<Value> {
    let mut out = Vec::new();
    let mut args = args;
    loop {
        let page = view(t, method, args.clone());
        out.extend(page["items"].as_array().expect("items").iter().cloned());
        match page["next"].as_str() {
            Some(next) => args["cursor"] = json!(next),
            None => {
                assert_eq!(page["next"], Value::Null);
                return out;
            }
        }
    }
}

fn players(t: &mut TestApp, now: u64) -> Vec<Value> {
    all_pages(t, "getPlayers", json!({ "now": now.to_string() }))
}

fn player<'a>(rows: &'a [Value], id: &str) -> &'a Value {
    rows.iter()
        .find(|p| p["id"] == id)
        .unwrap_or_else(|| panic!("no player {id} in {rows:?}"))
}

fn overrides(t: &mut TestApp) -> Vec<Value> {
    all_pages(t, "getOverrides", json!({}))
}

/// The event names `who` has heard so far.
fn heard(t: &TestApp, who: &str) -> Vec<String> {
    t.events_for(who).into_iter().map(|(n, _)| n).collect()
}

// ── init and world meta ──────────────────────────────────────────────────────

/// `init` with no arguments (how the harness and `merod local`'s scenario
/// runner create an instance): the default name, the leader's clock at the
/// init entry, a seed in [0, 2^32).
#[test]
fn init_without_arguments_makes_a_default_world() {
    let mut t = world();
    let meta = view(&mut t, "worldMeta", json!({}));
    assert_eq!(meta["name"], "overworld");
    assert_eq!(meta["createdAt"], json!((common::T0 / 1000).to_string()));
    let seed: u64 = meta["seed"]
        .as_str()
        .expect("seed is a decimal string")
        .parse()
        .expect("a number");
    assert!(seed < 1 << 32);
    assert_eq!(heard(&t, "bob"), ["Initialized"]);
}

/// v1's `Frozen` meta: written once, by `init`. No method writes it, so after
/// every write method has run as every kind of account it is unchanged, and
/// there is no setter to reach.
#[test]
fn world_meta_is_written_by_init_only() {
    let mut t = world();
    let before = view(&mut t, "worldMeta", json!({}));
    for who in ["owner", "alice", "gus"] {
        set_blocks(&mut t, who, vec![edit(1, 1, 1, 3)], 1000);
        join(&mut t, who, who, 1000);
        heartbeat(&mut t, who, tf(who, 1.0), 1001);
        call(&mut t, who, "leave", json!({ "now": "1002" }));
    }
    assert_eq!(view(&mut t, "worldMeta", json!({})), before);
    for method in ["setWorldMeta", "init"] {
        let refused = t
            .as_("owner")
            .call(method, json!({ "name": "x", "seed": "1", "now": "1" }));
        assert!(
            matches!(refused, Err(Failure::App { ref code, .. }) if code == "UnknownMethod" || code == "WrongKind"),
            "{method}: {refused:?}"
        );
    }
}

// ── blocks (v1's TestHost tests) ─────────────────────────────────────────────

#[test]
fn set_blocks_roundtrips_through_get_overrides() {
    let mut t = world();
    let applied = set_blocks(
        &mut t,
        "alice",
        vec![edit(1, 2, 3, 5), edit(4, 5, 6, 0)],
        1000,
    );
    assert_eq!(applied, json!(2), "a u32: a number, as in v1");
    assert_eq!(
        overrides(&mut t),
        [
            json!({ "k": "1,2,3", "b": 5 }),
            json!({ "k": "4,5,6", "b": 0 })
        ],
        "breaking stores an explicit air override"
    );
}

#[test]
fn breaking_then_replacing_same_block_holds_the_latest() {
    let mut t = world();
    set_blocks(&mut t, "alice", vec![edit(1, 1, 1, 3)], 1000);
    set_blocks(&mut t, "bob", vec![edit(1, 1, 1, 0)], 1010);
    set_blocks(&mut t, "alice", vec![edit(1, 1, 1, 9)], 1020);
    assert_eq!(
        overrides(&mut t),
        [json!({ "k": "1,1,1", "b": 9 })],
        "same key upserts, never duplicates"
    );
}

#[test]
fn out_of_bounds_edits_are_skipped_not_fatal() {
    let mut t = world();
    let applied = set_blocks(
        &mut t,
        "alice",
        vec![
            edit(-1, 0, 0, 1),
            edit(0, 64, 0, 1),
            edit(128, 0, 0, 1),
            edit(0, 0, 128, 1),
            edit(10, 10, 10, 1),
        ],
        1000,
    );
    assert_eq!(applied, json!(1));
    assert_eq!(overrides(&mut t).len(), 1);
}

#[test]
fn oversized_batch_is_rejected_and_applies_nothing() {
    let mut t = world();
    let edits: Vec<Value> = (0..513).map(|i| edit(i % 100, 1, i / 100, 1)).collect();
    assert_eq!(
        t.as_("alice")
            .call("setBlocks", json!({ "edits": edits, "now": "1000" })),
        Err(app_error("TooManyEdits", json!({ "max": 512, "got": 513 })))
    );
    assert!(overrides(&mut t).is_empty());
    assert_eq!(heard(&t, "bob"), ["Initialized"]);

    // Exactly 512 is fine.
    let edits: Vec<Value> = (0..512).map(|i| edit(i % 100, 1, i / 100, 1)).collect();
    assert_eq!(set_blocks(&mut t, "alice", edits, 1000), json!(512));
}

#[test]
fn override_count_tracks_distinct_keys() {
    let mut t = world();
    set_blocks(
        &mut t,
        "alice",
        vec![edit(1, 1, 1, 3), edit(2, 1, 1, 3)],
        1000,
    );
    set_blocks(&mut t, "bob", vec![edit(1, 1, 1, 0)], 1001);
    assert_eq!(
        view(&mut t, "overrideCount", json!({})),
        json!(2),
        "upserts don't duplicate"
    );
    assert_eq!(
        view(&mut t, "worldStats", json!({})),
        json!({ "overrides": "2", "players": "0" })
    );
}

#[test]
fn concurrent_edits_by_two_players_both_land() {
    let mut t = world();
    set_blocks(&mut t, "alice", vec![edit(1, 1, 1, 3)], 1000);
    set_blocks(&mut t, "bob", vec![edit(2, 2, 2, 8)], 1000);
    assert_eq!(overrides(&mut t).len(), 2);
}

#[test]
fn empty_batch_applies_nothing_and_emits_nothing() {
    let mut t = world();
    assert_eq!(set_blocks(&mut t, "alice", vec![], 1000), json!(0));
    assert!(overrides(&mut t).is_empty());
    assert_eq!(heard(&t, "bob"), ["Initialized"]);
}

#[test]
fn world_edges_are_editable() {
    let mut t = world();
    let applied = set_blocks(
        &mut t,
        "alice",
        vec![edit(0, 0, 0, 1), edit(127, 63, 127, 1)],
        1000,
    );
    assert_eq!(applied, json!(2), "corner blocks are in bounds");
}

/// v1 needed `stamp = stored + 1` so a slow clock's edit still won the LWW
/// merge. Under one log the later call wins whatever the client's clock says.
#[test]
fn the_later_edit_wins_whatever_the_clocks_say() {
    let mut t = world();
    set_blocks(&mut t, "alice", vec![edit(2, 2, 2, 7)], 9000);
    set_blocks(&mut t, "bob", vec![edit(2, 2, 2, 4)], 1000);
    assert_eq!(overrides(&mut t), [json!({ "k": "2,2,2", "b": 4 })]);
}

/// `getOverrides` answers a page at a time (the map only grows, up to ~1M
/// coordinates): at most 1,000 entries by default and at most, a smaller
/// `limit` on request, and a cursor that walks every entry exactly once.
#[test]
fn get_overrides_is_paged() {
    let mut t = world();
    let mut n = 0;
    for batch in 0..3 {
        let edits: Vec<Value> = (0..400)
            .map(|i| {
                let j = batch * 400 + i;
                edit(j % 128, 1 + j / (128 * 128), (j / 128) % 128, 2)
            })
            .collect();
        n += 400;
        set_blocks(&mut t, "alice", edits, 1000);
    }
    assert_eq!(view(&mut t, "overrideCount", json!({})), json!(n));

    let first = view(&mut t, "getOverrides", json!({}));
    assert_eq!(first["items"].as_array().map(Vec::len), Some(1000));
    let next = first["next"].as_str().expect("a next page").to_owned();
    let second = view(&mut t, "getOverrides", json!({ "cursor": next }));
    assert_eq!(second["items"].as_array().map(Vec::len), Some(200));
    assert_eq!(second["next"], Value::Null);

    // A limit past the cap is the cap; a small one pages finer.
    let capped = view(&mut t, "getOverrides", json!({ "limit": 5000 }));
    assert_eq!(capped["items"].as_array().map(Vec::len), Some(1000));
    let small = all_pages(&mut t, "getOverrides", json!({ "limit": 7 }));
    assert_eq!(small.len(), 1200);
    let mut keys: Vec<&str> = small.iter().filter_map(|e| e["k"].as_str()).collect();
    let in_order = keys.clone();
    keys.sort_unstable();
    keys.dedup();
    assert_eq!(keys.len(), 1200, "every entry exactly once");
    assert_eq!(in_order, keys, "in key order");

    // Not a cursor this map handed out.
    assert!(t
        .as_("owner")
        .view("getOverrides", json!({ "cursor": "bm90LWEtY3Vyc29y" }))
        .is_err());
}

/// `getPlayers` is paged the same way, and every row on every page carries
/// the same room clock.
#[test]
fn get_players_is_paged() {
    let mut t = world();
    for (who, now) in [("owner", 1000), ("alice", 1005), ("bob", 1012)] {
        join(&mut t, who, who, now);
    }
    let first = view(&mut t, "getPlayers", json!({ "now": "1012", "limit": 2 }));
    let rows = first["items"].as_array().expect("items");
    assert_eq!(rows.len(), 2);
    let next = first["next"].as_str().expect("a next page").to_owned();
    let second = view(
        &mut t,
        "getPlayers",
        json!({ "now": "1012", "limit": 2, "cursor": next }),
    );
    assert_eq!(second["next"], Value::Null);
    let all: Vec<Value> = rows
        .iter()
        .chain(second["items"].as_array().expect("items"))
        .cloned()
        .collect();
    let online: Vec<(&str, bool)> = all
        .iter()
        .map(|p| (p["id"].as_str().unwrap_or(""), p["online"] == true))
        .collect();
    assert_eq!(
        online,
        [("alice", true), ("bob", true), ("owner", false)],
        "owner's 1000 is 12 s behind the room clock wherever its row falls"
    );
}

/// Room time comes from the stamp index, one read however many rows there
/// are: every move of a row's stamp replaces its index entry, so a stale stamp
/// never lingers and a row's own older stamp never counts.
#[test]
fn the_room_clock_follows_every_stamp_move() {
    let mut t = world();
    join(&mut t, "alice", "Alice", 1000);
    heartbeat(&mut t, "alice", tf("Alice", 1.0), 1020);
    call(&mut t, "alice", "leave", json!({ "now": "1030" }));
    set_blocks(&mut t, "alice", vec![edit(1, 1, 1, 1)], 1040);
    assert_eq!(
        view(&mut t, "worldStats", json!({})),
        json!({ "overrides": "1", "players": "1" })
    );
    // Bob's clock is 40 s behind (within the skew window): room time is
    // Alice's newest stamp (1040, from setBlocks), so Bob, stamped on it, is
    // online, and Alice (left) is not.
    let bob = join(&mut t, "bob", "Bob", 1000);
    assert_eq!(bob["online"], true);
    let rows = players(&mut t, 1000);
    assert_eq!(player(&rows, "bob")["online"], true);
    // 11 s past the room clock on Bob's side, Bob ages out too.
    let rows = players(&mut t, 1051);
    assert_eq!(player(&rows, "bob")["online"], false);
    assert_eq!(player(&rows, "alice")["online"], false);
}

#[test]
fn set_blocks_emits_blocks_changed_with_the_editor() {
    let mut t = world();
    set_blocks(&mut t, "alice", vec![edit(1, 1, 1, 3)], 1000);
    call(
        &mut t,
        "alice",
        "setBlocks",
        json!({ "edits": [edit(1, 1, 2, 3)], "now": "1001", "device": "phone" }),
    );
    let events = t.events_for("bob");
    assert_eq!(
        events[1..],
        [
            ("BlocksChanged".to_owned(), json!({ "id": "alice" })),
            ("BlocksChanged".to_owned(), json!({ "id": "alice/phone" })),
        ]
    );
}

// ── players (v1's TestHost tests) ────────────────────────────────────────────

#[test]
fn join_and_heartbeat_make_player_visible_online() {
    let mut t = world();
    let me = join(&mut t, "alice", "Alice", 1000);
    assert_eq!(me["id"], "alice");
    assert_eq!(me["account"], "alice");
    assert_eq!(me["device"], "");
    assert_eq!(me["online"], true);
    heartbeat(&mut t, "alice", tf("Alice", 12.5), 1003);
    let rows = players(&mut t, 1005);
    assert_eq!(rows.len(), 1);
    assert_eq!(rows[0]["id"], "alice");
    assert_eq!(rows[0]["online"], true);
    assert_eq!(rows[0]["x"], 12.5);
    assert_eq!(heard(&t, "bob"), ["Initialized", "PlayerJoined"]);
    assert_eq!(t.events_for("bob")[1].1, json!({ "id": "alice" }));
}

#[test]
fn silent_player_goes_offline_after_ttl() {
    let mut t = world();
    join(&mut t, "alice", "Alice", 1000);
    join(&mut t, "bob", "Bob", 1000);
    heartbeat(&mut t, "bob", tf("Bob", 0.0), 1020);
    let rows = players(&mut t, 1020);
    assert_eq!(
        player(&rows, "alice")["online"],
        false,
        "silent for 20s > TTL"
    );
    assert_eq!(player(&rows, "bob")["online"], true);
}

#[test]
fn leave_marks_player_left_immediately() {
    let mut t = world();
    join(&mut t, "alice", "Alice", 1000);
    call(&mut t, "alice", "leave", json!({ "now": "1002" }));
    assert_eq!(players(&mut t, 1003)[0]["online"], false);
    assert_eq!(
        heard(&t, "bob"),
        ["Initialized", "PlayerJoined", "PlayerLeft"]
    );
}

#[test]
fn a_vanished_player_ages_out_and_self_heals() {
    let mut t = world();
    join(&mut t, "alice", "Alice", 1000);
    join(&mut t, "bob", "Bob", 1000);
    // Alice goes silent without `leave`; Bob keeps heartbeating. Nobody
    // writes Alice's row: she is offline because her stamp aged out.
    heartbeat(&mut t, "bob", tf("Bob", 0.0), 1075);
    assert_eq!(player(&players(&mut t, 1075), "alice")["online"], false);

    heartbeat(&mut t, "alice", tf("Alice", 5.0), 1080);
    assert_eq!(
        player(&players(&mut t, 1081), "alice")["online"],
        true,
        "a silent player is back on the next heartbeat"
    );
}

#[test]
fn skewed_fast_clock_cannot_knock_peers_offline() {
    let mut t = world();
    join(&mut t, "alice", "Alice", 1000);
    join(&mut t, "bob", "Bob", 1000);
    // Bob's clock runs 10 minutes ahead: room time jumps forward.
    heartbeat(&mut t, "bob", tf("Bob", 0.0), 1600);
    // Alice heartbeats on her own slow clock: room-time stamping keeps her live.
    heartbeat(&mut t, "alice", tf("Alice", 0.0), 1002);
    assert_eq!(
        player(&players(&mut t, 1603), "alice")["online"],
        true,
        "slow-clock player stays alive under skew"
    );
}

#[test]
fn backward_clock_never_freezes_liveness() {
    let mut t = world();
    join(&mut t, "alice", "Alice", 5000);
    // clock jumps BACK; the stamp must still move the row forward
    heartbeat(&mut t, "alice", tf("Alice", 0.0), 1000);
    assert_eq!(players(&mut t, 5002)[0]["online"], true);
}

#[test]
fn rejoin_preserves_position_and_updates_the_name() {
    let mut t = world();
    join(&mut t, "alice", "Alice", 1000);
    heartbeat(&mut t, "alice", tf("Alice", 42.0), 1005);
    // rejoin (e.g. page refresh) must not teleport the player to origin
    let me = join(&mut t, "alice", "Alice2", 1010);
    assert_eq!(me["x"], 42.0);
    let rows = players(&mut t, 1011);
    assert_eq!(rows[0]["x"], 42.0, "position survives rejoin");
    assert_eq!(rows[0]["name"], "Alice2", "name updates on rejoin");
}

#[test]
fn heartbeat_without_join_creates_a_live_row_and_announces_it() {
    let mut t = world();
    heartbeat(&mut t, "alice", tf("Ghost", 1.0), 1000);
    let rows = players(&mut t, 1001);
    assert_eq!(rows.len(), 1);
    assert_eq!(rows[0]["online"], true);
    assert_eq!(rows[0]["name"], "Ghost");
    // The next heartbeat is routine: no second event.
    heartbeat(&mut t, "alice", tf("Ghost", 2.0), 1002);
    assert_eq!(heard(&t, "bob"), ["Initialized", "PlayerJoined"]);
}

#[test]
fn leave_when_never_joined_is_a_no_op() {
    let mut t = world();
    assert_eq!(
        call(&mut t, "alice", "leave", json!({ "now": "1000" })),
        json!(null)
    );
    assert!(players(&mut t, 1001).is_empty());
    assert_eq!(heard(&t, "bob"), ["Initialized"]);
}

#[test]
fn transform_fields_survive_the_roundtrip() {
    let mut t = world();
    let tr = json!({ "name": "Alice", "x": 1.25, "y": 33.5, "z": 100.75, "yaw": -1.57, "pitch": 0.5, "sel": 7 });
    heartbeat(&mut t, "alice", tr, 1000);
    let p = &players(&mut t, 1001)[0];
    assert_eq!(
        (&p["x"], &p["y"], &p["z"]),
        (&json!(1.25), &json!(33.5), &json!(100.75))
    );
    assert_eq!(p["yaw"], -1.57);
    assert_eq!(p["pitch"], 0.5);
    assert_eq!(p["sel"], 7);
}

#[test]
fn set_blocks_keeps_the_editor_online() {
    let mut t = world();
    join(&mut t, "alice", "Alice", 1000);
    join(&mut t, "bob", "Bob", 1000);
    // Alice only builds, never heartbeats; room time moves with Bob.
    heartbeat(&mut t, "bob", tf("Bob", 0.0), 1015);
    set_blocks(&mut t, "alice", vec![edit(3, 3, 3, 3)], 1015);
    assert_eq!(player(&players(&mut t, 1016), "alice")["online"], true);
}

// ── devices: v1's account/device split, now an explicit label ───────────────

/// Pins v1's rc.23 decision: a player row is per INSTALLATION, so one person
/// on two devices is two avatars in two places. The component runtime knows
/// accounts only, so the client names its device; without a label both
/// heartbeats would collapse onto one row.
#[test]
fn one_account_on_two_devices_is_two_players() {
    let mut t = world();
    for (device, x) in [("laptop", 10.0), ("phone", 90.0)] {
        call(
            &mut t,
            "alice",
            "heartbeat",
            json!({ "t": tf(device, x), "now": "1000", "device": device }),
        );
    }
    let rows = players(&mut t, 1001);
    assert_eq!(rows.len(), 2, "one account, two devices, two avatars");
    assert_eq!(player(&rows, "alice/laptop")["x"], 10.0);
    assert_eq!(player(&rows, "alice/phone")["x"], 90.0);
    assert!(rows.iter().all(|p| p["account"] == "alice"));

    // Leaving on the phone leaves the laptop's avatar online.
    call(
        &mut t,
        "alice",
        "leave",
        json!({ "now": "1002", "device": "phone" }),
    );
    let rows = players(&mut t, 1003);
    assert_eq!(player(&rows, "alice/laptop")["online"], true);
    assert_eq!(player(&rows, "alice/phone")["online"], false);
}

#[test]
fn device_labels_are_checked_and_capped() {
    let mut t = world();
    for bad in ["a/b", "has space", &"x".repeat(65)] {
        assert_eq!(
            t.as_("alice")
                .call("join", json!({ "name": "A", "now": "1", "device": bad })),
            Err(app_error("BadDevice", json!({ "device": bad }))),
            "{bad}"
        );
    }
    // "" is the same as leaving the label out.
    let me = call(
        &mut t,
        "alice",
        "join",
        json!({ "name": "A", "now": "1", "device": "" }),
    );
    assert_eq!(me["id"], "alice");
    for i in 1..8 {
        call(
            &mut t,
            "alice",
            "join",
            json!({ "name": "A", "now": "1", "device": format!("d{i}") }),
        );
    }
    assert_eq!(
        t.as_("alice")
            .call("join", json!({ "name": "A", "now": "1", "device": "d8" })),
        Err(app_error("TooManyDevices", json!({ "max": 8 })))
    );
    // An existing avatar still rejoins; another account is not affected.
    call(
        &mut t,
        "alice",
        "join",
        json!({ "name": "A", "now": "2", "device": "d1" }),
    );
    join(&mut t, "bob", "Bob", 2);
    assert_eq!(players(&mut t, 3).len(), 9);
}

// ── v1's storage write rules, as method checks ───────────────────────────────

/// v1: Alice's avatar sat in Alice's `UserStorage` slot and storage refused
/// Bob's write to it (a "forged write" from a patched node). Now no method
/// takes an account: whatever Bob sends, he writes his own row, and naming
/// Alice is refused as an unknown argument.
#[test]
fn another_account_cannot_move_or_evict_my_avatar() {
    let mut t = world();
    heartbeat(&mut t, "alice", tf("Alice", 10.0), 1000);

    // Bob tries to name Alice's row, with every argument shape at hand.
    for args in [
        json!({ "t": tf("Alice", 999.0), "now": "1001", "account": "alice" }),
        json!({ "t": tf("Alice", 999.0), "now": "1001", "id": "alice" }),
    ] {
        assert!(
            matches!(t.as_("bob").call("heartbeat", args), Err(Failure::App { ref code, .. }) if code == "BadArgs")
        );
    }
    assert!(matches!(
        t.as_("bob").call("leave", json!({ "now": "1001", "account": "alice" })),
        Err(Failure::App { ref code, .. }) if code == "BadArgs"
    ));
    // A device label is Bob's own namespace: "alice" as a device is "bob/alice".
    call(
        &mut t,
        "bob",
        "heartbeat",
        json!({ "t": tf("Alice", 999.0), "now": "1001", "device": "alice" }),
    );
    call(&mut t, "bob", "leave", json!({ "now": "1001" }));

    heartbeat(&mut t, "alice", tf("Alice", 11.0), 1002);
    let rows = players(&mut t, 1003);
    let alice = player(&rows, "alice");
    assert_eq!(alice["x"], 11.0);
    assert_eq!(alice["online"], true);
    assert_eq!(player(&rows, "bob/alice")["account"], "bob");
}

/// A row stamped far in the future (v1: a patched node writing `u64::MAX` into
/// its own row; now: an account sending that as its own `now`) must not drag
/// room time with it: honest players stay online.
#[test]
fn a_far_future_stamp_does_not_hijack_room_time() {
    let mut t = world();
    heartbeat(&mut t, "bob", tf("Mallory", 0.0), u64::MAX);
    heartbeat(&mut t, "alice", tf("Alice", 1.0), 1000);
    let rows = players(&mut t, 1003);
    assert_eq!(
        player(&rows, "alice")["online"],
        true,
        "room time stayed on the real clock"
    );
    // Alice's stamp was not dragged up: 11 s of silence takes her offline.
    assert_eq!(player(&players(&mut t, 1011), "alice")["online"], false);
}

// ── access and wire (what v1 could not check) ────────────────────────────────

/// The org decides who reaches the world: owner, members and a guest (as any
/// member of a v1 context could play). Nobody else.
#[test]
fn who_reaches_the_world() {
    let mut t = world();
    assert_eq!(
        set_blocks(&mut t, "gus", vec![edit(5, 5, 5, 5)], 1000),
        json!(1)
    );
    assert_eq!(join(&mut t, "gus", "Gus", 1000)["id"], "gus");

    let unauthenticated = Err(Failure::Refused {
        status: 401,
        code: "UNAUTHENTICATED".to_owned(),
    });
    assert_eq!(t.anonymous().view("worldMeta", json!({})), unauthenticated);
    assert_eq!(
        t.anonymous()
            .call("setBlocks", json!({ "edits": [], "now": "1" })),
        unauthenticated
    );
    let not_found = Err(Failure::Refused {
        status: 404,
        code: "NOT_FOUND".to_owned(),
    });
    assert_eq!(t.as_("mallory").view("getOverrides", json!({})), not_found);
    assert_eq!(
        t.as_("mallory").call(
            "setBlocks",
            json!({ "edits": [edit(6, 6, 6, 6)], "now": "1" })
        ),
        not_found
    );
    assert_eq!(overrides(&mut t).len(), 1);
    // System never reaches a method.
    assert!(matches!(
        t.system().call("join", json!({ "name": "sys", "now": "1" })),
        Err(Failure::App { ref code, .. }) if code == "Forbidden"
    ));
}

#[test]
fn my_account_is_the_callers() {
    let mut t = world();
    assert_eq!(t.as_("bob").view("myAccount", json!({})), Ok(json!("bob")));
}

/// Arguments are a JSON object of exactly the method's parameters; `u64`s are
/// decimal strings.
#[test]
fn malformed_arguments_are_refused_before_anything_is_written() {
    let mut t = world();
    for args in [
        json!({ "edits": [edit(1, 1, 1, 1)] }),
        json!({ "edits": [edit(1, 1, 1, 1)], "now": 1000 }),
        json!({ "edits": [edit(1, 1, 1, 1)], "now": "1000", "extra": 1 }),
        json!({ "edits": [{ "x": 1, "y": 1, "z": 1, "b": 1, "by": "x" }], "now": "1000" }),
        json!({ "edits": [{ "x": 1, "y": 1, "z": 1, "b": 256 }], "now": "1000" }),
        json!({ "edits": [{ "x": 1, "y": 1, "z": 1 }], "now": "1000" }),
    ] {
        assert!(
            matches!(
                t.as_("owner").call("setBlocks", args.clone()),
                Err(Failure::App { ref code, .. }) if code == "BadArgs"
            ),
            "{args}"
        );
    }
    assert!(matches!(
        t.as_("owner").view("getPlayers", json!({ "now": 1000 })),
        Err(Failure::App { ref code, .. }) if code == "BadArgs"
    ));
    assert!(overrides(&mut t).is_empty());
    assert_eq!(heard(&t, "bob"), ["Initialized"]);
}

/// v1's snake_case names are not methods any more: the ABI's are camelCase.
#[test]
fn methods_are_reached_by_their_camel_case_names() {
    let mut t = world();
    for method in ["set_blocks", "get_overrides", "world_meta", "get_players"] {
        assert!(
            matches!(
                t.as_("owner").call(method, json!({})),
                Err(Failure::App { ref code, .. }) if code == "UnknownMethod"
            ),
            "{method}"
        );
    }
    // A write is not a view.
    assert!(matches!(
        t.as_("owner").view("join", json!({ "name": "x", "now": "1" })),
        Err(Failure::App { ref code, .. }) if code == "NotAView"
    ));
}
