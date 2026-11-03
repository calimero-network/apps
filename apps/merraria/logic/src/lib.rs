//! Merraria: shared 2D tile-world state, on core's component SDK
//! (`calimero-app-sdk`).
//!
//! The world is generated deterministically from `seed` on every client; this
//! app carries only the founding parameters, the tile-override diff (dig = an
//! explicit `0`/air, never a removal) and player presence on the mero-meet room
//! clock.
//!
//! The app runs on its cluster's leader, which applies every write in one
//! replicated log, so a later write to a tile replaces an earlier one: v1's
//! last-writer-wins merge rules (`TileOverride`/`Player` `Mergeable`) have
//! nothing left to decide and are gone, and so is the per-tile timestamp they
//! needed.
//!
//! Who may write what, stated per method (v1 held these rules in storage):
//!
//! * `createWorld` founds the world once, and only the app's owner may call it
//!   (`Forbidden` for anyone else, `WorldExists` the second time). There is no
//!   setter: name, seed and clock anchor stay as founded (v1's `Frozen`).
//! * Every avatar row is keyed by the caller's ACCOUNT (`env::caller()`); no
//!   method takes an account or row id, so nobody can name another player's
//!   row (v1's `UserStorage`). A player who vanishes without `leave` ages out
//!   of the TTL in `getPlayers`; nobody writes another player's row.
//! * The overrides are public on purpose: anyone the app's org admits (owner,
//!   admins, members and guests, as every member of a v1 context) may dig or
//!   build anywhere.
//!
//! Every change a client sees compared with v1 is listed in
//! `apps/merraria/README.md`.

use calimero_app_sdk::prelude::*;
use serde::{Deserialize, Serialize};

/// World bounds: must match `app/src/engine/world.ts`.
const WORLD_W: i32 = 400;
const WORLD_H: i32 = 200;

/// The most edits one `setTiles` call takes.
const MAX_EDITS_PER_CALL: usize = 512;
/// How long after its last stamp a player still counts as online.
const PRESENCE_TTL_SECS: u64 = 10;
/// How far ahead of the caller's own clock a stored player stamp may be and
/// still move room time (see mero-blocks): an honest fast laptop is followed,
/// a far-future stamp is ignored instead of freezing presence.
const MAX_CLOCK_SKEW_SECS: u64 = 900;
/// The most rows one read answers: `getOverrides`' default and largest
/// `limit`, and one page of the players map.
const PAGE: u32 = 1000;
/// The most avatars a world keeps, one per account that ever joined it. Every
/// call reads them all to find room time, so they must fit one page.
const MAX_PLAYERS: u64 = PAGE as u64;

// ── Records ──────────────────────────────────────────────────────────────────

/// The world's founding parameters, fixed by `createWorld`.
#[derive(Serialize, Deserialize, Clone, Debug, PartialEq)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct WorldMeta {
    pub name: String,
    /// The terrain seed (the client generator reads it as a u32).
    pub seed: u32,
    /// The day-clock anchor, in seconds since the epoch.
    pub created_at: u32,
}

/// One tile edit: `t` is the tile id (0 = air / dug out).
#[derive(Serialize, Deserialize, Clone, Debug)]
pub struct Edit {
    pub x: i32,
    pub y: i32,
    pub t: u8,
}

/// A player's live transform, as `heartbeat` sends it.
#[derive(Serialize, Deserialize, Clone, Debug)]
pub struct Transform {
    pub name: String,
    pub x: f64,
    pub y: f64,
    /// facing: -1 | 1
    pub dir: f64,
    pub sel: u8,
    /// "idle" | "walking" | "mining" | "building" | "swimming"; empty or
    /// absent means "idle".
    #[serde(default)]
    pub action: String,
}

/// One override as `getOverrides` answers it: `k` is `"x,y"`.
#[derive(Serialize, Deserialize, Clone, Debug)]
pub struct TileEntry {
    pub k: String,
    pub t: u8,
}

/// One page of overrides: `next` is the cursor of the following page, `null`
/// on the last one.
#[derive(Serialize, Deserialize, Clone, Debug)]
pub struct OverridesPage {
    pub items: Vec<TileEntry>,
    pub next: Option<String>,
}

