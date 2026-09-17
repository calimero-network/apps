//! Board, position and move application — the part of the rules that has no
//! opinion about whether a move is legal.
//!
//! The representation is a plain `[Option<Piece>; 64]` mailbox rather than
//! bitboards. Nothing here searches: the contract replays at most a few hundred
//! plies per call, so clarity is worth more than nodes per second, and a
//! mailbox is the form a reviewer can check against the rules by reading it.
//!
//! Square numbering is a1 = 0 … h8 = 63, so `file = sq % 8` and `rank = sq / 8`
//! both fall out, and rank 0 is White's back rank.

use core::fmt::Write as _;

/// a1 = 0, h8 = 63.
pub type Square = u8;

pub const WHITE_KING_SIDE: u8 = 1;
pub const WHITE_QUEEN_SIDE: u8 = 2;
pub const BLACK_KING_SIDE: u8 = 4;
pub const BLACK_QUEEN_SIDE: u8 = 8;

#[derive(Clone, Copy, PartialEq, Eq, Debug, Hash)]
pub enum Color {
    White,
    Black,
}

impl Color {
    #[must_use]
    pub const fn other(self) -> Self {
        match self {
            Color::White => Color::Black,
            Color::Black => Color::White,
        }
    }

    /// The rank pawns of this colour move towards, as a `+1`/`-1` step of 8.
    #[must_use]
    pub const fn pawn_step(self) -> i8 {
        match self {
            Color::White => 8,
            Color::Black => -8,
        }
    }

    /// The rank (0-based) pawns of this colour start on.
    #[must_use]
    pub const fn pawn_home_rank(self) -> u8 {
        match self {
            Color::White => 1,
            Color::Black => 6,
        }
    }

    /// The rank (0-based) a pawn of this colour promotes on.
    #[must_use]
    pub const fn promotion_rank(self) -> u8 {
        match self {
            Color::White => 7,
            Color::Black => 0,
        }
    }
}

#[derive(Clone, Copy, PartialEq, Eq, Debug, Hash)]
pub enum PieceKind {
    Pawn,
    Knight,
    Bishop,
    Rook,
    Queen,
    King,
}

impl PieceKind {
    /// The SAN letter. A pawn has none, which is why this is not `Display`.
    #[must_use]
    pub const fn letter(self) -> Option<char> {
        match self {
            PieceKind::Pawn => None,
            PieceKind::Knight => Some('N'),
            PieceKind::Bishop => Some('B'),
            PieceKind::Rook => Some('R'),
            PieceKind::Queen => Some('Q'),
            PieceKind::King => Some('K'),
        }
    }

    /// The promotion suffix a UCI move carries, always lowercase.
    #[must_use]
    pub const fn promotion_char(self) -> char {
        match self {
            PieceKind::Knight => 'n',
            PieceKind::Bishop => 'b',
            PieceKind::Rook => 'r',
            PieceKind::Queen => 'q',
            // Neither is a legal promotion; the parser never produces them.
            PieceKind::Pawn => 'p',
            PieceKind::King => 'k',
        }
    }
}

#[derive(Clone, Copy, PartialEq, Eq, Debug, Hash)]
pub struct Piece {
    pub color: Color,
    pub kind: PieceKind,
}

impl Piece {
    #[must_use]
    pub const fn new(color: Color, kind: PieceKind) -> Self {
        Self { color, kind }
    }

    /// The FEN character: uppercase for White, lowercase for Black.
    #[must_use]
    pub const fn fen_char(self) -> char {
        let c = match self.kind {
            PieceKind::Pawn => 'p',
            PieceKind::Knight => 'n',
            PieceKind::Bishop => 'b',
            PieceKind::Rook => 'r',
            PieceKind::Queen => 'q',
            PieceKind::King => 'k',
        };
        match self.color {
            Color::White => c.to_ascii_uppercase(),
            Color::Black => c,
        }
    }

    #[must_use]
    pub fn from_fen_char(c: char) -> Option<Self> {
        let color = if c.is_ascii_uppercase() {
            Color::White
        } else {
            Color::Black
        };
        let kind = match c.to_ascii_lowercase() {
            'p' => PieceKind::Pawn,
            'n' => PieceKind::Knight,
            'b' => PieceKind::Bishop,
            'r' => PieceKind::Rook,
            'q' => PieceKind::Queen,
            'k' => PieceKind::King,
            _ => return None,
        };
        Some(Self { color, kind })
    }
}

