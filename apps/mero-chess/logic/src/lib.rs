//! Mero Chess — a chess table that is a Calimero context.
//!
//! Two people sit down, the moves replicate, and there is no server in the
//! middle: the contract runs on each player's own node and the move list
//! converges as a CRDT. The rules live here too, in `board` / `movegen` /
//! `notation`, so a client cannot play an illegal move by asking nicely — and
//! a client does not have to implement chess to be a full participant, because
//! the contract hands it the legal moves for the position.
//!
//! ## What is stored, and why it converges
//!
//! **Moves, keyed by ply. Never a board.** `moves` is
//! `UnorderedMap<"<game>/<ply>", MoveRecord>` and every position in the app is
//! derived by replaying it (see [`game::replay`]). Two nodes that concurrently
//! write the same ply — both players moving in the same instant, each valid
//! against the state they could see — merge to ONE record by a total order
//! over (timestamp, encoded bytes), so both replicas elect the same winner and
//! the game continues from it. A stored BOARD could not do that: it would merge
//! field by field into a position no game ever reached.
//!
//! **Seats are first-claim-wins.** Two people claiming White at once resolve
//! the same way on every replica, so nobody ends up holding a seat on their own
//! node and not on anyone else's.
//!
//! **Endings are stored only when a PERSON ends the game** — a resignation, an
//! agreed draw, a claimed one. Checkmate, stalemate, insufficient material,
//! fivefold and the seventy-five-move rule are properties of the move list and
//! are derived on read, so they need no write and cannot disagree with it.
//!
//! ## What holds against a node that does not run this code
//!
//! A peer's node folds an incoming delta into storage: it verifies the author's
//! signature, authorizes them at their causal cut, and applies the actions. It
//! does NOT execute this contract. So a patched node can put whatever bytes it
//! likes into any entity it is allowed to write, and the checks in `play` bind
//! only the node that runs them. Two things follow, and they shape every read
//! below:
//!
//! **Nothing is trusted that can be derived.** The position, the SAN, the ply
//! ordering, the result and the current game index are all recomputed on every
//! read, from the moves, by the reader. A forged record is inert: it sits in
//! storage and in the root hash, and no honest node ever folds it into a
//! position. This is quarantine at interpretation, not prevention at write —
//! the write cannot be prevented, because nothing re-executes at receive time.
//!
//! **Everything else is owned.** Every entity a player writes lives in an
//! [`AuthoredMap`], whose entries carry a `StorageType::User { owner }` stamp.
//! Core verifies a per-action signature against that owner inside
//! `Interface::apply_action` on every receive path — a remote `User` action
//! with no signature is refused outright — so a member cannot author an entry
//! as someone else. Keys name their author and the reader re-checks the stamp,
//! which is what makes "White's move at ply 6" a claim only White can make.
//!
//! What remains is that a player can stall: squat a key the reader is waiting
//! on, or simply stop moving. Neither changes a result, and both are available
//! to anyone who can walk away from a board.

use std::cmp::Ordering;

use calimero_sdk::abi::AbiType;
use calimero_sdk::borsh::{BorshDeserialize, BorshSerialize};
use calimero_sdk::serde::{Deserialize, Serialize};
use calimero_sdk::{app, env as sdk_env, PublicKey};
use calimero_storage::collections::crdt_meta::MergeError;
use calimero_storage::collections::{AuthoredMap, LwwRegister, Mergeable as MergeableTrait};

pub mod board;
pub mod game;
pub mod movegen;
pub mod notation;

// `TestHost`'s bridge is generated under `#[cfg(test)]`, so it exists only for
// tests compiled INSIDE this crate. An integration test under `tests/` links
// the ordinary build and cannot drive it — which is why the rules live here and
// `tests/converge.rs`, which needs no bridge, lives there.
#[cfg(test)]
mod tests;

use board::Color;
use movegen::{in_check, ClaimableDraw, Outcome};

/// A player's identity, hex-encoded. See [`MeroChess::caller`] for which of the
/// node's two ids this is, and why.
type MemberId = String;

/// Hard ceiling on one game's move list.
///
/// 600 plies is 300 moves a side — about twice the longest tournament game ever
/// recorded. It is not a rule of chess; it is the bound that stops a context's
/// state growing without limit, and every read replays the whole list.
const MAX_PLY: u32 = 600;

/// Display names are shown to the other player, so they are bounded and
/// stripped of control characters at the door.
const MAX_NAME_LEN: usize = 32;

/// How long after a heartbeat a player still reads as present, in milliseconds.
const PRESENCE_TTL_MS: u64 = 30_000;

/// The two seats, named after the colour they hold in the FIRST game.
///
/// Colours swap every rematch — that is ordinary chess etiquette — so the seat
/// name is an identity, not a claim about the current game. Ask
/// [`MeroChess::seat_for_color`] which seat is White right now.
const SEAT_WHITE: &str = "white";
const SEAT_BLACK: &str = "black";

// ── CRDT merge rules ─────────────────────────────────────────────────────────

/// Take `other` iff it wins a **total order** over (clock, canonical bytes).
///
/// The byte tie-break is not decoration. A bare `other.ts > self.ts` is not
/// commutative: at an exact clock tie with differing content each replica keeps
/// its own copy, `merge` changes nothing on either side, and the two stay
/// divergent forever with no error anywhere. Comparing the borsh encoding — a
/// total order over values — makes both replicas elect the same winner
/// independently, which is what convergence requires.
fn later_wins<T: BorshSerialize>(mine_ts: u64, theirs_ts: u64, mine: &T, theirs: &T) -> bool {
    match theirs_ts.cmp(&mine_ts) {
        Ordering::Greater => true,
        Ordering::Less => false,
        Ordering::Equal => encoded_gt(theirs, mine),
    }
}

/// The same total order, read the other way: the EARLIEST write wins.
///
/// Used for everything a player claims rather than updates — a seat, a ply, the
/// end of a game. "First one wins" is the rule a person expects for a claim,
/// and unlike last-writer-wins it cannot be taken away from them later by a
/// node whose clock runs fast.
fn earlier_wins<T: BorshSerialize>(mine_ts: u64, theirs_ts: u64, mine: &T, theirs: &T) -> bool {
    match theirs_ts.cmp(&mine_ts) {
        Ordering::Less => true,
        Ordering::Greater => false,
        Ordering::Equal => encoded_gt(theirs, mine),
    }
}

/// Compare two values by their canonical borsh encoding.
///
/// Infallible on purpose. Core's contract for a dispatched merge requires a
/// TOTAL rule — an `Err` is not validation, it is a refusal to converge, and
/// the entity then stays divergent while repair retries it forever. A value
/// that came back out of storage was borsh-encoded to get there, so the
/// fallback is unreachable rather than merely unlikely.
fn encoded_gt<T: BorshSerialize>(a: &T, b: &T) -> bool {
    let encode = |v: &T| calimero_sdk::borsh::to_vec(v).unwrap_or_default();
    encode(a) > encode(b)
}

// ── Stored records ───────────────────────────────────────────────────────────

#[app::mergeable(id = "mero-chess::Player")]
#[derive(BorshSerialize, BorshDeserialize, Serialize, Deserialize, AbiType, Clone, Debug)]
#[borsh(crate = "calimero_sdk::borsh")]
#[serde(crate = "calimero_sdk::serde")]
pub struct Player {
    pub id: MemberId,
    pub name: String,
    pub joined_at: u64,
    pub updated_at: u64,
}

impl MergeableTrait for Player {
    fn merge(&mut self, other: &Self) -> Result<(), MergeError> {
        if later_wins(self.updated_at, other.updated_at, self, other) {
            *self = other.clone();
        }
        Ok(())
    }
}

/// One person's claim on one chair.
///
/// Keyed `"<seat>/<account>"` and owned by that account, so a claim is
/// something only its claimant can make. The reader elects the winner (see
/// [`MeroChess::seat_member`]) rather than the writers racing for one key,
/// which is also what stops a second claimant from squatting the chair's key
/// before its rightful holder reaches it.
#[app::mergeable(id = "mero-chess::Seat")]
#[derive(BorshSerialize, BorshDeserialize, Serialize, Deserialize, AbiType, Clone, Debug)]
#[borsh(crate = "calimero_sdk::borsh")]
#[serde(crate = "calimero_sdk::serde")]
pub struct Seat {
    pub member: MemberId,
    pub name: String,
    pub claimed_at: u64,
}

