//! Audit routine: verifies a revealed board against its commitment, checks it
//! is a legal fleet, and replays the answers its owner gave against it.
//!
//! Run by EVERY reader over the reveals players publish at match end (see
//! `GameState::derive`), never by the board's owner alone: an audit only its
//! subject runs is an audit a cheater skips.

use sha2::{Digest, Sha256};

use crate::board::{Cell, BOARD_SIZE};
use crate::is_ship_cell;

/// The standard fleet, by ship length: one each of 5, 4 and 2, two of 3.
pub const FLEET: [usize; 5] = [2, 3, 3, 4, 5];

/// Ship cells in [`FLEET`] — the hits that sink every ship.
pub const FLEET_CELLS: u32 = 17;

#[derive(Debug, Clone, PartialEq)]
pub enum AuditFailure {
    CommitmentMismatch,
    InvalidFleet,
    ShotInconsistent {
        x: u8,
        y: u8,
        recorded: Cell,
        actual_is_ship: bool,
    },
}

impl core::fmt::Display for AuditFailure {
    fn fmt(&self, f: &mut core::fmt::Formatter<'_>) -> core::fmt::Result {
        match self {
            AuditFailure::CommitmentMismatch => write!(f, "commitment_mismatch"),
            AuditFailure::InvalidFleet => write!(f, "invalid_fleet"),
            AuditFailure::ShotInconsistent {
                x,
                y,
                recorded,
                actual_is_ship,
            } => write!(
                f,
                "shot_inconsistent(x={x}, y={y}, recorded={recorded:?}, actual_is_ship={actual_is_ship})"
            ),
        }
    }
}

/// Recompute `SHA256(board_bytes || salt)` and compare against the published commitment.
pub fn verify_commitment(board_bytes: &[u8], salt: &[u8; 16], expected: &[u8; 32]) -> bool {
    let mut h = Sha256::new();
    h.update(board_bytes);
    h.update(salt);
    let got: [u8; 32] = h.finalize().into();
    &got == expected
}

/// Is `cells` a board `place_ships` could have produced: 100 cells of only
/// empty water and ship, whose ships are straight, never touch — diagonals
/// included — and are exactly [`FLEET`]?
///
/// Ships that do not touch make each 8-connected group of ship cells exactly
/// one ship, so the check is: every group is a straight, gap-free line, and
/// the lengths are the fleet.
pub fn valid_fleet(cells: &[u8]) -> bool {
    let size = usize::from(BOARD_SIZE);
    let only_water_and_ship = cells
        .iter()
        .all(|&c| c == Cell::Empty.to_u8() || c == Cell::Ship.to_u8());
    if cells.len() != size * size || !only_water_and_ship {
        return false;
    }
    let mut seen = vec![false; cells.len()];
    let mut lengths = Vec::new();
    for start in 0..cells.len() {
        if seen[start] || !is_ship_cell(cells[start]) {
            continue;
        }
        let mut group = vec![start];
        seen[start] = true;
        let mut next = 0;
        while let Some(&idx) = group.get(next) {
            next += 1;
            let (x, y) = ((idx % size) as i32, (idx / size) as i32);
            for dy in -1..=1 {
                for dx in -1..=1 {
                    let (nx, ny) = (x + dx, y + dy);
                    if nx < 0 || ny < 0 || nx >= size as i32 || ny >= size as i32 {
                        continue;
                    }
                    let n = ny as usize * size + nx as usize;
                    if !seen[n] && is_ship_cell(cells[n]) {
                        seen[n] = true;
                        group.push(n);
                    }
                }
            }
        }
        let xs: Vec<usize> = group.iter().map(|i| i % size).collect();
        let ys: Vec<usize> = group.iter().map(|i| i / size).collect();
        let span = |v: &[usize]| v.iter().max().unwrap_or(&0) - v.iter().min().unwrap_or(&0) + 1;
        let straight = (span(&xs) == 1 && span(&ys) == group.len())
            || (span(&ys) == 1 && span(&xs) == group.len());
        if !straight {
            return false;
        }
        lengths.push(group.len());
    }
    lengths.sort_unstable();
    lengths == FLEET
}

