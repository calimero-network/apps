//! Mero Blocks: shared voxel-world state, on core's component SDK
//! (`calimero-app-sdk`).
//!
//! The world itself is NEVER stored here. Every client generates identical
//! terrain from `seed`; this app carries only:
//!   - **block overrides**: the diff against generated terrain (place = block
//!     id, break = 0/air). Set-only: breaking writes a 0, a key is never
//!     removed, so a client can always tell "edited to air" from "terrain".
//!   - **player presence**: name + transform, heartbeat-refreshed, on a
//!     *room clock* (the newest stamp any player wrote, ignoring stamps more
//!     than 15 minutes ahead of the caller), so a laptop with a slow or fast
//!     clock can never mark live players offline.
//!
//! The app runs on its cluster's leader, which applies every write in one
//! replicated log: a later write simply replaces an earlier one. v1's LWW merge
//! rules (`#[app::mergeable]`, the `(clock, borsh)` tie-break) had nothing left
//! to decide and are gone, and so is the per-override stamp they ordered by.
//!
//! **Who may write what** was held by v1's storage (`Frozen` world meta, each
//! account's avatars in its own `UserStorage` slot). Here every rule is a check
//! in the method, against `env::caller()`:
//!   - the world's name, seed and clock anchor are written by `init` and by no
//!     other method, so nobody (the creator included) can change them;
//!   - a player row is keyed by the caller's ACCOUNT (plus a device label the
//!     account picks), and no method takes an account argument, so an account
//!     writes only its own avatars;
//!   - the overrides stay public on purpose: anyone in the world may place or
//!     break any block.
//!
//! Access: the world's organization decides who reaches it (owner, admins,
//! members and guests, as every member of a v1 context could play). Anonymous
//! callers are refused by the node before the app runs.
//!
//! What a client sees differently from v1 (camelCase names, `u64` as decimal
//! strings, event payloads as objects, devices) is listed in
//! `apps/mero-blocks/README.md`.

use calimero_app_sdk::env::Caller;
use calimero_app_sdk::json::{u64_auto, u64_str};
use calimero_app_sdk::prelude::*;
use calimero_app_sdk::AppError;
use serde::{Deserialize, Serialize};

/// World bounds - must match `app/src/engine/world.ts`.
const WORLD_SX: i32 = 128;
const WORLD_SY: i32 = 64;
const WORLD_SZ: i32 = 128;

/// Max edits accepted per `setBlocks` call (the frontend batches at 150ms).
const MAX_EDITS_PER_CALL: usize = 512;

/// A player heard from within this window (room time) is online.
/// Frontend heartbeats every 0.5s while moving / 2s idle.
const PRESENCE_TTL_SECS: u64 = 10;

/// How far ahead of the caller's own clock a stored player stamp may be and
/// still move room time. Room time runs at the fastest member's clock, so an
/// honest laptop some minutes fast is followed; a row stamped beyond this is
/// ignored, or it would drag every stamp to the ceiling and freeze presence.
const MAX_CLOCK_SKEW_SECS: u64 = 900;

/// Avatars one account may hold (one per device it plays on).
const MAX_DEVICES_PER_ACCOUNT: u32 = 8;

/// Longest device label, in bytes.
const MAX_DEVICE_LEN: usize = 64;

/// The world's name when `init` is given none.
const DEFAULT_WORLD_NAME: &str = "overworld";

/// The most rows one read answers (`getOverrides`, `getPlayers`), and the
/// page the SDK reads at most.
const PAGE: u32 = 1000;

// ── Stored records ───────────────────────────────────────────────────────────

/// The world's identity: name, terrain seed and creation time. Also the
/// `worldMeta` answer.
#[derive(Serialize, Deserialize, Clone, Debug)]
#[serde(rename_all = "camelCase")]
pub struct WorldMeta {
    pub name: String,
    /// Terrain seed; clients generate identical terrain from it. A decimal
    /// string on the wire, in [0, 4294967296).
    #[serde(with = "u64_auto")]
    pub seed: u64,
    /// Unix seconds; the 600 s day/night cycle is counted from here. A
    /// decimal string on the wire.
    #[serde(with = "u64_auto")]
    pub created_at: u64,
}