impl MergeableTrait for Seat {
    fn merge(&mut self, other: &Self) -> Result<(), MergeError> {
        // Two versions of ONE person's claim — only they can write this key, so
        // this is a retry, not a race. The race between two DIFFERENT claimants
        // is resolved by the reader, over separate keys.
        if earlier_wins(self.claimed_at, other.claimed_at, self, other) {
            *self = other.clone();
        }
        Ok(())
    }
}

/// One played move. `uci` is the move; `san` is how it reads.
///
/// SAN is computed here, once, by the node that played the move — it depends on
/// the position ("which knight?"), so two clients recomputing it from a replay
/// could word the same move differently.
#[app::mergeable(id = "mero-chess::MoveRecord")]
#[derive(BorshSerialize, BorshDeserialize, Serialize, Deserialize, AbiType, Clone, Debug)]
#[borsh(crate = "calimero_sdk::borsh")]
#[serde(crate = "calimero_sdk::serde")]
pub struct MoveRecord {
    pub game: u32,
    pub ply: u32,
    pub uci: String,
    pub san: String,
    pub by: MemberId,
    pub at: u64,
}

impl MergeableTrait for MoveRecord {
    fn merge(&mut self, other: &Self) -> Result<(), MergeError> {
        // A ply is claimed, not updated. Ordering comes from the KEY, so a
        // clock that is wrong cannot reorder a game — it can only decide which
        // of two genuinely simultaneous moves takes the ply.
        if earlier_wins(self.at, other.at, self, other) {
            *self = other.clone();
        }
        Ok(())
    }
}

/// A game ended by a PERSON: a resignation, an agreed draw, a claimed one.
///
/// Board endings (checkmate, stalemate, dead position, fivefold, seventy-five
/// moves) are derived from the move list and never stored.
#[app::mergeable(id = "mero-chess::Ending")]
#[derive(BorshSerialize, BorshDeserialize, Serialize, Deserialize, AbiType, Clone, Debug)]
#[borsh(crate = "calimero_sdk::borsh")]
#[serde(crate = "calimero_sdk::serde")]
pub struct Ending {
    /// `1-0`, `0-1` or `1/2-1/2`.
    pub result: String,
    /// `resignation`, `agreement`, `threefold`, `fiftyMove`.
    pub reason: String,
    pub by: MemberId,
    /// The ply the game stood at when this was written.
    ///
    /// Load-bearing, not bookkeeping: it is what lets the reader re-check a
    /// claimed draw against the position it was claimed in, and an agreement
    /// against the offer it answered. An ending nobody can re-derive is an
    /// ending a byzantine writer can invent.
    pub ply: u32,
    pub at: u64,
}

impl MergeableTrait for Ending {
    fn merge(&mut self, other: &Self) -> Result<(), MergeError> {
        // Whoever ended it first ended it. A resignation that crosses an
        // acceptance on the wire must not flip between replicas.
        if earlier_wins(self.at, other.at, self, other) {
            *self = other.clone();
        }
        Ok(())
    }
}

/// A standing draw offer, from one player, in one game.
///
/// `ply` is what makes it expire: an offer is good only for the position it was
/// made in, exactly as at a board, so a move made after it silently voids it.
#[app::mergeable(id = "mero-chess::DrawOffer")]
#[derive(BorshSerialize, BorshDeserialize, Serialize, Deserialize, AbiType, Clone, Debug)]
#[borsh(crate = "calimero_sdk::borsh")]
#[serde(crate = "calimero_sdk::serde")]
pub struct DrawOffer {
    pub open: bool,
    /// Set when this row is an ANSWER to the opponent's offer rather than an
    /// offer of its own.
    ///
    /// It exists because only an entry's owner may write it: declining cannot
    /// reach into the offerer's row to close it, so the refusal is recorded
    /// here and [`MeroChess::offer_stands`] reads the pair.
    pub declined: bool,
    pub ply: u32,
    pub at: u64,
}

impl MergeableTrait for DrawOffer {
    fn merge(&mut self, other: &Self) -> Result<(), MergeError> {
        if later_wins(self.at, other.at, self, other) {
            *self = other.clone();
        }
        Ok(())
    }
}

/// One game at this table. Game 0 exists from the moment the context does.
#[app::mergeable(id = "mero-chess::GameRecord")]
#[derive(BorshSerialize, BorshDeserialize, Serialize, Deserialize, AbiType, Clone, Debug)]
#[borsh(crate = "calimero_sdk::borsh")]
#[serde(crate = "calimero_sdk::serde")]
pub struct GameRecord {
    pub index: u32,
    pub started_at: u64,
    pub started_by: MemberId,
}

impl MergeableTrait for GameRecord {
    fn merge(&mut self, other: &Self) -> Result<(), MergeError> {
        if earlier_wins(self.started_at, other.started_at, self, other) {
            *self = other.clone();
        }
        Ok(())
    }
}

// ── Views ────────────────────────────────────────────────────────────────────
//
// Views carry strings and sentinels rather than `Option`s and enums, because
// the ABI flattens an `Option<T>` to `T` and a client then reads a
// non-nullable type that is sometimes null. An empty string is honest in both.
//
// ⚠️ And NO `#[serde(rename_all = "camelCase")]`, anywhere in this file. The
// ABI emitter reads the RUST field names and ignores serde's attributes, so a
// camelCase rename produces a contract whose wire says `sideToMove` and whose
// generated TypeScript client says `side_to_move` — the client typechecks, the
// call succeeds, and every renamed field reads as `undefined` at runtime. The
// names below are therefore the wire, the ABI and the client, all at once.

#[derive(BorshSerialize, BorshDeserialize, Serialize, Deserialize, AbiType, Clone, Debug)]
#[borsh(crate = "calimero_sdk::borsh")]
#[serde(crate = "calimero_sdk::serde")]
pub struct SeatView {
    /// `white` or `black` — which chair this is, i.e. its colour in game 0.
    pub seat: String,
    /// The member holding it, or `""` when the chair is free.
    pub member: MemberId,
    pub name: String,
    pub online: bool,
}

#[derive(BorshSerialize, BorshDeserialize, Serialize, Deserialize, AbiType, Clone, Debug)]
#[borsh(crate = "calimero_sdk::borsh")]
#[serde(crate = "calimero_sdk::serde")]
pub struct MoveView {
    pub ply: u32,
    pub uci: String,
    pub san: String,
    pub by: MemberId,
    pub at: u64,
}

#[derive(BorshSerialize, BorshDeserialize, Serialize, Deserialize, AbiType, Clone, Debug)]
#[borsh(crate = "calimero_sdk::borsh")]
#[serde(crate = "calimero_sdk::serde")]
pub struct PlayerView {
    pub id: MemberId,
    pub name: String,
    pub online: bool,
    /// `white`, `black` or `""` — this player's colour in the CURRENT game.
    pub color: String,
}

#[derive(BorshSerialize, BorshDeserialize, Serialize, Deserialize, AbiType, Clone, Debug)]
#[borsh(crate = "calimero_sdk::borsh")]
#[serde(crate = "calimero_sdk::serde")]
pub struct GameSummary {
    pub index: u32,
    pub started_at: u64,
    /// `1-0`, `0-1`, `1/2-1/2`, or `*` while it is still being played.
    pub result: String,
    pub reason: String,
    pub plies: u32,
    /// The member who had White in that game.
    pub white: MemberId,
    pub black: MemberId,
}

/// Everything a client needs to draw the table, in one call.
///
/// Deliberately ONE view rather than a dozen getters. Every field here is
/// derived from the same replay of the move list, so serving them separately
/// would replay the game once per call and — worse — let a client paint a board
/// from one moment next to a status from another.
#[derive(BorshSerialize, BorshDeserialize, Serialize, Deserialize, AbiType, Clone, Debug)]
#[borsh(crate = "calimero_sdk::borsh")]
#[serde(crate = "calimero_sdk::serde")]
pub struct TableView {
    pub title: String,
    pub created_at: u64,
    /// Index of the game being played now.
    pub game: u32,
    /// The position after every move that has been played, as a FEN.
    pub fen: String,
    /// `white` or `black`.
    pub side_to_move: String,
    pub moves: Vec<MoveView>,
    /// Every legal move in this position, in UCI, sorted.
    ///
    /// The contract is the only implementation of the rules in this app: a
    /// client highlights squares from this list rather than shipping a second
    /// engine that could disagree with it.
    pub legal_moves: Vec<String>,
    /// `awaitingPlayers`, `inProgress` or `finished`.
    pub status: String,
    /// `1-0`, `0-1`, `1/2-1/2`, or `*` while the game is unfinished.
    pub result: String,
    /// Why it ended: `checkmate`, `stalemate`, `insufficientMaterial`,
    /// `fivefold`, `seventyFiveMove`, `resignation`, `agreement`, `threefold`,
    /// `fiftyMove` — or `""`.
    pub reason: String,
    pub check: bool,
    /// `threefold`, `fiftyMove` or `""` — a draw the side to move may claim.
    pub claimable_draw: String,
    pub white: SeatView,
    pub black: SeatView,
    /// The caller's own id, as the contract sees it. Never trust a client to
    /// tell you who it is; this is what it actually was.
    pub me: MemberId,
    /// The caller's colour in this game, or `""` for a spectator.
    pub my_color: String,
    pub my_turn: bool,
    /// The member whose draw offer is standing in this position, or `""`.
    pub draw_offer_from: MemberId,
    pub players: Vec<PlayerView>,
    /// How many games this table has started, including the current one.
    pub games_played: u32,
}

