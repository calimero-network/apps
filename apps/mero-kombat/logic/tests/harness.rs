//! The arena on core's real wasmtime engine (`TestApp`): v1's `TestHost` tests
//! method for method, what v1's two-node convergence becomes under one log,
//! the permission checks that replace v1's owner stamps, and the access and
//! wire checks v1 could not express.

#![cfg(not(target_arch = "wasm32"))]

mod common;

use calimero_app_sdk::testing::{Failure, Org, TestApp};
use serde_json::{json, Value};

/// A wall-clock-looking `now` (a decimal string on the wire).
fn at(ms: u64) -> String {
    (1_700_000_000_000 + ms).to_string()
}

/// The owner and bob fight; cy is a member who watches; gus is a guest.
fn app() -> TestApp {
    common::app(Org::new().members(["bob", "cy"]).guests(["gus"]))
}

fn call(t: &mut TestApp, who: &str, method: &str, args: Value) -> Value {
    t.as_(who)
        .call(method, args)
        .unwrap_or_else(|e| panic!("{who} {method}: {e:?}"))
}

fn arena(t: &mut TestApp, who: &str) -> Value {
    t.as_(who)
        .view("arena", json!({ "now": at(0) }))
        .unwrap_or_else(|e| panic!("{who} arena: {e:?}"))
}

fn refused(code: &str) -> Failure {
    Failure::App {
        code: code.to_owned(),
        fields: json!({}),
    }
}

fn code_of(r: Result<Value, Failure>) -> String {
    match r {
        Err(Failure::App { code, .. }) => code,
        other => panic!("expected an app error, got {other:?}"),
    }
}

fn names(t: &TestApp, who: &str) -> Vec<String> {
    t.events_for(who).into_iter().map(|(n, _)| n).collect()
}

/// owner in p1 (kinetic), bob in p2 (inferno).
fn seated() -> TestApp {
    let mut t = app();
    call(
        &mut t,
        "owner",
        "sit",
        json!({ "seat": "p1", "name": "One", "fighter": "kinetic", "now": at(1) }),
    );
    call(
        &mut t,
        "bob",
        "sit",
        json!({ "seat": "p2", "name": "Two", "fighter": "inferno", "now": at(2) }),
    );
    t
}

#[allow(clippy::too_many_arguments)]
fn act(t: &mut TestApp, who: &str, m: u32, r: u32, id: u32, kind: &str, hit: bool, blocked: bool) {
    call(
        t,
        who,
        "act",
        json!({ "matchIndex": m, "round": r, "id": id, "kind": kind, "hit": hit, "blocked": blocked, "now": at(10 + u64::from(id)) }),
    );
}

/// `who` lands eight uppercuts (104 damage) in round `r` of match `m`.
fn knock_out(t: &mut TestApp, who: &str, m: u32, r: u32, first_id: u32) {
    for i in 0..8 {
        act(t, who, m, r, first_id + i, "uppercut", true, false);
    }
}

// ── init and the empty arena ─────────────────────────────────────────────────

#[test]
fn a_new_arena_waits_for_two_fighters() {
    let mut t = app();
    let v = arena(&mut t, "owner");
    assert_eq!(v["title"], "Arena");
    // Created without `now` (the harness passes no init args): "0".
    assert_eq!(v["createdAt"], "0");
    assert_eq!(v["status"], "waiting");
    assert_eq!(v["matchIndex"], 0);
    assert_eq!(v["round"], 0);
    assert_eq!(v["roundResults"], json!([]));
    assert_eq!(v["winner"], "");
    assert_eq!(v["me"], "owner");
    assert_eq!(v["mySeat"], "");
    assert_eq!(v["totalActions"], "0");
    assert_eq!(v["matchActions"], 0);
    assert_eq!(v["maxHp"], 100);
    assert_eq!(v["roundsToWin"], 2);
    assert_eq!(
        v["p1"],
        json!({ "seat": "p1", "member": "", "name": "", "fighter": "kinetic", "hp": 100, "roundsWon": 0, "matchesWon": 0, "online": false })
    );
    assert_eq!(v["p2"]["fighter"], "cryo");
    assert_eq!(names(&t, "bob"), ["Initialized"]);

    let history = t.as_("bob").view("history", json!({})).expect("history");
    assert_eq!(
        history,
        json!([{ "index": 0, "startedAt": "0", "winner": "", "flawless": false, "rounds": [], "actions": 0 }])
    );
}

