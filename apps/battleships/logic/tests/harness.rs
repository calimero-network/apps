//! Whole matches on core's real wasmtime engine (`TestApp`): v1's `TestHost`
//! tests of both services (`src/lib.rs` and `crates/game/src/lib.rs`) method
//! for method, with the browser's half (placing a fleet, committing to it,
//! answering shots from it) played by `battleships-rules`. Then what v1 kept
//! in storage write rules (forged and rewritten rows), as method checks: the
//! same move made by someone the method refuses. Then the access and wire
//! checks v1 could not express.

#![cfg(not(target_arch = "wasm32"))]

mod common;

use battleships_rules::board::Cell;
use battleships_rules::players::PlayerBoard;
use calimero_sdk::testing::{Failure, Org, TestApp};
use serde_json::{json, Value};

const ALICE: &str = "owner";
const BOB: &str = "bob";
const CAROL: &str = "carol";
const GUEST: &str = "gus";

const ALICE_FLEET: [&str; 5] = [
    "0,0;1,0",
    "0,2;1,2;2,2",
    "0,4;1,4;2,4",
    "0,6;1,6;2,6;3,6",
    "0,8;1,8;2,8;3,8;4,8",
];
const BOB_FLEET: [&str; 5] = [
    "8,0;9,0",
    "7,2;8,2;9,2",
    "7,4;8,4;9,4",
    "6,6;7,6;8,6;9,6",
    "5,8;6,8;7,8;8,8;9,8",
];
const ALICE_SALT: [u8; 16] = [0xA5; 16];
const BOB_SALT: [u8; 16] = [0xB5; 16];

fn org() -> Org {
    Org::new().members([BOB, CAROL]).guests([GUEST])
}

fn cells(fleet: &[&str]) -> Vec<(u8, u8)> {
    fleet
        .iter()
        .flat_map(|ship| ship.split(';'))
        .map(|c| {
            let (x, y) = c.split_once(',').expect("x,y");
            (x.parse().expect("x"), y.parse().expect("y"))
        })
        .collect()
}

/// Water on Bob's side of the board, for shots that miss.
fn bob_water() -> Vec<(u8, u8)> {
    (0..10u8)
        .flat_map(|y| (0..4u8).map(move |x| (x, y)))
        .collect()
}

/// What the client keeps on the device: the 100 pristine cells of a fleet.
fn board(fleet: &[&str]) -> Vec<u8> {
    let mut pb = PlayerBoard::new();
    pb.place_ships(fleet.iter().map(|s| (*s).to_owned()).collect())
        .expect("a legal fleet");
    pb.get_board().0.clone()
}

fn b64(bytes: &[u8]) -> String {
    const A: &[u8; 64] = b"ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789-_";
    let mut out = String::new();
    for chunk in bytes.chunks(3) {
        let n = chunk
            .iter()
            .enumerate()
            .fold(0u32, |n, (i, &b)| n | (u32::from(b) << (16 - 8 * i)));
        for i in 0..=chunk.len() {
            out.push(char::from(A[((n >> (18 - 6 * i)) & 63) as usize]));
        }
    }
    out
}

/// What the client files: hex of `SHA256(borsh(board) || salt)`.
fn commitment(cells: &[u8], salt: &[u8; 16]) -> String {
    battleships_rules::commitment(&battleships_rules::board_bytes(cells), salt)
        .iter()
        .map(|b| format!("{b:02x}"))
        .collect()
}

fn code(r: Result<Value, Failure>) -> String {
    match r {
        Err(Failure::App { code, .. }) => code,
        other => panic!("expected an app error, got {other:?}"),
    }
}

struct Game {
    t: TestApp,
    id: String,
}

impl Game {
    fn call(&mut self, who: &str, method: &str, mut args: Value) -> Result<Value, Failure> {
        args["matchId"] = json!(self.id);
        self.t.as_(who).call(method, args)
    }

    fn view(&mut self, who: &str, method: &str) -> Value {
        let id = self.id.clone();
        self.t
            .as_(who)
            .view(method, json!({ "matchId": id }))
            .unwrap_or_else(|e| panic!("{method}: {e:?}"))
    }

    fn state(&mut self) -> Value {
        self.view(ALICE, "getMatchState")
    }

    fn standing(&mut self) -> String {
        self.state()["standing"]
            .as_str()
            .expect("standing")
            .to_owned()
    }