/// A roster row: `id` is the player's account.
#[derive(Serialize, Deserialize, Clone, Debug)]
pub struct PlayerView {
    pub id: String,
    pub name: String,
    pub x: f64,
    pub y: f64,
    pub dir: f64,
    pub sel: u8,
    pub action: String,
    pub online: bool,
}

/// A stored avatar row. Never on the wire: its stamps are room-clock seconds.
#[derive(Serialize, Deserialize, Clone, Debug)]
#[serde(rename_all = "camelCase")]
pub struct Player {
    pub name: String,
    pub x: f64,
    pub y: f64,
    pub dir: f64,
    pub sel: u8,
    pub action: String,
    pub left: bool,
    pub joined_at: u64,
    pub updated_at: u64,
}

impl Player {
    fn view(&self, id: String, online: bool) -> PlayerView {
        PlayerView {
            id,
            name: self.name.clone(),
            x: self.x,
            y: self.y,
            dir: self.dir,
            sel: self.sel,
            action: self.action.clone(),
            online,
        }
    }
}

// ── State ────────────────────────────────────────────────────────────────────

/// The world.
#[app::state(version = 1)]
pub struct Merraria {
    /// Name, seed and day-clock anchor: written once by `createWorld`, never
    /// changed (the terrain is derived from the seed).
    meta: Cell<WorldMeta>,
    /// `"x,y"` -> tile id. Set-only (dig = 0), never removed; at most one entry
    /// per in-bounds tile, so at most 80,000.
    overrides: UnorderedMap<String, u8>,
    /// account -> that account's avatar; written only under the caller's own
    /// account. At most `MAX_PLAYERS` rows (one page), enforced on join.
    players: UnorderedMap<String, Player>,
}

#[app::logic]
impl Merraria {
    /// The empty app. The node runs it once, when the instance is created; the
    /// world itself is founded by `createWorld`.
    #[app::init]
    pub fn init() -> app::Result<Self> {
        Ok(Self::load())
    }

    // ── World ─────────────────────────────────────────────────────────────

    /// Founds the world: its name, terrain seed and day-clock anchor (`now`,
    /// seconds). Only the app's owner may, and only once: `Forbidden` for any
    /// other account, `WorldExists` once founded. Emits `Initialized`.
    pub fn create_world(&mut self, name: String, seed: u32, now: u32) -> app::Result<()> {
        let account = Self::account()?;
        if account != env::app_owner() {
            return Err(AppError::forbidden());
        }
        if self.meta.get()?.is_some() {
            return Err(Error::WorldExists.into());
        }
        self.meta.set(&WorldMeta {
            name,
            seed,
            created_at: now,
        })?;
        env::emit(Event::Initialized, Audience::All)?;
        Ok(())
    }

    /// The world's name, seed and clock anchor; `NoWorld` before `createWorld`.
    #[app::view]
    pub fn world_meta(&self) -> app::Result<WorldMeta> {
        self.meta.get()?.ok_or_else(|| Error::NoWorld.into())
    }

    /// Applies up to 512 tile edits (dig = `t: 0`, stored, never a removal);
    /// edits outside the 400×200 world are skipped. Answers how many were
    /// applied. Refreshes the caller's presence stamp and, when anything was
    /// applied, emits `TilesChanged(account)`. `TooManyEdits` past 512,
    /// `NoWorld` before `createWorld`.
    pub fn set_tiles(&mut self, edits: Vec<Edit>, now: u32) -> app::Result<u32> {
        let account = Self::account()?;
        self.require_world()?;
        if edits.len() > MAX_EDITS_PER_CALL {
            return Err(Error::TooManyEdits {
                max: MAX_EDITS_PER_CALL as u32,
            }
            .into());
        }
        let mut applied: u32 = 0;
        for e in edits {
            if !in_bounds(e.x, e.y) {
                continue;
            }
            let _previous = self.overrides.insert(&format!("{},{}", e.x, e.y), &e.t)?;
            applied += 1;
        }
        if applied > 0 {
            let room_now = self.room_now(now)?;
            if let Some(mut p) = self.players.get(&account)? {
                p.updated_at = stamp(room_now, p.updated_at);
                let _previous = self.players.insert(&account, &p)?;
            }
            env::emit(Event::TilesChanged(account), Audience::All)?;
        }
        Ok(applied)
    }