/// One move, in the only form the contract stores: origin, target, and the
/// piece a pawn promotes to.
///
/// Castling is encoded as the KING moving two files — the same convention UCI
/// uses — rather than as its own move type, so `Move` stays a plain pair of
/// squares and every consumer can render it without a special case.
#[derive(Clone, Copy, PartialEq, Eq, Debug, Hash)]
pub struct Move {
    pub from: Square,
    pub to: Square,
    pub promotion: Option<PieceKind>,
}

impl Move {
    #[must_use]
    pub const fn new(from: Square, to: Square) -> Self {
        Self {
            from,
            to,
            promotion: None,
        }
    }

    #[must_use]
    pub const fn promoting(from: Square, to: Square, kind: PieceKind) -> Self {
        Self {
            from,
            to,
            promotion: Some(kind),
        }
    }
}

#[must_use]
pub const fn file_of(sq: Square) -> u8 {
    sq % 8
}

#[must_use]
pub const fn rank_of(sq: Square) -> u8 {
    sq / 8
}

#[must_use]
pub const fn square_at(file: u8, rank: u8) -> Square {
    rank * 8 + file
}

/// "e4" for 28. Used by SAN, by the ABI, and by every log line.
#[must_use]
pub fn square_name(sq: Square) -> String {
    let mut s = String::with_capacity(2);
    s.push((b'a' + file_of(sq)) as char);
    s.push((b'1' + rank_of(sq)) as char);
    s
}

/// The inverse of [`square_name`], rejecting anything that is not a square.
#[must_use]
pub fn parse_square(name: &str) -> Option<Square> {
    let bytes = name.as_bytes();
    if bytes.len() != 2 {
        return None;
    }
    let file = bytes[0].checked_sub(b'a')?;
    let rank = bytes[1].checked_sub(b'1')?;
    if file > 7 || rank > 7 {
        return None;
    }
    Some(square_at(file, rank))
}

/// A full chess position: everything a FEN carries, and nothing else.
///
/// Deliberately `Clone` and cheap to copy — move generation applies a move to a
/// copy and asks whether the mover is in check, which is the whole legality
/// filter and the reason this type has no undo.
#[derive(Clone, PartialEq, Eq, Debug)]
pub struct Position {
    pub board: [Option<Piece>; 64],
    pub side_to_move: Color,
    /// Bitmask of [`WHITE_KING_SIDE`] and friends.
    pub castling: u8,
    /// The square a pawn just skipped over, i.e. the one a capture lands on.
    pub en_passant: Option<Square>,
    /// Plies since the last capture or pawn move — the fifty-move counter.
    pub halfmove_clock: u16,
    /// Increments after Black moves, starting at 1.
    pub fullmove_number: u16,
}

impl Default for Position {
    fn default() -> Self {
        Self::initial()
    }
}

impl Position {
    /// The standard starting array.
    #[must_use]
    pub fn initial() -> Self {
        let mut board = [None; 64];
        let back = [
            PieceKind::Rook,
            PieceKind::Knight,
            PieceKind::Bishop,
            PieceKind::Queen,
            PieceKind::King,
            PieceKind::Bishop,
            PieceKind::Knight,
            PieceKind::Rook,
        ];
        for (file, kind) in back.into_iter().enumerate() {
            let file = file as u8;
            board[square_at(file, 0) as usize] = Some(Piece::new(Color::White, kind));
            board[square_at(file, 1) as usize] = Some(Piece::new(Color::White, PieceKind::Pawn));
            board[square_at(file, 6) as usize] = Some(Piece::new(Color::Black, PieceKind::Pawn));
            board[square_at(file, 7) as usize] = Some(Piece::new(Color::Black, kind));
        }
        Self {
            board,
            side_to_move: Color::White,
            castling: WHITE_KING_SIDE | WHITE_QUEEN_SIDE | BLACK_KING_SIDE | BLACK_QUEEN_SIDE,
            en_passant: None,
            halfmove_clock: 0,
            fullmove_number: 1,
        }
    }

    #[must_use]
    pub fn piece_at(&self, sq: Square) -> Option<Piece> {
        self.board.get(sq as usize).copied().flatten()
    }

    #[must_use]
    pub fn king_square(&self, color: Color) -> Option<Square> {
        (0..64u8).find(|&sq| self.piece_at(sq) == Some(Piece::new(color, PieceKind::King)))
    }

