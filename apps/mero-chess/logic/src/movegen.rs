//! Legal move generation, check detection and the terminal conditions.
//!
//! Legality is decided the simple way: generate pseudo-legal moves from
//! geometry, apply each to a copy of the position, and keep the ones that do
//! not leave the mover's own king attacked. Pins, discovered checks and "you
//! may not castle out of, through or into check" all fall out of that single
//! rule instead of needing three special cases each — which is the difference
//! between a rules engine a reviewer can verify and one that is merely tested.
//!
//! The cost is a position copy per candidate move. At a few dozen moves per
//! position and a few hundred plies per game that is nothing, and `perft`
//! against the published node counts (see `tests/perft.rs`) is what proves the
//! geometry itself.

use crate::board::{
    file_of, rank_of, square_at, Color, Move, Piece, PieceKind, Position, Square, BLACK_KING_SIDE,
    BLACK_QUEEN_SIDE, WHITE_KING_SIDE, WHITE_QUEEN_SIDE,
};

/// How a game ended, or that it has not.
///
/// Split into "the game is over whatever anyone says" and "a player may claim
/// a draw" deliberately — FIDE's threefold repetition and fifty-move rule are
/// CLAIMS, while fivefold and seventy-five-move are automatic. Treating a
/// claimable draw as automatic ends games nobody agreed to end.
#[derive(Clone, Copy, PartialEq, Eq, Debug)]
pub enum Outcome {
    Checkmate {
        winner: Color,
    },
    Stalemate,
    InsufficientMaterial,
    /// 75 moves by each side with no capture and no pawn move.
    SeventyFiveMove,
    /// The same position, to move and with the same rights, five times.
    FivefoldRepetition,
}

const KNIGHT_STEPS: [(i8, i8); 8] = [
    (1, 2),
    (2, 1),
    (2, -1),
    (1, -2),
    (-1, -2),
    (-2, -1),
    (-2, 1),
    (-1, 2),
];

const KING_STEPS: [(i8, i8); 8] = [
    (0, 1),
    (1, 1),
    (1, 0),
    (1, -1),
    (0, -1),
    (-1, -1),
    (-1, 0),
    (-1, 1),
];

const BISHOP_RAYS: [(i8, i8); 4] = [(1, 1), (1, -1), (-1, -1), (-1, 1)];
const ROOK_RAYS: [(i8, i8); 4] = [(0, 1), (1, 0), (0, -1), (-1, 0)];

/// Step one square from `sq`, or `None` if that walks off the board.
///
/// File and rank are stepped separately on purpose. Adding a raw index delta is
/// the classic movegen bug: a knight on h1 "reaches" a3 by wrapping around the
/// edge, and it produces legal-looking moves that no test of central positions
/// ever catches.
fn step(sq: Square, df: i8, dr: i8) -> Option<Square> {
    let file = file_of(sq) as i8 + df;
    let rank = rank_of(sq) as i8 + dr;
    if !(0..8).contains(&file) || !(0..8).contains(&rank) {
        return None;
    }
    Some(square_at(file as u8, rank as u8))
}

