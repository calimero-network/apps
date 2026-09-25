//! The contract's own rules: who may sit, who may move, and what ends a game.
//!
//! These drive `MeroChess` through `TestHost` — real CRDT state, real merges,
//! no node and no wasm — as two different PEOPLE, because that is the axis
//! every rule here is about. `call_as_account` moves the account and the device
//! together; `call_as` alone moves only the device, which is the same person on
//! a second machine and is tested separately at the bottom.

use calimero_sdk::testing::TestHost;

use crate::{MeroChess, TableView, PRESENCE_TTL_MS};

const ALICE: [u8; 32] = [0xA1; 32];
const ALICE_PHONE: [u8; 32] = [0xA2; 32];
const BOB: [u8; 32] = [0xB0; 32];
const CAROL: [u8; 32] = [0xC0; 32];

/// Milliseconds. Every call takes `now` from its caller, so the tests supply a
/// clock that only moves forward.
fn at(step: u64) -> u64 {
    1_700_000_000_000 + step * 1_000
}

fn table_as(app: &mut TestHost<MeroChess>, account: [u8; 32], now: u64) -> TableView {
    app.set_account(account);
    app.view(|s| s.table(now)).expect("table")
}

/// A table with Alice on the white chair and Bob on the black one.
fn seated() -> TestHost<MeroChess> {
    let mut app = TestHost::new(|| MeroChess::init("Test table".to_owned(), at(0)));
    app.call_as_account(ALICE, ALICE, |s| {
        s.sit("white".to_owned(), "Alice".to_owned(), at(1))
    })
    .expect("alice sits");
    app.call_as_account(BOB, BOB, |s| {
        s.sit("black".to_owned(), "Bob".to_owned(), at(2))
    })
    .expect("bob sits");
    app
}

/// Play a move as `account`, expecting it to be legal.
fn play(app: &mut TestHost<MeroChess>, account: [u8; 32], uci: &str, now: u64) -> String {
    app.call_as_account(account, account, |s| s.play(uci.to_owned(), now))
        .unwrap_or_else(|e| panic!("{uci} should be legal: {e:?}"))
}

#[test]
fn a_new_table_is_waiting_for_players() {
    let app = TestHost::new(|| MeroChess::init("  ".to_owned(), at(0)));
    let view = app.view(|s| s.table(at(1))).expect("table");
    // A blank title falls back rather than rendering an empty heading.
    assert_eq!(view.title, "Chess");
    assert_eq!(view.status, "awaitingPlayers");
    assert_eq!(view.result, "*");
    assert_eq!(view.game, 0);
    assert_eq!(view.side_to_move, "white");
    assert_eq!(view.legal_moves.len(), 20);
    assert!(view.white.member.is_empty());
    assert!(view.black.member.is_empty());
}

#[test]
fn a_seat_someone_else_holds_cannot_be_taken() {
    let mut app = seated();

    // Carol is too late for either chair.
    assert!(app
        .call_as_account(CAROL, CAROL, |s| s.sit(
            "white".to_owned(),
            "Carol".to_owned(),
            at(3)
        ))
        .is_err());

    // Alice cannot take Black either — but because BOB is in it, not because
    // she is already seated. See `one_person_can_play_both_sides`.
    assert!(app
        .call_as_account(ALICE, ALICE, |s| s.sit(
            "black".to_owned(),
            "Alice".to_owned(),
            at(4)
        ))
        .is_err());

    // Re-taking her own chair is a no-op rather than an error, so a client that
    // retries a request cannot lock its own user out.
    app.call_as_account(ALICE, ALICE, |s| {
        s.sit("white".to_owned(), "Alice".to_owned(), at(5))
    })
    .expect("idempotent");

    // `white` / `black` are the only seats there are.
    assert!(app
        .call_as_account(CAROL, CAROL, |s| s.sit(
            "spectator".to_owned(),
            "Carol".to_owned(),
            at(6)
        ))
        .is_err());

    let view = table_as(&mut app, ALICE, at(7));
    assert_eq!(view.white.name, "Alice");
    assert_eq!(view.black.name, "Bob");
    assert_eq!(view.my_color, "white");
    assert!(view.my_turn);
    assert_eq!(view.status, "inProgress");
}

#[test]
fn only_the_player_to_move_may_move() {
    let mut app = seated();

    // Black cannot open.
    assert!(app
        .call_as_account(BOB, BOB, |s| s.play("e7e5".to_owned(), at(3)))
        .is_err());
    // Nor can a spectator.
    assert!(app
        .call_as_account(CAROL, CAROL, |s| s.play("e2e4".to_owned(), at(3)))
        .is_err());
    // Nor is a legal-looking move that is not legal HERE accepted.
    assert!(app
        .call_as_account(ALICE, ALICE, |s| s.play("e2e5".to_owned(), at(3)))
        .is_err());
    // Nor is something that is not a move at all.
    assert!(app
        .call_as_account(ALICE, ALICE, |s| s.play("castle".to_owned(), at(3)))
        .is_err());

    assert_eq!(play(&mut app, ALICE, "e2e4", at(4)), "e4");
    let view = table_as(&mut app, BOB, at(5));
    assert_eq!(view.moves.len(), 1);
    assert_eq!(view.moves[0].san, "e4");
    assert_eq!(view.side_to_move, "black");
    assert!(view.my_turn);
}