    /// True when this move takes a piece — including the en-passant capture,
    /// whose victim is not on the target square.
    #[must_use]
    pub fn is_capture(&self, mv: Move) -> bool {
        if self.piece_at(mv.to).is_some() {
            return true;
        }
        matches!(self.piece_at(mv.from), Some(p) if p.kind == PieceKind::Pawn)
            && Some(mv.to) == self.en_passant
    }

    /// Apply a move that has already been established as legal.
    ///
    /// Everything special about chess movement lives here — en passant both
    /// ways, the rook that follows a castling king, promotion, and the four
    /// ways castling rights die — so that move generation stays a question of
    /// geometry.
    #[must_use]
    pub fn apply(&self, mv: Move) -> Self {
        let mut next = self.clone();
        let Some(piece) = self.piece_at(mv.from) else {
            // Not reachable through the public API: every caller has already
            // matched this move against generated ones. Returning the position
            // unchanged keeps the function total rather than panicking inside a
            // contract call.
            return next;
        };
        let captured = self.piece_at(mv.to);

        next.board[mv.from as usize] = None;
        next.board[mv.to as usize] = Some(piece);

        // ── en passant: the captured pawn is not on the target square ──────
        if piece.kind == PieceKind::Pawn && Some(mv.to) == self.en_passant {
            let victim = (mv.to as i8 - piece.color.pawn_step()) as u8;
            next.board[victim as usize] = None;
        }

        // ── promotion ─────────────────────────────────────────────────────
        if piece.kind == PieceKind::Pawn && rank_of(mv.to) == piece.color.promotion_rank() {
            // A promotion move with no piece named promotes to a queen. The
            // parser fills this in, so this is the belt to that braces.
            let kind = mv.promotion.unwrap_or(PieceKind::Queen);
            next.board[mv.to as usize] = Some(Piece::new(piece.color, kind));
        }

        // ── castling moves the rook too ───────────────────────────────────
        if piece.kind == PieceKind::King && mv.from.abs_diff(mv.to) == 2 {
            let rank = rank_of(mv.from);
            let (rook_from, rook_to) = if file_of(mv.to) == 6 {
                (square_at(7, rank), square_at(5, rank))
            } else {
                (square_at(0, rank), square_at(3, rank))
            };
            let rook = next.board[rook_from as usize].take();
            next.board[rook_to as usize] = rook;
        }

        // ── castling rights ───────────────────────────────────────────────
        //
        // Four independent ways a right dies: the king moves, the rook moves,
        // the rook is captured where it stood, or the king castles. Missing the
        // "captured where it stood" case is the classic bug — it only shows up
        // when the opponent later castles through a rook that no longer exists.
        match piece.kind {
            PieceKind::King => match piece.color {
                Color::White => next.castling &= !(WHITE_KING_SIDE | WHITE_QUEEN_SIDE),
                Color::Black => next.castling &= !(BLACK_KING_SIDE | BLACK_QUEEN_SIDE),
            },
            PieceKind::Rook => next.castling &= !right_for_rook_square(mv.from),
            _ => {}
        }
        if captured.is_some() {
            next.castling &= !right_for_rook_square(mv.to);
        }

        // ── en-passant target for the NEXT move ───────────────────────────
        next.en_passant = if piece.kind == PieceKind::Pawn && mv.from.abs_diff(mv.to) == 16 {
            Some((mv.from as i8 + piece.color.pawn_step()) as u8)
        } else {
            None
        };

        // ── clocks ────────────────────────────────────────────────────────
        next.halfmove_clock = if piece.kind == PieceKind::Pawn || captured.is_some() {
            0
        } else {
            self.halfmove_clock.saturating_add(1)
        };
        if piece.color == Color::Black {
            next.fullmove_number = self.fullmove_number.saturating_add(1);
        }
        next.side_to_move = piece.color.other();
        next
    }

    /// Full Forsyth–Edwards notation, the six fields.
    #[must_use]
    pub fn to_fen(&self) -> String {
        let mut fen = self.placement_fen();
        fen.push(' ');
        fen.push(match self.side_to_move {
            Color::White => 'w',
            Color::Black => 'b',
        });
        fen.push(' ');
        fen.push_str(&self.castling_fen());
        fen.push(' ');
        match self.en_passant {
            Some(sq) => fen.push_str(&square_name(sq)),
            None => fen.push('-'),
        }
        // `write!` into a String cannot fail; the result is discarded rather
        // than unwrapped so this stays panic-free inside a contract call.
        let _ = write!(fen, " {} {}", self.halfmove_clock, self.fullmove_number);
        fen
    }

