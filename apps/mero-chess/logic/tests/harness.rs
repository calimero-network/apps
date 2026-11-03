//! The table on core's real wasmtime engine (`TestApp`): v1's `TestHost`
//! tests method for method, what v1's byzantine and "cannot take back" tests
//! become under one log (refused calls instead of inert rows), and the access
//! and wire checks v1 could not express.

#![cfg(not(target_arch = "wasm32"))]

mod common;

use calimero_app_sdk::testing::{Failure, Org, TestApp};
use serde_json::{json, Value};

/// A wall-clock-looking `now` (a decimal string on the wire).
fn at(ms: u64) -> String {
    (1_700_000_000_000 + ms).to_string()
}

/// The owner and bob play; cy is a member who watches; gus is a guest.
fn app() -> TestApp {
    common::app(Org::new().members(["bob", "cy"]).guests(["gus"]))
}

fn call(t: &mut TestApp, who: &str, method: &str, args: Value) -> Value {
    t.as_(who)
        .call(method, args)
        .unwrap_or_else(|e| panic!("{who} {method}: {e:?}"))
}

fn table(t: &mut TestApp, who: &str, now: u64) -> Value {
    t.as_(who)
        .view("table", json!({ "now": at(now) }))
        .unwrap_or_else(|e| panic!("{who} table: {e:?}"))
}

fn history(t: &mut TestApp, who: &str) -> Value {
    t.as_(who)
        .view("history", json!({}))
        .unwrap_or_else(|e| panic!("{who} history: {e:?}"))
}

fn play(t: &mut TestApp, who: &str, uci: &str, now: u64) -> String {
    call(t, who, "play", json!({ "uci": uci, "now": at(now) }))
        .as_str()
        .unwrap_or_else(|| panic!("{who} {uci}: SAN is a string"))
        .to_owned()
}

fn sit(t: &mut TestApp, who: &str, seat: &str, name: &str, now: u64) {
    call(
        t,
        who,
        "sit",
        json!({ "seat": seat, "name": name, "now": at(now) }),
    );
}

fn code_of(r: Result<Value, Failure>) -> String {
    match r {
        Err(Failure::App { code, .. }) => code,
        other => panic!("expected an app error, got {other:?}"),
    }
}

fn try_call(t: &mut TestApp, who: &str, method: &str, args: Value) -> String {
    code_of(t.as_(who).call(method, args))
}

fn names(t: &TestApp, who: &str) -> Vec<String> {
    t.events_for(who).into_iter().map(|(n, _)| n).collect()
}

/// The owner (Alice) in white, bob (Bob) in black.
fn seated() -> TestApp {
    let mut t = app();
    sit(&mut t, "owner", "white", "Alice", 1);
    sit(&mut t, "bob", "black", "Bob", 2);
    t
}

/// The scholar's mate, played by whoever holds each colour in game 0.
fn scholars_mate(t: &mut TestApp, white: &str, black: &str, from: u64) {
    for (i, uci) in ["e2e4", "e7e5", "f1c4", "b8c6", "d1h5", "g8f6", "h5f7"]
        .into_iter()
        .enumerate()
    {
        let who = if i % 2 == 0 { white } else { black };
        let _san = play(t, who, uci, from + i as u64);
    }
}

// ── a new table ──────────────────────────────────────────────────────────────

#[test]
fn a_new_table_is_waiting_for_players() {
    let mut t = app();
    let v = table(&mut t, "owner", 0);
    assert_eq!(v["title"], "Chess");
    // Created without `now` (the harness passes no init args): "0".
    assert_eq!(v["createdAt"], "0");
    assert_eq!(v["game"], 0);
    assert_eq!(
        v["fen"],
        "rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBNR w KQkq - 0 1"
    );
    assert_eq!(v["sideToMove"], "white");
    assert_eq!(v["status"], "awaitingPlayers");
    assert_eq!(v["result"], "*");
    assert_eq!(v["reason"], "");
    assert_eq!(v["check"], false);
    assert_eq!(v["claimableDraw"], "");
    assert_eq!(v["legalMoves"].as_array().map(Vec::len), Some(20));
    assert_eq!(v["moves"], json!([]));
    assert_eq!(v["me"], "owner");
    assert_eq!(v["myColor"], "");
    assert_eq!(v["myTurn"], false);
    assert_eq!(v["drawOfferFrom"], "");
    assert_eq!(v["players"], json!([]));
    assert_eq!(v["gamesPlayed"], 1);
    assert_eq!(
        v["white"],
        json!({ "seat": "white", "member": "", "name": "", "online": false })
    );
    assert_eq!(v["black"]["seat"], "black");
    assert_eq!(names(&t, "bob"), ["Initialized"]);
    assert_eq!(
        history(&mut t, "cy"),
        json!([{ "index": 0, "startedAt": "0", "result": "*", "reason": "", "plies": 0, "white": "", "black": "" }])
    );
}