// ── Events ───────────────────────────────────────────────────────────────────

/// A nudge, not the truth. Every event tells a client that something changed;
/// the client then re-reads [`MeroChess::table`], which is derived state and
/// cannot be stale in the way an event payload can.
#[app::event]
pub enum Event {
    Initialized(),
    PlayerJoined(MemberId),
    Seated {
        seat: String,
        member: MemberId,
    },
    Vacated {
        seat: String,
        member: MemberId,
    },
    Moved {
        game: u32,
        ply: u32,
        san: String,
        by: MemberId,
    },
    GameEnded {
        game: u32,
        result: String,
        reason: String,
    },
    DrawOffered {
        game: u32,
        by: MemberId,
    },
    DrawDeclined {
        game: u32,
        by: MemberId,
    },
    GameStarted {
        game: u32,
    },
}

// ── State ────────────────────────────────────────────────────────────────────

/// Every map here is an [`AuthoredMap`] and every key names its author, so a
/// member can only ever write rows about themselves — enforced by core at merge
/// time, not by this code. The reader elects and re-derives; see the module
/// docs for why that split is the whole security model.
#[app::state(emits = Event)]
pub struct MeroChess {
    title: LwwRegister<String>,
    created_at: LwwRegister<u64>,
    /// `<account>` -> that person's presence row.
    players: AuthoredMap<MemberId, Player>,
    /// `"<seat>/<account>"` -> one person's claim on that chair.
    seat_claims: AuthoredMap<String, Seat>,
    /// `"<game>/<account>"` -> a claim that this player started that rematch.
    games: AuthoredMap<String, GameRecord>,
    /// `"<game>/<ply>/<account>"` -> the move that player wrote at that ply.
    moves: AuthoredMap<String, MoveRecord>,
    /// `"<game>/<account>"` -> how that player says the game ended.
    endings: AuthoredMap<String, Ending>,
    /// `"<game>/<account>"` -> that player's standing offer.
    draw_offers: AuthoredMap<String, DrawOffer>,
}

#[app::logic]
impl MeroChess {
    #[app::init]
    pub fn init(title: String, now: u64) -> MeroChess {
        app::emit!(Event::Initialized());
        // Game 0 is IMPLICIT — no record, because a record is something a
        // writer controls. `current_game` counts valid rematches up from zero,
        // so a peer cannot jump the table to game 9999 and leave every reader
        // staring at an empty board with the real game hidden behind it.
        MeroChess {
            title: LwwRegister::new(clean_name(&title, "Chess")),
            created_at: LwwRegister::new(now),
            players: AuthoredMap::new(),
            seat_claims: AuthoredMap::new(),
            games: AuthoredMap::new(),
            moves: AuthoredMap::new(),
            endings: AuthoredMap::new(),
            draw_offers: AuthoredMap::new(),
        }
    }

    // ── identity ────────────────────────────────────────────────────────────

    /// Who is calling, as the contract sees it.
    ///
    /// The ACCOUNT, not the device — audited against core's account/device
    /// split. The rule there is that an identity doing *ownership* takes the
    /// account: a writer set, an owner field, "is the caller allowed to do
    /// this". Every id in this contract is exactly that. A seat is owned, a
    /// resignation is an act of the person, and "is it your turn" is a question
    /// about a player rather than about a laptop.
    ///
    /// Keyed by device instead, the same person's phone could not move in a
    /// game their laptop had sat down for — they would read as a spectator on
    /// their own board. `one_person_plays_from_two_devices` holds this down.
    fn caller() -> PublicKey {
        sdk_env::account_id().into()
    }

    fn caller_id() -> MemberId {
        String::from(Self::caller())
    }

    /// Render a stored owner stamp the same way [`Self::caller_id`] renders the
    /// caller, so the two are comparable by construction rather than by two
    /// formatting routines that agree until one of them changes.
    fn owner_id(owner: &[u8; 32]) -> MemberId {
        String::from(PublicKey::from(*owner))
    }

    /// True when `key` in `map` is stamped with `expected` — the check every
    /// read does before believing a row.
    fn owned_by(owner: Option<MemberId>, expected: &str) -> bool {
        matches!(owner, Some(actual) if actual == expected && !expected.is_empty())
    }

    // ── reading the table ───────────────────────────────────────────────────

    /// The whole table in one call — see [`TableView`].
    pub fn table(&self, now: u64) -> app::Result<TableView> {
        let index = self.current_game()?;
        let moves = self.moves_of(index)?;
        let replayed = game::replay(&moves.iter().map(|m| m.uci.clone()).collect::<Vec<_>>());
        let (result, reason) = self.result_of(index, &replayed)?;

        let white_seat = self.seat_view(self.seat_for_color(index, Color::White), now)?;
        let black_seat = self.seat_view(self.seat_for_color(index, Color::Black), now)?;

        let me = Self::caller_id();
        // Deliberately via `color_of`, so a player in both chairs is reported
        // as the side to move and the board stays playable for each side in
        // turn rather than freezing after White's first move.
        let my_color = match self.color_of(index, &me, replayed.position.side_to_move)? {
            Some(color) => color_name(color),
            None => "",
        };

        let side_to_move = color_name(replayed.position.side_to_move);
        let unfinished = result == "*";
        let seated = !white_seat.member.is_empty() && !black_seat.member.is_empty();

        let status = if !unfinished {
            "finished"
        } else if seated {
            "inProgress"
        } else {
            "awaitingPlayers"
        };

        Ok(TableView {
            title: self.title.get().clone(),
            created_at: *self.created_at.get(),
            game: index,
            fen: replayed.position.to_fen(),
            side_to_move: side_to_move.to_owned(),
            // Truncated to what the REPLAY applied and labelled with the SAN
            // it derived. A stored row past the stopping point is not a move
            // that happened, and a stored `san` is a string its writer chose.
            moves: move_views(&moves, &replayed),
            // Withheld once the game is over, so a client cannot offer a move
            // in a finished game and get a refusal it could have predicted.
            legal_moves: if unfinished {
                replayed.legal_uci()
            } else {
                Vec::new()
            },
            status: status.to_owned(),
            result,
            reason,
            check: in_check(&replayed.position, replayed.position.side_to_move),
            claimable_draw: match replayed.claimable() {
                Some(ClaimableDraw::ThreefoldRepetition) => "threefold".to_owned(),
                Some(ClaimableDraw::FiftyMove) => "fiftyMove".to_owned(),
                None => String::new(),
            },
            my_turn: unfinished && seated && my_color == side_to_move,
            my_color: my_color.to_owned(),
            me,
            draw_offer_from: self.standing_offer(index, replayed.applied as u32)?,
            white: white_seat,
            black: black_seat,
            players: self.player_views(index, replayed.position.side_to_move, now)?,
            // COUNTED from the current index, not `games.len()`. Game 0 is
            // implicit — it has no row — so a row count is one short of the
            // truth from the first game and wrong again for every extra
            // rematch row a second player writes. `current_game` already walks
            // exactly the games this table validly reached.
            games_played: index.saturating_add(1),
        })
    }

    /// Every game this table has played, oldest first.
    pub fn history(&self) -> app::Result<Vec<GameSummary>> {
        let mut out = Vec::new();
        // Counted, not listed — same reason `current_game` counts. A game is in
        // the record because the table reached it, not because a row says so.
        for index in 0..=self.current_game()? {
            let moves = self.moves_of(index)?;
            let replayed = game::replay(&moves.iter().map(|m| m.uci.clone()).collect::<Vec<_>>());
            let (result, reason) = self.result_of(index, &replayed)?;
            let started_at = self
                .games
                .get(&game_key(index))?
                .map_or(0, |g| g.started_at);
            out.push(GameSummary {
                index,
                started_at,
                result,
                reason,
                plies: replayed.applied as u32,
                white: self.seat_member(self.seat_for_color(index, Color::White))?,
                black: self.seat_member(self.seat_for_color(index, Color::Black))?,
            });
        }
        Ok(out)
    }