#[test]
fn a_game_cannot_start_before_both_chairs_are_taken() {
    let mut app = TestHost::new(|| MeroChess::init("Solo".to_owned(), at(0)));
    app.call_as_account(ALICE, ALICE, |s| {
        s.sit("white".to_owned(), "Alice".to_owned(), at(1))
    })
    .expect("alice sits");

    assert!(app
        .call_as_account(ALICE, ALICE, |s| s.play("e2e4".to_owned(), at(2)))
        .is_err());
    assert_eq!(table_as(&mut app, ALICE, at(3)).status, "awaitingPlayers");
}

#[test]
fn fools_mate_ends_the_game_on_the_board() {
    let mut app = seated();
    play(&mut app, ALICE, "f2f3", at(3));
    play(&mut app, BOB, "e7e5", at(4));
    play(&mut app, ALICE, "g2g4", at(5));
    assert_eq!(play(&mut app, BOB, "d8h4", at(6)), "Qh4#");

    let view = table_as(&mut app, ALICE, at(7));
    assert_eq!(view.status, "finished");
    assert_eq!(view.result, "0-1");
    assert_eq!(view.reason, "checkmate");
    assert!(view.check);
    // No legal moves are offered in a finished game, so a client cannot show a
    // move it would then be refused.
    assert!(view.legal_moves.is_empty());

    // And nothing more can be played into it.
    assert!(app
        .call_as_account(ALICE, ALICE, |s| s.play("e1f2".to_owned(), at(8)))
        .is_err());
}

#[test]
fn resigning_hands_the_game_to_the_other_side() {
    let mut app = seated();
    play(&mut app, ALICE, "e2e4", at(3));

    // A spectator has nothing to resign.
    assert!(app
        .call_as_account(CAROL, CAROL, |s| s.resign(at(4)))
        .is_err());

    app.call_as_account(BOB, BOB, |s| s.resign(at(5)))
        .expect("bob resigns");

    let view = table_as(&mut app, ALICE, at(6));
    assert_eq!(view.result, "1-0");
    assert_eq!(view.reason, "resignation");
    assert_eq!(view.status, "finished");
}

#[test]
fn a_draw_offer_is_accepted_declined_or_expires_with_the_position() {
    let mut app = seated();
    play(&mut app, ALICE, "e2e4", at(3));

    app.call_as_account(BOB, BOB, |s| s.offer_draw(at(4)))
        .expect("bob offers");
    let view = table_as(&mut app, ALICE, at(5));
    assert_eq!(view.draw_offer_from, view.black.member);

    // Declining clears it without ending anything.
    app.call_as_account(ALICE, ALICE, |s| s.decline_draw(at(6)))
        .expect("alice declines");
    assert!(table_as(&mut app, ALICE, at(7)).draw_offer_from.is_empty());
    assert!(app
        .call_as_account(ALICE, ALICE, |s| s.accept_draw(at(8)))
        .is_err());

    // A fresh offer expires the moment the position changes.
    app.call_as_account(BOB, BOB, |s| s.offer_draw(at(9)))
        .expect("bob offers again");
    play(&mut app, BOB, "e7e5", at(10));
    assert!(table_as(&mut app, ALICE, at(11)).draw_offer_from.is_empty());

    // And an offer that is still standing can be taken.
    app.call_as_account(ALICE, ALICE, |s| s.offer_draw(at(12)))
        .expect("alice offers");
    app.call_as_account(BOB, BOB, |s| s.accept_draw(at(13)))
        .expect("bob accepts");
    let view = table_as(&mut app, BOB, at(14));
    assert_eq!(view.result, "1/2-1/2");
    assert_eq!(view.reason, "agreement");
}

#[test]
fn you_cannot_accept_your_own_draw_offer() {
    let mut app = seated();
    app.call_as_account(ALICE, ALICE, |s| s.offer_draw(at(3)))
        .expect("alice offers");
    assert!(app
        .call_as_account(ALICE, ALICE, |s| s.accept_draw(at(4)))
        .is_err());
    assert_eq!(table_as(&mut app, ALICE, at(5)).result, "*");
}

#[test]
fn a_threefold_draw_is_claimed_and_not_automatic() {
    let mut app = seated();
    // Knights out and back twice over: the start position occurs a third time.
    let shuffle = [
        (ALICE, "g1f3"),
        (BOB, "g8f6"),
        (ALICE, "f3g1"),
        (BOB, "f6g8"),
        (ALICE, "g1f3"),
        (BOB, "g8f6"),
        (ALICE, "f3g1"),
        (BOB, "f6g8"),
    ];
    for (step, (who, uci)) in shuffle.into_iter().enumerate() {
        play(&mut app, who, uci, at(10 + step as u64));
    }

    let view = table_as(&mut app, ALICE, at(30));
    assert_eq!(view.claimable_draw, "threefold");
    // Claimable is not claimed: the game is still on until someone says so.
    assert_eq!(view.result, "*");
    assert_eq!(view.status, "inProgress");

    app.call_as_account(ALICE, ALICE, |s| s.claim_draw(at(31)))
        .expect("alice claims");
    let view = table_as(&mut app, ALICE, at(32));
    assert_eq!(view.result, "1/2-1/2");
    assert_eq!(view.reason, "threefold");
}

