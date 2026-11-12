//! Mero Chess: a chess table that is a Calimero app instance, on core's
//! component SDK (`calimero-sdk`).
//!
//! Two people sit down and play. There is no game server: every move is a
//! CALL, one entry in the app's replicated log, and the rules live here, in
//! `board` / `movegen` / `notation`, so a client cannot play an illegal move by
//! asking nicely. A client does not have to implement chess to be a full
//! participant either: [`MeroChess::table`] hands it the legal moves.
//!
//! ## What is stored
//!
//! The app runs on its cluster's leader, which applies every call in one log,
//! so the state is plain data: the two chairs, every game (its result, how it
//! ended, the draw offers made in it) and every move, keyed by `(game, ply)`.
//! The position is still derived by replaying the moves (see [`game::replay`]):
//! threefold and fivefold repetition need every position the game has been
//! through, and a replay of at most 600 plies is cheap.
//!
//! v1 stored only per-author, write-once claims and re-derived every result on
//! read, because a peer's node folded deltas into storage without running this
//! code. Under one log every write IS this code: `play` checks the move and
//! stores it in the same run, an ending is written by the method that checked
//! it, and nothing a member writes can sit in storage unvalidated. So the
//! "reader elects" machinery (nonce keys, owner stamps, equivocation, chair
//! locks by mutual naming) is gone, and its guarantees are method checks:
//!
//! * a move is written only by the player to move, only if legal;
//! * a chair someone else holds is theirs, and a chair someone has played
//!   from is theirs for good (`stand` is refused, `resign` is the way out);
//! * endings are written only by a seated player, only when they hold
//!   (an agreement needs the opponent's standing offer, a claimed draw must be
//!   available in the position);
//! * the title and creation date are written by `init` and nothing else.
//!
//! ## Access
//!
//! The app's organization decides who reaches the table (members, admins, the
//! owner and guests, as every member of a v1 context could). Anyone who reaches
//! it may take a free chair; everyone else watches.

use calimero_sdk::prelude::*;
use serde::{Deserialize, Serialize};

pub mod board;
pub mod game;
pub mod movegen;
pub mod notation;

#[cfg(test)]
mod perft;

use board::{Color, Position};
use movegen::{in_check, ClaimableDraw, Outcome};

/// Hard ceiling on one game's move list.
///
/// 600 plies is 300 moves a side, about twice the longest tournament game ever
/// recorded. It is not a rule of chess; it bounds what one game stores, and
/// every read replays the whole list.
const MAX_PLY: u32 = 600;

/// How many games one table counts before it stops.
const MAX_GAMES: u32 = 1024;

/// Display names are shown to the other player, so they are bounded and
/// stripped of control characters at the door.
const MAX_NAME_LEN: usize = 32;

/// How long after a heartbeat a player still reads as present, in milliseconds.
pub const PRESENCE_TTL_MS: u64 = 30_000;

/// How many players `table` lists (one page of the roster).
const MAX_LISTED_PLAYERS: u32 = 1_000;

/// The most rows `Game::offers` holds: two seated accounts, each with at most
/// one offer and one refusal in the current position.
const MAX_OFFER_ROWS: usize = 4;

/// The two seats, named after the colour they hold in the FIRST game.
///
/// Colours swap every rematch, so the seat name is an identity, not a claim
/// about the current game.
const SEAT_WHITE: &str = "white";
const SEAT_BLACK: &str = "black";
const SEATS: [&str; 2] = [SEAT_WHITE, SEAT_BLACK];

// ── Stored records ───────────────────────────────────────────────────────────

/// The table itself: what `init` was given. Nothing else writes it.
#[derive(Serialize, Deserialize, Clone, Debug)]
struct TableInfo {
    title: String,
    created_at: u64,
}

/// A person's presence row, in their own [`PerUser`] slot.
#[derive(Serialize, Deserialize, Clone, Debug)]
struct Player {
    name: String,
    joined_at: u64,
    updated_at: u64,
}

/// Who holds a chair.
#[derive(Serialize, Deserialize, Clone, Debug)]
struct Chair {
    member: String,
    name: String,
    claimed_at: u64,
}

/// A draw offer, or a refusal of the opponent's, made at `ply`.
///
/// An offer is good only for the position it was made in, as at a board: a
/// move after it voids it, which is why only rows at the current ply are kept.
#[derive(Serialize, Deserialize, Clone, Debug)]
struct DrawOffer {
    by: String,
    ply: u32,
    declined: bool,
}

