//! Mero Kombat — a one-on-one fighting game whose arena is a Calimero context.
//!
//! Two people take the two corners, pick a fighter and fight best-of-three.
//! There is no game server: the contract runs on each player's own node, and
//! every punch, kick and special either of them throws is a TRANSACTION —
//! signed, executed by the contract, stored, and gossiped to the other node.
//! That is the point of the app: a fight is a few hundred transactions a
//! minute between two machines, and the arena shows the count as it happens.
//!
//! ## What is stored, and what is derived
//!
//! **Actions, never health.** `actions` is
//! `WriteOnce<SortedMap<"<account>/<match>/<round>/<nonce>", Action>>`. Health
//! bars, round wins, the match winner and "flawless victory" are all worked out
//! by the reader from that list, so they cannot disagree with it and nobody
//! writes "I won" anywhere. A stored HP value could not converge: two nodes
//! subtracting concurrently would merge into a number no fight produced.
//!
//! **Rounds are counted, not written.** A round ends when a fighter's damage
//! taken reaches [`MAX_HP`]; the next round is the one after the last decided
//! one. If both fighters land the finishing blow at once — concurrent writes on
//! two nodes — the round is a double knock-out and nobody scores it.
//!
//! **Movement is not here.** Where a fighter stands changes sixty times a
//! second and is worthless a moment later, so it travels over the node's
//! ephemeral presence channel and never touches storage. The contract holds the
//! things that decide the fight.
//!
//! ## Trust
//!
//! The attacker's client decides whether a blow connected — it is the only
//! party that knows where its own fist was. The contract bounds what a claim
//! can be worth (every move has a fixed damage, a blocked one does chip damage
//! only, and a round holds a capped number of blows) and binds every row to its
//! author with core's owner stamp, so a player can only ever hit FOR
//! themselves. It is a game, and the trust model is a game's: a modified client
//! can claim blows it did not land, exactly as it can in any peer-to-peer
//! fighting game, and its own rows are the record that it did.

use std::collections::{BTreeMap, BTreeSet};

use calimero_sdk::abi::AbiType;
use calimero_sdk::borsh::{BorshDeserialize, BorshSerialize};
use calimero_sdk::serde::{Deserialize, Serialize};
use calimero_sdk::{app, env as sdk_env, AccountId, PublicKey};
use calimero_storage::collections::crdt_meta::MergeError;
use calimero_storage::collections::{
    Frozen, Guarded, GuardedEntries, Mergeable as MergeableTrait, Owning, Policy, SortedMap,
    UserStorage, WriteOnce,
};

#[cfg(test)]
mod tests;

/// A player's identity, hex-encoded. See [`MeroKombat::caller`].
type MemberId = String;

/// Every fighter starts each round with this much health.
pub const MAX_HP: u32 = 100;

/// Rounds a fighter has to win to take the match.
pub const ROUNDS_TO_WIN: u32 = 2;

/// Rounds a match can run before it is called a draw. Double knock-outs score
/// for nobody, so without a ceiling a match of perfectly traded blows would
/// never end.
const MAX_ROUNDS: u32 = 9;

/// Matches one arena counts before it stops. A pair who rematch this often
/// have other problems.
const MAX_MATCHES: u32 = 512;

/// Actions one player can write in one round. A real round is a few hundred at
/// most; this is the bound that stops a context growing without limit, and
/// every read walks the current match.
const MAX_ACTIONS_PER_ROUND: usize = 2_000;

/// How many of the current round's blows the view carries, newest first. The
/// client reconciles its optimistic health against these.
const RECENT_HITS: usize = 48;

/// Display names are shown to the other player, so they are bounded and
/// stripped of control characters at the door.
const MAX_NAME_LEN: usize = 24;

/// How long after a write a player still reads as present, in milliseconds.
pub const PRESENCE_TTL_MS: u64 = 30_000;

/// The two corners. `p1` starts on the left.
const SEAT_P1: &str = "p1";
const SEAT_P2: &str = "p2";
const SEATS: [&str; 2] = [SEAT_P1, SEAT_P2];

/// The roster. A fighter is a look and a special move; the damage table is the
/// same for everyone, so picking one is a matter of taste rather than tiering.
pub const FIGHTERS: [&str; 4] = ["kinetic", "cryo", "inferno", "jinzo"];

/// What a move is worth when it connects, before blocking.
///
/// Every move in the game, and the only place damage is defined: the client
/// draws the animation, the contract decides what it cost.
fn damage_of(kind: &str) -> Option<u32> {
    Some(match kind {
        "punch" => 5,
        "kick" => 7,
        "uppercut" => 13,
        "sweep" => 9,
        "air_kick" => 8,
        "special" => 11,
        // Moves that hit nobody by design. Still transactions — a jump is a
        // decision the opponent's node gets to see — but they cannot connect.
        "jump" | "block" => 0,
        _ => return None,
    })
}