#[test]
fn a_draw_cannot_be_claimed_out_of_a_position_that_does_not_allow_one() {
    let mut app = seated();
    play(&mut app, ALICE, "e2e4", at(3));
    assert!(app
        .call_as_account(BOB, BOB, |s| s.claim_draw(at(4)))
        .is_err());
}

#[test]
fn a_rematch_swaps_the_colours_and_needs_a_finished_game() {
    let mut app = seated();

    // Not while a game is on.
    assert!(app
        .call_as_account(ALICE, ALICE, |s| s.rematch(at(3)))
        .is_err());

    app.call_as_account(ALICE, ALICE, |s| s.resign(at(4)))
        .expect("alice resigns");
    let next = app
        .call_as_account(BOB, BOB, |s| s.rematch(at(5)))
        .expect("bob starts a rematch");
    assert_eq!(next, 1);

    let view = table_as(&mut app, ALICE, at(6));
    assert_eq!(view.game, 1);
    assert_eq!(view.result, "*");
    assert_eq!(view.moves.len(), 0);
    // Two games have existed, and the count has to say so: game 0 is implicit,
    // so counting the rows that record a game is one short of the truth. The
    // two-node scenario caught exactly this, because a single-node test can sit
    // at "game 1 of 1" and look plausible.
    assert_eq!(view.games_played, 2);
    // The chairs are unchanged; the COLOURS moved. Alice held `white` and now
    // plays Black.
    assert_eq!(view.my_color, "black");
    assert_eq!(view.white.name, "Bob");
    assert_eq!(view.black.name, "Alice");
    assert!(!view.my_turn);

    // Bob opens the new game, and game 0's record is untouched by it.
    play(&mut app, BOB, "e2e4", at(7));
    let history = app.view(|s| s.history()).expect("history");
    assert_eq!(history.len(), 2);
    assert_eq!(history[0].result, "0-1");
    assert_eq!(history[0].reason, "resignation");
    assert_eq!(history[1].result, "*");
    assert_eq!(history[1].plies, 1);
    assert_ne!(history[0].white, history[1].white);
    // Each game is stamped with when it actually began: the table's creation
    // for game 0, and the winning rematch claim for the ones after it. This
    // used to read a row keyed by the game index alone — a key nothing has
    // written since claims grew a nonce — so every entry came back 0.
    assert_eq!(history[0].started_at, at(0));
    assert_eq!(history[1].started_at, at(5));
}

#[test]
fn standing_up_is_allowed_before_the_first_move_and_not_after() {
    let mut app = seated();
    app.call_as_account(BOB, BOB, |s| s.stand(at(3)))
        .expect("bob leaves an unstarted game");
    assert!(table_as(&mut app, ALICE, at(4)).black.member.is_empty());

    // Carol takes the vacated chair and the game starts.
    app.call_as_account(CAROL, CAROL, |s| {
        s.sit("black".to_owned(), "Carol".to_owned(), at(5))
    })
    .expect("carol sits");
    play(&mut app, ALICE, "e2e4", at(6));

    assert!(app
        .call_as_account(CAROL, CAROL, |s| s.stand(at(7)))
        .is_err());
    assert!(app.call_as_account(BOB, BOB, |s| s.stand(at(8))).is_err());
}

#[test]
fn one_person_plays_from_two_devices() {
    // The whole reason identity here is the ACCOUNT and not the device: Alice
    // sits down on her laptop and moves from her phone. Keyed by device she
    // would read as a spectator on her own board.
    let mut app = seated();
    let from_phone = app.call_as_account(ALICE, ALICE_PHONE, |s| s.play("d2d4".to_owned(), at(3)));
    assert_eq!(from_phone.expect("her phone is still her"), "d4");

    app.set_account(ALICE);
    app.set_device(ALICE_PHONE);
    let view = app.view(|s| s.table(at(4))).expect("table");
    assert_eq!(view.my_color, "white");
    assert_eq!(view.white.name, "Alice");
}

#[test]
fn moves_carry_san_and_the_move_limit_is_enforced_by_ply() {
    let mut app = seated();
    play(&mut app, ALICE, "e2e4", at(3));
    play(&mut app, BOB, "c7c5", at(4));
    play(&mut app, ALICE, "g1f3", at(5));

    let view = table_as(&mut app, ALICE, at(6));
    let san: Vec<&str> = view.moves.iter().map(|m| m.san.as_str()).collect();
    assert_eq!(san, vec!["e4", "c5", "Nf3"]);
    // Plies are numbered from zero and are dense, which is what makes the map
    // key `<game>/<ply>` an ordering as well as an identity.
    let plies: Vec<u32> = view.moves.iter().map(|m| m.ply).collect();
    assert_eq!(plies, vec![0, 1, 2]);
    assert_eq!(view.moves[2].by, view.white.member);
}