/// Is `sq` attacked by any piece of colour `by`?
///
/// Asked of the king's square for check, and of three squares for castling. It
/// answers for an arbitrary square rather than only a king, because "the king
/// may not pass through an attacked square" is the same question about a square
/// the king is not on.
#[must_use]
pub fn is_attacked(pos: &Position, sq: Square, by: Color) -> bool {
    // Pawns: look BACKWARDS from the target along the attacker's capture
    // directions, which is the same set as "squares a pawn of that colour would
    // capture onto".
    let back = -by.pawn_step();
    for df in [-1i8, 1] {
        if let Some(from) = step(sq, df, back / 8) {
            if pos.piece_at(from) == Some(Piece::new(by, PieceKind::Pawn)) {
                return true;
            }
        }
    }

    for (df, dr) in KNIGHT_STEPS {
        if let Some(from) = step(sq, df, dr) {
            if pos.piece_at(from) == Some(Piece::new(by, PieceKind::Knight)) {
                return true;
            }
        }
    }

    for (df, dr) in KING_STEPS {
        if let Some(from) = step(sq, df, dr) {
            if pos.piece_at(from) == Some(Piece::new(by, PieceKind::King)) {
                return true;
            }
        }
    }

    for (rays, slider) in [
        (BISHOP_RAYS, PieceKind::Bishop),
        (ROOK_RAYS, PieceKind::Rook),
    ] {
        for (df, dr) in rays {
            let mut cursor = sq;
            while let Some(next) = step(cursor, df, dr) {
                cursor = next;
                match pos.piece_at(next) {
                    None => continue,
                    Some(p) => {
                        if p.color == by && (p.kind == slider || p.kind == PieceKind::Queen) {
                            return true;
                        }
                        break;
                    }
                }
            }
        }
    }

    false
}

/// Is `color`'s king currently attacked?
///
/// A position with no king of that colour answers `false`. That only happens in
/// hand-written test fixtures; a position reached by replaying moves always has
/// both kings, because no legal move captures one.
#[must_use]
pub fn in_check(pos: &Position, color: Color) -> bool {
    pos.king_square(color)
        .is_some_and(|sq| is_attacked(pos, sq, color.other()))
}

/// Every move the side to move may actually play.
#[must_use]
pub fn legal_moves(pos: &Position) -> Vec<Move> {
    let mover = pos.side_to_move;
    pseudo_legal_moves(pos)
        .into_iter()
        .filter(|&mv| !in_check(&pos.apply(mv), mover))
        .collect()
}

/// Geometry only: these moves respect how pieces move and what blocks them, but
/// may leave the mover's own king in check.
///
/// Castling is the one exception — its "not out of, through or into check"
/// condition is checked here, because the intermediate square is not a square
/// any resulting position would show the king on.
#[must_use]
pub fn pseudo_legal_moves(pos: &Position) -> Vec<Move> {
    let mut moves = Vec::with_capacity(48);
    let us = pos.side_to_move;

    for from in 0..64u8 {
        let Some(piece) = pos.piece_at(from) else {
            continue;
        };
        if piece.color != us {
            continue;
        }
        match piece.kind {
            PieceKind::Pawn => pawn_moves(pos, from, us, &mut moves),
            PieceKind::Knight => {
                for (df, dr) in KNIGHT_STEPS {
                    push_if_free_or_enemy(pos, from, df, dr, us, &mut moves);
                }
            }
            PieceKind::King => {
                for (df, dr) in KING_STEPS {
                    push_if_free_or_enemy(pos, from, df, dr, us, &mut moves);
                }
                castling_moves(pos, us, &mut moves);
            }
            PieceKind::Bishop => ray_moves(pos, from, us, &BISHOP_RAYS, &mut moves),
            PieceKind::Rook => ray_moves(pos, from, us, &ROOK_RAYS, &mut moves),
            PieceKind::Queen => {
                ray_moves(pos, from, us, &BISHOP_RAYS, &mut moves);
                ray_moves(pos, from, us, &ROOK_RAYS, &mut moves);
            }
        }
    }

    moves
}

fn push_if_free_or_enemy(
    pos: &Position,
    from: Square,
    df: i8,
    dr: i8,
    us: Color,
    out: &mut Vec<Move>,
) {
    let Some(to) = step(from, df, dr) else { return };
    match pos.piece_at(to) {
        Some(p) if p.color == us => {}
        _ => out.push(Move::new(from, to)),
    }
}

fn ray_moves(pos: &Position, from: Square, us: Color, rays: &[(i8, i8)], out: &mut Vec<Move>) {
    for &(df, dr) in rays {
        let mut cursor = from;
        while let Some(to) = step(cursor, df, dr) {
            cursor = to;
            match pos.piece_at(to) {
                None => out.push(Move::new(from, to)),
                Some(p) => {
                    if p.color != us {
                        out.push(Move::new(from, to));
                    }
                    break;
                }
            }
        }
    }
}