// ── join, heartbeat, presence ────────────────────────────────────────────────

#[test]
fn join_announces_once_and_cleans_the_name() {
    let mut t = app();
    call(
        &mut t,
        "owner",
        "join",
        json!({ "name": "  Alice\u{7}  ", "now": at(1) }),
    );
    call(&mut t, "owner", "join", json!({ "name": "", "now": at(2) }));
    assert_eq!(names(&t, "bob"), ["Initialized", "PlayerJoined"]);
    assert_eq!(
        t.events_for("bob")[1].1,
        json!({ "member": "owner" }),
        "the event names the account"
    );
    call(
        &mut t,
        "bob",
        "join",
        json!({ "name": "B".repeat(80), "now": at(3) }),
    );
    let v = table(&mut t, "cy", 3);
    // In the order they first announced themselves; an empty name is "Guest";
    // names are capped at 32 characters.
    assert_eq!(
        v["players"],
        json!([
            { "id": "owner", "name": "Guest", "online": true, "color": "" },
            { "id": "bob", "name": "B".repeat(32), "online": true, "color": "" },
        ])
    );
}

#[test]
fn presence_expires_and_a_call_refreshes_it() {
    let mut t = seated();
    // A minute after her last call, Alice reads as away.
    assert_eq!(table(&mut t, "owner", 2 + 60_000)["white"]["online"], false);

    let _san = play(&mut t, "owner", "e2e4", 100_000);
    assert_eq!(table(&mut t, "owner", 100_000)["white"]["online"], true);
    assert_eq!(table(&mut t, "owner", 100_000)["black"]["online"], false);

    // A heartbeat is silent on purpose: it runs every few seconds.
    let before = names(&t, "cy").len();
    call(&mut t, "bob", "heartbeat", json!({ "now": at(120_000) }));
    assert_eq!(names(&t, "cy").len(), before);
    assert_eq!(table(&mut t, "owner", 120_000)["black"]["online"], true);
    // Exactly the TTL is still present; one more millisecond is not.
    assert_eq!(table(&mut t, "owner", 150_000)["black"]["online"], true);
    assert_eq!(table(&mut t, "owner", 150_001)["black"]["online"], false);

    // A heartbeat from someone who never announced themselves writes nothing.
    call(&mut t, "cy", "heartbeat", json!({ "now": at(121_000) }));
    assert_eq!(
        table(&mut t, "cy", 121_000)["players"]
            .as_array()
            .map(Vec::len),
        Some(2)
    );
}

// ── sitting down ─────────────────────────────────────────────────────────────

#[test]
fn a_seat_someone_else_holds_cannot_be_taken() {
    let mut t = seated();
    assert_eq!(
        try_call(
            &mut t,
            "cy",
            "sit",
            json!({ "seat": "white", "name": "Carol", "now": at(3) })
        ),
        "SeatTaken"
    );
    // Sitting in your own chair again is not an error, and changes nothing.
    sit(&mut t, "owner", "white", "Someone else", 4);
    let v = table(&mut t, "cy", 4);
    assert_eq!(v["white"]["member"], "owner");
    assert_eq!(v["white"]["name"], "Alice");
    assert_eq!(v["black"]["member"], "bob");
    assert_eq!(v["status"], "inProgress");
    // Seats are case- and space-insensitive; anything else is refused.
    assert_eq!(
        t.as_("cy")
            .call("sit", json!({ "seat": "red", "name": "", "now": at(5) })),
        Err(Failure::App {
            code: "UnknownSeat".to_owned(),
            fields: json!({ "seat": "red" })
        })
    );
    assert_eq!(
        try_call(
            &mut t,
            "cy",
            "sit",
            json!({ "seat": " BLACK ", "name": "", "now": at(5) })
        ),
        "SeatTaken"
    );
}

#[test]
fn standing_up_is_allowed_before_the_first_move_and_not_after() {
    let mut t = seated();
    call(&mut t, "bob", "stand", json!({ "now": at(3) }));
    assert_eq!(
        names(&t, "cy"),
        ["Initialized", "Seated", "Seated", "Vacated"]
    );
    let v = table(&mut t, "cy", 3);
    assert_eq!(v["black"]["member"], "");
    assert_eq!(v["status"], "awaitingPlayers");

    sit(&mut t, "cy", "black", "Carol", 4);
    let _san = play(&mut t, "owner", "e2e4", 5);
    // Neither may leave once the game has a move, whether or not they made it.
    assert_eq!(
        try_call(&mut t, "cy", "stand", json!({ "now": at(6) })),
        "AlreadyPlayed"
    );
    assert_eq!(
        try_call(&mut t, "owner", "stand", json!({ "now": at(6) })),
        "AlreadyPlayed"
    );
    assert_eq!(
        try_call(&mut t, "bob", "stand", json!({ "now": at(6) })),
        "NotSeated"
    );
}

