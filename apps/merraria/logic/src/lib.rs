//! Merraria — shared 2D tile-world state on Calimero.
//!
//! Identical architecture to mero-blocks, one dimension lower: the world is
//! generated deterministically from `seed` on every client; this contract
//! carries only the tile-override diff (dig = 0/air, never a map-remove) and
//! player presence with the mero-meet room-clock + two-pass mark/grace reap.

use calimero_sdk::borsh::{BorshDeserialize, BorshSerialize};
use calimero_sdk::serde::{Deserialize, Serialize};
use calimero_sdk::{app, env as sdk_env, PublicKey};
use calimero_storage::address::Id;
use calimero_storage::collections::crdt_meta::MergeError;
use calimero_storage::collections::rekey::RekeyTarget;
use calimero_storage::collections::{LwwRegister, Mergeable as MergeableTrait, UnorderedMap};

type MemberId = String;

/// World bounds — must match `app/src/engine/world.ts`.
const WORLD_W: i32 = 400;
const WORLD_H: i32 = 200;

const MAX_EDITS_PER_CALL: usize = 512;
const PRESENCE_TTL_SECS: u64 = 10;
const REAP_STALE_SECS: u64 = 30;
const REAP_GRACE_SECS: u64 = 30;

// ── Stored records ───────────────────────────────────────────────────────────

/// One tile override: `t` is the tile id (0 = air / dug out).
#[derive(BorshSerialize, BorshDeserialize, Serialize, Deserialize, Clone, Debug)]
#[borsh(crate = "calimero_sdk::borsh")]
#[serde(crate = "calimero_sdk::serde")]
#[serde(rename_all = "camelCase")]
pub struct TileOverride {
    pub t: u8,
    pub updated_at: u64,
}

impl MergeableTrait for TileOverride {
    fn merge(&mut self, other: &Self) -> Result<(), MergeError> {
        if other.updated_at > self.updated_at {
            *self = other.clone();
        }
        Ok(())
    }
}
impl RekeyTarget for TileOverride {
    fn rekey_relative_to(&mut self, _parent_id: Id) {}
}

#[derive(BorshSerialize, BorshDeserialize, Serialize, Deserialize, Clone, Debug)]
#[borsh(crate = "calimero_sdk::borsh")]
#[serde(crate = "calimero_sdk::serde")]
#[serde(rename_all = "camelCase")]
pub struct Player {
    pub id: MemberId,
    pub name: String,
    pub x: f64,
    pub y: f64,
    /// facing: -1 | 1
    pub dir: f64,
    pub sel: u8,
    pub left: bool,
    pub joined_at: u64,
    pub updated_at: u64,
}

impl MergeableTrait for Player {
    fn merge(&mut self, other: &Self) -> Result<(), MergeError> {
        if other.updated_at > self.updated_at {
            *self = other.clone();
        }
        Ok(())
    }
}
impl RekeyTarget for Player {
    fn rekey_relative_to(&mut self, _parent_id: Id) {}
}

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

#[derive(BorshSerialize, BorshDeserialize, Serialize, Deserialize, Clone, Debug)]
#[borsh(crate = "calimero_sdk::borsh")]
#[serde(crate = "calimero_sdk::serde")]
pub struct Edit {
    pub x: i32,
    pub y: i32,
    pub t: u8,
}

#[derive(BorshSerialize, BorshDeserialize, Serialize, Deserialize, Clone, Debug)]
#[borsh(crate = "calimero_sdk::borsh")]
#[serde(crate = "calimero_sdk::serde")]
pub struct Transform {
    pub name: String,
    pub x: f64,
    pub y: f64,
    pub dir: f64,
    pub sel: u8,
}

#[derive(BorshSerialize, BorshDeserialize, Serialize, Deserialize, Clone, Debug)]
#[borsh(crate = "calimero_sdk::borsh")]
#[serde(crate = "calimero_sdk::serde")]
#[serde(rename_all = "camelCase")]
pub struct TileEntry {
    pub k: String,
    pub t: u8,
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
    pub dir: f64,
    pub sel: u8,
    pub online: bool,
}