fn pawn_moves(pos: &Position, from: Square, us: Color, out: &mut Vec<Move>) {
    let dr = us.pawn_step() / 8;

    // One forward, then two — the second only from the home rank and only when
    // BOTH squares are empty, which is what stops a pawn jumping a blocker.
    if let Some(one) = step(from, 0, dr) {
        if pos.piece_at(one).is_none() {
            push_pawn_move(from, one, us, out);
            if rank_of(from) == us.pawn_home_rank() {
                if let Some(two) = step(one, 0, dr) {
                    if pos.piece_at(two).is_none() {
                        out.push(Move::new(from, two));
                    }
                }
            }
        }
    }

    for df in [-1i8, 1] {
        let Some(to) = step(from, df, dr) else {
            continue;
        };
        let takes_piece = matches!(pos.piece_at(to), Some(p) if p.color != us);
        let takes_en_passant = Some(to) == pos.en_passant;
        if takes_piece || takes_en_passant {
            push_pawn_move(from, to, us, out);
        }
    }
}

/// A pawn move that lands on the last rank is FOUR moves, not one. Generating a
/// single unpromoted move here is how a UI ends up unable to underpromote and
/// how perft comes out short by exactly the promotion count.
fn push_pawn_move(from: Square, to: Square, us: Color, out: &mut Vec<Move>) {
    if rank_of(to) == us.promotion_rank() {
        for kind in [
            PieceKind::Queen,
            PieceKind::Rook,
            PieceKind::Bishop,
            PieceKind::Knight,
        ] {
            out.push(Move::promoting(from, to, kind));
        }
    } else {
        out.push(Move::new(from, to));
    }
}

fn castling_moves(pos: &Position, us: Color, out: &mut Vec<Move>) {
    let rank = match us {
        Color::White => 0,
        Color::Black => 7,
    };
    let king_from = square_at(4, rank);
    // The rights bits are authoritative in a position reached by play, but a
    // hand-written FEN can claim a right whose king or rook is not there.
    if pos.piece_at(king_from) != Some(Piece::new(us, PieceKind::King)) {
        return;
    }
    // Castling out of check is illegal, and unlike the other two squares this
    // one is not covered by the "king must not be attacked afterwards" filter.
    if is_attacked(pos, king_from, us.other()) {
        return;
    }

    let (king_side, queen_side) = match us {
        Color::White => (WHITE_KING_SIDE, WHITE_QUEEN_SIDE),
        Color::Black => (BLACK_KING_SIDE, BLACK_QUEEN_SIDE),
    };

    // (right, rook file, squares that must be empty, squares the king crosses)
    let plans: [(u8, u8, &[u8], &[u8]); 2] = [
        (king_side, 7, &[5, 6], &[5, 6]),
        // b1/b8 must be empty for queen-side castling but is NOT crossed by the
        // king, so an attack on it does not matter. Conflating the two lists is
        // a classic over-strict bug that silently forbids a legal O-O-O.
        (queen_side, 0, &[1, 2, 3], &[2, 3]),
    ];

    for (right, rook_file, empties, crossed) in plans {
        if pos.castling & right == 0 {
            continue;
        }
        if pos.piece_at(square_at(rook_file, rank)) != Some(Piece::new(us, PieceKind::Rook)) {
            continue;
        }
        if empties
            .iter()
            .any(|&f| pos.piece_at(square_at(f, rank)).is_some())
        {
            continue;
        }
        if crossed
            .iter()
            .any(|&f| is_attacked(pos, square_at(f, rank), us.other()))
        {
            continue;
        }
        let king_to = square_at(if rook_file == 7 { 6 } else { 2 }, rank);
        out.push(Move::new(king_from, king_to));
    }
}

