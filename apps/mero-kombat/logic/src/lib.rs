//! Mero Kombat: a one-on-one fighting game whose arena is a Calimero app
//! instance, on core's component SDK (`calimero-sdk`).
//!
//! Two people take the two corners, pick a fighter and fight best of three.
//! There is no game server: every punch, kick and special either of them
//! throws is a CALL, one entry in the app's replicated log, and the arena
//! shows the count as it happens.
//!
//! ## What is stored
//!
//! The app runs on its cluster's leader, which applies every call in one log,
//! so the state is plain data: the two corners, each match's running score
//! (round, damage taken, the decided rounds, the winner) and every action
//! thrown. v1 stored only the actions and re-derived health on every read,
//! because a stored HP value could not converge between two nodes subtracting
//! concurrently. Under one log there is nothing to converge: `act` applies a
//! blow to the score in the same run that records it, and a read is one row.
//!
//! **Rounds end on the contract.** A round ends when a fighter has taken
//! [`MAX_HP`]; the next round starts with fresh health; two round wins take
//! the match. Blows are applied in log order, so the blow that reaches
//! [`MAX_HP`] first decides the round, and a blow sent for a round that is
//! over is refused (`RoundOver`). v1's double knock-out (both finishing blows
//! written at once on two nodes) cannot happen any more.
//!
//! **Movement is not here.** Where a fighter stands changes sixty times a
//! second and is worthless a moment later, so it travels over the node's
//! ephemeral presence channel (`/apps/{app}/presence`) and never touches the
//! log. The contract holds the things that decide the fight.
//!
//! ## Trust
//!
//! The attacker's client decides whether a blow connected: it is the only
//! party that knows where its own fist was. The contract bounds what a claim
//! can be worth (every move has a fixed damage, a blocked one does chip damage
//! only, a round holds a capped number of actions per fighter) and records
//! every action as its caller, so a player can only ever hit FOR themselves:
//! v1 got that from core's owner stamp on each row, here `act` checks that
//! `env::caller()` holds a corner. A modified client can claim blows it did
//! not land, as in any peer-to-peer fighting game; the log is the record that
//! it did.
//!
//! ## Access
//!
//! The app's organization decides who reaches the arena (members, admins, the
//! owner and guests, as every member of a v1 context could play). Anyone who
//! reaches it may take a free corner; every write after that is checked against
//! the corner the caller holds.

use calimero_sdk::prelude::*;
use serde::{Deserialize, Serialize};

/// Every fighter starts each round with this much health.
pub const MAX_HP: u32 = 100;

/// Rounds a fighter has to win to take the match.
pub const ROUNDS_TO_WIN: u32 = 2;

/// Matches one arena counts before it stops. A pair who rematch this often
/// have other problems.
const MAX_MATCHES: u64 = 512;

/// Actions one fighter can write in one round. A real round is a few hundred
/// at most; this bounds how much one round can store.
const MAX_ACTIONS_PER_ROUND: u32 = 2_000;

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
        // Moves that hit nobody by design. Still transactions (a jump is a
        // decision the opponent gets to see), but they cannot connect.
        "jump" | "block" => 0,
        _ => return None,
    })
}

/// A blocked blow still chips. Never zero, so turtling is not a strategy.
const CHIP_DAMAGE: u32 = 1;

// ── Stored records ───────────────────────────────────────────────────────────

/// The arena itself: what `init` was given.
#[derive(Serialize, Deserialize, Clone, Debug)]
struct ArenaInfo {
    title: String,
    created_at: u64,
}

/// A person's presence row: name, chosen fighter, last sign of life. Theirs
/// alone, in their own [`PerUser`] slot.
#[derive(Serialize, Deserialize, Clone, Debug)]
struct Player {
    name: String,
    fighter: String,
    joined_at: u64,
    updated_at: u64,
}

/// Who holds a corner.
#[derive(Serialize, Deserialize, Clone, Debug)]
struct Corner {
    member: String,
    name: String,
    claimed_at: u64,
}

/// One blow that landed, as counted.
#[derive(Serialize, Deserialize, Clone, Debug)]
struct Blow {
    /// The corner that threw it: 0 for `p1`, 1 for `p2`.
    by: u8,
    id: u32,
    kind: String,
    damage: u32,
    blocked: bool,
    at: u64,
}

