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
//! **Seats are first-write-wins.** Two people claiming White at once resolve
//! the same way on every replica, so nobody ends up holding a seat on their own
//! node and not on anyone else's.
//!
//! **Endings are stored only when a PERSON ends the game** — a resignation, an
//! agreed draw, a claimed one. Checkmate, stalemate, insufficient material,
//! fivefold and the seventy-five-move rule are properties of the move list and
//! are derived on read, so they need no write and cannot disagree with it.

use std::cmp::Ordering;

use calimero_sdk::abi::AbiType;
use calimero_sdk::borsh::{BorshDeserialize, BorshSerialize};
use calimero_sdk::serde::{Deserialize, Serialize};
use calimero_sdk::{app, env as sdk_env, PublicKey};
use calimero_storage::collections::crdt_meta::MergeError;
use calimero_storage::collections::{LwwRegister, Mergeable as MergeableTrait, UnorderedMap};

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

/// One of the two chairs at this table.
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
        // First claim wins: you cannot be evicted from a chair you sat down in
        // first by someone whose node has a faster clock.
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

#[app::state(emits = Event)]
pub struct MeroChess {
    title: LwwRegister<String>,
    created_at: LwwRegister<u64>,
    /// Everyone who has ever opened this table, seated or not.
    players: UnorderedMap<MemberId, Player>,
    /// `white` / `black` -> whoever claimed that chair first.
    seats: UnorderedMap<String, Seat>,
    /// Zero-padded game index -> the game.
    games: UnorderedMap<String, GameRecord>,
    /// `"<game>/<ply>"`, both zero-padded -> the move played there.
    moves: UnorderedMap<String, MoveRecord>,
    /// Zero-padded game index -> how a person ended it.
    endings: UnorderedMap<String, Ending>,
    /// `"<game>/<member>"` -> that player's standing offer.
    draw_offers: UnorderedMap<String, DrawOffer>,
}