    fn commit(&mut self, who: &str, fleet: &[&str], salt: &[u8; 16]) -> Result<Value, Failure> {
        let c = commitment(&board(fleet), salt);
        self.call(who, "commitBoard", json!({ "commitment": c }))
    }

    fn shoot(&mut self, who: &str, x: u8, y: u8) {
        self.call(who, "proposeShot", json!({ "x": x, "y": y }))
            .unwrap_or_else(|e| panic!("shot ({x},{y}): {e:?}"));
    }

    fn pending(&mut self) -> Value {
        let s = self.state();
        assert!(!s["pending_shot"].is_null(), "a pending shot");
        s["pending_shot"].clone()
    }

    fn ack(&mut self, who: &str, shot_id: &Value, hit: bool) -> Result<Value, Failure> {
        self.call(
            who,
            "acknowledgeShot",
            json!({ "shotId": shot_id, "hit": hit }),
        )
    }

    /// Answer the pending shot the way an honest client does.
    fn answer(&mut self, who: &str, fleet: &[&str]) -> String {
        let shot = self.pending();
        let at = (
            shot["x"].as_u64().expect("x") as u8,
            shot["y"].as_u64().expect("y") as u8,
        );
        let hit = cells(fleet).contains(&at);
        self.ack(who, &shot["shot_id"], hit)
            .expect("answer")
            .as_str()
            .expect("hit/miss")
            .to_owned()
    }

    fn reveal(&mut self, who: &str, fleet: &[&str], salt: &[u8; 16]) -> Result<Value, Failure> {
        let bytes = battleships_rules::board_bytes(&board(fleet));
        self.call(
            who,
            "revealBoard",
            json!({ "boardBytes": b64(&bytes), "salt": b64(salt) }),
        )
    }

    /// Alice sinks Bob's fleet, both answering honestly, up to the answer
    /// that ends it on the answers alone.
    fn play_to_the_end(&mut self) {
        let targets = cells(&BOB_FLEET);
        let water = cells(&[
            "5,1;6,1;7,1;8,1;9,1",
            "5,3;6,3;7,3;8,3;9,3",
            "5,5;6,5;7,5;8,5;9,5",
            "5,7",
        ]);
        for (i, &(x, y)) in targets.iter().enumerate() {
            self.shoot(ALICE, x, y);
            assert_eq!(self.answer(BOB, &BOB_FLEET), "hit");
            if i + 1 == targets.len() {
                break;
            }
            let (wx, wy) = water[i];
            self.shoot(BOB, wx, wy);
            assert_eq!(self.answer(ALICE, &ALICE_FLEET), "miss");
        }
    }
}

/// A lobby where Alice and Bob have opened it, and Alice has challenged Bob.
fn game() -> Game {
    let mut t = common::app(org());
    for who in [ALICE, BOB] {
        assert_eq!(
            t.as_(who).call("registerPlayer", json!({})).unwrap(),
            json!(who)
        );
    }
    let id = t
        .as_(ALICE)
        .call("createMatch", json!({ "player2": BOB }))
        .unwrap()
        .as_str()
        .expect("id")
        .to_owned();
    Game { t, id }
}

fn placed() -> Game {
    let mut g = game();
    g.commit(ALICE, &ALICE_FLEET, &ALICE_SALT)
        .expect("alice commits");
    g.commit(BOB, &BOB_FLEET, &BOB_SALT).expect("bob commits");
    g
}

fn summary(g: &mut Game) -> Value {
    let id = g.id.clone();
    let all = g.t.as_(CAROL).view("getMatches", json!({})).unwrap();
    all.as_array()
        .expect("matches")
        .iter()
        .find(|m| m["match_id"] == json!(id))
        .expect("match")
        .clone()
}

// ── lobby (v1's lobby service) ───────────────────────────────────────────────

#[test]
fn create_match_records_both_players() {
    let mut g = game();
    assert!(g.id.starts_with(&format!("{ALICE}-{}-", common::T0)));
    let m = summary(&mut g);
    assert_eq!(m["player1"], json!(ALICE));
    assert_eq!(m["player2"], json!(BOB));
    assert_eq!(m["player2_account"], json!(BOB));
    assert_eq!(m["status"], json!("Pending"));
    assert_eq!(m["winner"], Value::Null);
    assert_eq!(m["created_ms"], json!(common::T0.to_string()));
    let mut g = placed();
    assert_eq!(summary(&mut g)["status"], json!("Active"));
}