    // ── sitting down ────────────────────────────────────────────────────────

    /// Announce yourself at the table, or refresh your presence and name.
    pub fn join(&mut self, name: String, now: u64) -> app::Result<()> {
        let id = Self::caller_id();
        let existing = self.players.get(&id)?;
        let joined_at = existing.as_ref().map_or(now, |p| p.joined_at);
        let known = existing.is_some();
        drop(existing);

        self.put_owned(
            |state| &mut state.players,
            &format!("{id}/"),
            &id,
            |nonce| player_key(&id, nonce),
            now,
            Player {
                id: id.clone(),
                name: clean_name(&name, "Guest"),
                joined_at,
                updated_at: now,
            },
        )?;
        if !known {
            app::emit!(Event::PlayerJoined(id));
        }
        Ok(())
    }

    /// Presence only — no event, so a heartbeat does not wake every client.
    pub fn heartbeat(&mut self, now: u64) -> app::Result<()> {
        let id = Self::caller_id();
        self.touch(&id, now)
    }

    /// Take the `white` or `black` chair, if it is free.
    ///
    /// The seat name is the colour you hold in the FIRST game; colours swap on
    /// every rematch.
    pub fn sit(&mut self, seat: String, name: String, now: u64) -> app::Result<()> {
        let seat = normalize_seat(&seat)?;
        let id = Self::caller_id();
        let display = clean_name(&name, "Guest");

        let holder = self.seat_member(&seat)?;
        if holder == id {
            return Ok(()); // already yours — idempotent, not an error
        }
        if !holder.is_empty() {
            app::bail!("that seat is taken");
        }
        // Taking BOTH chairs is allowed on purpose: one person, one node, a
        // board they move for each side in turn. It is how chess is played when
        // the other person is in the room, it is how a position gets analysed,
        // and it is the only way to use this app before anyone else has a node.
        // The rule that matters — a seat someone else holds is theirs — is
        // above, and nothing below this line distinguishes the two cases.

        let existing = self.players.get(&id)?;
        let joined_at = existing.as_ref().map_or(now, |p| p.joined_at);
        drop(existing);
        self.put_owned(
            |state| &mut state.players,
            &format!("{id}/"),
            &id,
            |nonce| player_key(&id, nonce),
            now,
            Player {
                id: id.clone(),
                name: display.clone(),
                joined_at,
                updated_at: now,
            },
        )?;
        // Under this claimant's own key. Whether the claim WINS the chair is
        // the reader's question, asked the same way on every node — see
        // `seat_member`.
        let key = Self::free_key(&self.seat_claims, &id, now, |nonce| {
            seat_key(&seat, &id, nonce)
        })?;
        self.put(
            |state| &mut state.seat_claims,
            key,
            &id,
            Seat {
                member: id.clone(),
                name: display,
                claimed_at: now,
            },
        )?;
        app::emit!(Event::Seated {
            seat,
            member: id.clone()
        });
        Ok(())
    }

    /// Give up your chair — allowed only before the current game has a move in
    /// it. Once a game is under way the way out is `resign`.
    pub fn stand(&mut self, now: u64) -> app::Result<()> {
        let id = Self::caller_id();
        let Some(seat) = self.seat_of(&id)? else {
            app::bail!("you are not seated");
        };
        let index = self.current_game()?;
        if !self.moves_of(index)?.is_empty() {
            app::bail!("this game has started — resign instead");
        }
        // Every row this player wrote for that chair — a squatted key can have
        // forced a retry, so there may be more than one. `remove` is
        // owner-enforced by the collection itself, so this can only ever take
        // away the caller's own claims.
        let mine: Vec<String> = Self::valid_rows(&self.seat_claims, &seat_prefix(&seat))?
            .into_iter()
            .map(|(key, _)| key)
            .filter(|key| key_author(key) == Some(id.as_str()))
            .collect();
        for key in mine {
            let _removed = self.seat_claims.remove(&key)?;
        }
        // Standing up is still a sign of life, and the parameter has to be
        // named `now` regardless: the ABI carries the RUST parameter names, so
        // an unused `_now` would reach the generated client as `_now` and every
        // call from it would be a deserialisation error.
        self.touch(&id, now)?;
        app::emit!(Event::Vacated {
            seat,
            member: id.clone()
        });
        Ok(())
    }

    // ── playing ─────────────────────────────────────────────────────────────

    /// Play a move, in UCI (`e2e4`, `e7e8q`). Returns its SAN.
    ///
    /// Every refusal here is a refusal the client could have predicted from
    /// `table()`: it holds the legal moves, whose turn it is, and whether the
    /// game is over. The checks exist because a client is not the authority on
    /// any of that — this is.
    pub fn play(&mut self, uci: String, now: u64) -> app::Result<String> {
        let id = Self::caller_id();
        let index = self.current_game()?;
        let moves = self.moves_of(index)?;
        let replayed = game::replay(&moves.iter().map(|m| m.uci.clone()).collect::<Vec<_>>());

        let (result, _reason) = self.result_of(index, &replayed)?;
        if result != "*" {
            app::bail!("this game is over");
        }

        let ply = replayed.applied as u32;
        if ply >= MAX_PLY {
            app::bail!("this game has reached the move limit");
        }

        // BOTH chairs, not just the one to move: a game with an empty chair has
        // no opponent to answer, and letting White open against nobody produces
        // a move list the other player later joins into the middle of.
        let holder =
            self.seat_member(self.seat_for_color(index, replayed.position.side_to_move))?;
        let waiting =
            self.seat_member(self.seat_for_color(index, replayed.position.side_to_move.other()))?;
        if holder.is_empty() || waiting.is_empty() {
            app::bail!("both seats must be taken before a move can be played");
        }
        if holder != id {
            app::bail!("it is not your move");
        }

        let Some(mv) = notation::parse_uci(&uci) else {
            app::bail!("that is not a move in UCI notation");
        };
        // Membership of the generated list IS the legality check — one
        // definition of the rules for the whole app, and it is the same list
        // the client was handed.
        let legal = movegen::legal_moves(&replayed.position);
        let Some(&chosen) = legal.iter().find(|candidate| {
            candidate.from == mv.from
                && candidate.to == mv.to
                // A promotion with no piece named is a queening, which is what
                // a board does when you drag a pawn to the last rank.
                && (mv.promotion.is_none() || candidate.promotion == mv.promotion)
        }) else {
            app::bail!("that move is not legal in this position");
        };

        let san = notation::san(&replayed.position, chosen);
        let record = MoveRecord {
            game: index,
            ply,
            uci: notation::move_to_uci(chosen),
            // Stored for a reader that wants it cheaply, never TRUSTED: every
            // view recomputes SAN from the position during the replay.
            san: san.clone(),
            by: id.clone(),
            at: now,
        };
        let key = Self::free_key(&self.moves, &id, now, |nonce| {
            move_key(index, ply, &id, nonce)
        })?;
        self.put(|state| &mut state.moves, key, &id, record)?;
        self.touch(&id, now)?;

        app::emit!(Event::Moved {
            game: index,
            ply,
            san: san.clone(),
            by: id.clone(),
        });

        // A move voids any standing offer, the same way it does at a board —
        // and announcing the ending here is what lets a client show "checkmate"
        // without replaying anything itself.
        let after = game::replay(
            &self
                .moves_of(index)?
                .iter()
                .map(|m| m.uci.clone())
                .collect::<Vec<_>>(),
        );
        if let Some(outcome) = after.outcome() {
            let (result, reason) = describe_outcome(outcome);
            app::emit!(Event::GameEnded {
                game: index,
                result,
                reason,
            });
        }

        Ok(san)
    }

    /// Resign the current game. Only a seated player can, and only while it is
    /// still being played.
    pub fn resign(&mut self, now: u64) -> app::Result<()> {
        let id = Self::caller_id();
        let index = self.current_game()?;
        let replayed = self.replay_game(index)?;
        let (result, _reason) = self.result_of(index, &replayed)?;
        if result != "*" {
            app::bail!("this game is over");
        }
        let Some(color) = self.color_of(index, &id, replayed.position.side_to_move)? else {
            app::bail!("only a seated player can resign");
        };

        let result = win_for(color.other());
        self.end_game(
            index,
            &result,
            "resignation",
            &id,
            replayed.applied as u32,
            now,
        )?;
        Ok(())
    }