/// One game, as it stands.
#[derive(Serialize, Deserialize, Clone, Debug)]
struct Game {
    started_at: u64,
    /// Moves played, i.e. the next ply.
    plies: u32,
    /// `1-0`, `0-1`, `1/2-1/2`, or `*` while it is being played.
    result: String,
    reason: String,
    /// Who had White and Black, written when the game ended.
    white: String,
    black: String,
    /// Offers and refusals at the current ply. Bounded at [`MAX_OFFER_ROWS`]:
    /// only the two seated accounts may write one (`offerDraw`/`declineDraw`
    /// check the caller is seated), `write_offer` keeps one row per account
    /// and kind and drops every row from an earlier ply, and a move or an
    /// ending clears the list. Not a growing list, so it stays in the record.
    offers: Vec<DrawOffer>,
}

impl Game {
    fn new(started_at: u64) -> Self {
        Self {
            started_at,
            plies: 0,
            result: "*".to_owned(),
            reason: String::new(),
            white: String::new(),
            black: String::new(),
            offers: Vec::new(),
        }
    }

    fn unfinished(&self) -> bool {
        self.result == "*"
    }
}

/// One played move, at `(game, ply)` in [`MeroChess::moves`].
#[derive(Serialize, Deserialize, Clone, Debug)]
struct MoveRecord {
    uci: String,
    san: String,
    by: String,
    /// Its author's clock. Display only.
    at: u64,
}

// ── Views ────────────────────────────────────────────────────────────────────
//
// Strings and sentinels rather than `Option`s, as in v1, so a client never has
// to tell `null` from `""`. Field names are camelCase on the wire and `u64`s
// decimal strings (D20), like every component app's.

/// One chair.
#[derive(Serialize, Deserialize, Clone, Debug, AbiType)]
#[serde(rename_all = "camelCase")]
pub struct SeatView {
    /// `white` or `black`: which chair this is, i.e. its colour in game 0.
    pub seat: String,
    /// The account holding it, or `""` when the chair is free.
    pub member: String,
    pub name: String,
    pub online: bool,
}

/// One move of the current game.
#[derive(Serialize, Deserialize, Clone, Debug, AbiType)]
#[serde(rename_all = "camelCase")]
pub struct MoveView {
    pub ply: u32,
    pub uci: String,
    pub san: String,
    pub by: String,
    #[serde(with = "calimero_sdk::json::u64_str")]
    pub at: u64,
}

/// One person at the table.
#[derive(Serialize, Deserialize, Clone, Debug, AbiType)]
#[serde(rename_all = "camelCase")]
pub struct PlayerView {
    pub id: String,
    pub name: String,
    pub online: bool,
    /// `white`, `black` or `""`: this player's colour in the CURRENT game.
    pub color: String,
}

/// One game of the table's record.
#[derive(Serialize, Deserialize, Clone, Debug, AbiType)]
#[serde(rename_all = "camelCase")]
pub struct GameSummary {
    pub index: u32,
    #[serde(with = "calimero_sdk::json::u64_str")]
    pub started_at: u64,
    /// `1-0`, `0-1`, `1/2-1/2`, or `*` while it is still being played.
    pub result: String,
    pub reason: String,
    pub plies: u32,
    /// The account that had White in that game.
    pub white: String,
    pub black: String,
}

/// Everything a client needs to draw the table, in one call.
///
/// ONE view rather than a dozen getters: every field comes from the same
/// replay, so a client never paints a board from one moment next to a status
/// from another.
#[derive(Serialize, Deserialize, Clone, Debug, AbiType)]
#[serde(rename_all = "camelCase")]
pub struct TableView {
    pub title: String,
    #[serde(with = "calimero_sdk::json::u64_str")]
    pub created_at: u64,
    /// Index of the game being played now.
    pub game: u32,
    /// The position after every move played, as a FEN.
    pub fen: String,
    /// `white` or `black`.
    pub side_to_move: String,
    pub moves: Vec<MoveView>,
    /// Every legal move in this position, in UCI, sorted; empty once the game
    /// is over. The client highlights squares from this list rather than
    /// shipping a second engine that could disagree with it.
    pub legal_moves: Vec<String>,
    /// `awaitingPlayers`, `inProgress` or `finished`.
    pub status: String,
    /// `1-0`, `0-1`, `1/2-1/2`, or `*` while the game is unfinished.
    pub result: String,
    /// `checkmate`, `stalemate`, `insufficientMaterial`, `fivefold`,
    /// `seventyFiveMove`, `resignation`, `agreement`, `threefold`,
    /// `fiftyMove`, or `""`.
    pub reason: String,
    pub check: bool,
    /// `threefold`, `fiftyMove` or `""`: a draw the side to move may claim.
    pub claimable_draw: String,
    /// The chair holding White in the current game.
    pub white: SeatView,
    /// The chair holding Black in the current game.
    pub black: SeatView,
    /// The caller, as the contract sees it (their account id).
    pub me: String,
    /// The caller's colour in this game, or `""` for a spectator.
    pub my_color: String,
    pub my_turn: bool,
    /// The account whose draw offer stands in this position, or `""`.
    pub draw_offer_from: String,
    /// Everyone who has announced themselves here, in the order they first
    /// did (at most 1,000).
    pub players: Vec<PlayerView>,
    /// How many games this table has started, including the current one.
    pub games_played: u32,
}

