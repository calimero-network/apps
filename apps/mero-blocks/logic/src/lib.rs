//! Mero Blocks — shared voxel-world state on Calimero.
//!
//! The world itself is NEVER stored here. Every client generates identical
//! terrain from `seed`; this contract carries only:
//!   - **block overrides** — the diff against generated terrain (place = block
//!     id, break = 0/air). Set-only map: breaking writes a 0 value, we never
//!     `remove` a key (the UnorderedSet/insert-after-remove tombstone class of
//!     bugs is designed out).
//!   - **player presence** — name + transform, heartbeat-refreshed, with the
//!     mero-meet room-clock normalization so clock skew between laptops can
//!     never mark live players offline.
//!
//! Who may write what is held by storage, on every node, not by the checks
//! here: the world's name/seed/clock are `Frozen` at creation, and each
//! account's avatars sit in that account's `UserStorage` slot. The overrides
//! stay a public map on purpose — anyone may place or break any block.
//!
//! Lighting and chunk data are client-derived from (seed, overrides) and cost
//! zero network traffic.

use std::cmp::Ordering;

use calimero_sdk::abi::AbiType;
use calimero_sdk::borsh::{BorshDeserialize, BorshSerialize};
use calimero_sdk::serde::{Deserialize, Serialize};
use calimero_sdk::{app, env as sdk_env, PublicKey};
use calimero_storage::collections::crdt_meta::MergeError;
use calimero_storage::collections::{
    Frozen, Mergeable as MergeableTrait, UnorderedMap, UserStorage,
};

type MemberId = String;

/// World bounds — must match `app/src/engine/world.ts`.
const WORLD_SX: i32 = 128;
const WORLD_SY: i32 = 64;
const WORLD_SZ: i32 = 128;

/// Max edits accepted per `set_blocks` call (the frontend batches at 150ms).
const MAX_EDITS_PER_CALL: usize = 512;

/// A player heard from within this window (room time) is online.
/// Frontend heartbeats every 1s while moving / 3s idle.
const PRESENCE_TTL_SECS: u64 = 10;

/// How far ahead of the caller's own clock a stored player stamp may be and
/// still move room time. Room time runs at the fastest member's clock, so an
/// honest laptop some minutes fast is followed; a row stamped beyond this
/// (a patched node writing `u64::MAX` into its own row) is ignored, or it
/// would drag every stamp to the ceiling and freeze presence for good.
const MAX_CLOCK_SKEW_SECS: u64 = 900;

// ── LWW convergence helper ───────────────────────────────────────────────────

/// Take `other` iff it wins a **total order** of (clock, canonical borsh bytes).
///
/// A bare `other.ts > self.ts` is not commutative, and from core 0.11.0-rc.32
/// that is a live bug rather than a latent one. At an exact clock tie with
/// differing content each replica keeps its own copy: `merge` changes nothing
/// on either side, so re-merging never closes the gap and the two stay
/// divergent permanently, with no error. Breaking the tie on the borsh
/// encoding — a total order over values — makes both replicas elect the same
/// winner independently, which is what convergence requires.
///
/// Before [core#3807] a collection value's `merge` was never called (entries
/// resolved last-write-wins by write ORDER), so these rules were dead code and
/// the tie could not be observed. `#[app::mergeable]` turns them on.
///
/// [core#3807]: https://github.com/calimero-network/core/pull/3807
fn lww_take<T: BorshSerialize>(mine_ts: u64, theirs_ts: u64, mine: &T, theirs: &T) -> bool {
    match theirs_ts.cmp(&mine_ts) {
        Ordering::Greater => true,
        Ordering::Less => false,
        // Equal clocks: decide on the canonical encoding, so both replicas
        // elect the same side.
        //
        // Infallible on purpose. Core's contract for a dispatched merge
        // requires a TOTAL rule — "`Err` is not validation, it is a refusal to
        // converge: the entity stays divergent and repair retries it
        // indefinitely" — so this must not surface an encoding error. A value
        // that came back out of storage was borsh-encoded to get there, which
        // is why the fallback is unreachable rather than merely unlikely.
        Ordering::Equal => {
            let encode = |v: &T| calimero_sdk::borsh::to_vec(v).unwrap_or_default();
            encode(theirs) > encode(mine)
        }
    }
}

// ── Stored records ───────────────────────────────────────────────────────────

/// A stored block edit: block id `b` and the stamp that orders concurrent edits.
#[app::mergeable(id = "mero_blocks::BlockOverride")]
#[derive(BorshSerialize, BorshDeserialize, Serialize, Deserialize, AbiType, Clone, Debug)]
#[borsh(crate = "calimero_sdk::borsh")]
#[serde(crate = "calimero_sdk::serde")]
#[serde(rename_all = "camelCase")]
pub struct BlockOverride {
    /// Block id, 0 to 15; 0 is air (a broken block).
    pub b: u8,
    /// Room-clock unix seconds; the larger stamp wins when two players edit one block.
    pub updated_at: u64,
}

impl MergeableTrait for BlockOverride {
    fn merge(&mut self, other: &Self) -> Result<(), MergeError> {
        if lww_take(self.updated_at, other.updated_at, self, other) {
            *self = other.clone();
        }
        Ok(())
    }
}