/// Replay the answers a player gave — `(x, y, hit)` for every shot fired at
/// them — against their revealed board. A hit at water or a miss at a ship is
/// a lie.
pub fn check_answers(
    own_board_cells: &[u8],
    answers: &[(u8, u8, bool)],
) -> Result<(), AuditFailure> {
    for &(x, y, hit) in answers {
        let idx = usize::from(y) * usize::from(BOARD_SIZE) + usize::from(x);
        let Some(&cell) = own_board_cells.get(idx) else {
            continue;
        };
        let actual_is_ship = is_ship_cell(cell);
        if hit != actual_is_ship {
            return Err(AuditFailure::ShotInconsistent {
                x,
                y,
                recorded: if hit { Cell::Hit } else { Cell::Miss },
                actual_is_ship,
            });
        }
    }
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;

    fn board_with_ship_at(idx: usize) -> Vec<u8> {
        let mut b = vec![0u8; 100];
        b[idx] = Cell::Ship.to_u8();
        b
    }

    #[test]
    fn verify_commitment_accepts_matching_hash() {
        let board = board_with_ship_at(0);
        let salt = [5u8; 16];
        let mut h = Sha256::new();
        h.update(&board);
        h.update(salt);
        let expected: [u8; 32] = h.finalize().into();
        assert!(verify_commitment(&board, &salt, &expected));
    }

    #[test]
    fn verify_commitment_rejects_tampered_board() {
        let board = board_with_ship_at(0);
        let salt = [5u8; 16];
        let mut h = Sha256::new();
        h.update(&board);
        h.update(salt);
        let expected: [u8; 32] = h.finalize().into();

        let mut tampered = board.clone();
        tampered[0] = 0;
        assert!(!verify_commitment(&tampered, &salt, &expected));
    }

    #[test]
    fn verify_commitment_rejects_wrong_salt() {
        let board = board_with_ship_at(0);
        let salt = [5u8; 16];
        let mut h = Sha256::new();
        h.update(&board);
        h.update(salt);
        let expected: [u8; 32] = h.finalize().into();
        let wrong_salt = [6u8; 16];
        assert!(!verify_commitment(&board, &wrong_salt, &expected));
    }

    /// The e2e scenario's fleet: 2 at row 0, 3s at rows 2 and 4, 4 at row 6,
    /// 5 at row 8.
    fn fleet_board() -> Vec<u8> {
        let mut b = vec![0u8; 100];
        for (y, len) in [(0usize, 2usize), (2, 3), (4, 3), (6, 4), (8, 5)] {
            for x in 0..len {
                b[y * 10 + x] = Cell::Ship.to_u8();
            }
        }
        b
    }

    #[test]
    fn a_legal_fleet_is_valid() {
        assert!(valid_fleet(&fleet_board()));
    }

    #[test]
    fn a_missing_ship_touching_ships_or_a_bent_ship_is_not_a_fleet() {
        let mut short = fleet_board();
        short[8 * 10 + 4] = 0;
        assert!(!valid_fleet(&short), "the carrier is one short");

        let mut touching = fleet_board();
        // Move the destroyer down a row so it touches the first cruiser
        // diagonally.
        touching[0] = 0;
        touching[1] = 0;
        touching[10 + 3] = Cell::Ship.to_u8();
        touching[10 + 4] = Cell::Ship.to_u8();
        assert!(!valid_fleet(&touching));

        let mut bent = fleet_board();
        bent[8 * 10 + 4] = 0;
        bent[9 * 10 + 3] = Cell::Ship.to_u8();
        assert!(!valid_fleet(&bent));

        assert!(!valid_fleet(&[0u8; 100]));
        assert!(!valid_fleet(&[1u8; 99]));
    }

    #[test]
    fn answers_are_checked_against_the_board() {
        let board = fleet_board();
        assert!(check_answers(&board, &[(0, 0, true), (9, 9, false)]).is_ok());
        assert!(
            check_answers(&board, &[(0, 0, false)]).is_err(),
            "a ship called a miss"
        );
        assert!(
            check_answers(&board, &[(9, 9, true)]).is_err(),
            "water called a hit"
        );
    }
}