#[test]
fn a_chair_someone_has_played_from_is_kept() {
    // Game 0 ends at ply 0 by White's resignation, so the game has no move;
    // White has acted (resigned) and keeps the chair, Black has not and may go.
    let mut t = seated();
    call(&mut t, "owner", "resign", json!({ "now": at(3) }));
    assert_eq!(
        try_call(&mut t, "owner", "stand", json!({ "now": at(4) })),
        "AlreadyPlayed"
    );
    call(&mut t, "bob", "stand", json!({ "now": at(4) }));
    sit(&mut t, "cy", "black", "Carol", 5);
    // The finished game still names who played it.
    assert_eq!(history(&mut t, "cy")[0]["black"], "bob");
    assert_eq!(table(&mut t, "cy", 5)["black"]["member"], "cy");
}

// ── playing ──────────────────────────────────────────────────────────────────

#[test]
fn a_game_cannot_start_before_both_chairs_are_taken() {
    let mut t = app();
    sit(&mut t, "owner", "white", "Alice", 1);
    assert_eq!(
        try_call(
            &mut t,
            "owner",
            "play",
            json!({ "uci": "e2e4", "now": at(2) })
        ),
        "WaitingForOpponent"
    );
    assert_eq!(table(&mut t, "owner", 2)["moves"], json!([]));
}

#[test]
fn only_the_player_to_move_may_move() {
    let mut t = seated();
    assert_eq!(
        try_call(
            &mut t,
            "bob",
            "play",
            json!({ "uci": "e7e5", "now": at(3) })
        ),
        "NotYourMove"
    );
    assert_eq!(play(&mut t, "owner", "e2e4", 4), "e4");
    assert_eq!(
        try_call(
            &mut t,
            "owner",
            "play",
            json!({ "uci": "d2d4", "now": at(5) })
        ),
        "NotYourMove"
    );
    assert_eq!(play(&mut t, "bob", "e7e5", 6), "e5");
    let v = table(&mut t, "bob", 7);
    assert_eq!(v["myColor"], "black");
    assert_eq!(v["myTurn"], false);
    assert_eq!(table(&mut t, "owner", 7)["myTurn"], true);
}

#[test]
fn an_illegal_or_unreadable_move_is_refused() {
    let mut t = seated();
    assert_eq!(
        t.as_("owner")
            .call("play", json!({ "uci": "e2e5", "now": at(3) })),
        Err(Failure::App {
            code: "IllegalMove".to_owned(),
            fields: json!({ "uci": "e2e5" })
        })
    );
    assert_eq!(
        t.as_("owner")
            .call("play", json!({ "uci": "Nf3", "now": at(3) })),
        Err(Failure::App {
            code: "BadMove".to_owned(),
            fields: json!({ "uci": "Nf3" })
        })
    );
    assert_eq!(table(&mut t, "owner", 3)["moves"], json!([]));
}

#[test]
fn moves_carry_san_ply_author_and_clock() {
    let mut t = seated();
    let _ = play(&mut t, "owner", "e2e4", 3);
    let _ = play(&mut t, "bob", "c7c5", 4);
    let _ = play(&mut t, "owner", "g1f3", 5);
    let v = table(&mut t, "cy", 6);
    assert_eq!(
        v["moves"],
        json!([
            { "ply": 0, "uci": "e2e4", "san": "e4", "by": "owner", "at": at(3) },
            { "ply": 1, "uci": "c7c5", "san": "c5", "by": "bob", "at": at(4) },
            { "ply": 2, "uci": "g1f3", "san": "Nf3", "by": "owner", "at": at(5) },
        ])
    );
    assert_eq!(
        v["fen"],
        "rnbqkbnr/pp1ppppp/8/2p5/4P3/5N2/PPPP1PPP/RNBQKB1R b KQkq - 1 2"
    );
    assert_eq!(v["sideToMove"], "black");
    let legal: Vec<&str> = v["legalMoves"]
        .as_array()
        .expect("a list")
        .iter()
        .filter_map(Value::as_str)
        .collect();
    let mut sorted = legal.clone();
    sorted.sort_unstable();
    assert_eq!(legal, sorted, "legal moves are sorted");
    assert!(legal.contains(&"b8c6"));
}

