//! Battleships on the component SDK: the lobby (who plays, the matches, the
//! results and the stats) and every match's game, in one app instance.
//!
//! ## From two services to one instance
//!
//! v1 was a bundle of two services: a `lobby` context per namespace, and a
//! `game` context per match that reported its result back to the lobby with
//! a cross-context call (`#[app::xcall] on_match_finished`). Here a lobby is
//! one app instance, and a match is rows in it keyed by the match id, so the
//! game decides its result and records it in the lobby's tables in the SAME
//! call (`revealBoard`). There is no cross-instance call, and no result to
//! trust from another context: v1's "was this report sent by the match's own
//! game context, and by one of its players?" checks have nothing left to
//! check. (`setMatchContextId` is gone with the game contexts; see the README.)
//!
//! ## What v1 kept in storage write rules, as method checks
//!
//! v1 ran on every member's node and leaned on storage types every node
//! enforced (`UserStorage`, `Authored`, `WriteOnce`, `Frozen`), deriving turn,
//! placement and result from write-once rows so a patched node could not set
//! them. Here one leader applies every write through these methods, so each
//! rule is a check against `env::caller()` before anything is written:
//!
//! | v1 | here |
//! |---|---|
//! | `players: UserStorage<LwwRegister<String>>` (account -> device key) | `players: Set<account>`: a player IS an account now, so there is no key to pair |
//! | `matches: Authored<UnorderedMap<id, MatchEntry>>` | `matches: UnorderedMap<id, MatchEntry>`, written only by `createMatch` and the game methods |
//! | `results: WriteOnce<IndexedMap<"{id}/{nonce}", MatchRecord>>`, stats derived per read | `results: UnorderedMap<id, MatchRecord>` written once, when the audit decides; `stats` and `history` kept beside it |
//! | `config: Frozen<GameConfig>` (per game context) | the match entry's players, fixed by `createMatch` |
//! | `commitments`/`shots`/`answers`/`reveals: WriteOnce<SortedMap<"{account}/…">>` | the entry's commitments, `turns: UnorderedMap<(id, turn), Turn>`, `reveals: UnorderedMap<(id, account), Reveal>`, each written once by its player's own call |
//!
//! ## Hidden information (unchanged)
//!
//! The contract never holds a board. Each player's board and salt stay on the
//! player's device; the contract stores only `SHA256(borsh(board) || salt)`,
//! which the client files with `commitBoard`. The defender's client answers
//! every shot from that local board (`acknowledgeShot`), and at match end
//! both players publish `(board, salt)` with `revealBoard`. Every reader
//! checks the reveal against the commitment, checks it is a legal fleet, and
//! replays every answer its owner gave against it. The declared winner must
//! pass that audit to win; a winner who lied loses to the player they lied
//! to; a defender who answers "miss" forever runs out of misses (a fleet is
//! 17 cells, so an 84th miss on a 100-cell board is a lie on its face).
//!
//! What remains open, as before: a player who never answers, or never
//! reveals, stalls the match.

use battleships_rules::audit::{self, AuditFailure, FLEET_CELLS};
use battleships_rules::board::{Cell, BOARD_SIZE};
use calimero_sdk::prelude::*;
use calimero_sdk::OrgRole;
use serde::de::DeserializeOwned;
use serde::{Deserialize, Serialize};

/// Every cell of the opponent's board, once each: the most shots one player
/// can fire, so twice that bounds a match.
const MAX_TURNS: u32 = 2 * (BOARD_SIZE as u32) * (BOARD_SIZE as u32);

/// The most misses a defender can truthfully report: every cell that is not
/// part of the fleet.
const MAX_MISSES: u32 = (BOARD_SIZE as u32) * (BOARD_SIZE as u32) - FLEET_CELLS;

/// The most rows one paged read asks for.
const PAGE: u32 = 1_000;

/// A salt is 16 bytes, as v1's `[u8; 16]`.
const SALT_LEN: usize = 16;

// ── stored records ──────────────────────────────────────────────────────────

/// A match, as `createMatch` recorded it. `player1` is its creator.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub struct MatchEntry {
    pub player1: String,
    pub player2: String,
    #[serde(with = "calimero_sdk::json::u64_auto")]
    pub created_ms: u64,
    /// Each player's board commitment (64 hex), once they file it; at most
    /// two, one per seat.
    pub commitment1: Option<String>,
    pub commitment2: Option<String>,
}

/// One turn: a shot, and its answer once the defender gives one.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub struct Turn {
    /// The shooter's seat: 0 for player 1, 1 for player 2.
    pub shooter: u8,
    pub x: u8,
    pub y: u8,
    pub hit: Option<bool>,
}

