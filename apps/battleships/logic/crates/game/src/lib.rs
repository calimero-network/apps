//! Game service — live match gameplay with private boards.
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
//! Each board stays in node-private storage and only its SHA-256 commitment is
//! published. The defender answers every shot, so an answer is a claim — and
//! at match end BOTH players publish `(board, salt)`. Every reader then checks
//! the reveal against the commitment, checks it is a legal fleet, and replays
//! every answer its owner gave against it. The declared winner must pass that
//! audit to win; a winner who lied loses to the player they lied to. And a
//! defender who answers "miss" forever cannot stall the game: a fleet is 17
//! cells, so an 84th miss on a 100-cell board is a lie on its face.

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
use players::{PlayerBoard, PrivateBoards};

/// Every cell of the opponent's board, once each: the most shots one player
/// can fire, so twice that bounds a match.
const MAX_TURNS: usize = 2 * (BOARD_SIZE as usize) * (BOARD_SIZE as usize);

/// The most misses a defender can truthfully report: every cell that is not
/// part of the fleet.
const MAX_MISSES: u32 = (BOARD_SIZE as u32) * (BOARD_SIZE as u32) - FLEET_CELLS;

// ---------------------------------------------------------------------------
// API response types
// ---------------------------------------------------------------------------

#[derive(AbiType, Debug, Clone, BorshSerialize, BorshDeserialize, Serialize, Deserialize)]
#[borsh(crate = "calimero_sdk::borsh")]
#[serde(crate = "calimero_sdk::serde")]
pub struct OwnBoardView {
    pub size: u8,
    pub board: Vec<u8>,
}

#[derive(AbiType, Debug, Clone, BorshSerialize, BorshDeserialize, Serialize, Deserialize)]
#[borsh(crate = "calimero_sdk::borsh")]
#[serde(crate = "calimero_sdk::serde")]
pub struct ShotsView {
    pub size: u8,
    pub shots: Vec<u8>,
}

/// Export payload for cross-device durability. Defined locally (not re-used from
/// `battleships-types`) because the wasm-abi emitter resolves types by their
/// local path and would otherwise not find it.
#[derive(AbiType, Debug, Clone, BorshSerialize, BorshDeserialize, Serialize, Deserialize)]
#[borsh(crate = "calimero_sdk::borsh")]
#[serde(crate = "calimero_sdk::serde")]
pub struct ExportedSeed {
    pub board_bytes: Vec<u8>,
    pub salt: [u8; 16],
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

    pub fn place_ships(&mut self, match_id: &str, ships: Vec<String>) -> app::Result<()> {
        let role = self.caller_role(match_id)?;
        let derived = self.derive()?;
        if derived.standing != Standing::Playing {
            app::bail!(GameError::Finished);
        }
        if derived.placed(role) {
            app::bail!(GameError::AlreadyCommitted);
        }

        // Populate the private board (existing validation flow).
        let mut priv_boards = PrivateBoards::private_load_or_default()?;
        let mut priv_mut = priv_boards.as_mut();
        let key = PrivateBoards::key(match_id, &caller_account());
        // `get` hands back a `ValueRef`, so deref out before defaulting — both
        // arms have to be the same owned type.
        let mut pb = priv_mut
            .boards
            .get(&key)?
            .map(|v| (*v).clone())
            .unwrap_or_default();
        pb.place_ships(ships)?;
        // Snapshot the pristine board NOW — `own` will be mutated as shots
        // resolve, but the commitment hash must always match placement state.
        pb.capture_pristine();

        // Generate salt, compute commitment.
        let mut salt = [0u8; 16];
        calimero_sdk::env::random_bytes(&mut salt);
        pb.set_salt(salt);
        let board_bytes = calimero_sdk::borsh::to_vec(&pb.pristine().to_vec())
            .map_err(|e| AppError::msg(format!("serialize board: {e}")))?;
        let commitment = compute_commitment(&board_bytes, &salt);

        // Publish the commitment: written once, by its owner, for good.
        let account = hex::encode(caller_account());
        let row = Self::free_key(&self.commitments, |nonce| format!("{account}/{nonce}"))?;
        self.commitments.insert(row, commitment)?;

        // Persist private board.
        priv_mut.boards.insert(key, pb)?;

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

        app::emit!((
            Event::ShotProposed { id: match_id, x, y },
            "acknowledge_shot_handler"
        ));
        Ok(())
    }