#[test]
fn a_promotion_defaults_to_a_queen_when_the_client_names_nothing() {
    let mut t = seated();
    for (step, (who, uci)) in [
        ("owner", "h2h4"),
        ("bob", "a7a5"),
        ("owner", "h4h5"),
        ("bob", "a5a4"),
        ("owner", "h5h6"),
        ("bob", "a8a5"),
        ("owner", "h6g7"),
        ("bob", "a5b5"),
    ]
    .into_iter()
    .enumerate()
    {
        let _san = play(&mut t, who, uci, 10 + step as u64);
    }
    assert_eq!(play(&mut t, "owner", "g7h8", 30), "gxh8=Q");
    let v = table(&mut t, "owner", 31);
    assert_eq!(v["moves"][8]["uci"], "g7h8q");
    // An underpromotion named explicitly is kept.
    let _ = play(&mut t, "bob", "a4a3", 32);
    let _ = play(&mut t, "owner", "e2e3", 33);
    assert_eq!(play(&mut t, "bob", "a3b2", 34), "axb2");
    let _ = play(&mut t, "owner", "e3e4", 35);
    assert_eq!(play(&mut t, "bob", "b2a1n", 36), "bxa1=N");
    assert_eq!(table(&mut t, "owner", 37)["moves"][13]["uci"], "b2a1n");
}

#[test]
fn fools_mate_ends_the_game_on_the_board() {
    let mut t = seated();
    let _ = play(&mut t, "owner", "f2f3", 3);
    let _ = play(&mut t, "bob", "e7e5", 4);
    let _ = play(&mut t, "owner", "g2g4", 5);
    assert_eq!(play(&mut t, "bob", "d8h4", 6), "Qh4#");
    let v = table(&mut t, "owner", 7);
    assert_eq!(v["status"], "finished");
    assert_eq!(v["result"], "0-1");
    assert_eq!(v["reason"], "checkmate");
    assert_eq!(v["check"], true);
    assert_eq!(v["legalMoves"], json!([]), "withheld once the game is over");
    assert_eq!(v["myTurn"], false);
    assert_eq!(
        try_call(
            &mut t,
            "owner",
            "play",
            json!({ "uci": "a2a3", "now": at(8) })
        ),
        "GameOver"
    );
    assert_eq!(
        try_call(&mut t, "owner", "resign", json!({ "now": at(8) })),
        "GameOver"
    );
}

#[test]
fn a_stalemate_is_a_draw_the_board_decides() {
    // The quickest known stalemate (Sam Loyd, ten moves).
    let mut t = seated();
    let line = [
        "e2e3", "a7a5", "d1h5", "a8a6", "h5a5", "h7h5", "h2h4", "a6h6", "a5c7", "f7f6", "c7d7",
        "e8f7", "d7b7", "d8d3", "b7b8", "d3h7", "b8c8", "f7g6", "c8e6",
    ];
    for (i, uci) in line.into_iter().enumerate() {
        let who = if i % 2 == 0 { "owner" } else { "bob" };
        let _ = play(&mut t, who, uci, 10 + i as u64);
    }
    let v = table(&mut t, "cy", 40);
    assert_eq!(v["result"], "1/2-1/2");
    assert_eq!(v["reason"], "stalemate");
    assert_eq!(v["check"], false);
}

// ── endings a person causes ──────────────────────────────────────────────────

#[test]
fn resigning_hands_the_game_to_the_other_side() {
    let mut t = seated();
    let _ = play(&mut t, "owner", "e2e4", 3);
    call(&mut t, "bob", "resign", json!({ "now": at(4) }));
    let v = table(&mut t, "owner", 5);
    assert_eq!(v["result"], "1-0");
    assert_eq!(v["reason"], "resignation");
    assert_eq!(v["status"], "finished");
    assert_eq!(
        names(&t, "cy").last().map(String::as_str),
        Some("GameEnded")
    );
    assert_eq!(
        t.events_for("cy").last().map(|(_, d)| d.clone()),
        Some(json!({ "game": 0, "result": "1-0", "reason": "resignation" }))
    );
}

#[test]
fn a_resignation_cannot_be_undone_by_playing_on() {
    let mut t = seated();
    call(&mut t, "owner", "resign", json!({ "now": at(3) }));
    assert_eq!(
        try_call(
            &mut t,
            "owner",
            "play",
            json!({ "uci": "e2e4", "now": at(4) })
        ),
        "GameOver"
    );
    assert_eq!(
        try_call(&mut t, "bob", "offerDraw", json!({ "now": at(4) })),
        "GameOver"
    );
    assert_eq!(table(&mut t, "cy", 5)["result"], "0-1");
}