/// Neither side can construct a checkmate with what is left on the board.
///
/// The FIDE "dead position" set, which is what every engine and every server
/// implements as automatic: bare kings, king and minor against king, and king
/// and bishop against king and bishop with both bishops on the same colour.
/// Deliberately NOT extended to king-and-two-knights, where mate is impossible
/// to force but possible to reach.
#[must_use]
pub fn insufficient_material(pos: &Position) -> bool {
    let mut minors: Vec<(Color, PieceKind, Square)> = Vec::new();
    for sq in 0..64u8 {
        let Some(p) = pos.piece_at(sq) else { continue };
        match p.kind {
            PieceKind::King => {}
            PieceKind::Bishop | PieceKind::Knight => minors.push((p.color, p.kind, sq)),
            // A pawn, rook or queen anywhere means mate is still constructible.
            _ => return false,
        }
    }

    match minors.len() {
        0 | 1 => true,
        2 => {
            let (c0, k0, s0) = minors[0];
            let (c1, k1, s1) = minors[1];
            // Two bishops, one each, on the same square colour: no mate exists.
            // Same-side bishops on opposite colours DO mate, and two knights or
            // a knight and a bishop are sufficient material by this rule.
            k0 == PieceKind::Bishop
                && k1 == PieceKind::Bishop
                && c0 != c1
                && square_color_is_dark(s0) == square_color_is_dark(s1)
        }
        _ => false,
    }
}

const fn square_color_is_dark(sq: Square) -> bool {
    (file_of(sq) + rank_of(sq)).is_multiple_of(2)
}

/// A draw a player may CLAIM, but which does not end the game on its own.
#[derive(Clone, Copy, PartialEq, Eq, Debug)]
pub enum ClaimableDraw {
    /// Fifty moves by each side with no capture and no pawn move.
    FiftyMove,
    /// The same position has now occurred three times.
    ThreefoldRepetition,
}

#[must_use]
pub fn is_checkmate(pos: &Position) -> bool {
    in_check(pos, pos.side_to_move) && legal_moves(pos).is_empty()
}

#[must_use]
pub fn is_stalemate(pos: &Position) -> bool {
    !in_check(pos, pos.side_to_move) && legal_moves(pos).is_empty()
}

/// How this game has ended, if it has.
///
/// `history` is every position that has occurred in the game so far, as
/// [`Position::repetition_key`]s, INCLUDING the current one. Pass an empty
/// slice to skip repetition detection — every other condition is read off the
/// position alone.
#[must_use]
pub fn outcome(pos: &Position, history: &[String]) -> Option<Outcome> {
    if legal_moves(pos).is_empty() {
        return Some(if in_check(pos, pos.side_to_move) {
            Outcome::Checkmate {
                winner: pos.side_to_move.other(),
            }
        } else {
            Outcome::Stalemate
        });
    }
    if insufficient_material(pos) {
        return Some(Outcome::InsufficientMaterial);
    }
    if occurrences(pos, history) >= 5 {
        return Some(Outcome::FivefoldRepetition);
    }
    // 75 moves by EACH side, i.e. 150 plies. The FIDE article is about moves,
    // and the counter is in plies.
    if pos.halfmove_clock >= 150 {
        return Some(Outcome::SeventyFiveMove);
    }
    None
}

/// The draw the side to move could claim right now, if any.
///
/// Returns `None` once the game is over by [`outcome`] — there is nothing left
/// to claim — so a caller can offer the button on exactly this answer.
#[must_use]
pub fn claimable_draw(pos: &Position, history: &[String]) -> Option<ClaimableDraw> {
    if outcome(pos, history).is_some() {
        return None;
    }
    if occurrences(pos, history) >= 3 {
        return Some(ClaimableDraw::ThreefoldRepetition);
    }
    if pos.halfmove_clock >= 100 {
        return Some(ClaimableDraw::FiftyMove);
    }
    None
}

