//! The contract's own rules: who may sit, who may move, and what ends a game.
//!
//! These drive `MeroChess` through `TestHost` — real CRDT state, real merges,
//! no node and no wasm — as two different PEOPLE, because that is the axis
//! every rule here is about. `call_as_account` moves the account and the device
//! together; `call_as` alone moves only the device, which is the same person on
//! a second machine and is tested separately at the bottom.

use calimero_sdk::testing::TestHost;

use crate::{MeroChess, TableView};

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