#[test]
fn a_draw_offer_is_accepted_declined_or_expires_with_the_position() {
    let mut t = seated();
    // Declined.
    call(&mut t, "owner", "offerDraw", json!({ "now": at(3) }));
    assert_eq!(table(&mut t, "bob", 3)["drawOfferFrom"], "owner");
    call(&mut t, "bob", "declineDraw", json!({ "now": at(4) }));
    assert_eq!(table(&mut t, "bob", 4)["drawOfferFrom"], "");
    assert_eq!(
        try_call(&mut t, "bob", "acceptDraw", json!({ "now": at(5) })),
        "NoDrawOffer"
    );
    assert_eq!(
        try_call(&mut t, "bob", "declineDraw", json!({ "now": at(5) })),
        "NoDrawOffer"
    );

    // Expires with the position: a move voids it.
    let _ = play(&mut t, "owner", "e2e4", 6);
    call(&mut t, "bob", "offerDraw", json!({ "now": at(7) }));
    assert_eq!(table(&mut t, "owner", 7)["drawOfferFrom"], "bob");
    let _ = play(&mut t, "bob", "e7e5", 8);
    assert_eq!(table(&mut t, "owner", 8)["drawOfferFrom"], "");
    assert_eq!(
        try_call(&mut t, "owner", "acceptDraw", json!({ "now": at(9) })),
        "NoDrawOffer"
    );

    // Accepted.
    call(&mut t, "owner", "offerDraw", json!({ "now": at(10) }));
    call(&mut t, "bob", "acceptDraw", json!({ "now": at(11) }));
    let v = table(&mut t, "cy", 12);
    assert_eq!(v["result"], "1/2-1/2");
    assert_eq!(v["reason"], "agreement");
    assert_eq!(v["drawOfferFrom"], "");
    // An agreed draw cannot be withdrawn afterwards.
    assert_eq!(
        try_call(&mut t, "owner", "declineDraw", json!({ "now": at(13) })),
        "NoDrawOffer"
    );
    assert_eq!(table(&mut t, "cy", 13)["reason"], "agreement");
    let kinds = names(&t, "cy");
    assert_eq!(
        kinds.iter().filter(|k| *k == "DrawOffered").count(),
        3,
        "{kinds:?}"
    );
    assert_eq!(kinds.iter().filter(|k| *k == "DrawDeclined").count(), 1);
}

/// `Game::offers` is stored inside the game record, so it must not grow:
/// repeating an offer in one position rewrites the one row, a refusal holds
/// for the whole position (re-offering does not revive it, as in v1), and a
/// move clears the list.
#[test]
fn repeated_offers_do_not_pile_up() {
    let mut t = seated();
    for i in 0..50 {
        call(&mut t, "owner", "offerDraw", json!({ "now": at(10 + i) }));
    }
    assert_eq!(table(&mut t, "cy", 60)["drawOfferFrom"], "owner");
    call(&mut t, "bob", "declineDraw", json!({ "now": at(61) }));
    for i in 0..50 {
        call(&mut t, "owner", "offerDraw", json!({ "now": at(62 + i) }));
    }
    assert_eq!(table(&mut t, "cy", 120)["drawOfferFrom"], "");
    // A move starts a new position with an empty list.
    let _ = play(&mut t, "owner", "e2e4", 121);
    call(&mut t, "owner", "offerDraw", json!({ "now": at(122) }));
    call(&mut t, "bob", "acceptDraw", json!({ "now": at(123) }));
    assert_eq!(table(&mut t, "cy", 124)["reason"], "agreement");
}

#[test]
fn you_cannot_accept_your_own_draw_offer() {
    let mut t = seated();
    call(&mut t, "owner", "offerDraw", json!({ "now": at(3) }));
    assert_eq!(
        try_call(&mut t, "owner", "acceptDraw", json!({ "now": at(4) })),
        "NoDrawOffer"
    );
    assert_eq!(table(&mut t, "cy", 4)["result"], "*");
}

#[test]
fn a_threefold_draw_is_claimed_and_not_automatic() {
    let mut t = seated();
    let shuffle = ["g1f3", "g8f6", "f3g1", "f6g8"];
    for (i, uci) in shuffle.iter().chain(shuffle.iter()).enumerate() {
        let who = if i % 2 == 0 { "owner" } else { "bob" };
        let _ = play(&mut t, who, uci, 10 + i as u64);
    }
    let v = table(&mut t, "cy", 20);
    assert_eq!(v["claimableDraw"], "threefold");
    assert_eq!(v["result"], "*", "a threefold is a claim, not an ending");
    // A spectator cannot claim it.
    assert_eq!(
        try_call(&mut t, "cy", "claimDraw", json!({ "now": at(21) })),
        "NotSeated"
    );
    call(&mut t, "owner", "claimDraw", json!({ "now": at(21) }));
    let v = table(&mut t, "cy", 22);
    assert_eq!(v["result"], "1/2-1/2");
    assert_eq!(v["reason"], "threefold");
}