#[test]
fn a_promotion_defaults_to_a_queen_when_the_client_names_nothing() {
    // A board UI that lets you drag a pawn onto the last rank without asking
    // sends `a7a8`. That is not UCI for a promotion, and refusing it would be
    // pedantry — it is a queening, which is what a player means by default.
    let mut app = TestHost::new(|| MeroChess::init("Endgame".to_owned(), at(0)));
    app.call_as_account(ALICE, ALICE, |s| {
        s.sit("white".to_owned(), "Alice".to_owned(), at(1))
    })
    .expect("alice sits");
    app.call_as_account(BOB, BOB, |s| {
        s.sit("black".to_owned(), "Bob".to_owned(), at(2))
    })
    .expect("bob sits");

    // Walk a pawn up the h-file — the opening moves are irrelevant, only that
    // the position is legal and reached through the contract.
    for (step, (who, uci)) in [
        (ALICE, "h2h4"),
        (BOB, "a7a5"),
        (ALICE, "h4h5"),
        (BOB, "a5a4"),
        (ALICE, "h5h6"),
        (BOB, "a8a5"),
        (ALICE, "h6g7"),
        (BOB, "a5b5"),
    ]
    .into_iter()
    .enumerate()
    {
        play(&mut app, who, uci, at(10 + step as u64));
    }

    let san = play(&mut app, ALICE, "g7h8", at(30));
    assert_eq!(san, "gxh8=Q");
    let view = table_as(&mut app, ALICE, at(31));
    assert_eq!(view.moves.last().expect("a move").uci, "g7h8q");
}

#[test]
fn presence_expires_and_a_call_refreshes_it() {
    let mut app = seated();
    // A minute after her last call, Alice reads as away.
    let stale = table_as(&mut app, ALICE, at(2) + 60_000);
    assert!(!stale.white.online);

    play(&mut app, ALICE, "e2e4", at(100));
    let fresh = table_as(&mut app, ALICE, at(100));
    assert!(fresh.white.online);

    app.call_as_account(ALICE, ALICE, |s| s.heartbeat(at(120)))
        .expect("heartbeat");
    assert!(table_as(&mut app, ALICE, at(120)).white.online);
}

#[test]
fn every_state_changing_call_emits_exactly_one_event() {
    let mut app = TestHost::new(|| MeroChess::init("Events".to_owned(), at(0)));
    let _initialized = app.take_events();

    app.call_as_account(ALICE, ALICE, |s| {
        s.sit("white".to_owned(), "Alice".to_owned(), at(1))
    })
    .expect("sit");
    let events = app.take_events();
    assert_eq!(events.len(), 1);
    assert_eq!(events[0].kind, "Seated");

    app.call_as_account(BOB, BOB, |s| {
        s.sit("black".to_owned(), "Bob".to_owned(), at(2))
    })
    .expect("sit");
    let _ = app.take_events();

    play(&mut app, ALICE, "e2e4", at(3));
    let events = app.take_events();
    assert_eq!(events.len(), 1);
    assert_eq!(events[0].kind, "Moved");

    // A heartbeat is silent on purpose: it runs every few seconds and would
    // otherwise wake every client in the context for nothing.
    app.call_as_account(ALICE, ALICE, |s| s.heartbeat(at(4)))
        .expect("heartbeat");
    assert!(app.take_events().is_empty());

    // A mating move announces the move AND the ending, so a client can react
    // without replaying the game itself.
    play(&mut app, BOB, "e7e5", at(5));
    play(&mut app, ALICE, "f1c4", at(6));
    play(&mut app, BOB, "b8c6", at(7));
    play(&mut app, ALICE, "d1h5", at(8));
    play(&mut app, BOB, "g8f6", at(9));
    let _ = app.take_events();
    play(&mut app, ALICE, "h5f7", at(10));
    let kinds: Vec<String> = app.take_events().into_iter().map(|e| e.kind).collect();
    assert_eq!(kinds, vec!["Moved".to_owned(), "GameEnded".to_owned()]);
}

#[test]
fn one_person_can_play_both_sides() {
    // Pass-and-play: one person, one node, a board they move for each side in
    // turn. It is how chess is played when the other person is in the room, and
    // it is the only way to use the app before anyone else has a node.
    let mut app = TestHost::new(|| MeroChess::init("Hot seat".to_owned(), at(0)));
    app.call_as_account(ALICE, ALICE, |s| {
        s.sit("white".to_owned(), "Alice".to_owned(), at(1))
    })
    .expect("alice takes white");
    app.call_as_account(ALICE, ALICE, |s| {
        s.sit("black".to_owned(), "Alice".to_owned(), at(2))
    })
    .expect("alice takes black too");

    let view = table_as(&mut app, ALICE, at(3));
    assert_eq!(view.status, "inProgress");
    // She is the side to move, whichever side that is — otherwise the board
    // would freeze after White's first move with nobody able to answer it.
    assert_eq!(view.my_color, "white");
    assert!(view.my_turn);

    play(&mut app, ALICE, "e2e4", at(4));
    let view = table_as(&mut app, ALICE, at(5));
    assert_eq!(view.my_color, "black");
    assert!(view.my_turn);

    play(&mut app, ALICE, "e7e5", at(6));
    assert_eq!(table_as(&mut app, ALICE, at(7)).my_color, "white");

    // And the game still ends the way any other game does.
    play(&mut app, ALICE, "d1h5", at(8));
    play(&mut app, ALICE, "b8c6", at(9));
    play(&mut app, ALICE, "f1c4", at(10));
    play(&mut app, ALICE, "g8f6", at(11));
    assert_eq!(play(&mut app, ALICE, "h5f7", at(12)), "Qxf7#");
    let view = table_as(&mut app, ALICE, at(13));
    assert_eq!(view.result, "1-0");
    assert_eq!(view.reason, "checkmate");
}