    /// Offer a draw in the current position. The offer stands until the
    /// position changes.
    pub fn offer_draw(&mut self, now: u64) -> app::Result<()> {
        let id = Self::caller_id();
        let index = self.current_game()?;
        let replayed = self.replay_game(index)?;
        let (result, _reason) = self.result_of(index, &replayed)?;
        if result != "*" {
            app::bail!("this game is over");
        }
        if self
            .color_of(index, &id, replayed.position.side_to_move)?
            .is_none()
        {
            app::bail!("only a seated player can offer a draw");
        }

        self.put_owned(
            |state| &mut state.draw_offers,
            &claim_prefix(index, &id),
            &id,
            |nonce| claim_key(index, &id, nonce),
            now,
            DrawOffer {
                open: true,
                declined: false,
                ply: replayed.applied as u32,
                at: now,
            },
        )?;
        app::emit!(Event::DrawOffered {
            game: index,
            by: id.clone()
        });
        Ok(())
    }

    /// Accept the opponent's standing offer.
    pub fn accept_draw(&mut self, now: u64) -> app::Result<()> {
        let id = Self::caller_id();
        let index = self.current_game()?;
        let replayed = self.replay_game(index)?;
        let (result, _reason) = self.result_of(index, &replayed)?;
        if result != "*" {
            app::bail!("this game is over");
        }
        let Some(color) = self.color_of(index, &id, replayed.position.side_to_move)? else {
            app::bail!("only a seated player can accept a draw");
        };

        let opponent = self.seat_member(self.seat_for_color(index, color.other()))?;
        let offered = self.standing_offer(index, replayed.applied as u32)?;
        if offered.is_empty() || offered != opponent {
            app::bail!("there is no draw offer to accept");
        }

        self.end_game(
            index,
            "1/2-1/2",
            "agreement",
            &id,
            replayed.applied as u32,
            now,
        )?;
        Ok(())
    }

    /// Refuse the opponent's standing offer. (A move refuses it too.)
    pub fn decline_draw(&mut self, now: u64) -> app::Result<()> {
        let id = Self::caller_id();
        let index = self.current_game()?;
        let replayed = self.replay_game(index)?;
        let Some(color) = self.color_of(index, &id, replayed.position.side_to_move)? else {
            app::bail!("only a seated player can decline a draw");
        };
        let opponent = self.seat_member(self.seat_for_color(index, color.other()))?;
        if opponent.is_empty() {
            app::bail!("there is no draw offer to decline");
        }

        // ⚠️ The offer belongs to the OPPONENT, and only its owner may write it
        // — so declining cannot clear their row. It is recorded as the
        // decliner's own, and `offer_stands` stops counting an offer once the
        // other player has answered it at the same ply.
        if !self.offer_stands(index, &opponent, replayed.applied as u32)? {
            app::bail!("there is no draw offer to decline");
        }
        self.put_owned(
            |state| &mut state.draw_offers,
            &claim_prefix(index, &id),
            &id,
            |nonce| claim_key(index, &id, nonce),
            now,
            DrawOffer {
                open: false,
                declined: true,
                ply: replayed.applied as u32,
                at: now,
            },
        )?;

        app::emit!(Event::DrawDeclined {
            game: index,
            by: id.clone()
        });
        Ok(())
    }

    /// Claim the draw the position allows — threefold repetition or the
    /// fifty-move rule. Both are claims under the rules of chess, so neither
    /// ends a game on its own.
    pub fn claim_draw(&mut self, now: u64) -> app::Result<()> {
        let id = Self::caller_id();
        let index = self.current_game()?;
        let replayed = self.replay_game(index)?;
        let (result, _reason) = self.result_of(index, &replayed)?;
        if result != "*" {
            app::bail!("this game is over");
        }
        if self
            .color_of(index, &id, replayed.position.side_to_move)?
            .is_none()
        {
            app::bail!("only a seated player can claim a draw");
        }
        let Some(claim) = replayed.claimable() else {
            app::bail!("there is no draw to claim in this position");
        };
        let reason = match claim {
            ClaimableDraw::ThreefoldRepetition => "threefold",
            ClaimableDraw::FiftyMove => "fiftyMove",
        };
        self.end_game(index, "1/2-1/2", reason, &id, replayed.applied as u32, now)?;
        Ok(())
    }

    /// Start the next game. Colours swap, so the player who had Black has
    /// White. Only allowed once the current game is finished.
    pub fn rematch(&mut self, now: u64) -> app::Result<u32> {
        let id = Self::caller_id();
        let index = self.current_game()?;
        let replayed = self.replay_game(index)?;
        let (result, _reason) = self.result_of(index, &replayed)?;
        if result == "*" {
            app::bail!("finish this game first");
        }
        if self
            .color_of(index, &id, replayed.position.side_to_move)?
            .is_none()
        {
            app::bail!("only a seated player can start a rematch");
        }

        let next = index.saturating_add(1);
        // Each player's claim lives under their own key, and `current_game`
        // counts a game as started if EITHER seat holder validly claimed it —
        // so two rematches started at once still produce one new game rather
        // than a contested row.
        let key = Self::free_key(&self.games, &id, now, |nonce| claim_key(next, &id, nonce))?;
        self.put(
            |state| &mut state.games,
            key,
            &id,
            GameRecord {
                index: next,
                started_at: now,
                started_by: id.clone(),
            },
        )?;
        app::emit!(Event::GameStarted { game: next });
        Ok(next)
    }

    // ── internals ───────────────────────────────────────────────────────────

    /// The game being played now.
    ///
    /// COUNTED, not read: game 0 is implicit, and game `n + 1` exists only if
    /// some seat holder validly claimed a rematch of a game `n` that was
    /// already decided. Reading a stored index instead — `max(keys)`, which is
    /// what this used to do — let any member write one row and move every
    /// reader to an empty board, hiding the real game behind it.
    fn current_game(&self) -> app::Result<u32> {
        let mut index = 0;
        // Bounded so a pathological store cannot spin a read forever; a table
        // that reaches 1024 rematches has other problems.
        while index < 1024 && self.rematch_is_valid(index + 1)? {
            index += 1;
        }
        Ok(index)
    }

    /// Is there a real claim on game `index`, by someone entitled to make it?
    ///
    /// Two conditions, both re-derived: a seat holder of the PREVIOUS game
    /// wrote the claim under their own account, and that previous game was
    /// actually finished. A rematch of a game still in progress is not a
    /// rematch — it is a way to erase one.
    fn rematch_is_valid(&self, index: u32) -> app::Result<bool> {
        let Some(previous) = index.checked_sub(1) else {
            return Ok(false);
        };
        let replayed = self.replay_game(previous)?;
        if self.result_of(previous, &replayed)?.0 == "*" {
            return Ok(false);
        }
        for color in [Color::White, Color::Black] {
            let holder = self.seat_member(self.seat_for_color(previous, color))?;
            if holder.is_empty() {
                continue;
            }
            let rows = Self::valid_rows(&self.games, &claim_prefix(index, &holder))?;
            if rows.iter().any(|(_, record)| record.index == index) {
                return Ok(true);
            }
        }
        Ok(false)
    }

    /// The moves of one game, in ply order — reconstructed, never sorted.
    ///
    /// The ply sequence is the READER's arithmetic: ply 0, then 1, then 2,
    /// stopping at the first one nobody has validly written. Sorting stored
    /// rows by a `ply` FIELD (which is what this used to do) hands the ordering
    /// to whoever wrote the rows — a row parked at any key could name itself
    /// ply 6 and be applied sixth, and a gap in the sequence was silently
    /// compacted away.
    ///
    /// A row counts at ply `p` only if it sits under that ply's prefix, its key
    /// names the player whose turn `p` is — White on the even plies, Black on
    /// the odd ones — and core's owner stamp agrees. Anything else is somebody
    /// else's row, and the game simply has no move at that ply yet.
    fn moves_of(&self, index: u32) -> app::Result<Vec<MoveRecord>> {
        let white = self.seat_member(self.seat_for_color(index, Color::White))?;
        let black = self.seat_member(self.seat_for_color(index, Color::Black))?;
        if white.is_empty() || black.is_empty() {
            return Ok(Vec::new());
        }

        // The position is carried along so each ply can be judged in the
        // position it would actually be played in. A player who wrote a row
        // that is not a legal move there — a stale retry, or junk — is not
        // stuck with it: the earliest row that IS legal is taken, and the rest
        // of their rows for that ply are ignored. Only their own rows are ever
        // in the running, so this cannot be used against anyone.
        let mut position = board::Position::initial();
        let mut moves = Vec::new();
        for ply in 0..MAX_PLY {
            let author = if ply % 2 == 0 { &white } else { &black };
            let mut rows: Vec<(String, MoveRecord)> =
                Self::valid_rows(&self.moves, &move_prefix(index, ply))?
                    .into_iter()
                    .filter(|(key, _)| key_author(key) == Some(author.as_str()))
                    .collect();
            // A total order over rows, so every replica tries them in the same
            // sequence and lands on the same move.
            rows.sort_by_key(|(_, record)| {
                (
                    record.at,
                    calimero_sdk::borsh::to_vec(record).unwrap_or_default(),
                )
            });

            let legal = movegen::legal_moves(&position);
            let chosen = rows.into_iter().find_map(|(_, record)| {
                let mv = notation::parse_uci(&record.uci)?;
                let played = legal.iter().copied().find(|candidate| {
                    candidate.from == mv.from
                        && candidate.to == mv.to
                        && (mv.promotion.is_none() || candidate.promotion == mv.promotion)
                })?;
                Some((record, played))
            });

            let Some((record, played)) = chosen else {
                break;
            };
            position = position.apply(played);
            moves.push(record);
        }
        Ok(moves)
    }