#[test]
fn fivefold_ends_the_game_on_its_own() {
    let mut t = seated();
    let shuffle = ["g1f3", "g8f6", "f3g1", "f6g8"];
    let mut last = String::new();
    for (i, uci) in shuffle.iter().cycle().take(16).enumerate() {
        let who = if i % 2 == 0 { "owner" } else { "bob" };
        last = play(&mut t, who, uci, 10 + i as u64);
    }
    assert_eq!(last, "Ng8");
    let v = table(&mut t, "cy", 40);
    assert_eq!(v["result"], "1/2-1/2");
    assert_eq!(v["reason"], "fivefold");
    assert_eq!(
        names(&t, "cy").last().map(String::as_str),
        Some("GameEnded")
    );
}

#[test]
fn a_draw_cannot_be_claimed_out_of_a_position_that_does_not_allow_one() {
    let mut t = seated();
    let _ = play(&mut t, "owner", "e2e4", 3);
    assert_eq!(
        try_call(&mut t, "bob", "claimDraw", json!({ "now": at(4) })),
        "NoDrawToClaim"
    );
    assert_eq!(table(&mut t, "cy", 4)["result"], "*");
}

// ── rematches ────────────────────────────────────────────────────────────────

#[test]
fn a_rematch_swaps_the_colours_and_needs_a_finished_game() {
    let mut t = seated();
    assert_eq!(
        try_call(&mut t, "owner", "rematch", json!({ "now": at(3) })),
        "GameNotFinished"
    );
    scholars_mate(&mut t, "owner", "bob", 10);
    assert_eq!(
        try_call(&mut t, "cy", "rematch", json!({ "now": at(20) })),
        "NotSeated"
    );
    assert_eq!(
        call(&mut t, "bob", "rematch", json!({ "now": at(20) })),
        json!(1)
    );
    // Only one new game: the second rematch finds this one unfinished.
    assert_eq!(
        try_call(&mut t, "owner", "rematch", json!({ "now": at(21) })),
        "GameNotFinished"
    );
    let v = table(&mut t, "owner", 22);
    assert_eq!(v["game"], 1);
    assert_eq!(v["gamesPlayed"], 2);
    assert_eq!(v["moves"], json!([]));
    assert_eq!(v["result"], "*");
    // The `black` chair has White now.
    assert_eq!(v["white"]["seat"], "black");
    assert_eq!(v["white"]["member"], "bob");
    assert_eq!(v["black"]["member"], "owner");
    assert_eq!(v["myColor"], "black");
    assert_eq!(play(&mut t, "bob", "d2d4", 23), "d4");
    assert_eq!(
        history(&mut t, "cy"),
        json!([
            { "index": 0, "startedAt": "0", "result": "1-0", "reason": "checkmate", "plies": 7, "white": "owner", "black": "bob" },
            { "index": 1, "startedAt": at(20), "result": "*", "reason": "", "plies": 1, "white": "bob", "black": "owner" },
        ])
    );
    assert_eq!(
        t.events_for("cy")
            .last()
            .map(|(n, d)| (n.clone(), d.clone())),
        Some((
            "Moved".to_owned(),
            json!({ "game": 1, "ply": 0, "san": "d4", "by": "bob" })
        ))
    );
}

// ── one person, both chairs; one account, several clients ───────────────────

#[test]
fn one_person_can_play_both_sides() {
    let mut t = app();
    sit(&mut t, "owner", "white", "Alice", 1);
    sit(&mut t, "owner", "black", "Alice", 2);
    let v = table(&mut t, "owner", 3);
    assert_eq!(v["status"], "inProgress");
    assert_eq!(v["myColor"], "white");
    assert_eq!(v["myTurn"], true);
    let _ = play(&mut t, "owner", "e2e4", 4);
    let v = table(&mut t, "owner", 5);
    assert_eq!(v["myColor"], "black");
    assert_eq!(v["myTurn"], true);
    scholars_mate_from_e4(&mut t);
    let v = table(&mut t, "owner", 20);
    assert_eq!(v["result"], "1-0");
    assert_eq!(v["reason"], "checkmate");
    assert_eq!(v["players"].as_array().map(Vec::len), Some(1));
}

