//! Merraria — shared 2D tile-world state on Calimero.
//!
//! Identical architecture to mero-blocks, one dimension lower: the world is
//! generated deterministically from `seed` on every client; this contract
//! carries only the tile-override diff (dig = 0/air, never a map-remove) and
//! player presence on the mero-meet room clock.
//!
//! Who may write what is held by storage, on every node: the world's
//! name/seed/clock are `Frozen` at creation, and each account's avatars sit in
//! that account's `UserStorage` slot. The overrides stay a public map on
//! purpose — anyone may dig or build anywhere.

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
const WORLD_W: i32 = 400;
const WORLD_H: i32 = 200;

const MAX_EDITS_PER_CALL: usize = 512;
const PRESENCE_TTL_SECS: u64 = 10;
/// How far ahead of the caller's own clock a stored player stamp may be and
/// still move room time (see mero-blocks): an honest fast laptop is followed,
/// a patched `u64::MAX` stamp is ignored instead of freezing presence.
const MAX_CLOCK_SKEW_SECS: u64 = 900;

// ── Stored records ───────────────────────────────────────────────────────────

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

/// One tile override: `t` is the tile id (0 = air / dug out).
#[app::mergeable(id = "merraria::TileOverride")]
#[derive(BorshSerialize, BorshDeserialize, Serialize, Deserialize, AbiType, Clone, Debug)]
#[borsh(crate = "calimero_sdk::borsh")]
#[serde(crate = "calimero_sdk::serde")]
#[serde(rename_all = "camelCase")]
pub struct TileOverride {
    pub t: u8,
    pub updated_at: u64,
}

impl MergeableTrait for TileOverride {
    fn merge(&mut self, other: &Self) -> Result<(), MergeError> {
        if lww_take(self.updated_at, other.updated_at, self, other) {
            *self = other.clone();
        }
        Ok(())
    }
}

#[app::mergeable(id = "merraria::Player")]
#[derive(BorshSerialize, BorshDeserialize, Serialize, Deserialize, AbiType, Clone, Debug)]
#[borsh(crate = "calimero_sdk::borsh")]
#[serde(crate = "calimero_sdk::serde")]
#[serde(rename_all = "camelCase")]
pub struct Player {
    pub name: String,
    pub x: f64,
    pub y: f64,
    /// facing: -1 | 1
    pub dir: f64,
    pub sel: u8,
    /// what the player is doing: "idle" | "walking" | "mining" | "building" | "swimming"
    #[serde(default)]
    pub action: String,
    pub left: bool,
    pub joined_at: u64,
    pub updated_at: u64,
}

impl MergeableTrait for Player {
    fn merge(&mut self, other: &Self) -> Result<(), MergeError> {
        if lww_take(self.updated_at, other.updated_at, self, other) {
            *self = other.clone();
        }
        Ok(())
    }
}

/// One account's avatars, keyed by device (see `caller`). The slot and the
/// map nested in it belong to the account: every node refuses another
/// account's write to either.
#[derive(BorshSerialize, BorshDeserialize, AbiType, Default, app::Mergeable)]
#[borsh(crate = "calimero_sdk::borsh")]
pub struct Avatars {
    devices: UnorderedMap<MemberId, Player>,
}

// ── Views / args ─────────────────────────────────────────────────────────────

#[derive(
    BorshSerialize, BorshDeserialize, Serialize, Deserialize, AbiType, Clone, Debug, Default,
)]
#[borsh(crate = "calimero_sdk::borsh")]
#[serde(crate = "calimero_sdk::serde")]
#[serde(rename_all = "camelCase")]
pub struct WorldMeta {
    pub name: String,
    pub seed: u64,
    pub created_at: u64,
}

#[derive(BorshSerialize, BorshDeserialize, Serialize, Deserialize, AbiType, Clone, Debug)]
#[borsh(crate = "calimero_sdk::borsh")]
#[serde(crate = "calimero_sdk::serde")]
pub struct Edit {
    pub x: i32,
    pub y: i32,
    pub t: u8,
}