#[test]
fn create_match_rejects_self_and_unregistered_opponents() {
    let mut g = game();
    let mut create = |player2: &str| {
        code(
            g.t.as_(ALICE)
                .call("createMatch", json!({ "player2": player2 })),
        )
    };
    assert_eq!(create(ALICE), "Invalid", "self");
    assert_eq!(create(CAROL), "Invalid", "never opened the lobby");
    assert_eq!(create("eve"), "Invalid", "not in the org at all");
}

#[test]
fn players_register_themselves_once() {
    let mut g = game();
    g.t.as_(GUEST).call("registerPlayer", json!({})).unwrap();
    g.t.as_(GUEST).call("registerPlayer", json!({})).unwrap();
    let players = g.t.as_(CAROL).view("getPlayers", json!({})).unwrap();
    assert_eq!(
        players,
        json!([
            { "account": BOB, "player": BOB },
            { "account": GUEST, "player": GUEST },
            { "account": ALICE, "player": ALICE },
        ])
    );
    let updates =
        g.t.events_for(CAROL)
            .into_iter()
            .filter(|(n, _)| n == "PlayersUpdated")
            .count();
    assert_eq!(updates, 3, "a repeat registration emits nothing");
}

#[test]
fn a_finished_match_counts_once_in_history_and_stats() {
    let mut g = placed();
    g.play_to_the_end();
    assert_eq!(summary(&mut g)["status"], json!("Active"));
    g.reveal(ALICE, &ALICE_FLEET, &ALICE_SALT).expect("alice");
    g.reveal(BOB, &BOB_FLEET, &BOB_SALT).expect("bob");
    // A repeat reveal records nothing more.
    g.reveal(ALICE, &ALICE_FLEET, &ALICE_SALT).expect("again");
    let m = summary(&mut g);
    assert_eq!(m["status"], json!("Finished"));
    assert_eq!(m["winner"], json!(ALICE));
    let stats = |g: &mut Game, who: &str| {
        g.t.as_(CAROL)
            .view("getPlayerStats", json!({ "player": who }))
            .unwrap()
    };
    assert_eq!(
        stats(&mut g, ALICE),
        json!({ "wins": "1", "losses": "0", "games_played": "1" })
    );
    assert_eq!(
        stats(&mut g, BOB),
        json!({ "wins": "0", "losses": "1", "games_played": "1" })
    );
    assert_eq!(stats(&mut g, CAROL), Value::Null);
    let history = g.t.as_(CAROL).view("getHistory", json!({})).unwrap();
    assert_eq!(history.as_array().expect("history").len(), 1);
    assert_eq!(history[0]["match_id"], json!(g.id));
    assert_eq!(history[0]["winner"], json!(ALICE));
    assert_eq!(history[0]["loser"], json!(BOB));
}

// ── a match (v1's game service) ──────────────────────────────────────────────

#[test]
fn a_new_match_starts_with_player_one_to_shoot() {
    let mut g = game();
    let id = g.id.clone();
    assert_eq!(
        g.t.as_(CAROL)
            .view("getCurrentTurn", json!({ "matchId": id }))
            .unwrap(),
        json!(ALICE)
    );
    assert_eq!(
        g.t.as_(ALICE).view("getActiveMatchId", json!({})).unwrap(),
        json!(id)
    );
    assert_eq!(
        g.t.as_(CAROL).view("getActiveMatchId", json!({})).unwrap(),
        Value::Null
    );
    assert_eq!(
        g.t.as_(BOB).view("getCurrentUser", json!({})).unwrap(),
        json!(BOB)
    );
}

#[test]
fn a_commitment_is_the_only_thing_stored_about_a_board() {
    let mut g = game();
    assert_eq!(g.state()["committed"], json!([]));
    g.commit(ALICE, &ALICE_FLEET, &ALICE_SALT)
        .expect("alice commits");
    assert_eq!(g.state()["committed"], json!([ALICE]));
    // Nothing but 64 hex characters is a commitment.
    assert_eq!(
        code(g.call(BOB, "commitBoard", json!({ "commitment": "abc" }))),
        "Invalid"
    );
    assert_eq!(
        code(g.call(BOB, "commitBoard", json!({ "commitment": "zz".repeat(32) }))),
        "Invalid"
    );
    assert_eq!(g.state()["committed"], json!([ALICE]));
}