#[test]
fn a_spectator_is_neither_colour_and_can_do_nothing_but_watch() {
    let mut app = seated();
    play(&mut app, ALICE, "e2e4", at(3));

    let view = table_as(&mut app, CAROL, at(4));
    assert_eq!(view.my_color, "");
    assert!(!view.my_turn);
    // The position and the moves ARE visible: chess is a game of complete
    // information and this app does not pretend otherwise.
    assert_eq!(view.moves.len(), 1);
    assert!(!view.legal_moves.is_empty());

    // `play` returns the SAN it wrote, the rest return nothing, so the results
    // are mapped to a common shape rather than collected as-is.
    assert!(app
        .call_as_account(CAROL, CAROL, |s| s.play("e7e5".to_owned(), at(5)))
        .is_err());
    assert!(app
        .call_as_account(CAROL, CAROL, |s| s.resign(at(5)))
        .is_err());
    assert!(app
        .call_as_account(CAROL, CAROL, |s| s.offer_draw(at(5)))
        .is_err());
    assert!(app
        .call_as_account(CAROL, CAROL, |s| s.claim_draw(at(5)))
        .is_err());
    assert!(app
        .call_as_account(CAROL, CAROL, |s| s.stand(at(5)))
        .is_err());
}

// ── The merobox scenario, walked in-process ──────────────────────────────────
//
// `logic/workflows/play-a-game.yml` drives two real nodes through five games:
// a checkmate, an agreed draw with a declined offer before it, a claimed
// threefold, a resignation, and a chair given up. That run needs Docker, two
// containers and several minutes, and when it fails it fails as a merobox step
// name with no local stack.
//
// This walks the SAME order of calls in-process, as the same two people. It
// cannot prove anything the scenario exists to prove — nothing replicates here,
// there is no signing identity and no second store — but every rule the
// scenario depends on between those syncs is a rule this contract owns, and
// this is where getting one wrong shows up in a second instead of in CI.
// Keep the two in step: a step added there belongs here too.

#[test]
fn the_merobox_scenario_holds_as_a_sequence_of_rules() {
    let mut app = seated();

    // ── game 0: scholar's mate ───────────────────────────────────────────
    for (who, uci, san) in [
        (ALICE, "e2e4", "e4"),
        (BOB, "e7e5", "e5"),
        (ALICE, "f1c4", "Bc4"),
        (BOB, "b8c6", "Nc6"),
        (ALICE, "d1h5", "Qh5"),
        (BOB, "g8f6", "Nf6"),
        (ALICE, "h5f7", "Qxf7#"),
    ] {
        assert_eq!(play(&mut app, who, uci, at(10)), san);
    }
    let view = table_as(&mut app, BOB, at(11));
    assert_eq!(
        (view.result.as_str(), view.reason.as_str()),
        ("1-0", "checkmate")
    );

    // ── game 1: an offer declined, then one agreed ───────────────────────
    assert_eq!(
        app.call_as_account(BOB, BOB, |s| s.rematch(at(12)))
            .expect("bob starts game 1"),
        1
    );
    // Colours swapped, so Bob is White and offers first.
    app.call_as_account(BOB, BOB, |s| s.offer_draw(at(13)))
        .expect("bob offers");
    let view = table_as(&mut app, ALICE, at(14));
    assert_eq!(view.draw_offer_from, view.white.member);
    assert_ne!(view.draw_offer_from, view.me);

    app.call_as_account(ALICE, ALICE, |s| s.decline_draw(at(15)))
        .expect("alice declines");
    // The decline cannot delete Bob's row — it is his — so what makes it stick
    // is the reader, and this is the assertion that proves it did.
    assert!(app
        .call_as_account(ALICE, ALICE, |s| s.accept_draw(at(16)))
        .is_err());

    // A move retires the position the offer was made in; the next offer is a
    // new one, and this time it is accepted.
    assert_eq!(play(&mut app, BOB, "g1f3", at(17)), "Nf3");
    app.call_as_account(ALICE, ALICE, |s| s.offer_draw(at(18)))
        .expect("alice offers");
    app.call_as_account(BOB, BOB, |s| s.accept_draw(at(19)))
        .expect("bob accepts");
    let view = table_as(&mut app, ALICE, at(20));
    assert_eq!(
        (
            view.result.as_str(),
            view.reason.as_str(),
            view.status.as_str()
        ),
        ("1/2-1/2", "agreement", "finished")
    );

    // ── game 2: a threefold, claimed ─────────────────────────────────────
    assert_eq!(
        app.call_as_account(ALICE, ALICE, |s| s.rematch(at(21)))
            .expect("alice starts game 2"),
        2
    );
    for (step, (who, uci)) in [
        (ALICE, "g1f3"),
        (BOB, "g8f6"),
        (ALICE, "f3g1"),
        (BOB, "f6g8"),
        (ALICE, "g1f3"),
        (BOB, "g8f6"),
        (ALICE, "f3g1"),
        (BOB, "f6g8"),
    ]
    .into_iter()
    .enumerate()
    {
        play(&mut app, who, uci, at(22 + step as u64));
    }
    let view = table_as(&mut app, BOB, at(31));
    assert_eq!(view.claimable_draw, "threefold");
    assert_eq!(view.result, "*");
    app.call_as_account(ALICE, ALICE, |s| s.claim_draw(at(32)))
        .expect("alice claims");
    let view = table_as(&mut app, BOB, at(33));
    assert_eq!(
        (view.result.as_str(), view.reason.as_str()),
        ("1/2-1/2", "threefold")
    );

    // ── game 3: a resignation ────────────────────────────────────────────
    assert_eq!(
        app.call_as_account(BOB, BOB, |s| s.rematch(at(34)))
            .expect("bob starts game 3"),
        3
    );
    // Odd game, so Alice — who holds the WHITE chair — is playing Black, and
    // giving up hands the game to White. The colour swap is the thing that
    // could quietly reverse this.
    app.call_as_account(ALICE, ALICE, |s| s.resign(at(35)))
        .expect("alice resigns");
    let view = table_as(&mut app, BOB, at(36));
    assert_eq!(
        (view.result.as_str(), view.reason.as_str()),
        ("1-0", "resignation")
    );

    // ── game 4: a chair given up, and taken ──────────────────────────────
    assert_eq!(
        app.call_as_account(ALICE, ALICE, |s| s.rematch(at(37)))
            .expect("alice starts game 4"),
        4
    );
    app.call_as_account(ALICE, ALICE, |s| s.stand(at(38)))
        .expect("alice stands");
    let view = table_as(&mut app, BOB, at(39));
    assert_eq!(view.status, "awaitingPlayers");
    assert!(view.white.member.is_empty());
    assert!(view.white.name.is_empty());
    assert!(!view.white.online);
    assert_eq!(view.black.name, "Bob");

    // Free rather than merely blank.
    app.call_as_account(BOB, BOB, |s| {
        s.sit("white".to_owned(), "Bob".to_owned(), at(40))
    })
    .expect("bob takes the empty chair");
    let view = table_as(&mut app, BOB, at(41));
    assert_eq!(view.status, "inProgress");
    assert!(view.my_turn);
    assert_eq!(view.white.name, "Bob");
    assert_eq!(view.black.name, "Bob");

    // ── presence ─────────────────────────────────────────────────────────
    app.call_as_account(ALICE, ALICE, |s| s.heartbeat(at(42)))
        .expect("alice heartbeats");
    app.call_as_account(BOB, BOB, |s| s.heartbeat(at(42)))
        .expect("bob heartbeats");
    let view = table_as(&mut app, BOB, at(43));
    assert!(view.white.online && view.black.online);
    // Presence expires rather than latching: the same state, a later clock.
    let view = table_as(&mut app, BOB, at(43) + PRESENCE_TTL_MS + 1_000);
    assert!(!view.white.online && !view.black.online);
}