#[derive(BorshSerialize, BorshDeserialize, Serialize, Deserialize, AbiType, Clone, Debug)]
#[borsh(crate = "calimero_sdk::borsh")]
#[serde(crate = "calimero_sdk::serde")]
pub struct Transform {
    pub name: String,
    pub x: f64,
    pub y: f64,
    pub dir: f64,
    pub sel: u8,
    #[serde(default)]
    pub action: String,
}

#[derive(BorshSerialize, BorshDeserialize, Serialize, Deserialize, AbiType, Clone, Debug)]
#[borsh(crate = "calimero_sdk::borsh")]
#[serde(crate = "calimero_sdk::serde")]
#[serde(rename_all = "camelCase")]
pub struct TileEntry {
    pub k: String,
    pub t: u8,
}

#[derive(BorshSerialize, BorshDeserialize, Serialize, Deserialize, AbiType, Clone, Debug)]
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
    pub action: String,
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
    /// name + seed + day-clock anchor, frozen: the terrain is derived from the
    /// seed, so nobody (the creator included) may change it after creation.
    meta: Frozen<WorldMeta>,
    /// "x,y" -> override. Set-only (dig = t:0), never removed. Public on
    /// purpose: the world is collaborative.
    overrides: UnorderedMap<String, TileOverride>,
    players: UserStorage<Avatars>,
}

#[app::logic]
impl Merraria {
    #[app::init]
    pub fn init(name: String, seed: u64, now: u64) -> Merraria {
        app::emit!(Event::Initialized());
        Merraria {
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
    /// Deliberately the DEVICE, audited against rc.23's account/device split
    /// (core #3510, which flipped the `executor_id` shim from device to account
    /// before deleting it). The rule there is that an identity doing *ownership*
    /// takes the account — a writer set, an owner field, "is the caller a
    /// member". This contract has none of those: a tile override is
    /// `{t, updated_at}` with no author, a world has no owner, and nothing here
    /// is ever compared against a group member list.
    ///
    /// The one thing this id names is an AVATAR, and an avatar is one
    /// installation: a single position that a client heartbeats twice a second.
    /// Keyed by account, a person's laptop and phone collapse into one row whose
    /// x/y the two clients overwrite in turn, and neither can see the other.
    /// Core's own words for `device_id` are "right for per-writer state and wrong
    /// for per-person state" — a live avatar is per-writer state.
    /// `one_person_on_two_devices_gets_two_avatars` holds this down.
    ///
    /// Ownership still goes by account: the rows live in the caller's
    /// `UserStorage` slot, keyed inside it by this device id.
    ///
    /// Same axis on the client: `sync.ts` suppresses its own echo by comparing an
    /// event's member id against the context identity the node handed it, which
    /// is a device key. "Is this the machine that wrote it" is a device question.
    fn caller() -> PublicKey {
        sdk_env::device_id().into()
    }

    fn caller_id() -> MemberId {
        String::from(Self::caller())
    }

    // room time (see mero-blocks / mero-meet)

    /// Every avatar row, `(device id, row)`; the id is the map key, never a
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

    /// Room time: the fastest member's clock, up to `MAX_CLOCK_SKEW_SECS`
    /// ahead of the caller's. Compute it once per call.
    fn room_now(&self, caller_now: u64) -> u64 {
        let ceiling = caller_now.saturating_add(MAX_CLOCK_SKEW_SECS);
        self.all_players()
            .into_iter()
            .map(|(_, p)| p.updated_at)
            .filter(|ts| *ts <= ceiling)
            .fold(caller_now, u64::max)
    }

    fn stamp(room_now: u64, stored: u64) -> u64 {
        room_now.max(stored.saturating_add(1))
    }

    // ── World ─────────────────────────────────────────────────────────────────

    pub fn world_meta(&self) -> app::Result<WorldMeta> {
        Ok(self.meta.get()?.clone())
    }

    fn in_bounds(x: i32, y: i32) -> bool {
        x >= 0 && y >= 0 && x < WORLD_W && y < WORLD_H
    }

    pub fn set_tiles(&mut self, edits: Vec<Edit>, now: u64) -> app::Result<u32> {
        if edits.len() > MAX_EDITS_PER_CALL {
            app::bail!("too many edits in one batch");
        }
        let id = Self::caller_id();
        let room_now = self.room_now(now);
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
            let updated_at = Self::stamp(room_now, stored);
            self.overrides
                .insert(key, TileOverride { t: e.t, updated_at })?;
            applied += 1;
        }
        if applied > 0 {
            self.touch_player(&id, room_now)?;
            app::emit!(Event::TilesChanged(id));
        }
        Ok(applied)
    }

    pub fn get_overrides(&self) -> Vec<TileEntry> {
        self.overrides
            .entries()
            .map(|e| e.map(|(k, o)| TileEntry { k, t: o.t }).collect())
            .unwrap_or_default()
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

    pub fn join(&mut self, name: String, now: u64) -> app::Result<PlayerView> {
        let id = Self::caller_id();
        let existing = self.my_player(&id)?;
        let joined_at = existing.as_ref().map(|p| p.joined_at).unwrap_or(now);
        let stored = existing.as_ref().map(|p| p.updated_at).unwrap_or(0);
        let (x, y) = existing.as_ref().map(|p| (p.x, p.y)).unwrap_or((0.0, 0.0));
        let updated_at = Self::stamp(self.room_now(now), stored);

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
        self.put_player(id.clone(), player.clone())?;
        app::emit!(Event::PlayerJoined(id.clone()));
        Ok(Self::view_of(id, &player, true))
    }

    /// Silent presence + transform write (no SSE churn).
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
        self.put_player(id.clone(), player)?;
        if was_left {
            app::emit!(Event::PlayerJoined(id));
        }
        Ok(())
    }

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

    /// Roster with liveness. A player who vanished without `leave` ages out
    /// of the TTL here; nobody writes to another account's row to mark it.
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
            dir: p.dir,
            sel: p.sel,
            action: p.action.clone(),
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
    /// Alice's second machine. `call_as` moves the device and leaves the account
    /// alone, so ALICE and ALICE_PHONE are one person on two installations.
    const ALICE_PHONE: [u8; 32] = [0x33; 32];

    /// Render an id the way the contract does.
    ///
    /// `caller_id()` is `String::from(PublicKey)`, and the SDK renders that —
    /// so this helper does not get to choose. core 0.11.0-rc.27 removed base58
    /// (core#3691) and `Hash`'s Display is `hex::encode`, which silently
    /// changed what the contract emits. This was `bs58::encode` and every
    /// assertion comparing a player id against it failed at the SDK bump.
    fn id_of(bytes: [u8; 32]) -> String {
        hex::encode(bytes)
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
            action: "walking".to_owned(),
        }
    }

