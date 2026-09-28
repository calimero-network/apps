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
//! **Moves, keyed by author and ply. Never a board.** `moves` is
//! `WriteOnce<SortedMap<"<account>/<game>/<ply>/<nonce>", MoveRecord>>` and
//! every position in the app is derived by replaying it (see
//! [`game::replay`]). A stored BOARD could not converge: it would merge field
//! by field into a position no game ever reached.
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
//! only the node that runs them. Three things follow, and they shape every read
//! below:
//!
//! **Nothing is trusted that can be derived.** The position, the SAN, the ply
//! ordering, the result and the current game index are all recomputed on every
//! read, from the moves, by the reader. A forged record is inert: it sits in
//! storage and in the root hash, and no honest node ever folds it into a
//! position.
//!
//! **Everything a player writes is owned, and written once.** Every claim
//! lives in a [`WriteOnce`] map (presence alone in the player's own
//! [`UserStorage`] slot), whose entries carry a `StorageType::User`
//! owner stamp AND an immutable rule that every node enforces on apply: nobody,
//! the owner included, edits or removes a row once written. Keys name their
//! author and the reader re-checks the stamp, so "White's move at ply 6" is a
//! claim only White can make — and one White cannot take back.
//!
//! **No clock a writer sets decides anything that matters.** A row's `at` is
//! that writer's own word, so it cannot order a game or elect a seat holder
//! once the game is under way: a backdated row would win any "earliest" rule.
//! Instead a ply is decided by being the ONLY legal move its author wrote there
//! (two is equivocation, and loses — see [`MeroChess::play_out`]), an ending
//! pins the game at its ply, and the chairs lock once each player has moved
//! against the other (see [`MeroChess::chairs`]).
//!
//! What remains is that a player can stall: squat a key the reader is waiting
//! on, or simply stop moving. Neither changes a result, and both are available
//! to anyone who can walk away from a board.

use std::collections::{BTreeMap, BTreeSet};

use calimero_sdk::abi::AbiType;
use calimero_sdk::borsh::{BorshDeserialize, BorshSerialize};
use calimero_sdk::serde::{Deserialize, Serialize};
use calimero_sdk::{app, env as sdk_env, PublicKey};
use calimero_storage::collections::crdt_meta::MergeError;
use calimero_storage::collections::{
    Frozen, Guarded, GuardedEntries, Mergeable as MergeableTrait, Owning, Policy, SortedMap,
    UserStorage, WriteOnce,
};

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

use board::{Color, Position};
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

/// How many games one table walks before it stops counting. A table that
/// reaches this many rematches has other problems.
const MAX_GAMES: u32 = 1024;

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
const SEATS: [&str; 2] = [SEAT_WHITE, SEAT_BLACK];

// ── Stored records ───────────────────────────────────────────────────────────
//
// Everything but `Player` is plain data in a `WriteOnce` map: nothing merges,
// because nothing changes.

/// A person's presence row — the one thing they keep RE-stating, so it lives in
/// their own [`UserStorage`] slot and resolves to the newest copy.
#[app::mergeable(id = "mero-chess::Player")]
#[derive(BorshSerialize, BorshDeserialize, Serialize, Deserialize, AbiType, Clone, Debug)]
#[borsh(crate = "calimero_sdk::borsh")]
#[serde(crate = "calimero_sdk::serde")]
pub struct Player {
    pub name: String,
    pub joined_at: u64,
    pub updated_at: u64,
}

impl MergeableTrait for Player {
    fn merge(&mut self, other: &Self) -> Result<(), MergeError> {
        // Newest wins, ties broken on the encoding so both replicas agree.
        // Only its owner writes a presence row, so this is a retry, not a race.
        let theirs = (
            other.updated_at,
            calimero_sdk::borsh::to_vec(other).unwrap_or_default(),
        );
        let mine = (
            self.updated_at,
            calimero_sdk::borsh::to_vec(self).unwrap_or_default(),
        );
        if theirs > mine {
            *self = other.clone();
        }
        Ok(())
    }
}

/// One person's claim on one chair, keyed `"<seat>/<account>/<nonce>"`.
///
/// Whose claim WINS is the reader's question (see [`MeroChess::chairs`]); the
/// row carries no member id, because the owner stamp already says who wrote it.
#[derive(BorshSerialize, BorshDeserialize, Serialize, Deserialize, AbiType, Clone, Debug)]
#[borsh(crate = "calimero_sdk::borsh")]
#[serde(crate = "calimero_sdk::serde")]
pub struct Seat {
    pub name: String,
    pub claimed_at: u64,
}

/// One played move, keyed `"<account>/<game>/<ply>/<nonce>"`.
///
/// The game, the ply and the author come from the key and core's owner stamp;
/// the SAN comes from the replay. What is left is what only the mover knows.
#[derive(BorshSerialize, BorshDeserialize, Serialize, Deserialize, AbiType, Clone, Debug)]
#[borsh(crate = "calimero_sdk::borsh")]
#[serde(crate = "calimero_sdk::serde")]
pub struct MoveRecord {
    /// The move, and the only thing here a reader cannot work out for itself.
    pub uci: String,
    /// When its author says they played it. Display only: nothing is ordered
    /// by it, because its author could set it to anything.
    pub at: u64,
    /// The member the mover saw in the other chair.
    ///
    /// Load-bearing: it is how a player's own, unforgeable rows vouch for who
    /// they were playing, which is what locks the chairs once a game is under
    /// way — see [`MeroChess::chairs`].
    pub opponent: MemberId,
}

/// A game ended by a PERSON, keyed `"<account>/<game>/<nonce>"`.
///
/// Board endings (checkmate, stalemate, dead position, fivefold, seventy-five
/// moves) are derived from the move list and never stored.
#[derive(BorshSerialize, BorshDeserialize, Serialize, Deserialize, AbiType, Clone, Debug)]
#[borsh(crate = "calimero_sdk::borsh")]
#[serde(crate = "calimero_sdk::serde")]
pub struct Ending {
    /// `1-0`, `0-1` or `1/2-1/2`.
    pub result: String,
    /// `resignation`, `agreement`, `threefold`, `fiftyMove`.
    pub reason: String,
    /// The ply the game stood at when this was written.
    ///
    /// Load-bearing, not bookkeeping: the reader re-checks the ending against
    /// the position at this ply, and a valid one ENDS the game here — a move
    /// written at this ply afterwards cannot un-resign anybody.
    pub ply: u32,
    pub at: u64,
}