// ── Events ───────────────────────────────────────────────────────────────────

#[app::event]
pub enum Event {
    Initialized(),
    /// Tiles changed by this member. Clients re-pull `get_overrides` — the
    /// event is a nudge, the state is the truth.
    TilesChanged(MemberId),
    PlayerJoined(MemberId),
    PlayerLeft(MemberId),
}

// ── State ────────────────────────────────────────────────────────────────────

#[app::state(emits = Event)]
pub struct Merraria {
    name: LwwRegister<String>,
    seed: LwwRegister<u64>,
    created_at: LwwRegister<u64>,
    /// "x,y" -> override. Set-only (dig = t:0), never removed.
    overrides: UnorderedMap<String, TileOverride>,
    players: UnorderedMap<MemberId, Player>,
    reap_marks: UnorderedMap<MemberId, ReapMark>,
}

#[app::logic]
impl Merraria {
    #[app::init]
    pub fn init(name: String, seed: u64, now: u64) -> Merraria {
        app::emit!(Event::Initialized());
        Merraria {
            name: LwwRegister::new(name),
            seed: LwwRegister::new(seed),
            created_at: LwwRegister::new(now),
            overrides: UnorderedMap::new(),
            players: UnorderedMap::new(),
            reap_marks: UnorderedMap::new(),
        }
    }

    fn caller() -> PublicKey {
        sdk_env::executor_id().into()
    }

    fn caller_id() -> MemberId {
        String::from(Self::caller())
    }

    // room time (see mero-blocks / mero-meet)
    fn latest_player_ts(&self) -> u64 {
        self.players
            .entries()
            .map(|e| e.map(|(_, p)| p.updated_at).max().unwrap_or(0))
            .unwrap_or(0)
    }

    fn room_now(&self, caller_now: u64) -> u64 {
        caller_now.max(self.latest_player_ts())
    }

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

    fn in_bounds(x: i32, y: i32) -> bool {
        x >= 0 && y >= 0 && x < WORLD_W && y < WORLD_H
    }

    pub fn set_tiles(&mut self, edits: Vec<Edit>, now: u64) -> app::Result<u32> {
        if edits.len() > MAX_EDITS_PER_CALL {
            app::bail!("too many edits in one batch");
        }
        let id = Self::caller_id();
        let mut applied: u32 = 0;
        for e in edits {
            if !Self::in_bounds(e.x, e.y) {
                continue;
            }
            let key = format!("{},{}", e.x, e.y);
            let stored = match self.overrides.get(&key) {
                Ok(Some(o)) => o.updated_at,
                _ => 0,
            };
            let updated_at = self.stamp(now, stored);
            self.overrides
                .insert(key, TileOverride { t: e.t, updated_at })?;
            applied += 1;
        }
        if applied > 0 {
            self.touch_player(&id, now);
            app::emit!(Event::TilesChanged(id));
        }
        self.reap_stale_players(now);
        Ok(applied)
    }

    pub fn get_overrides(&self) -> Vec<TileEntry> {
        self.overrides
            .entries()
            .map(|e| e.map(|(k, o)| TileEntry { k, t: o.t }).collect())
            .unwrap_or_default()
    }

    // ── Players ───────────────────────────────────────────────────────────────