/// A player row: presence and last known transform, keyed by the player's identity.
#[app::mergeable(id = "mero_blocks::Player")]
#[derive(BorshSerialize, BorshDeserialize, Serialize, Deserialize, AbiType, Clone, Debug)]
#[borsh(crate = "calimero_sdk::borsh")]
#[serde(crate = "calimero_sdk::serde")]
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
    /// explicitly left; row is kept, never removed
    pub left: bool,
    /// Room-clock unix seconds.
    pub joined_at: u64,
    /// Room-clock unix seconds.
    pub updated_at: u64,
}

impl MergeableTrait for Player {
    fn merge(&mut self, other: &Self) -> Result<(), MergeError> {
        // pure LWW on the heartbeat clock; joined_at is immutable after join
        if lww_take(self.updated_at, other.updated_at, self, other) {
            *self = other.clone();
        }
        Ok(())
    }
}

/// One account's avatars, keyed by device (see `caller`). The slot belongs to
/// the account, and so does the map nested in it: every node refuses another
/// account's write to either, so nobody can move, rename or evict someone
/// else's avatar, or squat a device id before its owner first joins.
#[derive(BorshSerialize, BorshDeserialize, AbiType, Default, app::Mergeable)]
#[borsh(crate = "calimero_sdk::borsh")]
pub struct Avatars {
    devices: UnorderedMap<MemberId, Player>,
}

// ── Views / args ─────────────────────────────────────────────────────────────

/// The world's identity: name, terrain seed and creation time.
#[derive(
    BorshSerialize, BorshDeserialize, Serialize, Deserialize, AbiType, Clone, Debug, Default,
)]
#[borsh(crate = "calimero_sdk::borsh")]
#[serde(crate = "calimero_sdk::serde")]
#[serde(rename_all = "camelCase")]
pub struct WorldMeta {
    pub name: String,
    /// Terrain seed; clients generate identical terrain from it.
    pub seed: u64,
    /// Unix seconds; the 600 s day/night cycle is counted from here.
    pub created_at: u64,
}

/// One block change at a world coordinate.
#[derive(BorshSerialize, BorshDeserialize, Serialize, Deserialize, AbiType, Clone, Debug)]
#[borsh(crate = "calimero_sdk::borsh")]
#[serde(crate = "calimero_sdk::serde")]
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
#[derive(BorshSerialize, BorshDeserialize, Serialize, Deserialize, AbiType, Clone, Debug)]
#[borsh(crate = "calimero_sdk::borsh")]
#[serde(crate = "calimero_sdk::serde")]
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
#[derive(BorshSerialize, BorshDeserialize, Serialize, Deserialize, AbiType, Clone, Debug)]
#[borsh(crate = "calimero_sdk::borsh")]
#[serde(crate = "calimero_sdk::serde")]
#[serde(rename_all = "camelCase")]
pub struct BlockEntry {
    /// The coordinate as "x,y,z".
    pub k: String,
    /// Block id; 0 is air.
    pub b: u8,
}

/// A player as other players see them.
#[derive(BorshSerialize, BorshDeserialize, Serialize, Deserialize, AbiType, Clone, Debug)]
#[borsh(crate = "calimero_sdk::borsh")]
#[serde(crate = "calimero_sdk::serde")]
#[serde(rename_all = "camelCase")]
pub struct PlayerView {
    pub id: MemberId,
    pub name: String,
    pub x: f64,
    pub y: f64,
    pub z: f64,
    pub yaw: f64,
    pub pitch: f64,
    pub sel: u8,
    /// Not left, and heard from within the last 10 s.
    pub online: bool,
}

// ── Events ───────────────────────────────────────────────────────────────────

#[app::event]
pub enum Event {
    /// The world was created.
    Initialized(),
    /// Blocks were edited; the payload is the editor's identity. Re-read `get_overrides`.
    BlocksChanged(MemberId),
    /// A player joined or came back online; the payload is their identity.
    PlayerJoined(MemberId),
    /// A player left or was set to left for silence; the payload is their identity.
    PlayerLeft(MemberId),
}

// ── State ────────────────────────────────────────────────────────────────────

#[app::state(emits = Event)]
pub struct MeroBlocks {
    /// name + seed + day-clock anchor. Every client derives the terrain from
    /// the seed, so changing it after creation would rebuild the world under
    /// everyone's edits: frozen, nobody (the creator included) can.
    meta: Frozen<WorldMeta>,
    /// "x,y,z" -> override. Set-only (break = b:0), never removed. Public on
    /// purpose: the world is collaborative.
    overrides: UnorderedMap<String, BlockOverride>,
    players: UserStorage<Avatars>,
}

#[app::logic]
impl MeroBlocks {
    /// Create the world. Runs once, when the context is created, with the
    /// context's init arguments.
    ///
    /// # Arguments
    /// * `name` - the world's display name.
    /// * `seed` - terrain seed; clients read it as an unsigned 32-bit integer, so use
    ///   a value in [0, 4294967296).
    /// * `now` - the creator's unix seconds; anchors the shared 600 s day/night cycle.
    ///
    /// # Examples
    /// ```json
    /// {"name":"ci","seed":42,"now":1727000000}
    /// ```
    #[app::init]
    pub fn init(name: String, seed: u64, now: u64) -> MeroBlocks {
        app::emit!(Event::Initialized());
        MeroBlocks {
            meta: Frozen::new(WorldMeta {
                name,
                seed,
                created_at: now,
            }),
            overrides: UnorderedMap::new(),
            players: UserStorage::new(),
        }
    }