/// A draw offer, or an answer to one, keyed `"<account>/<game>/<nonce>"`.
///
/// `ply` is what makes it expire: an offer is good only for the position it was
/// made in, exactly as at a board, so a move made after it silently voids it.
#[derive(BorshSerialize, BorshDeserialize, Serialize, Deserialize, AbiType, Clone, Debug)]
#[borsh(crate = "calimero_sdk::borsh")]
#[serde(crate = "calimero_sdk::serde")]
pub struct DrawOffer {
    /// Set when this row REFUSES the opponent's offer rather than making one.
    /// Only an entry's owner may write it, so a refusal cannot close the
    /// offerer's row; it is recorded here and the reader reads the pair.
    pub declined: bool,
    pub ply: u32,
    pub at: u64,
}

/// A claim that this player started a rematch, keyed `"<account>/<game>/<nonce>"`.
#[derive(BorshSerialize, BorshDeserialize, Serialize, Deserialize, AbiType, Clone, Debug)]
#[borsh(crate = "calimero_sdk::borsh")]
#[serde(crate = "calimero_sdk::serde")]
pub struct GameRecord {
    pub started_at: u64,
}

// ── Derived state ────────────────────────────────────────────────────────────

/// Who holds one chair, as the reader elected it.
#[derive(Clone, Debug, Default)]
struct Holder {
    member: MemberId,
    name: String,
}

/// One game, played out from the rows by [`MeroChess::play_out`].
struct Played {
    index: u32,
    started_at: u64,
    white: MemberId,
    black: MemberId,
    /// The moves the replay applied, in ply order.
    moves: Vec<MoveRecord>,
    replay: game::Replay,
    /// `*` while unfinished.
    result: String,
    reason: String,
    /// Each seat holder's draw-offer rows for this game.
    offers: BTreeMap<MemberId, Vec<DrawOffer>>,
}

impl Played {
    fn unfinished(&self) -> bool {
        self.result == "*"
    }

    fn ply(&self) -> u32 {
        self.replay.applied as u32
    }

    fn member_for(&self, color: Color) -> &str {
        match color {
            Color::White => &self.white,
            Color::Black => &self.black,
        }
    }

    /// Did `member` offer a draw at `ply`? Refusals are not consulted: this
    /// is the question an agreement asks, and a player cannot void their own
    /// acceptance by also refusing.
    fn offered(&self, member: &str, ply: u32) -> bool {
        self.offers
            .get(member)
            .is_some_and(|rows| rows.iter().any(|o| !o.declined && o.ply == ply))
    }

    fn declined(&self, member: &str, ply: u32) -> bool {
        self.offers
            .get(member)
            .is_some_and(|rows| rows.iter().any(|o| o.declined && o.ply == ply))
    }

    /// The seat holder whose offer stands in the current position, or `""`.
    fn standing_offer(&self) -> MemberId {
        if !self.unfinished() {
            return String::new();
        }
        let ply = self.ply();
        for color in [Color::White, Color::Black] {
            let from = self.member_for(color);
            let to = self.member_for(color.other());
            if !from.is_empty() && self.offered(from, ply) && !self.declined(to, ply) {
                return from.to_owned();
            }
        }
        String::new()
    }
}

/// Everything a call needs to know about the table, derived once.
struct Snapshot {
    /// `[white chair, black chair]`.
    chairs: [Holder; 2],
    /// Every game the table validly reached, oldest first. Never empty.
    games: Vec<Played>,
}

impl Snapshot {
    fn current(&self) -> &Played {
        // SAFETY: `MeroChess::snapshot` always plays out game 0.
        self.games.last().expect("game 0 always exists")
    }

    fn holder(&self, seat: &str) -> &Holder {
        &self.chairs[usize::from(seat == SEAT_BLACK)]
    }