// ── What a member can write, and what a reader believes ─────────────────────
//
// A peer's node folds an incoming delta into storage without executing this
// contract, so `play`'s refusals bind only the node that runs them. These tests
// write rows STRAIGHT INTO the maps under another account — which is what a
// patched node does — and assert that no reader is fooled by them.
//
// This is deliberately not a `converge_app` suite. That harness cannot carry
// `StorageType::User` entries at all ("`Shared` / `Authored` / `User` /
// `Frozen` storage need the node's signing identity … test those with merobox
// workflows"), which is also why the two-node scenario in `logic/workflows/`
// now carries the weight of proving authored state replicates. What is testable
// HERE is the half this contract owns: the reader's selection rules.

use crate::{claim_key, move_key, seat_key, DrawOffer, Ending, GameRecord, MoveRecord, Seat};

/// A move row, written straight into the map the way a forger would.
///
/// Two fields is the whole surface a writer controls: the move, and a clock
/// that only ever orders that writer's own rows. Which game, which ply, who
/// played it and how it reads in notation are all the reader's arithmetic, so
/// there is nothing here to lie with.
fn forged_move(uci: &str) -> MoveRecord {
    MoveRecord {
        uci: uci.to_owned(),
        at: at(0),
    }
}

/// The member id the contract derives for an account.
///
/// Asked of the contract rather than formatted here, so a test cannot quietly
/// disagree with `caller_id` about what an account is called. Takes the live
/// host because only one may exist per thread.
fn hex_id(app: &mut TestHost<MeroChess>, account: [u8; 32]) -> String {
    table_as(app, account, at(0)).me
}

#[test]
fn a_move_row_written_by_anyone_but_the_player_to_move_is_inert() {
    let mut app = seated();
    let white = table_as(&mut app, ALICE, at(3)).white.member;

    // Carol is a spectator. She writes a perfectly legal opening move into the
    // slot White is expected to fill — under her own account, because that is
    // the only thing she can sign for.
    app.call_as_account(CAROL, CAROL, |s| {
        let record = forged_move("e2e4");
        let _written = s.moves.insert(move_key(0, 0, &white, at(3)), record);
    });

    // The board never saw it.
    let view = table_as(&mut app, ALICE, at(4));
    assert!(view.moves.is_empty());
    assert_eq!(
        view.fen,
        "rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBNR w KQkq - 0 1"
    );
    assert!(view.my_turn);

    // And it did not cost Alice her move: she writes at a key of her own.
    assert_eq!(play(&mut app, ALICE, "d2d4", at(5)), "d4");
    let view = table_as(&mut app, BOB, at(6));
    assert_eq!(view.moves.len(), 1);
    assert_eq!(view.moves[0].san, "d4");
}