    #[test]
    fn world_meta_returns_init_params() {
        let app = new_world();
        let meta = app.view(|s| s.world_meta()).unwrap();
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
        app.call_as(ALICE, |s| {
            s.set_tiles(vec![Edit { x: 1, y: 1, t: 3 }], 1000)
        })
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
        let edits: Vec<Edit> = (0..513)
            .map(|i| Edit {
                x: i % 100,
                y: 1,
                t: 1,
            })
            .collect();
        assert!(app.call_as(ALICE, |s| s.set_tiles(edits, 1000)).is_err());
    }

    #[test]
    fn join_heartbeat_roster_lifecycle() {
        let mut app = new_world();
        app.call_as(ALICE, |s| s.join("Alice".to_owned(), 1000))
            .unwrap();
        app.call_as(ALICE, |s| s.heartbeat(t("Alice", 33.0), 1003))
            .unwrap();
        let players = app.view(|s| s.get_players(1005));
        assert_eq!(players.len(), 1);
        assert!(players[0].online);
        assert_eq!(players[0].x, 33.0);

        app.call_as(ALICE, |s| s.leave(1010)).unwrap();
        let players = app.view(|s| s.get_players(1011));
        assert!(!players[0].online);
    }

    #[test]
    fn a_vanished_player_ages_out_and_self_heals() {
        let mut app = new_world();
        app.call_as(ALICE, |s| s.join("Alice".to_owned(), 1000))
            .unwrap();
        app.call_as(BOB, |s| s.join("Bob".to_owned(), 1000))
            .unwrap();

        // Alice goes silent without `leave`; nobody writes her row, she is
        // offline because her stamp aged out.
        app.call_as(BOB, |s| s.heartbeat(t("Bob", 0.0), 1075))
            .unwrap();
        let alice = app
            .view(|s| s.get_players(1076))
            .into_iter()
            .find(|p| p.id == id_of(ALICE))
            .unwrap();
        assert!(!alice.online);

        app.call_as(ALICE, |s| s.heartbeat(t("Alice", 5.0), 1080))
            .unwrap();
        let alice = app
            .view(|s| s.get_players(1081))
            .into_iter()
            .find(|p| p.id == id_of(ALICE))
            .unwrap();
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
        app.call_as(BOB, |s| s.heartbeat(t("Bob", 0.0), 1600))
            .unwrap(); // 10 min ahead
        app.call_as(ALICE, |s| s.heartbeat(t("Alice", 0.0), 1002))
            .unwrap();
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
        app.call_as(ALICE, |s| s.join("Alice".to_owned(), 5000))
            .unwrap();
        app.call_as(ALICE, |s| s.heartbeat(t("Alice", 0.0), 1000))
            .unwrap();
        let players = app.view(|s| s.get_players(5002));
        assert!(players[0].online);
    }