#[test]
fn a_shot_is_answered_and_the_turn_passes() {
    let mut g = placed();
    // Not Bob's turn, and not anyone's who is not playing.
    assert_eq!(
        code(g.call(BOB, "proposeShot", json!({ "x": 0, "y": 0 }))),
        "Forbidden"
    );
    assert_eq!(
        code(g.call(CAROL, "proposeShot", json!({ "x": 8, "y": 0 }))),
        "Forbidden"
    );
    assert_eq!(
        code(g.call(ALICE, "proposeShot", json!({ "x": 10, "y": 0 }))),
        "Invalid"
    );
    g.shoot(ALICE, 8, 0);
    assert_eq!(
        code(g.call(ALICE, "proposeShot", json!({ "x": 9, "y": 0 }))),
        "Invalid",
        "one shot at a time"
    );
    let shot = g.pending();
    assert_eq!(shot, json!({ "shot_id": 0, "x": 8, "y": 0, "target": BOB }));
    assert_eq!(g.answer(BOB, &BOB_FLEET), "hit");
    let id = g.id.clone();
    assert_eq!(
        g.t.as_(ALICE)
            .view("getCurrentTurn", json!({ "matchId": id }))
            .unwrap(),
        json!(BOB)
    );
    assert_eq!(g.state()["pending_shot"], Value::Null);
    let shots = g.view(ALICE, "getShots");
    assert_eq!(shots["size"], json!(10));
    assert_eq!(shots["shots"][8], json!(Cell::Hit.to_u8()));
    let incoming = g.view(BOB, "getIncomingShots");
    assert_eq!(incoming["shots"][8], json!(Cell::Hit.to_u8()));
    let bobs = g.view(BOB, "getShots");
    assert!(bobs["shots"]
        .as_array()
        .unwrap()
        .iter()
        .all(|c| c == &json!(0)));
    // A cell already shot is not shot again.
    g.shoot(BOB, 0, 9);
    g.answer(ALICE, &ALICE_FLEET);
    assert_eq!(
        code(g.call(ALICE, "proposeShot", json!({ "x": 8, "y": 0 }))),
        "Invalid"
    );
}

#[test]
fn only_the_target_answers_and_only_the_pending_shot() {
    let mut g = placed();
    assert_eq!(
        code(g.ack(BOB, &json!(0), true)),
        "Invalid",
        "nothing to answer yet"
    );
    g.shoot(ALICE, 8, 0);
    assert_eq!(
        code(g.ack(ALICE, &json!(0), true)),
        "Forbidden",
        "the shooter does not answer their own shot"
    );
    assert_eq!(
        code(g.ack(BOB, &json!(1), true)),
        "Invalid",
        "an answer names the shot it is for"
    );
    assert_eq!(
        code(g.ack(CAROL, &json!(0), true)),
        "Forbidden",
        "not a player"
    );
    assert_eq!(g.answer(BOB, &BOB_FLEET), "hit");
    // v1 made a second, different answer equivocation (a loss); here an
    // answered shot is simply not answered again.
    assert_eq!(code(g.ack(BOB, &json!(0), false)), "Invalid");
    let incoming = g.view(BOB, "getIncomingShots");
    assert_eq!(incoming["shots"][8], json!(Cell::Hit.to_u8()));
}

#[test]
fn a_second_commitment_is_refused() {
    let mut g = placed();
    let again = commitment(&board(&ALICE_FLEET), &[1u8; 16]);
    assert_eq!(
        code(g.call(ALICE, "commitBoard", json!({ "commitment": again }))),
        "AlreadyCommitted"
    );
    assert_eq!(
        code(g.call(
            CAROL,
            "commitBoard",
            json!({ "commitment": "ab".repeat(32) })
        )),
        "Forbidden"
    );
}

#[test]
fn a_board_is_not_revealed_while_the_match_is_on() {
    let mut g = placed();
    assert_eq!(code(g.reveal(ALICE, &ALICE_FLEET, &ALICE_SALT)), "Invalid");
    assert_eq!(g.state()["revealed"], json!([]));
}