    pub fn acknowledge_shot(&mut self, match_id: &str) -> app::Result<String> {
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
        let (x, y) = (pending.x, pending.y);

        // Resolve against the caller's private board.
        let mut priv_boards = PrivateBoards::private_load_or_default()?;
        let mut priv_mut = priv_boards.as_mut();
        let key = PrivateBoards::key(match_id, &caller_account());
        let mut pb = priv_mut
            .boards
            .get(&key)?
            .map(|v| (*v).clone())
            .ok_or_else(|| AppError::from(GameError::Invalid("target board unavailable".into())))?;
        let is_hit = pb.get_board().get(BOARD_SIZE, x, y) == Cell::Ship;
        let resolved = if is_hit { Cell::Hit } else { Cell::Miss };
        pb.get_board_mut().set(BOARD_SIZE, x, y, resolved);
        if is_hit {
            pb.decrement_ships();
        }
        priv_mut.boards.insert(key, pb)?;
        drop(priv_mut);
        drop(priv_boards);

        let turn = derived.turns.len() - 1;
        let account = hex::encode(caller_account());
        let row = Self::free_key(&self.answers, |nonce| turn_key(&account, turn, nonce))?;
        self.answers.insert(row, Answer { hit: is_hit })?;

        let result_str = if is_hit { "hit" } else { "miss" };
        app::emit!(Event::ShotFired {
            id: match_id,
            x,
            y,
            result: result_str,
        });

        // The answers now say the match is over: open this board, and ask the
        // other player's node to open theirs. Neither result counts until the
        // winner's board has been audited by every reader.
        if self.derive()?.ended.is_some() {
            self.publish_reveal(match_id, role)?;
            app::emit!((
                Event::RevealRequested { id: match_id },
                "reveal_board_handler"
            ));
            self.announce_if_decided(match_id)?;
        }
        Ok(result_str.to_string())
    }

    /// Publish the caller's board for every reader to audit. Only once the
    /// match is over: a board opened mid-game is a board handed to the
    /// opponent.
    pub fn reveal_board(&mut self, match_id: &str) -> app::Result<()> {
        let role = self.caller_role(match_id)?;
        if self.derive()?.ended.is_none() {
            app::bail!(GameError::Invalid(
                "the match is still being played — a board is revealed when it ends".into()
            ));
        }
        self.publish_reveal(match_id, role)?;
        self.announce_if_decided(match_id)
    }

    pub fn export_board_seed(&self, match_id: &str) -> app::Result<ExportedSeed> {
        let priv_boards = PrivateBoards::private_load_or_default()?;
        let pb = priv_boards
            .boards
            .get(&PrivateBoards::key(match_id, &caller_account()))?
            .ok_or_else(|| AppError::from(GameError::BoardNotFound))?;
        // Export the pristine-board snapshot so the commitment recomputation
        // on re-import always matches regardless of mid-game mutations.
        let pristine = pb.pristine().to_vec();
        let board_bytes = calimero_sdk::borsh::to_vec(&pristine)
            .map_err(|e| AppError::msg(format!("serialize board: {e}")))?;
        Ok(ExportedSeed {
            board_bytes,
            salt: *pb.salt(),
        })
    }

    pub fn import_board_seed(
        &mut self,
        match_id: &str,
        board_bytes: Vec<u8>,
        salt: [u8; 16],
    ) -> app::Result<()> {
        let role = self.caller_role(match_id)?;
        let Some(expected_hash) = self.derive()?.commitment[role] else {
            app::bail!(GameError::Invalid("no commitment for caller".into()));
        };
        if !audit::verify_commitment(&board_bytes, &salt, &expected_hash) {
            app::bail!(GameError::CommitmentMismatch);
        }
        let board: board::Board = calimero_sdk::borsh::from_slice(&board_bytes)
            .map_err(|e| AppError::msg(format!("deserialize board: {e}")))?;
        let ship_count = board.0.iter().filter(|&&c| is_ship_cell(c)).count() as u64;
        let mut priv_boards = PrivateBoards::private_load_or_default()?;
        let mut priv_mut = priv_boards.as_mut();
        priv_mut.boards.insert(
            PrivateBoards::key(match_id, &caller_account()),
            PlayerBoard::new_with_salt(board, ship_count, true, salt),
        )?;
        Ok(())
    }

    pub fn get_own_board(&self, match_id: &str) -> app::Result<OwnBoardView> {
        let role = self.caller_role(match_id)?;
        let priv_boards = PrivateBoards::private_load_or_default()?;
        let pb = priv_boards
            .boards
            .get(&PrivateBoards::key(match_id, &caller_account()))?
            .ok_or_else(|| AppError::from(GameError::NotFound(match_id.to_string())))?;
        let mut board = pb.get_board().0.clone();
        if let Some(p) = self.derive()?.pending() {
            if p.shooter != role {
                let idx = (p.y as usize) * (BOARD_SIZE as usize) + (p.x as usize);
                if idx < board.len() {
                    board[idx] = Cell::Pending.to_u8();
                }
            }
        }
        Ok(OwnBoardView {
            size: BOARD_SIZE,
            board,
        })
    }