    fn seat_of(&self, member: &str) -> Option<&'static str> {
        SEATS
            .into_iter()
            .find(|seat| self.holder(seat).member == member)
    }

    /// The caller's colour in the current game, or `None` for a spectator.
    ///
    /// A player sitting in BOTH chairs is whichever side is to move: every
    /// caller of this asks "may this person act, and as whom", and for a
    /// pass-and-play board the honest answer is "as the side to move".
    fn color_of(&self, member: &str) -> Option<Color> {
        let game = self.current();
        let side = game.replay.position.side_to_move;
        [side, side.other()]
            .into_iter()
            .find(|&color| game.member_for(color) == member && !member.is_empty())
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
    /// `fiftyMove`, `equivocation` (a player wrote two different moves at one
    /// ply, and lost for it) — or `""`.
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

/// Every map a player writes is owned and every key names its author, so a
/// member can only ever write rows about themselves — and, outside presence,
/// never change or remove one. Both are enforced by core at apply time, not by
/// this code. The reader elects and re-derives; see the module docs for why
/// that split is the whole security model.
#[app::state(emits = Event)]
pub struct MeroChess {
    /// Fixed when the table is created: nobody can relabel it or move the
    /// date game 0 began.
    title: Frozen<String>,
    created_at: Frozen<u64>,
    /// One slot per account — only that account writes it, and nobody can
    /// file rows under anyone else's name to crowd it.
    players: UserStorage<Player>,
    /// `"<seat>/<account>/<nonce>"` -> one person's claim on that chair.
    seat_claims: WriteOnce<SortedMap<String, Seat>>,
    /// `"<seat>/<account>/<claim nonce>/<nonce>"` -> when that claim was given
    /// up. Honoured only for a claimant who never acted at the table.
    vacated: WriteOnce<SortedMap<String, u64>>,
    /// `"<account>/<game>/<nonce>"` -> a claim that this player started game.
    games: WriteOnce<SortedMap<String, GameRecord>>,
    /// `"<account>/<game>/<ply>/<nonce>"` -> the move that player wrote there.
    moves: WriteOnce<SortedMap<String, MoveRecord>>,
    /// `"<account>/<game>/<nonce>"` -> how that player says the game ended.
    endings: WriteOnce<SortedMap<String, Ending>>,
    /// `"<account>/<game>/<nonce>"` -> that player's offers and refusals.
    draw_offers: WriteOnce<SortedMap<String, DrawOffer>>,
}

#[app::logic]
impl MeroChess {
    #[app::init]
    pub fn init(title: String, now: u64) -> MeroChess {
        app::emit!(Event::Initialized());
        // Game 0 is IMPLICIT — no record, because a record is something a
        // writer controls. The snapshot counts valid rematches up from zero,
        // so a peer cannot jump the table to game 9999 and leave every reader
        // staring at an empty board with the real game hidden behind it.
        MeroChess {
            title: Frozen::new(clean_name(&title, "Chess")),
            created_at: Frozen::new(now),
            players: UserStorage::new(),
            seat_claims: WriteOnce::new(),
            vacated: WriteOnce::new(),
            games: WriteOnce::new(),
            moves: WriteOnce::new(),
            endings: WriteOnce::new(),
            draw_offers: WriteOnce::new(),
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

    // ── reading the table ───────────────────────────────────────────────────

    /// The whole table in one call — see [`TableView`].
    pub fn table(&self, now: u64) -> app::Result<TableView> {
        let snap = self.snapshot()?;
        let game = snap.current();
        let replayed = &game.replay;

        let white_seat =
            self.seat_view(&snap, self.seat_for_color(game.index, Color::White), now)?;
        let black_seat =
            self.seat_view(&snap, self.seat_for_color(game.index, Color::Black), now)?;

        let me = Self::caller_id();
        let my_color = snap.color_of(&me).map_or("", color_name);

        let side_to_move = color_name(replayed.position.side_to_move);
        let unfinished = game.unfinished();
        let seated = !white_seat.member.is_empty() && !black_seat.member.is_empty();

        let status = if !unfinished {
            "finished"
        } else if seated {
            "inProgress"
        } else {
            "awaitingPlayers"
        };

        Ok(TableView {
            title: self.title.get()?.clone(),
            created_at: *self.created_at.get()?,
            game: game.index,
            fen: replayed.position.to_fen(),
            side_to_move: side_to_move.to_owned(),
            moves: move_views(game),
            // Withheld once the game is over, so a client cannot offer a move
            // in a finished game and get a refusal it could have predicted.
            legal_moves: if unfinished {
                replayed.legal_uci()
            } else {
                Vec::new()
            },
            status: status.to_owned(),
            result: game.result.clone(),
            reason: game.reason.clone(),
            check: in_check(&replayed.position, replayed.position.side_to_move),
            claimable_draw: match replayed.claimable() {
                Some(ClaimableDraw::ThreefoldRepetition) => "threefold".to_owned(),
                Some(ClaimableDraw::FiftyMove) => "fiftyMove".to_owned(),
                None => String::new(),
            },
            my_turn: unfinished && seated && my_color == side_to_move,
            my_color: my_color.to_owned(),
            me,
            draw_offer_from: game.standing_offer(),
            white: white_seat,
            black: black_seat,
            players: self.player_views(&snap, now)?,
            // COUNTED, not a row count: game 0 is implicit and a second
            // player's rematch row is not a second game.
            games_played: game.index.saturating_add(1),
        })
    }

    /// Every game this table has played, oldest first.
    pub fn history(&self) -> app::Result<Vec<GameSummary>> {
        Ok(self
            .snapshot()?
            .games
            .iter()
            .map(|game| GameSummary {
                index: game.index,
                started_at: game.started_at,
                result: game.result.clone(),
                reason: game.reason.clone(),
                plies: game.ply(),
                white: game.white.clone(),
                black: game.black.clone(),
            })
            .collect())
    }

    // ── sitting down ────────────────────────────────────────────────────────

    /// Announce yourself at the table, or refresh your presence and name.
    pub fn join(&mut self, name: String, now: u64) -> app::Result<()> {
        let id = Self::caller_id();
        let known = self.presence_of(&id)?.is_some();
        self.announce(Some(clean_name(&name, "Guest")), now)?;
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

        let snap = self.snapshot()?;
        let holder = &snap.holder(seat).member;
        if *holder == id {
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

        self.announce(Some(display.clone()), now)?;
        // Under this claimant's own key. Whether the claim WINS the chair is
        // the reader's question, asked the same way on every node.
        let key = Self::free_key(&self.seat_claims, now, |nonce| seat_key(seat, &id, nonce))?;
        self.seat_claims.insert(
            key,
            Seat {
                name: display,
                claimed_at: now,
            },
        )?;
        app::emit!(Event::Seated {
            seat: seat.to_owned(),
            member: id.clone()
        });
        Ok(())
    }

    /// Give up your chair — allowed only before you have played at this table.
    /// A chair you have played from is the table's record of who played; the
    /// way out of a game is `resign`.
    pub fn stand(&mut self, now: u64) -> app::Result<()> {
        let id = Self::caller_id();
        let snap = self.snapshot()?;
        let Some(seat) = snap.seat_of(&id) else {
            app::bail!("you are not seated");
        };
        if !snap.current().moves.is_empty() || self.has_acted(&id)? {
            app::bail!("you have played at this table — resign instead");
        }
        // Every claim this player wrote for that chair — a squatted key can
        // have forced a retry, so there may be more than one. Each is closed
        // by a row of the caller's own, because a claim is written once and
        // nobody, its author included, can remove it.
        let prefix = format!("{seat}/{id}/");
        for (key, _) in Self::owned_rows(&self.seat_claims, &prefix, &id)? {
            if self.is_vacated(&key, &id)? {
                continue;
            }
            let row = Self::free_key(&self.vacated, now, |nonce| format!("{key}/{nonce}"))?;
            self.vacated.insert(row, now)?;
        }
        // Standing up is still a sign of life, and the parameter has to be
        // named `now` regardless: the ABI carries the RUST parameter names, so
        // an unused `_now` would reach the generated client as `_now` and every
        // call from it would be a deserialisation error.
        self.touch(&id, now)?;
        app::emit!(Event::Vacated {
            seat: seat.to_owned(),
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
        let snap = self.snapshot()?;
        let game = snap.current();
        let index = game.index;
        if !game.unfinished() {
            app::bail!("this game is over");
        }

        let ply = game.ply();
        if ply >= MAX_PLY {
            app::bail!("this game has reached the move limit");
        }

        // BOTH chairs, not just the one to move: a game with an empty chair has
        // no opponent to answer, and letting White open against nobody produces
        // a move list the other player later joins into the middle of.
        let side = game.replay.position.side_to_move;
        let holder = game.member_for(side);
        let opponent = game.member_for(side.other()).to_owned();
        if holder.is_empty() || opponent.is_empty() {
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
        let Some(chosen) = find_legal(&game.replay.position, mv) else {
            app::bail!("that move is not legal in this position");
        };

        let san = notation::san(&game.replay.position, chosen);
        let key = Self::free_key(&self.moves, now, |nonce| move_key(&id, index, ply, nonce))?;
        self.moves.insert(
            key,
            MoveRecord {
                uci: notation::move_to_uci(chosen),
                at: now,
                opponent,
            },
        )?;
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
        let after = self.snapshot()?;
        let now_over = after.current();
        if now_over.index == index && !now_over.unfinished() {
            app::emit!(Event::GameEnded {
                game: index,
                result: now_over.result.clone(),
                reason: now_over.reason.clone(),
            });
        }

        Ok(san)
    }

    /// Resign the current game. Only a seated player can, and only while it is
    /// still being played.
    pub fn resign(&mut self, now: u64) -> app::Result<()> {
        let id = Self::caller_id();
        let snap = self.snapshot()?;
        let game = snap.current();
        if !game.unfinished() {
            app::bail!("this game is over");
        }
        let Some(color) = snap.color_of(&id) else {
            app::bail!("only a seated player can resign");
        };
        self.end_game(game, &win_for(color.other()), "resignation", &id, now)
    }

    /// Offer a draw in the current position. The offer stands until the
    /// position changes.
    pub fn offer_draw(&mut self, now: u64) -> app::Result<()> {
        let id = Self::caller_id();
        let snap = self.snapshot()?;
        let game = snap.current();
        if !game.unfinished() {
            app::bail!("this game is over");
        }
        if snap.color_of(&id).is_none() {
            app::bail!("only a seated player can offer a draw");
        }
        self.write_offer(game, &id, false, now)?;
        app::emit!(Event::DrawOffered {
            game: game.index,
            by: id.clone()
        });
        Ok(())
    }

    /// Accept the opponent's standing offer.
    pub fn accept_draw(&mut self, now: u64) -> app::Result<()> {
        let id = Self::caller_id();
        let snap = self.snapshot()?;
        let game = snap.current();
        if !game.unfinished() {
            app::bail!("this game is over");
        }
        let Some(color) = snap.color_of(&id) else {
            app::bail!("only a seated player can accept a draw");
        };
        let offered = game.standing_offer();
        if offered.is_empty() || offered != game.member_for(color.other()) {
            app::bail!("there is no draw offer to accept");
        }
        self.end_game(game, "1/2-1/2", "agreement", &id, now)
    }

    /// Refuse the opponent's standing offer. (A move refuses it too.)
    pub fn decline_draw(&mut self, now: u64) -> app::Result<()> {
        let id = Self::caller_id();
        let snap = self.snapshot()?;
        let game = snap.current();
        let Some(color) = snap.color_of(&id) else {
            app::bail!("only a seated player can decline a draw");
        };
        let opponent = game.member_for(color.other());
        // ⚠️ The offer belongs to the OPPONENT, and only its owner may write it
        // — so declining cannot close their row. It is recorded as the
        // decliner's own, and the reader stops counting an offer once the
        // other player has refused it at the same ply.
        if opponent.is_empty() || game.standing_offer() != opponent {
            app::bail!("there is no draw offer to decline");
        }
        self.write_offer(game, &id, true, now)?;
        app::emit!(Event::DrawDeclined {
            game: game.index,
            by: id.clone()
        });
        Ok(())
    }

    /// Claim the draw the position allows — threefold repetition or the
    /// fifty-move rule. Both are claims under the rules of chess, so neither
    /// ends a game on its own.
    pub fn claim_draw(&mut self, now: u64) -> app::Result<()> {
        let id = Self::caller_id();
        let snap = self.snapshot()?;
        let game = snap.current();
        if !game.unfinished() {
            app::bail!("this game is over");
        }
        if snap.color_of(&id).is_none() {
            app::bail!("only a seated player can claim a draw");
        }
        let reason = match game.replay.claimable() {
            Some(ClaimableDraw::ThreefoldRepetition) => "threefold",
            Some(ClaimableDraw::FiftyMove) => "fiftyMove",
            None => app::bail!("there is no draw to claim in this position"),
        };
        self.end_game(game, "1/2-1/2", reason, &id, now)
    }

    /// Start the next game. Colours swap, so the player who had Black has
    /// White. Only allowed once the current game is finished.
    pub fn rematch(&mut self, now: u64) -> app::Result<u32> {
        let id = Self::caller_id();
        let snap = self.snapshot()?;
        let game = snap.current();
        if game.unfinished() {
            app::bail!("finish this game first");
        }
        if snap.color_of(&id).is_none() {
            app::bail!("only a seated player can start a rematch");
        }

        let next = game.index.saturating_add(1);
        // Each player's claim lives under their own key, and the snapshot
        // counts a game as started if EITHER seat holder validly claimed it —
        // so two rematches started at once still produce one new game rather
        // than a contested row.
        let key = Self::free_key(&self.games, now, |nonce| claim_key(&id, next, nonce))?;
        self.games.insert(key, GameRecord { started_at: now })?;
        app::emit!(Event::GameStarted { game: next });
        Ok(next)
    }

    // ── internals: the reader ───────────────────────────────────────────────

    /// The table as the reader derives it: who holds each chair, then every
    /// game it validly reached, each one played out from its rows.
    ///
    /// ONE pass over the rows, each map read by author-and-game prefix. The
    /// game index is COUNTED, not read: game `n + 1` exists only if a seat
    /// holder claimed a rematch of a game `n` that was already decided —
    /// reading a stored index instead let any member move every reader to an
    /// empty board, hiding the real game behind it.
    fn snapshot(&self) -> app::Result<Snapshot> {
        let chairs = self.chairs()?;
        let mut games: Vec<Played> = Vec::new();
        for index in 0..MAX_GAMES {
            let started_at = match games.last() {
                None => *self.created_at.get()?,
                Some(previous) if previous.unfinished() => break,
                Some(previous) => match self.rematch_started(index, previous)? {
                    Some(at) => at,
                    None => break,
                },
            };
            let member = |color| {
                chairs[usize::from(self.seat_for_color(index, color) == SEAT_BLACK)]
                    .member
                    .clone()
            };
            games.push(self.play_out(
                index,
                started_at,
                member(Color::White),
                member(Color::Black),
            )?);
        }
        Ok(Snapshot { chairs, games })
    }

    /// When game `index` was started, if one of the previous game's players
    /// validly claimed it: the earliest such claim.
    fn rematch_started(&self, index: u32, previous: &Played) -> app::Result<Option<u64>> {
        let mut earliest: Option<u64> = None;
        for member in distinct(&previous.white, &previous.black) {
            let prefix = claim_prefix(member, index);
            for (_, record) in Self::owned_rows(&self.games, &prefix, member)? {
                earliest = Some(earliest.map_or(record.started_at, |at| at.min(record.started_at)));
            }
        }
        Ok(earliest)
    }

    /// Play game `index` out from its rows.
    ///
    /// Ply by ply, the reader's arithmetic, and at each ply in this order:
    ///
    /// 1. **The board.** A position the rules have already ended ends the game,
    ///    whatever rows sit past it.
    /// 2. **A person's ending.** The earliest valid one written at THIS ply
    ///    ends the game here, so a move written at this ply afterwards cannot
    ///    un-resign anyone (see [`Self::ending_holds`]).
    /// 3. **The move.** Only the player to move's own rows at this ply count,
    ///    and of those, only the ones that are legal here. Exactly one distinct
    ///    legal move is played. None means the game waits. Two or more is
    ///    EQUIVOCATION and loses: written once, rows cannot be taken back, so
    ///    choosing between them by their clock — a value their author sets —
    ///    would let a player file a backdated second move at an old ply and
    ///    rewrite the game from there.
    fn play_out(
        &self,
        index: u32,
        started_at: u64,
        white: MemberId,
        black: MemberId,
    ) -> app::Result<Played> {
        let mut rows: BTreeMap<MemberId, BTreeMap<u32, Vec<MoveRecord>>> = BTreeMap::new();
        let mut endings: BTreeMap<u32, Vec<(Color, Ending)>> = BTreeMap::new();
        let mut offers: BTreeMap<MemberId, Vec<DrawOffer>> = BTreeMap::new();
        for member in distinct(&white, &black) {
            let mut by_ply: BTreeMap<u32, Vec<MoveRecord>> = BTreeMap::new();
            if !white.is_empty() && !black.is_empty() {
                for (key, record) in
                    Self::owned_rows(&self.moves, &game_prefix(member, index), member)?
                {
                    if let Some(ply) = key_segment(&key, 2).and_then(|s| s.parse().ok()) {
                        by_ply.entry(ply).or_default().push(record);
                    }
                }
            }
            let _previous = rows.insert(member.to_owned(), by_ply);
            let claims = claim_prefix(member, index);
            for (_, ending) in Self::owned_rows(&self.endings, &claims, member)? {
                for color in [Color::White, Color::Black] {
                    if (if color == Color::White {
                        &white
                    } else {
                        &black
                    }) == member
                    {
                        endings
                            .entry(ending.ply)
                            .or_default()
                            .push((color, ending.clone()));
                    }
                }
            }
            let mine = Self::owned_rows(&self.draw_offers, &claims, member)?;
            let _previous = offers.insert(
                member.to_owned(),
                mine.into_iter().map(|(_, o)| o).collect(),
            );
        }

        let mut played = Played {
            index,
            started_at,
            white,
            black,
            moves: Vec::new(),
            replay: game::replay::<String>(&[]),
            result: "*".to_owned(),
            reason: String::new(),
            offers,
        };

        let mut position = Position::initial();
        let mut keys = vec![position.repetition_key()];
        let mut ucis: Vec<String> = Vec::new();
        for ply in 0..=MAX_PLY {
            if let Some(outcome) = movegen::outcome(&position, &keys) {
                (played.result, played.reason) = describe_outcome(outcome);
                break;
            }
            let pending = endings.remove(&ply).unwrap_or_default();
            if let Some(ending) = Self::earliest_holding(&played, ply, &position, &keys, pending) {
                played.result = ending.result;
                played.reason = ending.reason;
                break;
            }
            if ply == MAX_PLY {
                break;
            }
            let side = position.side_to_move;
            let author = played.member_for(side).to_owned();
            let candidates = rows
                .get(&author)
                .and_then(|by_ply| by_ply.get(&ply))
                .cloned()
                .unwrap_or_default();
            // Distinct legal moves, each with its earliest row for display.
            let mut legal: BTreeMap<String, (board::Move, MoveRecord)> = BTreeMap::new();
            for record in candidates {
                let Some(mv) =
                    notation::parse_uci(&record.uci).and_then(|mv| find_legal(&position, mv))
                else {
                    continue;
                };
                let uci = notation::move_to_uci(mv);
                let keep = legal.get(&uci).is_none_or(|(_, kept)| record.at < kept.at);
                if keep {
                    let _previous = legal.insert(uci, (mv, record));
                }
            }
            if legal.len() > 1 {
                played.result = win_for(side.other());
                played.reason = "equivocation".to_owned();
                break;
            }
            let Some((uci, (mv, record))) = legal.into_iter().next() else {
                break;
            };
            position = position.apply(mv);
            keys.push(position.repetition_key());
            ucis.push(uci);
            played.moves.push(record);
        }
        played.replay = game::replay(&ucis);
        Ok(played)
    }

    /// The earliest of `pending` — the endings written at `ply` — that holds
    /// in this position, if any. Ties on the clock break on the encoding, so
    /// every replica picks the same one; a clock can only choose between two
    /// endings that BOTH hold, never make one hold.
    fn earliest_holding(
        game: &Played,
        ply: u32,
        position: &Position,
        keys: &[String],
        pending: Vec<(Color, Ending)>,
    ) -> Option<Ending> {
        pending
            .into_iter()
            .filter(|(color, ending)| Self::ending_holds(game, *color, ending, ply, position, keys))
            .map(|(_, ending)| {
                let bytes = calimero_sdk::borsh::to_vec(&ending).unwrap_or_default();
                (ending.at, bytes, ending)
            })
            .min_by(|a, b| (a.0, &a.1).cmp(&(b.0, &b.1)))
            .map(|(_, _, ending)| ending)
    }

    /// Can `color` actually have ended the game this way, at this ply?
    ///
    /// * **resignation** — the result must be a LOSS for the player who wrote
    ///   it. Nobody resigns themselves into a win.
    /// * **agreement** — the opponent must have offered a draw at this ply. An
    ///   agreement is two acts; only one of them is this row.
    /// * **threefold / fiftyMove** — the position must genuinely allow the
    ///   claim, which the reader works out from the moves.
    fn ending_holds(
        game: &Played,
        color: Color,
        ending: &Ending,
        ply: u32,
        position: &Position,
        keys: &[String],
    ) -> bool {
        let draw = ending.result == "1/2-1/2";
        let claimable = movegen::claimable_draw(position, keys);
        match ending.reason.as_str() {
            "resignation" => ending.result == win_for(color.other()),
            "agreement" => {
                let opponent = game.member_for(color.other());
                draw && !opponent.is_empty() && game.offered(opponent, ply)
            }
            "threefold" => draw && claimable == Some(ClaimableDraw::ThreefoldRepetition),
            "fiftyMove" => draw && claimable == Some(ClaimableDraw::FiftyMove),
            // An unknown reason is not a way to end a game.
            _ => false,
        }
    }

    /// Who holds each chair: `[white chair, black chair]`.
    ///
    /// The claims are per claimant, under keys only they can write, so nobody
    /// can file a claim as someone else or squat a chair's key. Choosing
    /// between two real claims is the hard part, because the only order they
    /// carry is `claimed_at` — a clock the claimant sets. Left at "earliest
    /// wins", a spectator could file a claim dated before everyone's and take
    /// a chair in the middle of a game, with the whole move list following
    /// them out of the door.
    ///
    /// So the chairs LOCK once each player has moved against the other. Every
    /// move row names the opponent its author saw (see
    /// [`MoveRecord::opponent`]), in a row that author alone can write and
    /// nobody can remove. A pair who have each named the other are the
    /// players, whatever anyone else files later:
    ///
    /// 1. Among such confirmed pairs, one of two different people outranks one
    ///    person in both chairs — an outsider can confirm a pair with
    ///    themselves, but not with a player who never named them.
    /// 2. Before any pair is confirmed, each chair goes to its earliest claim,
    ///    ties broken on the encoding so every replica agrees.
    ///
    /// Given up claims do not count; see [`Self::is_vacated`].
    fn chairs(&self) -> app::Result<[Holder; 2]> {
        let mut claims: [BTreeMap<MemberId, Seat>; 2] = Default::default();
        for (slot, seat) in SEATS.into_iter().enumerate() {
            for (key, claim) in self.seat_claims.prefix(seat_prefix(seat).as_bytes())? {
                let Some(author) = key_segment(&key, 1) else {
                    continue;
                };
                if Self::owner(&self.seat_claims, &key)? != author
                    || self.is_vacated(&key, author)?
                {
                    continue;
                }
                // A claimant's earliest row stands for their claim.
                let earlier = claims[slot].get(author).is_none_or(|kept| {
                    (claim.claimed_at, &claim.name) < (kept.claimed_at, &kept.name)
                });
                if earlier {
                    let _previous = claims[slot].insert(author.to_owned(), claim);
                }
            }
        }

        // `(chair, author, opponent)` for every move a claimant wrote.
        let mut named: BTreeSet<(usize, MemberId, MemberId)> = BTreeSet::new();
        let claimants: BTreeSet<&MemberId> = claims.iter().flat_map(BTreeMap::keys).collect();
        for author in claimants {
            for (key, record) in Self::owned_rows(&self.moves, &format!("{author}/"), author)? {
                let game = key_segment(&key, 1).and_then(|s| s.parse::<u32>().ok());
                let ply = key_segment(&key, 2).and_then(|s| s.parse::<u32>().ok());
                let (Some(game), Some(ply)) = (game, ply) else {
                    continue;
                };
                let color = if ply % 2 == 0 {
                    Color::White
                } else {
                    Color::Black
                };
                let chair = usize::from(self.seat_for_color(game, color) == SEAT_BLACK);
                let _new = named.insert((chair, author.clone(), record.opponent));
            }
        }

        let earliest = |slot: usize| -> Option<(MemberId, Seat)> {
            claims[slot]
                .iter()
                .min_by(|a, b| {
                    let key = |(m, s): &(&MemberId, &Seat)| {
                        (
                            s.claimed_at,
                            calimero_sdk::borsh::to_vec(*s).unwrap_or_default(),
                            (*m).clone(),
                        )
                    };
                    key(a).cmp(&key(b))
                })
                .map(|(m, s)| (m.clone(), s.clone()))
        };

        let confirmed = claims[0]
            .iter()
            .flat_map(|w| claims[1].iter().map(move |b| (w, b)))
            .filter(|((w, _), (b, _))| {
                named.contains(&(0, (*w).clone(), (*b).clone()))
                    && named.contains(&(1, (*b).clone(), (*w).clone()))
            })
            .min_by_key(|((w, ws), (b, bs))| {
                (
                    w == b,
                    ws.claimed_at,
                    bs.claimed_at,
                    (*w).clone(),
                    (*b).clone(),
                )
            })
            .map(|((w, ws), (b, bs))| [(w.clone(), ws.clone()), (b.clone(), bs.clone())]);

        let pick =
            confirmed.map_or_else(|| [earliest(0), earliest(1)], |[w, b]| [Some(w), Some(b)]);
        Ok(pick.map(|choice| {
            choice.map_or_else(Holder::default, |(member, seat)| Holder {
                member,
                name: seat.name,
            })
        }))
    }

    /// Has the claimant who wrote `claim_key` given it up?
    ///
    /// Only a claimant who has never acted at the table can: a chair someone
    /// has played, resigned, offered or rematched from is the record of who
    /// played, so a row saying they left it is ignored rather than allowed to
    /// rewrite every game they were in.
    fn is_vacated(&self, claim_key: &str, author: &str) -> app::Result<bool> {
        let given_up =
            !Self::owned_rows(&self.vacated, &format!("{claim_key}/"), author)?.is_empty();
        Ok(given_up && !self.has_acted(author)?)
    }

    /// Has `member` written any move, ending, offer or rematch claim here?
    fn has_acted(&self, member: &str) -> app::Result<bool> {
        let prefix = format!("{member}/");
        Ok(!Self::owned_rows(&self.moves, &prefix, member)?.is_empty()
            || !Self::owned_rows(&self.endings, &prefix, member)?.is_empty()
            || !Self::owned_rows(&self.draw_offers, &prefix, member)?.is_empty()
            || !Self::owned_rows(&self.games, &prefix, member)?.is_empty())
    }

    /// The account core recorded as the writer of `key`, or `""`.
    ///
    /// The stamp, not a field: core verifies a per-action signature against it
    /// inside `Interface::apply_action` on every receive path, so unlike
    /// anything inside the value, a member cannot set it to someone else.
    fn owner<V, P>(map: &Guarded<SortedMap<String, V>, P>, key: &String) -> app::Result<MemberId>
    where
        V: BorshSerialize + BorshDeserialize + 'static,
        P: Owning,
    {
        Ok(map
            .owner_of(key)?
            .map_or_else(String::new, |owner| Self::owner_id(owner.as_bytes())))
    }

    /// Every row under `prefix` that `author` really wrote — the one place a
    /// stored row becomes evidence. The prefix names the author; core's owner
    /// stamp has to agree, and a member cannot forge that for anyone but
    /// themselves.
    ///
    /// A prefix seek, not a scan: rows a byzantine peer files under somebody
    /// else's name cost a stamp check only when a reader asks for that name.
    fn owned_rows<V, P>(
        map: &Guarded<SortedMap<String, V>, P>,
        prefix: &str,
        author: &str,
    ) -> app::Result<Vec<(String, V)>>
    where
        V: BorshSerialize + BorshDeserialize + 'static,
        P: Owning,
    {
        let mut rows = Vec::new();
        for (key, value) in map.prefix(prefix.as_bytes())? {
            if !author.is_empty() && Self::owner(map, &key)? == author {
                rows.push((key, value));
            }
        }
        Ok(rows)
    }

    /// A key in `map` nobody has written yet.
    ///
    /// Starts at `now` and walks forward past any taken key, so a squatted key
    /// costs the writer one more attempt rather than their turn. Bounded: if
    /// this cannot find a free key in a few tries, the map is under an attack
    /// that a longer loop would not fix either.
    fn free_key<C, P>(
        map: &Guarded<C, P>,
        now: u64,
        build: impl Fn(u64) -> String,
    ) -> app::Result<String>
    where
        C: GuardedEntries<Key = String>,
        P: Policy,
    {
        for offset in 0..16 {
            let key = build(now.saturating_add(offset));
            if !map.contains(&key)? {
                return Ok(key);
            }
        }
        app::bail!("could not find a free slot to write to")
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

    fn seat_view(&self, snap: &Snapshot, seat: &str, now: u64) -> app::Result<SeatView> {
        let holder = snap.holder(seat);
        let online = !holder.member.is_empty() && self.is_online(&holder.member, now)?;
        Ok(SeatView {
            seat: seat.to_owned(),
            member: holder.member.clone(),
            name: holder.name.clone(),
            online,
        })
    }

    fn is_online(&self, member: &str, now: u64) -> app::Result<bool> {
        Ok(self
            .presence_of(member)?
            .is_some_and(|p| now.saturating_sub(p.updated_at) <= PRESENCE_TTL_MS))
    }

    /// The presence row `member` wrote about themselves.
    fn presence_of(&self, member: &str) -> app::Result<Option<Player>> {
        Ok(self
            .players
            .entries()?
            .find(|(account, _)| Self::owner_id(account.as_bytes()) == member)
            .map(|(_, player)| player))
    }

    fn player_views(&self, snap: &Snapshot, now: u64) -> app::Result<Vec<PlayerView>> {
        let mut out: Vec<PlayerView> = Vec::new();
        for (account, player) in self.players.entries()? {
            let id = Self::owner_id(account.as_bytes());
            out.push(PlayerView {
                online: now.saturating_sub(player.updated_at) <= PRESENCE_TTL_MS,
                color: snap.color_of(&id).map_or("", color_name).to_owned(),
                id,
                name: player.name,
            });
        }
        // Sorted so two clients polling the same table paint the same list.
        out.sort_by(|a, b| a.id.cmp(&b.id));
        Ok(out)
    }

    // ── internals: writing ──────────────────────────────────────────────────

    fn end_game(
        &mut self,
        game: &Played,
        result: &str,
        reason: &str,
        by: &str,
        now: u64,
    ) -> app::Result<()> {
        // Under the caller's OWN key. An ending is a claim by one player about
        // one game, and the reader re-derives whether they could have made it.
        let key = Self::free_key(&self.endings, now, |nonce| claim_key(by, game.index, nonce))?;
        self.endings.insert(
            key,
            Ending {
                result: result.to_owned(),
                reason: reason.to_owned(),
                ply: game.ply(),
                at: now,
            },
        )?;
        self.touch(by, now)?;
        app::emit!(Event::GameEnded {
            game: game.index,
            result: result.to_owned(),
            reason: reason.to_owned(),
        });
        Ok(())
    }

    fn write_offer(
        &mut self,
        game: &Played,
        by: &str,
        declined: bool,
        now: u64,
    ) -> app::Result<()> {
        let key = Self::free_key(&self.draw_offers, now, |nonce| {
            claim_key(by, game.index, nonce)
        })?;
        self.draw_offers.insert(
            key,
            DrawOffer {
                declined,
                ply: game.ply(),
                at: now,
            },
        )?;
        Ok(())
    }

    /// Keep a player's presence fresh whenever they do something.
    fn touch(&mut self, member: &str, now: u64) -> app::Result<()> {
        if self.presence_of(member)?.is_none() {
            return Ok(());
        }
        self.announce(None, now)
    }

    /// Write the caller's presence row. `name` of `None` keeps the current one.
    fn announce(&mut self, name: Option<String>, now: u64) -> app::Result<()> {
        let existing = self.players.get()?;
        let _previous = self.players.insert(Player {
            name: name
                .or_else(|| existing.as_ref().map(|p| p.name.clone()))
                .unwrap_or_else(|| "Guest".to_owned()),
            joined_at: existing.map_or(now, |p| p.joined_at),
            updated_at: now,
        })?;
        Ok(())
    }
}

// ── free helpers ─────────────────────────────────────────────────────────────

/// Zero-padded so the key order is the game order. Four digits is 10 000 games
/// at one table.
fn game_key(index: u32) -> String {
    format!("{index:04}")
}

/// `"<account>/<game>/<ply>/<nonce>"` — where one player's move at one ply
/// lives.
///
/// * the **account** first, so a reader seeks straight to the rows of the two
///   people it is asking about, and rows filed under anybody else's name are
///   never even loaded — they cost the writer storage and the reader nothing;
/// * the **game** and **ply** next, so the reader asks for a specific move
///   rather than sorting rows by a field their writer controls;
/// * the **nonce**, so a key can never be OCCUPIED against its rightful author.
///   An insert refuses an existing key, so without this any context member
///   could park a row on the key the next move needs and permanently wedge the
///   table. With a fresh nonce per write there is always a free key, and a
///   squatted row is just an extra row the reader filters out.
fn move_key(author: &str, index: u32, ply: u32, nonce: u64) -> String {
    format!("{author}/{}/{ply:04}/{nonce}", game_key(index))
}

/// The prefix every move row of one player in one game shares.
fn game_prefix(author: &str, index: u32) -> String {
    format!("{author}/{}/", game_key(index))
}

/// `"<account>/<game>/<nonce>"` — one player's claim about one game: their draw
/// offer, their ending, their rematch. Nonce for the same reason as above.
fn claim_key(author: &str, index: u32, nonce: u64) -> String {
    format!("{author}/{}/{nonce}", game_key(index))
}

fn claim_prefix(author: &str, index: u32) -> String {
    format!("{author}/{}/", game_key(index))
}

/// `"<seat>/<account>/<nonce>"` — one person's claim on one chair.
fn seat_key(seat: &str, member: &str, nonce: u64) -> String {
    format!("{seat}/{member}/{nonce}")
}

fn seat_prefix(seat: &str) -> String {
    format!("{seat}/")
}

/// The `n`th `/`-separated segment of a key.
fn key_segment(key: &str, n: usize) -> Option<&str> {
    key.split('/').nth(n).filter(|s| !s.is_empty())
}

/// The seat holders of one game, once each — a player in both chairs is one
/// person, and their rows are read once.
fn distinct<'a>(white: &'a str, black: &'a str) -> Vec<&'a str> {
    let mut out: Vec<&str> = [white, black]
        .into_iter()
        .filter(|m| !m.is_empty())
        .collect();
    out.dedup();
    out
}

/// The legal move in `position` that `mv` names, with the promotion piece
/// filled in the same way for every caller — a promotion with no piece named
/// is a queening, which is what a board does when you drag a pawn onto the
/// last rank.
fn find_legal(position: &Position, mv: board::Move) -> Option<board::Move> {
    movegen::legal_moves(position)
        .into_iter()
        .find(|candidate| {
            candidate.from == mv.from
                && candidate.to == mv.to
                && (mv.promotion.is_none() || candidate.promotion == mv.promotion)
        })
}

fn normalize_seat(seat: &str) -> app::Result<&'static str> {
    match seat.trim().to_ascii_lowercase().as_str() {
        SEAT_WHITE => Ok(SEAT_WHITE),
        SEAT_BLACK => Ok(SEAT_BLACK),
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
/// by their position in it, named by the SAN the replay derived, and credited
/// to the player whose ply each one is — never to a name a row carries.
fn move_views(game: &Played) -> Vec<MoveView> {
    game.moves
        .iter()
        .enumerate()
        .map(|(ply, record)| MoveView {
            ply: ply as u32,
            uci: record.uci.clone(),
            san: game
                .replay
                .sans
                .get(ply)
                .cloned()
                .unwrap_or_else(|| record.uci.clone()),
            by: game
                .member_for(if ply % 2 == 0 {
                    Color::White
                } else {
                    Color::Black
                })
                .to_owned(),
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
