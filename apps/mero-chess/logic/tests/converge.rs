//! Two replicas, concurrent writes, one root hash.
//!
//! ## Why this file came back
//!
//! It was deleted when every map in this contract became an `AuthoredMap`,
//! because `converge_app` could not carry authored state: each replica's
//! "device key" was made-up bytes rather than a real keypair, so every signed
//! action failed verification on receipt — and a refused action is *dropped*
//! rather than raised, leaving each replica holding only its own local writes.
//! Values individually correct, roots different, indistinguishable from a CRDT
//! bug (core#3965).
//!
//! core fixed that in 2026-09: replicas hold real ed25519 keys, the harness
//! signs each captured delta the way `calimero-context` does, and a dropped
//! action now fails the run instead of passing it quietly. `Shared`,
//! `Authored`, `User` and `Frozen` storage are all covered as of the rc.43 the
//! workspace pins. What is still outside it is the causal cut —
//! `effective_writers` is always `None` — so anything about writer-set rotation
//! ORDERING still belongs in merobox. Nothing here depends on that.
//!
//! ## What it proves that the other suites cannot
//!
//! `src/tests.rs` drives one store: it can show a forged row is ignored, but
//! never that two stores agree. `workflows/play-a-game.yml` shows two real
//! nodes agreeing, but it is a sequence — node-1 moves, node-2 waits, node-2
//! answers — so no two writes are ever genuinely concurrent.
//!
//! This is the missing case: both replicas write the SAME thing at the SAME
//! moment without having seen each other. That is the one shape a chess table
//! has to survive and cannot avoid — two people reaching for the same chair,
//! one person moving from two devices — and the assertion is root-hash
//! equality, which is what production sync actually relies on.

use calimero_storage::testing::converge_app;
use mero_chess::MeroChess;

/// The clock every op passes. A constant on purpose: it makes the writes
/// genuinely simultaneous, which is the case worth testing. Ties then fall to
/// the canonical encoding, and both replicas have to break them identically or
/// the hashes diverge.
const NOW: u64 = 1_700_000_000_000;

fn table() -> impl Fn() -> MeroChess {
    || MeroChess::init("Converging table".to_owned(), NOW)
}

#[test]
fn two_people_reaching_for_the_same_chair_land_on_one_holder() {
    // Both replicas run both ops, each under its own account, and neither has
    // seen the other. So each chair ends up with two claims from two different
    // people stamped at the same instant — the contended case a real table hits
    // whenever two people open the invite link together.
    //
    // The reader elects the earliest claim and breaks the tie on the canonical
    // encoding, so the outcome is not "first to arrive" (there is no such
    // thing here) but "the same one everywhere".
    converge_app(table())
        .replicas(2)
        .ops(|s| {
            let _ = s.sit("white".to_owned(), "Player".to_owned(), NOW);
        })
        .ops(|s| {
            let _ = s.sit("black".to_owned(), "Player".to_owned(), NOW);
        })
        .invariant("both chairs resolve to exactly one holder", |s| {
            let view = s.table(NOW).expect("table");
            !view.white.member.is_empty() && !view.black.member.is_empty()
        })
        .invariant("a contested chair is not shared", |s| {
            let view = s.table(NOW).expect("table");
            // One holder per chair, never a merged value made of both claims.
            view.white.name == "Player" && view.black.name == "Player"
        })
        .invariant("the table is playable", |s| {
            s.table(NOW).expect("table").status == "inProgress"
        })
        .assert_all_replicas_equal();
}

#[test]
fn one_person_on_two_devices_plays_one_move_and_not_two() {
    // `one_account` is the point: both replicas write as the SAME person, which
    // is a laptop and a phone, not two players. The owner stamp covers both
    // devices — so unlike the test above, these writes land on the same KEY and
    // have to be reconciled by `MoveRecord::merge` rather than by the reader's
    // election. Nothing else in this repo exercises that merge.
    converge_app(table())
        .replicas(2)
        .one_account()
        .ops(|s| {
            let _ = s.sit("white".to_owned(), "Solo".to_owned(), NOW);
        })
        .ops(|s| {
            let _ = s.sit("black".to_owned(), "Solo".to_owned(), NOW);
        })
        .ops(|s| {
            let _ = s.play("e2e4".to_owned(), NOW);
        })
        .invariant("the same move from two devices is one move", |s| {
            s.table(NOW).expect("table").moves.len() == 1
        })
        .invariant("and it is the move that was played", |s| {
            let view = s.table(NOW).expect("table");
            view.moves[0].san == "e4" && view.side_to_move == "black"
        })
        .invariant("the game is still on", |s| {
            s.table(NOW).expect("table").result == "*"
        })
        .assert_all_replicas_equal();
}

#[test]
fn concurrent_endings_resolve_to_one_result() {
    // Both players resign at the same instant, each without seeing the other.
    // Two valid endings, written by two different people under two different
    // keys, both re-derivable — so the reader cannot discard either and has to
    // CHOOSE. It takes the earliest, ties broken on the encoding, and the only
    // thing that matters is that every replica chooses the same one: a table
    // where the two players see opposite results is worse than one that hangs.
    converge_app(table())
        .replicas(2)
        .ops(|s| {
            let _ = s.sit("white".to_owned(), "Player".to_owned(), NOW);
        })
        .ops(|s| {
            let _ = s.sit("black".to_owned(), "Player".to_owned(), NOW);
        })
        .ops(|s| {
            let _ = s.resign(NOW);
        })
        .invariant("the game ended, by resignation", |s| {
            let view = s.table(NOW).expect("table");
            view.status == "finished" && view.reason == "resignation"
        })
        .invariant("with a decisive result, not a merged one", |s| {
            let result = s.table(NOW).expect("table").result;
            result == "1-0" || result == "0-1"
        })
        .assert_all_replicas_equal();
}