/// A player row: presence and last known transform. Stored only, never
/// answered as is (see [`PlayerView`]).
#[derive(Serialize, Deserialize, Clone, Debug)]
#[serde(rename_all = "camelCase")]
pub struct Player {
    pub name: String,
    pub x: f64,
    pub y: f64,
    pub z: f64,
    /// Radians.
    pub yaw: f64,
    /// Radians.
    pub pitch: f64,
    /// Selected hotbar slot, 0 to 8; peers render what the player holds.
    pub sel: u8,
    /// Explicitly left; the row is kept, never removed.
    pub left: bool,
    /// Room-clock unix seconds.
    pub joined_at: u64,
    /// Room-clock unix seconds.
    pub updated_at: u64,
}

// ── Arguments and answers ────────────────────────────────────────────────────

/// One block change at a world coordinate.
#[derive(Serialize, Deserialize, Clone, Debug)]
#[serde(deny_unknown_fields)]
pub struct Edit {
    /// World x, in [0, 128).
    pub x: i32,
    /// World y, in [0, 64); y is up.
    pub y: i32,
    /// World z, in [0, 128).
    pub z: i32,
    /// Block id: 0 air, 1 grass, 2 dirt, 3 stone, 4 sand, 5 water, 6 wood, 7 leaves, 8 plank, 9 glass, 10 brick, 11 torch, 12 glowstone, 13 bedrock, 14 cobble, 15 snow.
    pub b: u8,
}

/// A player's reported transform for `heartbeat`.
#[derive(Serialize, Deserialize, Clone, Debug)]
#[serde(deny_unknown_fields)]
pub struct Transform {
    /// Display name.
    pub name: String,
    pub x: f64,
    pub y: f64,
    pub z: f64,
    /// Radians.
    pub yaw: f64,
    /// Radians.
    pub pitch: f64,
    /// Hotbar slot, 0 to 8.
    pub sel: u8,
}

/// One edited coordinate.
#[derive(Serialize, Deserialize, Clone, Debug, PartialEq, Eq)]
pub struct BlockEntry {
    /// The coordinate as "x,y,z".
    pub k: String,
    /// Block id; 0 is air.
    pub b: u8,
}

/// One page of `getOverrides`: at most `limit` entries in key order, and the
/// cursor of the next page (`null` after the last one).
#[derive(Serialize, Clone, Debug)]
pub struct OverridesPage {
    pub items: Vec<BlockEntry>,
    pub next: Option<String>,
}

/// One page of `getPlayers`: at most `limit` avatars in (account, device)
/// order, and the cursor of the next page (`null` after the last one).
#[derive(Serialize, Clone, Debug)]
pub struct PlayersPage {
    pub items: Vec<PlayerView>,
    pub next: Option<String>,
}

/// A player as other players see them.
#[derive(Serialize, Clone, Debug)]
#[serde(rename_all = "camelCase")]
pub struct PlayerView {
    /// The avatar's id: the account, or `"<account>/<device>"` for an avatar
    /// joined with a device label. What `BlocksChanged`, `PlayerJoined` and
    /// `PlayerLeft` carry.
    pub id: String,
    /// The account that owns the avatar.
    pub account: String,
    /// The device label it joined with; `""` for none.
    pub device: String,
    pub name: String,
    pub x: f64,
    pub y: f64,
    pub z: f64,
    /// Radians.
    pub yaw: f64,
    /// Radians.
    pub pitch: f64,
    /// Selected hotbar slot, 0 to 8; peers render what the player holds.
    pub sel: u8,
    /// Not left, and heard from within the last 10 s (room time).
    pub online: bool,
}