    pub fn join(&mut self, name: String, now: u64) -> app::Result<PlayerView> {
        let id = Self::caller_id();
        let existing = self.players.get(&id)?;
        let joined_at = existing.as_ref().map(|p| p.joined_at).unwrap_or(now);
        let stored = existing.as_ref().map(|p| p.updated_at).unwrap_or(0);
        let (x, y) = existing.as_ref().map(|p| (p.x, p.y)).unwrap_or((0.0, 0.0));
        drop(existing);
        let updated_at = self.stamp(now, stored);

        let player = Player {
            id: id.clone(),
            name,
            x,
            y,
            dir: 1.0,
            sel: 0,
            left: false,
            joined_at,
            updated_at,
        };
        self.players.insert(id.clone(), player.clone())?;
        let _ = self.reap_marks.remove(&id);
        app::emit!(Event::PlayerJoined(id));
        Ok(Self::view_of(&player, true))
    }

    /// Silent presence + transform write (no SSE churn); runs the reap pass.
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
            dir: t.dir,
            sel: t.sel,
            left: false,
            joined_at,
            updated_at,
        };
        self.players.insert(id.clone(), player)?;
        let _ = self.reap_marks.remove(&id);
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

    pub fn get_players(&self, now: u64) -> Vec<PlayerView> {
        let room_now = self.room_now(now);
        self.players
            .entries()
            .map(|e| {
                e.map(|(_, p)| {
                    let online =
                        !p.left && room_now.saturating_sub(p.updated_at) <= PRESENCE_TTL_SECS;
                    Self::view_of(&p, online)
                })
                .collect()
            })
            .unwrap_or_default()
    }

    fn view_of(p: &Player, online: bool) -> PlayerView {
        PlayerView {
            id: p.id.clone(),
            name: p.name.clone(),
            x: p.x,
            y: p.y,
            dir: p.dir,
            sel: p.sel,
            online,
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

    /// Two-pass mark/grace reap (see mero-blocks / mero-meet for the rationale).
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
                let _ = self.reap_marks.remove(&id);
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

    fn new_world() -> TestHost<Merraria> {
        TestHost::new(|| Merraria::init("surface".to_owned(), 42, 1000))
    }

    fn t(name: &str, x: f64) -> Transform {
        Transform {
            name: name.to_owned(),
            x,
            y: 60.0,
            dir: 1.0,
            sel: 0,
        }
    }

    #[test]
    fn world_meta_returns_init_params() {
        let app = new_world();
        let meta = app.view(|s| s.world_meta());
        assert_eq!(meta.name, "surface");
        assert_eq!(meta.seed, 42);
        assert_eq!(meta.created_at, 1000);
    }

    #[test]
    fn set_tiles_roundtrips_and_digging_stores_air() {
        let mut app = new_world();
        app.call_as(ALICE, |s| {
            s.set_tiles(
                vec![Edit { x: 5, y: 60, t: 7 }, Edit { x: 6, y: 61, t: 0 }],
                1000,
            )
        })
        .unwrap();
        let overrides = app.view(|s| s.get_overrides());
        assert_eq!(overrides.len(), 2);
        assert_eq!(overrides.iter().find(|o| o.k == "5,60").unwrap().t, 7);
        assert_eq!(overrides.iter().find(|o| o.k == "6,61").unwrap().t, 0);
    }

    #[test]
    fn same_tile_upserts_never_duplicates() {
        let mut app = new_world();
        app.call_as(ALICE, |s| s.set_tiles(vec![Edit { x: 1, y: 1, t: 3 }], 1000))
            .unwrap();
        app.call_as(BOB, |s| s.set_tiles(vec![Edit { x: 1, y: 1, t: 0 }], 1010))
            .unwrap();
        let overrides = app.view(|s| s.get_overrides());
        assert_eq!(overrides.len(), 1);
        assert_eq!(overrides[0].t, 0);
    }

    #[test]
    fn out_of_bounds_edits_are_skipped() {
        let mut app = new_world();
        let applied = app
            .call_as(ALICE, |s| {
                s.set_tiles(
                    vec![
                        Edit { x: -1, y: 0, t: 1 },
                        Edit { x: 0, y: 200, t: 1 },
                        Edit { x: 400, y: 0, t: 1 },
                        Edit { x: 10, y: 10, t: 1 },
                    ],
                    1000,
                )
            })
            .unwrap();
        assert_eq!(applied, 1);
    }

    #[test]
    fn oversized_batch_is_rejected() {
        let mut app = new_world();
        let edits: Vec<Edit> = (0..513).map(|i| Edit { x: i % 100, y: 1, t: 1 }).collect();
        assert!(app.call_as(ALICE, |s| s.set_tiles(edits, 1000)).is_err());
    }

    #[test]
    fn join_heartbeat_roster_lifecycle() {
        let mut app = new_world();
        app.call_as(ALICE, |s| s.join("Alice".to_owned(), 1000)).unwrap();
        app.call_as(ALICE, |s| s.heartbeat(t("Alice", 33.0), 1003)).unwrap();
        let players = app.view(|s| s.get_players(1005));
        assert_eq!(players.len(), 1);
        assert!(players[0].online);
        assert_eq!(players[0].x, 33.0);

        app.call_as(ALICE, |s| s.leave(1010)).unwrap();
        let players = app.view(|s| s.get_players(1011));
        assert!(!players[0].online);
    }

    #[test]
    fn reap_needs_mark_plus_frozen_grace_and_self_heals() {
        let mut app = new_world();
        app.call_as(ALICE, |s| s.join("Alice".to_owned(), 1000)).unwrap();
        app.call_as(BOB, |s| s.join("Bob".to_owned(), 1000)).unwrap();

        app.call_as(BOB, |s| s.heartbeat(t("Bob", 0.0), 1040)).unwrap(); // marks Alice
        app.call_as(BOB, |s| s.heartbeat(t("Bob", 0.0), 1075)).unwrap(); // grace passed -> reap
        let alice = app
            .view(|s| s.get_players(1076))
            .into_iter()
            .find(|p| p.id == id_of(ALICE))
            .unwrap();
        assert!(!alice.online);

        app.call_as(ALICE, |s| s.heartbeat(t("Alice", 5.0), 1080)).unwrap();
        let alice = app
            .view(|s| s.get_players(1081))
            .into_iter()
            .find(|p| p.id == id_of(ALICE))
            .unwrap();
        assert!(alice.online, "reaped player self-heals on next heartbeat");
    }

    #[test]
    fn skewed_fast_clock_cannot_instantly_reap_peers() {
        let mut app = new_world();
        app.call_as(ALICE, |s| s.join("Alice".to_owned(), 1000)).unwrap();
        app.call_as(BOB, |s| s.join("Bob".to_owned(), 1000)).unwrap();
        app.call_as(BOB, |s| s.heartbeat(t("Bob", 0.0), 1600)).unwrap(); // 10 min ahead
        app.call_as(ALICE, |s| s.heartbeat(t("Alice", 0.0), 1002)).unwrap();
        let alice = app
            .view(|s| s.get_players(1603))
            .into_iter()
            .find(|p| p.id == id_of(ALICE))
            .unwrap();
        assert!(alice.online);
    }

    #[test]
    fn backward_clock_never_freezes_liveness() {
        let mut app = new_world();
        app.call_as(ALICE, |s| s.join("Alice".to_owned(), 5000)).unwrap();
        app.call_as(ALICE, |s| s.heartbeat(t("Alice", 0.0), 1000)).unwrap();
        let players = app.view(|s| s.get_players(5002));
        assert!(players[0].online);
    }

    #[test]
    fn tile_lww_stamps_are_monotonic_per_key() {
        let mut app = new_world();
        app.call_as(ALICE, |s| s.set_tiles(vec![Edit { x: 2, y: 2, t: 7 }], 9000))
            .unwrap();
        app.call_as(BOB, |s| s.set_tiles(vec![Edit { x: 2, y: 2, t: 4 }], 1000))
            .unwrap();
        let overrides = app.view(|s| s.get_overrides());
        assert_eq!(overrides[0].t, 4, "later edit wins even with a slow clock");
    }
}
