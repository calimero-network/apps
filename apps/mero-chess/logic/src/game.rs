//! Replaying a stored move list into a position.
//!
//! The contract stores MOVES, never a board. Every reader — the mover's own
//! node, a joining peer, a spectator — derives the position by replaying the
//! list from the initial array, so there is no board state that can be wrong
//! while the moves are right.
//!
//! That choice is what makes the game converge under CRDT merge. Moves are
//! keyed by ply, so two nodes that disagree about ply 7 (because both players
//! moved at the same instant) resolve to ONE winner deterministically; the
//! replay then continues from the winner, and any move that was legal only in
//! the losing line stops the replay rather than corrupting it. A board stored
//! as state could not do this: it would merge field by field into a position no
//! game ever reached.

use crate::board::Position;
use crate::movegen::{claimable_draw, legal_moves, outcome, ClaimableDraw, Outcome};
use crate::notation::parse_uci;

/// The result of replaying a move list.
pub struct Replay {
    /// The position after the last move that could be applied.
    pub position: Position,
    /// The SAN of each applied move, in order, **recomputed here**.
    ///
    /// Never read from storage. SAN depends on the position ("which knight?"),
    /// so it is derived state like the board is — and a stored one is a string
    /// a byzantine writer controls. Deriving it means a forged record cannot
    /// make the scoresheet say `Qxf7#` while the board says `e4`.
    pub sans: Vec<String>,
    /// Every position that has occurred, as repetition keys, including the
    /// current one — the input to threefold and fivefold detection.
    pub keys: Vec<String>,
    /// How many of the supplied moves were applied.
    ///
    /// Less than `moves.len()` means the list contains a move that is not legal
    /// in the position its predecessors produce. That is not corruption: it is
    /// what a merge looks like when a concurrent write won a ply that a later
    /// move was built on. Everything from there on is ignored, by every replica
    /// alike, so all of them still agree.
    pub applied: usize,
}

impl Replay {
    /// How this game stands: `Some` when it is over on the board alone.
    #[must_use]
    pub fn outcome(&self) -> Option<Outcome> {
        outcome(&self.position, &self.keys)
    }

    /// The draw the side to move could claim, if any.
    #[must_use]
    pub fn claimable(&self) -> Option<ClaimableDraw> {
        claimable_draw(&self.position, &self.keys)
    }

    /// Every move the side to move may play, in UCI.
    #[must_use]
    pub fn legal_uci(&self) -> Vec<String> {
        let mut moves: Vec<String> = legal_moves(&self.position)
            .into_iter()
            .map(crate::notation::move_to_uci)
            .collect();
        // Sorted so the ABI's answer is stable: an unordered list would make
        // every poll look like a change to a client diffing it.
        moves.sort();
        moves
    }
}

/// Replay UCI moves from the initial position, stopping at the first one that
/// is not legal.
#[must_use]
pub fn replay<S: AsRef<str>>(moves: &[S]) -> Replay {
    let mut position = Position::initial();
    let mut keys = vec![position.repetition_key()];
    let mut sans = Vec::new();
    let mut applied = 0;

    for text in moves {
        let Some(mv) = parse_uci(text.as_ref()) else {
            break;
        };
        // Matched against the generated list rather than validated ad hoc: that
        // is one definition of legality for the whole app, and it also fills in
        // the promotion piece the same way for every caller.
        let Some(&chosen) = legal_moves(&position).iter().find(|candidate| {
            candidate.from == mv.from
                && candidate.to == mv.to
                // A promotion with no piece named is a queening, which is what a
                // board does when you drag a pawn onto the last rank.
                && (mv.promotion.is_none() || candidate.promotion == mv.promotion)
        }) else {
            break;
        };
        sans.push(crate::notation::san(&position, chosen));
        position = position.apply(chosen);
        keys.push(position.repetition_key());
        applied += 1;
    }

    Replay {
        position,
        sans,
        keys,
        applied,
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::board::Color;

    #[test]
    fn an_empty_list_replays_to_the_starting_position() {
        let game = replay::<String>(&[]);
        assert_eq!(game.position, Position::initial());
        assert_eq!(game.applied, 0);
        assert_eq!(game.legal_uci().len(), 20);
        assert_eq!(game.outcome(), None);
    }

    #[test]
    fn fools_mate_replays_to_checkmate() {
        let game = replay(&["f2f3", "e7e5", "g2g4", "d8h4"]);
        assert_eq!(game.applied, 4);
        assert_eq!(
            game.outcome(),
            Some(Outcome::Checkmate {
                winner: Color::Black
            })
        );
        assert!(game.legal_uci().is_empty());
    }

    #[test]
    fn replay_stops_at_the_first_move_that_is_not_legal() {
        // `e2e4` twice: the second one has no pawn to move. Everything after it
        // is ignored, and the position is the one after the FIRST move.
        let game = replay(&["e2e4", "e2e4", "e7e5"]);
        assert_eq!(game.applied, 1);
        assert_eq!(game.position.side_to_move, Color::Black);
    }

    #[test]
    fn a_move_that_is_not_uci_at_all_stops_the_replay() {
        let game = replay(&["e2e4", "castle", "e7e5"]);
        assert_eq!(game.applied, 1);
    }

    #[test]
    fn threefold_becomes_claimable_and_fivefold_ends_the_game() {
        // Knights out and back, three times over. After the third occurrence of
        // the starting position the draw is claimable; after the fifth it is
        // automatic.
        let shuffle = [
            "g1f3", "g8f6", "f3g1", "f6g8", // 2nd occurrence of the start
            "g1f3", "g8f6", "f3g1", "f6g8", // 3rd — claimable
        ];
        let game = replay(&shuffle);
        assert_eq!(game.applied, 8);
        assert_eq!(game.claimable(), Some(ClaimableDraw::ThreefoldRepetition));
        assert_eq!(game.outcome(), None);

        let mut longer: Vec<&str> = shuffle.to_vec();
        longer.extend_from_slice(&shuffle);
        let game = replay(&longer);
        assert_eq!(game.outcome(), Some(Outcome::FivefoldRepetition));
        // Nothing is claimable once the game is over on its own.
        assert_eq!(game.claimable(), None);
    }

    #[test]
    fn legal_moves_come_back_sorted_so_a_poll_looks_stable() {
        let game = replay(&["e2e4"]);
        let once = game.legal_uci();
        let mut sorted = once.clone();
        sorted.sort();
        assert_eq!(once, sorted);
    }
}