#[test]
fn sinking_the_fleet_wins_once_the_winners_board_passes_the_audit() {
    let mut g = placed();
    g.play_to_the_end();
    let id = g.id.clone();
    // Over on the answers; no board opened yet, so the win is not a win yet.
    let s = g.state();
    assert_eq!(s["standing"], json!("awaiting_reveal"));
    assert_eq!(s["ended_by"], json!("sunk"));
    assert_eq!(s["loser"], json!(BOB));
    assert_eq!(s["revealed"], json!([]));
    assert_eq!(
        g.t.as_(CAROL)
            .view("getWinner", json!({ "matchId": id }))
            .unwrap(),
        Value::Null
    );
    assert_eq!(
        g.t.as_(CAROL)
            .view("getCurrentTurn", json!({ "matchId": id }))
            .unwrap(),
        Value::Null
    );

    g.reveal(BOB, &BOB_FLEET, &BOB_SALT).expect("bob reveals");
    assert_eq!(g.standing(), "awaiting_reveal");
    g.reveal(ALICE, &ALICE_FLEET, &ALICE_SALT)
        .expect("alice reveals");
    let s = g.state();
    assert_eq!(s["standing"], json!("won"));
    assert_eq!(s["winner"], json!(ALICE));
    assert_eq!(s["revealed"], json!([ALICE, BOB]));
    assert_eq!(s["audit_failed"], json!([]));
    assert_eq!(
        g.t.as_(CAROL)
            .view("getWinner", json!({ "matchId": id }))
            .unwrap(),
        json!(ALICE)
    );
    assert_eq!(
        code(g.call(BOB, "proposeShot", json!({ "x": 0, "y": 0 }))),
        "Finished"
    );
    assert_eq!(
        g.t.as_(ALICE).view("getActiveMatchId", json!({})).unwrap(),
        Value::Null
    );
}

#[test]
fn the_winner_alone_revealing_decides_it() {
    let mut g = placed();
    g.play_to_the_end();
    g.reveal(ALICE, &ALICE_FLEET, &ALICE_SALT)
        .expect("alice reveals");
    assert_eq!(g.standing(), "won");
}

#[test]
fn a_reveal_that_does_not_match_the_commitment_is_refused() {
    let mut g = placed();
    g.play_to_the_end();
    // The right board under the wrong salt, and the wrong board under the
    // right salt: neither hashes to what Alice committed to.
    assert_eq!(
        code(g.reveal(ALICE, &ALICE_FLEET, &[0u8; 16])),
        "CommitmentMismatch"
    );
    assert_eq!(
        code(g.reveal(ALICE, &BOB_FLEET, &ALICE_SALT)),
        "CommitmentMismatch"
    );
    // A salt is 16 bytes.
    let bytes = battleships_rules::board_bytes(&board(&ALICE_FLEET));
    assert_eq!(
        code(g.call(
            ALICE,
            "revealBoard",
            json!({ "boardBytes": b64(&bytes), "salt": b64(&[0xA5; 8]) })
        )),
        "Invalid"
    );
    assert_eq!(g.state()["revealed"], json!([]));
    assert_eq!(g.standing(), "awaiting_reveal");
    g.reveal(ALICE, &ALICE_FLEET, &ALICE_SALT)
        .expect("alice reveals");
    assert_eq!(g.standing(), "won");
}

#[test]
fn a_defender_who_lied_about_a_hit_is_caught_at_the_reveal_and_loses() {
    // Bob's client answers Alice's first shot (a hit on his destroyer) with
    // "miss", then goes on to sink Alice's fleet. The replay of his answers
    // against the board he reveals costs him the win.
    let mut g = placed();
    g.shoot(ALICE, 8, 0);
    let shot = g.pending();
    assert_eq!(
        g.ack(BOB, &shot["shot_id"], false).expect("bob lies"),
        json!("miss")
    );
    let water = bob_water();
    for (i, (x, y)) in cells(&ALICE_FLEET).into_iter().enumerate() {
        g.shoot(BOB, x, y);
        assert_eq!(g.answer(ALICE, &ALICE_FLEET), "hit");
        if i + 1 < 17 {
            let (wx, wy) = water[i];
            g.shoot(ALICE, wx, wy);
            assert_eq!(g.answer(BOB, &BOB_FLEET), "miss");
        }
    }
    let s = g.state();
    assert_eq!(s["standing"], json!("awaiting_reveal"));
    assert_eq!(s["loser"], json!(ALICE));

    g.reveal(ALICE, &ALICE_FLEET, &ALICE_SALT)
        .expect("alice reveals");
    assert_eq!(g.standing(), "awaiting_reveal", "bob's board decides it");
    g.reveal(BOB, &BOB_FLEET, &BOB_SALT).expect("bob reveals");
    let s = g.state();
    assert_eq!(s["audit_failed"], json!([BOB]));
    assert_eq!(s["standing"], json!("won"));
    assert_eq!(s["winner"], json!(ALICE));
    assert_eq!(summary(&mut g)["winner"], json!(ALICE));
}

