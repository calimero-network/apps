//! Perft: the standard proof that a move generator is actually correct.
//!
//! Counting leaf nodes of the move tree to a fixed depth from a known position
//! is the only test that catches the whole class of bugs unit tests miss — a
//! castling right that survives a rook capture, an en-passant capture that
//! exposes the king, a promotion that generates one move instead of four. Each
//! of those changes the count by a knowable amount and nothing else notices.
//!
//! The numbers below are the published ones from the Chess Programming Wiki's
//! perft results page; the positions are its standard five. They are not
//! derived from this implementation, which is the point: they are an
//! independent oracle, so a wrong generator cannot agree with them by
//! construction.
//!
//! Depths are chosen to keep the whole file under a few seconds in a debug
//! build, because `cargo test --workspace` runs it unoptimised in CI.

use mero_chess::board::Position;
use mero_chess::movegen::legal_moves;

fn perft(pos: &Position, depth: u32) -> u64 {
    if depth == 0 {
        return 1;
    }
    let moves = legal_moves(pos);
    if depth == 1 {
        return moves.len() as u64;
    }
    moves
        .into_iter()
        .map(|mv| perft(&pos.apply(mv), depth - 1))
        .sum()
}

fn assert_perft(fen: &str, expected: &[(u32, u64)]) {
    let pos = Position::from_fen(fen).expect("the fixture FEN parses");
    for &(depth, want) in expected {
        assert_eq!(perft(&pos, depth), want, "perft({depth}) of {fen}");
    }
}

/// The starting array. Depth 4 is 197 281 leaves.
#[test]
fn perft_initial_position() {
    assert_perft(
        "rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBNR w KQkq - 0 1",
        &[(1, 20), (2, 400), (3, 8_902), (4, 197_281)],
    );
}

/// "Kiwipete" — the position every generator is tested against, because it has
/// castling for both sides, pins, and captures everywhere. A generator that is
/// wrong about castling rights fails here and nowhere else.
#[test]
fn perft_kiwipete() {
    assert_perft(
        "r3k2r/p1ppqpb1/bn2pnp1/3PN3/1p2P3/2N2Q1p/PPPBBPPP/R3K2R w KQkq - 0 1",
        &[(1, 48), (2, 2_039), (3, 97_862)],
    );
}

/// Position 3: sparse, and full of en-passant and promotion edge cases —
/// including the pin along the fifth rank that makes one en-passant capture
/// illegal.
#[test]
fn perft_position_three() {
    assert_perft(
        "8/2p5/3p4/KP5r/1R3p1k/8/4P1P1/8 w - - 0 1",
        &[(1, 14), (2, 191), (3, 2_812), (4, 43_238)],
    );
}

/// Position 4: promotions with check, from both sides (the mirrored form has
/// the same counts, which is itself a useful symmetry check).
#[test]
fn perft_position_four() {
    assert_perft(
        "r3k2r/Pppp1ppp/1b3nbN/nP6/BBP1P3/q4N2/Pp1P2PP/R2Q1RK1 w kq - 0 1",
        &[(1, 6), (2, 264), (3, 9_467)],
    );
    assert_perft(
        "r2q1rk1/pP1p2pp/Q4n2/bbp1p3/Np6/1B3NBn/pPPP1PPP/R3K2R b KQ - 0 1",
        &[(1, 6), (2, 264), (3, 9_467)],
    );
}

/// Position 5: the one that catches a generator which forgets that castling
/// rights can be lost by capture.
#[test]
fn perft_position_five() {
    assert_perft(
        "rnbq1k1r/pp1Pbppp/2p5/8/2B5/8/PPP1NnPP/RNBQK2R w KQ - 1 8",
        &[(1, 44), (2, 1_486), (3, 62_379)],
    );
}