    fn replay_game(&self, index: u32) -> app::Result<game::Replay> {
        let moves = self.moves_of(index)?;
        Ok(game::replay(
            &moves.iter().map(|m| m.uci.clone()).collect::<Vec<_>>(),
        ))
    }

    /// Which SEAT holds `color` in game `index`.
    ///
    /// Colours alternate: the `white` chair has White in the even-numbered
    /// games and Black in the odd ones.
    fn seat_for_color(&self, index: u32, color: Color) -> &'static str {
        let swapped = index % 2 == 1;
        match (color, swapped) {
            (Color::White, false) | (Color::Black, true) => SEAT_WHITE,
            (Color::Black, false) | (Color::White, true) => SEAT_BLACK,
        }
    }

    /// Who holds `seat`: the earliest valid claim on it.
    ///
    /// Elected by the reader over per-claimant keys rather than resolved by a
    /// merge over one shared key, for two reasons. A claim counts only if
    /// core's owner stamp matches the account its key names, so nobody can file
    /// a claim as someone else. And because each claimant writes under their
    /// own account and nonce, nobody can occupy the chair's key first and lock
    /// its rightful holder out of writing at all.
    ///
    /// Ties on the clock break on the canonical encoding, so every replica
    /// elects the same holder independently.
    fn seat_member(&self, seat: &str) -> app::Result<MemberId> {
        let rows = Self::valid_rows(&self.seat_claims, &seat_prefix(seat))?;
        let claims: Vec<(String, Seat)> = rows
            .into_iter()
            // The claim has to be about the person who wrote it.
            .filter(|(key, claim)| key_author(key) == Some(claim.member.as_str()))
            .collect();
        Ok(Self::elect(claims, |claim| claim.claimed_at, true)
            .map_or_else(String::new, |claim| claim.member))
    }

    /// The elected holder's own claim, for its display name.
    fn seat_claim(&self, seat: &str, member: &str) -> app::Result<Option<Seat>> {
        let rows = Self::valid_rows(&self.seat_claims, &seat_prefix(seat))?;
        let mine: Vec<(String, Seat)> = rows
            .into_iter()
            .filter(|(key, _)| key_author(key) == Some(member))
            .collect();
        Ok(Self::elect(mine, |claim| claim.claimed_at, true))
    }

    /// The account core recorded as the writer of `key`, or `None`.
    ///
    /// The stamp, not a field: core verifies a per-action signature against it
    /// inside `Interface::apply_action` on every receive path, so unlike
    /// anything inside the value, a member cannot set it to someone else.
    fn owner_of<V>(map: &AuthoredMap<String, V>, key: &String) -> app::Result<Option<MemberId>>
    where
        V: BorshSerialize + BorshDeserialize,
    {
        Ok(map
            .owner_of(key)?
            .map(|owner| Self::owner_id(owner.as_bytes())))
    }

    /// Every row under `prefix` that its own key's author really wrote.
    ///
    /// The one place a stored row becomes evidence. Two things have to agree
    /// before a row is even considered: the account named in the key, and
    /// core's owner stamp on the entity. The first is what the reader is
    /// looking for; the second is what a member cannot forge for anyone but
    /// themselves. Everything else in this contract reads through here.
    fn valid_rows<V>(map: &AuthoredMap<String, V>, prefix: &str) -> app::Result<Vec<(String, V)>>
    where
        V: BorshSerialize + BorshDeserialize + Clone,
    {
        let mut rows = Vec::new();
        for (key, value) in map.entries()? {
            if !key.starts_with(prefix) {
                continue;
            }
            let Some(author) = key_author(&key).map(ToOwned::to_owned) else {
                continue;
            };
            if !Self::owned_by(Self::owner_of(map, &key)?, &author) {
                continue;
            }
            rows.push((key, value));
        }
        Ok(rows)
    }

    /// The row a reader should believe, among several from one author.
    ///
    /// `earliest` picks the first claim — a seat, a move, an ending, all of
    /// which are things you do once and cannot take back. `!earliest` picks the
    /// most recent, which is what a draw offer needs: offering, then answering,
    /// is a state that moves. Ties break on the canonical encoding so every
    /// replica lands on the same row without talking to any other.
    fn elect<V: BorshSerialize>(
        rows: Vec<(String, V)>,
        at: impl Fn(&V) -> u64,
        earliest: bool,
    ) -> Option<V> {
        Self::elect_row(rows, at, earliest).map(|(_, value)| value)
    }

    /// [`Self::elect`], keeping the winning row's key — which a writer needs in
    /// order to update its own row rather than pile up a new one.
    fn elect_row<V: BorshSerialize>(
        rows: Vec<(String, V)>,
        at: impl Fn(&V) -> u64,
        earliest: bool,
    ) -> Option<(String, V)> {
        let mut best: Option<(u64, Vec<u8>, String, V)> = None;
        for (key, value) in rows {
            let stamp = at(&value);
            let encoded = calimero_sdk::borsh::to_vec(&value).unwrap_or_default();
            let better = match &best {
                None => true,
                Some((best_at, best_bytes, _, _)) => {
                    if stamp == *best_at {
                        encoded < *best_bytes
                    } else if earliest {
                        stamp < *best_at
                    } else {
                        stamp > *best_at
                    }
                }
            };
            if better {
                best = Some((stamp, encoded, key, value));
            }
        }
        best.map(|(_, _, key, value)| (key, value))
    }

    /// Write the caller's single row under `prefix`, updating the one they
    /// already have rather than adding another.
    ///
    /// For the two things a player keeps RE-stating — their presence and their
    /// standing draw offer. Everything else in this contract is append-only,
    /// where a fresh key per write is the point.
    fn put_owned<V>(
        &mut self,
        field: impl Fn(&mut Self) -> &mut AuthoredMap<String, V>,
        prefix: &str,
        author: &str,
        build: impl Fn(u64) -> String,
        now: u64,
        value: V,
    ) -> app::Result<()>
    where
        V: BorshSerialize + BorshDeserialize + Clone + 'static,
    {
        let key = {
            let map = field(self);
            let mine: Vec<(String, V)> = Self::valid_rows(map, prefix)?
                .into_iter()
                .filter(|(key, _)| key_author(key) == Some(author))
                .collect();
            match Self::elect_row(mine, |_| 0, true) {
                Some((key, _)) => key,
                None => Self::free_key(map, author, now, build)?,
            }
        };
        self.put(field, key, author, value)
    }

    /// A key in `map` that the caller can actually write.
    ///
    /// Starts at `now` and walks forward past any key someone else already
    /// owns, so a squatted key costs the writer one more attempt rather than
    /// their turn. Bounded: if this cannot find a free key in a few tries, the
    /// map is under an attack that a longer loop would not fix either.
    fn free_key<V>(
        map: &AuthoredMap<String, V>,
        author: &str,
        now: u64,
        build: impl Fn(u64) -> String,
    ) -> app::Result<String>
    where
        V: BorshSerialize + BorshDeserialize,
    {
        for offset in 0..16 {
            let key = build(now.saturating_add(offset));
            match Self::owner_of(map, &key)? {
                None => return Ok(key),
                Some(existing) if existing == author => return Ok(key),
                Some(_) => continue,
            }
        }
        app::bail!("could not find a free slot to write to")
    }

    fn seat_of(&self, member: &str) -> app::Result<Option<String>> {
        for seat in [SEAT_WHITE, SEAT_BLACK] {
            if self.seat_member(seat)? == member {
                return Ok(Some(seat.to_owned()));
            }
        }
        Ok(None)
    }

    /// The caller's colour in game `index`, or `None` for a spectator.
    ///
    /// `side_to_move` decides the answer for a player sitting in BOTH chairs:
    /// they are whichever side it is the turn of. Every caller of this is
    /// asking "may this person act, and as whom" — and for a pass-and-play
    /// board the honest answer to both halves is "as the side to move".
    fn color_of(
        &self,
        index: u32,
        member: &str,
        side_to_move: Color,
    ) -> app::Result<Option<Color>> {
        let holds = |color: Color| -> app::Result<bool> {
            Ok(self.seat_member(self.seat_for_color(index, color))? == member)
        };
        if holds(side_to_move)? {
            return Ok(Some(side_to_move));
        }
        if holds(side_to_move.other())? {
            return Ok(Some(side_to_move.other()));
        }
        Ok(None)
    }

    fn seat_view(&self, seat: &str, now: u64) -> app::Result<SeatView> {
        let member = self.seat_member(seat)?;
        // The NAME comes from the elected holder's own claim, so a losing
        // claimant cannot label the chair.
        let name = if member.is_empty() {
            String::new()
        } else {
            self.seat_claim(seat, &member)?
                .map_or_else(String::new, |claim| claim.name)
        };
        let online = if member.is_empty() {
            false
        } else {
            self.is_online(&member, now)?
        };
        Ok(SeatView {
            seat: seat.to_owned(),
            member,
            name,
            online,
        })
    }

    fn is_online(&self, member: &str, now: u64) -> app::Result<bool> {
        Ok(self
            .presence_of(member)?
            .is_some_and(|p| now.saturating_sub(p.updated_at) <= PRESENCE_TTL_MS))
    }

    /// The presence row `member` wrote about themselves, if any.
    ///
    /// A row written about someone by somebody else says nothing about them, so
    /// the newest VALID row wins — presence is a state that moves, unlike every
    /// other claim in this contract.
    fn presence_of(&self, member: &str) -> app::Result<Option<Player>> {
        let rows = Self::valid_rows(&self.players, &format!("{member}/"))?;
        let mine: Vec<(String, Player)> = rows
            .into_iter()
            .filter(|(_, player)| player.id == member)
            .collect();
        Ok(Self::elect(mine, |player| player.updated_at, false))
    }

    fn player_views(
        &self,
        index: u32,
        side_to_move: Color,
        now: u64,
    ) -> app::Result<Vec<PlayerView>> {
        let mut seen: Vec<MemberId> = Vec::new();
        for (key, _) in Self::valid_rows(&self.players, "")? {
            if let Some(author) = key_author(&key) {
                if !seen.iter().any(|id| id == author) {
                    seen.push(author.to_owned());
                }
            }
        }

        let mut out: Vec<PlayerView> = Vec::new();
        for id in seen {
            let Some(player) = self.presence_of(&id)? else {
                continue;
            };
            let color = match self.color_of(index, &id, side_to_move)? {
                Some(color) => color_name(color).to_owned(),
                None => String::new(),
            };
            out.push(PlayerView {
                online: now.saturating_sub(player.updated_at) <= PRESENCE_TTL_MS,
                id,
                name: player.name,
                color,
            });
        }
        // Sorted so two clients polling the same table paint the same list.
        out.sort_by(|a, b| a.id.cmp(&b.id));
        Ok(out)
    }

    /// The result of game `index`: the board's answer if it has one, otherwise
    /// the earliest ending a player can be shown to have caused, otherwise
    /// unfinished.
    ///
    /// The order matters. A board ending is a FACT about the move list, so it
    /// outranks a stored one — that is also what makes a resignation written
    /// concurrently with the mating move harmless.
    ///
    /// Every stored ending is RE-DERIVED before it counts (see
    /// [`Self::ending_is_valid`]). Taking one at its word is how a member
    /// writes "you resigned" into a game they were losing.
    fn result_of(&self, index: u32, replayed: &game::Replay) -> app::Result<(String, String)> {
        if let Some(outcome) = replayed.outcome() {
            return Ok(describe_outcome(outcome));
        }

        let mut winner: Option<(u64, Vec<u8>, String, String)> = None;
        for color in [Color::White, Color::Black] {
            let holder = self.seat_member(self.seat_for_color(index, color))?;
            if holder.is_empty() {
                continue;
            }
            // Validity FIRST, then election. Electing one row and validating
            // it afterwards lets a player's own junk row mask the real ending
            // they wrote a moment later — which is how a genuine resignation
            // came back as "still playing".
            let mut valid = Vec::new();
            for (key, ending) in Self::valid_rows(&self.endings, &claim_prefix(index, &holder))? {
                if self.ending_is_valid(index, color, &ending, replayed)? {
                    valid.push((key, ending));
                }
            }
            let Some(ending) = Self::elect(valid, |ending| ending.at, true) else {
                continue;
            };
            let encoded = calimero_sdk::borsh::to_vec(&ending).unwrap_or_default();
            let candidate = (
                ending.at,
                encoded,
                ending.result.clone(),
                ending.reason.clone(),
            );
            let better = match &winner {
                None => true,
                Some((at, bytes, _, _)) => {
                    candidate.0 < *at || (candidate.0 == *at && candidate.1 < *bytes)
                }
            };
            if better {
                winner = Some(candidate);
            }
        }

        Ok(winner.map_or_else(
            || ("*".to_owned(), String::new()),
            |(_, _, result, reason)| (result, reason),
        ))
    }

    /// Can `color` actually have ended the game this way, in this position?
    ///
    /// Each reason is checkable, so each one is checked:
    ///
    /// * **resignation** — the result must be a LOSS for the player who wrote
    ///   it. Nobody resigns themselves into a win.
    /// * **agreement** — the opponent must have had an offer standing at the
    ///   ply the agreement was written at. An agreement is two acts; only one
    ///   of them is this row.
    /// * **threefold / fiftyMove** — the position at that ply must genuinely
    ///   allow the claim, which the reader works out from the moves.
    ///
    /// An ending written at a ply the game has since moved past is stale and
    /// counts for nothing — the same rule a draw offer lives under.
    fn ending_is_valid(
        &self,
        index: u32,
        color: Color,
        ending: &Ending,
        replayed: &game::Replay,
    ) -> app::Result<bool> {
        if ending.ply != replayed.applied as u32 {
            return Ok(false);
        }
        match ending.reason.as_str() {
            "resignation" => Ok(ending.result == win_for(color.other())),
            "agreement" => {
                if ending.result != "1/2-1/2" {
                    return Ok(false);
                }
                let opponent = self.seat_member(self.seat_for_color(index, color.other()))?;
                Ok(!opponent.is_empty() && self.offer_stands(index, &opponent, ending.ply)?)
            }
            "threefold" => Ok(ending.result == "1/2-1/2"
                && replayed.claimable() == Some(ClaimableDraw::ThreefoldRepetition)),
            "fiftyMove" => Ok(ending.result == "1/2-1/2"
                && replayed.claimable() == Some(ClaimableDraw::FiftyMove)),
            // An unknown reason is not a way to end a game.
            _ => Ok(false),
        }
    }

    /// Does `member` have an offer standing at `ply`, unanswered?
    ///
    /// Two rows, because only an entry's owner may write it: the offerer's own
    /// row says they offered, and the absence of a `declined` row from the
    /// other seat at the same ply says nobody has refused it yet. A move ends
    /// it too — the ply moves on, and an offer is good only for the position it
    /// was made in.
    fn offer_stands(&self, index: u32, member: &str, ply: u32) -> app::Result<bool> {
        let Some(offer) = self.latest_offer(index, member)? else {
            return Ok(false);
        };
        if !(offer.open && !offer.declined && offer.ply == ply) {
            return Ok(false);
        }

        for color in [Color::White, Color::Black] {
            let other = self.seat_member(self.seat_for_color(index, color))?;
            if other.is_empty() || other == member {
                continue;
            }
            if self
                .latest_offer(index, &other)?
                .is_some_and(|answer| answer.declined && answer.ply == ply)
            {
                return Ok(false);
            }
        }
        Ok(true)
    }

    /// One player's most recent valid offer row for a game.
    ///
    /// The latest, not the earliest: offering and then answering is a state
    /// that moves, which is the one place in this contract where a later claim
    /// supersedes an earlier one.
    fn latest_offer(&self, index: u32, member: &str) -> app::Result<Option<DrawOffer>> {
        let rows = Self::valid_rows(&self.draw_offers, &claim_prefix(index, member))?;
        Ok(Self::elect(rows, |offer| offer.at, false))
    }

    /// The member whose draw offer is still standing at `ply`, or `""`.
    ///
    /// Only the two seat holders are asked: an offer from anyone else is not an
    /// offer, whoever wrote the row.
    fn standing_offer(&self, index: u32, ply: u32) -> app::Result<MemberId> {
        for color in [Color::White, Color::Black] {
            let holder = self.seat_member(self.seat_for_color(index, color))?;
            if !holder.is_empty() && self.offer_stands(index, &holder, ply)? {
                return Ok(holder);
            }
        }
        Ok(String::new())
    }

    fn end_game(
        &mut self,
        index: u32,
        result: &str,
        reason: &str,
        by: &str,
        ply: u32,
        now: u64,
    ) -> app::Result<()> {
        // Under the caller's OWN key. An ending is a claim by one player about
        // one game, and the reader re-derives whether they could have made it.
        let key = Self::free_key(&self.endings, by, now, |nonce| claim_key(index, by, nonce))?;
        self.put(
            |state| &mut state.endings,
            key,
            by,
            Ending {
                result: result.to_owned(),
                reason: reason.to_owned(),
                by: by.to_owned(),
                ply,
                at: now,
            },
        )?;
        self.touch(by, now)?;
        app::emit!(Event::GameEnded {
            game: index,
            result: result.to_owned(),
            reason: reason.to_owned(),
        });
        Ok(())
    }

    /// Keep a player's presence fresh whenever they do something.
    fn touch(&mut self, member: &str, now: u64) -> app::Result<()> {
        let Some(existing) = self.presence_of(member)? else {
            return Ok(());
        };
        let refreshed = Player {
            updated_at: now,
            ..existing
        };
        self.put_owned(
            |state| &mut state.players,
            &format!("{member}/"),
            member,
            |nonce| player_key(member, nonce),
            now,
            refreshed,
        )
    }

    /// Write `value` at `key` in one of this state's authored maps.
    ///
    /// `AuthoredMap` splits the two cases — `insert` refuses an existing key,
    /// `update` refuses a non-owner — so every writer here needs the same three
    /// lines, and the case that must not be papered over is the third: a key
    /// somebody else got to first. That is not an error the caller can fix by
    /// retrying, and it must not be silently ignored either, so it is a refusal
    /// with a sentence that says what happened.
    fn put<V>(
        &mut self,
        field: impl Fn(&mut Self) -> &mut AuthoredMap<String, V>,
        key: String,
        author: &str,
        value: V,
    ) -> app::Result<()>
    where
        V: BorshSerialize + BorshDeserialize + 'static,
    {
        // One mutable borrow for all three branches; `owner_id` is an
        // associated function, so reading the stamp does not need `&self`.
        let map = field(self);
        let owner = map
            .owner_of(&key)?
            .map(|owner| Self::owner_id(owner.as_bytes()));
        match owner {
            None => map.insert(key, value)?,
            Some(existing) if existing == author => map.update(&key, value)?,
            Some(_) => app::bail!("another member already wrote that entry"),
        }
        Ok(())
    }
}