/// One match, as it stands.
#[derive(Serialize, Deserialize, Clone, Debug)]
struct Match {
    started_at: u64,
    /// `"p1"` or `"p2"`, one per decided round: at most 3, since the match
    /// ends (`decide`) the moment a corner has [`ROUNDS_TO_WIN`] of them.
    rounds: Vec<String>,
    /// The round being fought (or the deciding one, once the match is over).
    round: u32,
    /// Damage each corner has TAKEN this round.
    taken: [u32; 2],
    /// Actions each corner has written this round (the per-round cap).
    round_actions: [u32; 2],
    /// Every action written in this match, by both corners.
    actions: u32,
    /// This round's blows that landed, oldest first: at most [`RECENT_HITS`]
    /// (`act` drops the oldest past it) and cleared each round (`decide`).
    blows: Vec<Blow>,
    /// `"p1"` or `"p2"`, or `""` while it is still being fought.
    winner: String,
    /// The winner took the deciding round without being touched.
    flawless: bool,
}

impl Match {
    fn new(started_at: u64) -> Self {
        Self {
            started_at,
            rounds: Vec::new(),
            round: 0,
            taken: [0, 0],
            round_actions: [0, 0],
            actions: 0,
            blows: Vec::new(),
            winner: String::new(),
            flawless: false,
        }
    }

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

/// One thing a fighter did. The log's own record of the fight.
#[derive(Serialize, Deserialize, Clone, Debug)]
struct Action {
    match_index: u32,
    round: u32,
    /// The account that threw it.
    by: String,
    /// The client's own sequence number: how the opponent's screen matches a
    /// blow it already saw over presence to the row that makes it count.
    id: u32,
    kind: String,
    hit: bool,
    blocked: bool,
    /// Its author's clock. Display only.
    at: u64,
    /// Who was in the other corner.
    opponent: String,
}

// ── Views ────────────────────────────────────────────────────────────────────
//
// Strings and sentinels rather than `Option`s, as in v1, so a client never has
// to tell `null` from `""`. Field names are camelCase on the wire, and `u64`s
// decimal strings (D20), like every component app's.

/// One corner, as the reader sees it.
#[derive(Serialize, Deserialize, Clone, Debug)]
#[serde(rename_all = "camelCase")]
pub struct FighterView {
    /// `p1` or `p2`.
    pub seat: String,
    /// The account in this corner, or `""` when it is empty.
    pub member: String,
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

/// One blow of the current round.
#[derive(Serialize, Deserialize, Clone, Debug)]
#[serde(rename_all = "camelCase")]
pub struct HitView {
    /// The corner that threw it.
    pub by: String,
    /// The thrower's own sequence number.
    pub id: u32,
    pub kind: String,
    pub damage: u32,
    pub blocked: bool,
    #[serde(with = "calimero_sdk::json::u64_str")]
    pub at: u64,
}

/// Everything a client needs to draw the arena, in one call.
#[derive(Serialize, Deserialize, Clone, Debug)]
#[serde(rename_all = "camelCase")]
pub struct ArenaView {
    pub title: String,
    #[serde(with = "calimero_sdk::json::u64_str")]
    pub created_at: u64,
    /// Index of the match being fought now.
    pub match_index: u32,
    /// Index of the round being fought now (0-based).
    pub round: u32,
    /// `waiting`, `fighting` or `finished`.
    pub status: String,
    /// One entry per decided round of this match: `p1` or `p2`.
    pub round_results: Vec<String>,
    /// `p1`, `p2`, or `""` while the match is on.
    pub winner: String,
    pub flawless: bool,
    pub p1: FighterView,
    pub p2: FighterView,
    /// The caller, as the contract sees it (their account id).
    pub me: String,
    /// `p1`, `p2`, or `""` for a spectator.
    pub my_seat: String,
    /// This round's landed blows, newest first, at most [`RECENT_HITS`].
    pub hits: Vec<HitView>,
    /// Actions written in the current match, both corners.
    pub match_actions: u32,
    /// Every action ever written at this arena: the transaction count.
    #[serde(with = "calimero_sdk::json::u64_str")]
    pub total_actions: u64,
    pub max_hp: u32,
    pub rounds_to_win: u32,
}

/// One match of the arena's record.
#[derive(Serialize, Deserialize, Clone, Debug)]
#[serde(rename_all = "camelCase")]
pub struct MatchSummary {
    pub index: u32,
    #[serde(with = "calimero_sdk::json::u64_str")]
    pub started_at: u64,
    pub winner: String,
    pub flawless: bool,
    pub rounds: Vec<String>,
    pub actions: u32,
}

// ── State ────────────────────────────────────────────────────────────────────

/// The arena.
#[app::state(version = 1)]
pub struct MeroKombat {
    /// Title and creation time.
    arena: Cell<ArenaInfo>,
    /// Each person's name, fighter and last sign of life.
    players: PerUser<Player>,
    /// `"p1"` / `"p2"` -> who holds that corner.
    corners: UnorderedMap<String, Corner>,
    /// Every match, by index. Match 0 is written by `init`.
    matches: Vector<Match>,
    /// Every action ever thrown here; its length is the transaction count.
    actions: Vector<Action>,
    /// Accounts that have fought here (acted, or started a rematch): a corner
    /// someone fought from is the record of who fought, so it cannot be left.
    fought: Set<String>,
    /// Matches won by the `p1` corner.
    p1_wins: Counter,
    /// Matches won by the `p2` corner.
    p2_wins: Counter,
}

#[app::logic]
impl MeroKombat {
    /// A new arena with match 0 waiting for two fighters. `title` defaults to
    /// `"Arena"`; `now` (the creator's clock) is `createdAt`, `"0"` when not
    /// given.
    #[app::init]
    pub fn init(title: Option<String>, now: Option<u64>) -> app::Result<Self> {
        let mut state = Self::load();
        let created_at = now.unwrap_or(0);
        state.arena.set(&ArenaInfo {
            title: clean_name(title.as_deref().unwrap_or(""), "Arena"),
            created_at,
        })?;
        let _index = state.matches.push(&Match::new(created_at))?;
        env::emit(Event::Initialized, Audience::All)?;
        Ok(state)
    }