// ── Derived state ────────────────────────────────────────────────────────────

/// The current game, played out.
struct Current {
    index: u32,
    game: Game,
    moves: Vec<MoveRecord>,
    replay: game::Replay,
    /// The accounts holding White and Black in this game (`""` when free).
    white: String,
    black: String,
}

impl Current {
    fn member_for(&self, color: Color) -> &str {
        match color {
            Color::White => &self.white,
            Color::Black => &self.black,
        }
    }

    fn side(&self) -> Color {
        self.replay.position.side_to_move
    }

    /// The caller's colour in this game, or `None` for a spectator.
    ///
    /// A player sitting in BOTH chairs is whichever side is to move: every
    /// caller of this asks "may this person act, and as whom", and for a
    /// pass-and-play board the answer is "as the side to move".
    fn color_of(&self, member: &str) -> Option<Color> {
        let side = self.side();
        [side, side.other()]
            .into_iter()
            .find(|&color| !member.is_empty() && self.member_for(color) == member)
    }

    fn offered(&self, member: &str) -> bool {
        let ply = self.game.plies;
        self.game
            .offers
            .iter()
            .any(|o| !o.declined && o.ply == ply && o.by == member)
    }

    fn declined(&self, member: &str) -> bool {
        let ply = self.game.plies;
        self.game
            .offers
            .iter()
            .any(|o| o.declined && o.ply == ply && o.by == member)
    }

    /// The seat holder whose offer stands in the current position, or `""`.
    fn standing_offer(&self) -> String {
        if !self.game.unfinished() {
            return String::new();
        }
        for color in [Color::White, Color::Black] {
            let from = self.member_for(color);
            let to = self.member_for(color.other());
            if !from.is_empty() && self.offered(from) && !self.declined(to) {
                return from.to_owned();
            }
        }
        String::new()
    }
}

// ── State ────────────────────────────────────────────────────────────────────

/// The table.
#[app::state(version = 1)]
pub struct MeroChess {
    /// Title and creation time, written by `init` only.
    table: Cell<TableInfo>,
    /// Each person's name and last sign of life.
    players: PerUser<Player>,
    /// Accounts in the order they first announced themselves: who `table`
    /// lists (a [`PerUser`] cannot be listed).
    roster: Vector<String>,
    /// `"white"` / `"black"` -> who holds that chair.
    chairs: UnorderedMap<String, Chair>,
    /// Every game, by index. Game 0 is written by `init`.
    games: Vector<Game>,
    /// `(game, ply)` -> the move played there.
    moves: UnorderedMap<(u32, u32), MoveRecord>,
    /// Accounts that have acted here (moved, resigned, offered, answered or
    /// claimed a draw, started a rematch): a chair someone has played from is
    /// the record of who played, so it cannot be given up.
    acted: Set<String>,
}

#[app::logic]
impl MeroChess {
    /// A new table with game 0 waiting for two players. `title` defaults to
    /// `"Chess"`; `now` (the creator's clock) is `createdAt`, `"0"` when not
    /// given.
    #[app::init]
    pub fn init(title: Option<String>, now: Option<u64>) -> app::Result<Self> {
        let mut state = Self::load();
        let created_at = now.unwrap_or(0);
        state.table.set(&TableInfo {
            title: clean_name(title.as_deref().unwrap_or(""), "Chess"),
            created_at,
        })?;
        let _index = state.games.push(&Game::new(created_at))?;
        env::emit(Event::Initialized, Audience::All)?;
        Ok(state)
    }

    // ── reading the table ───────────────────────────────────────────────────

