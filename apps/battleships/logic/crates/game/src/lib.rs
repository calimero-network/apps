//! Game service — live match gameplay with boards that stay on the device.
//!
//! ## What holds against a node that does not run this code
//!
//! A peer's node folds an incoming delta into storage without executing this
//! contract, so every check in a method binds only the node that runs it. What
//! every node enforces is the storage type, and this contract leans on three:
//!
//! * **`Frozen` config.** Who plays, which match this is and which lobby hears
//!   the result are written once at `init`, and no node accepts a change.
//! * **`WriteOnce` rows, owned and immutable.** A commitment, a shot, an
//!   answer and a reveal are each a row only their author can write and nobody
//!   — the author included — can change or remove. Keys name the author's
//!   account, and the reader checks core's owner stamp against it.
//! * **Nothing stored that can be derived.** Whose turn it is, which shot is
//!   pending, who has placed and who won are all worked out on read from those
//!   rows (see [`GameState::derive`]), so there is no `turn` or `winner` field
//!   for a patched node to set.
//!
//! ## Hidden information
//!
//! The contract never holds a board. Each player's board and salt stay on the
//! player's own device, and the contract stores only
//! `SHA256(borsh(board) || salt)`, which the client computes and files with
//! [`GameState::commit_board`]. The defender's client answers every shot from
//! that local board ([`GameState::acknowledge_shot`] is a signed statement,
//! `hit` or `miss`, recorded in shared state), so an answer is a claim — and at
//! match end BOTH players publish `(board, salt)` with
//! [`GameState::reveal_board`]. Every reader then checks the reveal against
//! the commitment, checks it is a legal fleet, and replays every answer its
//! owner gave against it. The declared winner must pass that audit to win; a
//! winner who lied loses to the player they lied to. And a defender who
//! answers "miss" forever cannot stall the game: a fleet is 17 cells, so an
//! 84th miss on a 100-cell board is a lie on its face.
//!
//! Nothing here reads `#[app::private]` storage. An execution on an account's
//! behalf — a delegated run through a relay — has none (core refuses it with a
//! typed 400), and a board the contract cannot see is a board the relay cannot
//! see either. Node and account sessions take the same path.
//!
//! What remains open, as before: a player who never answers, or never reveals,
//! stalls the match. There is no clock in the contract to forfeit them on.

use battleships_types::{GameError, PublicKey};
use calimero_sdk::abi::AbiType;
use calimero_sdk::borsh::{BorshDeserialize, BorshSerialize};
use calimero_sdk::serde::{Deserialize, Serialize};
use calimero_sdk::types::Error as AppError;
use calimero_sdk::{app, AccountId};
use calimero_storage::collections::{Frozen, Guarded, Owning, SortedMap, WriteOnce};
use sha2::{Digest, Sha256};

pub mod audit;
pub mod board;
pub mod events;
pub mod players;
pub mod ships;
pub mod validation;

use audit::{AuditFailure, FLEET_CELLS};
use board::{Cell, BOARD_SIZE};
use events::Event;

/// Every cell of the opponent's board, once each: the most shots one player
/// can fire, so twice that bounds a match.
const MAX_TURNS: usize = 2 * (BOARD_SIZE as usize) * (BOARD_SIZE as usize);

/// The most misses a defender can truthfully report: every cell that is not
/// part of the fleet.
const MAX_MISSES: u32 = (BOARD_SIZE as u32) * (BOARD_SIZE as u32) - FLEET_CELLS;

// ---------------------------------------------------------------------------
// API response types
// ---------------------------------------------------------------------------

/// A grid of the caller's shots (`get_shots`) or of the shots fired at the
/// caller (`get_incoming_shots`): one [`Cell`] byte per square, row-major.
#[derive(AbiType, Debug, Clone, BorshSerialize, BorshDeserialize, Serialize, Deserialize)]
#[borsh(crate = "calimero_sdk::borsh")]
#[serde(crate = "calimero_sdk::serde")]
pub struct ShotsView {
    pub size: u8,
    pub shots: Vec<u8>,
}

/// The shot waiting for its defender's answer.
#[derive(AbiType, Debug, Clone, BorshSerialize, BorshDeserialize, Serialize, Deserialize)]
#[borsh(crate = "calimero_sdk::borsh")]
#[serde(crate = "calimero_sdk::serde")]
pub struct PendingShotView {
    /// What `acknowledge_shot` takes: the turn index of this shot, so an
    /// answer meant for an earlier shot is refused instead of misfiled.
    pub shot_id: u32,
    pub x: u8,
    pub y: u8,
    /// The player who has to answer, by key.
    pub target: String,
}

/// The match as every reader derives it, in one read: what a client needs to
/// know whether to commit, answer, reveal, or show a result.
#[derive(AbiType, Debug, Clone, BorshSerialize, BorshDeserialize, Serialize, Deserialize)]
#[borsh(crate = "calimero_sdk::borsh")]
#[serde(crate = "calimero_sdk::serde")]
pub struct MatchStateView {
    /// `playing`, `awaiting_reveal`, `won` or `void`.
    pub standing: String,
    /// Players, by key, whose commitment is on record.
    pub committed: Vec<String>,
    pub pending_shot: Option<PendingShotView>,
    /// Why the answers ended it: `sunk`, `equivocation` or
    /// `impossible_misses`. `None` while playing.
    pub ended_by: Option<String>,
    /// The player the answers say lost, by key.
    pub loser: Option<String>,
    /// Players whose revealed board matched their commitment.
    pub revealed: Vec<String>,
    /// Players whose revealed board failed the audit — a lie about a shot, or
    /// an illegal fleet. Revealing is how a cheater is caught.
    pub audit_failed: Vec<String>,
    /// The audited winner, by key. Set only when `standing` is `won`.
    pub winner: Option<String>,
}

// ---------------------------------------------------------------------------
// Stored records
// ---------------------------------------------------------------------------

/// One player: the context-member key the UI names them by, and the account
/// core stamps their rows with.
///
/// A player id is a context member (a device); a row's owner stamp is the
/// PERSON. Both are recorded because both are true, and the account is the one
/// the security rests on.
#[derive(AbiType, Debug, Clone, BorshSerialize, BorshDeserialize, Serialize, Deserialize)]
#[borsh(crate = "calimero_sdk::borsh")]
#[serde(crate = "calimero_sdk::serde")]
pub struct Player {
    pub key: PublicKey,
    pub account: [u8; 32],
}

/// Everything fixed when the match is created.
#[derive(
    AbiType, Debug, Clone, Default, BorshSerialize, BorshDeserialize, Serialize, Deserialize,
)]
#[borsh(crate = "calimero_sdk::borsh")]
#[serde(crate = "calimero_sdk::serde")]
pub struct GameConfig {
    pub lobby_context_id: Option<String>,
    pub match_id: Option<String>,
    /// `[player1, player2]`, or empty when `init` was not given both.
    pub players: Vec<Player>,
}

/// A shot, keyed `"<shooter account>/<turn>/<nonce>"`.
#[derive(AbiType, Debug, Clone, BorshSerialize, BorshDeserialize, Serialize, Deserialize)]
#[borsh(crate = "calimero_sdk::borsh")]
#[serde(crate = "calimero_sdk::serde")]
pub struct Shot {
    pub x: u8,
    pub y: u8,
}