    /// The first four FEN fields: everything that defines a POSITION, with the
    /// two clocks left out.
    ///
    /// This is the repetition key. The clocks must not be in it — they differ
    /// between two occurrences of the same position by construction — and the
    /// en-passant square must be, because a position where a capture en passant
    /// is available is a different position from the same array without it.
    #[must_use]
    pub fn repetition_key(&self) -> String {
        let mut key = self.placement_fen();
        key.push(' ');
        key.push(match self.side_to_move {
            Color::White => 'w',
            Color::Black => 'b',
        });
        key.push(' ');
        key.push_str(&self.castling_fen());
        key.push(' ');
        match self.en_passant {
            Some(sq) => key.push_str(&square_name(sq)),
            None => key.push('-'),
        }
        key
    }

    fn placement_fen(&self) -> String {
        let mut out = String::with_capacity(72);
        for rank in (0..8u8).rev() {
            let mut empty = 0u8;
            for file in 0..8u8 {
                match self.piece_at(square_at(file, rank)) {
                    Some(p) => {
                        if empty > 0 {
                            out.push((b'0' + empty) as char);
                            empty = 0;
                        }
                        out.push(p.fen_char());
                    }
                    None => empty += 1,
                }
            }
            if empty > 0 {
                out.push((b'0' + empty) as char);
            }
            if rank > 0 {
                out.push('/');
            }
        }
        out
    }

    fn castling_fen(&self) -> String {
        let mut out = String::with_capacity(4);
        for (bit, ch) in [
            (WHITE_KING_SIDE, 'K'),
            (WHITE_QUEEN_SIDE, 'Q'),
            (BLACK_KING_SIDE, 'k'),
            (BLACK_QUEEN_SIDE, 'q'),
        ] {
            if self.castling & bit != 0 {
                out.push(ch);
            }
        }
        if out.is_empty() {
            out.push('-');
        }
        out
    }

    /// Parse a FEN. Only the tests and the fixtures use this — the contract
    /// always replays from the initial position — but it is what makes a
    /// published perft position a two-line test instead of a hand-built array.
    #[must_use]
    pub fn from_fen(fen: &str) -> Option<Self> {
        let mut fields = fen.split_whitespace();
        let placement = fields.next()?;
        let side = fields.next()?;
        let castling = fields.next()?;
        let ep = fields.next()?;
        // The two clocks are optional: plenty of published positions stop after
        // the en-passant field.
        let halfmove = fields.next().unwrap_or("0");
        let fullmove = fields.next().unwrap_or("1");

        let mut board = [None; 64];
        let mut rank: i8 = 7;
        let mut file: u8 = 0;
        for c in placement.chars() {
            match c {
                '/' => {
                    if file != 8 {
                        return None;
                    }
                    rank -= 1;
                    file = 0;
                    if rank < 0 {
                        return None;
                    }
                }
                '1'..='8' => {
                    file += c as u8 - b'0';
                    if file > 8 {
                        return None;
                    }
                }
                _ => {
                    if file > 7 {
                        return None;
                    }
                    board[square_at(file, rank as u8) as usize] = Some(Piece::from_fen_char(c)?);
                    file += 1;
                }
            }
        }
        if rank != 0 || file != 8 {
            return None;
        }

        let side_to_move = match side {
            "w" => Color::White,
            "b" => Color::Black,
            _ => return None,
        };

        let mut rights = 0u8;
        if castling != "-" {
            for c in castling.chars() {
                rights |= match c {
                    'K' => WHITE_KING_SIDE,
                    'Q' => WHITE_QUEEN_SIDE,
                    'k' => BLACK_KING_SIDE,
                    'q' => BLACK_QUEEN_SIDE,
                    _ => return None,
                };
            }
        }

        let en_passant = if ep == "-" {
            None
        } else {
            Some(parse_square(ep)?)
        };

        Some(Self {
            board,
            side_to_move,
            castling: rights,
            en_passant,
            halfmove_clock: halfmove.parse().ok()?,
            fullmove_number: fullmove.parse().ok()?,
        })
    }
}