#[test]
fn a_squatted_key_costs_a_nonce_and_not_a_turn() {
    // The key Alice's first move would land on, taken by somebody else before
    // she gets there. Without a nonce in the key this wedges the table
    // permanently — `AuthoredMap::insert` refuses an occupied key and only its
    // owner may update it — and any context member, spectator included, could
    // kill every game at the table this way.
    let mut app = seated();
    let white = table_as(&mut app, ALICE, at(3)).white.member;
    let contested = move_key(0, 0, &white, at(4));

    app.call_as_account(CAROL, CAROL, |s| {
        let _squatted = s.moves.insert(contested.clone(), forged_move("e2e4"));
    });

    assert_eq!(play(&mut app, ALICE, "e2e4", at(4)), "e4");
    let view = table_as(&mut app, ALICE, at(5));
    assert_eq!(view.moves.len(), 1);
    assert_eq!(view.side_to_move, "black");
}

#[test]
fn a_row_at_a_ply_the_game_has_not_reached_is_inert() {
    // Ply numbering is the reader's arithmetic, so a row parked further up the
    // sequence is not "the next move" — it is nothing until the game arrives at
    // its ply, and then only if its author is the player to move.
    let mut app = seated();
    let white = table_as(&mut app, ALICE, at(3)).white.member;

    app.call_as_account(ALICE, ALICE, |s| {
        let _written = s
            .moves
            .insert(move_key(0, 8, &white, at(3)), forged_move("e2e4"));
    });

    assert!(table_as(&mut app, ALICE, at(4)).moves.is_empty());
}

#[test]
fn the_scoresheet_is_derived_and_not_transcribed() {
    // Bob writes a move he is entitled to write, but around the contract:
    // straight into the map, with nothing on the row but the move itself.
    // Everything the scoresheet shows for it — the ply, the notation, whose
    // move it was — the reader works out, so a row cannot describe a different
    // game than the one it is part of.
    let mut app = seated();
    play(&mut app, ALICE, "e2e4", at(3));
    let view = table_as(&mut app, BOB, at(4));
    let (white, black) = (view.white.member, view.black.member);

    app.call_as_account(BOB, BOB, |s| {
        let _written = s
            .moves
            .insert(move_key(0, 1, &black, at(5)), forged_move("e7e5"));
    });

    let view = table_as(&mut app, ALICE, at(6));
    assert_eq!(view.moves.len(), 2);
    assert_eq!(view.moves[1].san, "e5");
    assert_eq!(view.moves[1].ply, 1);
    // Attribution follows the ply, which follows the key the row sat under.
    assert_eq!(view.moves[0].by, white);
    assert_eq!(view.moves[1].by, black);
    assert_eq!(view.result, "*");
}

#[test]
fn a_resignation_nobody_could_have_made_is_not_believed() {
    let mut app = seated();
    play(&mut app, ALICE, "e2e4", at(3));
    let white = table_as(&mut app, ALICE, at(4)).white.member;
    let black = table_as(&mut app, ALICE, at(4)).black.member;

    // Bob writes Alice's resignation. He cannot sign as her, so the row is
    // stamped with his account and the reader drops it before looking at what
    // it says.
    app.call_as_account(BOB, BOB, |s| {
        let _written = s.endings.insert(
            claim_key(0, &white, at(5)),
            Ending {
                result: "0-1".to_owned(),
                reason: "resignation".to_owned(),
                ply: 1,
                at: at(5),
            },
        );
    });
    assert_eq!(table_as(&mut app, ALICE, at(6)).result, "*");

    // And a resignation Bob writes under his OWN account still has to be a
    // resignation: one that hands him the win is not one.
    app.call_as_account(BOB, BOB, |s| {
        let _written = s.endings.insert(
            claim_key(0, &black, at(7)),
            Ending {
                result: "0-1".to_owned(),
                reason: "resignation".to_owned(),
                ply: 1,
                at: at(7),
            },
        );
    });
    assert_eq!(table_as(&mut app, ALICE, at(8)).result, "*");

    // The real thing, through the contract, is believed.
    app.call_as_account(BOB, BOB, |s| s.resign(at(9)))
        .expect("bob resigns");
    let view = table_as(&mut app, ALICE, at(10));
    assert_eq!(view.result, "1-0");
    assert_eq!(view.reason, "resignation");
}

#[test]
fn an_agreed_draw_needs_an_offer_that_actually_stood() {
    // "Agreement" is two acts. Bob writing the agreement alone is Bob writing
    // down a wish, and the reader can tell because the other half — Alice's
    // open offer at that ply — is not there.
    let mut app = seated();
    play(&mut app, ALICE, "e2e4", at(3));
    let black = table_as(&mut app, BOB, at(4)).black.member;

    app.call_as_account(BOB, BOB, |s| {
        let _written = s.endings.insert(
            claim_key(0, &black, at(5)),
            Ending {
                result: "1/2-1/2".to_owned(),
                reason: "agreement".to_owned(),
                ply: 1,
                at: at(5),
            },
        );
    });
    assert_eq!(table_as(&mut app, ALICE, at(6)).result, "*");

    // With a real offer standing, the same ending is exactly what an accepted
    // draw looks like.
    app.call_as_account(ALICE, ALICE, |s| s.offer_draw(at(7)))
        .expect("alice offers");
    assert_eq!(table_as(&mut app, ALICE, at(8)).result, "1/2-1/2");
}