#[app::logic]
impl MeroChess {
    #[app::init]
    pub fn init(title: String, now: u64) -> MeroChess {
        let mut state = MeroChess {
            title: LwwRegister::new(clean_name(&title, "Chess")),
            created_at: LwwRegister::new(now),
            players: UnorderedMap::new(),
            seats: UnorderedMap::new(),
            games: UnorderedMap::new(),
            moves: UnorderedMap::new(),
            endings: UnorderedMap::new(),
            draw_offers: UnorderedMap::new(),
        };
        // Game 0 exists from the start, so "sit down and move" needs no setup
        // step and `current_game` never has to invent an answer.
        let _ignored = state.games.insert(
            game_key(0),
            GameRecord {
                index: 0,
                started_at: now,
                started_by: String::new(),
            },
        );
        app::emit!(Event::Initialized());
        state
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

    // ── reading the table ───────────────────────────────────────────────────

    /// The whole table in one call — see [`TableView`].
    pub fn table(&self, now: u64) -> app::Result<TableView> {
        let index = self.current_game()?;
        let moves = self.moves_of(index)?;
        let replayed = game::replay(&moves.iter().map(|m| m.uci.clone()).collect::<Vec<_>>());
        let (result, reason) = self.resolve_result(index, &replayed)?;

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
            moves: moves.iter().map(move_view).collect(),
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
            games_played: self.games.len()? as u32,
        })
    }

    /// Every game this table has played, oldest first.
    pub fn history(&self) -> app::Result<Vec<GameSummary>> {
        let mut out = Vec::new();
        for index in self.game_indices()? {
            let moves = self.moves_of(index)?;
            let replayed = game::replay(&moves.iter().map(|m| m.uci.clone()).collect::<Vec<_>>());
            let (result, reason) = self.resolve_result(index, &replayed)?;
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

        self.players.insert(
            id.clone(),
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
        if let Some(mut player) = self.players.get_mut(&id)? {
            player.updated_at = now;
            drop(player);
        }
        Ok(())
    }

    /// Take the `white` or `black` chair, if it is free.
    ///
    /// The seat name is the colour you hold in the FIRST game; colours swap on
    /// every rematch.
    pub fn sit(&mut self, seat: String, name: String, now: u64) -> app::Result<()> {
        let seat = normalize_seat(&seat)?;
        let id = Self::caller_id();
        let display = clean_name(&name, "Guest");

        if let Some(held) = self.seats.get(&seat)? {
            if held.member == id {
                return Ok(()); // already yours — idempotent, not an error
            }
            app::bail!("that seat is taken");
        }
        // Taking BOTH chairs is allowed on purpose: one person, one node, a
        // board they move for each side in turn. It is how chess is played when
        // the other person is in the room, it is how a position gets analysed,
        // and it is the only way to use this app before anyone else has a node.
        // The rule that matters — a seat someone else holds is theirs — is
        // above, and nothing below this line distinguishes the two cases.

        self.players.insert(
            id.clone(),
            Player {
                id: id.clone(),
                name: display.clone(),
                joined_at: now,
                updated_at: now,
            },
        )?;
        self.seats.insert(
            seat.clone(),
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
        let _removed = self.seats.remove(&seat)?;
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

        let (result, _reason) = self.resolve_result(index, &replayed)?;
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
            san: san.clone(),
            by: id.clone(),
            at: now,
        };
        self.moves.insert(move_key(index, ply), record)?;
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
        let (result, _reason) = self.resolve_result(index, &replayed)?;
        if result != "*" {
            app::bail!("this game is over");
        }
        let Some(color) = self.color_of(index, &id, replayed.position.side_to_move)? else {
            app::bail!("only a seated player can resign");
        };

        let result = win_for(color.other());
        self.end_game(index, &result, "resignation", &id, now)?;
        Ok(())
    }

    /// Offer a draw in the current position. The offer stands until the
    /// position changes.
    pub fn offer_draw(&mut self, now: u64) -> app::Result<()> {
        let id = Self::caller_id();
        let index = self.current_game()?;
        let replayed = self.replay_game(index)?;
        let (result, _reason) = self.resolve_result(index, &replayed)?;
        if result != "*" {
            app::bail!("this game is over");
        }
        if self
            .color_of(index, &id, replayed.position.side_to_move)?
            .is_none()
        {
            app::bail!("only a seated player can offer a draw");
        }

        self.draw_offers.insert(
            offer_key(index, &id),
            DrawOffer {
                open: true,
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
        let (result, _reason) = self.resolve_result(index, &replayed)?;
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

        self.end_game(index, "1/2-1/2", "agreement", &id, now)?;
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

        let key = offer_key(index, &opponent);
        let Some(mut offer) = self.draw_offers.get_mut(&key)? else {
            app::bail!("there is no draw offer to decline");
        };
        offer.open = false;
        offer.at = now;
        drop(offer);

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
        let (result, _reason) = self.resolve_result(index, &replayed)?;
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
        self.end_game(index, "1/2-1/2", reason, &id, now)?;
        Ok(())
    }

    /// Start the next game. Colours swap, so the player who had Black has
    /// White. Only allowed once the current game is finished.
    pub fn rematch(&mut self, now: u64) -> app::Result<u32> {
        let id = Self::caller_id();
        let index = self.current_game()?;
        let replayed = self.replay_game(index)?;
        let (result, _reason) = self.resolve_result(index, &replayed)?;
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
        // Concurrent rematches from both players write the SAME key, so the
        // merge picks one record and both replicas agree on one new game.
        self.games.insert(
            game_key(next),
            GameRecord {
                index: next,
                started_at: now,
                started_by: id,
            },
        )?;
        app::emit!(Event::GameStarted { game: next });
        Ok(next)
    }

    // ── internals ───────────────────────────────────────────────────────────

    /// The highest game index that exists. Game 0 is created by `init`, so
    /// there is always one.
    fn current_game(&self) -> app::Result<u32> {
        Ok(self.game_indices()?.last().copied().unwrap_or(0))
    }

    fn game_indices(&self) -> app::Result<Vec<u32>> {
        let mut indices: Vec<u32> = self
            .games
            .entries()?
            .map(|(_, record)| record.index)
            .collect();
        indices.sort_unstable();
        Ok(indices)
    }

    /// The moves of one game, in ply order.
    fn moves_of(&self, index: u32) -> app::Result<Vec<MoveRecord>> {
        let prefix = format!("{}/", game_key(index));
        let mut moves: Vec<MoveRecord> = self
            .moves
            .entries()?
            .filter(|(key, _)| key.starts_with(&prefix))
            .map(|(_, record)| record)
            .collect();
        moves.sort_by_key(|m| m.ply);
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

    fn seat_member(&self, seat: &str) -> app::Result<MemberId> {
        Ok(self
            .seats
            .get(seat)?
            .map_or_else(String::new, |held| held.member.clone()))
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
        let held = self.seats.get(seat)?;
        let (member, name) = held.map_or_else(
            || (String::new(), String::new()),
            |held| (held.member.clone(), held.name.clone()),
        );
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
            .players
            .get(member)?
            .is_some_and(|p| now.saturating_sub(p.updated_at) <= PRESENCE_TTL_MS))
    }

    fn player_views(
        &self,
        index: u32,
        side_to_move: Color,
        now: u64,
    ) -> app::Result<Vec<PlayerView>> {
        let mut out: Vec<PlayerView> = Vec::new();
        for (_, player) in self.players.entries()? {
            let color = match self.color_of(index, &player.id, side_to_move)? {
                Some(color) => color_name(color).to_owned(),
                None => String::new(),
            };
            out.push(PlayerView {
                online: now.saturating_sub(player.updated_at) <= PRESENCE_TTL_MS,
                id: player.id,
                name: player.name,
                color,
            });
        }
        // Sorted so two clients polling the same table paint the same list.
        out.sort_by(|a, b| a.id.cmp(&b.id));
        Ok(out)
    }

    /// The result of game `index`: the board's answer if it has one, otherwise
    /// whatever a player did, otherwise unfinished.
    ///
    /// The order matters. A board ending is a FACT about the move list, so it
    /// outranks a stored one — that is also what makes a resignation written
    /// concurrently with the mating move harmless.
    fn resolve_result(&self, index: u32, replayed: &game::Replay) -> app::Result<(String, String)> {
        if let Some(outcome) = replayed.outcome() {
            return Ok(describe_outcome(outcome));
        }
        if let Some(ending) = self.endings.get(&game_key(index))? {
            return Ok((ending.result.clone(), ending.reason.clone()));
        }
        Ok(("*".to_owned(), String::new()))
    }

    /// The member whose draw offer is still standing at `ply`, or `""`.
    fn standing_offer(&self, index: u32, ply: u32) -> app::Result<MemberId> {
        let prefix = format!("{}/", game_key(index));
        for (key, offer) in self.draw_offers.entries()? {
            if !key.starts_with(&prefix) {
                continue;
            }
            // An offer is good for the position it was made in and no other.
            if offer.open && offer.ply == ply {
                return Ok(key[prefix.len()..].to_owned());
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
        now: u64,
    ) -> app::Result<()> {
        self.endings.insert(
            game_key(index),
            Ending {
                result: result.to_owned(),
                reason: reason.to_owned(),
                by: by.to_owned(),
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
        if let Some(mut player) = self.players.get_mut(member)? {
            player.updated_at = now;
            drop(player);
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

fn move_key(index: u32, ply: u32) -> String {
    format!("{}/{ply:04}", game_key(index))
}

fn offer_key(index: u32, member: &str) -> String {
    format!("{}/{member}", game_key(index))
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

fn move_view(record: &MoveRecord) -> MoveView {
    MoveView {
        ply: record.ply,
        uci: record.uci.clone(),
        san: record.san.clone(),
        by: record.by.clone(),
        at: record.at,
    }
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