/// How many times the current position has occurred, per `history`.
fn occurrences(pos: &Position, history: &[String]) -> usize {
    if history.is_empty() {
        return 0;
    }
    let key = pos.repetition_key();
    history.iter().filter(|k| *k == &key).count()
}

#[cfg(test)]
mod tests {
    use super::*;

    fn pos(fen: &str) -> Position {
        Position::from_fen(fen).expect("test fen")
    }

    fn uci_set(pos: &Position) -> Vec<String> {
        let mut all: Vec<String> = legal_moves(pos)
            .into_iter()
            .map(crate::notation::move_to_uci)
            .collect();
        all.sort();
        all
    }

    #[test]
    fn the_opening_position_has_twenty_moves() {
        assert_eq!(legal_moves(&Position::initial()).len(), 20);
    }

    #[test]
    fn a_knight_on_the_edge_does_not_wrap_around_the_board() {
        // The whole reason `step` works in file/rank space. With raw index
        // deltas a knight on h1 "reaches" a3 and a2.
        let p = pos("4k3/8/8/8/8/8/8/K6N w - - 0 1");
        assert_eq!(
            uci_set(&p)
                .into_iter()
                .filter(|m| m.starts_with("h1"))
                .collect::<Vec<_>>(),
            vec!["h1f2".to_owned(), "h1g3".to_owned()]
        );
    }

    #[test]
    fn a_pinned_piece_may_not_move_off_the_pin() {
        // The knight on e2 is pinned to e1 by the rook on e8.
        let p = pos("4r3/8/8/8/8/8/4N3/4K3 w - - 0 1");
        assert!(uci_set(&p).iter().all(|m| !m.starts_with("e2")));
    }

    #[test]
    fn a_king_may_not_move_into_check() {
        // The textbook stalemate: Black is not in check and has no move,
        // because the queen on f7 covers g7, g8 and h7 while leaving h8 alone.
        let p = pos("7k/5Q2/6K1/8/8/8/8/8 b - - 0 1");
        assert_eq!(uci_set(&p), Vec::<String>::new());
        assert!(!in_check(&p, Color::Black));
        assert!(is_stalemate(&p));
        assert!(!is_checkmate(&p));
    }

    #[test]
    fn castling_is_offered_when_legal_and_withheld_when_not() {
        let clear = pos("r3k2r/8/8/8/8/8/8/R3K2R w KQkq - 0 1");
        let mut castles: Vec<String> = uci_set(&clear)
            .into_iter()
            .filter(|m| m == "e1g1" || m == "e1c1")
            .collect();
        castles.sort();
        assert_eq!(castles, vec!["e1c1".to_owned(), "e1g1".to_owned()]);

        // A rook attacking f1 stops the king CROSSING it.
        let crossed = pos("r4k2/8/8/8/8/8/8/R3K2R w KQ - 0 1");
        let attacked_f1 = pos("5r2/8/8/8/8/8/8/R3K2R w KQ - 0 1");
        assert!(uci_set(&crossed).contains(&"e1g1".to_owned()));
        assert!(!uci_set(&attacked_f1).contains(&"e1g1".to_owned()));

        // b1 occupied blocks O-O-O even though the king never crosses b1 …
        let blocked_b1 = pos("4k3/8/8/8/8/8/8/RN2K2R w KQ - 0 1");
        assert!(!uci_set(&blocked_b1).contains(&"e1c1".to_owned()));
        // … while an ATTACK on b1 alone does not.
        let attacked_b1 = pos("1r2k3/8/8/8/8/8/8/R3K2R w KQ - 0 1");
        assert!(uci_set(&attacked_b1).contains(&"e1c1".to_owned()));
    }

    #[test]
    fn castling_out_of_check_is_illegal() {
        let p = pos("4r3/8/8/8/8/8/8/R3K2R w KQ - 0 1");
        assert!(in_check(&p, Color::White));
        let moves = uci_set(&p);
        assert!(!moves.contains(&"e1g1".to_owned()));
        assert!(!moves.contains(&"e1c1".to_owned()));
    }