// ── join and pick ────────────────────────────────────────────────────────────

#[test]
fn join_announces_once_and_pick_changes_the_look() {
    let mut t = app();
    call(
        &mut t,
        "owner",
        "join",
        json!({ "name": "  One\u{7}  ", "fighter": " CRYO ", "now": at(1) }),
    );
    call(
        &mut t,
        "owner",
        "join",
        json!({ "name": "One", "fighter": "cryo", "now": at(2) }),
    );
    assert_eq!(names(&t, "bob"), ["Initialized", "PlayerJoined"]);
    assert_eq!(
        t.events_for("bob")[1].1,
        json!({ "member": "owner" }),
        "the joiner's account"
    );

    // Not in a corner: pick changes the stored fighter but announces nothing.
    call(
        &mut t,
        "owner",
        "pick",
        json!({ "fighter": "jinzo", "now": at(3) }),
    );
    assert_eq!(names(&t, "bob").len(), 2);
    call(
        &mut t,
        "owner",
        "sit",
        json!({ "seat": "p1", "name": "", "fighter": "jinzo", "now": at(4) }),
    );
    call(
        &mut t,
        "owner",
        "pick",
        json!({ "fighter": "inferno", "now": at(5) }),
    );
    assert_eq!(
        names(&t, "bob"),
        ["Initialized", "PlayerJoined", "Seated", "Seated"]
    );
    let v = arena(&mut t, "bob");
    assert_eq!(v["p1"]["fighter"], "inferno");
    // A blank name falls back to "Fighter", as in v1.
    assert_eq!(v["p1"]["name"], "Fighter");

    for (method, args) in [
        (
            "join",
            json!({ "name": "x", "fighter": "goku", "now": at(6) }),
        ),
        ("pick", json!({ "fighter": "", "now": at(6) })),
    ] {
        assert_eq!(
            t.as_("owner").call(method, args),
            Err(Failure::App {
                code: "UnknownFighter".to_owned(),
                fields: json!({ "fighter": if method == "join" { "goku" } else { "" } })
            })
        );
    }
}

// ── sit and stand ────────────────────────────────────────────────────────────

#[test]
fn corners_are_first_come_and_one_per_person() {
    let mut t = seated();
    let v = arena(&mut t, "owner");
    assert_eq!(v["status"], "fighting");
    assert_eq!(v["mySeat"], "p1");
    assert_eq!(v["p1"]["member"], "owner");
    assert_eq!(v["p1"]["name"], "One");
    assert_eq!(v["p2"]["member"], "bob");
    assert_eq!(v["p2"]["fighter"], "inferno");
    assert_eq!(arena(&mut t, "bob")["mySeat"], "p2");
    assert_eq!(arena(&mut t, "cy")["mySeat"], "", "a spectator");

    // Someone else's corner, from a spectator or from the other fighter.
    for who in ["cy", "bob"] {
        assert_eq!(
            t.as_(who).call(
                "sit",
                json!({ "seat": "p1", "name": "Usurper", "fighter": "cryo", "now": at(3) })
            ),
            Err(refused("CornerTaken"))
        );
    }
    // Sitting again in your own corner refreshes name and fighter, no event.
    let before = names(&t, "cy").len();
    call(
        &mut t,
        "bob",
        "sit",
        json!({ "seat": " P2 ", "name": "Two!", "fighter": "jinzo", "now": at(4) }),
    );
    assert_eq!(names(&t, "cy").len(), before);
    assert_eq!(arena(&mut t, "cy")["p2"]["fighter"], "jinzo");

    assert_eq!(
        t.as_("cy").call(
            "sit",
            json!({ "seat": "p3", "name": "", "fighter": "cryo", "now": at(5) })
        ),
        Err(Failure::App {
            code: "UnknownSeat".to_owned(),
            fields: json!({ "seat": "p3" })
        })
    );
}

