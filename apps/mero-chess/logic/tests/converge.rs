//! Convergence: what happens when two nodes write at the same moment.
//!
//! `converge_app` runs N replicas, applies EVERY registered op on EVERY replica
//! in a per-replica shuffled order, gossips the deltas and then asserts the
//! replicas are byte-identical. That is the interleaving a merobox scenario is
//! worst at reaching reliably and the one a chess table actually meets: two
//! people pressing a button in the same second, or one person doing it on a
//! phone and a laptop at once.
//!
//! `assert_all_replicas_equal()` alone would not be enough. A rule that loses
//! data deterministically converges too — every replica agrees on the same
//! wrong answer — so each test also states an `.invariant(..)` about what the
//! surviving state must SAY.

use calimero_sdk::testing::with_identity;
use calimero_storage::testing::converge_app;
use mero_chess::MeroChess;
use serial_test::serial;

const ALICE: [u8; 32] = [0xA1; 32];
const BOB: [u8; 32] = [0xB0; 32];

const T0: u64 = 1_700_000_000_000;

/// A table with Alice on White and Bob on Black, built identically on every
/// replica so the seats are not themselves the thing under test.
///
/// `with_identity` is what makes that possible: `converge_app` gives each
/// replica its own writer identity (which is the point), and these two calls
/// need to be the same two PEOPLE everywhere.
fn seated_table() -> MeroChess {
    let mut state = MeroChess::init("Convergence".to_owned(), T0);
    with_identity(ALICE, ALICE, || {
        let _seated = state.sit("white".to_owned(), "Alice".to_owned(), T0 + 1);
    });
    with_identity(BOB, BOB, || {
        let _seated = state.sit("black".to_owned(), "Bob".to_owned(), T0 + 2);
    });
    state
}

/// The table as the contract itself reports it, for use inside an invariant.
fn view(state: &MeroChess) -> mero_chess::TableView {
    state.table(T0 + 10_000).expect("table")
}

#[test]
#[serial]
fn concurrent_claims_on_one_seat_leave_exactly_one_holder() {
    // Three unrelated people (the default is one account per replica) all reach
    // for White in the same instant.
    converge_app(|| MeroChess::init("Seat race".to_owned(), T0))
        .replicas(3)
        .ops(|state| {
            let _claimed = state.sit("white".to_owned(), "Player".to_owned(), T0 + 5);
        })
        .invariant("exactly one player holds White", |state| {
            let table = view(state);
            !table.white.member.is_empty() && table.black.member.is_empty()
        })
        .invariant("the holder is a real, seated player", |state| {
            let table = view(state);
            table
                .players
                .iter()
                .any(|p| p.id == table.white.member && p.color == "white")
        })
        .assert_all_replicas_equal();
}

#[test]
#[serial]
fn two_people_taking_different_seats_both_survive() {
    // Different keys, so this is a union rather than a race — and it is worth
    // pinning, because a seat map that resolved whole-map last-writer-wins
    // would silently drop one of the two.
    converge_app(seated_table)
        .replicas(3)
        .ops(|state| {
            let _touched = state.heartbeat(T0 + 6);
        })
        .invariant("both chairs survived", |state| {
            let table = view(state);
            table.white.name == "Alice" && table.black.name == "Bob"
        })
        .invariant("the table is playable", |state| {
            view(state).status == "inProgress"
        })
        .assert_all_replicas_equal();
}