/// A blocked blow still chips. Never zero, so turtling is not a strategy.
const CHIP_DAMAGE: u32 = 1;

// ── Stored records ───────────────────────────────────────────────────────────

/// A person's presence row — name, chosen fighter, last sign of life. The one
/// thing a player keeps RE-stating, so it lives in their own [`UserStorage`]
/// slot and resolves to the newest copy.
#[app::mergeable(id = "mero-kombat::Player")]
#[derive(BorshSerialize, BorshDeserialize, Serialize, Deserialize, AbiType, Clone, Debug)]
#[borsh(crate = "calimero_sdk::borsh")]
#[serde(crate = "calimero_sdk::serde")]
pub struct Player {
    pub name: String,
    pub fighter: String,
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

/// One person's claim on one corner, keyed `"<seat>/<account>/<nonce>"`.
#[derive(BorshSerialize, BorshDeserialize, Serialize, Deserialize, AbiType, Clone, Debug)]
#[borsh(crate = "calimero_sdk::borsh")]
#[serde(crate = "calimero_sdk::serde")]
pub struct Seat {
    pub name: String,
    pub claimed_at: u64,
}

/// One thing a fighter did, keyed `"<account>/<match>/<round>/<nonce>"`.
///
/// The match, the round and the author come from the key and the owner stamp.
#[derive(BorshSerialize, BorshDeserialize, Serialize, Deserialize, AbiType, Clone, Debug)]
#[borsh(crate = "calimero_sdk::borsh")]
#[serde(crate = "calimero_sdk::serde")]
pub struct Action {
    /// The client's own sequence number for this action. It is how the
    /// opponent's screen matches a blow it already saw over the fast channel
    /// to the row that makes it count, so nothing is ever subtracted twice.
    pub id: u32,
    /// `punch`, `kick`, `uppercut`, `sweep`, `air_kick`, `special`, `jump`,
    /// `block`.
    pub kind: String,
    /// The attacker says it connected.
    pub hit: bool,
    /// ...and that the defender was guarding when it did.
    pub blocked: bool,
    /// Its author's clock. Display only.
    pub at: u64,
    /// The member the attacker saw in the other corner — how a player's own,
    /// unforgeable rows vouch for who they were fighting, which is what locks
    /// the corners once a fight is under way (see [`MeroKombat::corners`]).
    pub opponent: MemberId,
}

/// A claim that this player started a rematch, keyed `"<account>/<match>/<nonce>"`.
#[derive(BorshSerialize, BorshDeserialize, Serialize, Deserialize, AbiType, Clone, Debug)]
#[borsh(crate = "calimero_sdk::borsh")]
#[serde(crate = "calimero_sdk::serde")]
pub struct MatchRecord {
    pub started_at: u64,
}

// ── Derived state ────────────────────────────────────────────────────────────

#[derive(Clone, Debug, Default)]
struct Holder {
    member: MemberId,
    name: String,
}

/// One blow, as the reader counted it.
#[derive(Clone, Debug)]
struct Blow {
    by: usize,
    id: u32,
    kind: String,
    damage: u32,
    blocked: bool,
    at: u64,
}

/// One match, played out from its rows.
struct Fought {
    index: u32,
    started_at: u64,
    /// `"p1"`, `"p2"` or `"draw"`, one per decided round.
    rounds: Vec<String>,
    /// The round being fought (or the last one, once the match is over).
    round: u32,
    /// Damage each corner has TAKEN this round.
    taken: [u32; 2],
    /// This round's blows that landed, oldest first.
    blows: Vec<Blow>,
    /// Every action written in this match, by both corners.
    actions: u32,
    /// `"p1"`, `"p2"`, `"draw"` — or `""` while it is still being fought.
    winner: String,
    /// The winner took the deciding round without being touched.
    flawless: bool,
}

impl Fought {
    fn finished(&self) -> bool {
        !self.winner.is_empty()
    }

    fn wins(&self, slot: usize) -> u32 {
        self.rounds
            .iter()
            .filter(|r| r.as_str() == SEATS[slot])
            .count() as u32
    }
}

struct Snapshot {
    corners: [Holder; 2],
    /// Every match the arena validly reached, oldest first. Never empty.
    matches: Vec<Fought>,
}

impl Snapshot {
    fn current(&self) -> &Fought {
        // SAFETY: `MeroKombat::snapshot` always fights match 0.
        self.matches.last().expect("match 0 always exists")
    }

    fn slot_of(&self, member: &str) -> Option<usize> {
        if member.is_empty() {
            return None;
        }
        self.corners.iter().position(|h| h.member == member)
    }