/// The world's size, read from stored counts.
#[derive(Serialize, Clone, Debug)]
#[serde(rename_all = "camelCase")]
pub struct WorldStats {
    /// Distinct coordinates ever edited, breaks included.
    #[serde(with = "u64_str")]
    pub overrides: u64,
    /// Avatar rows, left or not.
    #[serde(with = "u64_str")]
    pub players: u64,
}

// ── State ────────────────────────────────────────────────────────────────────

/// The world.
#[app::state(version = 1)]
pub struct MeroBlocks {
    /// name + seed + day-clock anchor. Every client derives the terrain from
    /// the seed, so changing it after creation would rebuild the world under
    /// everyone's edits: written by `init` only, no method sets it.
    meta: Cell<WorldMeta>,
    /// "x,y,z" -> block id. Set-only (break = 0), never removed. Public on
    /// purpose: the world is collaborative.
    overrides: UnorderedMap<String, u8>,
    /// (account, device) -> avatar. The account is always the caller's own.
    /// Rows are never removed, so this grows with everyone who ever played:
    /// it is only ever read by key or a page at a time.
    players: UnorderedMap<(String, String), Player>,
    /// (updatedAt, account, device) for every avatar row: the room clock's
    /// index. Room time is one reverse read of it (the newest stamp at most
    /// `MAX_CLOCK_SKEW_SECS` ahead of the caller), not a scan of `players`.
    /// Kept in step with `players` by `put_player`, the only writer of either.
    stamps: UnorderedMap<(u64, String, String), bool>,
}

#[app::logic]
impl MeroBlocks {
    /// Create the world. The node runs it once, when the app instance is
    /// created, with the instance's `initArgs`. Every argument may be left out
    /// (`merod local`'s scenario runner and the test harness create an
    /// instance with none): the name defaults to `"overworld"`, the seed to a
    /// random value in [0, 2^32) drawn from the run's seed, and `now` to the
    /// leader's clock at the init entry. Emits `Initialized`.
    ///
    /// # Arguments
    /// * `name` - the world's display name.
    /// * `seed` - terrain seed; clients read it as an unsigned 32-bit integer,
    ///   so use a value in [0, 4294967296). A decimal string.
    /// * `now` - the creator's unix seconds; anchors the shared 600 s
    ///   day/night cycle. A decimal string.
    #[app::init]
    pub fn init(name: Option<String>, seed: Option<u64>, now: Option<u64>) -> app::Result<Self> {
        let mut state = Self::load();
        let seed = seed.unwrap_or_else(|| {
            let bytes = env::random_bytes(4);
            let mut word = [0_u8; 4];
            for (dst, src) in word.iter_mut().zip(bytes) {
                *dst = src;
            }
            u64::from(u32::from_le_bytes(word))
        });
        state.meta.set(&WorldMeta {
            name: name.unwrap_or_else(|| DEFAULT_WORLD_NAME.to_owned()),
            seed,
            created_at: now.unwrap_or_else(|| env::time_now() / 1000),
        })?;
        env::emit(Event::Initialized, Audience::All)?;
        Ok(state)
    }

    // ── World ─────────────────────────────────────────────────────────────────

    /// The world's name, terrain seed and creation time (`createdAt`, unix
    /// seconds). `seed` and `createdAt` are decimal strings.
    ///
    /// Terrain is not stored: regenerate it from `seed`, then apply
    /// `getOverrides`.
    #[app::view]
    pub fn world_meta(&self) -> app::Result<WorldMeta> {
        match self.meta.get()? {
            Some(meta) => Ok(meta),
            None => Err(Error::Uninitialized.into()),
        }
    }