#[test]
fn one_person_cannot_hold_both_corners() {
    let mut t = app();
    call(
        &mut t,
        "owner",
        "sit",
        json!({ "seat": "p1", "name": "One", "fighter": "cryo", "now": at(1) }),
    );
    assert_eq!(
        t.as_("owner").call(
            "sit",
            json!({ "seat": "p2", "name": "One", "fighter": "cryo", "now": at(2) })
        ),
        Err(refused("InOtherCorner"))
    );
    assert_eq!(arena(&mut t, "owner")["p2"]["member"], "");
}

#[test]
fn stand_frees_a_corner_only_before_fighting() {
    let mut t = seated();
    assert_eq!(
        t.as_("cy").call("stand", json!({ "now": at(3) })),
        Err(refused("NotInCorner"))
    );
    call(&mut t, "bob", "stand", json!({ "now": at(3) }));
    assert_eq!(names(&t, "cy").last().map(String::as_str), Some("Vacated"));
    let v = arena(&mut t, "cy");
    assert_eq!(v["p2"]["member"], "");
    assert_eq!(v["status"], "waiting");

    // cy takes the freed corner and fights; after that neither can leave.
    call(
        &mut t,
        "cy",
        "sit",
        json!({ "seat": "p2", "name": "Three", "fighter": "cryo", "now": at(4) }),
    );
    act(&mut t, "cy", 0, 0, 1, "jump", false, false);
    assert_eq!(
        t.as_("cy").call("stand", json!({ "now": at(5) })),
        Err(refused("AlreadyFought"))
    );
    // The owner has not acted yet and may still leave.
    call(&mut t, "owner", "stand", json!({ "now": at(6) }));
    assert_eq!(arena(&mut t, "cy")["p1"]["member"], "");
}

// ── act: the damage table ────────────────────────────────────────────────────

#[test]
fn every_move_costs_what_the_table_says() {
    let mut t = seated();
    let mut hp = 100;
    for (id, (kind, damage)) in [
        ("punch", 5),
        ("kick", 7),
        ("uppercut", 13),
        ("sweep", 9),
        ("air_kick", 8),
        ("special", 11),
        ("jump", 0),
        ("block", 0),
    ]
    .into_iter()
    .enumerate()
    {
        act(&mut t, "owner", 0, 0, id as u32 + 1, kind, true, false);
        hp -= damage;
        assert_eq!(arena(&mut t, "bob")["p2"]["hp"], hp, "{kind}");
    }
    // 100 - 53 = 47; a blocked blow chips one point.
    act(&mut t, "owner", 0, 0, 20, "uppercut", true, true);
    let v = arena(&mut t, "bob");
    assert_eq!(v["p2"]["hp"], 46);
    assert_eq!(v["p1"]["hp"], 100);
    assert_eq!(v["totalActions"], "9");
    assert_eq!(v["matchActions"], 9);
    // Landed blows only (jump and block cannot connect), newest first.
    let hits = v["hits"].as_array().expect("hits");
    assert_eq!(hits.len(), 7);
    assert_eq!(
        hits[0],
        json!({ "by": "p1", "id": 20, "kind": "uppercut", "damage": 1, "blocked": true, "at": at(30) })
    );
    assert_eq!(hits[6]["kind"], "punch");

    assert_eq!(
        t.as_("owner").call(
            "act",
            json!({ "matchIndex": 0, "round": 0, "id": 99, "kind": "fireball", "hit": true, "blocked": false, "now": at(40) })
        ),
        Err(Failure::App {
            code: "UnknownMove".to_owned(),
            fields: json!({ "kind": "fireball" })
        })
    );
    // A miss is a transaction too, and moves no bar.
    act(&mut t, "bob", 0, 0, 1, "kick", false, false);
    let v = arena(&mut t, "owner");
    assert_eq!(v["p1"]["hp"], 100);
    assert_eq!(v["totalActions"], "10");
    assert_eq!(
        t.events_for("cy").last(),
        Some(&(
            "Acted".to_owned(),
            json!({ "matchIndex": 0, "round": 0, "by": "bob", "hit": false })
        ))
    );
}