    fn seated(&self) -> bool {
        self.corners.iter().all(|h| !h.member.is_empty())
    }
}

// ── Views ────────────────────────────────────────────────────────────────────
//
// Strings and sentinels rather than `Option`s and enums — the ABI flattens an
// `Option<T>` to `T`. And NO serde renames: the ABI emitter reads the Rust
// field names, so the names below are the wire and the generated client at
// once.

#[derive(BorshSerialize, BorshDeserialize, Serialize, Deserialize, AbiType, Clone, Debug)]
#[borsh(crate = "calimero_sdk::borsh")]
#[serde(crate = "calimero_sdk::serde")]
pub struct FighterView {
    /// `p1` or `p2`.
    pub seat: String,
    /// The member in this corner, or `""` when it is empty.
    pub member: MemberId,
    pub name: String,
    /// One of [`FIGHTERS`].
    pub fighter: String,
    /// Health left in the current round.
    pub hp: u32,
    pub rounds_won: u32,
    /// Matches this corner has won at this arena.
    pub matches_won: u32,
    pub online: bool,
}

#[derive(BorshSerialize, BorshDeserialize, Serialize, Deserialize, AbiType, Clone, Debug)]
#[borsh(crate = "calimero_sdk::borsh")]
#[serde(crate = "calimero_sdk::serde")]
pub struct HitView {
    /// The corner that threw it.
    pub by: String,
    /// The thrower's own sequence number (see [`Action::id`]).
    pub id: u32,
    pub kind: String,
    pub damage: u32,
    pub blocked: bool,
    pub at: u64,
}

/// Everything a client needs to draw the arena, in one call — every field
/// derived from the same pass over the rows.
#[derive(BorshSerialize, BorshDeserialize, Serialize, Deserialize, AbiType, Clone, Debug)]
#[borsh(crate = "calimero_sdk::borsh")]
#[serde(crate = "calimero_sdk::serde")]
pub struct ArenaView {
    pub title: String,
    pub created_at: u64,
    /// Index of the match being fought now.
    pub match_index: u32,
    /// Index of the round being fought now (0-based).
    pub round: u32,
    /// `waiting`, `fighting` or `finished`.
    pub status: String,
    /// One entry per decided round of this match: `p1`, `p2` or `draw`.
    pub round_results: Vec<String>,
    /// `p1`, `p2`, `draw`, or `""` while the match is on.
    pub winner: String,
    pub flawless: bool,
    pub p1: FighterView,
    pub p2: FighterView,
    /// The caller, as the contract sees it.
    pub me: MemberId,
    /// `p1`, `p2`, or `""` for a spectator.
    pub my_seat: String,
    /// This round's landed blows, newest first, at most [`RECENT_HITS`].
    pub hits: Vec<HitView>,
    /// Actions written in the current match, both corners.
    pub match_actions: u32,
    /// Every action ever written at this arena — the transaction count.
    pub total_actions: u64,
    pub max_hp: u32,
    pub rounds_to_win: u32,
}

#[derive(BorshSerialize, BorshDeserialize, Serialize, Deserialize, AbiType, Clone, Debug)]
#[borsh(crate = "calimero_sdk::borsh")]
#[serde(crate = "calimero_sdk::serde")]
pub struct MatchSummary {
    pub index: u32,
    pub started_at: u64,
    pub winner: String,
    pub flawless: bool,
    pub rounds: Vec<String>,
    pub actions: u32,
}

// ── Events ───────────────────────────────────────────────────────────────────

/// A nudge, not the truth: every event means "re-read [`MeroKombat::arena`]".
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
    Acted {
        match_index: u32,
        round: u32,
        by: MemberId,
        hit: bool,
    },
    RoundOver {
        match_index: u32,
        round: u32,
        winner: String,
    },
    MatchOver {
        match_index: u32,
        winner: String,
    },
    MatchStarted {
        match_index: u32,
    },
}

// ── State ────────────────────────────────────────────────────────────────────

/// Every map a player writes is owned and every key names its author, so a
/// member can only ever write rows about themselves — and, outside presence,
/// never change or remove one. Core enforces both at apply time.
#[app::state(emits = Event)]
pub struct MeroKombat {
    title: Frozen<String>,
    created_at: Frozen<u64>,
    players: UserStorage<Player>,
    /// `"<seat>/<account>/<nonce>"` -> one person's claim on that corner.
    seat_claims: WriteOnce<SortedMap<String, Seat>>,
    /// `"<seat>/<account>/<claim nonce>/<nonce>"` -> when that claim was given
    /// up. Honoured only for a claimant who never fought here.
    vacated: WriteOnce<SortedMap<String, u64>>,
    /// `"<account>/<match>/<nonce>"` -> a claim that this player started it.
    matches: WriteOnce<SortedMap<String, MatchRecord>>,
    /// `"<account>/<match>/<round>/<nonce>"` -> one thing that player did.
    actions: WriteOnce<SortedMap<String, Action>>,
}