    /// Apply a batch of block edits and return how many were applied.
    ///
    /// Out-of-bounds edits are skipped, not rejected, so one stale edit cannot
    /// poison a batch. Each applied edit overwrites the block at its
    /// coordinate (one log orders every call: the later edit wins). When any
    /// edit lands, the caller's avatar is touched (kept online) and
    /// `BlocksChanged { id }` is emitted with the avatar's id.
    ///
    /// # Arguments
    /// * `edits` - at most 512 per call; `b` is a block id, 0 to 15 for ids the
    ///   client defines (`b: 0` breaks the block); any 0-255 value is stored
    ///   without checking it, so never send an id outside 0 to 15.
    /// * `now` - the caller's unix seconds (a decimal string); moves room time.
    /// * `device` - optional: the device label the caller joined with.
    ///
    /// # Errors
    /// `TooManyEdits { max, got }`, applying nothing, past 512 edits;
    /// `BadDevice` for a malformed label.
    pub fn set_blocks(
        &mut self,
        edits: Vec<Edit>,
        now: u64,
        device: Option<String>,
    ) -> app::Result<u32> {
        if edits.len() > MAX_EDITS_PER_CALL {
            return Err(Error::TooManyEdits {
                max: MAX_EDITS_PER_CALL as u32,
                got: u32::try_from(edits.len()).unwrap_or(u32::MAX),
            }
            .into());
        }
        let account = caller_account()?;
        let device = device_label(device)?;
        let room_now = self.room_now(now)?;
        let mut applied: u32 = 0;
        for e in edits {
            if !in_bounds(e.x, e.y, e.z) {
                continue;
            }
            let _previous = self
                .overrides
                .insert(&format!("{},{},{}", e.x, e.y, e.z), &e.b)?;
            applied += 1;
        }
        if applied > 0 {
            self.touch_player(&account, &device, room_now)?;
            env::emit(
                Event::BlocksChanged {
                    id: player_id(&account, &device),
                },
                Audience::All,
            )?;
        }
        Ok(applied)
    }

    /// One page of the edited coordinates, each `{"k": "x,y,z", "b": <block
    /// id>}`, in key order, and the cursor of the next page.
    ///
    /// A key never disappears: a broken block stays listed with `b: 0`. Any
    /// coordinate not listed holds generated terrain. The map only grows (up
    /// to 128 x 64 x 128 coordinates), so it is answered a page at a time:
    /// call again with `cursor` set to `next` until `next` is `null`.
    ///
    /// # Arguments
    /// * `cursor` - optional: the `next` of the previous page; from the start
    ///   without it.
    /// * `limit` - optional: entries per page, at most (and by default) 1,000.
    #[app::view]
    pub fn get_overrides(
        &self,
        cursor: Option<String>,
        limit: Option<u32>,
    ) -> app::Result<OverridesPage> {
        let page = self.overrides.page(page_opts(cursor, limit))?;
        Ok(OverridesPage {
            items: page
                .items
                .into_iter()
                .map(|(k, b)| BlockEntry { k, b })
                .collect(),
            next: page.next,
        })
    }

    /// How many distinct coordinates have ever been edited, breaks included (a
    /// stored count, not a scan). A number, as in v1.
    #[app::view]
    pub fn override_count(&self) -> app::Result<u32> {
        Ok(u32::try_from(self.overrides.len()?).unwrap_or(u32::MAX))
    }

    /// How many overrides and avatar rows the world holds (stored counts). New:
    /// `u64`s, so decimal strings.
    #[app::view]
    pub fn world_stats(&self) -> app::Result<WorldStats> {
        Ok(WorldStats {
            overrides: self.overrides.len()?,
            players: self.players.len()?,
        })
    }

    // ── Players ───────────────────────────────────────────────────────────────