#[test]
fn a_match_both_players_cheated_in_is_void() {
    let mut g = placed();
    g.shoot(ALICE, 8, 0);
    let shot = g.pending();
    g.ack(BOB, &shot["shot_id"], false).expect("bob lies");
    g.shoot(BOB, 5, 5);
    let shot = g.pending();
    g.ack(ALICE, &shot["shot_id"], true).expect("alice lies");
    let water = bob_water();
    for (i, (x, y)) in cells(&ALICE_FLEET).into_iter().take(16).enumerate() {
        let (wx, wy) = water[i];
        g.shoot(ALICE, wx, wy);
        assert_eq!(g.answer(BOB, &BOB_FLEET), "miss");
        g.shoot(BOB, x, y);
        assert_eq!(g.answer(ALICE, &ALICE_FLEET), "hit");
    }
    let s = g.state();
    assert_eq!(s["standing"], json!("awaiting_reveal"));
    assert_eq!(s["ended_by"], json!("sunk"));
    assert_eq!(s["loser"], json!(ALICE));
    g.reveal(ALICE, &ALICE_FLEET, &ALICE_SALT)
        .expect("alice reveals");
    g.reveal(BOB, &BOB_FLEET, &BOB_SALT).expect("bob reveals");
    let s = g.state();
    assert_eq!(s["standing"], json!("void"));
    assert_eq!(s["audit_failed"].as_array().unwrap().len(), 2);
    assert_eq!(s["winner"], Value::Null);
    // Nobody's record moves, and the match is not finished.
    assert_eq!(summary(&mut g)["status"], json!("Active"));
    assert_eq!(
        g.t.as_(CAROL).view("getHistory", json!({})).unwrap(),
        json!([])
    );
}

#[test]
fn a_defender_who_never_admits_a_hit_runs_out_of_misses() {
    let mut g = placed();
    let alice_ships = cells(&ALICE_FLEET);
    let mut alice_water = (0..10u8)
        .flat_map(|y| (0..10u8).map(move |x| (x, y)))
        .filter(|c| !alice_ships.contains(c));
    'game: for y in 0..10u8 {
        for x in 0..10u8 {
            g.shoot(ALICE, x, y);
            let shot = g.pending();
            g.ack(BOB, &shot["shot_id"], false).expect("bob answers");
            if !g.state()["ended_by"].is_null() {
                break 'game;
            }
            let (wx, wy) = alice_water.next().expect("water left");
            g.shoot(BOB, wx, wy);
            g.answer(ALICE, &ALICE_FLEET);
        }
    }
    let s = g.state();
    assert_eq!(s["ended_by"], json!("impossible_misses"));
    assert_eq!(s["loser"], json!(BOB));
}

#[test]
fn match_events_reach_its_players_and_lobby_events_everyone() {
    let mut g = placed();
    g.shoot(ALICE, 8, 0);
    g.answer(BOB, &BOB_FLEET);
    let names = |g: &mut Game, who: &str| -> Vec<String> {
        g.t.events_for(who).into_iter().map(|(n, _)| n).collect()
    };
    assert_eq!(
        names(&mut g, BOB),
        [
            "PlayersUpdated",
            "PlayersUpdated",
            "MatchCreated",
            "MatchListUpdated",
            "BoardCommitted",
            "ShipsPlaced",
            "MatchListUpdated",
            "BoardCommitted",
            "ShipsPlaced",
            "MatchListUpdated",
            "ShotProposed",
            "ShotFired",
        ]
    );
    assert_eq!(
        names(&mut g, CAROL),
        [
            "PlayersUpdated",
            "PlayersUpdated",
            "MatchCreated",
            "MatchListUpdated",
            "MatchListUpdated",
            "MatchListUpdated",
        ]
    );
    let fired =
        g.t.events_for(ALICE)
            .into_iter()
            .find(|(n, _)| n == "ShotFired")
            .expect("ShotFired")
            .1;
    assert_eq!(
        fired,
        json!({ "id": g.id, "x": 8, "y": 0, "result": "hit" })
    );

    let mut g = placed();
    g.play_to_the_end();
    g.reveal(ALICE, &ALICE_FLEET, &ALICE_SALT).expect("alice");
    let tail: Vec<String> = names(&mut g, BOB).into_iter().rev().take(8).collect();
    assert_eq!(
        tail,
        [
            "PlayerStatsUpdated",
            "MatchListUpdated",
            "MatchEnded",
            "Winner",
            "AuditPassed",
            "BoardRevealed",
            "RevealRequested",
            "ShotFired",
        ]
    );
}