    /// The whole table in one call, as the caller sees it at `now` (their
    /// clock, for who is `online`). See [`TableView`].
    #[app::view]
    pub fn table(&self, now: u64) -> app::Result<TableView> {
        let info = self.info()?;
        let cur = self.current()?;
        let replayed = &cur.replay;

        let white_seat = self.seat_view(seat_for_color(cur.index, Color::White), now)?;
        let black_seat = self.seat_view(seat_for_color(cur.index, Color::Black), now)?;

        let me = caller_account().unwrap_or_default();
        let my_color = cur.color_of(&me).map_or("", color_name);
        let side_to_move = color_name(cur.side());
        let unfinished = cur.game.unfinished();
        let seated = !white_seat.member.is_empty() && !black_seat.member.is_empty();

        let status = if !unfinished {
            "finished"
        } else if seated {
            "inProgress"
        } else {
            "awaitingPlayers"
        };

        let moves = cur
            .moves
            .iter()
            .enumerate()
            .map(|(ply, m)| MoveView {
                ply: ply as u32,
                uci: m.uci.clone(),
                san: m.san.clone(),
                by: m.by.clone(),
                at: m.at,
            })
            .collect();

        Ok(TableView {
            title: info.title,
            created_at: info.created_at,
            game: cur.index,
            fen: replayed.position.to_fen(),
            side_to_move: side_to_move.to_owned(),
            moves,
            // Withheld once the game is over, so a client cannot offer a move
            // in a finished game.
            legal_moves: if unfinished {
                replayed.legal_uci()
            } else {
                Vec::new()
            },
            status: status.to_owned(),
            result: cur.game.result.clone(),
            reason: cur.game.reason.clone(),
            check: in_check(&replayed.position, replayed.position.side_to_move),
            claimable_draw: claimable_name(replayed.claimable()).to_owned(),
            my_turn: unfinished && seated && my_color == side_to_move,
            my_color: my_color.to_owned(),
            me,
            draw_offer_from: cur.standing_offer(),
            white: white_seat,
            black: black_seat,
            players: self.player_views(&cur, now)?,
            games_played: cur.index.saturating_add(1),
        })
    }

    /// Every game this table has played, oldest first (at most 1,000).
    #[app::view]
    pub fn history(&self) -> app::Result<Vec<GameSummary>> {
        let chairs = self.chairs()?;
        let page = self.games.page(FindOpts::default().limit(1_000))?;
        Ok(page
            .items
            .into_iter()
            .enumerate()
            .map(|(index, g)| {
                let index = index as u32;
                // A finished game names who played it; the one being played
                // names who holds the chairs now.
                let (white, black) = if g.unfinished() {
                    (
                        holder_of(&chairs, seat_for_color(index, Color::White)),
                        holder_of(&chairs, seat_for_color(index, Color::Black)),
                    )
                } else {
                    (g.white.clone(), g.black.clone())
                };
                GameSummary {
                    index,
                    started_at: g.started_at,
                    result: g.result,
                    reason: g.reason,
                    plies: g.plies,
                    white,
                    black,
                }
            })
            .collect())
    }

    // ── sitting down ────────────────────────────────────────────────────────

    /// Announce yourself at the table, or refresh your presence and name.
    /// Emits `PlayerJoined` the first time.
    pub fn join(&mut self, name: String, now: u64) -> app::Result<()> {
        let me = caller_account()?;
        let known = self.players.get_for(&me)?.is_some();
        self.announce(&me, Some(clean_name(&name, "Guest")), now)?;
        if !known {
            env::emit(Event::PlayerJoined { member: me }, Audience::All)?;
        }
        Ok(())
    }

    /// Presence only: no event, so a heartbeat does not wake every client.
    pub fn heartbeat(&mut self, now: u64) -> app::Result<()> {
        let me = caller_account()?;
        self.touch(&me, now)
    }

    /// Take the `white` or `black` chair, if it is free. Sitting in your own
    /// chair again does nothing.
    ///
    /// The seat name is the colour you hold in the FIRST game; colours swap
    /// on every rematch. Taking BOTH chairs is allowed on purpose: one person
    /// moving for each side in turn is how chess is played when the other
    /// person is in the room. `UnknownSeat`, `SeatTaken`.
    pub fn sit(&mut self, seat: String, name: String, now: u64) -> app::Result<()> {
        let seat = normalize_seat(&seat)?;
        let me = caller_account()?;
        let display = clean_name(&name, "Guest");

        if let Some(holder) = self.chairs.get(&seat.to_owned())? {
            if holder.member == me {
                return Ok(()); // already yours: idempotent, not an error
            }
            return Err(Error::SeatTaken.into());
        }

        self.announce(&me, Some(display.clone()), now)?;
        let _previous = self.chairs.insert(
            &seat.to_owned(),
            &Chair {
                member: me.clone(),
                name: display,
                claimed_at: now,
            },
        )?;
        env::emit(
            Event::Seated {
                seat: seat.to_owned(),
                member: me,
            },
            Audience::All,
        )?;
        Ok(())
    }

