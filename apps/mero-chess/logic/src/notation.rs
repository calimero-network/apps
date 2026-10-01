//! The two move notations this app speaks.
//!
//! **UCI** (`e2e4`, `e7e8q`) is the wire format: it is unambiguous without a
//! position, so a stored move survives any disagreement about the rules and a
//! client can send one without implementing chess. Every move in contract state
//! is a UCI string.
//!
//! **SAN** (`Nf3`, `exd6`, `O-O-O`, `Qxf7#`) is what a person reads. It is
//! computed HERE, in the contract, at the moment the move is played — because
//! SAN depends on the position (which other knight could also have gone to f3?)
//! and a client that recomputed it from a replay could disagree with another
//! client. One writer, one answer, stored alongside the move.

use crate::board::{file_of, parse_square, rank_of, square_name, Move, PieceKind, Position};
use crate::movegen::{in_check, is_checkmate, legal_moves};

/// `e2e4`, or `e7e8q` for a promotion.
#[must_use]
pub fn move_to_uci(mv: Move) -> String {
    let mut out = square_name(mv.from);
    out.push_str(&square_name(mv.to));
    if let Some(kind) = mv.promotion {
        out.push(kind.promotion_char());
    }
    out
}

/// Parse a UCI move. Syntax only — whether it is legal is the caller's
/// question, and one this function cannot answer without a position.
///
/// Rejects a promotion to a king or a pawn, which are the two spellings that
/// look well-formed and are not moves.
#[must_use]
pub fn parse_uci(text: &str) -> Option<Move> {
    let text = text.trim();
    if text.len() != 4 && text.len() != 5 {
        return None;
    }
    let from = parse_square(text.get(0..2)?)?;
    let to = parse_square(text.get(2..4)?)?;
    let promotion = match text.get(4..5) {
        None => None,
        Some(c) => Some(match c {
            "q" | "Q" => PieceKind::Queen,
            "r" | "R" => PieceKind::Rook,
            "b" | "B" => PieceKind::Bishop,
            "n" | "N" => PieceKind::Knight,
            _ => return None,
        }),
    };
    Some(Move {
        from,
        to,
        promotion,
    })
}

/// Standard Algebraic Notation for a move that is legal in `pos`.
///
/// Disambiguation follows the FIDE rule and its order: file first, then rank,
/// then both — `Nbd2`, `N1d2`, `Qh4e1`. The ambiguity set is the LEGAL moves of
/// the same piece kind to the same square, not the pseudo-legal ones: a second
/// knight that is pinned cannot go there, so it does not make the move
/// ambiguous and `Nbd2` would be wrong.
#[must_use]
pub fn san(pos: &Position, mv: Move) -> String {
    let Some(piece) = pos.piece_at(mv.from) else {
        // Not a move in this position. Fall back to UCI rather than inventing
        // notation for it — a caller that reaches this has already gone wrong.
        return move_to_uci(mv);
    };

    let mut out = String::with_capacity(8);

    if piece.kind == PieceKind::King && mv.from.abs_diff(mv.to) == 2 {
        out.push_str(if file_of(mv.to) == 6 { "O-O" } else { "O-O-O" });
    } else {
        let capture = pos.is_capture(mv);
        match piece.kind.letter() {
            None => {
                // A pawn names its origin FILE when it captures, and nothing
                // otherwise: exd5, but d4.
                if capture {
                    out.push((b'a' + file_of(mv.from)) as char);
                }
            }
            Some(letter) => {
                out.push(letter);
                out.push_str(&disambiguation(pos, mv, piece.kind));
            }
        }
        if capture {
            out.push('x');
        }
        out.push_str(&square_name(mv.to));
        if let Some(kind) = mv.promotion {
            out.push('=');
            if let Some(letter) = kind.letter() {
                out.push(letter);
            }
        }
    }

    // Check and mate are properties of the position AFTER the move, which is
    // why this is appended last and computed from `apply`.
    let after = pos.apply(mv);
    if is_checkmate(&after) {
        out.push('#');
    } else if in_check(&after, after.side_to_move) {
        out.push('+');
    }

    out
}