#[app::logic]
impl MeroKombat {
    #[app::init]
    pub fn init(title: String, now: u64) -> MeroKombat {
        app::emit!(Event::Initialized());
        // Match 0 is IMPLICIT — the snapshot counts valid rematches up from
        // zero, so nobody can jump the arena to match 9999.
        MeroKombat {
            title: Frozen::new(clean_name(&title, "Arena")),
            created_at: Frozen::new(now),
            players: UserStorage::new(),
            seat_claims: WriteOnce::new(),
            vacated: WriteOnce::new(),
            matches: WriteOnce::new(),
            actions: WriteOnce::new(),
        }
    }

    // ── identity ────────────────────────────────────────────────────────────

    /// The ACCOUNT, not the device: a corner belongs to a person, so the same
    /// person on a second machine is still the same fighter.
    fn caller_id() -> MemberId {
        String::from(PublicKey::from(sdk_env::account_id()))
    }

    fn owner_id(owner: &[u8; 32]) -> MemberId {
        String::from(PublicKey::from(*owner))
    }

    // ── reading ─────────────────────────────────────────────────────────────

    /// The whole arena in one call — see [`ArenaView`].
    pub fn arena(&self, now: u64) -> app::Result<ArenaView> {
        let snap = self.snapshot()?;
        let fight = snap.current();
        let me = Self::caller_id();
        let my_seat = snap.slot_of(&me).map_or("", |s| SEATS[s]);

        let status = if fight.finished() {
            "finished"
        } else if snap.seated() {
            "fighting"
        } else {
            "waiting"
        };

        let mut hits: Vec<HitView> = fight
            .blows
            .iter()
            .rev()
            .take(RECENT_HITS)
            .map(|b| HitView {
                by: SEATS[b.by].to_owned(),
                id: b.id,
                kind: b.kind.clone(),
                damage: b.damage,
                blocked: b.blocked,
                at: b.at,
            })
            .collect();
        hits.shrink_to_fit();

        let total_actions = self.actions.prefix(b"")?.count() as u64;

        Ok(ArenaView {
            title: self.title.get()?.clone(),
            created_at: *self.created_at.get()?,
            match_index: fight.index,
            round: fight.round,
            status: status.to_owned(),
            round_results: fight.rounds.clone(),
            winner: fight.winner.clone(),
            flawless: fight.flawless,
            p1: self.fighter_view(&snap, 0, now)?,
            p2: self.fighter_view(&snap, 1, now)?,
            me,
            my_seat: my_seat.to_owned(),
            hits,
            match_actions: fight.actions,
            total_actions,
            max_hp: MAX_HP,
            rounds_to_win: ROUNDS_TO_WIN,
        })
    }

    /// Every match this arena has fought, oldest first.
    pub fn history(&self) -> app::Result<Vec<MatchSummary>> {
        Ok(self
            .snapshot()?
            .matches
            .iter()
            .map(|m| MatchSummary {
                index: m.index,
                started_at: m.started_at,
                winner: m.winner.clone(),
                flawless: m.flawless,
                rounds: m.rounds.clone(),
                actions: m.actions,
            })
            .collect())
    }

    // ── entering the arena ──────────────────────────────────────────────────

    /// Announce yourself, or refresh your name and fighter.
    pub fn join(&mut self, name: String, fighter: String, now: u64) -> app::Result<()> {
        let id = Self::caller_id();
        let known = self.presence_of(&id)?.is_some();
        let fighter = normalize_fighter(&fighter)?;
        self.announce(Some(clean_name(&name, "Fighter")), Some(fighter), now)?;
        if !known {
            app::emit!(Event::PlayerJoined(id));
        }
        Ok(())
    }

    /// Change fighter. Allowed any time — the look is yours, and the damage
    /// table is the same for everybody.
    pub fn pick(&mut self, fighter: String, now: u64) -> app::Result<()> {
        let fighter = normalize_fighter(&fighter)?;
        self.announce(None, Some(fighter), now)?;
        let id = Self::caller_id();
        if let Some(slot) = self.snapshot()?.slot_of(&id) {
            app::emit!(Event::Seated {
                seat: SEATS[slot].to_owned(),
                member: id,
            });
        }
        Ok(())
    }

    /// Take corner `p1` or `p2`, if it is free.
    ///
    /// One person cannot hold both: this is a game between two people, and a
    /// fight against yourself has no one on the other side of the network.
    pub fn sit(
        &mut self,
        seat: String,
        name: String,
        fighter: String,
        now: u64,
    ) -> app::Result<()> {
        let seat = normalize_seat(&seat)?;
        let fighter = normalize_fighter(&fighter)?;
        let id = Self::caller_id();
        let display = clean_name(&name, "Fighter");

        let snap = self.snapshot()?;
        let slot = slot_index(seat);
        let holder = &snap.corners[slot].member;
        if *holder == id {
            self.announce(Some(display), Some(fighter), now)?;
            return Ok(());
        }
        if !holder.is_empty() {
            app::bail!("that corner is taken");
        }
        if snap.corners[1 - slot].member == id {
            app::bail!("you are already in the other corner");
        }

        self.announce(Some(display.clone()), Some(fighter), now)?;
        let key = Self::free_key(&self.seat_claims, now, |nonce| {
            format!("{seat}/{id}/{nonce}")
        })?;
        self.seat_claims.insert(
            key,
            Seat {
                name: display,
                claimed_at: now,
            },
        )?;
        app::emit!(Event::Seated {
            seat: seat.to_owned(),
            member: id,
        });
        Ok(())
    }