    /// Give up your chair: only before you have played at this table, and
    /// only before the current game has a move. A chair you have played from
    /// is the table's record of who played; the way out of a game is
    /// `resign`. `NotSeated`, `AlreadyPlayed`.
    pub fn stand(&mut self, now: u64) -> app::Result<()> {
        let me = caller_account()?;
        let chairs = self.chairs()?;
        let Some(slot) = chairs
            .iter()
            .position(|c| c.as_ref().is_some_and(|c| c.member == me))
        else {
            return Err(Error::NotSeated.into());
        };
        let cur = self.current()?;
        if !cur.moves.is_empty() || self.acted.contains(&me)? {
            return Err(Error::AlreadyPlayed.into());
        }
        let seat = SEATS[slot];
        let _removed = self.chairs.remove(&seat.to_owned())?;
        self.touch(&me, now)?;
        env::emit(
            Event::Vacated {
                seat: seat.to_owned(),
                member: me,
            },
            Audience::All,
        )?;
        Ok(())
    }

    // ── playing ─────────────────────────────────────────────────────────────

    /// Play a move, in UCI (`e2e4`, `e7e8q`; a promotion with no piece named
    /// is a queening). Returns its SAN. Emits `Moved`, then `GameEnded` when
    /// the move ended the game on the board.
    ///
    /// `GameOver`, `MoveLimit`, `WaitingForOpponent` (a chair is empty),
    /// `NotYourMove`, `BadMove` (not UCI), `IllegalMove`.
    pub fn play(&mut self, uci: String, now: u64) -> app::Result<String> {
        let me = caller_account()?;
        let cur = self.current()?;
        if !cur.game.unfinished() {
            return Err(Error::GameOver.into());
        }
        let ply = cur.game.plies;
        if ply >= MAX_PLY {
            return Err(Error::MoveLimit.into());
        }
        // BOTH chairs, not just the one to move: a game with an empty chair
        // has no opponent to answer.
        let side = cur.side();
        if cur.white.is_empty() || cur.black.is_empty() {
            return Err(Error::WaitingForOpponent.into());
        }
        if cur.member_for(side) != me {
            return Err(Error::NotYourMove.into());
        }
        let Some(mv) = notation::parse_uci(&uci) else {
            return Err(Error::BadMove { uci }.into());
        };
        let position = &cur.replay.position;
        let Some(chosen) = find_legal(position, mv) else {
            return Err(Error::IllegalMove { uci }.into());
        };

        let san = notation::san(position, chosen);
        let after = position.apply(chosen);
        let mut keys = cur.replay.keys.clone();
        keys.push(after.repetition_key());

        let _previous = self.moves.insert(
            &(cur.index, ply),
            &MoveRecord {
                uci: notation::move_to_uci(chosen),
                san: san.clone(),
                by: me.clone(),
                at: now,
            },
        )?;
        let mut game = cur.game.clone();
        game.plies = ply + 1;
        // A move voids every offer made in the position before it.
        game.offers.clear();
        let ended = movegen::outcome(&after, &keys).map(describe_outcome);
        if let Some((result, reason)) = &ended {
            game.result = result.clone();
            game.reason = reason.clone();
            game.white = cur.white.clone();
            game.black = cur.black.clone();
        }
        let _old = self.games.set(u64::from(cur.index), &game)?;
        let _new = self.acted.insert(&me)?;
        self.touch(&me, now)?;

        env::emit(
            Event::Moved {
                game: cur.index,
                ply,
                san: san.clone(),
                by: me,
            },
            Audience::All,
        )?;
        // Announcing the ending here is what lets a client show "checkmate"
        // without replaying anything itself.
        if let Some((result, reason)) = ended {
            env::emit(
                Event::GameEnded {
                    game: cur.index,
                    result,
                    reason,
                },
                Audience::All,
            )?;
        }
        Ok(san)
    }