/// A board opened at match end.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub struct Reveal {
    pub board_bytes: Vec<u8>,
    pub salt: Vec<u8>,
}

/// A player's wins and losses, kept as results are recorded.
#[derive(Debug, Clone, Default, PartialEq, Eq, Serialize, Deserialize)]
pub struct Stats {
    #[serde(with = "calimero_sdk::json::u64_auto")]
    pub wins: u64,
    #[serde(with = "calimero_sdk::json::u64_auto")]
    pub losses: u64,
}

// ── results ─────────────────────────────────────────────────────────────────

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize, AbiType)]
pub enum MatchStatus {
    /// Created; a board is not committed yet.
    Pending,
    /// Both boards committed: being played, or waiting for a reveal.
    Active,
    /// The audited result is recorded.
    Finished,
}

/// A match as a client sees it. `status` and `winner` are derived.
#[derive(Debug, Clone, Serialize, AbiType)]
pub struct MatchSummary {
    pub match_id: String,
    pub player1: String,
    pub player2: String,
    /// The account player 2 plays as: `player2` itself now (v1 kept a device
    /// key and an account apart).
    pub player2_account: String,
    pub status: MatchStatus,
    pub winner: Option<String>,
    #[serde(with = "calimero_sdk::json::u64_auto")]
    pub created_ms: u64,
}

#[derive(Debug, Clone, Serialize, AbiType)]
pub struct PlayerStatsView {
    #[serde(with = "calimero_sdk::json::u64_auto")]
    pub wins: u64,
    #[serde(with = "calimero_sdk::json::u64_auto")]
    pub losses: u64,
    #[serde(with = "calimero_sdk::json::u64_auto")]
    pub games_played: u64,
}

/// A recorded result.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize, AbiType)]
pub struct MatchRecord {
    pub match_id: String,
    pub winner: String,
    pub loser: String,
    #[serde(with = "calimero_sdk::json::u64_auto")]
    pub finished_ms: u64,
}

/// One registered player. `account` and `player` are the same id now.
#[derive(Debug, Clone, Serialize, AbiType)]
pub struct PlayerEntry {
    pub account: String,
    pub player: String,
}

/// A grid of the caller's shots (`getShots`) or of the shots fired at the
/// caller (`getIncomingShots`): one cell byte per square, row-major
/// (0 empty, 2 hit, 3 miss, 4 pending).
#[derive(Debug, Clone, Serialize)]
pub struct ShotsView {
    pub size: u8,
    pub shots: Vec<u8>,
}

/// The shot waiting for its defender's answer.
#[derive(Debug, Clone, Serialize, AbiType)]
pub struct PendingShotView {
    /// What `acknowledgeShot` takes: this shot's turn index, so an answer
    /// meant for an earlier shot is refused instead of misfiled.
    pub shot_id: u32,
    pub x: u8,
    pub y: u8,
    /// The player who has to answer.
    pub target: String,
}

/// The match as every reader derives it, in one read.
#[derive(Debug, Clone, Serialize, AbiType)]
pub struct MatchStateView {
    /// `playing`, `awaiting_reveal`, `won` or `void`.
    pub standing: String,
    /// Players whose commitment is on record.
    pub committed: Vec<String>,
    pub pending_shot: Option<PendingShotView>,
    /// Why the answers ended it: `sunk` or `impossible_misses`. `None` while
    /// playing.
    pub ended_by: Option<String>,
    /// The player the answers say lost.
    pub loser: Option<String>,
    /// Players whose revealed board matched their commitment.
    pub revealed: Vec<String>,
    /// Players whose revealed board failed the audit.
    pub audit_failed: Vec<String>,
    /// The audited winner. Set only when `standing` is `won`.
    pub winner: Option<String>,
}

// ── derived state ───────────────────────────────────────────────────────────

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
enum Standing {
    Playing,
    /// Over on the answers, waiting for the declared winner's board.
    AwaitingReveal,
    Won {
        winner: usize,
    },
    /// Both players' audits failed: nobody wins a game both cheated in.
    Void,
}

/// The match as the rows say it stands: the only source of turn, pending
/// shot, placement and result.
struct Derived {
    players: [String; 2],
    commitment: [Option<[u8; 32]>; 2],
    turns: Vec<Turn>,
    /// Whose turn it is to shoot next (or, with a shot pending, whose shot).
    shooter: usize,
    /// The seat the answers say lost, and why.
    ended: Option<(usize, &'static str)>,
    /// Each player's audit, once they have revealed a board that matches
    /// their commitment.
    audit: [Option<Result<(), AuditFailure>>; 2],
    standing: Standing,
}

impl Derived {
    fn placed(&self, role: usize) -> bool {
        self.commitment[role].is_some()
    }