    /// Leave your corner — only before you have fought here. A corner someone
    /// has fought from is the record of who fought.
    pub fn stand(&mut self, now: u64) -> app::Result<()> {
        let id = Self::caller_id();
        let snap = self.snapshot()?;
        let Some(slot) = snap.slot_of(&id) else {
            app::bail!("you are not in a corner");
        };
        if self.has_acted(&id)? {
            app::bail!("you have already fought here");
        }
        let seat = SEATS[slot];
        let prefix = format!("{seat}/{id}/");
        for (key, _) in Self::owned_rows(&self.seat_claims, &prefix, &id)? {
            if self.is_vacated(&key, &id)? {
                continue;
            }
            let row = Self::free_key(&self.vacated, now, |nonce| format!("{key}/{nonce}"))?;
            self.vacated.insert(row, now)?;
        }
        self.touch(&id, now)?;
        app::emit!(Event::Vacated {
            seat: seat.to_owned(),
            member: id,
        });
        Ok(())
    }

    // ── fighting ────────────────────────────────────────────────────────────

    /// Record one action — a punch, a kick, a jump — in round `round` of match
    /// `match_index`. `hit` says it connected, `blocked` that it was guarded.
    ///
    /// Every call is one transaction. `match_index` and `round` are stated by
    /// the client rather than assumed, so a blow thrown in the closing frame of
    /// a round cannot silently land in the next one: it is refused instead.
    #[allow(clippy::too_many_arguments)]
    pub fn act(
        &mut self,
        match_index: u32,
        round: u32,
        id: u32,
        kind: String,
        hit: bool,
        blocked: bool,
        now: u64,
    ) -> app::Result<()> {
        let me = Self::caller_id();
        let snap = self.snapshot()?;
        let fight = snap.current();
        let Some(slot) = snap.slot_of(&me) else {
            app::bail!("only a fighter in a corner can act");
        };
        if !snap.seated() {
            app::bail!("waiting for an opponent");
        }
        if fight.finished() {
            app::bail!("this match is over");
        }
        if match_index != fight.index {
            app::bail!("that match is not being fought");
        }
        if round != fight.round {
            app::bail!("that round is over");
        }
        let Some(damage) = damage_of(&kind) else {
            app::bail!("unknown move");
        };
        let written =
            Self::owned_rows(&self.actions, &round_prefix(&me, match_index, round), &me)?.len();
        if written >= MAX_ACTIONS_PER_ROUND {
            app::bail!("this round has reached its action limit");
        }

        let key = Self::free_key(&self.actions, now, |nonce| {
            format!("{}{nonce}", round_prefix(&me, match_index, round))
        })?;
        self.actions.insert(
            key,
            Action {
                id,
                kind,
                hit: hit && damage > 0,
                blocked,
                at: now,
                opponent: snap.corners[1 - slot].member.clone(),
            },
        )?;

        app::emit!(Event::Acted {
            match_index,
            round,
            by: me,
            hit: hit && damage > 0,
        });

        // Announcing the knock-out here is what lets the loser's screen fall
        // over without waiting for its next poll.
        let after = self.snapshot()?;
        let now_fight = after.current();
        if now_fight.index == match_index && now_fight.rounds.len() > fight.rounds.len() {
            let winner = now_fight.rounds.last().cloned().unwrap_or_default();
            app::emit!(Event::RoundOver {
                match_index,
                round,
                winner,
            });
            if now_fight.finished() {
                app::emit!(Event::MatchOver {
                    match_index,
                    winner: now_fight.winner.clone(),
                });
            }
        }
        Ok(())
    }

    /// Start the next match. Corners stay; health and rounds reset.
    pub fn rematch(&mut self, now: u64) -> app::Result<u32> {
        let id = Self::caller_id();
        let snap = self.snapshot()?;
        let fight = snap.current();
        if !fight.finished() {
            app::bail!("finish this match first");
        }
        if snap.slot_of(&id).is_none() {
            app::bail!("only a fighter in a corner can call a rematch");
        }
        let next = fight.index.saturating_add(1);
        let key = Self::free_key(&self.matches, now, |nonce| {
            format!("{id}/{}/{nonce}", match_key(next))
        })?;
        self.matches.insert(key, MatchRecord { started_at: now })?;
        self.touch(&id, now)?;
        app::emit!(Event::MatchStarted { match_index: next });
        Ok(next)
    }