    /// Resign the current game. `GameOver`, `NotSeated`.
    pub fn resign(&mut self, now: u64) -> app::Result<()> {
        let me = caller_account()?;
        let cur = self.current()?;
        if !cur.game.unfinished() {
            return Err(Error::GameOver.into());
        }
        let Some(color) = cur.color_of(&me) else {
            return Err(Error::NotSeated.into());
        };
        self.end_game(&cur, &win_for(color.other()), "resignation", &me, now)
    }

    /// Offer a draw in the current position. The offer stands until the
    /// position changes. `GameOver`, `NotSeated`.
    pub fn offer_draw(&mut self, now: u64) -> app::Result<()> {
        let me = caller_account()?;
        let cur = self.current()?;
        if !cur.game.unfinished() {
            return Err(Error::GameOver.into());
        }
        if cur.color_of(&me).is_none() {
            return Err(Error::NotSeated.into());
        }
        self.write_offer(&cur, &me, false, now)?;
        env::emit(
            Event::DrawOffered {
                game: cur.index,
                by: me,
            },
            Audience::All,
        )?;
        Ok(())
    }

    /// Accept the opponent's standing offer. `GameOver`, `NotSeated`,
    /// `NoDrawOffer`.
    pub fn accept_draw(&mut self, now: u64) -> app::Result<()> {
        let me = caller_account()?;
        let cur = self.current()?;
        if !cur.game.unfinished() {
            return Err(Error::GameOver.into());
        }
        let Some(color) = cur.color_of(&me) else {
            return Err(Error::NotSeated.into());
        };
        let offered = cur.standing_offer();
        if offered.is_empty() || offered != cur.member_for(color.other()) {
            return Err(Error::NoDrawOffer.into());
        }
        self.end_game(&cur, "1/2-1/2", "agreement", &me, now)
    }

    /// Refuse the opponent's standing offer (a move refuses it too).
    /// `NotSeated`, `NoDrawOffer`.
    pub fn decline_draw(&mut self, now: u64) -> app::Result<()> {
        let me = caller_account()?;
        let cur = self.current()?;
        let Some(color) = cur.color_of(&me) else {
            return Err(Error::NotSeated.into());
        };
        let opponent = cur.member_for(color.other());
        if opponent.is_empty() || cur.standing_offer() != opponent {
            return Err(Error::NoDrawOffer.into());
        }
        self.write_offer(&cur, &me, true, now)?;
        env::emit(
            Event::DrawDeclined {
                game: cur.index,
                by: me,
            },
            Audience::All,
        )?;
        Ok(())
    }

    /// Claim the draw the position allows: threefold repetition or the
    /// fifty-move rule. Both are claims under the rules of chess, so neither
    /// ends a game on its own. `GameOver`, `NotSeated`, `NoDrawToClaim`.
    pub fn claim_draw(&mut self, now: u64) -> app::Result<()> {
        let me = caller_account()?;
        let cur = self.current()?;
        if !cur.game.unfinished() {
            return Err(Error::GameOver.into());
        }
        if cur.color_of(&me).is_none() {
            return Err(Error::NotSeated.into());
        }
        let reason = match cur.replay.claimable() {
            Some(ClaimableDraw::ThreefoldRepetition) => "threefold",
            Some(ClaimableDraw::FiftyMove) => "fiftyMove",
            None => return Err(Error::NoDrawToClaim.into()),
        };
        self.end_game(&cur, "1/2-1/2", reason, &me, now)
    }

    /// Start the next game, colours swapped. Returns its index.
    /// `GameNotFinished`, `NotSeated`, `GameLimit`.
    pub fn rematch(&mut self, now: u64) -> app::Result<u32> {
        let me = caller_account()?;
        let cur = self.current()?;
        if cur.game.unfinished() {
            return Err(Error::GameNotFinished.into());
        }
        if cur.color_of(&me).is_none() {
            return Err(Error::NotSeated.into());
        }
        let next = cur.index.saturating_add(1);
        if next >= MAX_GAMES {
            return Err(Error::GameLimit.into());
        }
        let _index = self.games.push(&Game::new(now))?;
        let _new = self.acted.insert(&me)?;
        self.touch(&me, now)?;
        env::emit(Event::GameStarted { game: next }, Audience::All)?;
        Ok(next)
    }

    // ── internals ───────────────────────────────────────────────────────────

    fn info(&self) -> app::Result<TableInfo> {
        Ok(self.table.get()?.unwrap_or_else(|| TableInfo {
            title: "Chess".to_owned(),
            created_at: 0,
        }))
    }