#[test]
fn the_view_carries_the_newest_48_hits() {
    let mut t = seated();
    for id in 1..=60 {
        act(&mut t, "owner", 0, 0, id, "jump", false, false);
    }
    // 60 chips of one point each: 40 hp left, round still on.
    for id in 61..=120 {
        act(&mut t, "owner", 0, 0, id, "punch", true, true);
    }
    let v = arena(&mut t, "bob");
    assert_eq!(v["p2"]["hp"], 40);
    let hits = v["hits"].as_array().expect("hits");
    assert_eq!(hits.len(), 48);
    assert_eq!(hits[0]["id"], 120);
    assert_eq!(hits[47]["id"], 73);
}

// ── rounds and matches ───────────────────────────────────────────────────────

#[test]
fn two_knock_outs_take_the_match_and_a_rematch_resets_it() {
    let mut t = seated();
    act(&mut t, "bob", 0, 0, 1, "punch", true, false);
    knock_out(&mut t, "owner", 0, 0, 1);
    let v = arena(&mut t, "cy");
    assert_eq!(v["round"], 1);
    assert_eq!(v["roundResults"], json!(["p1"]));
    assert_eq!(v["status"], "fighting");
    assert_eq!(v["p1"]["roundsWon"], 1);
    assert_eq!(v["p1"]["hp"], 100, "fresh health");
    assert_eq!(v["p2"]["hp"], 100);
    assert_eq!(v["hits"], json!([]));
    let events = names(&t, "cy");
    assert_eq!(&events[events.len() - 2..], ["Acted", "RoundOver"]);
    assert_eq!(
        t.events_for("cy").last().map(|e| e.1.clone()),
        Some(json!({ "matchIndex": 0, "round": 0, "winner": "p1" }))
    );

    // A blow for the decided round is refused, not moved into the next one.
    assert_eq!(
        t.as_("bob").call(
            "act",
            json!({ "matchIndex": 0, "round": 0, "id": 9, "kind": "punch", "hit": true, "blocked": false, "now": at(50) })
        ),
        Err(Failure::App {
            code: "RoundOver".to_owned(),
            fields: json!({ "current": 1 })
        })
    );

    knock_out(&mut t, "owner", 0, 1, 20);
    let v = arena(&mut t, "cy");
    assert_eq!(v["status"], "finished");
    assert_eq!(v["winner"], "p1");
    assert_eq!(v["flawless"], true, "untouched in the deciding round");
    assert_eq!(v["roundResults"], json!(["p1", "p1"]));
    assert_eq!(v["round"], 1, "the deciding round");
    assert_eq!(v["p2"]["hp"], 0);
    assert_eq!(v["p1"]["matchesWon"], 1);
    assert_eq!(v["p2"]["matchesWon"], 0);
    assert_eq!(v["matchActions"], 17);
    let events = names(&t, "cy");
    assert_eq!(
        &events[events.len() - 3..],
        ["Acted", "RoundOver", "MatchOver"]
    );

    // Nothing more lands in a finished match.
    assert_eq!(
        t.as_("bob").call(
            "act",
            json!({ "matchIndex": 0, "round": 1, "id": 9, "kind": "punch", "hit": true, "blocked": false, "now": at(60) })
        ),
        Err(refused("MatchOver"))
    );
    // A spectator cannot call the rematch; a fighter can.
    assert_eq!(
        t.as_("cy").call("rematch", json!({ "now": at(70) })),
        Err(refused("NotInCorner"))
    );
    assert_eq!(
        call(&mut t, "bob", "rematch", json!({ "now": at(70) })),
        json!(1)
    );
    assert_eq!(
        names(&t, "cy").last().map(String::as_str),
        Some("MatchStarted")
    );
    // The match just started is not finished: the other fighter's rematch is refused.
    assert_eq!(
        t.as_("owner").call("rematch", json!({ "now": at(71) })),
        Err(refused("MatchNotFinished"))
    );

    let v = arena(&mut t, "owner");
    assert_eq!(v["matchIndex"], 1);
    assert_eq!(v["status"], "fighting");
    assert_eq!(v["round"], 0);
    assert_eq!(v["winner"], "");
    assert_eq!(v["p1"]["hp"], 100);
    assert_eq!(v["p1"]["matchesWon"], 1, "the score is kept");
    assert_eq!(v["totalActions"], "17");
    assert_eq!(v["matchActions"], 0);
    assert_eq!(
        t.as_("owner").call(
            "act",
            json!({ "matchIndex": 0, "round": 0, "id": 1, "kind": "punch", "hit": true, "blocked": false, "now": at(80) })
        ),
        Err(Failure::App {
            code: "WrongMatch".to_owned(),
            fields: json!({ "current": 1 })
        })
    );

    // bob wins match 1, not flawless.
    act(&mut t, "owner", 1, 0, 1, "punch", true, false);
    knock_out(&mut t, "bob", 1, 0, 1);
    knock_out(&mut t, "bob", 1, 1, 10);
    let v = arena(&mut t, "owner");
    assert_eq!(v["winner"], "p2");
    assert_eq!(
        v["flawless"], true,
        "the punch was in round 0, not the deciding one"
    );
    assert_eq!(v["p2"]["matchesWon"], 1);

    let history = t.as_("cy").view("history", json!({})).expect("history");
    assert_eq!(
        history,
        json!([
            { "index": 0, "startedAt": "0", "winner": "p1", "flawless": true, "rounds": ["p1", "p1"], "actions": 17 },
            { "index": 1, "startedAt": at(70), "winner": "p2", "flawless": true, "rounds": ["p2", "p2"], "actions": 17 },
        ])
    );
}