    /// Join or rejoin the world as the caller's avatar (the account, plus
    /// `device` when given) and return the player row.
    ///
    /// A rejoin keeps the player's position and join time and updates the
    /// name; a new avatar starts at the origin. Emits `PlayerJoined { id }`.
    ///
    /// # Arguments
    /// * `name` - display name shown to other players.
    /// * `now` - the caller's unix seconds (a decimal string).
    /// * `device` - optional: a label for this device (1-64 of `A-Za-z0-9_-`),
    ///   so one account on two devices is two avatars. At most 8 per account.
    ///
    /// # Errors
    /// `BadDevice`, `TooManyDevices { max }`.
    pub fn join(
        &mut self,
        name: String,
        now: u64,
        device: Option<String>,
    ) -> app::Result<PlayerView> {
        let account = caller_account()?;
        let device = device_label(device)?;
        let existing = self.player(&account, &device)?;
        let joined_at = existing.as_ref().map_or(now, |p| p.joined_at);
        let stored = existing.as_ref().map_or(0, |p| p.updated_at);
        let (x, y, z) = existing
            .as_ref()
            .map_or((0.0, 0.0, 0.0), |p| (p.x, p.y, p.z));
        let updated_at = stamp(self.room_now(now)?, stored);

        let player = Player {
            name,
            x,
            y,
            z,
            yaw: 0.0,
            pitch: 0.0,
            sel: 0,
            left: false,
            joined_at,
            updated_at,
        };
        self.put_player(
            &account,
            &device,
            &player,
            existing.as_ref().map(|p| p.updated_at),
        )?;
        let id = player_id(&account, &device);
        env::emit(Event::PlayerJoined { id }, Audience::All)?;
        Ok(view_of(&account, &device, &player, true))
    }

    /// Report the caller's position and keep the avatar online.
    ///
    /// Send every 0.5 s while moving and every 2 s while idle; a player silent
    /// for more than 10 s shows as offline. Creates the row if needed. Emits
    /// `PlayerJoined` only when this creates the row or brings a left player
    /// back; otherwise no event (peers poll `getPlayers`, so a routine
    /// heartbeat must not spam an event on every call).
    ///
    /// # Arguments
    /// * `t` - position in blocks, `yaw` and `pitch` in radians, `sel` the
    ///   hotbar slot (0 to 8).
    /// * `now` - the caller's unix seconds (a decimal string).
    /// * `device` - optional: the device label the caller joined with.
    ///
    /// # Errors
    /// `BadDevice`, `TooManyDevices { max }`.
    pub fn heartbeat(&mut self, t: Transform, now: u64, device: Option<String>) -> app::Result<()> {
        let account = caller_account()?;
        let device = device_label(device)?;
        let existing = self.player(&account, &device)?;
        let joined_at = existing.as_ref().map_or(now, |p| p.joined_at);
        let stored = existing.as_ref().map_or(0, |p| p.updated_at);
        let was_left = existing.as_ref().is_none_or(|p| p.left);
        let updated_at = stamp(self.room_now(now)?, stored);

        let player = Player {
            name: t.name,
            x: t.x,
            y: t.y,
            z: t.z,
            yaw: t.yaw,
            pitch: t.pitch,
            sel: t.sel,
            left: false,
            joined_at,
            updated_at,
        };
        self.put_player(
            &account,
            &device,
            &player,
            existing.as_ref().map(|p| p.updated_at),
        )?;
        // back after a leave (or a first heartbeat without join): announce
        if was_left {
            let id = player_id(&account, &device);
            env::emit(Event::PlayerJoined { id }, Audience::All)?;
        }
        Ok(())
    }

    /// Mark the caller's avatar as having left. The row is kept, and a later
    /// `join` or `heartbeat` brings the player back. An avatar that never
    /// joined is a no-op (no event). Emits `PlayerLeft { id }`.
    ///
    /// # Arguments
    /// * `now` - the caller's unix seconds (a decimal string).
    /// * `device` - optional: the device label the caller joined with.
    pub fn leave(&mut self, now: u64, device: Option<String>) -> app::Result<()> {
        let account = caller_account()?;
        let device = device_label(device)?;
        let Some(mut p) = self.player(&account, &device)? else {
            return Ok(());
        };
        let old_stamp = p.updated_at;
        p.left = true;
        p.updated_at = stamp(self.room_now(now)?, old_stamp);
        self.put_player(&account, &device, &p, Some(old_stamp))?;
        let id = player_id(&account, &device);
        env::emit(Event::PlayerLeft { id }, Audience::All)?;
        Ok(())
    }