fn scholars_mate_from_e4(t: &mut TestApp) {
    for (i, uci) in ["e7e5", "d1h5", "b8c6", "f1c4", "g8f6"]
        .into_iter()
        .enumerate()
    {
        let _ = play(t, "owner", uci, 6 + i as u64);
    }
    assert_eq!(play(t, "owner", "h5f7", 12), "Qxf7#");
}

/// v1 keyed identity by ACCOUNT so a phone could move in a game a laptop sat
/// down for. Here every client of an account (a passkey session, an API key)
/// is that account.
#[test]
fn one_account_plays_from_any_client() {
    let mut t = seated();
    let san = t
        .api_key("alice-phone", "owner")
        .call("play", json!({ "uci": "d2d4", "now": at(3) }))
        .expect("her API key is still her");
    assert_eq!(san, "d4");
    let v = t
        .api_key("alice-phone", "owner")
        .view("table", json!({ "now": at(4) }))
        .expect("table");
    assert_eq!(v["myColor"], "white");
    assert_eq!(v["moves"][0]["by"], "owner");
}

#[test]
fn a_spectator_is_neither_colour_and_can_do_nothing_but_watch() {
    let mut t = seated();
    let _ = play(&mut t, "owner", "e2e4", 3);
    let v = table(&mut t, "cy", 4);
    assert_eq!(v["me"], "cy");
    assert_eq!(v["myColor"], "");
    assert_eq!(v["myTurn"], false);
    assert_eq!(v["moves"].as_array().map(Vec::len), Some(1));
    assert!(!v["legalMoves"].as_array().expect("a list").is_empty());

    let before = table(&mut t, "owner", 5);
    assert_eq!(
        try_call(&mut t, "cy", "play", json!({ "uci": "e7e5", "now": at(5) })),
        "NotYourMove"
    );
    for method in [
        "resign",
        "offerDraw",
        "acceptDraw",
        "declineDraw",
        "claimDraw",
        "stand",
    ] {
        assert_eq!(
            try_call(&mut t, "cy", method, json!({ "now": at(5) })),
            "NotSeated",
            "{method}"
        );
    }
    assert_eq!(before, table(&mut t, "owner", 5), "nothing was written");
}

// ── events ───────────────────────────────────────────────────────────────────

#[test]
fn every_state_changing_call_emits_exactly_one_event() {
    let mut t = app();
    sit(&mut t, "owner", "white", "Alice", 1);
    assert_eq!(names(&t, "cy"), ["Initialized", "Seated"]);
    assert_eq!(
        t.events_for("cy")[1].1,
        json!({ "seat": "white", "member": "owner" })
    );
    sit(&mut t, "bob", "black", "Bob", 2);
    let _ = play(&mut t, "owner", "e2e4", 3);
    assert_eq!(
        names(&t, "cy"),
        ["Initialized", "Seated", "Seated", "Moved"]
    );
    call(&mut t, "owner", "heartbeat", json!({ "now": at(4) }));
    assert_eq!(names(&t, "cy").len(), 4);
    for (i, uci) in ["e7e5", "f1c4", "b8c6", "d1h5", "g8f6"]
        .into_iter()
        .enumerate()
    {
        let who = if i % 2 == 0 { "bob" } else { "owner" };
        let _ = play(&mut t, who, uci, 5 + i as u64);
    }
    let _ = play(&mut t, "owner", "h5f7", 10);
    let all = names(&t, "cy");
    assert_eq!(&all[all.len() - 2..], ["Moved", "GameEnded"]);
    assert_eq!(
        t.events_for("cy").last().map(|(_, d)| d.clone()),
        Some(json!({ "game": 0, "result": "1-0", "reason": "checkmate" }))
    );
    call(&mut t, "bob", "rematch", json!({ "now": at(11) }));
    assert_eq!(
        names(&t, "cy").last().map(String::as_str),
        Some("GameStarted")
    );
    // Guests hear every event too: a guest at the table is a spectator (or a
    // player), and their board refreshes on these.
    assert_eq!(names(&t, "gus"), names(&t, "cy"));
}

// ── the permission checks that replace v1's owner stamps ─────────────────────