    #[test]
    fn rejoin_preserves_joined_at_and_position() {
        let mut app = new_world();
        app.call_as(ALICE, |s| s.join("Alice".to_owned(), 1000))
            .unwrap();
        app.call_as(ALICE, |s| s.heartbeat(t("Alice", 42.0), 1005))
            .unwrap();
        app.call_as(ALICE, |s| s.join("Alice2".to_owned(), 1010))
            .unwrap();
        let players = app.view(|s| s.get_players(1011));
        assert_eq!(players[0].x, 42.0, "position survives rejoin");
        assert_eq!(players[0].name, "Alice2");
    }

    /// The rc.23 identity decision, made executable. `caller()` is the device on
    /// purpose (see its doc comment): an avatar is per-installation, so one
    /// person playing on two machines is two avatars standing in two places.
    /// Under `account_id()` both machines would write the SAME row and their
    /// heartbeats would overwrite each other's position twice a second — this
    /// test is what would catch that swap.
    #[test]
    fn one_person_on_two_devices_gets_two_avatars() {
        let mut app = new_world();
        app.call_as(ALICE, |s| s.heartbeat(t("Alice", 10.0), 1000))
            .unwrap();
        app.call_as(ALICE_PHONE, |s| s.heartbeat(t("Alice", 90.0), 1001))
            .unwrap();

        let players = app.view(|s| s.get_players(1002));
        assert_eq!(players.len(), 2, "two installations, two avatars");
        let laptop = players.iter().find(|p| p.id == id_of(ALICE)).unwrap();
        let phone = players.iter().find(|p| p.id == id_of(ALICE_PHONE)).unwrap();
        assert_eq!(laptop.x, 10.0);
        assert_eq!(
            phone.x, 90.0,
            "the second machine did not overwrite the first"
        );
    }

    /// The other axis: two people on machines of their own are still two rows,
    /// so the device keying above never collapses distinct players either.
    #[test]
    fn two_accounts_on_their_own_devices_are_two_players() {
        let mut app = new_world();
        app.call_as_account(ALICE, ALICE, |s| s.join("Alice".to_owned(), 1000))
            .unwrap();
        app.call_as_account(BOB, BOB, |s| s.join("Bob".to_owned(), 1001))
            .unwrap();
        let players = app.view(|s| s.get_players(1002));
        assert_eq!(players.len(), 2);
    }