/// The defender's answer to the shot of the same turn, keyed
/// `"<defender account>/<turn>/<nonce>"`.
#[derive(AbiType, Debug, Clone, BorshSerialize, BorshDeserialize, Serialize, Deserialize)]
#[borsh(crate = "calimero_sdk::borsh")]
#[serde(crate = "calimero_sdk::serde")]
pub struct Answer {
    pub hit: bool,
}

/// A board opened at match end, keyed `"<account>/<nonce>"`.
#[derive(AbiType, Debug, Clone, BorshSerialize, BorshDeserialize, Serialize, Deserialize)]
#[borsh(crate = "calimero_sdk::borsh")]
#[serde(crate = "calimero_sdk::serde")]
pub struct Reveal {
    pub board_bytes: Vec<u8>,
    pub salt: [u8; 16],
}

// ---------------------------------------------------------------------------
// Derived state
// ---------------------------------------------------------------------------

/// One turn of the match: a shot, and its answer once the defender gives one.
struct Turn {
    shooter: usize,
    x: u8,
    y: u8,
    hit: Option<bool>,
}

/// How the match stands.
#[derive(Debug, PartialEq)]
enum Standing {
    Playing,
    /// Over on the answers, waiting for the declared winner's board to be
    /// audited before it counts.
    AwaitingReveal,
    Won {
        winner: usize,
    },
    /// Both players' audits failed: nobody wins a game both cheated in.
    Void,
}

/// The match as every reader derives it from the rows.
struct Derived {
    commitment: [Option<[u8; 32]>; 2],
    turns: Vec<Turn>,
    /// Whose turn it is to shoot next (or, with a shot pending, whose shot).
    shooter: usize,
    /// The player the answers say lost, and why.
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
            .filter(|turn| turn.shooter != role)
            .filter_map(|turn| turn.hit.map(|hit| (turn.x, turn.y, hit)))
            .collect()
    }

    fn already_shot(&self, shooter: usize, x: u8, y: u8) -> bool {
        self.turns
            .iter()
            .any(|turn| turn.shooter == shooter && turn.x == x && turn.y == y)
    }
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/// The caller's ACCOUNT: what owner stamps name, so what a player is checked
/// against. `UserStorage` and every guarded collection key by it; the player
/// KEY in the config is the context member the UI names.
fn caller_account() -> [u8; 32] {
    calimero_sdk::env::account_id()
}

// ---------------------------------------------------------------------------
// Game state
// ---------------------------------------------------------------------------

#[app::state(emits = for<'a> Event<'a>)]
pub struct GameState {
    config: Frozen<GameConfig>,
    /// `"<account>/<nonce>"` -> that player's SHA-256 board commitment.
    commitments: WriteOnce<SortedMap<String, [u8; 32]>>,
    shots: WriteOnce<SortedMap<String, Shot>>,
    answers: WriteOnce<SortedMap<String, Answer>>,
    reveals: WriteOnce<SortedMap<String, Reveal>>,
}

#[app::logic]
impl GameState {
    #[app::init]
    pub fn init(
        player1: String,
        player2: String,
        player2_account: String,
        lobby_context_id: Option<String>,
        match_id: String,
    ) -> GameState {
        // Player 1 is whoever creates the match, so their account is the one
        // running this; player 2's is the one the lobby recorded for them.
        let players = match (
            PublicKey::from_hex(&player1),
            PublicKey::from_hex(&player2),
            PublicKey::from_hex(&player2_account),
        ) {
            (Ok(key1), Ok(key2), Ok(account2)) if !match_id.is_empty() => vec![
                Player {
                    key: key1,
                    account: caller_account(),
                },
                Player {
                    key: key2,
                    account: account2.0,
                },
            ],
            _ => Vec::new(),
        };
        // Game context echoes the lobby-issued match_id verbatim so the
        // on_match_finished xcall lands on the lobby's matches map directly,
        // no context-id reverse scan needed.
        let match_id = (!players.is_empty()).then_some(match_id);
        GameState {
            config: Frozen::new(GameConfig {
                lobby_context_id,
                match_id,
                players,
            }),
            commitments: WriteOnce::new(),
            shots: WriteOnce::new(),
            answers: WriteOnce::new(),
            reveals: WriteOnce::new(),
        }
    }

    // ---- Game API ----

    /// File the caller's board commitment: `SHA256(borsh(board) || salt)` as
    /// 64 hex characters, computed on the device that keeps the board and the
    /// salt. Whether the board behind it is a legal fleet is settled at the
    /// reveal, by every reader — a commitment to nonsense is a loss, not a
    /// refusal.
    pub fn commit_board(&mut self, match_id: &str, commitment: String) -> app::Result<()> {
        let role = self.caller_role(match_id)?;
        let derived = self.derive()?;
        if derived.standing != Standing::Playing {
            app::bail!(GameError::Finished);
        }
        if derived.placed(role) {
            app::bail!(GameError::AlreadyCommitted);
        }
        let commitment = parse_commitment(&commitment)?;

        // Publish the commitment: written once, by its owner, for good.
        let account = hex::encode(caller_account());
        let row = Self::free_key(&self.commitments, |nonce| format!("{account}/{nonce}"))?;
        self.commitments.insert(row, commitment)?;

        let commitment_hex = hex_encode(&commitment);
        let caller_hex = self.player(role)?.key.to_hex();
        app::emit!(Event::BoardCommitted {
            id: match_id,
            player: &caller_hex,
            commitment: &commitment_hex,
        });
        app::emit!(Event::ShipsPlaced { id: match_id });
        Ok(())
    }

    pub fn propose_shot(&mut self, match_id: &str, x: u8, y: u8) -> app::Result<()> {
        let role = self.caller_role(match_id)?;
        if x >= BOARD_SIZE || y >= BOARD_SIZE {
            app::bail!(GameError::Invalid("out of bounds".into()));
        }
        let derived = self.derive()?;
        if derived.standing != Standing::Playing {
            app::bail!(GameError::Finished);
        }
        if !derived.placed(0) || !derived.placed(1) {
            app::bail!(GameError::Invalid(
                "both players must place ships first".into()
            ));
        }
        if derived.pending().is_some() {
            app::bail!(GameError::Invalid("a shot is already pending".into()));
        }
        if derived.shooter != role {
            app::bail!(GameError::Forbidden("not your turn".into()));
        }
        // A cell already shot has an answer; a second shot at it would be a
        // turn spent on nothing, and the reader does not count one.
        if derived.already_shot(role, x, y) {
            app::bail!(GameError::Invalid(format!(
                "cell ({x},{y}) was already shot"
            )));
        }

        let turn = derived.turns.len();
        let account = hex::encode(caller_account());
        let row = Self::free_key(&self.shots, |nonce| turn_key(&account, turn, nonce))?;
        self.shots.insert(row, Shot { x, y })?;

        // A plain event: the defender's CLIENT answers, from the board on its
        // device. No handler, because a handler runs in the contract, which
        // has no board to answer from — on any node, and on a relay least of
        // all.
        app::emit!(Event::ShotProposed { id: match_id, x, y });
        Ok(())
    }