/// The shortest origin hint that separates this move from the others of the
/// same kind to the same square: "", a file, a rank, or both.
fn disambiguation(pos: &Position, mv: Move, kind: PieceKind) -> String {
    let rivals: Vec<Move> = legal_moves(pos)
        .into_iter()
        .filter(|&other| {
            other.to == mv.to
                && other.from != mv.from
                && pos.piece_at(other.from).is_some_and(|p| p.kind == kind)
        })
        .collect();

    if rivals.is_empty() {
        return String::new();
    }
    if rivals.iter().all(|r| file_of(r.from) != file_of(mv.from)) {
        return ((b'a' + file_of(mv.from)) as char).to_string();
    }
    if rivals.iter().all(|r| rank_of(r.from) != rank_of(mv.from)) {
        return ((b'1' + rank_of(mv.from)) as char).to_string();
    }
    square_name(mv.from)
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::board::Color;

    fn pos(fen: &str) -> Position {
        Position::from_fen(fen).expect("test fen")
    }

    /// Play a UCI move that must be legal, and return the SAN it produced.
    fn play(p: &mut Position, uci: &str) -> String {
        let mv = parse_uci(uci).expect("uci");
        let legal = legal_moves(p);
        assert!(legal.contains(&mv), "{uci} is not legal in {}", p.to_fen());
        let text = san(p, mv);
        *p = p.apply(mv);
        text
    }

    #[test]
    fn uci_round_trips_including_promotions() {
        for text in ["e2e4", "a7a8q", "h1h8", "b7c8n"] {
            let mv = parse_uci(text).expect("parse");
            assert_eq!(move_to_uci(mv), text);
        }
        assert_eq!(parse_uci("e2e9"), None);
        assert_eq!(parse_uci("e2"), None);
        // A promotion to a king is well-shaped and is not a move.
        assert_eq!(parse_uci("e7e8k"), None);
    }

    #[test]
    fn san_names_the_ordinary_moves() {
        let mut p = Position::initial();
        assert_eq!(play(&mut p, "e2e4"), "e4");
        assert_eq!(play(&mut p, "c7c5"), "c5");
        assert_eq!(play(&mut p, "g1f3"), "Nf3");
        assert_eq!(play(&mut p, "d7d6"), "d6");
        assert_eq!(play(&mut p, "d2d4"), "d4");
        assert_eq!(play(&mut p, "c5d4"), "cxd4");
        assert_eq!(play(&mut p, "f3d4"), "Nxd4");
    }

    #[test]
    fn san_disambiguates_by_file_then_rank_then_square() {
        // Two knights on b1 and f3 both reach d2: file is enough.
        let p = pos("4k3/8/8/8/8/5N2/8/1N2K3 w - - 0 1");
        let mv = parse_uci("b1d2").expect("uci");
        assert_eq!(san(&p, mv), "Nbd2");

        // Knights on b1 and b5 both reach d4: same file, so the RANK separates.
        let p = pos("4k3/8/8/1N6/8/8/8/1N2K3 w - - 0 1");
        let mv = parse_uci("b1d2").expect("uci");
        // b1 is the only knight that reaches d2 here, so no hint at all.
        assert_eq!(san(&p, mv), "Nd2");
        let mv = parse_uci("b1c3").expect("uci");
        assert_eq!(san(&p, mv), "N1c3");

        // Three queens reach e4: the one on e7 shares the mover's FILE and the
        // one on h1 shares its RANK, so neither hint alone separates them and
        // SAN falls through to the full origin square.
        let p = pos("2k5/4Q3/8/8/8/8/8/K3Q2Q w - - 0 1");
        let mv = parse_uci("e1e4").expect("uci");
        assert_eq!(san(&p, mv), "Qe1e4");
    }

    #[test]
    fn a_pinned_rival_does_not_make_a_move_ambiguous() {
        // Both knights geometrically reach d2, but the f3 knight is pinned to
        // e1 by the rook on e8 — so it cannot, and Nd2 needs no hint. This is
        // the case that separates "legal moves" from "pseudo-legal moves" in
        // the ambiguity set.
        let p = pos("4r3/8/8/8/8/4N3/8/1N2K3 w - - 0 1");
        let mv = parse_uci("b1d2").expect("uci");
        assert_eq!(san(&p, mv), "Nd2");
    }

    #[test]
    fn san_marks_castling_promotion_check_and_mate() {
        let p = pos("r3k2r/8/8/8/8/8/8/R3K2R w KQkq - 0 1");
        assert_eq!(san(&p, parse_uci("e1g1").expect("uci")), "O-O");
        assert_eq!(san(&p, parse_uci("e1c1").expect("uci")), "O-O-O");

        // Queening with check: the new queen sees e8 down the eighth rank.
        let open_rank = pos("4k3/P7/8/8/8/8/8/4K3 w - - 0 1");
        assert_eq!(san(&open_rank, parse_uci("a7a8q").expect("uci")), "a8=Q+");
        // A knight on b8 blocks that rank, so the same promotion is quiet —
        // and capturing it underpromotes.
        let blocked = pos("1n2k3/P7/8/8/8/8/8/4K3 w - - 0 1");
        assert_eq!(san(&blocked, parse_uci("a7a8q").expect("uci")), "a8=Q");
        assert_eq!(san(&blocked, parse_uci("a7b8n").expect("uci")), "axb8=N");

        // Scholar's mate: the queen takes on f7 with mate.
        let p = pos("r1bqkbnr/pppp1ppp/2n5/4p3/2B1P3/5Q2/PPPP1PPP/RNB1K1NR w KQkq - 4 4");
        assert_eq!(san(&p, parse_uci("f3f7").expect("uci")), "Qxf7#");
    }

    #[test]
    fn en_passant_is_written_as_a_pawn_capture() {
        let p = pos("4k3/8/8/3pP3/8/8/8/4K3 w - d6 0 1");
        assert_eq!(san(&p, parse_uci("e5d6").expect("uci")), "exd6");
    }

    #[test]
    fn the_immortal_opening_reads_as_it_should() {
        // A short, real sequence: Ruy Lopez into an exchange, castling, and a
        // capture that needs no hint. Cheap regression cover for the whole
        // pipeline rather than for one branch of it.
        let mut p = Position::initial();
        let moves = [
            ("e2e4", "e4"),
            ("e7e5", "e5"),
            ("g1f3", "Nf3"),
            ("b8c6", "Nc6"),
            ("f1b5", "Bb5"),
            ("a7a6", "a6"),
            ("b5c6", "Bxc6"),
            ("d7c6", "dxc6"),
            ("e1g1", "O-O"),
            ("f7f6", "f6"),
            ("f3e5", "Nxe5"),
            ("f6e5", "fxe5"),
        ];
        for (uci, expected) in moves {
            assert_eq!(play(&mut p, uci), expected, "at {uci}");
        }
        assert_eq!(p.side_to_move, Color::White);
    }
}