    /// The real signer of this invocation. Never trust a client-supplied id.
    ///
    /// **`device_id()` on purpose, and it stays that way at rc.23.** The rule
    /// core states for the account/device split is that an identity used for
    /// OWNERSHIP takes the account: writer sets, `Map<identity, Vote>`, "is the
    /// caller the owner/a member". This contract has none of those — it stores
    /// no owner, no roles, and never compares a caller against the group's
    /// member list (membership is enforced by the node before a call reaches us,
    /// and group members are accounts now anyway).
    ///
    /// What it keys by this value is a PLAYER ROW: a name, a transform and a
    /// heartbeat — presence for one running instance of the game. That is the
    /// "this installation" case the split keeps `device_id()` for. Two devices of
    /// one person are two avatars standing in two places, and they must be:
    /// `account_id()` would collapse them onto one row whose position is decided
    /// by whichever device heartbeated last, so an idle phone would teleport the
    /// laptop's avatar every second.
    ///
    /// Ownership still goes by account: the rows live in the caller's
    /// `UserStorage` slot, keyed inside it by this device id.
    ///
    /// It is also the id the frontend already holds: `device_id()` is the
    /// context's `executor_public_key`, which is exactly what
    /// `/admin-api/contexts/:id/identities-owned` hands the client as "me". An
    /// account here would make every `p.id === myId` comparison false.
    ///
    /// `env::executor_id()` is deliberately not used: at rc.23 that shim resolves
    /// to the ACCOUNT (core #3510), so it no longer means what it did when this
    /// file was written against rc.20.
    fn caller() -> PublicKey {
        sdk_env::device_id().into()
    }

    fn caller_id() -> MemberId {
        String::from(Self::caller())
    }

    // ── Room time (skew-proof liveness clock, from mero-meet) ────────────────

    /// Every avatar row, `(device id, row)`. The id is the map key, never a
    /// field an account could fill in with someone else's.
    fn all_players(&self) -> Vec<(MemberId, Player)> {
        let mut rows = Vec::new();
        if let Ok(slots) = self.players.entries() {
            for (_, avatars) in slots {
                if let Ok(devices) = avatars.devices.entries() {
                    rows.extend(devices);
                }
            }
        }
        rows
    }

    /// Normalize the caller's clock onto room time (runs at the fastest
    /// member's clock, up to `MAX_CLOCK_SKEW_SECS` ahead). ALL liveness math
    /// goes through this; compute it once per call.
    fn room_now(&self, caller_now: u64) -> u64 {
        let ceiling = caller_now.saturating_add(MAX_CLOCK_SKEW_SECS);
        self.all_players()
            .into_iter()
            .map(|(_, p)| p.updated_at)
            .filter(|ts| *ts <= ceiling)
            .fold(caller_now, u64::max)
    }

    /// Value to write into a row: room time, strictly past the stored stamp
    /// (a backward clock must never freeze liveness or lose the LWW merge).
    fn stamp(room_now: u64, stored: u64) -> u64 {
        room_now.max(stored.saturating_add(1))
    }

    // ── World ─────────────────────────────────────────────────────────────────

    /// The world's name, terrain seed and creation time (`createdAt`, unix seconds).
    ///
    /// Terrain is not stored: regenerate it from `seed`, then apply `get_overrides`.
    ///
    /// # Returns
    /// The world's `name`, `seed` and `createdAt` (unix seconds).
    ///
    /// # Errors
    /// Fails if reading the world's metadata from storage fails.
    ///
    /// # Examples
    /// ```json
    /// {}
    /// ```
    pub fn world_meta(&self) -> app::Result<WorldMeta> {
        Ok(self.meta.get()?.clone())
    }

    fn in_bounds(x: i32, y: i32, z: i32) -> bool {
        x >= 0 && y >= 0 && z >= 0 && x < WORLD_SX && y < WORLD_SY && z < WORLD_SZ
    }