#[test]
#[serial]
fn two_moves_racing_for_the_same_ply_resolve_to_one_move() {
    // One person, two devices: Alice's phone and laptop each send a first move
    // before either has seen the other. Both are legal at the moment they are
    // played, and both claim ply 0.
    //
    // This is the case the whole storage design is for. A stored BOARD would
    // merge field by field into a position neither move produced; a move list
    // keyed by ply resolves to ONE record by a total order, and every replica
    // picks the same one.
    converge_app(seated_table)
        .replicas(3)
        .ops(|state| {
            with_identity(ALICE, ALICE, || {
                let _played = state.play("e2e4".to_owned(), T0 + 20);
            });
        })
        .ops(|state| {
            with_identity(ALICE, ALICE, || {
                let _played = state.play("d2d4".to_owned(), T0 + 20);
            });
        })
        .invariant("exactly one move was played", |state| {
            view(state).moves.len() == 1
        })
        .invariant("the surviving move is one of the two", |state| {
            let table = view(state);
            matches!(
                table.moves.first().map(|m| m.uci.as_str()),
                Some("e2e4" | "d2d4")
            )
        })
        .invariant("it is Black's turn, once", |state| {
            let table = view(state);
            table.side_to_move == "black" && table.moves[0].ply == 0
        })
        .invariant("the position matches the move that survived", |state| {
            let table = view(state);
            let expected = match table.moves[0].uci.as_str() {
                "e2e4" => "rnbqkbnr/pppppppp/8/8/4P3/8/PPPP1PPP/RNBQKBNR b KQkq e3 0 1",
                _ => "rnbqkbnr/pppppppp/8/8/3P4/8/PPP1PPPP/RNBQKBNR b KQkq d3 0 1",
            };
            table.fen == expected
        })
        .assert_all_replicas_equal();
}

#[test]
#[serial]
fn a_game_ended_twice_at_once_ends_exactly_once() {
    // Alice resigns while Bob resigns — each valid against the state its own
    // node could see. One ending has to win, the same one everywhere, or the
    // two players would read opposite results off the same game forever.
    converge_app(seated_table)
        .replicas(3)
        .ops(|state| {
            with_identity(ALICE, ALICE, || {
                let _resigned = state.resign(T0 + 30);
            });
        })
        .ops(|state| {
            with_identity(BOB, BOB, || {
                let _resigned = state.resign(T0 + 31);
            });
        })
        .invariant("the game is decided", |state| {
            let table = view(state);
            table.status == "finished" && table.reason == "resignation"
        })
        .invariant("with one of the two results, not both", |state| {
            matches!(view(state).result.as_str(), "1-0" | "0-1")
        })
        .assert_all_replicas_equal();
}

#[test]
#[serial]
fn two_rematches_started_at_once_produce_one_new_game() {
    converge_app(|| {
        let mut state = seated_table();
        with_identity(ALICE, ALICE, || {
            let _resigned = state.resign(T0 + 3);
        });
        state
    })
    .replicas(3)
    .ops(|state| {
        with_identity(ALICE, ALICE, || {
            let _started = state.rematch(T0 + 40);
        });
    })
    .ops(|state| {
        with_identity(BOB, BOB, || {
            let _started = state.rematch(T0 + 41);
        });
    })
    .invariant("exactly one rematch exists", |state| {
        let table = view(state);
        table.game == 1 && table.games_played == 2
    })
    .invariant("the new game is fresh and the colours swapped", |state| {
        let table = view(state);
        table.moves.is_empty() && table.result == "*" && table.white.name == "Bob"
    })
    .invariant("the finished game kept its result", |state| {
        state
            .history()
            .expect("history")
            .first()
            .is_some_and(|g| g.result == "0-1" && g.reason == "resignation")
    })
    .assert_all_replicas_equal();
}

#[test]
#[serial]
fn a_draw_offer_and_a_move_crossing_on_the_wire_leave_a_consistent_table() {
    // Bob offers a draw for the position at ply 0 while Alice plays into ply 1.
    // Whichever order a replica applies them in, the offer must not still be
    // standing over a position it was never made in.
    converge_app(seated_table)
        .replicas(3)
        .ops(|state| {
            with_identity(BOB, BOB, || {
                let _offered = state.offer_draw(T0 + 50);
            });
        })
        .ops(|state| {
            with_identity(ALICE, ALICE, || {
                let _played = state.play("e2e4".to_owned(), T0 + 51);
            });
        })
        .invariant("the move landed", |state| view(state).moves.len() == 1)
        .invariant(
            "no offer stands over a position it was not made in",
            |state| {
                let table = view(state);
                table.draw_offer_from.is_empty()
            },
        )
        .invariant("the game is still on", |state| view(state).result == "*")
        .assert_all_replicas_equal();
}