    #[test]
    fn a_pawn_reaching_the_last_rank_generates_four_moves() {
        let p = pos("8/4P3/8/8/8/8/8/K6k w - - 0 1");
        let promotions: Vec<String> = uci_set(&p)
            .into_iter()
            .filter(|m| m.starts_with("e7e8"))
            .collect();
        assert_eq!(
            promotions,
            vec![
                "e7e8b".to_owned(),
                "e7e8n".to_owned(),
                "e7e8q".to_owned(),
                "e7e8r".to_owned()
            ]
        );
    }

    #[test]
    fn en_passant_is_only_available_on_the_move_after_the_push() {
        let available = pos("4k3/8/8/3pP3/8/8/8/4K3 w - d6 0 1");
        assert!(uci_set(&available).contains(&"e5d6".to_owned()));

        let expired = pos("4k3/8/8/3pP3/8/8/8/4K3 w - - 0 1");
        assert!(!uci_set(&expired).contains(&"e5d6".to_owned()));
    }

    #[test]
    fn an_en_passant_capture_that_exposes_the_king_is_illegal() {
        // Both the capturing pawn and the captured one leave the fifth rank, so
        // the rook on a5 would give check. This is the position every naive
        // legality filter gets wrong, because only ONE of the two vacated
        // squares is on the move.
        let p = pos("7k/8/8/K2pP2r/8/8/8/8 w - d6 0 1");
        assert!(!uci_set(&p).contains(&"e5d6".to_owned()));
    }

    #[test]
    fn fools_mate_is_checkmate_and_not_stalemate() {
        let p = pos("rnb1kbnr/pppp1ppp/8/4p3/6Pq/5P2/PPPPP2P/RNBQKBNR w KQkq - 1 3");
        assert!(in_check(&p, Color::White));
        assert!(is_checkmate(&p));
        assert!(!is_stalemate(&p));
        assert_eq!(
            outcome(&p, &[]),
            Some(Outcome::Checkmate {
                winner: Color::Black
            })
        );
    }

    #[test]
    fn insufficient_material_covers_the_dead_positions_and_no_more() {
        assert!(insufficient_material(&pos("4k3/8/8/8/8/8/8/4K3 w - - 0 1")));
        assert!(insufficient_material(&pos(
            "4k3/8/8/8/8/8/8/4KB2 w - - 0 1"
        )));
        assert!(insufficient_material(&pos(
            "4k3/8/8/8/8/8/8/4KN2 w - - 0 1"
        )));
        // Bishops on the same colour: dead. c1 and f8 are both dark.
        assert!(insufficient_material(&pos(
            "5bk1/8/8/8/8/8/8/2B1K3 w - - 0 1"
        )));
        // Opposite colours: mate is constructible, so the game continues.
        assert!(!insufficient_material(&pos(
            "5bk1/8/8/8/8/8/8/3B1K2 w - - 0 1"
        )));
        assert!(!insufficient_material(&pos(
            "4k3/8/8/8/8/8/4P3/4K3 w - - 0 1"
        )));
        assert!(!insufficient_material(&pos(
            "4k3/8/8/8/8/8/8/3KNN2 w - - 0 1"
        )));
    }

    #[test]
    fn the_seventy_five_move_rule_is_automatic_and_the_fifty_move_rule_is_a_claim() {
        let fifty = pos("4k3/8/8/8/8/8/R7/4K3 w - - 100 80");
        assert_eq!(outcome(&fifty, &[]), None);
        assert!(claimable_draw(&fifty, &[]).is_some());

        let seventy_five = pos("4k3/8/8/8/8/8/R7/4K3 w - - 150 120");
        assert_eq!(outcome(&seventy_five, &[]), Some(Outcome::SeventyFiveMove));
    }
}