    /// One page of overrides, in key order (`"x,y"` as strings sort): at most
    /// `limit` (default and largest 1,000), from `cursor` (a previous page's
    /// `next`; absent for the first page). Read pages until `next` is `null`.
    #[app::view]
    pub fn get_overrides(
        &self,
        cursor: Option<String>,
        limit: Option<u32>,
    ) -> app::Result<OverridesPage> {
        let mut opts = FindOpts::default().limit(limit.unwrap_or(PAGE).min(PAGE));
        if let Some(cursor) = cursor {
            opts = opts.cursor(cursor);
        }
        let page = self.overrides.page(opts)?;
        Ok(OverridesPage {
            items: page
                .items
                .into_iter()
                .map(|(k, t)| TileEntry { k, t })
                .collect(),
            next: page.next,
        })
    }

    // ── Players ───────────────────────────────────────────────────────────

    /// Joins (or rejoins) as `name`. A rejoin keeps the first `joinedAt` and the
    /// last position; facing, slot and action reset. Answers the caller's
    /// roster row and emits `PlayerJoined(account)`. `WorldFull` for a new
    /// account once the world keeps 1,000 avatars.
    pub fn join(&mut self, name: String, now: u32) -> app::Result<PlayerView> {
        let account = Self::account()?;
        self.require_world()?;
        let existing = self.players.get(&account)?;
        if existing.is_none() {
            self.require_room()?;
        }
        let now = u64::from(now);
        let joined_at = existing.as_ref().map_or(now, |p| p.joined_at);
        let stored = existing.as_ref().map_or(0, |p| p.updated_at);
        let (x, y) = existing.as_ref().map_or((0.0, 0.0), |p| (p.x, p.y));
        let updated_at = stamp(self.room_now_secs(now)?, stored);
        let player = Player {
            name,
            x,
            y,
            dir: 1.0,
            sel: 0,
            action: "idle".to_owned(),
            left: false,
            joined_at,
            updated_at,
        };
        let _previous = self.players.insert(&account, &player)?;
        env::emit(Event::PlayerJoined(account.clone()), Audience::All)?;
        Ok(player.view(account, true))
    }

    /// The caller's presence and transform. Silent (no event) unless the caller
    /// had no row or had left, which emits `PlayerJoined(account)`.
    /// `WorldFull` for a new account once the world keeps 1,000 avatars.
    pub fn heartbeat(&mut self, t: Transform, now: u32) -> app::Result<()> {
        let account = Self::account()?;
        self.require_world()?;
        let existing = self.players.get(&account)?;
        if existing.is_none() {
            self.require_room()?;
        }
        let now = u64::from(now);
        let joined_at = existing.as_ref().map_or(now, |p| p.joined_at);
        let stored = existing.as_ref().map_or(0, |p| p.updated_at);
        let was_left = existing.as_ref().is_none_or(|p| p.left);
        let updated_at = stamp(self.room_now_secs(now)?, stored);
        let player = Player {
            name: t.name,
            x: t.x,
            y: t.y,
            dir: t.dir,
            sel: t.sel,
            action: if t.action.is_empty() {
                "idle".to_owned()
            } else {
                t.action
            },
            left: false,
            joined_at,
            updated_at,
        };
        let _previous = self.players.insert(&account, &player)?;
        if was_left {
            env::emit(Event::PlayerJoined(account), Audience::All)?;
        }
        Ok(())
    }

    /// Marks the caller as having left and emits `PlayerLeft(account)`; a
    /// no-op (no event) for a caller who never joined.
    pub fn leave(&mut self, now: u32) -> app::Result<()> {
        let account = Self::account()?;
        self.require_world()?;
        let Some(mut p) = self.players.get(&account)? else {
            return Ok(());
        };
        p.left = true;
        p.updated_at = stamp(self.room_now(now)?, p.updated_at);
        let _previous = self.players.insert(&account, &p)?;
        env::emit(Event::PlayerLeft(account), Audience::All)?;
        Ok(())
    }