    /// One page of avatar rows with an `online` flag, in (account, device)
    /// order, and the cursor of the next page.
    ///
    /// A player is online when they have not left and wrote within the last
    /// 10 s, measured on room time. A player who vanished without calling
    /// `leave` simply ages out here; nobody writes to another account's row.
    /// Rows are kept for everyone who ever played, so they are answered a page
    /// at a time: call again with `cursor` set to `next` until `next` is
    /// `null`.
    ///
    /// # Arguments
    /// * `now` - the caller's unix seconds (a decimal string).
    /// * `cursor` - optional: the `next` of the previous page.
    /// * `limit` - optional: rows per page, at most (and by default) 1,000.
    #[app::view]
    pub fn get_players(
        &self,
        now: u64,
        cursor: Option<String>,
        limit: Option<u32>,
    ) -> app::Result<PlayersPage> {
        let room_now = self.room_now(now)?;
        let page = self.players.page(page_opts(cursor, limit))?;
        Ok(PlayersPage {
            items: page
                .items
                .iter()
                .map(|((account, device), p)| {
                    let online =
                        !p.left && room_now.saturating_sub(p.updated_at) <= PRESENCE_TTL_SECS;
                    view_of(account, device, p, online)
                })
                .collect(),
            next: page.next,
        })
    }

    /// The caller's account, as `PlayerView.account` and the `id` of an avatar
    /// joined without a device show it. New: the frontend's "me".
    #[app::view]
    pub fn my_account(&self) -> app::Result<String> {
        caller_account()
    }

    // ── helpers (not methods: no `pub`) ──────────────────────────────────────

    /// Normalize the caller's clock onto room time: the caller's clock, moved
    /// up to the newest row stamp at most `MAX_CLOCK_SKEW_SECS` ahead of it.
    /// One reverse read of the `stamps` index, however many rows there are.
    /// ALL liveness math goes through this; compute it once per call.
    fn room_now(&self, caller_now: u64) -> app::Result<u64> {
        let ceiling = caller_now.saturating_add(MAX_CLOCK_SKEW_SECS);
        let newest = self.stamps.page(
            FindOpts::default()
                .reverse()
                .to(vec![KeyPart::Int(i128::from(ceiling) + 1)])
                .limit(1),
        )?;
        Ok(newest
            .items
            .first()
            .map_or(caller_now, |((ts, _, _), _)| caller_now.max(*ts)))
    }

    fn player(&self, account: &str, device: &str) -> app::Result<Option<Player>> {
        Ok(self.players.get(&(account.to_owned(), device.to_owned()))?)
    }

    /// Upsert the caller's own row, and its entry in the `stamps` index.
    /// `old_stamp` is the stored row's `updatedAt`, `None` for a new row; a new
    /// row is refused past `MAX_DEVICES_PER_ACCOUNT` avatars for the account,
    /// which bounds the rows to (members of the org) x 8.
    fn put_player(
        &mut self,
        account: &str,
        device: &str,
        player: &Player,
        old_stamp: Option<u64>,
    ) -> app::Result<()> {
        match old_stamp {
            None => {
                let held = self
                    .players
                    .prefix(
                        &[KeyPart::Str(account.to_owned())],
                        FindOpts::default().limit(MAX_DEVICES_PER_ACCOUNT),
                    )?
                    .items
                    .len();
                if held >= MAX_DEVICES_PER_ACCOUNT as usize {
                    return Err(Error::TooManyDevices {
                        max: MAX_DEVICES_PER_ACCOUNT,
                    }
                    .into());
                }
            }
            Some(old) if old != player.updated_at => {
                let _removed = self
                    .stamps
                    .remove(&(old, account.to_owned(), device.to_owned()))?;
            }
            Some(_) => {}
        }
        let _previous = self
            .players
            .insert(&(account.to_owned(), device.to_owned()), player)?;
        let _previous = self.stamps.insert(
            &(player.updated_at, account.to_owned(), device.to_owned()),
            &true,
        )?;
        Ok(())
    }