    /// The defender's answer to the pending shot — `hit` or not — as their
    /// client read it off the board on their device. A signed statement in
    /// shared state, write-once: it is what the reveal is replayed against,
    /// so a false answer here is the lie the audit catches.
    ///
    /// `shot_id` is the pending shot's turn index (see `get_match_state`), so
    /// an answer composed for one shot cannot land on the next.
    pub fn acknowledge_shot(
        &mut self,
        match_id: &str,
        shot_id: u32,
        hit: bool,
    ) -> app::Result<String> {
        let role = self.caller_role(match_id)?;
        let derived = self.derive()?;
        if derived.standing != Standing::Playing {
            app::bail!(GameError::Finished);
        }
        let Some(pending) = derived.pending() else {
            app::bail!(GameError::Invalid("no pending shot".into()));
        };
        if pending.shooter == role {
            app::bail!(GameError::Forbidden("not the target".into()));
        }
        let turn = derived.turns.len() - 1;
        if usize::try_from(shot_id).ok() != Some(turn) {
            app::bail!(GameError::Invalid(format!(
                "shot {shot_id} is not the pending shot ({turn})"
            )));
        }
        let (x, y) = (pending.x, pending.y);

        let account = hex::encode(caller_account());
        let row = Self::free_key(&self.answers, |nonce| turn_key(&account, turn, nonce))?;
        self.answers.insert(row, Answer { hit })?;

        let result_str = if hit { "hit" } else { "miss" };
        app::emit!(Event::ShotFired {
            id: match_id,
            x,
            y,
            result: result_str,
        });

        // The answers now say the match is over. Both clients open their
        // boards on seeing this; neither result counts until the winner's
        // board has been audited by every reader.
        if self.derive()?.ended.is_some() {
            app::emit!(Event::RevealRequested { id: match_id });
        }
        Ok(result_str.to_string())
    }

    /// Publish the caller's `(board, salt)` for every reader to audit, and
    /// report how the audit went. Only once the match is over: a board opened
    /// mid-game is a board handed to the opponent.
    ///
    /// `board_bytes` is `borsh(Vec<u8>)` of the 100 pristine cells (water or
    /// ship), exactly what was hashed into the commitment. A pair that does
    /// not hash to the commitment is refused, so the player can retry with
    /// the right board; a pair that does is on record for good, and if the
    /// answers the player gave do not match it, every reader marks them a
    /// cheater and the game goes to the opponent.
    pub fn reveal_board(
        &mut self,
        match_id: &str,
        board_bytes: Vec<u8>,
        salt: [u8; 16],
    ) -> app::Result<()> {
        let role = self.caller_role(match_id)?;
        if self.derive()?.ended.is_none() {
            app::bail!(GameError::Invalid(
                "the match is still being played — a board is revealed when it ends".into()
            ));
        }
        self.publish_reveal(match_id, role, board_bytes, salt)?;
        self.announce_if_decided(match_id)
    }

    /// The caller's shots at the opponent, as a grid.
    pub fn get_shots(&self, match_id: &str) -> app::Result<ShotsView> {
        let role = self.caller_role(match_id)?;
        let derived = self.derive()?;
        Ok(Self::shots_grid(&derived, |turn| turn.shooter == role))
    }

    /// The opponent's shots at the caller, as a grid — what the client lays
    /// over the board on the device to draw "your waters": the answers the
    /// caller gave, and the shot still waiting for one.
    pub fn get_incoming_shots(&self, match_id: &str) -> app::Result<ShotsView> {
        let role = self.caller_role(match_id)?;
        let derived = self.derive()?;
        Ok(Self::shots_grid(&derived, |turn| turn.shooter != role))
    }

    /// Everything a client needs in one read, so a session on a relay is
    /// not four round trips per event.
    pub fn get_match_state(&self, match_id: &str) -> app::Result<MatchStateView> {
        let _ = self.caller_role(match_id)?;
        let derived = self.derive()?;
        let key = |role: usize| self.player(role).map(|p| p.key.to_hex());
        let by_role = |keep: &dyn Fn(usize) -> bool| -> app::Result<Vec<String>> {
            (0..2).filter(|&role| keep(role)).map(key).collect()
        };
        let pending_shot = match derived.pending() {
            Some(turn) => Some(PendingShotView {
                shot_id: u32::try_from(derived.turns.len() - 1)
                    .map_err(|_| AppError::msg("turn index overflow"))?,
                x: turn.x,
                y: turn.y,
                target: key(1 - turn.shooter)?,
            }),
            None => None,
        };
        let (standing, winner) = match derived.standing {
            Standing::Playing => ("playing", None),
            Standing::AwaitingReveal => ("awaiting_reveal", None),
            Standing::Won { winner } => ("won", Some(key(winner)?)),
            Standing::Void => ("void", None),
        };
        Ok(MatchStateView {
            standing: standing.to_owned(),
            committed: by_role(&|role| derived.placed(role))?,
            pending_shot,
            ended_by: derived.ended.map(|(_, why)| why.to_owned()),
            loser: match derived.ended {
                Some((loser, _)) => Some(key(loser)?),
                None => None,
            },
            revealed: by_role(&|role| derived.audit[role].is_some())?,
            audit_failed: by_role(&|role| matches!(derived.audit[role], Some(Err(_))))?,
            winner,
        })
    }

    pub fn get_active_match_id(&self) -> app::Result<Option<String>> {
        Ok(self.config.get()?.match_id.clone())
    }

    /// The player whose turn it is to shoot, or `None` once the match is over.
    pub fn get_current_turn(&self) -> app::Result<Option<String>> {
        if self.config.get()?.players.is_empty() {
            return Ok(None);
        }
        let derived = self.derive()?;
        if derived.ended.is_some() {
            return Ok(None);
        }
        Ok(Some(self.player(derived.shooter)?.key.to_hex()))
    }

    /// The winner, once the match is over AND the winner's revealed board has
    /// passed every reader's audit. `None` while playing, while waiting for a
    /// reveal, and for a match both players cheated in.
    pub fn get_winner(&self) -> app::Result<Option<String>> {
        if self.config.get()?.players.is_empty() {
            return Ok(None);
        }
        match self.derive()?.standing {
            Standing::Won { winner } => Ok(Some(self.player(winner)?.key.to_hex())),
            _ => Ok(None),
        }
    }

    pub fn get_current_user(&self) -> app::Result<String> {
        Ok(hex::encode(calimero_sdk::env::device_id()))
    }
}

impl GameState {
    fn player(&self, role: usize) -> app::Result<Player> {
        self.config
            .get()?
            .players
            .get(role)
            .cloned()
            .ok_or_else(|| AppError::from(GameError::Invalid("players unset".into())))
    }

    /// The caller's seat — 0 for player 1, 1 for player 2 — by ACCOUNT, after
    /// checking `match_id` names this match.
    fn caller_role(&self, match_id: &str) -> app::Result<usize> {
        let config = self.config.get()?;
        let Some(active_id) = config.match_id.as_deref() else {
            app::bail!(GameError::Invalid("no active match".into()));
        };
        if match_id != active_id {
            app::bail!(GameError::NotFound(match_id.to_string()));
        }
        let me = caller_account();
        config
            .players
            .iter()
            .position(|p| p.account == me)
            .ok_or_else(|| AppError::from(GameError::Forbidden("not a player".into())))
    }