    pub fn get_shots(&self, match_id: &str) -> app::Result<ShotsView> {
        let role = self.caller_role(match_id)?;
        let mut shots = vec![0u8; (BOARD_SIZE as usize) * (BOARD_SIZE as usize)];
        for turn in self.derive()?.turns.iter().filter(|t| t.shooter == role) {
            let cell = match turn.hit {
                None => Cell::Pending,
                Some(true) => Cell::Hit,
                Some(false) => Cell::Miss,
            };
            shots[(turn.y as usize) * (BOARD_SIZE as usize) + (turn.x as usize)] = cell.to_u8();
        }
        Ok(ShotsView {
            size: BOARD_SIZE,
            shots,
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

    #[allow(unused_variables)]
    pub fn acknowledge_shot_handler(&mut self, id: &str, x: u8, y: u8) -> app::Result<()> {
        self.acknowledge_shot(id)?;
        Ok(())
    }

    /// Runs on the other player's node when the answers end the match, so
    /// both boards are opened without either player having to ask.
    pub fn reveal_board_handler(&mut self, id: &str) -> app::Result<()> {
        self.reveal_board(id)
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

    /// Open the caller's own board — once — and report how its audit went.
    fn publish_reveal(&mut self, match_id: &str, role: usize) -> app::Result<()> {
        let derived = self.derive()?;
        let Some(commitment) = derived.commitment[role] else {
            app::bail!(GameError::Invalid("no commitment for caller".into()));
        };
        let priv_boards = PrivateBoards::private_load_or_default()?;
        let pb = priv_boards
            .boards
            .get(&PrivateBoards::key(match_id, &caller_account()))?
            .ok_or_else(|| AppError::from(GameError::BoardNotFound))?;
        let board_bytes = calimero_sdk::borsh::to_vec(&pb.pristine().to_vec())
            .map_err(|e| AppError::msg(format!("serialize board: {e}")))?;
        let salt = *pb.salt();
        drop(priv_boards);
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

/// Helper used by the audit routine and seed import.
pub fn is_ship_cell(value: u8) -> bool {
    Cell::from_u8(value) == Cell::Ship
}

#[cfg(test)]
mod tests {
    use calimero_sdk::testing::TestHost;

    use super::*;

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
        let fleet = |f: [&str; 5]| f.iter().map(|s| (*s).to_owned()).collect::<Vec<_>>();
        app.call_as_account(alice, ALICE_DEVICE, |s| {
            s.place_ships(MATCH, fleet(ALICE_FLEET))
        })
        .expect("alice places");
        app.call_as_account(BOB, BOB_DEVICE, |s| s.place_ships(MATCH, fleet(BOB_FLEET)))
            .expect("bob places");
        (app, alice)
    }

    fn shoot(app: &mut TestHost<GameState>, account: [u8; 32], device: [u8; 32], x: u8, y: u8) {
        app.call_as_account(account, device, |s| s.propose_shot(MATCH, x, y))
            .unwrap_or_else(|e| panic!("shot ({x},{y}): {e:?}"));
    }

    fn answer(app: &mut TestHost<GameState>, account: [u8; 32], device: [u8; 32]) -> String {
        app.call_as_account(account, device, |s| s.acknowledge_shot(MATCH))
            .expect("answer")
    }

    fn standing(app: &TestHost<GameState>) -> Standing {
        app.view(|s| s.derive()).expect("derive").standing
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
        assert_eq!(answer(&mut app, BOB, BOB_DEVICE), "hit");
        assert_eq!(
            app.view(|s| s.get_current_turn()).expect("turn"),
            Some(hex::encode(BOB_DEVICE))
        );
        app.set_account(alice);
        let shots = app.view(|s| s.get_shots(MATCH)).expect("shots");
        assert_eq!(Cell::from_u8(shots.shots[8]), Cell::Hit);
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
        answer(&mut app, BOB, BOB_DEVICE);
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
        answer(&mut app, BOB, BOB_DEVICE);
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
    }

    #[test]
    fn a_second_commitment_is_refused_and_a_forged_one_loses() {
        let (mut app, alice) = placed();
        let again = ALICE_FLEET.iter().map(|s| (*s).to_owned()).collect();
        assert!(app
            .call_as_account(alice, ALICE_DEVICE, |s| s.place_ships(MATCH, again))
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
        assert!(app
            .call_as_account(alice, ALICE_DEVICE, |s| s.reveal_board(MATCH))
            .is_err());
    }

    #[test]
    fn sinking_the_fleet_wins_once_the_winners_board_passes_the_audit() {
        let (mut app, alice) = placed();
        let targets = cells(&BOB_FLEET);
        let water = cells(&[
            "5,1;6,1;7,1;8,1;9,1",
            "5,3;6,3;7,3;8,3;9,3",
            "5,5;6,5;7,5;8,5;9,5",
            "5,7",
        ]);
        for (i, &(x, y)) in targets.iter().enumerate() {
            shoot(&mut app, alice, ALICE_DEVICE, x, y);
            assert_eq!(answer(&mut app, BOB, BOB_DEVICE), "hit");
            if i + 1 == targets.len() {
                break;
            }
            let (wx, wy) = water[i];
            shoot(&mut app, BOB, BOB_DEVICE, wx, wy);
            assert_eq!(answer(&mut app, alice, ALICE_DEVICE), "miss");
        }
        // Bob's last answer opened his board; Alice's has not been opened, so
        // her win is not a win yet.
        assert_eq!(standing(&app), Standing::AwaitingReveal);
        assert!(app.view(|s| s.get_winner()).expect("winner").is_none());

        app.call_as_account(alice, ALICE_DEVICE, |s| s.reveal_board(MATCH))
            .expect("alice reveals");
        assert_eq!(standing(&app), Standing::Won { winner: 0 });
        assert_eq!(
            app.view(|s| s.get_winner()).expect("winner"),
            Some(hex::encode(ALICE_DEVICE))
        );
        assert!(app
            .call_as_account(BOB, BOB_DEVICE, |s| s.propose_shot(MATCH, 0, 0))
            .is_err());
    }

    #[test]
    fn a_winner_who_lied_about_a_hit_loses_the_audit_and_the_game() {
        // Bob answers Alice's first shot — a hit — with "miss", written
        // around the contract, then sinks Alice's fleet. Every reader replays
        // his answers against the board he opens, and the lie costs him the
        // win.
        let (mut app, alice) = placed();
        shoot(&mut app, alice, ALICE_DEVICE, 8, 0);
        app.call_as_account(BOB, BOB_DEVICE, |s| {
            s.answers
                .insert(turn_key(&hex::encode(BOB), 0, 1), Answer { hit: false })
                .expect("his own row");
        });
        let water = bob_water();
        for (i, (x, y)) in cells(&ALICE_FLEET).into_iter().enumerate() {
            shoot(&mut app, BOB, BOB_DEVICE, x, y);
            assert_eq!(answer(&mut app, alice, ALICE_DEVICE), "hit");
            if i + 1 < 17 {
                let (wx, wy) = water[i];
                shoot(&mut app, alice, ALICE_DEVICE, wx, wy);
                assert_eq!(answer(&mut app, BOB, BOB_DEVICE), "miss");
            }
        }
        // Alice's last answer ended it and opened her (honest) board.
        assert_eq!(standing(&app), Standing::AwaitingReveal);
        app.call_as_account(BOB, BOB_DEVICE, |s| s.reveal_board(MATCH))
            .expect("bob reveals");
        assert_eq!(standing(&app), Standing::Won { winner: 0 });
    }

    #[test]
    fn a_defender_who_never_admits_a_hit_runs_out_of_misses() {
        // A fleet is 17 cells, so on a 100-cell board the 84th miss is a lie
        // no reveal is needed to see. Bob answers "miss" to everything,
        // around the contract; Alice keeps shooting every cell.
        let (mut app, alice) = placed();
        let bob = hex::encode(BOB);
        let alice_ships = cells(&ALICE_FLEET);
        let mut alice_water = (0..10u8)
            .flat_map(|y| (0..10u8).map(move |x| (x, y)))
            .filter(|c| !alice_ships.contains(c));
        let mut turn = 0;
        'game: for y in 0..10u8 {
            for x in 0..10u8 {
                shoot(&mut app, alice, ALICE_DEVICE, x, y);
                app.call_as_account(BOB, BOB_DEVICE, |s| {
                    s.answers
                        .insert(turn_key(&bob, turn, 1), Answer { hit: false })
                        .expect("his own row");
                });
                turn += 1;
                if app.view(|s| s.derive()).expect("derive").ended.is_some() {
                    break 'game;
                }
                let (wx, wy) = alice_water.next().expect("water left");
                shoot(&mut app, BOB, BOB_DEVICE, wx, wy);
                answer(&mut app, alice, ALICE_DEVICE);
                turn += 1;
            }
        }
        let derived = app.view(|s| s.derive()).expect("derive");
        assert_eq!(derived.ended, Some((1, "impossible_misses")));
    }
}