    fn pending(&self) -> Option<&Turn> {
        self.turns.last().filter(|turn| turn.hit.is_none())
    }

    /// Every `(x, y, hit)` answer `role` gave as the defender.
    fn answers_by(&self, role: usize) -> Vec<(u8, u8, bool)> {
        self.turns
            .iter()
            .filter(|turn| usize::from(turn.shooter) != role)
            .filter_map(|turn| turn.hit.map(|hit| (turn.x, turn.y, hit)))
            .collect()
    }

    fn already_shot(&self, shooter: usize, x: u8, y: u8) -> bool {
        self.turns
            .iter()
            .any(|turn| usize::from(turn.shooter) == shooter && turn.x == x && turn.y == y)
    }

    fn seats(&self, keep: impl Fn(usize) -> bool) -> Vec<String> {
        (0..2)
            .filter(|&role| keep(role))
            .map(|role| self.players[role].clone())
            .collect()
    }
}

// ── state ───────────────────────────────────────────────────────────────────

#[app::state(version = 1)]
pub struct Battleships {
    /// Accounts that opened the lobby: who can be challenged.
    players: Set<String>,
    /// Match id -> the match.
    matches: UnorderedMap<String, MatchEntry>,
    /// `(match, turn)`: at most `MAX_TURNS` per match.
    turns: UnorderedMap<(String, u32), Turn>,
    /// `(match, account)`: a player's board, opened once at match end.
    reveals: UnorderedMap<(String, String), Reveal>,
    /// Match id -> its audited result, written once.
    results: UnorderedMap<String, MatchRecord>,
    /// Match ids in the order their results were recorded.
    history: Vector<String>,
    /// Account -> wins and losses, kept with `results`.
    stats: UnorderedMap<String, Stats>,
}

// ── logic ───────────────────────────────────────────────────────────────────

#[app::logic]
impl Battleships {
    /// The empty lobby. The node runs it once, when the instance is created.
    #[app::init]
    pub fn init() -> app::Result<Self> {
        Ok(Self::load())
    }

    // ── lobby ──────────────────────────────────────────────────────────────

    /// Put the caller on the lobby's roster, so others can challenge them,
    /// and return the id they play as: their account. Idempotent, and cheap
    /// enough to call on every lobby open. Anyone the app reaches may,
    /// guests included. Emits `PlayersUpdated` when the caller is new.
    pub fn register_player(&mut self) -> app::Result<String> {
        let me = me()?;
        if self.players.insert(&me)? {
            env::emit(Event::PlayersUpdated {}, Audience::All)?;
        }
        Ok(me)
    }

    /// Every registered player, by account.
    #[app::view]
    pub fn get_players(&self) -> app::Result<Vec<PlayerEntry>> {
        let mut out = Vec::new();
        let mut opts = FindOpts::default().limit(PAGE);
        loop {
            let page = self.players.page(opts)?;
            out.extend(page.items.into_iter().map(|account| PlayerEntry {
                player: account.clone(),
                account,
            }));
            match page.next {
                Some(next) => opts = FindOpts::default().limit(PAGE).cursor(next),
                None => return Ok(out),
            }
        }
    }

    /// Challenge `player2` (an account that has opened the lobby, still in
    /// the app's org, and not the caller). Returns the new match id,
    /// `{creator}-{ms}-{nonce}`. Emits `MatchCreated` and `MatchListUpdated`.
    pub fn create_match(&mut self, player2: String) -> app::Result<String> {
        let me = me()?;
        let player2 = player2.trim().to_owned();
        if player2 == me {
            return Err(invalid("cannot create match against self"));
        }
        if !self.players.contains(&player2)? {
            return Err(invalid("that player has not opened the lobby yet"));
        }
        if !in_org(&player2) {
            return Err(invalid("that player is no longer in this lobby"));
        }
        let now = env::time_now();
        let id = format!("{me}-{now}-{}", hex::encode(env::random_bytes(4)));
        if self.matches.contains(&id)? {
            app::bail!(Error::MatchIdCollision);
        }
        self.matches.insert(
            &id,
            &MatchEntry {
                player1: me,
                player2,
                created_ms: now,
                commitment1: None,
                commitment2: None,
            },
        )?;
        env::emit(Event::MatchCreated { id: id.clone() }, Audience::All)?;
        env::emit(Event::MatchListUpdated {}, Audience::All)?;
        Ok(id)
    }