    // ── reading ─────────────────────────────────────────────────────────────

    /// The whole arena in one call, as the caller sees it at `now` (their
    /// clock, for who is `online`).
    #[app::view]
    pub fn arena(&self, now: u64) -> app::Result<ArenaView> {
        let info = self.info()?;
        let (index, fight) = self.current()?;
        let corners = self.corners()?;
        let me = caller_account().unwrap_or_default();
        let my_seat = slot_of(&corners, &me).map_or("", |s| SEATS[s]);
        let seated = corners.iter().all(Option::is_some);

        let status = if fight.finished() {
            "finished"
        } else if seated {
            "fighting"
        } else {
            "waiting"
        };

        let hits = fight
            .blows
            .iter()
            .rev()
            .take(RECENT_HITS)
            .map(|b| HitView {
                by: SEATS[usize::from(b.by)].to_owned(),
                id: b.id,
                kind: b.kind.clone(),
                damage: b.damage,
                blocked: b.blocked,
                at: b.at,
            })
            .collect();

        Ok(ArenaView {
            title: info.title,
            created_at: info.created_at,
            match_index: index,
            round: fight.round,
            status: status.to_owned(),
            round_results: fight.rounds.clone(),
            winner: fight.winner.clone(),
            flawless: fight.flawless,
            p1: self.fighter_view(&corners, &fight, 0, now)?,
            p2: self.fighter_view(&corners, &fight, 1, now)?,
            me,
            my_seat: my_seat.to_owned(),
            hits,
            match_actions: fight.actions,
            total_actions: self.actions.len()?,
            max_hp: MAX_HP,
            rounds_to_win: ROUNDS_TO_WIN,
        })
    }

    /// Every match this arena has fought, oldest first (at most 512).
    #[app::view]
    pub fn history(&self) -> app::Result<Vec<MatchSummary>> {
        let page = self
            .matches
            .page(FindOpts::default().limit(MAX_MATCHES as u32))?;
        Ok(page
            .items
            .into_iter()
            .enumerate()
            .map(|(index, m)| MatchSummary {
                index: index as u32,
                started_at: m.started_at,
                winner: m.winner,
                flawless: m.flawless,
                rounds: m.rounds,
                actions: m.actions,
            })
            .collect())
    }

    // ── entering the arena ──────────────────────────────────────────────────

    /// Announce yourself, or refresh your name and fighter. Emits
    /// `PlayerJoined` the first time.
    pub fn join(&mut self, name: String, fighter: String, now: u64) -> app::Result<()> {
        let me = caller_account()?;
        let fighter = normalize_fighter(&fighter)?;
        let known = self.players.get_for(&me)?.is_some();
        self.announce(Some(clean_name(&name, "Fighter")), Some(fighter), now)?;
        if !known {
            env::emit(Event::PlayerJoined { member: me }, Audience::All)?;
        }
        Ok(())
    }