    /// Apply a batch of block edits and return how many were applied.
    ///
    /// Out-of-bounds edits are skipped, not rejected, so one stale edit cannot
    /// poison a batch. Each applied edit overwrites the block at its coordinate.
    ///
    /// # Arguments
    /// * `edits` - at most 512 per call; `b` is a block id from 0 to 15, and `b: 0` breaks the block.
    /// * `now` - the caller's unix seconds; orders concurrent edits of one block (last writer wins).
    ///
    /// # Returns
    /// How many edits were applied; skipped out-of-bounds edits are not counted.
    ///
    /// # Errors
    /// Fails, applying nothing, if more than 512 edits are sent in one call.
    ///
    /// # Examples
    /// ```json
    /// {"edits":[{"x":5,"y":20,"z":5,"b":3}],"now":1727000000}
    /// ```
    pub fn set_blocks(&mut self, edits: Vec<Edit>, now: u64) -> app::Result<u32> {
        if edits.len() > MAX_EDITS_PER_CALL {
            app::bail!("too many edits in one batch");
        }
        let id = Self::caller_id();
        let room_now = self.room_now(now);
        let mut applied: u32 = 0;
        for e in edits {
            if !Self::in_bounds(e.x, e.y, e.z) {
                continue;
            }
            let key = format!("{},{},{}", e.x, e.y, e.z);
            let stored = match self.overrides.get(&key) {
                Ok(Some(o)) => o.updated_at,
                _ => 0,
            };
            let updated_at = Self::stamp(room_now, stored);
            self.overrides
                .insert(key, BlockOverride { b: e.b, updated_at })?;
            applied += 1;
        }
        if applied > 0 {
            self.touch_player(&id, room_now)?;
            app::emit!(Event::BlocksChanged(id));
        }
        Ok(applied)
    }

    /// Every edited coordinate as `{"k": "x,y,z", "b": <block id>}`.
    ///
    /// A key never disappears: a broken block stays listed with `b: 0`. Any
    /// coordinate not listed holds generated terrain.
    ///
    /// # Returns
    /// Every edited coordinate as `{"k": "x,y,z", "b": <block id>}`, breaks included.
    ///
    /// # Examples
    /// ```json
    /// {}
    /// ```
    pub fn get_overrides(&self) -> Vec<BlockEntry> {
        self.overrides
            .entries()
            .map(|e| e.map(|(k, o)| BlockEntry { k, b: o.b }).collect())
            .unwrap_or_default()
    }

    /// How many distinct coordinates have ever been edited, breaks included.
    ///
    /// # Returns
    /// The number of distinct coordinates ever edited.
    ///
    /// # Examples
    /// ```json
    /// {}
    /// ```
    pub fn override_count(&self) -> u32 {
        self.overrides.entries().map(|e| e.count()).unwrap_or(0) as u32
    }

    // ── Players ───────────────────────────────────────────────────────────────

    /// This device's row, from the caller's own slot.
    fn my_player(&self, id: &MemberId) -> app::Result<Option<Player>> {
        Ok(match self.players.get()? {
            Some(avatars) => avatars.devices.get(id)?.map(|p| p.clone()),
            None => None,
        })
    }

    /// Upsert this device's row into the caller's own slot.
    fn put_player(&mut self, id: MemberId, player: Player) -> app::Result<()> {
        if let Some(mut avatars) = self.players.get()? {
            let _ = avatars.devices.insert(id, player)?;
        } else {
            let mut devices = UnorderedMap::new();
            let _ = devices.insert(id, player)?;
            let _ = self.players.insert(Avatars { devices })?;
        }
        Ok(())
    }

    /// Join or rejoin the world as the calling identity and return the player row.
    ///
    /// A rejoin keeps the player's position and join time and updates the name.
    /// Emits `PlayerJoined`.
    ///
    /// # Arguments
    /// * `name` - display name shown to other players.
    /// * `now` - the caller's unix seconds.
    ///
    /// # Returns
    /// The caller's player row, online.
    ///
    /// # Examples
    /// ```json
    /// {"name":"bot","now":1727000000}
    /// ```
    pub fn join(&mut self, name: String, now: u64) -> app::Result<PlayerView> {
        let id = Self::caller_id();
        let existing = self.my_player(&id)?;
        let joined_at = existing.as_ref().map(|p| p.joined_at).unwrap_or(now);
        let stored = existing.as_ref().map(|p| p.updated_at).unwrap_or(0);
        let (x, y, z) = existing
            .as_ref()
            .map(|p| (p.x, p.y, p.z))
            .unwrap_or((0.0, 0.0, 0.0));
        let updated_at = Self::stamp(self.room_now(now), stored);

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
        self.put_player(id.clone(), player.clone())?;
        app::emit!(Event::PlayerJoined(id.clone()));
        Ok(Self::view_of(id, &player, true))
    }

    /// Report the caller's position and keep them online.
    ///
    /// Send every 0.5 s while moving and every 2 s while idle; a player silent
    /// for more than 10 s shows as offline. Creates the player row if needed.
    /// Silent, except that returning from a `left` state emits `PlayerJoined`
    /// to announce the player is back (peers poll `get_players`, so a routine
    /// heartbeat must not spam an event on every call).
    ///
    /// # Arguments
    /// * `t` - position in blocks, `yaw` and `pitch` in radians, `sel` the hotbar slot (0 to 8).
    /// * `now` - the caller's unix seconds.
    ///
    /// # Examples
    /// ```json
    /// {"t":{"name":"bot","x":64.5,"y":44.0,"z":64.5,"yaw":0.0,"pitch":0.0,"sel":0},"now":1727000000}
    /// ```
    pub fn heartbeat(&mut self, t: Transform, now: u64) -> app::Result<()> {
        let id = Self::caller_id();
        let existing = self.my_player(&id)?;
        let joined_at = existing.as_ref().map(|p| p.joined_at).unwrap_or(now);
        let stored = existing.as_ref().map(|p| p.updated_at).unwrap_or(0);
        let was_left = existing.as_ref().map(|p| p.left).unwrap_or(true);
        let updated_at = Self::stamp(self.room_now(now), stored);

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
        self.put_player(id.clone(), player)?;
        // back after a leave (or a first heartbeat without join): announce
        if was_left {
            app::emit!(Event::PlayerJoined(id));
        }
        Ok(())
    }