    /// Every match, oldest id first.
    #[app::view]
    pub fn get_matches(&self) -> app::Result<Vec<MatchSummary>> {
        let mut out = Vec::new();
        for (match_id, entry) in read_all(&self.matches, &[])? {
            let result = self.results.get(&match_id)?;
            let status = match (
                &result,
                entry.commitment1.is_some() && entry.commitment2.is_some(),
            ) {
                (Some(_), _) => MatchStatus::Finished,
                (None, true) => MatchStatus::Active,
                (None, false) => MatchStatus::Pending,
            };
            out.push(MatchSummary {
                match_id,
                player2_account: entry.player2.clone(),
                player1: entry.player1,
                player2: entry.player2,
                status,
                winner: result.map(|r| r.winner),
                created_ms: entry.created_ms,
            });
        }
        Ok(out)
    }

    /// A player's record, or `None` before their first result.
    #[app::view]
    pub fn get_player_stats(&self, player: String) -> app::Result<Option<PlayerStatsView>> {
        Ok(self.stats.get(&player)?.map(|s| PlayerStatsView {
            wins: s.wins,
            losses: s.losses,
            games_played: s.wins.saturating_add(s.losses),
        }))
    }

    /// Every finished match, in the order the results were recorded (oldest
    /// first).
    #[app::view]
    pub fn get_history(&self) -> app::Result<Vec<MatchRecord>> {
        let mut out = Vec::new();
        let mut opts = FindOpts::default().limit(PAGE);
        loop {
            let page = self.history.page(opts)?;
            for match_id in page.items {
                if let Some(record) = self.results.get(&match_id)? {
                    out.push(record);
                }
            }
            match page.next {
                Some(next) => opts = FindOpts::default().limit(PAGE).cursor(next),
                None => return Ok(out),
            }
        }
    }

    // ── a match ────────────────────────────────────────────────────────────

    /// File the caller's board commitment: `SHA256(borsh(board) || salt)` as
    /// 64 hex characters, computed on the device that keeps the board and the
    /// salt. Whether the board behind it is a legal fleet is settled at the
    /// reveal, by every reader: a commitment to nonsense is a loss, not a
    /// refusal. Once per player. Emits `BoardCommitted` and `ShipsPlaced`.
    pub fn commit_board(&mut self, match_id: String, commitment: String) -> app::Result<()> {
        let (role, mut entry) = self.caller_role(&match_id)?;
        let derived = self.derive(&match_id, &entry)?;
        if derived.standing != Standing::Playing {
            app::bail!(Error::Finished);
        }
        if derived.placed(role) {
            app::bail!(Error::AlreadyCommitted);
        }
        let commitment = hex::encode(parse_commitment(&commitment)?);
        if role == 0 {
            entry.commitment1 = Some(commitment.clone());
        } else {
            entry.commitment2 = Some(commitment.clone());
        }
        self.matches.insert(&match_id, &entry)?;
        let audience = players_of(&entry);
        let player = derived.players[role].clone();
        env::emit(
            Event::BoardCommitted {
                id: match_id.clone(),
                player,
                commitment,
            },
            audience.clone(),
        )?;
        env::emit(Event::ShipsPlaced { id: match_id }, audience)?;
        env::emit(Event::MatchListUpdated {}, Audience::All)?;
        Ok(())
    }

    /// Fire at `(x, y)` on the opponent's board: the caller's turn, both
    /// boards committed, no shot waiting for an answer, a cell not shot
    /// before. Emits `ShotProposed`; the defender's CLIENT answers it.
    pub fn propose_shot(&mut self, match_id: String, x: u8, y: u8) -> app::Result<()> {
        let (role, entry) = self.caller_role(&match_id)?;
        if x >= BOARD_SIZE || y >= BOARD_SIZE {
            return Err(invalid("out of bounds"));
        }
        let derived = self.derive(&match_id, &entry)?;
        if derived.standing != Standing::Playing {
            app::bail!(Error::Finished);
        }
        if !derived.placed(0) || !derived.placed(1) {
            return Err(invalid("both players must place ships first"));
        }
        if derived.pending().is_some() {
            return Err(invalid("a shot is already pending"));
        }
        if derived.shooter != role {
            return Err(forbidden("not your turn"));
        }
        if derived.already_shot(role, x, y) {
            return Err(invalid(&format!("cell ({x},{y}) was already shot")));
        }
        let turn = turn_index(derived.turns.len())?;
        self.turns.insert(
            &(match_id.clone(), turn),
            &Turn {
                shooter: seat(role),
                x,
                y,
                hit: None,
            },
        )?;
        env::emit(
            Event::ShotProposed { id: match_id, x, y },
            players_of(&entry),
        )?;
        Ok(())
    }