    // ── internals: the reader ───────────────────────────────────────────────

    fn snapshot(&self) -> app::Result<Snapshot> {
        let corners = self.corners()?;
        let mut matches: Vec<Fought> = Vec::new();
        for index in 0..MAX_MATCHES {
            let started_at = match matches.last() {
                None => *self.created_at.get()?,
                Some(previous) if !previous.finished() => break,
                Some(_) => match self.rematch_started(index, &corners)? {
                    Some(at) => at,
                    None => break,
                },
            };
            matches.push(self.fight_out(index, started_at, &corners)?);
        }
        Ok(Snapshot { corners, matches })
    }

    /// When match `index` was started, if a fighter in a corner claimed it.
    fn rematch_started(&self, index: u32, corners: &[Holder; 2]) -> app::Result<Option<u64>> {
        let mut earliest: Option<u64> = None;
        for member in distinct(corners) {
            let prefix = format!("{member}/{}/", match_key(index));
            for (_, record) in Self::owned_rows(&self.matches, &prefix, member)? {
                earliest = Some(earliest.map_or(record.started_at, |at| at.min(record.started_at)));
            }
        }
        Ok(earliest)
    }

    /// Fight match `index` out from its rows, round by round.
    ///
    /// A round's damage is the sum of the blows each corner landed in it. The
    /// first round where a fighter has taken [`MAX_HP`] is decided; if both
    /// have, it is a double knock-out and scores for nobody.
    fn fight_out(&self, index: u32, started_at: u64, corners: &[Holder; 2]) -> app::Result<Fought> {
        let mut fought = Fought {
            index,
            started_at,
            rounds: Vec::new(),
            round: 0,
            taken: [0, 0],
            blows: Vec::new(),
            actions: 0,
            winner: String::new(),
            flawless: false,
        };
        if corners.iter().any(|h| h.member.is_empty()) {
            return Ok(fought);
        }

        // Every row of this match, per corner, grouped by round.
        let mut by_round: BTreeMap<u32, [Vec<Action>; 2]> = BTreeMap::new();
        for (slot, holder) in corners.iter().enumerate() {
            let prefix = format!("{}/{}/", holder.member, match_key(index));
            for (key, action) in Self::owned_rows(&self.actions, &prefix, &holder.member)? {
                let Some(round) = key_segment(&key, 2).and_then(|s| s.parse::<u32>().ok()) else {
                    continue;
                };
                fought.actions = fought.actions.saturating_add(1);
                by_round.entry(round).or_default()[slot].push(action);
            }
        }

        for round in 0..MAX_ROUNDS {
            fought.round = round;
            let rows = by_round.remove(&round).unwrap_or_default();
            let mut taken = [0u32; 2];
            let mut blows: Vec<Blow> = Vec::new();
            for (slot, actions) in rows.iter().enumerate() {
                for action in actions.iter().take(MAX_ACTIONS_PER_ROUND) {
                    if !action.hit {
                        continue;
                    }
                    let Some(full) = damage_of(&action.kind) else {
                        continue;
                    };
                    if full == 0 {
                        continue;
                    }
                    let damage = if action.blocked { CHIP_DAMAGE } else { full };
                    let target = 1 - slot;
                    taken[target] = taken[target].saturating_add(damage);
                    blows.push(Blow {
                        by: slot,
                        id: action.id,
                        kind: action.kind.clone(),
                        damage,
                        blocked: action.blocked,
                        at: action.at,
                    });
                }
            }
            // Oldest first for display; ties on the thrower's sequence so every
            // replica lists them the same way.
            blows.sort_by_key(|a| (a.at, a.by, a.id));
            fought.taken = taken.map(|t| t.min(MAX_HP));
            fought.blows = blows;

            let ko = [taken[0] >= MAX_HP, taken[1] >= MAX_HP];
            let result = match ko {
                [false, false] => break,
                [true, true] => "draw",
                [false, true] => SEAT_P1,
                [true, false] => SEAT_P2,
            };
            fought.rounds.push(result.to_owned());

            for slot in 0..2 {
                if fought.wins(slot) >= ROUNDS_TO_WIN {
                    fought.winner = SEATS[slot].to_owned();
                    fought.flawless = taken[slot] == 0;
                }
            }
            if fought.finished() {
                break;
            }
            if round + 1 == MAX_ROUNDS {
                fought.winner = match fought.wins(0).cmp(&fought.wins(1)) {
                    std::cmp::Ordering::Greater => SEAT_P1,
                    std::cmp::Ordering::Less => SEAT_P2,
                    std::cmp::Ordering::Equal => "draw",
                }
                .to_owned();
                break;
            }
            // On to the next round, with fresh health.
            fought.taken = [0, 0];
            fought.blows = Vec::new();
        }
        Ok(fought)
    }