    /// Mark the caller as having left. The row is kept, and a later `join` or
    /// `heartbeat` brings the player back. A caller who never joined is a no-op.
    ///
    /// # Arguments
    /// * `now` - the caller's unix seconds.
    ///
    /// # Examples
    /// ```json
    /// {"now":1727000000}
    /// ```
    pub fn leave(&mut self, now: u64) -> app::Result<()> {
        let id = Self::caller_id();
        let Some(mut p) = self.my_player(&id)? else {
            return Ok(());
        };
        p.left = true;
        p.updated_at = Self::stamp(self.room_now(now), p.updated_at);
        self.put_player(id.clone(), p)?;
        app::emit!(Event::PlayerLeft(id));
        Ok(())
    }

    /// Every player row with an `online` flag.
    ///
    /// A player is online when they have not left and wrote within the last 10 s,
    /// measured against the newest clock any player has reported. A player who
    /// vanished without calling `leave` simply ages out here; nobody writes to
    /// another account's row to mark it left.
    ///
    /// # Arguments
    /// * `now` - the caller's unix seconds.
    ///
    /// # Returns
    /// Every player row with its `online` flag.
    ///
    /// # Examples
    /// ```json
    /// {"now":1727000000}
    /// ```
    pub fn get_players(&self, now: u64) -> Vec<PlayerView> {
        let room_now = self.room_now(now);
        self.all_players()
            .into_iter()
            .map(|(id, p)| {
                let online = !p.left && room_now.saturating_sub(p.updated_at) <= PRESENCE_TTL_SECS;
                Self::view_of(id, &p, online)
            })
            .collect()
    }

