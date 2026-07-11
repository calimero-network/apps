//! Mero Blocks — shared voxel-world state on Calimero.
//!
//! The world itself is NEVER stored here. Every client generates identical
//! terrain from `seed`; this contract carries only:
//!   - **block overrides** — the diff against generated terrain (place = block
//!     id, break = 0/air). Set-only map: breaking writes a 0 value, we never
//!     `remove` a key (the UnorderedSet/insert-after-remove tombstone class of
//!     bugs is designed out).
//!   - **player presence** — name + transform, heartbeat-refreshed, with the
//!     mero-meet room-clock normalization + two-pass mark/grace reap so clock
//!     skew between laptops can never reap live players.
//!
//! Lighting and chunk data are client-derived from (seed, overrides) and cost
//! zero network traffic.

use calimero_sdk::borsh::{BorshDeserialize, BorshSerialize};
use calimero_sdk::serde::{Deserialize, Serialize};
use calimero_sdk::{app, env as sdk_env, PublicKey};
use calimero_storage::address::Id;
use calimero_storage::collections::crdt_meta::MergeError;
use calimero_storage::collections::rekey::RekeyTarget;
use calimero_storage::collections::{LwwRegister, Mergeable as MergeableTrait, UnorderedMap};

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

/// Silent for this long (room time) => reap CANDIDATE (pass 1: mark).
const REAP_STALE_SECS: u64 = 30;

/// Marked and still frozen after this long => actually reaped (pass 2).
const REAP_GRACE_SECS: u64 = 30;

// ── Stored records ───────────────────────────────────────────────────────────

/// One block override: `b` is the block id (0 = air / broken).
#[derive(BorshSerialize, BorshDeserialize, Serialize, Deserialize, Clone, Debug)]
#[borsh(crate = "calimero_sdk::borsh")]
#[serde(crate = "calimero_sdk::serde")]
#[serde(rename_all = "camelCase")]
pub struct BlockOverride {
    pub b: u8,
    /// room-time stamp for LWW convergence when two peers edit the same block
    pub updated_at: u64,
}

impl MergeableTrait for BlockOverride {
    fn merge(&mut self, other: &Self) -> Result<(), MergeError> {
        if other.updated_at > self.updated_at {
            *self = other.clone();
        }
        Ok(())
    }
}
impl RekeyTarget for BlockOverride {
    fn rekey_relative_to(&mut self, _parent_id: Id) {}
}

/// A player row: identity-keyed presence + last known transform.
#[derive(BorshSerialize, BorshDeserialize, Serialize, Deserialize, Clone, Debug)]
#[borsh(crate = "calimero_sdk::borsh")]
#[serde(crate = "calimero_sdk::serde")]
#[serde(rename_all = "camelCase")]
pub struct Player {
    pub id: MemberId,
    pub name: String,
    pub x: f64,
    pub y: f64,
    pub z: f64,
    pub yaw: f64,
    pub pitch: f64,
    /// selected hotbar slot (cosmetic — lets peers render what you hold)
    pub sel: u8,
    /// explicitly left (or reaped); row is kept, never removed
    pub left: bool,
    pub joined_at: u64,
    pub updated_at: u64,
}

impl MergeableTrait for Player {
    fn merge(&mut self, other: &Self) -> Result<(), MergeError> {
        // pure LWW on the heartbeat clock; joined_at is immutable after join
        if other.updated_at > self.updated_at {
            *self = other.clone();
        }
        Ok(())
    }
}
impl RekeyTarget for Player {
    fn rekey_relative_to(&mut self, _parent_id: Id) {}
}

/// Two-pass reap bookkeeping (see mero-meet): pass 1 marks, pass 2 reaps only
/// if the row stayed frozen through the grace window.
#[derive(BorshSerialize, BorshDeserialize, Serialize, Deserialize, Clone, Debug)]
#[borsh(crate = "calimero_sdk::borsh")]
#[serde(crate = "calimero_sdk::serde")]
#[serde(rename_all = "camelCase")]
pub struct ReapMark {
    pub marked_at: u64,
    pub row_ts: u64,
}