// ── free helpers ─────────────────────────────────────────────────────────────

/// Zero-padded so the key order is the game order — the same reason move keys
/// are padded. Four digits is 10 000 games at one table.
fn game_key(index: u32) -> String {
    format!("{index:04}")
}

/// `"<game>/<ply>/<account>/<nonce>"` — where one player's move at one ply
/// lives.
///
/// Three parts, each load-bearing:
///
/// * the **ply**, so the reader can ask for a specific move rather than sort
///   rows by a field their writer controls;
/// * the **account**, so two players never contend for one entity and the
///   reader knows whose row it is looking at, cross-checked against core's own
///   owner stamp (see [`MeroChess::owner_of`]);
/// * the **nonce**, so a key can never be OCCUPIED against its rightful author.
///   `AuthoredMap::insert` refuses an existing key and only its owner may
///   update it, so without this any context member — a spectator, not even a
///   player — could park a row on the key the next move needs and permanently
///   wedge the table. With a fresh nonce per write there is always a free key,
///   and a squatted row is just an extra row the reader filters out.
fn move_key(index: u32, ply: u32, author: &str, nonce: u64) -> String {
    format!("{}/{ply:04}/{author}/{nonce}", game_key(index))
}

/// The prefix every row for one ply shares, whoever wrote it.
fn move_prefix(index: u32, ply: u32) -> String {
    format!("{}/{ply:04}/", game_key(index))
}