    #[test]
    fn heartbeat_without_join_creates_a_live_row() {
        let mut app = new_world();
        app.call_as(ALICE, |s| s.heartbeat(t("Ghost", 1.0), 1000))
            .unwrap();
        let players = app.view(|s| s.get_players(1001));
        assert_eq!(players.len(), 1);
        assert!(players[0].online);
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
            s.set_tiles(vec![Edit { x: 1, y: 1, t: 3 }], 1000)
        })
        .unwrap();
        app.call_as(BOB, |s| s.set_tiles(vec![Edit { x: 2, y: 2, t: 8 }], 1000))
            .unwrap();
        assert_eq!(app.view(|s| s.get_overrides()).len(), 2);
    }

    #[test]
    fn transform_fields_survive_the_roundtrip() {
        let mut app = new_world();
        let tr = Transform {
            name: "Alice".to_owned(),
            x: 1.25,
            y: 60.5,
            dir: -1.0,
            sel: 7,
            action: "mining".to_owned(),
        };
        app.call_as(ALICE, |s| s.heartbeat(tr, 1000)).unwrap();
        let p = &app.view(|s| s.get_players(1001))[0];
        assert_eq!((p.x, p.y), (1.25, 60.5));
        assert_eq!(p.dir, -1.0);
        assert_eq!(p.sel, 7);
        assert_eq!(p.action, "mining");
    }

    #[test]
    fn empty_action_defaults_to_idle_and_join_starts_idle() {
        let mut app = new_world();
        app.call_as(ALICE, |s| s.join("Alice".to_owned(), 1000))
            .unwrap();
        let p = &app.view(|s| s.get_players(1001))[0];
        assert_eq!(p.action, "idle");
        let tr = Transform {
            name: "Alice".to_owned(),
            x: 1.0,
            y: 60.0,
            dir: 1.0,
            sel: 0,
            action: String::new(), // old clients omit the field (serde default)
        };
        app.call_as(ALICE, |s| s.heartbeat(tr, 1002)).unwrap();
        let p = &app.view(|s| s.get_players(1003))[0];
        assert_eq!(p.action, "idle");
    }

    #[test]
    fn empty_batch_applies_nothing_and_succeeds() {
        let mut app = new_world();
        let applied = app.call_as(ALICE, |s| s.set_tiles(vec![], 1000)).unwrap();
        assert_eq!(applied, 0);
    }

    #[test]
    fn world_edges_are_editable() {
        let mut app = new_world();
        let applied = app
            .call_as(ALICE, |s| {
                s.set_tiles(
                    vec![
                        Edit { x: 0, y: 0, t: 1 },
                        Edit {
                            x: 399,
                            y: 199,
                            t: 1,
                        },
                    ],
                    1000,
                )
            })
            .unwrap();
        assert_eq!(applied, 2, "corner tiles are in bounds");
    }

    #[test]
    fn tile_lww_stamps_are_monotonic_per_key() {
        let mut app = new_world();
        app.call_as(ALICE, |s| {
            s.set_tiles(vec![Edit { x: 2, y: 2, t: 7 }], 9000)
        })
        .unwrap();
        app.call_as(BOB, |s| s.set_tiles(vec![Edit { x: 2, y: 2, t: 4 }], 1000))
            .unwrap();
        let overrides = app.view(|s| s.get_overrides());
        assert_eq!(overrides[0].t, 4, "later edit wins even with a slow clock");
    }

    /// Founding parameters are a `Frozen` cell written by the account that
    /// ran `init`; there is no setter, and every node refuses a later write.
    #[test]
    fn world_meta_is_frozen_by_its_creator() {
        let app = new_world();
        assert!(app.view(|s| s.meta.writer()).is_some());
        assert_eq!(app.view(|s| s.world_meta()).unwrap().seed, 42);
    }

    /// Another account writing into my slot, as a patched node would, is
    /// refused by storage; my own heartbeat still lands.
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

    /// A row stamped `u64::MAX` must not drag room time with it.
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
                    dir: 1.0,
                    sel: 0,
                    action: "idle".to_owned(),
                    left: false,
                    joined_at: 0,
                    updated_at: u64::MAX,
                },
            )
        })
        .unwrap();
        app.call_as_account(ALICE, ALICE, |s| s.heartbeat(t("Alice", 1.0), 1000))
            .unwrap();

        let alice = app
            .view(|s| s.get_players(1003))
            .into_iter()
            .find(|p| p.id == id_of(ALICE))
            .unwrap();
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