    /// Who holds each chair: `[white chair, black chair]`.
    fn chairs(&self) -> app::Result<[Option<Chair>; 2]> {
        Ok([
            self.chairs.get(&SEAT_WHITE.to_owned())?,
            self.chairs.get(&SEAT_BLACK.to_owned())?,
        ])
    }

    /// The game being played (the last one), its moves and its position.
    fn current(&self) -> app::Result<Current> {
        let len = self.games.len()?;
        let index = len.saturating_sub(1);
        let game = self.games.get(index)?.unwrap_or_else(|| Game::new(0));
        let index = u32::try_from(index).unwrap_or(u32::MAX);
        let page = self.moves.prefix(
            &[index.to_key_part()],
            FindOpts::default().limit(MAX_PLY + 1),
        )?;
        let moves: Vec<MoveRecord> = page.items.into_iter().map(|(_, m)| m).collect();
        let ucis: Vec<&str> = moves.iter().map(|m| m.uci.as_str()).collect();
        let replay = game::replay(&ucis);
        let chairs = self.chairs()?;
        Ok(Current {
            white: holder_of(&chairs, seat_for_color(index, Color::White)),
            black: holder_of(&chairs, seat_for_color(index, Color::Black)),
            index,
            game,
            moves,
            replay,
        })
    }

    fn end_game(
        &mut self,
        cur: &Current,
        result: &str,
        reason: &str,
        by: &str,
        now: u64,
    ) -> app::Result<()> {
        let mut game = cur.game.clone();
        game.result = result.to_owned();
        game.reason = reason.to_owned();
        game.white = cur.white.clone();
        game.black = cur.black.clone();
        game.offers.clear();
        let _old = self.games.set(u64::from(cur.index), &game)?;
        let _new = self.acted.insert(&by.to_owned())?;
        self.touch(by, now)?;
        env::emit(
            Event::GameEnded {
                game: cur.index,
                result: result.to_owned(),
                reason: reason.to_owned(),
            },
            Audience::All,
        )?;
        Ok(())
    }

    fn write_offer(
        &mut self,
        cur: &Current,
        by: &str,
        declined: bool,
        now: u64,
    ) -> app::Result<()> {
        let mut game = cur.game.clone();
        let ply = game.plies;
        // Only this position's rows matter; one per player and kind. This is
        // what keeps `Game::offers` within `MAX_OFFER_ROWS`.
        game.offers
            .retain(|o| o.ply == ply && !(o.by == by && o.declined == declined));
        game.offers.push(DrawOffer {
            by: by.to_owned(),
            ply,
            declined,
        });
        debug_assert!(game.offers.len() <= MAX_OFFER_ROWS);
        let _old = self.games.set(u64::from(cur.index), &game)?;
        let _new = self.acted.insert(&by.to_owned())?;
        self.touch(by, now)
    }

    fn seat_view(&self, seat: &str, now: u64) -> app::Result<SeatView> {
        let chair = self.chairs.get(&seat.to_owned())?;
        let online = match &chair {
            Some(c) => self.is_online(&c.member, now)?,
            None => false,
        };
        Ok(SeatView {
            seat: seat.to_owned(),
            member: chair.as_ref().map(|c| c.member.clone()).unwrap_or_default(),
            name: chair.map(|c| c.name).unwrap_or_default(),
            online,
        })
    }

    fn is_online(&self, member: &str, now: u64) -> app::Result<bool> {
        Ok(self
            .players
            .get_for(member)?
            .is_some_and(|p| now.saturating_sub(p.updated_at) <= PRESENCE_TTL_MS))
    }

    fn player_views(&self, cur: &Current, now: u64) -> app::Result<Vec<PlayerView>> {
        let roster = self
            .roster
            .page(FindOpts::default().limit(MAX_LISTED_PLAYERS))?;
        let mut out = Vec::with_capacity(roster.items.len());
        for id in roster.items {
            let Some(player) = self.players.get_for(&id)? else {
                continue;
            };
            out.push(PlayerView {
                online: now.saturating_sub(player.updated_at) <= PRESENCE_TTL_MS,
                color: cur.color_of(&id).map_or("", color_name).to_owned(),
                name: player.name,
                id,
            });
        }
        Ok(out)
    }

    /// Refresh `member`'s last sign of life, if they have announced themselves.
    fn touch(&mut self, member: &str, now: u64) -> app::Result<()> {
        if self.players.get_for(member)?.is_none() {
            return Ok(());
        }
        self.announce(member, None, now)
    }