    /// The match as the rows say it stands — the only source of turn, pending
    /// shot, placement and result.
    ///
    /// Each thing a player writes counts only as ONE distinct value: rows are
    /// write-once, so a player cannot change a shot, an answer or a
    /// commitment, and filing a second different one is equivocation, which
    /// loses. Choosing between two by a clock would let a player take either
    /// back.
    fn derive(&self) -> app::Result<Derived> {
        let players = self.config.get()?.players.clone();
        let mut derived = Derived {
            commitment: [None, None],
            turns: Vec::new(),
            shooter: 0,
            ended: None,
            audit: [None, None],
            standing: Standing::Playing,
        };
        if players.len() != 2 {
            return Ok(derived);
        }
        let prefix = |role: usize| format!("{}/", hex::encode(players[role].account));

        for (role, player) in players.iter().enumerate() {
            let mut distinct = Self::owned_rows(&self.commitments, &prefix(role), &player.account)?
                .into_iter()
                .map(|(_, c)| c)
                .collect::<Vec<_>>();
            distinct.sort_unstable();
            distinct.dedup();
            match distinct.as_slice() {
                [] => {}
                [one] => derived.commitment[role] = Some(*one),
                _ => {
                    derived.ended.get_or_insert((role, "equivocation"));
                }
            }
        }

        let mut hits_on = [0u32; 2];
        let mut misses_on = [0u32; 2];
        if derived.ended.is_none() && derived.placed(0) && derived.placed(1) {
            for turn in 0..MAX_TURNS {
                let shooter = turn % 2;
                let target = 1 - shooter;
                derived.shooter = shooter;
                let at = |role: usize| format!("{}{turn:03}/", prefix(role));

                let mut cells: Vec<(u8, u8)> =
                    Self::owned_rows(&self.shots, &at(shooter), &players[shooter].account)?
                        .into_iter()
                        .map(|(_, shot)| (shot.x, shot.y))
                        .filter(|&(x, y)| {
                            x < BOARD_SIZE && y < BOARD_SIZE && !derived.already_shot(shooter, x, y)
                        })
                        .collect();
                cells.sort_unstable();
                cells.dedup();
                let (x, y) = match cells.as_slice() {
                    [] => break,
                    [one] => *one,
                    _ => {
                        derived.ended = Some((shooter, "equivocation"));
                        break;
                    }
                };

                let mut answers: Vec<bool> =
                    Self::owned_rows(&self.answers, &at(target), &players[target].account)?
                        .into_iter()
                        .map(|(_, answer)| answer.hit)
                        .collect();
                answers.sort_unstable();
                answers.dedup();
                let hit = match answers.as_slice() {
                    [] => None,
                    [one] => Some(*one),
                    _ => {
                        derived.ended = Some((target, "equivocation"));
                        break;
                    }
                };
                derived.turns.push(Turn { shooter, x, y, hit });
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
        }

        for (role, player) in players.iter().enumerate() {
            let Some(commitment) = derived.commitment[role] else {
                continue;
            };
            let opened = Self::owned_rows(&self.reveals, &prefix(role), &player.account)?
                .into_iter()
                .find(|(_, r)| audit::verify_commitment(&r.board_bytes, &r.salt, &commitment));
            if let Some((_, reveal)) = opened {
                derived.audit[role] =
                    Some(Self::audit(&reveal.board_bytes, &derived.answers_by(role)));
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

    /// Audit one revealed board: a legal fleet, and every answer true to it.
    fn audit(board_bytes: &[u8], answers: &[(u8, u8, bool)]) -> Result<(), AuditFailure> {
        let cells: Vec<u8> =
            calimero_sdk::borsh::from_slice(board_bytes).map_err(|_| AuditFailure::InvalidFleet)?;
        if !audit::valid_fleet(&cells) {
            return Err(AuditFailure::InvalidFleet);
        }
        audit::check_answers(&cells, answers)
    }

    /// A grid of the turns `keep` selects: pending, hit or miss per cell.
    fn shots_grid(derived: &Derived, keep: impl Fn(&Turn) -> bool) -> ShotsView {
        let mut shots = vec![0u8; (BOARD_SIZE as usize) * (BOARD_SIZE as usize)];
        for turn in derived.turns.iter().filter(|turn| keep(turn)) {
            let cell = match turn.hit {
                None => Cell::Pending,
                Some(true) => Cell::Hit,
                Some(false) => Cell::Miss,
            };
            shots[(turn.y as usize) * (BOARD_SIZE as usize) + (turn.x as usize)] = cell.to_u8();
        }
        ShotsView {
            size: BOARD_SIZE,
            shots,
        }
    }

    /// Open the caller's own board — once — and report how its audit went.
    fn publish_reveal(
        &mut self,
        match_id: &str,
        role: usize,
        board_bytes: Vec<u8>,
        salt: [u8; 16],
    ) -> app::Result<()> {
        let derived = self.derive()?;
        let Some(commitment) = derived.commitment[role] else {
            app::bail!(GameError::Invalid("no commitment for caller".into()));
        };
        let caller_hex = self.player(role)?.key.to_hex();
        if !audit::verify_commitment(&board_bytes, &salt, &commitment) {
            app::emit!(Event::AuditFailed {
                id: match_id,
                player: &caller_hex,
                reason: "commitment_mismatch",
            });
            app::bail!(GameError::CommitmentMismatch);
        }
        if derived.audit[role].is_none() {
            let account = hex::encode(caller_account());
            let row = Self::free_key(&self.reveals, |nonce| format!("{account}/{nonce}"))?;
            self.reveals.insert(
                row,
                Reveal {
                    board_bytes: board_bytes.clone(),
                    salt,
                },
            )?;
            app::emit!(Event::BoardRevealed {
                id: match_id,
                player: &caller_hex,
            });
        }
        match Self::audit(&board_bytes, &derived.answers_by(role)) {
            Ok(()) => app::emit!(Event::AuditPassed {
                id: match_id,
                player: &caller_hex,
            }),
            Err(failure) => {
                let reason = failure.to_string();
                app::emit!(Event::AuditFailed {
                    id: match_id,
                    player: &caller_hex,
                    reason: &reason,
                });
            }
        }
        Ok(())
    }

    /// Announce the result once the audits have decided it, and report a win
    /// to the lobby. Every node that sees the decision may report it; the
    /// lobby counts one result per match.
    fn announce_if_decided(&mut self, match_id: &str) -> app::Result<()> {
        let (winner, loser) = match self.derive()?.standing {
            Standing::Won { winner } => (winner, 1 - winner),
            Standing::Void => {
                app::emit!(Event::MatchEnded { id: match_id });
                return Ok(());
            }
            Standing::Playing | Standing::AwaitingReveal => return Ok(()),
        };
        app::emit!(Event::Winner { id: match_id });
        app::emit!(Event::MatchEnded { id: match_id });

        let config = self.config.get()?;
        let lobby = config
            .lobby_context_id
            .as_deref()
            .and_then(|hex_id| hex::decode(hex_id).ok())
            .and_then(|bytes| <[u8; 32]>::try_from(bytes.as_slice()).ok());
        if let Some(lobby) = lobby {
            let params = calimero_sdk::serde_json::json!({
                "match_id": match_id,
                "winner": self.player(winner)?.key.to_hex(),
                "loser": self.player(loser)?.key.to_hex(),
            });
            if let Ok(payload) = calimero_sdk::serde_json::to_vec(&params) {
                calimero_sdk::env::xcall(&lobby, "on_match_finished", &payload);
            }
        }
        Ok(())
    }

    /// Every row under `prefix` that `author` really wrote: the prefix names
    /// the account, and core's owner stamp has to agree.
    ///
    /// Keys are per owner (core rc.57): one key appears once per account
    /// holding it, and a key-only read answers only for the caller. So each
    /// distinct key is read once, as `author`'s own entry, by name.
    fn owned_rows<V, P>(
        map: &Guarded<SortedMap<String, V>, P>,
        prefix: &str,
        author: &[u8; 32],
    ) -> app::Result<Vec<(String, V)>>
    where
        V: BorshSerialize + BorshDeserialize + 'static,
        P: Owning,
    {
        let author = AccountId::from(*author);
        let mut rows: Vec<(String, V)> = Vec::new();
        for (key, _) in map.prefix(prefix.as_bytes())? {
            if rows.last().is_some_and(|(last, _)| *last == key) {
                continue;
            }
            if let Some(value) = map.get_by(&author, &key)? {
                rows.push((key, value));
            }
        }
        Ok(rows)
    }

    /// A key the caller has not written yet. Keys are per owner, so nobody
    /// else can occupy it; the time-derived suffix only keeps a player's own
    /// rows apart.
    fn free_key<V, P>(
        map: &Guarded<SortedMap<String, V>, P>,
        build: impl Fn(u64) -> String,
    ) -> app::Result<String>
    where
        V: BorshSerialize + BorshDeserialize + 'static,
        P: Owning,
    {
        let start = calimero_storage::env::time_now();
        for offset in 0..16 {
            let key = build(start.saturating_add(offset));
            if !map.contains(&key)? {
                return Ok(key);
            }
        }
        app::bail!(GameError::Invalid(
            "could not find a free slot to write to".into()
        ));
    }
}

/// `"<account>/<turn>/<nonce>"` — a shot or an answer. Turns are zero-padded so
/// a prefix names exactly one.
fn turn_key(account: &str, turn: usize, nonce: u64) -> String {
    format!("{account}/{turn:03}/{nonce}")
}

/// Compute `SHA256(board_bytes || salt)` — exposed for tests and cross-module use.
pub fn compute_commitment(board_bytes: &[u8], salt: &[u8; 16]) -> [u8; 32] {
    let mut h = Sha256::new();
    h.update(board_bytes);
    h.update(salt);
    h.finalize().into()
}

fn hex_encode(bytes: &[u8; 32]) -> String {
    let mut s = String::with_capacity(64);
    for b in bytes {
        s.push_str(&format!("{:02x}", b));
    }
    s
}

/// A commitment as the client files it: 64 hex characters of SHA-256.
fn parse_commitment(encoded: &str) -> app::Result<[u8; 32]> {
    let bytes = hex::decode(encoded.trim())
        .map_err(|e| AppError::from(GameError::Invalid(format!("commitment is not hex: {e}"))))?;
    <[u8; 32]>::try_from(bytes.as_slice()).map_err(|_| {
        AppError::from(GameError::Invalid(
            "a commitment is 32 bytes (64 hex characters)".into(),
        ))
    })
}

/// Helper used by the audit routine.
pub fn is_ship_cell(value: u8) -> bool {
    Cell::from_u8(value) == Cell::Ship
}

#[cfg(test)]
mod tests {
    use calimero_sdk::testing::TestHost;

    use super::*;
    use players::PlayerBoard;

    const ALICE_DEVICE: [u8; 32] = [0xA2; 32];
    const BOB: [u8; 32] = [0xB0; 32];
    const BOB_DEVICE: [u8; 32] = [0xB2; 32];
    const CAROL: [u8; 32] = [0xC0; 32];
    const MATCH: &str = "match-1";

    const ALICE_FLEET: [&str; 5] = [
        "0,0;1,0",
        "0,2;1,2;2,2",
        "0,4;1,4;2,4",
        "0,6;1,6;2,6;3,6",
        "0,8;1,8;2,8;3,8;4,8",
    ];
    const BOB_FLEET: [&str; 5] = [
        "8,0;9,0",
        "7,2;8,2;9,2",
        "7,4;8,4;9,4",
        "6,6;7,6;8,6;9,6",
        "5,8;6,8;7,8;8,8;9,8",
    ];
    const ALICE_SALT: [u8; 16] = [0xA5; 16];
    const BOB_SALT: [u8; 16] = [0xB5; 16];

    fn cells(fleet: &[&str]) -> Vec<(u8, u8)> {
        fleet
            .iter()
            .flat_map(|ship| ship.split(';'))
            .map(|c| {
                let (x, y) = c.split_once(',').expect("x,y");
                (x.parse().expect("x"), y.parse().expect("y"))
            })
            .collect()
    }

    /// Water on Bob's side of the board, for shots that miss.
    fn bob_water() -> Vec<(u8, u8)> {
        (0..10u8)
            .flat_map(|y| (0..4u8).map(move |x| (x, y)))
            .collect()
    }

    /// What the client keeps on the device: the 100 pristine cells of a
    /// fleet, laid out by the same rules the placement grid enforces.
    fn board(fleet: &[&str]) -> Vec<u8> {
        let mut pb = PlayerBoard::new();
        pb.place_ships(fleet.iter().map(|s| (*s).to_owned()).collect())
            .expect("a legal fleet");
        pb.get_board().0.clone()
    }

    /// What the client sends: `borsh(Vec<u8>)` of the cells.
    fn board_bytes(cells: &[u8]) -> Vec<u8> {
        calimero_sdk::borsh::to_vec(&cells.to_vec()).expect("borsh")
    }

    /// What the client files: hex of `SHA256(borsh(board) || salt)`.
    fn commitment(cells: &[u8], salt: &[u8; 16]) -> String {
        hex_encode(&compute_commitment(&board_bytes(cells), salt))
    }

    /// A match created by the host's default account (Alice, player 1)
    /// against Bob. Returns the host and Alice's account.
    fn game() -> (TestHost<GameState>, [u8; 32]) {
        let app = TestHost::new(|| {
            GameState::init(
                hex::encode(ALICE_DEVICE),
                hex::encode(BOB_DEVICE),
                hex::encode(BOB),
                // No lobby: `TestHost` cannot dispatch the result xcall.
                None,
                MATCH.to_owned(),
            )
        });
        let alice = app.account_id();
        (app, alice)
    }

    fn placed() -> (TestHost<GameState>, [u8; 32]) {
        let (mut app, alice) = game();
        app.call_as_account(alice, ALICE_DEVICE, |s| {
            s.commit_board(MATCH, commitment(&board(&ALICE_FLEET), &ALICE_SALT))
        })
        .expect("alice commits");
        app.call_as_account(BOB, BOB_DEVICE, |s| {
            s.commit_board(MATCH, commitment(&board(&BOB_FLEET), &BOB_SALT))
        })
        .expect("bob commits");
        (app, alice)
    }

    fn shoot(app: &mut TestHost<GameState>, account: [u8; 32], device: [u8; 32], x: u8, y: u8) {
        app.call_as_account(account, device, |s| s.propose_shot(MATCH, x, y))
            .unwrap_or_else(|e| panic!("shot ({x},{y}): {e:?}"));
    }

    /// The pending shot, as the client reads it.
    fn pending(app: &TestHost<GameState>) -> PendingShotView {
        app.view(|s| s.get_match_state(MATCH))
            .expect("state")
            .pending_shot
            .expect("a pending shot")
    }

    /// Answer the pending shot the way an honest client does: from the
    /// fleet on the device.
    fn answer(
        app: &mut TestHost<GameState>,
        account: [u8; 32],
        device: [u8; 32],
        fleet: &[&str],
    ) -> String {
        let shot = pending(app);
        let hit = cells(fleet).contains(&(shot.x, shot.y));
        app.call_as_account(account, device, |s| {
            s.acknowledge_shot(MATCH, shot.shot_id, hit)
        })
        .expect("answer")
    }

    fn reveal(
        app: &mut TestHost<GameState>,
        account: [u8; 32],
        device: [u8; 32],
        fleet: &[&str],
        salt: [u8; 16],
    ) -> app::Result<()> {
        let bytes = board_bytes(&board(fleet));
        app.call_as_account(account, device, |s| s.reveal_board(MATCH, bytes, salt))
    }

    fn standing(app: &TestHost<GameState>) -> Standing {
        app.view(|s| s.derive()).expect("derive").standing
    }

    fn state(app: &TestHost<GameState>) -> MatchStateView {
        app.view(|s| s.get_match_state(MATCH)).expect("state")
    }

    /// Alice sinks Bob's fleet, both answering honestly, up to the answer
    /// that ends it on the answers alone.
    fn play_to_the_end(app: &mut TestHost<GameState>, alice: [u8; 32]) {
        let targets = cells(&BOB_FLEET);
        let water = cells(&[
            "5,1;6,1;7,1;8,1;9,1",
            "5,3;6,3;7,3;8,3;9,3",
            "5,5;6,5;7,5;8,5;9,5",
            "5,7",
        ]);
        for (i, &(x, y)) in targets.iter().enumerate() {
            shoot(app, alice, ALICE_DEVICE, x, y);
            assert_eq!(answer(app, BOB, BOB_DEVICE, &BOB_FLEET), "hit");
            if i + 1 == targets.len() {
                break;
            }
            let (wx, wy) = water[i];
            shoot(app, BOB, BOB_DEVICE, wx, wy);
            assert_eq!(answer(app, alice, ALICE_DEVICE, &ALICE_FLEET), "miss");
        }
    }

    #[test]
    fn is_ship_cell_identifies_ship_sentinel() {
        assert!(is_ship_cell(Cell::Ship.to_u8()));
        assert!(!is_ship_cell(Cell::Empty.to_u8()));
        assert!(!is_ship_cell(Cell::Hit.to_u8()));
        assert!(!is_ship_cell(Cell::Miss.to_u8()));
        assert!(!is_ship_cell(Cell::Pending.to_u8()));
    }

    #[test]
    fn compute_commitment_matches_manual_sha256() {
        let board_bytes = calimero_sdk::borsh::to_vec(&vec![1u8, 0, 0, 1u8]).unwrap();
        let salt = [9u8; 16];
        let mut h = Sha256::new();
        h.update(&board_bytes);
        h.update(salt);
        let expected: [u8; 32] = h.finalize().into();
        assert_eq!(compute_commitment(&board_bytes, &salt), expected);
    }

    /// The vector the client test (`lib/commitment.test.ts`) pins to: the
    /// borsh framing is a 4-byte little-endian length, and the salt follows
    /// the bytes. A client that frames differently commits to a board it can
    /// never reveal.
    #[test]
    fn commitment_vector_shared_with_the_client() {
        let cells = board(&ALICE_FLEET);
        let bytes = board_bytes(&cells);
        assert_eq!(&bytes[..4], &100u32.to_le_bytes());
        assert_eq!(&bytes[4..], &cells[..]);
        assert_eq!(
            commitment(&cells, &ALICE_SALT),
            "37188894d025229c47a83365463dbc5e15d7a267aa13ef63f4d963b0d03def4f"
        );
    }

    #[test]
    fn hex_encode_produces_64_char_lowercase() {
        let mut bytes = [0u8; 32];
        bytes[0] = 0xAB;
        bytes[31] = 0xCD;
        let s = hex_encode(&bytes);
        assert_eq!(s.len(), 64);
        assert!(s.starts_with("ab"));
        assert!(s.ends_with("cd"));
    }

    #[test]
    fn init_freezes_who_plays_and_which_match_this_is() {
        let (app, alice) = game();
        let config = app.view(|s| s.config.get().cloned()).expect("config");
        assert_eq!(config.match_id.as_deref(), Some(MATCH));
        assert_eq!(config.players[0].key, PublicKey(ALICE_DEVICE));
        assert_eq!(
            config.players[0].account, alice,
            "player 1 is whoever created it"
        );
        assert_eq!(config.players[1].account, BOB);
        assert_eq!(
            app.view(|s| s.get_current_turn()).expect("turn"),
            Some(hex::encode(ALICE_DEVICE))
        );
    }

    #[test]
    fn an_init_without_both_players_starts_no_match() {
        let app =
            TestHost::new(|| GameState::init("".into(), "".into(), "".into(), None, "".into()));
        assert!(app.view(|s| s.get_active_match_id()).expect("id").is_none());
        assert!(app.view(|s| s.get_current_turn()).expect("turn").is_none());
    }

    #[test]
    fn a_commitment_is_the_only_thing_stored_about_a_board() {
        let (mut app, alice) = game();
        assert!(state(&app).committed.is_empty());
        app.call_as_account(alice, ALICE_DEVICE, |s| {
            s.commit_board(MATCH, commitment(&board(&ALICE_FLEET), &ALICE_SALT))
        })
        .expect("alice commits");
        assert_eq!(state(&app).committed, vec![hex::encode(ALICE_DEVICE)]);
        // Nothing but 64 hex characters is a commitment.
        assert!(app
            .call_as_account(BOB, BOB_DEVICE, |s| s.commit_board(MATCH, "abc".into()))
            .is_err());
        assert!(app
            .call_as_account(BOB, BOB_DEVICE, |s| s.commit_board(MATCH, "zz".repeat(32)))
            .is_err());
        assert_eq!(state(&app).committed.len(), 1);
    }

    #[test]
    fn a_shot_is_answered_and_the_turn_passes() {
        let (mut app, alice) = placed();
        // Not Bob's turn, and not anyone's who is not playing.
        assert!(app
            .call_as_account(BOB, BOB_DEVICE, |s| s.propose_shot(MATCH, 0, 0))
            .is_err());
        assert!(app
            .call_as_account(CAROL, CAROL, |s| s.propose_shot(MATCH, 8, 0))
            .is_err());

        shoot(&mut app, alice, ALICE_DEVICE, 8, 0);
        assert!(
            app.call_as_account(alice, ALICE_DEVICE, |s| s.propose_shot(MATCH, 9, 0))
                .is_err(),
            "one shot at a time"
        );
        let shot = pending(&app);
        assert_eq!((shot.shot_id, shot.x, shot.y), (0, 8, 0));
        assert_eq!(shot.target, hex::encode(BOB_DEVICE));
        assert_eq!(answer(&mut app, BOB, BOB_DEVICE, &BOB_FLEET), "hit");
        assert_eq!(
            app.view(|s| s.get_current_turn()).expect("turn"),
            Some(hex::encode(BOB_DEVICE))
        );
        assert!(state(&app).pending_shot.is_none());
        app.set_account(alice);
        let shots = app.view(|s| s.get_shots(MATCH)).expect("shots");
        assert_eq!(Cell::from_u8(shots.shots[8]), Cell::Hit);
        app.set_account(BOB);
        let incoming = app.view(|s| s.get_incoming_shots(MATCH)).expect("incoming");
        assert_eq!(Cell::from_u8(incoming.shots[8]), Cell::Hit);
        assert!(app
            .view(|s| s.get_shots(MATCH))
            .expect("shots")
            .shots
            .iter()
            .all(|&c| c == 0));
    }

    #[test]
    fn only_the_target_answers_and_only_the_pending_shot() {
        let (mut app, alice) = placed();
        assert!(
            app.call_as_account(BOB, BOB_DEVICE, |s| s.acknowledge_shot(MATCH, 0, true))
                .is_err(),
            "nothing to answer yet"
        );
        shoot(&mut app, alice, ALICE_DEVICE, 8, 0);
        assert!(
            app.call_as_account(alice, ALICE_DEVICE, |s| s.acknowledge_shot(MATCH, 0, true))
                .is_err(),
            "the shooter does not answer their own shot"
        );
        assert!(
            app.call_as_account(BOB, BOB_DEVICE, |s| s.acknowledge_shot(MATCH, 1, true))
                .is_err(),
            "an answer names the shot it is for"
        );
        assert!(state(&app).pending_shot.is_some());
        assert_eq!(answer(&mut app, BOB, BOB_DEVICE, &BOB_FLEET), "hit");
        assert!(
            app.call_as_account(BOB, BOB_DEVICE, |s| s.acknowledge_shot(MATCH, 0, false))
                .is_err(),
            "an answered shot is not answered again"
        );
    }

    #[test]
    fn rows_filed_under_a_players_name_by_someone_else_are_ignored() {
        let (mut app, alice) = placed();
        let alice_hex = hex::encode(alice);
        // Carol files a shot as Alice, and an answer as Bob. Neither is
        // stamped with the account its key names.
        app.call_as_account(CAROL, CAROL, |s| {
            s.shots
                .insert(turn_key(&alice_hex, 0, 1), Shot { x: 8, y: 0 })
                .expect("her own row");
            s.answers
                .insert(turn_key(&hex::encode(BOB), 0, 1), Answer { hit: true })
                .expect("her own row");
        });
        let derived = app.view(|s| s.derive()).expect("derive");
        assert!(derived.turns.is_empty());
        assert_eq!(derived.shooter, 0);
    }

    #[test]
    fn a_shot_or_answer_cannot_be_rewritten_even_by_its_author() {
        let (mut app, alice) = placed();
        shoot(&mut app, alice, ALICE_DEVICE, 8, 0);
        answer(&mut app, BOB, BOB_DEVICE, &BOB_FLEET);
        let key = app.view(|s| {
            s.answers
                .prefix(format!("{}/", hex::encode(BOB)).as_bytes())
                .expect("answers")
                .next()
                .expect("bob's answer")
                .0
        });
        // `WriteOnce` offers no update or remove, and an insert over the key
        // is refused for its owner too; every node enforces the same.
        let rewritten = app.call_as_account(BOB, BOB_DEVICE, |s| {
            s.answers.insert(key.clone(), Answer { hit: false })
        });
        assert!(rewritten.is_err());
        let derived = app.view(|s| s.derive()).expect("derive");
        assert_eq!(derived.turns[0].hit, Some(true));
    }

    #[test]
    fn a_second_different_answer_is_equivocation_and_loses() {
        let (mut app, alice) = placed();
        shoot(&mut app, alice, ALICE_DEVICE, 8, 0);
        answer(&mut app, BOB, BOB_DEVICE, &BOB_FLEET);
        // Bob files a second answer to the same shot, a miss this time.
        app.call_as_account(BOB, BOB_DEVICE, |s| {
            s.answers
                .insert(turn_key(&hex::encode(BOB), 0, 1), Answer { hit: false })
                .expect("his own row");
        });
        let derived = app.view(|s| s.derive()).expect("derive");
        assert_eq!(derived.ended, Some((1, "equivocation")));
        assert!(app.view(|s| s.get_current_turn()).expect("turn").is_none());
        assert!(app
            .call_as_account(alice, ALICE_DEVICE, |s| s.propose_shot(MATCH, 9, 0))
            .is_err());
        let view = state(&app);
        assert_eq!(view.standing, "awaiting_reveal");
        assert_eq!(view.ended_by.as_deref(), Some("equivocation"));
        assert_eq!(view.loser, Some(hex::encode(BOB_DEVICE)));
    }

    #[test]
    fn a_second_commitment_is_refused_and_a_forged_one_loses() {
        let (mut app, alice) = placed();
        let again = commitment(&board(&ALICE_FLEET), &[1u8; 16]);
        assert!(app
            .call_as_account(alice, ALICE_DEVICE, |s| s.commit_board(MATCH, again))
            .is_err());
        // Around the contract: a second, different commitment, to open
        // whichever board suits at the end. Two is equivocation.
        app.call_as_account(alice, ALICE_DEVICE, |s| {
            s.commitments
                .insert(format!("{}/1", hex::encode(alice)), [7u8; 32])
                .expect("her own row");
        });
        assert_eq!(
            app.view(|s| s.derive()).expect("derive").ended,
            Some((0, "equivocation"))
        );
    }

    #[test]
    fn a_board_is_not_revealed_while_the_match_is_on() {
        let (mut app, alice) = placed();
        assert!(reveal(&mut app, alice, ALICE_DEVICE, &ALICE_FLEET, ALICE_SALT).is_err());
        assert!(state(&app).revealed.is_empty());
    }

    #[test]
    fn sinking_the_fleet_wins_once_the_winners_board_passes_the_audit() {
        let (mut app, alice) = placed();
        play_to_the_end(&mut app, alice);
        // Over on the answers; no board has been opened yet, so the win is
        // not a win yet — and the client is told whose boards are missing.
        assert_eq!(standing(&app), Standing::AwaitingReveal);
        assert!(app.view(|s| s.get_winner()).expect("winner").is_none());
        let view = state(&app);
        assert_eq!(view.standing, "awaiting_reveal");
        assert_eq!(view.ended_by.as_deref(), Some("sunk"));
        assert!(view.revealed.is_empty());

        reveal(&mut app, BOB, BOB_DEVICE, &BOB_FLEET, BOB_SALT).expect("bob reveals");
        assert_eq!(standing(&app), Standing::AwaitingReveal);
        reveal(&mut app, alice, ALICE_DEVICE, &ALICE_FLEET, ALICE_SALT).expect("alice reveals");
        assert_eq!(standing(&app), Standing::Won { winner: 0 });
        assert_eq!(
            app.view(|s| s.get_winner()).expect("winner"),
            Some(hex::encode(ALICE_DEVICE))
        );
        let view = state(&app);
        assert_eq!(view.standing, "won");
        assert_eq!(view.winner, Some(hex::encode(ALICE_DEVICE)));
        assert_eq!(view.revealed.len(), 2);
        assert!(view.audit_failed.is_empty());
        assert!(app
            .call_as_account(BOB, BOB_DEVICE, |s| s.propose_shot(MATCH, 0, 0))
            .is_err());
    }

    #[test]
    fn the_winner_alone_revealing_decides_it() {
        // The loser's reveal is not needed for the winner to win — only the
        // winner's board is audited for the win to count.
        let (mut app, alice) = placed();
        play_to_the_end(&mut app, alice);
        reveal(&mut app, alice, ALICE_DEVICE, &ALICE_FLEET, ALICE_SALT).expect("alice reveals");
        assert_eq!(standing(&app), Standing::Won { winner: 0 });
    }

    #[test]
    fn a_reveal_that_does_not_match_the_commitment_is_refused() {
        let (mut app, alice) = placed();
        play_to_the_end(&mut app, alice);
        // The right board under the wrong salt, and the wrong board under
        // the right salt: neither hashes to what Alice committed to.
        assert!(reveal(&mut app, alice, ALICE_DEVICE, &ALICE_FLEET, [0u8; 16]).is_err());
        assert!(reveal(&mut app, alice, ALICE_DEVICE, &BOB_FLEET, ALICE_SALT).is_err());
        assert!(state(&app).revealed.is_empty());
        assert_eq!(standing(&app), Standing::AwaitingReveal);
        // The real pair still goes through.
        reveal(&mut app, alice, ALICE_DEVICE, &ALICE_FLEET, ALICE_SALT).expect("alice reveals");
        assert_eq!(standing(&app), Standing::Won { winner: 0 });
    }

    #[test]
    fn a_defender_who_lied_about_a_hit_is_caught_at_the_reveal_and_loses() {
        // Bob's client answers Alice's first shot — a hit on his destroyer —
        // with "miss", through the API, then goes on to sink Alice's fleet.
        // Every reader replays his answers against the board he reveals, and
        // the lie costs him the win.
        let (mut app, alice) = placed();
        shoot(&mut app, alice, ALICE_DEVICE, 8, 0);
        let shot = pending(&app);
        assert_eq!(
            app.call_as_account(BOB, BOB_DEVICE, |s| s.acknowledge_shot(
                MATCH,
                shot.shot_id,
                false
            ))
            .expect("bob lies"),
            "miss"
        );
        let water = bob_water();
        for (i, (x, y)) in cells(&ALICE_FLEET).into_iter().enumerate() {
            shoot(&mut app, BOB, BOB_DEVICE, x, y);
            assert_eq!(answer(&mut app, alice, ALICE_DEVICE, &ALICE_FLEET), "hit");
            if i + 1 < 17 {
                let (wx, wy) = water[i];
                shoot(&mut app, alice, ALICE_DEVICE, wx, wy);
                assert_eq!(answer(&mut app, BOB, BOB_DEVICE, &BOB_FLEET), "miss");
            }
        }
        // Alice's last answer ended it, against her.
        let view = state(&app);
        assert_eq!(view.standing, "awaiting_reveal");
        assert_eq!(view.loser, Some(hex::encode(ALICE_DEVICE)));

        reveal(&mut app, alice, ALICE_DEVICE, &ALICE_FLEET, ALICE_SALT).expect("alice reveals");
        assert_eq!(
            standing(&app),
            Standing::AwaitingReveal,
            "bob's board decides it"
        );
        // Bob reveals the board he actually committed to — the one with a
        // ship at (8,0) — and the replay finds the answer that does not fit.
        reveal(&mut app, BOB, BOB_DEVICE, &BOB_FLEET, BOB_SALT).expect("bob reveals");
        let view = state(&app);
        assert_eq!(view.audit_failed, vec![hex::encode(BOB_DEVICE)]);
        assert_eq!(view.standing, "won");
        assert_eq!(view.winner, Some(hex::encode(ALICE_DEVICE)));
        assert_eq!(standing(&app), Standing::Won { winner: 0 });
    }

    #[test]
    fn a_match_both_players_cheated_in_is_void() {
        // Bob answers "miss" to a hit on his destroyer; Alice answers "hit"
        // to a shot into open water. Bob then sinks Alice's fleet — 16 real
        // hits plus the one she invented end it against her. Both reveal the
        // honest boards they committed to, both fail the replay: nobody wins.
        let (mut app, alice) = placed();
        shoot(&mut app, alice, ALICE_DEVICE, 8, 0);
        let shot = pending(&app);
        app.call_as_account(BOB, BOB_DEVICE, |s| {
            s.acknowledge_shot(MATCH, shot.shot_id, false)
        })
        .expect("bob lies");
        shoot(&mut app, BOB, BOB_DEVICE, 5, 5);
        let shot = pending(&app);
        app.call_as_account(alice, ALICE_DEVICE, |s| {
            s.acknowledge_shot(MATCH, shot.shot_id, true)
        })
        .expect("alice lies");
        let water = bob_water();
        for (i, (x, y)) in cells(&ALICE_FLEET).into_iter().take(16).enumerate() {
            let (wx, wy) = water[i];
            shoot(&mut app, alice, ALICE_DEVICE, wx, wy);
            assert_eq!(answer(&mut app, BOB, BOB_DEVICE, &BOB_FLEET), "miss");
            shoot(&mut app, BOB, BOB_DEVICE, x, y);
            assert_eq!(answer(&mut app, alice, ALICE_DEVICE, &ALICE_FLEET), "hit");
        }
        let view = state(&app);
        assert_eq!(view.standing, "awaiting_reveal");
        assert_eq!(view.ended_by.as_deref(), Some("sunk"));
        assert_eq!(view.loser, Some(hex::encode(ALICE_DEVICE)));
        reveal(&mut app, alice, ALICE_DEVICE, &ALICE_FLEET, ALICE_SALT).expect("alice reveals");
        reveal(&mut app, BOB, BOB_DEVICE, &BOB_FLEET, BOB_SALT).expect("bob reveals");
        let view = state(&app);
        assert_eq!(view.standing, "void");
        assert_eq!(view.audit_failed.len(), 2);
        assert!(view.winner.is_none());
        assert_eq!(standing(&app), Standing::Void);
    }

    #[test]
    fn a_defender_who_never_admits_a_hit_runs_out_of_misses() {
        // A fleet is 17 cells, so on a 100-cell board the 84th miss is a lie
        // no reveal is needed to see. Bob's client answers "miss" to
        // everything; Alice keeps shooting every cell.
        let (mut app, alice) = placed();
        let alice_ships = cells(&ALICE_FLEET);
        let mut alice_water = (0..10u8)
            .flat_map(|y| (0..10u8).map(move |x| (x, y)))
            .filter(|c| !alice_ships.contains(c));
        'game: for y in 0..10u8 {
            for x in 0..10u8 {
                shoot(&mut app, alice, ALICE_DEVICE, x, y);
                let shot = pending(&app);
                app.call_as_account(BOB, BOB_DEVICE, |s| {
                    s.acknowledge_shot(MATCH, shot.shot_id, false)
                })
                .expect("bob answers");
                if app.view(|s| s.derive()).expect("derive").ended.is_some() {
                    break 'game;
                }
                let (wx, wy) = alice_water.next().expect("water left");
                shoot(&mut app, BOB, BOB_DEVICE, wx, wy);
                answer(&mut app, alice, ALICE_DEVICE, &ALICE_FLEET);
            }
        }
        let derived = app.view(|s| s.derive()).expect("derive");
        assert_eq!(derived.ended, Some((1, "impossible_misses")));
        assert_eq!(state(&app).ended_by.as_deref(), Some("impossible_misses"));
    }
}