#[test]
fn a_claimed_draw_has_to_be_available_in_the_position() {
    let mut app = seated();
    play(&mut app, ALICE, "e2e4", at(3));
    let black = table_as(&mut app, BOB, at(4)).black.member;

    app.call_as_account(BOB, BOB, |s| {
        let _written = s.endings.insert(
            claim_key(0, &black, at(5)),
            Ending {
                result: "1/2-1/2".to_owned(),
                reason: "threefold".to_owned(),
                ply: 1,
                at: at(5),
            },
        );
    });

    // One move into a game, nothing has repeated. The reader works that out
    // from the moves rather than taking the row's word for it.
    assert_eq!(table_as(&mut app, ALICE, at(6)).result, "*");
}

#[test]
fn a_seat_claim_filed_on_someone_elses_behalf_moves_no_chair() {
    let mut app = TestHost::new(|| MeroChess::init("Forged seats".to_owned(), at(0)));
    let alice = hex_id(&mut app, ALICE);

    // Carol writes a claim that says Alice holds White. Her account is on the
    // row, so the two disagree and the claim is not a claim.
    app.call_as_account(CAROL, CAROL, |s| {
        let _written = s.seat_claims.insert(
            seat_key("white", &alice, at(1)),
            Seat {
                member: alice.clone(),
                name: "Alice".to_owned(),
                claimed_at: at(1),
            },
        );
    });
    assert!(table_as(&mut app, ALICE, at(2)).white.member.is_empty());

    // Alice sitting down for herself works, and is not blocked by the forgery.
    app.call_as_account(ALICE, ALICE, |s| {
        s.sit("white".to_owned(), "Alice".to_owned(), at(3))
    })
    .expect("alice sits");
    assert_eq!(table_as(&mut app, ALICE, at(4)).white.name, "Alice");
}

#[test]
fn a_rematch_nobody_at_the_table_claimed_starts_no_game() {
    let mut app = seated();
    let carol = hex_id(&mut app, CAROL);

    // A spectator claiming a rematch of a game that is not even finished. Two
    // independent reasons the reader counts it as nothing — and the game index
    // is COUNTED rather than read, so a row cannot move the table to an empty
    // board and hide the real game behind it.
    app.call_as_account(CAROL, CAROL, |s| {
        let _written = s.games.insert(
            claim_key(1, &carol, at(3)),
            GameRecord {
                index: 1,
                started_at: at(3),
            },
        );
    });

    let view = table_as(&mut app, ALICE, at(4));
    assert_eq!(view.game, 0);
    // One game, and the forged row has not inflated the count either — it is
    // derived from the index the reader counted, not from how many rows exist.
    assert_eq!(view.games_played, 1);
    assert_eq!(view.status, "inProgress");
}

#[test]
fn a_draw_offer_from_a_spectator_is_not_an_offer() {
    let mut app = seated();
    play(&mut app, ALICE, "e2e4", at(3));
    let carol = hex_id(&mut app, CAROL);

    app.call_as_account(CAROL, CAROL, |s| {
        let _written = s.draw_offers.insert(
            claim_key(0, &carol, at(4)),
            DrawOffer {
                open: true,
                declined: false,
                ply: 1,
                at: at(4),
            },
        );
    });

    // Neither player is shown an offer, and neither can accept one.
    assert!(table_as(&mut app, BOB, at(5)).draw_offer_from.is_empty());
    assert!(app
        .call_as_account(BOB, BOB, |s| s.accept_draw(at(6)))
        .is_err());
}

#[test]
fn a_map_stuffed_with_junk_still_reads_as_the_game_that_was_played() {
    // The other tests here ask whether a forged row changes the ANSWER. This
    // one asks what it costs to get the answer at all, which turned out to be
    // the sharper question: rows are something any member can add and only
    // their own author can remove, so junk accumulates permanently and every
    // honest node pays to skip it on every read.
    //
    // A thousand rows spread over the plies this game actually reaches, under
    // an account that holds no chair.
    let mut app = seated();
    app.call_as_account(CAROL, CAROL, |s| {
        for i in 0..1_000u64 {
            let _written = s.moves.insert(
                move_key(0, (i % 8) as u32, "deadbeef", i),
                MoveRecord {
                    uci: "e2e4".to_owned(),
                    at: i,
                },
            );
        }
    });

    for (who, uci, san) in [
        (ALICE, "e2e4", "e4"),
        (BOB, "e7e5", "e5"),
        (ALICE, "g1f3", "Nf3"),
        (BOB, "b8c6", "Nc6"),
    ] {
        assert_eq!(play(&mut app, who, uci, at(10)), san);
    }

    let view = table_as(&mut app, ALICE, at(20));
    assert_eq!(view.moves.len(), 4);
    assert_eq!(view.moves[3].san, "Nc6");
    assert_eq!(view.side_to_move, "white");
    assert_eq!(view.result, "*");
}