    /// Write the caller's presence row. `name` of `None` keeps the current one.
    fn announce(&mut self, me: &str, name: Option<String>, now: u64) -> app::Result<()> {
        let existing = self.players.get()?;
        if existing.is_none() {
            let _position = self.roster.push(&me.to_owned())?;
        }
        let _account = self.players.set(&Player {
            name: name
                .or_else(|| existing.as_ref().map(|p| p.name.clone()))
                .unwrap_or_else(|| "Guest".to_owned()),
            joined_at: existing.map_or(now, |p| p.joined_at),
            updated_at: now,
        })?;
        Ok(())
    }
}

/// A typed refusal: `422 APP_ERROR` with `{ code, fields }` on the wire. Each
/// replaces one of v1's `app::bail!` messages (listed in the README).
#[app::error]
pub enum Error {
    /// A seat is either `white` or `black`.
    UnknownSeat { seat: String },
    /// Someone else holds that chair.
    SeatTaken,
    /// Only a seated player may do this.
    NotSeated,
    /// The caller has played at this table (or the game has begun), so their
    /// chair is theirs for good: resign instead.
    AlreadyPlayed,
    /// The current game is over.
    GameOver,
    /// The current game has reached 600 plies.
    MoveLimit,
    /// Both chairs must be taken before a move can be played.
    WaitingForOpponent,
    /// It is the other side's move.
    NotYourMove,
    /// Not a move in UCI notation.
    BadMove { uci: String },
    /// Not legal in this position.
    IllegalMove { uci: String },
    /// There is no standing draw offer from the opponent.
    NoDrawOffer,
    /// The position allows no draw claim.
    NoDrawToClaim,
    /// The current game is still being played.
    GameNotFinished,
    /// The table has played the most games it counts.
    GameLimit,
}

/// A nudge, not the truth: every event means "read `table` again".
#[app::event]
pub enum Event {
    /// The table was created.
    Initialized,
    /// `member` announced themselves for the first time.
    PlayerJoined { member: String },
    /// `member` took chair `seat`.
    Seated { seat: String, member: String },
    /// `member` left chair `seat`.
    Vacated { seat: String, member: String },
    /// `by` played `san` at `ply` of game `game`.
    Moved {
        game: u32,
        ply: u32,
        san: String,
        by: String,
    },
    /// Game `game` ended.
    GameEnded {
        game: u32,
        result: String,
        reason: String,
    },
    /// `by` offered a draw in game `game`.
    DrawOffered { game: u32, by: String },
    /// `by` declined the standing offer in game `game`.
    DrawDeclined { game: u32, by: String },
    /// Game `game` began.
    GameStarted { game: u32 },
}

// ── free helpers ─────────────────────────────────────────────────────────────

/// The account the caller acts for; `LoginRequired` for anyone else (which the
/// node's own access check answers first for an org app).
fn caller_account() -> app::Result<String> {
    match env::caller() {
        Caller::Account(account) | Caller::ApiKey { account, .. } => Ok(account),
        Caller::Public | Caller::System | Caller::App(_) => Err(AppError::login_required()),
    }
}

/// Which SEAT holds `color` in game `index`: the `white` chair has White in
/// the even-numbered games and Black in the odd ones.
fn seat_for_color(index: u32, color: Color) -> &'static str {
    let swapped = index % 2 == 1;
    match (color, swapped) {
        (Color::White, false) | (Color::Black, true) => SEAT_WHITE,
        (Color::Black, false) | (Color::White, true) => SEAT_BLACK,
    }
}

fn holder_of(chairs: &[Option<Chair>; 2], seat: &str) -> String {
    chairs[usize::from(seat == SEAT_BLACK)]
        .as_ref()
        .map(|c| c.member.clone())
        .unwrap_or_default()
}

/// The legal move in `position` that `mv` names, with the promotion piece
/// filled in the same way for every caller: a promotion with no piece named is
/// a queening, which is what a board does when you drag a pawn onto the last
/// rank.
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
        _ => Err(Error::UnknownSeat {
            seat: seat.to_owned(),
        }
        .into()),
    }
}

const fn color_name(color: Color) -> &'static str {
    match color {
        Color::White => "white",
        Color::Black => "black",
    }
}

const fn claimable_name(draw: Option<ClaimableDraw>) -> &'static str {
    match draw {
        Some(ClaimableDraw::ThreefoldRepetition) => "threefold",
        Some(ClaimableDraw::FiftyMove) => "fiftyMove",
        None => "",
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

/// Trim, drop control characters, cap the length, and fall back to `fallback`
/// when nothing usable is left.
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