impl MergeableTrait for ReapMark {
    fn merge(&mut self, other: &Self) -> Result<(), MergeError> {
        if other.marked_at > self.marked_at {
            *self = other.clone();
        }
        Ok(())
    }
}
impl RekeyTarget for ReapMark {
    fn rekey_relative_to(&mut self, _parent_id: Id) {}
}

// ── Views / args ─────────────────────────────────────────────────────────────

#[derive(BorshSerialize, BorshDeserialize, Serialize, Deserialize, Clone, Debug)]
#[borsh(crate = "calimero_sdk::borsh")]
#[serde(crate = "calimero_sdk::serde")]
#[serde(rename_all = "camelCase")]
pub struct WorldMeta {
    pub name: String,
    pub seed: u64,
    pub created_at: u64,
}

/// One edit in a `set_blocks` batch.
#[derive(BorshSerialize, BorshDeserialize, Serialize, Deserialize, Clone, Debug)]
#[borsh(crate = "calimero_sdk::borsh")]
#[serde(crate = "calimero_sdk::serde")]
pub struct Edit {
    pub x: i32,
    pub y: i32,
    pub z: i32,
    pub b: u8,
}

/// Incoming transform for `heartbeat`.
#[derive(BorshSerialize, BorshDeserialize, Serialize, Deserialize, Clone, Debug)]
#[borsh(crate = "calimero_sdk::borsh")]
#[serde(crate = "calimero_sdk::serde")]
pub struct Transform {
    pub name: String,
    pub x: f64,
    pub y: f64,
    pub z: f64,
    pub yaw: f64,
    pub pitch: f64,
    pub sel: u8,
}

#[derive(BorshSerialize, BorshDeserialize, Serialize, Deserialize, Clone, Debug)]
#[borsh(crate = "calimero_sdk::borsh")]
#[serde(crate = "calimero_sdk::serde")]
#[serde(rename_all = "camelCase")]
pub struct BlockEntry {
    pub k: String,
    pub b: u8,
}

#[derive(BorshSerialize, BorshDeserialize, Serialize, Deserialize, Clone, Debug)]
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
    pub online: bool,
}

// ── Events ───────────────────────────────────────────────────────────────────

#[app::event]
pub enum Event {
    Initialized(),
    /// Blocks changed by this member (payload = editor id). Clients re-pull
    /// `get_overrides` on receipt — event is a nudge, the state is the truth.
    BlocksChanged(MemberId),
    PlayerJoined(MemberId),
    PlayerLeft(MemberId),
}

// ── State ────────────────────────────────────────────────────────────────────

#[app::state(emits = Event)]
pub struct MeroBlocks {
    name: LwwRegister<String>,
    seed: LwwRegister<u64>,
    created_at: LwwRegister<u64>,
    /// "x,y,z" -> override. Set-only (break = b:0), never removed.
    overrides: UnorderedMap<String, BlockOverride>,
    players: UnorderedMap<MemberId, Player>,
    reap_marks: UnorderedMap<MemberId, ReapMark>,
}

#[app::logic]
impl MeroBlocks {
    /// `now` is the creator's unix-seconds clock — it anchors the shared
    /// day/night cycle (WASM has no wall clock; mero-meet convention).
    #[app::init]
    pub fn init(name: String, seed: u64, now: u64) -> MeroBlocks {
        app::emit!(Event::Initialized());
        MeroBlocks {
            name: LwwRegister::new(name),
            seed: LwwRegister::new(seed),
            created_at: LwwRegister::new(now),
            overrides: UnorderedMap::new(),
            players: UnorderedMap::new(),
            reap_marks: UnorderedMap::new(),
        }
    }

    /// The real signer of this invocation. Never trust a client-supplied id.
    fn caller() -> PublicKey {
        sdk_env::executor_id().into()
    }

    fn caller_id() -> MemberId {
        String::from(Self::caller())
    }

    // ── Room time (skew-proof liveness clock, from mero-meet) ────────────────

    fn latest_player_ts(&self) -> u64 {
        self.players
            .entries()
            .map(|e| e.map(|(_, p)| p.updated_at).max().unwrap_or(0))
            .unwrap_or(0)
    }

    /// Normalize the caller's clock onto room time (runs at the fastest
    /// member's clock). ALL liveness math goes through this.
    fn room_now(&self, caller_now: u64) -> u64 {
        caller_now.max(self.latest_player_ts())
    }