    /// Who holds each corner: `[p1, p2]`.
    ///
    /// Each corner goes to its earliest claim — until both fighters have acted
    /// against each other. Every action names the opponent its author saw, in a
    /// row only that author can write, so a pair who have each named the other
    /// ARE the fighters, whatever anyone files later. Without that lock, a
    /// spectator could backdate a claim and take a corner mid-fight.
    fn corners(&self) -> app::Result<[Holder; 2]> {
        let mut claims: [BTreeMap<MemberId, Seat>; 2] = Default::default();
        for (slot, seat) in SEATS.into_iter().enumerate() {
            for (key, _) in self.seat_claims.prefix(format!("{seat}/").as_bytes())? {
                let Some(author) = key_segment(&key, 1) else {
                    continue;
                };
                let Some(claim) = Self::authored(&self.seat_claims, &key, author)? else {
                    continue;
                };
                if self.is_vacated(&key, author)? {
                    continue;
                }
                let earlier = claims[slot].get(author).is_none_or(|kept| {
                    (claim.claimed_at, &claim.name) < (kept.claimed_at, &kept.name)
                });
                if earlier {
                    let _previous = claims[slot].insert(author.to_owned(), claim);
                }
            }
        }

        // `(author, opponent)` for every action a claimant wrote.
        let mut named: BTreeSet<(MemberId, MemberId)> = BTreeSet::new();
        let claimants: BTreeSet<&MemberId> = claims.iter().flat_map(BTreeMap::keys).collect();
        for author in claimants {
            for (_, action) in Self::owned_rows(&self.actions, &format!("{author}/"), author)? {
                let _new = named.insert((author.clone(), action.opponent));
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
            .flat_map(|a| claims[1].iter().map(move |b| (a, b)))
            .filter(|((a, _), (b, _))| {
                a != b
                    && named.contains(&((*a).clone(), (*b).clone()))
                    && named.contains(&((*b).clone(), (*a).clone()))
            })
            .min_by_key(|((a, sa), (b, sb))| {
                (sa.claimed_at, sb.claimed_at, (*a).clone(), (*b).clone())
            })
            .map(|((a, sa), (b, sb))| [(a.clone(), sa.clone()), (b.clone(), sb.clone())]);

        let mut pick =
            confirmed.map_or_else(|| [earliest(0), earliest(1)], |[a, b]| [Some(a), Some(b)]);
        // One person in both corners is not a fight: the later claim yields.
        if let [Some((a, sa)), Some((b, sb))] = &pick {
            if a == b {
                if sb.claimed_at < sa.claimed_at {
                    pick[0] = None;
                } else {
                    pick[1] = None;
                }
            }
        }
        Ok(pick.map(|choice| {
            choice.map_or_else(Holder::default, |(member, seat)| Holder {
                member,
                name: seat.name,
            })
        }))
    }

    fn is_vacated(&self, claim_key: &str, author: &str) -> app::Result<bool> {
        let given_up =
            !Self::owned_rows(&self.vacated, &format!("{claim_key}/"), author)?.is_empty();
        Ok(given_up && !self.has_acted(author)?)
    }

    fn has_acted(&self, member: &str) -> app::Result<bool> {
        let prefix = format!("{member}/");
        Ok(
            !Self::owned_rows(&self.actions, &prefix, member)?.is_empty()
                || !Self::owned_rows(&self.matches, &prefix, member)?.is_empty(),
        )
    }

    fn account_named(member: &str) -> Option<AccountId> {
        let key = member.parse::<PublicKey>().ok()?;
        let bytes = *key.digest();
        (Self::owner_id(&bytes) == member).then(|| AccountId::from(bytes))
    }

    /// `author`'s OWN entry at `key`, if they hold one — read by the owner
    /// stamp, which core verifies on every apply and nobody can forge.
    fn authored<V, P>(
        map: &Guarded<SortedMap<String, V>, P>,
        key: &String,
        author: &str,
    ) -> app::Result<Option<V>>
    where
        V: BorshSerialize + BorshDeserialize + 'static,
        P: Owning,
    {
        match Self::account_named(author) {
            Some(account) => Ok(map.get_by(&account, key)?),
            None => Ok(None),
        }
    }

    /// Every row under `prefix` that `author` really wrote.
    fn owned_rows<V, P>(
        map: &Guarded<SortedMap<String, V>, P>,
        prefix: &str,
        author: &str,
    ) -> app::Result<Vec<(String, V)>>
    where
        V: BorshSerialize + BorshDeserialize + 'static,
        P: Owning,
    {
        let mut rows: Vec<(String, V)> = Vec::new();
        if author.is_empty() {
            return Ok(rows);
        }
        let mut last: Option<String> = None;
        for (key, _) in map.prefix(prefix.as_bytes())? {
            if last.as_ref() == Some(&key) {
                continue;
            }
            if let Some(value) = Self::authored(map, &key, author)? {
                rows.push((key.clone(), value));
            }
            last = Some(key);
        }
        Ok(rows)
    }

    /// A key in `map` nobody has written yet, starting from `now`.
    fn free_key<C, P>(
        map: &Guarded<C, P>,
        now: u64,
        build: impl Fn(u64) -> String,
    ) -> app::Result<String>
    where
        C: GuardedEntries<Key = String>,
        P: Policy,
    {
        // Wider than a board game's walk: two blows thrown in the same
        // millisecond are ordinary here, not an attack.
        for offset in 0..64 {
            let key = build(now.saturating_add(offset));
            if !map.contains(&key)? {
                return Ok(key);
            }
        }
        Err(app::err!("could not find a free slot to write to"))
    }

    fn fighter_view(&self, snap: &Snapshot, slot: usize, now: u64) -> app::Result<FighterView> {
        let holder = &snap.corners[slot];
        let fight = snap.current();
        let presence = if holder.member.is_empty() {
            None
        } else {
            self.presence_of(&holder.member)?
        };
        let matches_won = snap
            .matches
            .iter()
            .filter(|m| m.winner == SEATS[slot])
            .count() as u32;
        Ok(FighterView {
            seat: SEATS[slot].to_owned(),
            member: holder.member.clone(),
            name: holder.name.clone(),
            fighter: presence
                .as_ref()
                .map_or_else(|| FIGHTERS[slot].to_owned(), |p| p.fighter.clone()),
            hp: MAX_HP.saturating_sub(fight.taken[slot]),
            rounds_won: fight.wins(slot),
            matches_won,
            online: presence.is_some_and(|p| now.saturating_sub(p.updated_at) <= PRESENCE_TTL_MS),
        })
    }

    fn presence_of(&self, member: &str) -> app::Result<Option<Player>> {
        Ok(self
            .players
            .entries()?
            .find(|(account, _)| Self::owner_id(account.as_bytes()) == member)
            .map(|(_, player)| player))
    }

    // ── internals: writing ──────────────────────────────────────────────────

    fn touch(&mut self, member: &str, now: u64) -> app::Result<()> {
        if self.presence_of(member)?.is_none() {
            return Ok(());
        }
        self.announce(None, None, now)
    }

    /// Write the caller's presence row. `None` keeps the current value.
    fn announce(
        &mut self,
        name: Option<String>,
        fighter: Option<&'static str>,
        now: u64,
    ) -> app::Result<()> {
        let existing = self.players.get()?;
        let _previous = self.players.insert(Player {
            name: name
                .or_else(|| existing.as_ref().map(|p| p.name.clone()))
                .unwrap_or_else(|| "Fighter".to_owned()),
            fighter: fighter
                .map(str::to_owned)
                .or_else(|| existing.as_ref().map(|p| p.fighter.clone()))
                .unwrap_or_else(|| FIGHTERS[0].to_owned()),
            joined_at: existing.map_or(now, |p| p.joined_at),
            updated_at: now,
        })?;
        Ok(())
    }
}

// ── free helpers ─────────────────────────────────────────────────────────────

/// Zero-padded so key order is match order.
fn match_key(index: u32) -> String {
    format!("{index:04}")
}

/// `"<account>/<match>/<round>/"` — every action one fighter wrote in one
/// round. The account first, so a reader seeks straight to the two people it
/// is asking about; the nonce after, so a key can never be occupied against
/// its rightful author.
fn round_prefix(author: &str, match_index: u32, round: u32) -> String {
    format!("{author}/{}/{round:02}/", match_key(match_index))
}

fn key_segment(key: &str, n: usize) -> Option<&str> {
    key.split('/').nth(n).filter(|s| !s.is_empty())
}

fn distinct(corners: &[Holder; 2]) -> Vec<&str> {
    let mut out: Vec<&str> = corners
        .iter()
        .map(|h| h.member.as_str())
        .filter(|m| !m.is_empty())
        .collect();
    out.dedup();
    out
}

fn slot_index(seat: &str) -> usize {
    usize::from(seat == SEAT_P2)
}

fn normalize_seat(seat: &str) -> app::Result<&'static str> {
    match seat.trim().to_ascii_lowercase().as_str() {
        SEAT_P1 => Ok(SEAT_P1),
        SEAT_P2 => Ok(SEAT_P2),
        _ => Err(app::err!("a corner is either `p1` or `p2`")),
    }
}

fn normalize_fighter(fighter: &str) -> app::Result<&'static str> {
    let wanted = fighter.trim().to_ascii_lowercase();
    FIGHTERS
        .into_iter()
        .find(|f| *f == wanted)
        .ok_or_else(|| app::err!("unknown fighter"))
}

/// Trim, drop control characters, cap the length, and fall back when nothing
/// usable is left.
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