    /// The defender's answer to the pending shot, as their client read it off
    /// the board on their device: a signed statement, written once, that the
    /// reveal is replayed against. `shotId` is the pending shot's turn index
    /// (see `getMatchState`). Returns `"hit"` or `"miss"`. Emits `ShotFired`,
    /// and `RevealRequested` when the answers end the match.
    pub fn acknowledge_shot(
        &mut self,
        match_id: String,
        shot_id: u32,
        hit: bool,
    ) -> app::Result<String> {
        let (role, entry) = self.caller_role(&match_id)?;
        let derived = self.derive(&match_id, &entry)?;
        if derived.standing != Standing::Playing {
            app::bail!(Error::Finished);
        }
        let Some(pending) = derived.pending().cloned() else {
            return Err(invalid("no pending shot"));
        };
        if usize::from(pending.shooter) == role {
            return Err(forbidden("not the target"));
        }
        let turn = turn_index(derived.turns.len() - 1)?;
        if shot_id != turn {
            return Err(invalid(&format!(
                "shot {shot_id} is not the pending shot ({turn})"
            )));
        }
        self.turns.insert(
            &(match_id.clone(), turn),
            &Turn {
                hit: Some(hit),
                ..pending.clone()
            },
        )?;
        let result = if hit { "hit" } else { "miss" };
        let audience = players_of(&entry);
        env::emit(
            Event::ShotFired {
                id: match_id.clone(),
                x: pending.x,
                y: pending.y,
                result: result.to_owned(),
            },
            audience.clone(),
        )?;
        // The answers now say the match is over. Both clients open their
        // boards on seeing this; neither result counts until the winner's
        // board has been audited.
        if self.derive(&match_id, &entry)?.ended.is_some() {
            env::emit(Event::RevealRequested { id: match_id }, audience)?;
        }
        Ok(result.to_owned())
    }

    /// Publish the caller's `(board, salt)` for every reader to audit, once
    /// the match is over (a board opened mid-game is a board handed to the
    /// opponent). `boardBytes` is `borsh(Vec<u8>)` of the 100 pristine cells,
    /// exactly what was hashed into the commitment; `salt` is its 16 bytes.
    /// A pair that does not hash to the commitment is refused
    /// (`CommitmentMismatch`), so the player can retry with the right board.
    /// A pair that does is on record for good, and if the answers the player
    /// gave do not fit it, they fail the audit and the game goes to the
    /// opponent. When this decides the match, the result is recorded in the
    /// lobby (history, stats) in the same call. Emits `BoardRevealed`,
    /// `AuditPassed`/`AuditFailed`, then `Winner` and `MatchEnded` (or only
    /// `MatchEnded` for a void match), `MatchListUpdated` and
    /// `PlayerStatsUpdated`.
    pub fn reveal_board(
        &mut self,
        match_id: String,
        board_bytes: Vec<u8>,
        salt: Vec<u8>,
    ) -> app::Result<()> {
        let (role, entry) = self.caller_role(&match_id)?;
        if salt.len() != SALT_LEN {
            return Err(invalid("a salt is 16 bytes"));
        }
        let before = self.derive(&match_id, &entry)?;
        if before.ended.is_none() {
            return Err(invalid(
                "the match is still being played — a board is revealed when it ends",
            ));
        }
        let Some(commitment) = before.commitment[role] else {
            return Err(invalid("no commitment for caller"));
        };
        if battleships_rules::commitment(&board_bytes, &salt) != commitment {
            app::bail!(Error::CommitmentMismatch);
        }
        let audience = players_of(&entry);
        let player = before.players[role].clone();
        if before.audit[role].is_none() {
            self.reveals.insert(
                &(match_id.clone(), player.clone()),
                &Reveal {
                    board_bytes: board_bytes.clone(),
                    salt,
                },
            )?;
            env::emit(
                Event::BoardRevealed {
                    id: match_id.clone(),
                    player: player.clone(),
                },
                audience.clone(),
            )?;
        }
        match audit_board(&board_bytes, &before.answers_by(role)) {
            Ok(()) => env::emit(
                Event::AuditPassed {
                    id: match_id.clone(),
                    player,
                },
                audience.clone(),
            )?,
            Err(failure) => env::emit(
                Event::AuditFailed {
                    id: match_id.clone(),
                    player,
                    reason: failure.to_string(),
                },
                audience.clone(),
            )?,
        }

        let after = self.derive(&match_id, &entry)?;
        if after.standing == before.standing {
            return Ok(());
        }
        match after.standing {
            Standing::Won { winner } => {
                self.record_result(
                    &match_id,
                    &after.players[winner],
                    &after.players[1 - winner],
                )?;
                env::emit(
                    Event::Winner {
                        id: match_id.clone(),
                    },
                    audience.clone(),
                )?;
                env::emit(Event::MatchEnded { id: match_id }, audience)?;
                env::emit(Event::MatchListUpdated {}, Audience::All)?;
                env::emit(Event::PlayerStatsUpdated {}, Audience::All)?;
            }
            Standing::Void => env::emit(Event::MatchEnded { id: match_id }, audience)?,
            Standing::Playing | Standing::AwaitingReveal => {}
        }
        Ok(())
    }