    fn view_of(id: MemberId, p: &Player, online: bool) -> PlayerView {
        PlayerView {
            id,
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

    fn touch_player(&mut self, id: &MemberId, room_now: u64) -> app::Result<()> {
        let Some(mut p) = self.my_player(id)? else {
            return Ok(());
        };
        p.updated_at = Self::stamp(room_now, p.updated_at);
        self.put_player(id.clone(), p)
    }
}

// ── Tests ────────────────────────────────────────────────────────────────────

#[cfg(test)]
mod tests {
    use super::*;
    use calimero_sdk::testing::TestHost;
    use calimero_sdk::AccountId;

    const ALICE: [u8; 32] = [0x11; 32];
    const BOB: [u8; 32] = [0x22; 32];

    /// Render an id the way the contract does.
    ///
    /// `caller_id()` is `String::from(PublicKey)`, so the SDK chooses this, not
    /// the test. core 0.11.0-rc.27 removed base58 (core#3691) and `Hash`'s
    /// Display is `hex::encode`, which silently changed what the contract
    /// emits. This was `bs58::encode`, and every id assertion below compared
    /// against the wrong string the moment the SDK moved.
    fn id_of(bytes: [u8; 32]) -> String {
        hex::encode(bytes)
    }

    fn new_world() -> TestHost<MeroBlocks> {
        TestHost::new(|| MeroBlocks::init("overworld".to_owned(), 1337, 1000))
    }

    fn t(name: &str, x: f64) -> Transform {
        Transform {
            name: name.to_owned(),
            x,
            y: 30.0,
            z: 64.0,
            yaw: 0.0,
            pitch: 0.0,
            sel: 0,
        }
    }

    #[test]
    fn world_meta_returns_init_params() {
        let app = new_world();
        let meta = app.view(|s| s.world_meta()).unwrap();
        assert_eq!(meta.name, "overworld");
        assert_eq!(meta.seed, 1337);
        assert_eq!(meta.created_at, 1000);
    }

    #[test]
    fn set_blocks_roundtrips_through_get_overrides() {
        let mut app = new_world();
        app.call_as(ALICE, |s| {
            s.set_blocks(
                vec![
                    Edit {
                        x: 1,
                        y: 2,
                        z: 3,
                        b: 5,
                    },
                    Edit {
                        x: 4,
                        y: 5,
                        z: 6,
                        b: 0,
                    }, // break
                ],
                1000,
            )
        })
        .unwrap();
        let overrides = app.view(|s| s.get_overrides());
        assert_eq!(overrides.len(), 2);
        let placed = overrides.iter().find(|o| o.k == "1,2,3").unwrap();
        assert_eq!(placed.b, 5);
        let broken = overrides.iter().find(|o| o.k == "4,5,6").unwrap();
        assert_eq!(broken.b, 0, "breaking stores an explicit air override");
    }

    #[test]
    fn breaking_then_replacing_same_block_converges_to_latest() {
        let mut app = new_world();
        app.call_as(ALICE, |s| {
            s.set_blocks(
                vec![Edit {
                    x: 1,
                    y: 1,
                    z: 1,
                    b: 3,
                }],
                1000,
            )
        })
        .unwrap();
        app.call_as(BOB, |s| {
            s.set_blocks(
                vec![Edit {
                    x: 1,
                    y: 1,
                    z: 1,
                    b: 0,
                }],
                1010,
            )
        })
        .unwrap();
        app.call_as(ALICE, |s| {
            s.set_blocks(
                vec![Edit {
                    x: 1,
                    y: 1,
                    z: 1,
                    b: 9,
                }],
                1020,
            )
        })
        .unwrap();
        let overrides = app.view(|s| s.get_overrides());
        assert_eq!(overrides.len(), 1, "same key upserts, never duplicates");
        assert_eq!(overrides[0].b, 9);
    }

    #[test]
    fn out_of_bounds_edits_are_skipped_not_fatal() {
        let mut app = new_world();
        let applied = app
            .call_as(ALICE, |s| {
                s.set_blocks(
                    vec![
                        Edit {
                            x: -1,
                            y: 0,
                            z: 0,
                            b: 1,
                        },
                        Edit {
                            x: 0,
                            y: 64,
                            z: 0,
                            b: 1,
                        }, // y too high
                        Edit {
                            x: 128,
                            y: 0,
                            z: 0,
                            b: 1,
                        }, // x too high
                        Edit {
                            x: 10,
                            y: 10,
                            z: 10,
                            b: 1,
                        },
                    ],
                    1000,
                )
            })
            .unwrap();
        assert_eq!(applied, 1);
        assert_eq!(app.view(|s| s.get_overrides()).len(), 1);
    }

    #[test]
    fn oversized_batch_is_rejected() {
        let mut app = new_world();
        let edits: Vec<Edit> = (0..513)
            .map(|i| Edit {
                x: i % 100,
                y: 1,
                z: 1,
                b: 1,
            })
            .collect();
        assert!(app.call_as(ALICE, |s| s.set_blocks(edits, 1000)).is_err());
    }

    #[test]
    fn join_and_heartbeat_make_player_visible_online() {
        let mut app = new_world();
        app.call_as(ALICE, |s| s.join("Alice".to_owned(), 1000))
            .unwrap();
        app.call_as(ALICE, |s| s.heartbeat(t("Alice", 12.5), 1003))
            .unwrap();
        let players = app.view(|s| s.get_players(1005));
        assert_eq!(players.len(), 1);
        assert_eq!(players[0].id, id_of(ALICE));
        assert!(players[0].online);
        assert_eq!(players[0].x, 12.5);
    }

    #[test]
    fn silent_player_goes_offline_after_ttl() {
        let mut app = new_world();
        app.call_as(ALICE, |s| s.join("Alice".to_owned(), 1000))
            .unwrap();
        app.call_as(BOB, |s| s.join("Bob".to_owned(), 1000))
            .unwrap();
        app.call_as(BOB, |s| s.heartbeat(t("Bob", 0.0), 1020))
            .unwrap();
        let players = app.view(|s| s.get_players(1020));
        let alice = players.iter().find(|p| p.id == id_of(ALICE)).unwrap();
        let bob = players.iter().find(|p| p.id == id_of(BOB)).unwrap();
        assert!(!alice.online, "silent for 20s > TTL");
        assert!(bob.online);
    }

    #[test]
    fn leave_marks_player_left_immediately() {
        let mut app = new_world();
        app.call_as(ALICE, |s| s.join("Alice".to_owned(), 1000))
            .unwrap();
        app.call_as(ALICE, |s| s.leave(1002)).unwrap();
        let players = app.view(|s| s.get_players(1003));
        assert!(!players[0].online);
    }

    #[test]
    fn a_vanished_player_ages_out_and_self_heals() {
        let mut app = new_world();
        app.call_as(ALICE, |s| s.join("Alice".to_owned(), 1000))
            .unwrap();
        app.call_as(BOB, |s| s.join("Bob".to_owned(), 1000))
            .unwrap();

        // Alice goes silent without `leave`; Bob keeps heartbeating. Nobody
        // writes Alice's row: she is offline because her stamp aged out.
        app.call_as(BOB, |s| s.heartbeat(t("Bob", 0.0), 1075))
            .unwrap();
        let players = app.view(|s| s.get_players(1075));
        let alice = players.iter().find(|p| p.id == id_of(ALICE)).unwrap();
        assert!(!alice.online);

        app.call_as(ALICE, |s| s.heartbeat(t("Alice", 5.0), 1080))
            .unwrap();
        let players = app.view(|s| s.get_players(1081));
        let alice = players.iter().find(|p| p.id == id_of(ALICE)).unwrap();
        assert!(
            alice.online,
            "a silent player is back on the next heartbeat"
        );
    }

    #[test]
    fn skewed_fast_clock_cannot_knock_peers_offline() {
        let mut app = new_world();
        app.call_as(ALICE, |s| s.join("Alice".to_owned(), 1000))
            .unwrap();
        app.call_as(BOB, |s| s.join("Bob".to_owned(), 1000))
            .unwrap();

        // Bob's clock runs 10 minutes ahead: room time jumps forward.
        app.call_as(BOB, |s| s.heartbeat(t("Bob", 0.0), 1600))
            .unwrap();
        // Alice heartbeats on her own slow clock — room-time stamping keeps her live.
        app.call_as(ALICE, |s| s.heartbeat(t("Alice", 0.0), 1002))
            .unwrap();
        let players = app.view(|s| s.get_players(1603));
        let alice = players.iter().find(|p| p.id == id_of(ALICE)).unwrap();
        assert!(alice.online, "slow-clock player stays alive under skew");
    }

    #[test]
    fn backward_clock_never_freezes_liveness() {
        let mut app = new_world();
        app.call_as(ALICE, |s| s.join("Alice".to_owned(), 5000))
            .unwrap();
        // clock jumps BACK; stamp() must still move the row forward
        app.call_as(ALICE, |s| s.heartbeat(t("Alice", 0.0), 1000))
            .unwrap();
        let players = app.view(|s| s.get_players(5002));
        assert!(players[0].online);
    }

    #[test]
    fn override_count_tracks_distinct_keys() {
        let mut app = new_world();
        app.call_as(ALICE, |s| {
            s.set_blocks(
                vec![
                    Edit {
                        x: 1,
                        y: 1,
                        z: 1,
                        b: 3,
                    },
                    Edit {
                        x: 2,
                        y: 1,
                        z: 1,
                        b: 3,
                    },
                ],
                1000,
            )
        })
        .unwrap();
        app.call_as(BOB, |s| {
            s.set_blocks(
                vec![Edit {
                    x: 1,
                    y: 1,
                    z: 1,
                    b: 0,
                }],
                1001,
            )
        })
        .unwrap();
        assert_eq!(
            app.view(|s| s.override_count()),
            2,
            "upserts don't duplicate"
        );
    }

    #[test]
    fn rejoin_preserves_joined_at_and_position() {
        let mut app = new_world();
        app.call_as(ALICE, |s| s.join("Alice".to_owned(), 1000))
            .unwrap();
        app.call_as(ALICE, |s| s.heartbeat(t("Alice", 42.0), 1005))
            .unwrap();
        // rejoin (e.g. page refresh) must not teleport the player to origin
        app.call_as(ALICE, |s| s.join("Alice2".to_owned(), 1010))
            .unwrap();
        let players = app.view(|s| s.get_players(1011));
        assert_eq!(players[0].x, 42.0, "position survives rejoin");
        assert_eq!(players[0].name, "Alice2", "name updates on rejoin");
    }

    #[test]
    fn heartbeat_without_join_creates_a_live_row() {
        let mut app = new_world();
        app.call_as(ALICE, |s| s.heartbeat(t("Ghost", 1.0), 1000))
            .unwrap();
        let players = app.view(|s| s.get_players(1001));
        assert_eq!(players.len(), 1);
        assert!(players[0].online);
        assert_eq!(players[0].name, "Ghost");
    }

    #[test]
    fn leave_when_never_joined_is_a_no_op() {
        let mut app = new_world();
        assert!(app.call_as(ALICE, |s| s.leave(1000)).is_ok());
        assert!(app.view(|s| s.get_players(1001)).is_empty());
    }

    #[test]
    fn concurrent_edits_by_two_players_both_land() {
        let mut app = new_world();
        app.call_as(ALICE, |s| {
            s.set_blocks(
                vec![Edit {
                    x: 1,
                    y: 1,
                    z: 1,
                    b: 3,
                }],
                1000,
            )
        })
        .unwrap();
        app.call_as(BOB, |s| {
            s.set_blocks(
                vec![Edit {
                    x: 2,
                    y: 2,
                    z: 2,
                    b: 8,
                }],
                1000,
            )
        })
        .unwrap();
        let overrides = app.view(|s| s.get_overrides());
        assert_eq!(overrides.len(), 2);
    }

    #[test]
    fn transform_fields_survive_the_roundtrip() {
        let mut app = new_world();
        let tr = Transform {
            name: "Alice".to_owned(),
            x: 1.25,
            y: 33.5,
            z: 100.75,
            yaw: -1.57,
            pitch: 0.5,
            sel: 7,
        };
        app.call_as(ALICE, |s| s.heartbeat(tr, 1000)).unwrap();
        let p = &app.view(|s| s.get_players(1001))[0];
        assert_eq!((p.x, p.y, p.z), (1.25, 33.5, 100.75));
        assert_eq!(p.yaw, -1.57);
        assert_eq!(p.pitch, 0.5);
        assert_eq!(p.sel, 7);
    }

    #[test]
    fn empty_batch_applies_nothing_and_succeeds() {
        let mut app = new_world();
        let applied = app.call_as(ALICE, |s| s.set_blocks(vec![], 1000)).unwrap();
        assert_eq!(applied, 0);
        assert!(app.view(|s| s.get_overrides()).is_empty());
    }

    #[test]
    fn world_edges_are_editable() {
        let mut app = new_world();
        let applied = app
            .call_as(ALICE, |s| {
                s.set_blocks(
                    vec![
                        Edit {
                            x: 0,
                            y: 0,
                            z: 0,
                            b: 1,
                        },
                        Edit {
                            x: 127,
                            y: 63,
                            z: 127,
                            b: 1,
                        },
                    ],
                    1000,
                )
            })
            .unwrap();
        assert_eq!(applied, 2, "corner blocks are in bounds");
    }

    #[test]
    fn set_blocks_lww_stamps_are_monotonic_per_key() {
        let mut app = new_world();
        app.call_as(ALICE, |s| {
            s.set_blocks(
                vec![Edit {
                    x: 2,
                    y: 2,
                    z: 2,
                    b: 7,
                }],
                9000,
            )
        })
        .unwrap();
        // Bob's clock is behind, but his edit must still win (stamp = stored+1)
        app.call_as(BOB, |s| {
            s.set_blocks(
                vec![Edit {
                    x: 2,
                    y: 2,
                    z: 2,
                    b: 4,
                }],
                1000,
            )
        })
        .unwrap();
        let overrides = app.view(|s| s.get_overrides());
        assert_eq!(overrides[0].b, 4, "later edit wins even with a slow clock");
    }

    /// Pins the account/device decision made at rc.23 (see `caller`): a player
    /// row is per-INSTALLATION, so one person on two devices is two avatars in
    /// two places. If someone "fixes" `caller()` to `account_id()`, the two
    /// heartbeats below collapse onto one row and this fails — which is the
    /// point, because nothing else in the app would have complained.
    #[test]
    fn one_account_on_two_devices_is_two_players() {
        const PERSON: [u8; 32] = [0x33; 32];
        let mut app = new_world();
        app.call_as_account(PERSON, ALICE, |s| s.heartbeat(t("laptop", 10.0), 1000))
            .unwrap();
        app.call_as_account(PERSON, BOB, |s| s.heartbeat(t("phone", 90.0), 1000))
            .unwrap();

        let players = app.view(|s| s.get_players(1001));
        assert_eq!(players.len(), 2, "one account, two devices, two avatars");
        let mut xs: Vec<f64> = players.iter().map(|p| p.x).collect();
        xs.sort_by(f64::total_cmp);
        assert_eq!(xs, vec![10.0, 90.0], "each device keeps its own position");
        assert_eq!(players.iter().filter(|p| p.id == id_of(ALICE)).count(), 1);
        assert_eq!(players.iter().filter(|p| p.id == id_of(BOB)).count(), 1);
    }

    /// The world's founding parameters are a `Frozen` cell: written by the
    /// account that ran `init`, with no setter anywhere, and every node
    /// refuses a later write to it, the creator's included.
    #[test]
    fn world_meta_is_frozen_by_its_creator() {
        let app = new_world();
        assert!(app.view(|s| s.meta.writer()).is_some());
        let meta = app.view(|s| s.world_meta()).unwrap();
        assert_eq!((meta.seed, meta.created_at), (1337, 1000));
    }

    /// A player row lives in its account's slot. Another account writing
    /// into it, the way a patched node would, is refused by storage; the
    /// owner's own heartbeat still lands.
    #[test]
    fn another_account_cannot_move_or_evict_my_avatar() {
        let mut app = new_world();
        app.call_as_account(ALICE, ALICE, |s| s.heartbeat(t("Alice", 10.0), 1000))
            .unwrap();

        let forged = app.call_as_account(BOB, BOB, |s| -> app::Result<()> {
            let Some(mut alices) = s.players.get_for_user(&AccountId::from(ALICE))? else {
                app::bail!("alice has a slot");
            };
            let mut row = alices.devices.get(&id_of(ALICE))?.unwrap().clone();
            row.x = 999.0;
            row.left = true;
            let _ = alices.devices.insert(id_of(ALICE), row)?;
            Ok(())
        });
        assert!(forged.is_err(), "bob cannot rewrite alice's row");

        app.call_as_account(ALICE, ALICE, |s| s.heartbeat(t("Alice", 11.0), 1001))
            .unwrap();
        let players = app.view(|s| s.get_players(1002));
        assert_eq!(players.len(), 1);
        assert_eq!(players[0].x, 11.0);
        assert!(players[0].online);
    }

    /// A row stamped far in the future (a patched node writing `u64::MAX`
    /// into its own row) must not drag room time with it: honest players stay
    /// online and keep a stamp on the real clock.
    #[test]
    fn a_far_future_stamp_does_not_hijack_room_time() {
        let mut app = new_world();
        app.call_as_account(BOB, BOB, |s| {
            s.put_player(
                id_of(BOB),
                Player {
                    name: "Mallory".to_owned(),
                    x: 0.0,
                    y: 0.0,
                    z: 0.0,
                    yaw: 0.0,
                    pitch: 0.0,
                    sel: 0,
                    left: false,
                    joined_at: 0,
                    updated_at: u64::MAX,
                },
            )
        })
        .unwrap();
        app.call_as_account(ALICE, ALICE, |s| s.heartbeat(t("Alice", 1.0), 1000))
            .unwrap();

        let players = app.view(|s| s.get_players(1003));
        let alice = players.iter().find(|p| p.id == id_of(ALICE)).unwrap();
        assert!(alice.online, "room time stayed on the real clock");
        let stored = app
            .call_as_account(ALICE, ALICE, |s| s.my_player(&id_of(ALICE)))
            .unwrap()
            .unwrap()
            .updated_at;
        assert!(
            stored < 1000 + MAX_CLOCK_SKEW_SECS,
            "stamp not dragged to u64::MAX"
        );
    }
}