#[test]
fn a_chipped_winner_is_not_flawless() {
    let mut t = seated();
    knock_out(&mut t, "owner", 0, 0, 1);
    act(&mut t, "bob", 0, 1, 1, "punch", true, true);
    knock_out(&mut t, "owner", 0, 1, 20);
    let v = arena(&mut t, "bob");
    assert_eq!(v["winner"], "p1");
    assert_eq!(v["flawless"], false);
    assert_eq!(v["p1"]["hp"], 99);
}

#[test]
fn a_round_holds_at_most_2000_actions_per_fighter() {
    let mut t = seated();
    for id in 0..2000 {
        act(&mut t, "owner", 0, 0, id, "block", false, false);
    }
    assert_eq!(
        t.as_("owner").call(
            "act",
            json!({ "matchIndex": 0, "round": 0, "id": 2000, "kind": "block", "hit": false, "blocked": false, "now": at(1) })
        ),
        Err(refused("ActionLimit"))
    );
    // The other fighter's allowance is their own.
    act(&mut t, "bob", 0, 0, 1, "block", false, false);
    assert_eq!(arena(&mut t, "bob")["totalActions"], "2001");
}

#[test]
fn online_is_a_write_within_thirty_seconds_of_the_readers_clock() {
    let mut t = seated();
    let view_at = |t: &mut TestApp, ms: u64| {
        t.as_("cy")
            .view("arena", json!({ "now": at(ms) }))
            .expect("arena")
    };
    let v = view_at(&mut t, 30_002);
    assert_eq!(v["p1"]["online"], false, "last seen at +1");
    assert_eq!(v["p2"]["online"], true, "last seen at +2");
    call(
        &mut t,
        "owner",
        "pick",
        json!({ "fighter": "cryo", "now": at(30_000) }),
    );
    assert_eq!(view_at(&mut t, 30_002)["p1"]["online"], true);
}

// ── v1's convergence test, under one log ─────────────────────────────────────

/// v1: both fighters landing the finishing blow at once on two nodes made a
/// double knock-out that scored for nobody. One log orders them: the first
/// decides the round, the second is refused for a round that is over.
#[test]
fn two_finishing_blows_are_ordered_not_merged() {
    let mut t = seated();
    for i in 0..7 {
        act(&mut t, "owner", 0, 0, i, "uppercut", true, false);
        act(&mut t, "bob", 0, 0, i, "uppercut", true, false);
    }
    let v = arena(&mut t, "cy");
    assert_eq!(
        (v["p1"]["hp"].clone(), v["p2"]["hp"].clone()),
        (json!(9), json!(9))
    );
    act(&mut t, "bob", 0, 0, 8, "uppercut", true, false);
    assert_eq!(
        code_of(t.as_("owner").call(
            "act",
            json!({ "matchIndex": 0, "round": 0, "id": 8, "kind": "uppercut", "hit": true, "blocked": false, "now": at(99) })
        )),
        "RoundOver"
    );
    assert_eq!(arena(&mut t, "cy")["roundResults"], json!(["p2"]));
}