    /// The caller's shots at the opponent, as a grid. Players only.
    #[app::view]
    pub fn get_shots(&self, match_id: String) -> app::Result<ShotsView> {
        let (role, entry) = self.caller_role(&match_id)?;
        let derived = self.derive(&match_id, &entry)?;
        Ok(shots_grid(&derived, |turn| {
            usize::from(turn.shooter) == role
        }))
    }

    /// The opponent's shots at the caller, as a grid: what the client lays
    /// over the board on the device to draw "your waters". Players only.
    #[app::view]
    pub fn get_incoming_shots(&self, match_id: String) -> app::Result<ShotsView> {
        let (role, entry) = self.caller_role(&match_id)?;
        let derived = self.derive(&match_id, &entry)?;
        Ok(shots_grid(&derived, |turn| {
            usize::from(turn.shooter) != role
        }))
    }

    /// Everything a client needs about a match in one read. Players only.
    #[app::view]
    pub fn get_match_state(&self, match_id: String) -> app::Result<MatchStateView> {
        let (_, entry) = self.caller_role(&match_id)?;
        let derived = self.derive(&match_id, &entry)?;
        let pending_shot = match derived.pending() {
            Some(turn) => Some(PendingShotView {
                shot_id: turn_index(derived.turns.len() - 1)?,
                x: turn.x,
                y: turn.y,
                target: derived.players[1 - usize::from(turn.shooter)].clone(),
            }),
            None => None,
        };
        let (standing, winner) = match derived.standing {
            Standing::Playing => ("playing", None),
            Standing::AwaitingReveal => ("awaiting_reveal", None),
            Standing::Won { winner } => ("won", Some(derived.players[winner].clone())),
            Standing::Void => ("void", None),
        };
        Ok(MatchStateView {
            standing: standing.to_owned(),
            committed: derived.seats(|role| derived.placed(role)),
            pending_shot,
            ended_by: derived.ended.map(|(_, why)| why.to_owned()),
            loser: derived
                .ended
                .map(|(loser, _)| derived.players[loser].clone()),
            revealed: derived.seats(|role| derived.audit[role].is_some()),
            audit_failed: derived.seats(|role| matches!(derived.audit[role], Some(Err(_)))),
            winner,
        })
    }

    /// The caller's newest match that is not over yet (being played, or
    /// waiting for a reveal), or `None`. v1 answered the one match its game
    /// context was for.
    #[app::view]
    pub fn get_active_match_id(&self) -> app::Result<Option<String>> {
        let me = me()?;
        let mut newest: Option<(u64, String)> = None;
        for (match_id, entry) in read_all(&self.matches, &[])? {
            if entry.player1 != me && entry.player2 != me {
                continue;
            }
            let standing = self.derive(&match_id, &entry)?.standing;
            let open = matches!(standing, Standing::Playing | Standing::AwaitingReveal);
            if open
                && newest
                    .as_ref()
                    .is_none_or(|(at, _)| entry.created_ms >= *at)
            {
                newest = Some((entry.created_ms, match_id));
            }
        }
        Ok(newest.map(|(_, id)| id))
    }

    /// The player whose turn it is to shoot, or `None` once the match is over.
    #[app::view]
    pub fn get_current_turn(&self, match_id: String) -> app::Result<Option<String>> {
        let entry = self.entry(&match_id)?;
        let derived = self.derive(&match_id, &entry)?;
        if derived.ended.is_some() {
            return Ok(None);
        }
        Ok(Some(derived.players[derived.shooter].clone()))
    }

    /// The winner, once the match is over AND the winner's revealed board has
    /// passed the audit. `None` while playing, while waiting for a reveal, and
    /// for a match both players cheated in.
    #[app::view]
    pub fn get_winner(&self, match_id: String) -> app::Result<Option<String>> {
        let entry = self.entry(&match_id)?;
        let derived = self.derive(&match_id, &entry)?;
        Ok(match derived.standing {
            Standing::Won { winner } => Some(derived.players[winner].clone()),
            _ => None,
        })
    }

    /// The caller's account: the id they play as.
    #[app::view]
    pub fn get_current_user(&self) -> app::Result<String> {
        me()
    }
}

impl Battleships {
    fn entry(&self, match_id: &String) -> app::Result<MatchEntry> {
        self.matches.get(match_id)?.ok_or_else(|| {
            Error::NotFound {
                match_id: match_id.clone(),
            }
            .into()
        })
    }