/// The castling right a rook standing on `sq` would carry, or 0.
///
/// Used for both "this rook moved" and "this rook was captured where it
/// stood" — the same square-to-right mapping answers both.
const fn right_for_rook_square(sq: Square) -> u8 {
    match sq {
        0 => WHITE_QUEEN_SIDE,
        7 => WHITE_KING_SIDE,
        56 => BLACK_QUEEN_SIDE,
        63 => BLACK_KING_SIDE,
        _ => 0,
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn initial_position_round_trips_through_fen() {
        let start = Position::initial();
        assert_eq!(
            start.to_fen(),
            "rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBNR w KQkq - 0 1"
        );
        assert_eq!(Position::from_fen(&start.to_fen()), Some(start));
    }

    #[test]
    fn squares_name_and_parse_consistently() {
        for sq in 0..64u8 {
            assert_eq!(parse_square(&square_name(sq)), Some(sq));
        }
        assert_eq!(parse_square("e9"), None);
        assert_eq!(parse_square("i1"), None);
        assert_eq!(parse_square("e"), None);
    }

    #[test]
    fn a_double_pawn_push_sets_the_en_passant_square() {
        let after = Position::initial().apply(Move::new(
            parse_square("e2").expect("e2"),
            parse_square("e4").expect("e4"),
        ));
        assert_eq!(after.en_passant, parse_square("e3"));
        assert_eq!(after.side_to_move, Color::Black);
        assert_eq!(after.halfmove_clock, 0);
    }

    #[test]
    fn castling_moves_the_rook_and_clears_both_rights() {
        let pos = Position::from_fen("r3k2r/8/8/8/8/8/8/R3K2R w KQkq - 0 1").expect("fen");
        let after = pos.apply(Move::new(
            parse_square("e1").expect("e1"),
            parse_square("g1").expect("g1"),
        ));
        assert_eq!(
            after.piece_at(parse_square("f1").expect("f1")),
            Some(Piece::new(Color::White, PieceKind::Rook))
        );
        assert_eq!(after.piece_at(parse_square("h1").expect("h1")), None);
        assert_eq!(after.castling, BLACK_KING_SIDE | BLACK_QUEEN_SIDE);
    }

    #[test]
    fn capturing_a_rook_on_its_home_square_kills_that_right() {
        // Black's rook takes on h1: White's king-side right must go with it,
        // even though White never moved a thing.
        let pos = Position::from_fen("4k2r/8/8/8/8/8/8/R3K2R b KQk - 0 1").expect("fen");
        let after = pos.apply(Move::new(
            parse_square("h8").expect("h8"),
            parse_square("h1").expect("h1"),
        ));
        assert_eq!(after.castling & WHITE_KING_SIDE, 0);
        assert_eq!(after.castling & WHITE_QUEEN_SIDE, WHITE_QUEEN_SIDE);
    }

    #[test]
    fn en_passant_removes_a_pawn_that_is_not_on_the_target_square() {
        let pos = Position::from_fen("8/8/8/3pP3/8/8/8/4K2k w - d6 0 1").expect("fen");
        let after = pos.apply(Move::new(
            parse_square("e5").expect("e5"),
            parse_square("d6").expect("d6"),
        ));
        assert_eq!(after.piece_at(parse_square("d5").expect("d5")), None);
        assert_eq!(
            after.piece_at(parse_square("d6").expect("d6")),
            Some(Piece::new(Color::White, PieceKind::Pawn))
        );
    }

    #[test]
    fn the_halfmove_clock_counts_quiet_moves_and_resets_on_pawns_and_captures() {
        let pos = Position::from_fen("4k3/8/8/8/8/5n2/8/4K1N1 w - - 10 30").expect("fen");
        let quiet = pos.apply(Move::new(
            parse_square("e1").expect("e1"),
            parse_square("e2").expect("e2"),
        ));
        assert_eq!(quiet.halfmove_clock, 11);
        assert_eq!(quiet.fullmove_number, 30);

        let capture = pos.apply(Move::new(
            parse_square("g1").expect("g1"),
            parse_square("f3").expect("f3"),
        ));
        assert_eq!(capture.halfmove_clock, 0);
    }

    #[test]
    fn a_position_repeats_by_key_but_not_by_clocks() {
        let a = Position::from_fen("4k3/8/8/8/8/8/8/4K3 w - - 0 1").expect("fen");
        let b = Position::from_fen("4k3/8/8/8/8/8/8/4K3 w - - 9 40").expect("fen");
        assert_eq!(a.repetition_key(), b.repetition_key());
        assert_ne!(a.to_fen(), b.to_fen());
    }
}