    /// The roster with liveness at room time (`now` is the caller's clock), in
    /// join order (then by account): every avatar the world keeps, at most
    /// 1,000 (one page). A player who vanished without `leave`
    /// ages out of the 10-second TTL here.
    #[app::view]
    pub fn get_players(&self, now: u32) -> app::Result<Vec<PlayerView>> {
        let mut rows = self.all_players()?;
        let room_now = room_time(&rows, u64::from(now));
        rows.sort_by(|(a_id, a), (b_id, b)| (a.joined_at, a_id).cmp(&(b.joined_at, b_id)));
        Ok(rows
            .into_iter()
            .map(|(id, p)| {
                let online = !p.left && room_now.saturating_sub(p.updated_at) <= PRESENCE_TTL_SECS;
                p.view(id, online)
            })
            .collect())
    }

    // ── helpers (not methods: not `pub`) ──────────────────────────────────

    /// The account the caller acts for. The node admits only org accounts to
    /// this app, so the other callers are a backstop.
    fn account() -> app::Result<String> {
        match env::caller() {
            Caller::Account(account) | Caller::ApiKey { account, .. } => Ok(account),
            Caller::Public | Caller::System | Caller::App(_) => Err(AppError::login_required()),
        }
    }

    fn require_world(&self) -> app::Result<()> {
        match self.meta.get()? {
            Some(_) => Ok(()),
            None => Err(Error::NoWorld.into()),
        }
    }

    /// Every avatar row, `(account, row)`: one page, which holds them all
    /// because a world keeps at most `MAX_PLAYERS` (`require_room`).
    fn all_players(&self) -> app::Result<Vec<(String, Player)>> {
        Ok(self.players.page(FindOpts::default().limit(PAGE))?.items)
    }

    /// `WorldFull` when a new account would take the world past `MAX_PLAYERS`
    /// rows (a stored count, not a scan). Accounts already in it always may.
    fn require_room(&self) -> app::Result<()> {
        if self.players.len()? >= MAX_PLAYERS {
            return Err(Error::WorldFull { max: PAGE }.into());
        }
        Ok(())
    }

    fn room_now(&self, caller_now: u32) -> app::Result<u64> {
        self.room_now_secs(u64::from(caller_now))
    }

    fn room_now_secs(&self, caller_now: u64) -> app::Result<u64> {
        Ok(room_time(&self.all_players()?, caller_now))
    }
}

/// Room time: the fastest member's clock, up to `MAX_CLOCK_SKEW_SECS` ahead of
/// the caller's.
fn room_time(rows: &[(String, Player)], caller_now: u64) -> u64 {
    let ceiling = caller_now.saturating_add(MAX_CLOCK_SKEW_SECS);
    rows.iter()
        .map(|(_, p)| p.updated_at)
        .filter(|ts| *ts <= ceiling)
        .fold(caller_now, u64::max)
}

/// A stamp that never goes backwards for its row.
fn stamp(room_now: u64, stored: u64) -> u64 {
    room_now.max(stored.saturating_add(1))
}

fn in_bounds(x: i32, y: i32) -> bool {
    (0..WORLD_W).contains(&x) && (0..WORLD_H).contains(&y)
}

/// A typed failure: `422 APP_ERROR` with `{ code, fields }` on the wire.
#[app::error]
pub enum Error {
    /// `createWorld` has not run yet.
    NoWorld,
    /// `createWorld` ran already: the founding parameters are fixed.
    WorldExists,
    /// One `setTiles` call carried more than `max` edits.
    TooManyEdits { max: u32 },
    /// The world already keeps avatars for `max` accounts: a new one cannot join.
    WorldFull { max: u32 },
}

/// What changed, emitted to everyone the app reaches after the write. Clients
/// re-pull state on a nudge: the event is a nudge, the state is the truth.
#[app::event]
pub enum Event {
    /// The world was founded (`createWorld`).
    Initialized,
    /// Tiles changed by this account (`setTiles`).
    TilesChanged(String),
    /// This account joined, or came back with a heartbeat after leaving.
    PlayerJoined(String),
    /// This account left.
    PlayerLeft(String),
}