// ── the permission checks that replace v1's owner stamps ─────────────────────

/// v1 bound every row to its author with core's owner stamp, so a node could
/// not write blows, claims or vacates for another. Here every write is the
/// caller's own: a spectator cannot act, stand or rematch for a fighter, and
/// nothing they try moves the fight.
#[test]
fn nobody_can_fight_for_someone_else() {
    let mut t = seated();
    act(&mut t, "owner", 0, 0, 1, "kick", true, false);
    let before = arena(&mut t, "owner");

    for (method, args) in [
        (
            "act",
            json!({ "matchIndex": 0, "round": 0, "id": 2, "kind": "uppercut", "hit": true, "blocked": false, "now": at(5) }),
        ),
        ("stand", json!({ "now": at(5) })),
    ] {
        assert_eq!(
            t.as_("cy").call(method, args.clone()),
            Err(refused("NotInCorner"))
        );
        assert_eq!(t.as_("gus").call(method, args), Err(refused("NotInCorner")));
    }
    // Arguments cannot name another author: there is no such parameter.
    assert!(matches!(
        t.as_("cy").call(
            "act",
            json!({ "matchIndex": 0, "round": 0, "id": 2, "kind": "kick", "hit": true, "blocked": false, "now": at(5), "by": "owner" })
        ),
        Err(Failure::App { ref code, .. }) if code == "BadArgs"
    ));
    let after = arena(&mut t, "owner");
    assert_eq!(before, after, "nothing a spectator tried was written");
}

/// The org decides who reaches the arena: a guest may take a free corner and
/// fight (as any v1 context member could); an outsider and an anonymous caller
/// are refused by the node before the app runs.
#[test]
fn who_reaches_the_arena() {
    let mut t = app();
    call(
        &mut t,
        "gus",
        "sit",
        json!({ "seat": "p2", "name": "Guest", "fighter": "cryo", "now": at(1) }),
    );
    assert_eq!(arena(&mut t, "gus")["mySeat"], "p2");

    assert_eq!(
        t.anonymous().view("arena", json!({ "now": at(2) })),
        Err(Failure::Refused {
            status: 401,
            code: "UNAUTHENTICATED".to_owned()
        })
    );
    assert_eq!(
        t.as_("mallory").call(
            "sit",
            json!({ "seat": "p1", "name": "M", "fighter": "cryo", "now": at(2) })
        ),
        Err(Failure::Refused {
            status: 404,
            code: "NOT_FOUND".to_owned()
        })
    );
    assert_eq!(arena(&mut t, "owner")["p1"]["member"], "");
}

// ── the wire ─────────────────────────────────────────────────────────────────

/// Arguments are a JSON object of exactly the method's parameters, `u64`s as
/// decimal strings, names in camelCase.
#[test]
fn malformed_arguments_are_refused_before_anything_is_written() {
    let mut t = seated();
    for args in [
        // v1's snake_case name.
        json!({ "match_index": 0, "round": 0, "id": 1, "kind": "kick", "hit": true, "blocked": false, "now": at(3) }),
        // `now` as a number.
        json!({ "matchIndex": 0, "round": 0, "id": 1, "kind": "kick", "hit": true, "blocked": false, "now": 1_700_000_000_003_u64 }),
        // missing `now`.
        json!({ "matchIndex": 0, "round": 0, "id": 1, "kind": "kick", "hit": true, "blocked": false }),
    ] {
        assert_eq!(
            code_of(t.as_("owner").call("act", args.clone())),
            "BadArgs",
            "{args}"
        );
    }
    assert_eq!(arena(&mut t, "owner")["totalActions"], "0");
}

#[test]
fn reads_are_views_and_writes_are_not() {
    let mut t = seated();
    assert_eq!(
        code_of(t.as_("owner").view("rematch", json!({ "now": at(1) }))),
        "NotAView"
    );
    assert_eq!(
        code_of(t.as_("owner").call("fight", json!({}))),
        "UnknownMethod"
    );
    // A view may run as a call (and writes nothing).
    let v = t
        .as_("owner")
        .call("arena", json!({ "now": at(1) }))
        .expect("a view as a call");
    assert_eq!(v["mySeat"], "p1");
}