    /// Change fighter. Allowed any time: the look is yours, and the damage
    /// table is the same for everybody. Emits `Seated` again when you hold a
    /// corner, so the other screen redraws you.
    pub fn pick(&mut self, fighter: String, now: u64) -> app::Result<()> {
        let fighter = normalize_fighter(&fighter)?;
        self.announce(None, Some(fighter), now)?;
        let me = caller_account()?;
        if let Some(slot) = slot_of(&self.corners()?, &me) {
            env::emit(
                Event::Seated {
                    seat: SEATS[slot].to_owned(),
                    member: me,
                },
                Audience::All,
            )?;
        }
        Ok(())
    }

    /// Take corner `p1` or `p2`, if it is free. Sitting again in your own
    /// corner refreshes your name and fighter.
    ///
    /// One person cannot hold both: this is a game between two people.
    /// `CornerTaken` when someone else holds it, `InOtherCorner` when you hold
    /// the other one.
    pub fn sit(
        &mut self,
        seat: String,
        name: String,
        fighter: String,
        now: u64,
    ) -> app::Result<()> {
        let seat = normalize_seat(&seat)?;
        let fighter = normalize_fighter(&fighter)?;
        let me = caller_account()?;
        let display = clean_name(&name, "Fighter");

        let corners = self.corners()?;
        let slot = slot_index(seat);
        if let Some(holder) = &corners[slot] {
            if holder.member == me {
                self.announce(Some(display), Some(fighter), now)?;
                return Ok(());
            }
            return Err(Error::CornerTaken.into());
        }
        if corners[1 - slot].as_ref().is_some_and(|c| c.member == me) {
            return Err(Error::InOtherCorner.into());
        }

        self.announce(Some(display.clone()), Some(fighter), now)?;
        let _previous = self.corners.insert(
            &seat.to_owned(),
            &Corner {
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

    /// Leave your corner, only before you have fought here: a corner someone
    /// has fought from is the record of who fought. `NotInCorner`,
    /// `AlreadyFought`.
    pub fn stand(&mut self, now: u64) -> app::Result<()> {
        let me = caller_account()?;
        let Some(slot) = slot_of(&self.corners()?, &me) else {
            return Err(Error::NotInCorner.into());
        };
        if self.fought.contains(&me)? {
            return Err(Error::AlreadyFought.into());
        }
        let seat = SEATS[slot];
        let _removed = self.corners.remove(&seat.to_owned())?;
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

    // ── fighting ────────────────────────────────────────────────────────────

    /// Record one action (a punch, a kick, a jump) in round `round` of match
    /// `matchIndex`. `hit` says it connected, `blocked` that it was guarded.
    ///
    /// Every call is one transaction. `matchIndex` and `round` are stated by
    /// the client rather than assumed, so a blow thrown in the closing frame of
    /// a round cannot silently land in the next one: it is refused instead
    /// (`RoundOver`). Emits `Acted`, then `RoundOver` and `MatchOver` when this
    /// blow decided them.
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
        let me = caller_account()?;
        let corners = self.corners()?;
        let (index, mut fight) = self.current()?;
        let Some(slot) = slot_of(&corners, &me) else {
            return Err(Error::NotInCorner.into());
        };
        let Some(opponent) = corners[1 - slot].as_ref() else {
            return Err(Error::WaitingForOpponent.into());
        };
        if fight.finished() {
            return Err(Error::MatchOver.into());
        }
        if match_index != index {
            return Err(Error::WrongMatch { current: index }.into());
        }
        if round != fight.round {
            return Err(Error::RoundOver {
                current: fight.round,
            }
            .into());
        }
        let Some(full) = damage_of(&kind) else {
            return Err(Error::UnknownMove { kind }.into());
        };
        if fight.round_actions[slot] >= MAX_ACTIONS_PER_ROUND {
            return Err(Error::ActionLimit.into());
        }

        let landed = hit && full > 0;
        let _position = self.actions.push(&Action {
            match_index,
            round,
            by: me.clone(),
            id,
            kind: kind.clone(),
            hit: landed,
            blocked,
            at: now,
            opponent: opponent.member.clone(),
        })?;
        let _new = self.fought.insert(&me)?;
        fight.actions = fight.actions.saturating_add(1);
        fight.round_actions[slot] = fight.round_actions[slot].saturating_add(1);

        let mut decided = None;
        if landed {
            let damage = if blocked { CHIP_DAMAGE } else { full };
            let target = 1 - slot;
            fight.taken[target] = fight.taken[target].saturating_add(damage).min(MAX_HP);
            fight.blows.push(Blow {
                by: slot as u8,
                id,
                kind,
                damage,
                blocked,
                at: now,
            });
            if fight.blows.len() > RECENT_HITS {
                let _oldest = fight.blows.remove(0);
            }
            if fight.taken[target] >= MAX_HP {
                decided = Some(self.decide(&mut fight, slot)?);
            }
        }
        let _previous = self.matches.set(u64::from(index), &fight)?;

        env::emit(
            Event::Acted {
                match_index,
                round,
                by: me,
                hit: landed,
            },
            Audience::All,
        )?;
        // Announcing the knock-out here is what lets the loser's screen fall
        // over without waiting for its next read.
        if let Some(winner) = decided {
            env::emit(
                Event::RoundOver {
                    match_index,
                    round,
                    winner,
                },
                Audience::All,
            )?;
            if fight.finished() {
                env::emit(
                    Event::MatchOver {
                        match_index,
                        winner: fight.winner.clone(),
                    },
                    Audience::All,
                )?;
            }
        }
        Ok(())
    }

    /// Start the next match. Corners stay; health and rounds reset. Returns
    /// the new match's index. `MatchNotFinished`, `NotInCorner`, and
    /// `MatchLimit` past 512 matches.
    pub fn rematch(&mut self, now: u64) -> app::Result<u32> {
        let me = caller_account()?;
        let (index, fight) = self.current()?;
        if !fight.finished() {
            return Err(Error::MatchNotFinished.into());
        }
        if slot_of(&self.corners()?, &me).is_none() {
            return Err(Error::NotInCorner.into());
        }
        if u64::from(index) + 1 >= MAX_MATCHES {
            return Err(Error::MatchLimit.into());
        }
        let next = u32::try_from(self.matches.push(&Match::new(now))?).unwrap_or(u32::MAX);
        let _new = self.fought.insert(&me)?;
        self.touch(&me, now)?;
        env::emit(Event::MatchStarted { match_index: next }, Audience::All)?;
        Ok(next)
    }

    // ── internals ───────────────────────────────────────────────────────────

    fn info(&self) -> app::Result<ArenaInfo> {
        Ok(self.arena.get()?.unwrap_or_else(|| ArenaInfo {
            title: "Arena".to_owned(),
            created_at: 0,
        }))
    }

    /// The match being fought (the last one) and its index.
    fn current(&self) -> app::Result<(u32, Match)> {
        let len = self.matches.len()?;
        let Some(last) = len.checked_sub(1) else {
            // `init` writes match 0; an arena without it is not one.
            return Ok((0, Match::new(0)));
        };
        let fight = self.matches.get(last)?.unwrap_or_else(|| Match::new(0));
        Ok((u32::try_from(last).unwrap_or(u32::MAX), fight))
    }

    /// Who holds each corner: `[p1, p2]`.
    fn corners(&self) -> app::Result<[Option<Corner>; 2]> {
        Ok([
            self.corners.get(&SEAT_P1.to_owned())?,
            self.corners.get(&SEAT_P2.to_owned())?,
        ])
    }

    /// `slot` reached [`MAX_HP`] damage dealt: score the round for it, end
    /// the match on its second, or start the next round. The winning corner.
    fn decide(&mut self, fight: &mut Match, slot: usize) -> app::Result<String> {
        let winner = SEATS[slot].to_owned();
        fight.rounds.push(winner.clone());
        if fight.wins(slot) >= ROUNDS_TO_WIN {
            fight.winner = winner.clone();
            fight.flawless = fight.taken[slot] == 0;
            let wins = if slot == 0 {
                &mut self.p1_wins
            } else {
                &mut self.p2_wins
            };
            let _total = wins.increment()?;
        } else {
            // On to the next round, with fresh health.
            fight.round = fight.round.saturating_add(1);
            fight.taken = [0, 0];
            fight.round_actions = [0, 0];
            fight.blows = Vec::new();
        }
        Ok(winner)
    }

    fn fighter_view(
        &self,
        corners: &[Option<Corner>; 2],
        fight: &Match,
        slot: usize,
        now: u64,
    ) -> app::Result<FighterView> {
        let corner = corners[slot].as_ref();
        let presence = match corner {
            Some(c) => self.players.get_for(&c.member)?,
            None => None,
        };
        let wins = if slot == 0 {
            &self.p1_wins
        } else {
            &self.p2_wins
        };
        Ok(FighterView {
            seat: SEATS[slot].to_owned(),
            member: corner.map(|c| c.member.clone()).unwrap_or_default(),
            name: corner.map(|c| c.name.clone()).unwrap_or_default(),
            fighter: presence
                .as_ref()
                .map_or_else(|| FIGHTERS[slot].to_owned(), |p| p.fighter.clone()),
            hp: MAX_HP.saturating_sub(fight.taken[slot]),
            rounds_won: fight.wins(slot),
            matches_won: u32::try_from(wins.get()?).unwrap_or(u32::MAX),
            online: presence.is_some_and(|p| now.saturating_sub(p.updated_at) <= PRESENCE_TTL_MS),
        })
    }

    /// Refresh `member`'s last sign of life, if they have announced themselves.
    fn touch(&mut self, member: &str, now: u64) -> app::Result<()> {
        if self.players.get_for(member)?.is_none() {
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
        let _account = self.players.set(&Player {
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

/// A typed refusal: `422 APP_ERROR` with `{ code, fields }` on the wire. Each
/// replaces one of v1's `app::bail!` messages (listed in the README).
#[app::error]
pub enum Error {
    /// A corner is either `p1` or `p2`.
    UnknownSeat { seat: String },
    /// Not one of the roster's fighters.
    UnknownFighter { fighter: String },
    /// Not a move the damage table knows.
    UnknownMove { kind: String },
    /// Someone else holds that corner.
    CornerTaken,
    /// The caller holds the other corner already.
    InOtherCorner,
    /// Only a fighter in a corner may do this.
    NotInCorner,
    /// The caller has fought here, so their corner is theirs for good.
    AlreadyFought,
    /// The other corner is empty.
    WaitingForOpponent,
    /// The current match is decided; start a rematch.
    MatchOver,
    /// That match is not being fought; `current` is.
    WrongMatch { current: u32 },
    /// That round is over; `current` is being fought.
    RoundOver { current: u32 },
    /// The caller has written the most actions one round holds.
    ActionLimit,
    /// The current match is still being fought.
    MatchNotFinished,
    /// The arena has fought the most matches it counts.
    MatchLimit,
}

/// A nudge, not the truth: every event means "read `arena` again".
#[app::event]
pub enum Event {
    /// The arena was created.
    Initialized,
    /// `member` announced themselves for the first time.
    PlayerJoined { member: String },
    /// `member` took corner `seat` (or picked a fighter while in it).
    Seated { seat: String, member: String },
    /// `member` left corner `seat`.
    Vacated { seat: String, member: String },
    /// `by` threw something in round `round` of match `matchIndex`.
    Acted {
        match_index: u32,
        round: u32,
        by: String,
        hit: bool,
    },
    /// `winner` took round `round` of match `matchIndex`.
    RoundOver {
        match_index: u32,
        round: u32,
        winner: String,
    },
    /// `winner` took match `matchIndex`.
    MatchOver { match_index: u32, winner: String },
    /// Match `matchIndex` began.
    MatchStarted { match_index: u32 },
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

fn slot_of(corners: &[Option<Corner>; 2], member: &str) -> Option<usize> {
    if member.is_empty() {
        return None;
    }
    corners
        .iter()
        .position(|c| c.as_ref().is_some_and(|c| c.member == member))
}

fn slot_index(seat: &str) -> usize {
    usize::from(seat == SEAT_P2)
}

fn normalize_seat(seat: &str) -> app::Result<&'static str> {
    match seat.trim().to_ascii_lowercase().as_str() {
        SEAT_P1 => Ok(SEAT_P1),
        SEAT_P2 => Ok(SEAT_P2),
        _ => Err(Error::UnknownSeat {
            seat: seat.to_owned(),
        }
        .into()),
    }
}

fn normalize_fighter(fighter: &str) -> app::Result<&'static str> {
    let wanted = fighter.trim().to_ascii_lowercase();
    FIGHTERS.into_iter().find(|f| *f == wanted).ok_or_else(|| {
        Error::UnknownFighter {
            fighter: fighter.to_owned(),
        }
        .into()
    })
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
