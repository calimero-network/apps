//! The rules of Battleships, independent of any SDK.
//!
//! What v1's game service crate held besides its contract: the board and its
//! cells ([`board`]), ships and the fleet ([`ships`], [`validation`]), the
//! reference placement the client mirrors ([`players`]) and the audit every
//! reader runs over a revealed board ([`audit`]). The contract (`../../src`)
//! uses [`audit`], [`board`] and [`commitment`]; the rest is what the tests
//! build boards with and what `app/src/lib/board.ts` mirrors.

pub mod audit;
pub mod board;
pub mod players;
pub mod ships;
pub mod validation;

use board::Cell;
use sha2::{Digest, Sha256};

/// A rule a board or a placement broke. v1's `battleships_types::GameError`,
/// of which the rules only ever raised `Invalid`.
#[derive(Debug, Clone, PartialEq, Eq)]
pub enum GameError {
    Invalid(String),
}

impl core::fmt::Display for GameError {
    fn fmt(&self, f: &mut core::fmt::Formatter<'_>) -> core::fmt::Result {
        match self {
            GameError::Invalid(message) => write!(f, "invalid input: {message}"),
        }
    }
}

impl std::error::Error for GameError {}

/// Is `value` a ship cell?
pub fn is_ship_cell(value: u8) -> bool {
    Cell::from_u8(value) == Cell::Ship
}

/// `borsh(Vec<u8>)` of the board's cells: a 4-byte little-endian length, then
/// the cells. What the client hashes into its commitment and sends at the
/// reveal; v1 framed it with borsh, and the bytes are unchanged.
pub fn board_bytes(cells: &[u8]) -> Vec<u8> {
    let len = u32::try_from(cells.len()).unwrap_or(u32::MAX);
    let mut out = Vec::with_capacity(4 + cells.len());
    out.extend_from_slice(&len.to_le_bytes());
    out.extend_from_slice(cells);
    out
}

/// The cells inside [`board_bytes`], or `None` when the framing is wrong (a
/// length that is not the rest of the bytes), as borsh refused it.
pub fn cells_of(board_bytes: &[u8]) -> Option<&[u8]> {
    let (len, cells) = board_bytes.split_first_chunk::<4>()?;
    (usize::try_from(u32::from_le_bytes(*len)).ok()? == cells.len()).then_some(cells)
}

/// `SHA256(board_bytes || salt)`: the commitment a player files.
pub fn commitment(board_bytes: &[u8], salt: &[u8]) -> [u8; 32] {
    let mut h = Sha256::new();
    h.update(board_bytes);
    h.update(salt);
    h.finalize().into()
}

#[cfg(test)]
mod tests {
    use super::*;
    use players::PlayerBoard;

    const ALICE_FLEET: [&str; 5] = [
        "0,0;1,0",
        "0,2;1,2;2,2",
        "0,4;1,4;2,4",
        "0,6;1,6;2,6;3,6",
        "0,8;1,8;2,8;3,8;4,8",
    ];

    #[test]
    fn is_ship_cell_identifies_ship_sentinel() {
        assert!(is_ship_cell(Cell::Ship.to_u8()));
        assert!(!is_ship_cell(Cell::Empty.to_u8()));
        assert!(!is_ship_cell(Cell::Hit.to_u8()));
        assert!(!is_ship_cell(Cell::Miss.to_u8()));
        assert!(!is_ship_cell(Cell::Pending.to_u8()));
    }

    #[test]
    fn board_bytes_round_trip_and_refuse_a_wrong_length() {
        let bytes = board_bytes(&[1, 0, 0, 1]);
        assert_eq!(bytes, [4, 0, 0, 0, 1, 0, 0, 1]);
        assert_eq!(cells_of(&bytes), Some(&[1u8, 0, 0, 1][..]));
        assert_eq!(cells_of(&bytes[..7]), None);
        assert_eq!(cells_of(&[1, 0]), None);
    }

    #[test]
    fn commitment_matches_manual_sha256() {
        let bytes = board_bytes(&[1u8, 0, 0, 1]);
        let salt = [9u8; 16];
        let mut h = Sha256::new();
        h.update(&bytes);
        h.update(salt);
        let expected: [u8; 32] = h.finalize().into();
        assert_eq!(commitment(&bytes, &salt), expected);
    }

    /// The vector the client test (`lib/commitment.test.ts`) pins to: the
    /// borsh framing is a 4-byte little-endian length, and the salt follows
    /// the bytes. A client that frames differently commits to a board it can
    /// never reveal.
    #[test]
    fn commitment_vector_shared_with_the_client() {
        let mut pb = PlayerBoard::new();
        pb.place_ships(ALICE_FLEET.iter().map(|s| (*s).to_owned()).collect())
            .expect("a legal fleet");
        let cells = pb.get_board().0.clone();
        let bytes = board_bytes(&cells);
        assert_eq!(&bytes[..4], &100u32.to_le_bytes());
        assert_eq!(&bytes[4..], &cells[..]);
        let hex: String = commitment(&bytes, &[0xA5; 16])
            .iter()
            .map(|b| format!("{b:02x}"))
            .collect();
        assert_eq!(
            hex,
            "37188894d025229c47a83365463dbc5e15d7a267aa13ef63f4d963b0d03def4f"
        );
    }
}