// ── access and wire checks ───────────────────────────────────────────────────

#[test]
fn the_platform_refuses_anonymous_callers_and_outsiders() {
    let mut g = game();
    let id = g.id.clone();
    let refused = |status: u16, code: &str| {
        Err(Failure::Refused {
            status,
            code: code.to_owned(),
        })
    };
    assert_eq!(
        g.t.anonymous().view("getMatches", json!({})),
        refused(401, "UNAUTHENTICATED")
    );
    assert_eq!(
        g.t.anonymous().call("registerPlayer", json!({})),
        refused(401, "UNAUTHENTICATED")
    );
    assert_eq!(
        g.t.as_("eve")
            .view("getMatchState", json!({ "matchId": id })),
        refused(404, "NOT_FOUND")
    );
    assert_eq!(
        g.t.as_("eve").call("registerPlayer", json!({})),
        refused(404, "NOT_FOUND")
    );
}

#[test]
fn a_guest_plays_and_a_bystander_reads_only_the_lobby() {
    let mut g = game();
    g.t.as_(GUEST).call("registerPlayer", json!({})).unwrap();
    let id =
        g.t.as_(GUEST)
            .call("createMatch", json!({ "player2": ALICE }))
            .unwrap();
    assert!(id.as_str().unwrap().starts_with("gus-"));
    // Carol is in the org but in neither match.
    let mine = g.id.clone();
    for method in ["getMatchState", "getShots", "getIncomingShots"] {
        assert_eq!(
            code(g.t.as_(CAROL).view(method, json!({ "matchId": mine }))),
            "Forbidden"
        );
    }
    assert_eq!(
        g.t.as_(CAROL)
            .view("getMatches", json!({}))
            .unwrap()
            .as_array()
            .unwrap()
            .len(),
        2
    );
}

#[test]
fn wire_errors() {
    let mut g = placed();
    let id = g.id.clone();
    assert_eq!(
        g.t.as_(ALICE)
            .view("getMatchState", json!({ "matchId": "nope" })),
        Err(Failure::App {
            code: "NotFound".to_owned(),
            fields: json!({ "matchId": "nope" })
        })
    );
    assert_eq!(
        code(g.t.as_(ALICE).view("noSuchMethod", json!({}))),
        "UnknownMethod"
    );
    assert_eq!(
        code(
            g.t.as_(ALICE)
                .view("proposeShot", json!({ "matchId": id, "x": 0, "y": 0 }))
        ),
        "NotAView"
    );
    // v1's snake_case argument names are refused: unknown keys.
    assert_eq!(
        code(
            g.t.as_(ALICE)
                .view("getMatchState", json!({ "match_id": id }))
        ),
        "BadArgs"
    );
    // `setMatchContextId` went with the game contexts.
    assert_eq!(
        code(g.t.as_(ALICE).call(
            "setMatchContextId",
            json!({ "matchId": id, "contextId": "ab" })
        )),
        "UnknownMethod"
    );
    // `boardBytes` is base64url, not v1's array of numbers.
    assert_eq!(
        code(g.t.as_(ALICE).call(
            "revealBoard",
            json!({ "matchId": id, "boardBytes": [1, 2], "salt": "AA" })
        )),
        "BadArgs"
    );
    assert_eq!(
        g.t.as_(BOB)
            .call("proposeShot", json!({ "matchId": id, "x": 0, "y": 0 })),
        Err(Failure::App {
            code: "Forbidden".to_owned(),
            fields: json!({ "message": "not your turn" })
        })
    );
}