/// `"<game>/<account>/<nonce>"` — one player's claim about one game: their draw
/// offer, their ending, their rematch. Nonce for the same reason as above.
fn claim_key(index: u32, member: &str, nonce: u64) -> String {
    format!("{}/{member}/{nonce}", game_key(index))
}

/// `"<account>/<nonce>"` — one person's presence row.
fn player_key(member: &str, nonce: u64) -> String {
    format!("{member}/{nonce}")
}

fn claim_prefix(index: u32, member: &str) -> String {
    format!("{}/{member}/", game_key(index))
}

/// `"<seat>/<account>/<nonce>"` — one person's claim on one chair.
fn seat_key(seat: &str, member: &str, nonce: u64) -> String {
    format!("{seat}/{member}/{nonce}")
}

fn seat_prefix(seat: &str) -> String {
    format!("{seat}/")
}

/// The account a key names, i.e. the one that must own it for the row to count.
///
/// `"<seat>/<account>/<nonce>"` and `"<game>/<account>/<nonce>"` both put the
/// account second-to-last, and a move key puts it there too; splitting from the
/// right keeps this one function honest for all three.
fn key_author(key: &str) -> Option<&str> {
    let mut parts = key.rsplitn(3, '/');
    let _nonce = parts.next()?;
    parts.next()
}

fn normalize_seat(seat: &str) -> app::Result<String> {
    match seat.trim().to_ascii_lowercase().as_str() {
        SEAT_WHITE => Ok(SEAT_WHITE.to_owned()),
        SEAT_BLACK => Ok(SEAT_BLACK.to_owned()),
        _ => app::bail!("a seat is either `white` or `black`"),
    }
}

const fn color_name(color: Color) -> &'static str {
    match color {
        Color::White => "white",
        Color::Black => "black",
    }
}

fn win_for(color: Color) -> String {
    match color {
        Color::White => "1-0".to_owned(),
        Color::Black => "0-1".to_owned(),
    }
}

/// The (result, reason) pair for an ending the board decided.
fn describe_outcome(outcome: Outcome) -> (String, String) {
    match outcome {
        Outcome::Checkmate { winner } => (win_for(winner), "checkmate".to_owned()),
        Outcome::Stalemate => ("1/2-1/2".to_owned(), "stalemate".to_owned()),
        Outcome::InsufficientMaterial => ("1/2-1/2".to_owned(), "insufficientMaterial".to_owned()),
        Outcome::SeventyFiveMove => ("1/2-1/2".to_owned(), "seventyFiveMove".to_owned()),
        Outcome::FivefoldRepetition => ("1/2-1/2".to_owned(), "fivefold".to_owned()),
    }
}

/// The move list a client sees: exactly the plies the replay applied, numbered
/// by their position in it, and named by the SAN the replay derived.
///
/// Nothing here is taken from the stored row except the move itself and who
/// wrote it — and both of those were already established by the reader, since a
/// row only reaches this point if it sat at the key for that ply and carried
/// the owner stamp of the player whose turn it was.
fn move_views(records: &[MoveRecord], replayed: &game::Replay) -> Vec<MoveView> {
    records
        .iter()
        .take(replayed.applied)
        .enumerate()
        .map(|(ply, record)| MoveView {
            ply: ply as u32,
            uci: record.uci.clone(),
            san: replayed
                .sans
                .get(ply)
                .cloned()
                .unwrap_or_else(|| record.uci.clone()),
            by: record.by.clone(),
            at: record.at,
        })
        .collect()
}

/// Trim, drop control characters, cap the length, and fall back to `fallback`
/// when nothing usable is left.
///
/// A display name is shown to the other player, so it is bounded at the door
/// rather than trusted and then truncated in fourteen places in the UI.
fn clean_name(raw: &str, fallback: &str) -> String {
    let cleaned: String = raw
        .trim()
        .chars()
        .filter(|c| !c.is_control())
        .take(MAX_NAME_LEN)
        .collect();
    let cleaned = cleaned.trim().to_owned();
    if cleaned.is_empty() {
        fallback.to_owned()
    } else {
        cleaned
    }
}