    /// The caller's seat in `match_id` (0 for player 1, 1 for player 2).
    fn caller_role(&self, match_id: &String) -> app::Result<(usize, MatchEntry)> {
        let entry = self.entry(match_id)?;
        let me = me()?;
        let role = if me == entry.player1 {
            0
        } else if me == entry.player2 {
            1
        } else {
            return Err(forbidden("not a player"));
        };
        Ok((role, entry))
    }

    /// The match as its rows say it stands.
    fn derive(&self, match_id: &str, entry: &MatchEntry) -> app::Result<Derived> {
        let parse = |c: &Option<String>| -> Option<[u8; 32]> {
            c.as_deref().and_then(|c| parse_commitment(c).ok())
        };
        let mut derived = Derived {
            players: [entry.player1.clone(), entry.player2.clone()],
            commitment: [parse(&entry.commitment1), parse(&entry.commitment2)],
            turns: Vec::new(),
            shooter: 0,
            ended: None,
            audit: [None, None],
            standing: Standing::Playing,
        };
        let rows = self.turns.prefix(
            &[KeyPart::Str(match_id.to_owned())],
            FindOpts::default().limit(MAX_TURNS),
        )?;
        let mut hits_on = [0u32; 2];
        let mut misses_on = [0u32; 2];
        for ((_, _), turn) in rows.items {
            let shooter = usize::from(turn.shooter);
            let target = 1 - shooter;
            derived.shooter = shooter;
            let hit = turn.hit;
            derived.turns.push(turn);
            match hit {
                None => break,
                Some(true) => hits_on[target] += 1,
                Some(false) => misses_on[target] += 1,
            }
            if hits_on[target] == FLEET_CELLS {
                derived.ended = Some((target, "sunk"));
                break;
            }
            if misses_on[target] > MAX_MISSES {
                derived.ended = Some((target, "impossible_misses"));
                break;
            }
            derived.shooter = target;
        }

        for role in 0..2 {
            if derived.commitment[role].is_none() {
                continue;
            }
            let key = (match_id.to_owned(), derived.players[role].clone());
            if let Some(reveal) = self.reveals.get(&key)? {
                derived.audit[role] =
                    Some(audit_board(&reveal.board_bytes, &derived.answers_by(role)));
            }
        }

        derived.standing = match derived.ended {
            None => Standing::Playing,
            Some((loser, _)) => {
                let winner = 1 - loser;
                match (&derived.audit[winner], &derived.audit[loser]) {
                    (Some(Ok(())), _) => Standing::Won { winner },
                    (Some(Err(_)), Some(Err(_))) => Standing::Void,
                    (Some(Err(_)), _) => Standing::Won { winner: loser },
                    (None, _) => Standing::AwaitingReveal,
                }
            }
        };
        Ok(derived)
    }