/// v1 bound every row to its author with core's owner stamp and re-derived
/// everything on read, so a forged row (a move for the player to move, a
/// resignation for somebody else, a seat claim on another's behalf, a rematch
/// by a spectator) was inert. Under one log those writes are calls, and the
/// method refuses them: nothing is written.
#[test]
fn nobody_can_write_for_someone_else() {
    let mut t = seated();
    let _ = play(&mut t, "owner", "e2e4", 3);
    let before = table(&mut t, "owner", 4);
    let history_before = history(&mut t, "owner");

    // A move for the player to move, by a spectator and a guest.
    for who in ["cy", "gus"] {
        assert_eq!(
            try_call(&mut t, who, "play", json!({ "uci": "e7e5", "now": at(4) })),
            "NotYourMove"
        );
    }
    // The player who just moved, moving again.
    assert_eq!(
        try_call(
            &mut t,
            "owner",
            "play",
            json!({ "uci": "d2d4", "now": at(4) })
        ),
        "NotYourMove"
    );
    // Arguments cannot name another author: there is no such parameter.
    assert_eq!(
        try_call(
            &mut t,
            "cy",
            "play",
            json!({ "uci": "e7e5", "now": at(4), "by": "bob" })
        ),
        "BadArgs"
    );
    assert_eq!(
        try_call(
            &mut t,
            "cy",
            "resign",
            json!({ "now": at(4), "member": "bob" })
        ),
        "BadArgs"
    );
    // A seat on another's behalf, or a chair someone holds.
    assert_eq!(
        try_call(
            &mut t,
            "cy",
            "sit",
            json!({ "seat": "black", "name": "Bob", "now": at(4) })
        ),
        "SeatTaken"
    );
    // An agreement nobody offered.
    assert_eq!(
        try_call(&mut t, "bob", "acceptDraw", json!({ "now": at(4) })),
        "NoDrawOffer"
    );

    assert_eq!(before, table(&mut t, "owner", 4));
    assert_eq!(history_before, history(&mut t, "owner"));
}

/// The org decides who reaches the table: a guest may take a free chair and
/// play (as any v1 context member could); an outsider and an anonymous caller
/// are refused by the node before the app runs.
#[test]
fn who_reaches_the_table() {
    let mut t = app();
    sit(&mut t, "gus", "black", "Gus", 1);
    assert_eq!(table(&mut t, "gus", 1)["myColor"], "black");

    assert_eq!(
        t.anonymous().view("table", json!({ "now": at(2) })),
        Err(Failure::Refused {
            status: 401,
            code: "UNAUTHENTICATED".to_owned()
        })
    );
    assert_eq!(
        t.anonymous()
            .call("join", json!({ "name": "x", "now": at(2) })),
        Err(Failure::Refused {
            status: 401,
            code: "UNAUTHENTICATED".to_owned()
        })
    );
    assert_eq!(
        t.as_("mallory")
            .call("sit", json!({ "seat": "white", "name": "M", "now": at(2) })),
        Err(Failure::Refused {
            status: 404,
            code: "NOT_FOUND".to_owned()
        })
    );
    assert_eq!(table(&mut t, "owner", 2)["white"]["member"], "");
}

// ── the wire ─────────────────────────────────────────────────────────────────

/// Arguments are a JSON object of exactly the method's parameters, `u64`s as
/// decimal strings, names in camelCase.
#[test]
fn malformed_arguments_are_refused_before_anything_is_written() {
    let mut t = seated();
    for args in [
        // `now` as a number.
        json!({ "uci": "e2e4", "now": 1_700_000_000_003_u64 }),
        // missing `now`.
        json!({ "uci": "e2e4" }),
        // an unknown key.
        json!({ "uci": "e2e4", "now": at(3), "promotion": "q" }),
    ] {
        assert_eq!(
            code_of(t.as_("owner").call("play", args.clone())),
            "BadArgs",
            "{args}"
        );
    }
    // v1's snake_case method name is not a method any more.
    assert_eq!(
        try_call(&mut t, "owner", "offer_draw", json!({ "now": at(3) })),
        "UnknownMethod"
    );
    assert_eq!(table(&mut t, "owner", 3)["moves"], json!([]));
}

#[test]
fn reads_are_views_and_writes_are_not() {
    let mut t = seated();
    for (method, args) in [
        ("play", json!({ "uci": "e2e4", "now": at(1) })),
        ("rematch", json!({ "now": at(1) })),
        ("heartbeat", json!({ "now": at(1) })),
    ] {
        assert_eq!(code_of(t.as_("owner").view(method, args)), "NotAView");
    }
    assert_eq!(
        code_of(t.as_("owner").call("move", json!({}))),
        "UnknownMethod"
    );
    // A view may run as a call (and writes nothing).
    let v = t
        .as_("owner")
        .call("table", json!({ "now": at(1) }))
        .expect("a view as a call");
    assert_eq!(v["myColor"], "white");
    let h = t
        .as_("owner")
        .call("history", json!({}))
        .expect("a view as a call");
    assert_eq!(h.as_array().map(Vec::len), Some(1));
}