    fn touch_player(&mut self, account: &str, device: &str, room_now: u64) -> app::Result<()> {
        let Some(mut p) = self.player(account, device)? else {
            return Ok(());
        };
        let old_stamp = p.updated_at;
        p.updated_at = stamp(room_now, old_stamp);
        self.put_player(account, device, &p, Some(old_stamp))
    }
}

/// A typed failure: `422 APP_ERROR` with `{ code, fields }` on the wire.
#[app::error]
pub enum Error {
    /// More than 512 edits in one `setBlocks` (v1: an untyped "too many edits
    /// in one batch").
    TooManyEdits { max: u32, got: u32 },
    /// A device label that is not 1-64 of `A-Za-z0-9_-`.
    BadDevice { device: String },
    /// A ninth avatar for one account.
    TooManyDevices { max: u32 },
    /// The world has no meta (cannot happen after `init`).
    Uninitialized,
}

/// What happened in the world, emitted after the write that caused it, to
/// everyone the app reaches.
#[app::event]
pub enum Event {
    /// The world was created.
    Initialized,
    /// Blocks were edited; `id` is the editor's avatar. Re-read `getOverrides`.
    BlocksChanged { id: String },
    /// A player joined or came back online; `id` is their avatar.
    PlayerJoined { id: String },
    /// A player left; `id` is their avatar.
    PlayerLeft { id: String },
}

// ── free helpers ─────────────────────────────────────────────────────────────

/// The caller's account. Every method needs one: the node already refuses
/// anonymous callers, and System/app callers are not allowed on any method.
fn caller_account() -> app::Result<String> {
    match env::caller() {
        Caller::Account(account) | Caller::ApiKey { account, .. } => Ok(account),
        Caller::Public | Caller::System | Caller::App(_) => Err(AppError::login_required()),
    }
}

/// `""` for no device; else 1-64 bytes of `A-Za-z0-9_-`.
fn device_label(device: Option<String>) -> app::Result<String> {
    let device = device.unwrap_or_default();
    let ok = device.len() <= MAX_DEVICE_LEN
        && device
            .bytes()
            .all(|b| b.is_ascii_alphanumeric() || b == b'_' || b == b'-');
    if ok {
        Ok(device)
    } else {
        Err(Error::BadDevice { device }.into())
    }
}

/// The avatar's id: the account, or `"<account>/<device>"`.
fn player_id(account: &str, device: &str) -> String {
    if device.is_empty() {
        account.to_owned()
    } else {
        format!("{account}/{device}")
    }
}

fn in_bounds(x: i32, y: i32, z: i32) -> bool {
    (0..WORLD_SX).contains(&x) && (0..WORLD_SY).contains(&y) && (0..WORLD_SZ).contains(&z)
}

/// Find options for one page of a read: from `cursor`, at most `limit` rows
/// (1,000 by default and at most).
fn page_opts(cursor: Option<String>, limit: Option<u32>) -> FindOpts {
    let opts = FindOpts::default().limit(limit.unwrap_or(PAGE).min(PAGE));
    match cursor {
        Some(cursor) => opts.cursor(cursor),
        None => opts,
    }
}

/// Value to write into a row: room time, strictly past the stored stamp (a
/// backward clock must never freeze liveness).
fn stamp(room_now: u64, stored: u64) -> u64 {
    room_now.max(stored.saturating_add(1))
}

fn view_of(account: &str, device: &str, p: &Player, online: bool) -> PlayerView {
    PlayerView {
        id: player_id(account, device),
        account: account.to_owned(),
        device: device.to_owned(),
        name: p.name.clone(),
        x: p.x,
        y: p.y,
        z: p.z,
        yaw: p.yaw,
        pitch: p.pitch,
        sel: p.sel,
        online,
    }
}