    /// Value to write into a row: room time, strictly past the stored stamp
    /// (a backward clock must never freeze liveness or lose the LWW merge).
    fn stamp(&self, caller_now: u64, stored: u64) -> u64 {
        self.room_now(caller_now).max(stored.saturating_add(1))
    }

    // ── World ─────────────────────────────────────────────────────────────────

    pub fn world_meta(&self) -> WorldMeta {
        WorldMeta {
            name: self.name.get().clone(),
            seed: *self.seed.get(),
            created_at: *self.created_at.get(),
        }
    }

    fn in_bounds(x: i32, y: i32, z: i32) -> bool {
        x >= 0 && y >= 0 && z >= 0 && x < WORLD_SX && y < WORLD_SY && z < WORLD_SZ
    }

    /// Apply a batch of block edits. Out-of-bounds edits are skipped (not an
    /// error: a stale client must not poison a whole batch). Returns the
    /// number of edits applied.
    pub fn set_blocks(&mut self, edits: Vec<Edit>, now: u64) -> app::Result<u32> {
        if edits.len() > MAX_EDITS_PER_CALL {
            app::bail!("too many edits in one batch");
        }
        let id = Self::caller_id();
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
            let updated_at = self.stamp(now, stored);
            self.overrides
                .insert(key, BlockOverride { b: e.b, updated_at })?;
            applied += 1;
        }
        if applied > 0 {
            self.touch_player(&id, now);
            app::emit!(Event::BlocksChanged(id));
        }
        self.reap_stale_players(now);
        Ok(applied)
    }

    /// Full override map — join/reconcile pull. O(edits), not O(world).
    pub fn get_overrides(&self) -> Vec<BlockEntry> {
        self.overrides
            .entries()
            .map(|e| e.map(|(k, o)| BlockEntry { k, b: o.b }).collect())
            .unwrap_or_default()
    }

    pub fn override_count(&self) -> u32 {
        self.overrides
            .entries()
            .map(|e| e.count())
            .unwrap_or(0) as u32
    }

    // ── Players ───────────────────────────────────────────────────────────────

    /// Join (or rejoin) the world. Idempotent upsert of my player row.
    pub fn join(&mut self, name: String, now: u64) -> app::Result<PlayerView> {
        let id = Self::caller_id();
        let existing = self.players.get(&id)?;
        let joined_at = existing.as_ref().map(|p| p.joined_at).unwrap_or(now);
        let stored = existing.as_ref().map(|p| p.updated_at).unwrap_or(0);
        let (x, y, z) = existing
            .as_ref()
            .map(|p| (p.x, p.y, p.z))
            .unwrap_or((0.0, 0.0, 0.0));
        drop(existing);
        let updated_at = self.stamp(now, stored);

        let player = Player {
            id: id.clone(),
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
        self.players.insert(id.clone(), player.clone())?;
        let _ = self.reap_marks.remove(&id);
        app::emit!(Event::PlayerJoined(id));
        Ok(Self::view_of(&player, updated_at, updated_at))
    }

    /// Liveness + transform ping. SILENT (no event): peers poll `get_players`
    /// every ~1.5s; emitting per-heartbeat would spam SSE for every member
    /// (mero-meet's silent-heartbeat pattern). Also runs the reap pass so the
    /// roster self-heals as long as anyone is alive.
    pub fn heartbeat(&mut self, t: Transform, now: u64) -> app::Result<()> {
        let id = Self::caller_id();
        let existing = self.players.get(&id)?;
        let joined_at = existing.as_ref().map(|p| p.joined_at).unwrap_or(now);
        let stored = existing.as_ref().map(|p| p.updated_at).unwrap_or(0);
        let was_left = existing.as_ref().map(|p| p.left).unwrap_or(true);
        drop(existing);
        let updated_at = self.stamp(now, stored);

        let player = Player {
            id: id.clone(),
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
        self.players.insert(id.clone(), player)?;
        let _ = self.reap_marks.remove(&id);
        // self-heal: if we were reaped while actually alive, re-announce
        if was_left {
            app::emit!(Event::PlayerJoined(id));
        }
        self.reap_stale_players(now);
        Ok(())
    }

    pub fn leave(&mut self, now: u64) -> app::Result<()> {
        let id = Self::caller_id();
        let stored = match self.players.get(&id)? {
            Some(p) => p.updated_at,
            None => return Ok(()),
        };
        let updated_at = self.stamp(now, stored);
        if let Ok(Some(mut p)) = self.players.get_mut(&id) {
            p.left = true;
            p.updated_at = updated_at;
            drop(p);
        }
        let _ = self.reap_marks.remove(&id);
        app::emit!(Event::PlayerLeft(id));
        Ok(())
    }

    /// Roster with liveness — peers render everyone `online`.
    pub fn get_players(&self, now: u64) -> Vec<PlayerView> {
        let room_now = self.room_now(now);
        self.players
            .entries()
            .map(|e| {
                e.map(|(_, p)| {
                    let online =
                        !p.left && room_now.saturating_sub(p.updated_at) <= PRESENCE_TTL_SECS;
                    Self::view_of(&p, p.updated_at, if online { room_now } else { 0 })
                })
                .collect()
            })
            .unwrap_or_default()
    }

    fn view_of(p: &Player, _row_ts: u64, online_hint: u64) -> PlayerView {
        PlayerView {
            id: p.id.clone(),
            name: p.name.clone(),
            x: p.x,
            y: p.y,
            z: p.z,
            yaw: p.yaw,
            pitch: p.pitch,
            sel: p.sel,
            online: online_hint > 0,
        }
    }

    fn touch_player(&mut self, id: &MemberId, now: u64) {
        let stored = match self.players.get(id) {
            Ok(Some(p)) => p.updated_at,
            _ => return,
        };
        let stamp = self.stamp(now, stored);
        if let Ok(Some(mut p)) = self.players.get_mut(id) {
            p.updated_at = stamp;
            drop(p);
        }
    }

    /// Two-pass mark/grace reap (mero-meet): pass 1 marks a frozen row, pass 2
    /// reaps only if it stayed frozen through the grace window. Any movement
    /// clears the mark. Never forge a foreign clock: the reaped row's stamp is
    /// bumped on ITS OWN timeline (+1).
    fn reap_stale_players(&mut self, now: u64) {
        let room_now = self.room_now(now);
        let me = Self::caller_id();

        let rows: Vec<(MemberId, u64, bool)> = self
            .players
            .entries()
            .map(|e| e.map(|(k, p)| (k, p.updated_at, p.left)).collect())
            .unwrap_or_default();

        let mut reaped: Vec<MemberId> = Vec::new();
        for (id, row_ts, left) in rows {
            if left || id == me {
                continue;
            }
            if room_now.saturating_sub(row_ts) <= REAP_STALE_SECS {
                let _ = self.reap_marks.remove(&id); // provably alive
                continue;
            }
            let mark = match self.reap_marks.get(&id) {
                Ok(Some(m)) => Some((m.marked_at, m.row_ts)),
                _ => None,
            };
            match mark {
                Some((marked_at, mark_row)) if mark_row == row_ts => {
                    if room_now.saturating_sub(marked_at) > REAP_GRACE_SECS {
                        reaped.push(id);
                    }
                }
                _ => {
                    let _ = self.reap_marks.insert(
                        id,
                        ReapMark {
                            marked_at: room_now,
                            row_ts,
                        },
                    );
                }
            }
        }

        for id in reaped {
            let _ = self.reap_marks.remove(&id);
            if let Ok(Some(mut p)) = self.players.get_mut(&id) {
                p.left = true;
                p.updated_at = p.updated_at.saturating_add(1);
                drop(p);
            }
            app::emit!(Event::PlayerLeft(id));
        }
    }
}

// ── Tests ────────────────────────────────────────────────────────────────────

#[cfg(test)]
mod tests {
    use super::*;
    use calimero_sdk::testing::TestHost;

    const ALICE: [u8; 32] = [0x11; 32];
    const BOB: [u8; 32] = [0x22; 32];

    fn id_of(bytes: [u8; 32]) -> String {
        bs58::encode(bytes).into_string()
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
        let meta = app.view(|s| s.world_meta());
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
                    Edit { x: 1, y: 2, z: 3, b: 5 },
                    Edit { x: 4, y: 5, z: 6, b: 0 }, // break
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
        app.call_as(ALICE, |s| s.set_blocks(vec![Edit { x: 1, y: 1, z: 1, b: 3 }], 1000))
            .unwrap();
        app.call_as(BOB, |s| s.set_blocks(vec![Edit { x: 1, y: 1, z: 1, b: 0 }], 1010))
            .unwrap();
        app.call_as(ALICE, |s| s.set_blocks(vec![Edit { x: 1, y: 1, z: 1, b: 9 }], 1020))
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
                        Edit { x: -1, y: 0, z: 0, b: 1 },
                        Edit { x: 0, y: 64, z: 0, b: 1 },  // y too high
                        Edit { x: 128, y: 0, z: 0, b: 1 }, // x too high
                        Edit { x: 10, y: 10, z: 10, b: 1 },
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
        let edits: Vec<Edit> = (0..513).map(|i| Edit { x: i % 100, y: 1, z: 1, b: 1 }).collect();
        assert!(app.call_as(ALICE, |s| s.set_blocks(edits, 1000)).is_err());
    }

    #[test]
    fn join_and_heartbeat_make_player_visible_online() {
        let mut app = new_world();
        app.call_as(ALICE, |s| s.join("Alice".to_owned(), 1000)).unwrap();
        app.call_as(ALICE, |s| s.heartbeat(t("Alice", 12.5), 1003)).unwrap();
        let players = app.view(|s| s.get_players(1005));
        assert_eq!(players.len(), 1);
        assert_eq!(players[0].id, id_of(ALICE));
        assert!(players[0].online);
        assert_eq!(players[0].x, 12.5);
    }

    #[test]
    fn silent_player_goes_offline_after_ttl() {
        let mut app = new_world();
        app.call_as(ALICE, |s| s.join("Alice".to_owned(), 1000)).unwrap();
        app.call_as(BOB, |s| s.join("Bob".to_owned(), 1000)).unwrap();
        app.call_as(BOB, |s| s.heartbeat(t("Bob", 0.0), 1020)).unwrap();
        let players = app.view(|s| s.get_players(1020));
        let alice = players.iter().find(|p| p.id == id_of(ALICE)).unwrap();
        let bob = players.iter().find(|p| p.id == id_of(BOB)).unwrap();
        assert!(!alice.online, "silent for 20s > TTL");
        assert!(bob.online);
    }

    #[test]
    fn leave_marks_player_left_immediately() {
        let mut app = new_world();
        app.call_as(ALICE, |s| s.join("Alice".to_owned(), 1000)).unwrap();
        app.call_as(ALICE, |s| s.leave(1002)).unwrap();
        let players = app.view(|s| s.get_players(1003));
        assert!(!players[0].online);
    }

    #[test]
    fn reap_requires_mark_plus_frozen_grace() {
        let mut app = new_world();
        app.call_as(ALICE, |s| s.join("Alice".to_owned(), 1000)).unwrap();
        app.call_as(BOB, |s| s.join("Bob".to_owned(), 1000)).unwrap();

        // Alice goes silent; Bob keeps heartbeating.
        // pass 1: stale (>30s) => marked, not reaped
        app.call_as(BOB, |s| s.heartbeat(t("Bob", 0.0), 1040)).unwrap();
        let players = app.view(|s| s.get_players(1040));
        let alice = players.iter().find(|p| p.id == id_of(ALICE)).unwrap();
        assert!(!alice.online, "offline, but not yet reaped (marked)");

        // pass 2 within grace: still nothing final
        app.call_as(BOB, |s| s.heartbeat(t("Bob", 0.0), 1060)).unwrap();
        // pass 3 after grace (>30s past mark): reaped => left = true forever
        app.call_as(BOB, |s| s.heartbeat(t("Bob", 0.0), 1075)).unwrap();
        let players = app.view(|s| s.get_players(1075));
        let alice = players.iter().find(|p| p.id == id_of(ALICE)).unwrap();
        assert!(!alice.online);

        // Alice comes back: heartbeat self-heals (re-join announcement)
        app.call_as(ALICE, |s| s.heartbeat(t("Alice", 5.0), 1080)).unwrap();
        let players = app.view(|s| s.get_players(1081));
        let alice = players.iter().find(|p| p.id == id_of(ALICE)).unwrap();
        assert!(alice.online, "reaped player self-heals on next heartbeat");
    }

    #[test]
    fn skewed_fast_clock_cannot_instantly_reap_peers() {
        let mut app = new_world();
        app.call_as(ALICE, |s| s.join("Alice".to_owned(), 1000)).unwrap();
        app.call_as(BOB, |s| s.join("Bob".to_owned(), 1000)).unwrap();

        // Bob's clock runs 10 minutes ahead: room time jumps forward.
        app.call_as(BOB, |s| s.heartbeat(t("Bob", 0.0), 1600)).unwrap();
        // Alice heartbeats on her own slow clock — room-time stamping keeps her live.
        app.call_as(ALICE, |s| s.heartbeat(t("Alice", 0.0), 1002)).unwrap();
        let players = app.view(|s| s.get_players(1603));
        let alice = players.iter().find(|p| p.id == id_of(ALICE)).unwrap();
        assert!(alice.online, "slow-clock player stays alive under skew");
    }

    #[test]
    fn backward_clock_never_freezes_liveness() {
        let mut app = new_world();
        app.call_as(ALICE, |s| s.join("Alice".to_owned(), 5000)).unwrap();
        // clock jumps BACK; stamp() must still move the row forward
        app.call_as(ALICE, |s| s.heartbeat(t("Alice", 0.0), 1000)).unwrap();
        let players = app.view(|s| s.get_players(5002));
        assert!(players[0].online);
    }

    #[test]
    fn override_count_tracks_distinct_keys() {
        let mut app = new_world();
        app.call_as(ALICE, |s| {
            s.set_blocks(
                vec![
                    Edit { x: 1, y: 1, z: 1, b: 3 },
                    Edit { x: 2, y: 1, z: 1, b: 3 },
                ],
                1000,
            )
        })
        .unwrap();
        app.call_as(BOB, |s| s.set_blocks(vec![Edit { x: 1, y: 1, z: 1, b: 0 }], 1001))
            .unwrap();
        assert_eq!(app.view(|s| s.override_count()), 2, "upserts don't duplicate");
    }

    #[test]
    fn rejoin_preserves_joined_at_and_position() {
        let mut app = new_world();
        app.call_as(ALICE, |s| s.join("Alice".to_owned(), 1000)).unwrap();
        app.call_as(ALICE, |s| s.heartbeat(t("Alice", 42.0), 1005)).unwrap();
        // rejoin (e.g. page refresh) must not teleport the player to origin
        app.call_as(ALICE, |s| s.join("Alice2".to_owned(), 1010)).unwrap();
        let players = app.view(|s| s.get_players(1011));
        assert_eq!(players[0].x, 42.0, "position survives rejoin");
        assert_eq!(players[0].name, "Alice2", "name updates on rejoin");
    }

    #[test]
    fn heartbeat_without_join_creates_a_live_row() {
        let mut app = new_world();
        app.call_as(ALICE, |s| s.heartbeat(t("Ghost", 1.0), 1000)).unwrap();
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
        app.call_as(ALICE, |s| s.set_blocks(vec![Edit { x: 1, y: 1, z: 1, b: 3 }], 1000))
            .unwrap();
        app.call_as(BOB, |s| s.set_blocks(vec![Edit { x: 2, y: 2, z: 2, b: 8 }], 1000))
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
                        Edit { x: 0, y: 0, z: 0, b: 1 },
                        Edit { x: 127, y: 63, z: 127, b: 1 },
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
        app.call_as(ALICE, |s| s.set_blocks(vec![Edit { x: 2, y: 2, z: 2, b: 7 }], 9000))
            .unwrap();
        // Bob's clock is behind, but his edit must still win (stamp = stored+1)
        app.call_as(BOB, |s| s.set_blocks(vec![Edit { x: 2, y: 2, z: 2, b: 4 }], 1000))
            .unwrap();
        let overrides = app.view(|s| s.get_overrides());
        assert_eq!(overrides[0].b, 4, "later edit wins even with a slow clock");
    }
}