    /// Write a decided match's result, once: the record, its place in the
    /// history and both players' stats.
    fn record_result(
        &mut self,
        match_id: &String,
        winner: &String,
        loser: &String,
    ) -> app::Result<()> {
        if self.results.contains(match_id)? {
            return Ok(());
        }
        self.results.insert(
            match_id,
            &MatchRecord {
                match_id: match_id.clone(),
                winner: winner.clone(),
                loser: loser.clone(),
                finished_ms: env::time_now(),
            },
        )?;
        self.history.push(match_id)?;
        let mut w = self.stats.get(winner)?.unwrap_or_default();
        w.wins = w.wins.saturating_add(1);
        self.stats.insert(winner, &w)?;
        let mut l = self.stats.get(loser)?.unwrap_or_default();
        l.losses = l.losses.saturating_add(1);
        self.stats.insert(loser, &l)?;
        Ok(())
    }
}

/// A typed failure: `422 APP_ERROR` with `{ code, fields }` on the wire. v1's
/// `GameError` kinds, the data string as a named field.
#[app::error]
pub enum Error {
    /// No match with this id.
    NotFound { match_id: String },
    /// An argument or the match's state broke a rule; `message` says which.
    Invalid { message: String },
    /// The caller may not do this (not a player, not their turn).
    Forbidden { message: String },
    /// The match is over.
    Finished,
    /// A new match id was already taken (a random-nonce collision).
    MatchIdCollision,
    /// The caller's board commitment is already on record.
    AlreadyCommitted,
    /// The revealed board and salt do not hash to the caller's commitment.
    CommitmentMismatch,
}

/// v1's lobby and game events, in one app. Lobby events go to everyone the
/// app reaches; a match's events to its two players, as a v1 game context's
/// went to its two members.
#[app::event]
pub enum Event {
    /// A new match was created.
    MatchCreated { id: String },
    /// The match list changed (created, a board committed, or finished).
    MatchListUpdated {},
    /// Player stats changed after a match finished.
    PlayerStatsUpdated {},
    /// A new player opened the lobby.
    PlayersUpdated {},
    /// A player placed their ships.
    ShipsPlaced { id: String },
    /// A player's board commitment was recorded.
    BoardCommitted {
        id: String,
        player: String,
        commitment: String,
    },
    /// A player opened their board after the match.
    BoardRevealed { id: String, player: String },
    /// The answers ended the match: both clients open their boards.
    RevealRequested { id: String },
    /// A revealed board passed the audit.
    AuditPassed { id: String, player: String },
    /// A revealed board failed the audit; `reason` says how.
    AuditFailed {
        id: String,
        player: String,
        reason: String,
    },
    /// A player fired a shot; the defender's client answers it.
    ShotProposed { id: String, x: u8, y: u8 },
    /// A shot was answered: `result` is `hit` or `miss`.
    ShotFired {
        id: String,
        x: u8,
        y: u8,
        result: String,
    },
    /// A winner was decided.
    Winner { id: String },
    /// The match ended (won or void).
    MatchEnded { id: String },
}

// ── helpers ─────────────────────────────────────────────────────────────────

fn invalid(message: &str) -> AppError {
    Error::Invalid {
        message: message.to_owned(),
    }
    .into()
}

fn forbidden(message: &str) -> AppError {
    Error::Forbidden {
        message: message.to_owned(),
    }
    .into()
}

/// The account the caller acts for (a signed-in account, or an API key
/// acting for one).
fn me() -> app::Result<String> {
    match env::caller() {
        Caller::Account(account) | Caller::ApiKey { account, .. } => Ok(account),
        Caller::Public | Caller::System | Caller::App(_) => Err(AppError::login_required()),
    }
}

/// An account the app's org holds in any role (guests included); with no
/// org, any account.
fn in_org(account: &str) -> bool {
    env::org().is_none() || env::org_role(account).is_some_and(|r| r >= OrgRole::Guest)
}

/// A match's two players, as an event audience.
fn players_of(entry: &MatchEntry) -> Audience {
    Audience::Accounts(vec![entry.player1.clone(), entry.player2.clone()])
}

fn seat(role: usize) -> u8 {
    u8::from(role != 0)
}

fn turn_index(index: usize) -> app::Result<u32> {
    u32::try_from(index).map_err(|_| invalid("turn index overflow"))
}

/// A commitment as the client files it: 64 hex characters of SHA-256.
fn parse_commitment(encoded: &str) -> app::Result<[u8; 32]> {
    let bytes =
        hex::decode(encoded.trim()).map_err(|e| invalid(&format!("commitment is not hex: {e}")))?;
    <[u8; 32]>::try_from(bytes.as_slice())
        .map_err(|_| invalid("a commitment is 32 bytes (64 hex characters)"))
}

/// Audit one revealed board: a legal fleet, and every answer true to it.
fn audit_board(board_bytes: &[u8], answers: &[(u8, u8, bool)]) -> Result<(), AuditFailure> {
    let cells = battleships_rules::cells_of(board_bytes).ok_or(AuditFailure::InvalidFleet)?;
    if !audit::valid_fleet(cells) {
        return Err(AuditFailure::InvalidFleet);
    }
    audit::check_answers(cells, answers)
}

/// A grid of the turns `keep` selects: pending, hit or miss per cell.
fn shots_grid(derived: &Derived, keep: impl Fn(&Turn) -> bool) -> ShotsView {
    let size = usize::from(BOARD_SIZE);
    let mut shots = vec![0u8; size * size];
    for turn in derived.turns.iter().filter(|turn| keep(turn)) {
        let cell = match turn.hit {
            None => Cell::Pending,
            Some(true) => Cell::Hit,
            Some(false) => Cell::Miss,
        };
        shots[usize::from(turn.y) * size + usize::from(turn.x)] = cell.to_u8();
    }
    ShotsView {
        size: BOARD_SIZE,
        shots,
    }
}

/// Every entry of `map` under `prefix`, following the cursor to the end.
fn read_all<K, V>(map: &UnorderedMap<K, V>, prefix: &[KeyPart]) -> app::Result<Vec<(K, V)>>
where
    K: ToKey + FromKey,
    V: Serialize + DeserializeOwned,
{
    let mut out = Vec::new();
    let mut opts = FindOpts::default().limit(PAGE);
    loop {
        let page = map.prefix(prefix, opts)?;
        out.extend(page.items);
        match page.next {
            Some(next) => opts = FindOpts::default().limit(PAGE).cursor(next),
            None => return Ok(out),
        }
    }
}
