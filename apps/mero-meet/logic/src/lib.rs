//! Mero Meet — decentralized video-call signaling on Calimero.
//!
//! ## What this contract is (and is NOT)
//!
//! This WASM contract is the **control plane** of a video call. It is the
//! signaling server + room directory + presence layer, replicated as CRDT
//! state across every node in the context. It carries:
//!   - **presence / lobby** — who is in the room, their display name, status,
//!     and whether their mic/camera are on ("find people");
//!   - **WebRTC signaling** — opaque SDP offer/answer + ICE-candidate blobs,
//!     addressed peer→peer (`post_signal` / `get_signals`);
//!   - **call sessions** — a lightweight record of who is currently in a call.
//!
//! It does **NOT** carry the live audio/video media. Per RESEARCH-01.md, media
//! is far too latency-sensitive for a gossip/CRDT layer (libp2p gossip ~1s vs.
//! the <150ms interactive budget). The actual pixels travel peer-to-peer over
//! native WebRTC inside the Tauri desktop backend and never touch this contract.
//!
//! In short: **this contract decides who is allowed in the room and relays the
//! handshake; the media goes around it.**

use std::str::FromStr;

use calimero_sdk::borsh::{BorshDeserialize, BorshSerialize};
use calimero_sdk::serde::{Deserialize, Serialize};
use calimero_sdk::{app, env as sdk_env, PublicKey};
use calimero_storage::address::Id;
use calimero_storage::collections::crdt_meta::MergeError;
use calimero_storage::collections::rekey::RekeyTarget;
use calimero_storage::collections::{
    AccessControl, LwwRegister, Mergeable as MergeableTrait, Ownable, UnorderedMap, UnorderedSet,
};

// ── Types ───────────────────────────────────────────────────────────────────

type MemberId = String;
type SignalId = String;

/// Named role granted on top of the admin tier. Hosts may end the call for
/// everyone, mute others, and rename the room; everyone else is a participant.
const ROLE_HOST: &str = "host";

/// Cap on retained signals. Signaling messages are ephemeral handshake traffic;
/// once both peers are connected the blobs are dead weight. We keep the most
/// recent `MAX_SIGNALS` and prune the oldest, mirroring mero-tag's capped
/// location history. A few hundred is ample headroom for an N-party mesh.
const MAX_SIGNALS: usize = 512;

/// A participant heard from within this window (seconds) is considered online.
/// The frontend heartbeats every ~3s; 10s tolerates a couple of missed beats
/// while keeping the lobby's available/away status close to live.
const PRESENCE_TTL_SECS: u64 = 10;

/// A call participant silent for longer than this (in ROOM time — see
/// `room_now`) is a reap CANDIDATE. Far larger than the presence TTL: a
/// minimized window suspends JS timers (heartbeats stop) while WebRTC media
/// keeps flowing, and reaping must not kill demonstrably-live calls.
const REAP_STALE_SECS: u64 = 60;

/// A reap candidate is only actually reaped after staying silent for this
/// long AFTER being marked (two-pass reap). This grace absorbs room-clock
/// jumps: a joiner whose wall clock runs ahead teleports room time forward,
/// making everyone else look momentarily stale — one heartbeat clears the
/// mark. Only a peer whose presence row stays FROZEN through the grace is
/// truly gone.
const REAP_GRACE_SECS: u64 = 30;

/// Cap on retained chat messages (a room's rolling history).
const MAX_MESSAGES: usize = 1000;

/// Max chat message length. SDP blobs get 64 KiB; humans get 4 KiB.
const MAX_MESSAGE_CHARS: usize = 4096;

// ── Presence (the lobby) ──────────────────────────────────────────────────────

/// One row in the lobby: a person who is (or recently was) in this room.
#[derive(BorshSerialize, BorshDeserialize, Serialize, Deserialize, Clone, Debug)]
#[borsh(crate = "calimero_sdk::borsh")]
#[serde(crate = "calimero_sdk::serde")]
#[serde(rename_all = "camelCase")]
pub struct Presence {
    pub member_id: MemberId,
    pub username: String,
    /// "available" | "in_call" | "away". Free-form string so the frontend owns
    /// the vocabulary without a contract redeploy.
    pub status: String,
    /// Mic muted? (mirrored into the lobby so others see it before connecting)
    pub muted: bool,
    /// Camera on?
    pub video_on: bool,
    /// Id of the call this member is currently in, if any.
    pub call_id: Option<String>,
    pub joined_at: u64,
    /// Last heartbeat / state change. Drives both online-ness (TTL) and LWW.
    pub updated_at: u64,
}

impl MergeableTrait for Presence {
    fn merge(&mut self, other: &Self) -> Result<(), MergeError> {
        // Pure last-writer-wins on the heartbeat clock. `joined_at` is immutable
        // after first join, so the newer `updated_at` always carries truth.
        if other.updated_at > self.updated_at {
            *self = other.clone();
        }
        Ok(())
    }
}

// `Presence` is a flat record (no nested collections), so re-keying is a no-op —
// but rc.9's `Mergeable: RekeyTarget` supertrait bound requires the impl. The
// default `register_nested_value_types` (empty) is correct: nothing to cascade.
impl RekeyTarget for Presence {
    fn rekey_relative_to(&mut self, _parent_id: Id) {}
}

// ── Signaling ───────────────────────────────────────────────────────────────

/// A single WebRTC signaling message, addressed from one peer to another.
///
/// `payload` is an **opaque** string the contract never interprets — it is the
/// serialized SDP description or ICE candidate produced by the WebRTC engine on
/// the sender's machine. Per the WebRTC spec the signaling channel is a black
/// box; this contract is exactly that black box, made decentralized.
#[derive(BorshSerialize, BorshDeserialize, Serialize, Deserialize, Clone, Debug)]
#[borsh(crate = "calimero_sdk::borsh")]
#[serde(crate = "calimero_sdk::serde")]
#[serde(rename_all = "camelCase")]
pub struct Signal {
    pub id: SignalId,
    /// Monotonic per-room sequence — lets a peer poll "everything after N".
    pub seq: u64,
    pub from: MemberId,
    pub to: MemberId,
    /// "offer" | "answer" | "ice" | "bye". Free-form; the WebRTC client decides.
    pub kind: String,
    pub payload: String,
    pub call_id: String,
    pub created_at: u64,
}

impl MergeableTrait for Signal {
    fn merge(&mut self, other: &Self) -> Result<(), MergeError> {
        // Signals are immutable once posted; keyed by a unique id, so a merge of
        // "the same" signal is a no-op. Newer wins defensively.
        if other.created_at > self.created_at {
            *self = other.clone();
        }
        Ok(())
    }
}

// Flat record (no nested collections) → re-key is a no-op; impl exists only to
// satisfy rc.9's `Mergeable: RekeyTarget` supertrait bound.
impl RekeyTarget for Signal {
    fn rekey_relative_to(&mut self, _parent_id: Id) {}
}

// ── Reap marks (two-pass ghost detection) ─────────────────────────────────────

/// First-pass observation that a call participant looks stale. The participant
/// is reaped only if their presence row is STILL frozen at `row_ts` once
/// `REAP_GRACE_SECS` of room time has passed since `marked_at`. Any presence
/// movement clears the mark — this is "observed staleness", the contract-side
/// twin of the frontend's observed-liveness ghost logic, and it is what makes
/// reaping immune to wall-clock skew between members' machines.
#[derive(BorshSerialize, BorshDeserialize, Serialize, Deserialize, Clone, Debug)]
#[borsh(crate = "calimero_sdk::borsh")]
#[serde(crate = "calimero_sdk::serde")]
#[serde(rename_all = "camelCase")]
pub struct ReapMark {
    /// Room time when the participant was first seen stale.
    pub marked_at: u64,
    /// Their presence `updated_at` at mark time — movement clears the mark.
    pub row_ts: u64,
}

impl MergeableTrait for ReapMark {
    fn merge(&mut self, other: &Self) -> Result<(), MergeError> {
        // Later mark wins: concurrent observers converge on the most recent
        // observation, which only ever DELAYS a reap (the safe direction).
        if other.marked_at > self.marked_at {
            *self = other.clone();
        }
        Ok(())
    }
}

// Flat record → no-op re-key; required by rc.9's `Mergeable: RekeyTarget`.
impl RekeyTarget for ReapMark {
    fn rekey_relative_to(&mut self, _parent_id: Id) {}
}

// ── Chat ──────────────────────────────────────────────────────────────────────

/// One durable in-room chat message. Broadcast (not addressed): everyone in the
/// room reads the same rolling history via `get_messages`.
#[derive(BorshSerialize, BorshDeserialize, Serialize, Deserialize, Clone, Debug)]
#[borsh(crate = "calimero_sdk::borsh")]
#[serde(crate = "calimero_sdk::serde")]
#[serde(rename_all = "camelCase")]
pub struct ChatMessage {
    pub id: String,
    /// Monotonic per-room sequence — lets a client poll "everything after N".
    pub seq: u64,
    pub from: MemberId,
    /// Sender's display name at post time (denormalized so history keeps the
    /// name even after the member leaves).
    pub username: String,
    pub text: String,
    pub created_at: u64,
}

impl MergeableTrait for ChatMessage {
    fn merge(&mut self, other: &Self) -> Result<(), MergeError> {
        // Messages are immutable once posted; ids are unique per sender, so a
        // merge of "the same" message is a no-op. Newer wins defensively.
        if other.created_at > self.created_at {
            *self = other.clone();
        }
        Ok(())
    }
}

// Flat record → no-op re-key; required by rc.9's `Mergeable: RekeyTarget`.
impl RekeyTarget for ChatMessage {
    fn rekey_relative_to(&mut self, _parent_id: Id) {}
}

// ── Views (read-model returned to the frontend) ───────────────────────────────

#[derive(Serialize, Deserialize, Clone, Debug)]
#[serde(crate = "calimero_sdk::serde")]
#[serde(rename_all = "camelCase")]
pub struct RoomInfo {
    pub name: String,
    pub owner: Option<String>,
    pub member_count: u32,
    /// Members seen within `PRESENCE_TTL_SECS` of `now`.
    pub online_count: u32,
    pub active_call: String,
}

#[derive(Serialize, Deserialize, Clone, Debug)]
#[serde(crate = "calimero_sdk::serde")]
#[serde(rename_all = "camelCase")]
pub struct LobbyView {
    pub room: RoomInfo,
    pub members: Vec<Presence>,
    /// Member ids in `members` considered online given the `now` passed by caller.
    pub online: Vec<MemberId>,
}

// ── Events (pushed to subscribed frontends over SSE) ──────────────────────────

#[app::event]
pub enum Event {
    Initialized(),
    /// A member's lobby presence changed (joined / status / mute / video).
    PresenceChanged(MemberId),
    /// A signaling message was posted *to* this member id. The frontend filters
    /// `to == me` and calls `get_signals` to drain it.
    SignalPosted(MemberId),
    /// A call session was created/joined — used to "ring" the room.
    CallStarted(String),
    /// The call ended (host ended it, or last participant left).
    CallEnded(String),
    /// A member left the room.
    MemberLeft(MemberId),
    RoleUpdated(MemberId),
    /// A chat message was posted (carries its seq). Frontends drain via
    /// `get_messages(after_seq)` — this is what makes chat live over SSE.
    MessagePosted(u64),
}

// ── App state ─────────────────────────────────────────────────────────────────

#[app::state(emits = Event)]
pub struct MeroMeet {
    /// Room name lives in `Ownable` so a rename only converges from the owner —
    /// a forged rename from a non-owner is rejected at merge, not just by the
    /// fail-fast API guard. Same pattern as MeroDesign's board name.
    room_name: Ownable<LwwRegister<String>>,
    /// The lobby: every member who has joined the room, by identity.
    presence: UnorderedMap<MemberId, Presence>,
    /// Signaling mailbox. Keyed by signal id ("sig-{seq}-{from}" — the sender
    /// suffix keeps concurrent same-seq posts distinct); pruned to MAX_SIGNALS.
    signals: UnorderedMap<SignalId, Signal>,
    /// Identities currently in the active call (the media session roster).
    call_participants: UnorderedSet<MemberId>,
    /// Monotonic signal sequence counter.
    next_seq: LwwRegister<u64>,
    /// Id of the currently-active call ("" = no call in progress).
    active_call: LwwRegister<String>,
    /// Role registry: the creator is the sole initial admin (host).
    roles: AccessControl,
    /// Durable in-room chat, keyed by message id ("msg-{seq}-{from}"); pruned
    /// to MAX_MESSAGES. NOTE: added after 0.1.x — changes the state layout, so
    /// pre-chat rooms must be recreated (fake-prod convention: no migrations).
    messages: UnorderedMap<String, ChatMessage>,
    /// Monotonic chat sequence counter.
    next_msg_seq: LwwRegister<u64>,
    /// Two-pass reap bookkeeping (see `ReapMark`). NOTE: state-layout change —
    /// rooms created before this field must be recreated (no migrations).
    reap_marks: UnorderedMap<MemberId, ReapMark>,
}

// ── Logic ─────────────────────────────────────────────────────────────────────

#[app::logic]
impl MeroMeet {
    #[app::init]
    pub fn init(name: String) -> MeroMeet {
        let me = Self::caller();
        let mut room_name = Ownable::new_owned_by(me);
        let _ = room_name.insert(LwwRegister::new(name));
        MeroMeet {
            room_name,
            presence: UnorderedMap::new(),
            signals: UnorderedMap::new(),
            call_participants: UnorderedSet::new(),
            next_seq: LwwRegister::new(0),
            active_call: LwwRegister::new(String::new()),
            roles: AccessControl::new(me),
            messages: UnorderedMap::new(),
            next_msg_seq: LwwRegister::new(0),
            reap_marks: UnorderedMap::new(),
        }
    }

    // ── Identity & authorization helpers ──────────────────────────────────────

    /// The real signer of this invocation. Never trust a client-supplied id.
    fn caller() -> PublicKey {
        sdk_env::executor_id().into()
    }

    /// Base58 string form of the caller — matches the identity the frontend
    /// reads from `/contexts/{id}/identities-owned`.
    fn caller_id() -> String {
        String::from(Self::caller())
    }

    fn is_host(&self, who: &PublicKey) -> bool {
        self.roles.is_admin(who) || self.roles.has_role(ROLE_HOST, who).unwrap_or(false)
    }

    /// Gate a room-level / destructive op (end call, mute others, grant host).
    fn require_host(&self) -> app::Result<()> {
        if self.is_host(&Self::caller()) {
            return Ok(());
        }
        app::bail!("host access is required for this operation");
    }

    fn parse_pk(value: &str) -> app::Result<PublicKey> {
        PublicKey::from_str(value).map_err(|_| app::err!("invalid member public key"))
    }

    fn room_name_str(&self) -> String {
        self.room_name.get().map(|r| r.get().clone()).unwrap_or_default()
    }

    // ── Room time (skew-proof liveness clock) ──────────────────────────────────

    /// The newest presence stamp in the room. Together with the caller's clock
    /// this forms "room time": a monotone timeline that runs at the FASTEST
    /// member's clock rate. Members whose wall clocks run behind stamp their
    /// writes at room time (see `stamp`), so their rows never look stale to a
    /// member whose clock runs ahead. This is the contract-side fix for the
    /// clock-skew bug the frontend fixed in roster.ts: caller-`now` minus
    /// another-machine-`updated_at` is meaningless across laptops.
    fn latest_presence_ts(&self) -> u64 {
        self.presence
            .entries()
            .map(|e| e.map(|(_, p)| p.updated_at).max().unwrap_or(0))
            .unwrap_or(0)
    }

    /// Normalize the caller's clock onto room time. All liveness math (online
    /// TTL, reap candidacy) MUST go through this, never raw caller `now`.
    fn room_now(&self, caller_now: u64) -> u64 {
        caller_now.max(self.latest_presence_ts())
    }

    /// The value to write into a presence row: room time, and strictly after
    /// the stored stamp (backward clocks must never freeze liveness — the LWW
    /// merge would reject every future write).
    fn stamp(&self, caller_now: u64, stored: u64) -> u64 {
        self.room_now(caller_now).max(stored.saturating_add(1))
    }

    // ── Room ─────────────────────────────────────────────────────────────────

    pub fn get_room(&self, now: u64) -> RoomInfo {
        let now = self.room_now(now);
        let members: Vec<Presence> = self
            .presence
            .entries()
            .map(|e| e.map(|(_, p)| p).collect())
            .unwrap_or_default();
        let online = members
            .iter()
            .filter(|p| now.saturating_sub(p.updated_at) <= PRESENCE_TTL_SECS)
            .count() as u32;
        RoomInfo {
            name: self.room_name_str(),
            owner: self.room_name.owner().map(String::from),
            member_count: members.len() as u32,
            online_count: online,
            active_call: self.active_call.get().clone(),
        }
    }

    /// Owner-only rename — converges only from the room owner.
    pub fn rename_room(&mut self, name: String) -> app::Result<()> {
        self.room_name.only_owner()?;
        self.room_name.insert(LwwRegister::new(name))?;
        Ok(())
    }

    // ── Lobby / presence ───────────────────────────────────────────────────────

    /// Join the room (or refresh my profile). Idempotent: upserts my presence.
    /// `now` is the caller's unix-seconds clock (WASM has no wall clock).
    pub fn join(&mut self, username: String, now: u64) -> app::Result<Presence> {
        let id = Self::caller_id();
        // Read prior values (if any) into owned locals, then drop the borrow
        // before the mutating insert.
        let existing = self.presence.get(&id)?;
        let joined_at = existing.as_ref().map(|p| p.joined_at).unwrap_or(now);
        let muted = existing.as_ref().map(|p| p.muted).unwrap_or(false);
        let video_on = existing.as_ref().map(|p| p.video_on).unwrap_or(true);
        let call_id = existing.as_ref().and_then(|p| p.call_id.clone());
        // Room-time stamp, monotonic vs the prior row (backward clocks / skew).
        let stored = existing.as_ref().map(|p| p.updated_at).unwrap_or(0);
        drop(existing);
        let updated_at = self.stamp(now, stored);

        let presence = Presence {
            member_id: id.clone(),
            username,
            status: "available".to_string(),
            muted,
            video_on,
            call_id,
            joined_at,
            updated_at,
        };
        self.presence.insert(id.clone(), presence.clone())?;
        app::emit!(Event::PresenceChanged(id));
        Ok(presence)
    }

    /// Cheap liveness ping. Normally a **silent CRDT write** — gossips to other
    /// nodes so they see me as online, but emits NO event (avoids SSE churn;
    /// mero-chat's heartbeat pattern). As a side effect it reaps call
    /// participants whose presence went stale, so any living member keeps the
    /// roster honest (events fire only when something was actually reaped).
    pub fn heartbeat(&mut self, now: u64) -> app::Result<()> {
        let id = Self::caller_id();
        self.touch_presence(&id, now);
        self.reap_stale_participants(now);
        Ok(())
    }

    /// Bump `updated_at` onto room time, MONOTONICALLY past the stored value
    /// (see `stamp`) — a backward clock jump or a behind-running clock must
    /// never freeze liveness or lose the LWW merge.
    fn touch_presence(&mut self, id: &MemberId, now: u64) {
        let stored = match self.presence.get(id) {
            Ok(Some(p)) => p.updated_at,
            _ => return,
        };
        let stamp = self.stamp(now, stored);
        if let Ok(Some(mut p)) = self.presence.get_mut(id) {
            p.updated_at = stamp;
            drop(p);
        }
    }

    /// Drop call participants who crashed / closed the window without
    /// `leave_call` — in TWO passes. Pass 1: a participant silent for
    /// `REAP_STALE_SECS` of room time gets a `ReapMark`. Pass 2 (a later
    /// invocation): if their presence row is STILL frozen after
    /// `REAP_GRACE_SECS`, they are reaped; any movement clears the mark.
    /// Single-pass reaping killed live calls whenever a member's wall clock
    /// ran ahead (their heartbeat made everyone else look stale) — the exact
    /// "we're both in a call but can't see each other" failure.
    ///
    /// Reaping also clears the ghost's own presence call state, so the lobby
    /// stops saying "in call" forever about someone whose window closed.
    /// Participants with NO presence row are kept — we cannot judge them.
    /// Ends the call when the last participant is gone. Runs on every
    /// heartbeat, so the roster self-heals as long as anyone is alive.
    fn reap_stale_participants(&mut self, now: u64) {
        let room_now = self.room_now(now);
        let mut reaped: Vec<MemberId> = Vec::new();
        for id in self.get_call_participants() {
            let row_ts = match self.presence.get(&id) {
                Ok(Some(p)) => p.updated_at,
                _ => continue, // no presence row — cannot judge, keep
            };
            if room_now.saturating_sub(row_ts) <= REAP_STALE_SECS {
                let _ = self.reap_marks.remove(&id); // provably alive
                continue;
            }
            // Copy the mark out (owned) so the read borrow ends before the
            // insert below.
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
                    // First sighting as stale (or they moved since the last
                    // mark): (re)start the grace clock.
                    let _ = self
                        .reap_marks
                        .insert(id.clone(), ReapMark { marked_at: room_now, row_ts });
                }
            }
        }
        if reaped.is_empty() {
            return;
        }
        for id in &reaped {
            let _ = self.call_participants.remove(id);
            let _ = self.reap_marks.remove(id);
            // Clear the ghost's "in call" presence. The +1 bump stays on their
            // own timeline (they remain stale — we never forge a foreign
            // clock) but wins the merge against the frozen row; if they are
            // actually alive, their next own write stamps room time and wins.
            if let Ok(Some(mut p)) = self.presence.get_mut(id) {
                p.status = "away".to_string();
                p.call_id = None;
                p.updated_at = p.updated_at.saturating_add(1);
                drop(p);
            }
        }
        if self.call_participants.len().unwrap_or(0) == 0 {
            // Emits CallEnded — the room falls back to "Start call".
            self.end_active_call_internal();
        } else {
            for id in reaped {
                app::emit!(Event::MemberLeft(id));
            }
        }
    }

    /// Update my mic/camera/status. Emits so the lobby UI updates live.
    pub fn set_state(
        &mut self,
        muted: Option<bool>,
        video_on: Option<bool>,
        status: Option<String>,
        now: u64,
    ) -> app::Result<()> {
        let id = Self::caller_id();
        let room = self.room_now(now);
        let mut found = false;
        if let Ok(Some(mut p)) = self.presence.get_mut(&id) {
            if let Some(m) = muted {
                p.muted = m;
            }
            if let Some(v) = video_on {
                p.video_on = v;
            }
            if let Some(s) = status {
                p.status = s;
            }
            p.updated_at = room.max(p.updated_at.saturating_add(1));
            drop(p);
            found = true;
        }
        if !found {
            app::bail!("join the room before updating state");
        }
        app::emit!(Event::PresenceChanged(id));
        Ok(())
    }

    /// Leave the room: mark away and drop out of any active call.
    pub fn leave(&mut self, now: u64) -> app::Result<()> {
        let id = Self::caller_id();
        let room = self.room_now(now);
        if let Ok(Some(mut p)) = self.presence.get_mut(&id) {
            p.status = "away".to_string();
            p.call_id = None;
            p.updated_at = room.max(p.updated_at.saturating_add(1));
            drop(p);
        }
        let _ = self.call_participants.remove(&id);
        // Last one out ends the call.
        if self.call_participants.len().unwrap_or(0) == 0 {
            self.end_active_call_internal();
        }
        app::emit!(Event::MemberLeft(id));
        Ok(())
    }

    pub fn get_lobby(&self, now: u64) -> LobbyView {
        let room_now = self.room_now(now);
        let members: Vec<Presence> = self
            .presence
            .entries()
            .map(|e| e.map(|(_, p)| p).collect())
            .unwrap_or_default();
        let online = members
            .iter()
            .filter(|p| room_now.saturating_sub(p.updated_at) <= PRESENCE_TTL_SECS)
            .map(|p| p.member_id.clone())
            .collect();
        LobbyView {
            room: self.get_room(now),
            members,
            online,
        }
    }

    // ── Call session ───────────────────────────────────────────────────────────

    /// Start a call (or join the running one). Returns the call id. The first
    /// caller's id + clock becomes the session id. Emits `CallStarted` so the
    /// room rings.
    pub fn start_call(&mut self, now: u64) -> app::Result<String> {
        let id = Self::caller_id();
        // Refresh our own presence FIRST (joining a call is a sign of life),
        // then run the standard two-pass reap. If everyone in the recorded
        // call is provably gone (silent through the mark + grace windows),
        // the reap ends it and we mint a FRESH session below — the backstop
        // for "everybody leaves ungracefully → next caller starts clean".
        // NOTE: this must NOT be an instant staleness check — a joiner whose
        // wall clock ran ahead used to kill the live call right here, which
        // is why "the other person never got the invite".
        self.touch_presence(&id, now);
        self.reap_stale_participants(now);
        let mut call_id = self.active_call.get().clone();
        if call_id.is_empty() {
            // Deterministic id (no WASM randomness): starter prefix + clock.
            let prefix = &id[..id.len().min(8)];
            call_id = format!("call-{}-{}", prefix, now);
            self.active_call.set(call_id.clone());
            app::emit!(Event::CallStarted(call_id.clone()));
        }
        self.call_participants.insert(id.clone())?;
        let room = self.room_now(now);
        if let Ok(Some(mut p)) = self.presence.get_mut(&id) {
            p.status = "in_call".to_string();
            p.call_id = Some(call_id.clone());
            p.updated_at = room.max(p.updated_at.saturating_add(1));
            drop(p);
        }
        app::emit!(Event::PresenceChanged(id));
        Ok(call_id)
    }

    /// Leave the call but stay in the lobby.
    pub fn leave_call(&mut self, now: u64) -> app::Result<()> {
        let id = Self::caller_id();
        let _ = self.call_participants.remove(&id);
        let room = self.room_now(now);
        if let Ok(Some(mut p)) = self.presence.get_mut(&id) {
            p.status = "available".to_string();
            p.call_id = None;
            p.updated_at = room.max(p.updated_at.saturating_add(1));
            drop(p);
        }
        if self.call_participants.len().unwrap_or(0) == 0 {
            self.end_active_call_internal();
        }
        app::emit!(Event::PresenceChanged(id));
        Ok(())
    }

    /// Host force-ends the call for everyone.
    pub fn end_call(&mut self) -> app::Result<()> {
        self.require_host()?;
        self.end_active_call_internal();
        Ok(())
    }

    fn end_active_call_internal(&mut self) {
        let call_id = self.active_call.get().clone();
        if !call_id.is_empty() {
            self.active_call.set(String::new());
            let _ = self.call_participants.clear();
            app::emit!(Event::CallEnded(call_id));
        }
    }

    /// Roster of identities currently in the call.
    pub fn get_call_participants(&self) -> Vec<MemberId> {
        self.call_participants
            .iter()
            .map(|it| it.collect())
            .unwrap_or_default()
    }

    pub fn active_call_id(&self) -> String {
        self.active_call.get().clone()
    }

    // ── Signaling (the WebRTC handshake relay) ────────────────────────────────

    /// Post an opaque WebRTC signaling blob addressed to `to`. Returns the seq.
    /// Emits `SignalPosted(to)` so the recipient is nudged over SSE.
    ///
    /// Caller must be a room member (have presence). We do not gate on call
    /// membership — the handshake necessarily precedes joining the media session.
    pub fn post_signal(
        &mut self,
        to: MemberId,
        kind: String,
        payload: String,
        call_id: String,
        now: u64,
    ) -> app::Result<u64> {
        let from = Self::caller_id();
        if self.presence.get(&from)?.is_none() {
            app::bail!("join the room before sending signals");
        }
        // Posting a signal IS a sign of life — count it as one. A peer whose
        // heartbeat timers are throttled (minimized window) but who is
        // actively negotiating must not look dead to the reaper or the lobby.
        self.touch_presence(&from, now);
        // SDP/ICE blobs are small; this is a sanity cap, not a real limit.
        if payload.len() > 64 * 1024 {
            app::bail!("signal payload too large");
        }
        let seq = self.next_seq.get().saturating_add(1);
        self.next_seq.set(seq);
        // Id must include the SENDER: `next_seq` is an LwwRegister, so two nodes
        // posting concurrently mint the SAME seq — with a bare `sig-{seq}` both
        // signals landed on one map key and the merge silently dropped one
        // (losing an offer/answer mid-handshake). The frontend tolerates the
        // duplicate seq numbers by draining with a margin and deduping by id.
        let sig_id = format!("sig-{}-{}", seq, &from[..from.len().min(8)]);
        let signal = Signal {
            id: sig_id.clone(),
            seq,
            from,
            to: to.clone(),
            kind,
            payload,
            call_id,
            created_at: now,
        };
        self.signals.insert(sig_id, signal)?;
        self.prune_signals();
        app::emit!(Event::SignalPosted(to));
        Ok(seq)
    }

    /// Drain signals addressed to me with `seq > after_seq`, oldest first.
    /// The frontend tracks the highest seq it has consumed and passes it back.
    pub fn get_signals(&self, after_seq: u64) -> Vec<Signal> {
        let me = Self::caller_id();
        let mut out: Vec<Signal> = self
            .signals
            .entries()
            .map(|e| {
                e.map(|(_, s)| s)
                    .filter(|s| s.to == me && s.seq > after_seq)
                    .collect()
            })
            .unwrap_or_default();
        out.sort_by_key(|s| s.seq);
        out
    }

    /// Keep only the most recent `MAX_SIGNALS` by dropping the lowest seqs.
    /// Collects (seq, id) pairs and removes by the ACTUAL stored id — ids embed
    /// the sender (`sig-{seq}-{from}`), and two concurrent posts can share a
    /// seq, so reconstructing keys from seq alone would miss entries.
    fn prune_signals(&mut self) {
        let len = self.signals.len().unwrap_or(0);
        if len <= MAX_SIGNALS {
            return;
        }
        let mut entries: Vec<(u64, SignalId)> = self
            .signals
            .entries()
            .map(|e| e.map(|(id, s)| (s.seq, id)).collect())
            .unwrap_or_default();
        entries.sort();
        let to_drop = len - MAX_SIGNALS;
        for (_, id) in entries.into_iter().take(to_drop) {
            let _ = self.signals.remove(&id);
        }
    }

    // ── Chat (durable in-room messages) ────────────────────────────────────────

    /// Post a chat message to the room. Requires room membership (presence).
    /// Returns the message seq; emits `MessagePosted(seq)` so subscribed
    /// frontends drain immediately over SSE instead of waiting for a poll.
    pub fn post_message(&mut self, text: String, now: u64) -> app::Result<u64> {
        let from = Self::caller_id();
        let username = match self.presence.get(&from)? {
            Some(p) => p.username.clone(),
            None => app::bail!("join the room before posting messages"),
        };
        // Chatting is a sign of life — same reasoning as post_signal.
        self.touch_presence(&from, now);
        let text = text.trim().to_owned();
        if text.is_empty() {
            app::bail!("message is empty");
        }
        if text.len() > MAX_MESSAGE_CHARS {
            app::bail!("message too long");
        }
        let seq = self.next_msg_seq.get().saturating_add(1);
        self.next_msg_seq.set(seq);
        // Sender-suffixed id — same reasoning as signals: `next_msg_seq` is an
        // LwwRegister, so two nodes can mint the same seq concurrently; distinct
        // ids keep both messages instead of silently merging one away.
        let id = format!("msg-{}-{}", seq, &from[..from.len().min(8)]);
        let msg = ChatMessage {
            id: id.clone(),
            seq,
            from,
            username,
            text,
            created_at: now,
        };
        self.messages.insert(id, msg)?;
        self.prune_messages();
        app::emit!(Event::MessagePosted(seq));
        Ok(seq)
    }

    /// Rolling room history with `seq > after_seq`, oldest first. Broadcast:
    /// every member reads the same messages (unlike addressed signals).
    pub fn get_messages(&self, after_seq: u64) -> Vec<ChatMessage> {
        let mut out: Vec<ChatMessage> = self
            .messages
            .entries()
            .map(|e| e.map(|(_, m)| m).filter(|m| m.seq > after_seq).collect())
            .unwrap_or_default();
        out.sort_by_key(|m| m.seq);
        out
    }

    /// Keep only the most recent MAX_MESSAGES, dropping the lowest seqs.
    /// Removes by actual stored id (ids embed the sender; seqs can duplicate).
    fn prune_messages(&mut self) {
        let len = self.messages.len().unwrap_or(0);
        if len <= MAX_MESSAGES {
            return;
        }
        let mut entries: Vec<(u64, String)> = self
            .messages
            .entries()
            .map(|e| e.map(|(id, m)| (m.seq, id)).collect())
            .unwrap_or_default();
        entries.sort();
        let to_drop = len - MAX_MESSAGES;
        for (_, id) in entries.into_iter().take(to_drop) {
            let _ = self.messages.remove(&id);
        }
    }

    // ── Roles (host management) ────────────────────────────────────────────────

    pub fn grant_host(&mut self, member: MemberId) -> app::Result<()> {
        self.require_host()?;
        let who = Self::parse_pk(&member)?;
        self.roles.grant(ROLE_HOST, who)?;
        app::emit!(Event::RoleUpdated(member));
        Ok(())
    }

    pub fn revoke_host(&mut self, member: MemberId) -> app::Result<()> {
        self.require_host()?;
        let who = Self::parse_pk(&member)?;
        self.roles.revoke(ROLE_HOST, &who)?;
        app::emit!(Event::RoleUpdated(member));
        Ok(())
    }

    pub fn is_member_host(&self, member: MemberId) -> bool {
        match Self::parse_pk(&member) {
            Ok(pk) => self.is_host(&pk),
            Err(_) => false,
        }
    }
}

// ── Tests ─────────────────────────────────────────────────────────────────────

#[cfg(test)]
mod tests {
    use calimero_sdk::testing::TestHost;

    use super::{MeroMeet, MAX_SIGNALS};

    const ALICE: [u8; 32] = [0x11; 32];
    const BOB: [u8; 32] = [0x22; 32];

    fn id_of(bytes: [u8; 32]) -> String {
        bs58::encode(bytes).into_string()
    }

    /// init runs as the default test executor, who becomes the room owner/admin.
    fn new_room() -> TestHost<MeroMeet> {
        TestHost::new(|| MeroMeet::init("standup".to_owned()))
    }

    // ── Lobby / presence ───────────────────────────────────────────────────────

    #[test]
    fn join_lists_members_and_online_respects_ttl() {
        let mut app = new_room();
        app.call_as(ALICE, |s| s.join("Alice".to_owned(), 1000)).unwrap();
        app.call_as(BOB, |s| s.join("Bob".to_owned(), 1005)).unwrap();

        let lobby = app.view(|s| s.get_lobby(1008));
        assert_eq!(lobby.members.len(), 2);
        assert_eq!(lobby.online.len(), 2);

        // 12s after Alice's last beat she is offline; Bob (7s) is still online.
        let lobby = app.view(|s| s.get_lobby(1012));
        assert_eq!(lobby.online, vec![id_of(BOB)]);
    }

    #[test]
    fn heartbeat_refreshes_online_status() {
        let mut app = new_room();
        app.call_as(ALICE, |s| s.join("Alice".to_owned(), 1000)).unwrap();
        app.call_as(ALICE, |s| s.heartbeat(1040)).unwrap();
        let lobby = app.view(|s| s.get_lobby(1045));
        assert_eq!(lobby.online, vec![id_of(ALICE)]);
    }

    // ── Call lifecycle ─────────────────────────────────────────────────────────

    #[test]
    fn start_call_shares_one_session_and_last_leave_ends_it() {
        let mut app = new_room();
        app.call_as(ALICE, |s| s.join("Alice".to_owned(), 1000)).unwrap();
        app.call_as(BOB, |s| s.join("Bob".to_owned(), 1000)).unwrap();

        let id1 = app.call_as(ALICE, |s| s.start_call(1001)).unwrap();
        let id2 = app.call_as(BOB, |s| s.start_call(1002)).unwrap();
        assert_eq!(id1, id2, "second caller joins the running session");
        assert_eq!(app.view(|s| s.get_call_participants()).len(), 2);

        app.call_as(ALICE, |s| s.leave_call(1010)).unwrap();
        assert_eq!(app.view(|s| s.get_call_participants()).len(), 1);
        assert_ne!(app.view(|s| s.active_call_id()), "", "call survives while someone is in it");

        app.call_as(BOB, |s| s.leave_call(1011)).unwrap();
        assert_eq!(app.view(|s| s.active_call_id()), "", "last leave ends the call");
        assert!(app.view(|s| s.get_call_participants()).is_empty());
    }

    #[test]
    fn live_call_is_joined_not_reaped() {
        let mut app = new_room();
        app.call_as(ALICE, |s| s.join("Alice".to_owned(), 1000)).unwrap();
        app.call_as(BOB, |s| s.join("Bob".to_owned(), 1000)).unwrap();
        let id1 = app.call_as(ALICE, |s| s.start_call(1001)).unwrap();
        // Bob joins 9s later — Alice's presence is fresh, so same session.
        let id2 = app.call_as(BOB, |s| s.start_call(1010)).unwrap();
        assert_eq!(id1, id2);
    }

    #[test]
    fn stale_ghost_participant_is_reaped_after_mark_and_grace() {
        let mut app = new_room();
        app.call_as(ALICE, |s| s.join("Alice".to_owned(), 1000)).unwrap();
        let ghost = app.call_as(ALICE, |s| s.start_call(1001)).unwrap();

        // Alice's window died: no leave_call, heartbeats stop. 1000s later Bob
        // calls. The FIRST pass only MARKS Alice (an instant kill here is the
        // clock-skew bug: a joiner with a fast clock murdered live calls).
        app.call_as(BOB, |s| s.join("Bob".to_owned(), 2000)).unwrap();
        let joined = app.call_as(BOB, |s| s.start_call(2001)).unwrap();
        assert_eq!(joined, ghost, "session survives until the ghost is PROVEN dead");
        // Alice's row stays frozen through the grace window → next pass reaps.
        app.call_as(BOB, |s| s.heartbeat(2040)).unwrap();
        assert_eq!(app.view(|s| s.get_call_participants()), vec![id_of(BOB)]);
    }

    #[test]
    fn fully_dead_call_is_ended_and_next_start_is_fresh() {
        let mut app = new_room();
        app.call_as(ALICE, |s| s.join("Alice".to_owned(), 1000)).unwrap();
        let ghost = app.call_as(ALICE, |s| s.start_call(1001)).unwrap();

        // Alice crashed; Bob sits in the LOBBY. His first beat marks her, his
        // second (past the grace) reaps her — the empty call is killed, and
        // the next start mints a fresh session ("everybody leaves → kill it").
        app.call_as(BOB, |s| s.join("Bob".to_owned(), 2000)).unwrap();
        app.call_as(BOB, |s| s.heartbeat(2005)).unwrap();
        app.call_as(BOB, |s| s.heartbeat(2040)).unwrap();
        assert!(app.view(|s| s.get_call_participants()).is_empty());
        assert_eq!(app.view(|s| s.active_call_id()), "", "empty call is killed");
        let fresh = app.call_as(BOB, |s| s.start_call(2050)).unwrap();
        assert_ne!(fresh, ghost, "dead session must not be resurrected");
    }

    #[test]
    fn heartbeat_reaps_crashed_participants() {
        let mut app = new_room();
        app.call_as(ALICE, |s| s.join("Alice".to_owned(), 1000)).unwrap();
        app.call_as(BOB, |s| s.join("Bob".to_owned(), 1000)).unwrap();
        let call = app.call_as(ALICE, |s| s.start_call(1001)).unwrap();
        let _ = app.call_as(BOB, |s| s.start_call(1002)).unwrap();

        // Alice crashes (no leave_call, heartbeats stop). Bob keeps beating:
        // once she is REAP_STALE_SECS silent he marks her, and REAP_GRACE_SECS
        // later — row still frozen — reaps her.
        app.call_as(BOB, |s| s.heartbeat(1070)).unwrap();
        assert_eq!(
            app.view(|s| s.get_call_participants()).len(),
            2,
            "first stale sighting only marks"
        );
        app.call_as(BOB, |s| s.heartbeat(1105)).unwrap();
        assert_eq!(
            app.view(|s| s.get_call_participants()),
            vec![id_of(BOB)],
            "crashed peer dropped from the roster"
        );
        assert_eq!(app.view(|s| s.active_call_id()), call, "call survives for the living");

        // The ghost's own presence was cleared too — the lobby must stop
        // saying "in call" forever about someone whose window closed.
        let lobby = app.view(|s| s.get_lobby(1106));
        let alice = lobby.members.iter().find(|m| m.member_id == id_of(ALICE)).unwrap();
        assert_eq!(alice.call_id, None, "ghost presence no longer in-call");
        assert_eq!(alice.status, "away");
    }

    #[test]
    fn heartbeat_reap_ends_call_when_last_living_participant_is_a_ghost() {
        let mut app = new_room();
        app.call_as(ALICE, |s| s.join("Alice".to_owned(), 1000)).unwrap();
        app.call_as(BOB, |s| s.join("Bob".to_owned(), 1000)).unwrap();
        let _ = app.call_as(ALICE, |s| s.start_call(1001)).unwrap();

        // Alice (the only participant) crashes; Bob is in the lobby, not the
        // call. His beats mark then reap her, ending the ghost call entirely.
        app.call_as(BOB, |s| s.heartbeat(1070)).unwrap();
        app.call_as(BOB, |s| s.heartbeat(1105)).unwrap();
        assert!(app.view(|s| s.get_call_participants()).is_empty());
        assert_eq!(app.view(|s| s.active_call_id()), "", "empty call is killed");
    }

    #[test]
    fn heartbeat_does_not_reap_fresh_participants() {
        let mut app = new_room();
        app.call_as(ALICE, |s| s.join("Alice".to_owned(), 1000)).unwrap();
        app.call_as(BOB, |s| s.join("Bob".to_owned(), 1000)).unwrap();
        let _ = app.call_as(ALICE, |s| s.start_call(1001)).unwrap();
        // 30s later Alice is inside the reap window — a lagging beat is not
        // death (she is not even marked).
        app.call_as(BOB, |s| s.heartbeat(1031)).unwrap();
        app.call_as(BOB, |s| s.heartbeat(1055)).unwrap();
        assert_eq!(app.view(|s| s.get_call_participants()), vec![id_of(ALICE)]);
    }

    #[test]
    fn clock_skew_does_not_kill_a_live_call() {
        // Alice's laptop clock runs ~90s behind Bob's. Under the old
        // caller-clock staleness check, Bob's start_call saw Alice "91s
        // silent", ended her live call and minted his own session — both
        // users ended up alone in a call ("black screen").
        let mut app = new_room();
        app.call_as(ALICE, |s| s.join("Alice".to_owned(), 1000)).unwrap();
        app.call_as(BOB, |s| s.join("Bob".to_owned(), 1090)).unwrap();
        let a = app.call_as(ALICE, |s| s.start_call(1001)).unwrap();
        let b = app.call_as(BOB, |s| s.start_call(1092)).unwrap();
        assert_eq!(a, b, "skewed joiner joins the running session, never kills it");

        // Both keep beating on their own (skewed) clocks; nobody gets reaped.
        for i in 0..20u64 {
            app.call_as(ALICE, |s| s.heartbeat(1002 + i * 3)).unwrap();
            app.call_as(BOB, |s| s.heartbeat(1093 + i * 3)).unwrap();
        }
        assert_eq!(app.view(|s| s.get_call_participants()).len(), 2);
        assert_eq!(app.view(|s| s.active_call_id()), a);
        // And BOTH read as online to any viewer, regardless of viewer clock.
        let lobby = app.view(|s| s.get_lobby(1060));
        assert_eq!(lobby.online.len(), 2, "skewed-behind member still shows online");
    }

    #[test]
    fn clock_teleport_is_survived_by_one_heartbeat() {
        // Bob's clock is ~10min ahead: his join teleports room time forward,
        // making Alice look stale for a moment. One heartbeat from her (on
        // her own slow clock) must clear the mark before the grace expires.
        let mut app = new_room();
        app.call_as(ALICE, |s| s.join("Alice".to_owned(), 1000)).unwrap();
        let call = app.call_as(ALICE, |s| s.start_call(1001)).unwrap();
        app.call_as(BOB, |s| s.join("Bob".to_owned(), 1600)).unwrap();
        let joined = app.call_as(BOB, |s| s.start_call(1601)).unwrap();
        assert_eq!(joined, call, "first stale sighting may only mark, not kill");

        app.call_as(ALICE, |s| s.heartbeat(1004)).unwrap(); // her clock, seconds later
        app.call_as(BOB, |s| s.heartbeat(1640)).unwrap(); // past the grace window
        assert_eq!(
            app.view(|s| s.get_call_participants()).len(),
            2,
            "alice survived the room-clock teleport"
        );
    }

    #[test]
    fn leaving_the_room_also_leaves_the_call() {
        let mut app = new_room();
        app.call_as(ALICE, |s| s.join("Alice".to_owned(), 1000)).unwrap();
        let _ = app.call_as(ALICE, |s| s.start_call(1001)).unwrap();
        app.call_as(ALICE, |s| s.leave(1002)).unwrap();
        assert_eq!(app.view(|s| s.active_call_id()), "");
        assert!(app.view(|s| s.get_call_participants()).is_empty());
    }

    #[test]
    fn end_call_requires_host() {
        let mut app = new_room();
        app.call_as(BOB, |s| s.join("Bob".to_owned(), 1000)).unwrap();
        let _ = app.call_as(BOB, |s| s.start_call(1001)).unwrap();

        assert!(app.call_as(BOB, |s| s.end_call()).is_err(), "non-host cannot end for everyone");
        app.call(|s| s.end_call()).unwrap(); // creator (admin) can
        assert_eq!(app.view(|s| s.active_call_id()), "");
    }

    // ── Signaling ──────────────────────────────────────────────────────────────

    #[test]
    fn signals_are_addressed_seq_filtered_and_sender_unique() {
        let mut app = new_room();
        app.call_as(ALICE, |s| s.join("Alice".to_owned(), 1000)).unwrap();
        app.call_as(BOB, |s| s.join("Bob".to_owned(), 1000)).unwrap();

        app.call_as(ALICE, |s| {
            s.post_signal(id_of(BOB), "offer".to_owned(), "sdp-a".to_owned(), "c1".to_owned(), 1001)
        })
        .unwrap();
        app.call_as(BOB, |s| {
            s.post_signal(id_of(ALICE), "answer".to_owned(), "sdp-b".to_owned(), "c1".to_owned(), 1002)
        })
        .unwrap();

        // Addressed delivery: each side sees only what was sent TO them.
        let bobs = app.call_as(BOB, |s| s.get_signals(0));
        assert_eq!(bobs.len(), 1);
        assert_eq!(bobs[0].kind, "offer");
        assert_eq!(bobs[0].from, id_of(ALICE));

        // Ids embed the sender so two nodes minting the same seq concurrently
        // can never collide on a map key (which silently dropped one signal).
        assert_eq!(bobs[0].id, format!("sig-{}-{}", bobs[0].seq, &id_of(ALICE)[..8]));

        // after_seq filtering.
        let alices = app.call_as(ALICE, |s| s.get_signals(0));
        assert_eq!(alices.len(), 1);
        let none = app.call_as(ALICE, |s| s.get_signals(alices[0].seq));
        assert!(none.is_empty());
    }

    #[test]
    fn posting_requires_room_membership() {
        let mut app = new_room();
        let denied = app.call_as(ALICE, |s| {
            s.post_signal(id_of(BOB), "offer".to_owned(), "sdp".to_owned(), "c1".to_owned(), 1000)
        });
        assert!(denied.is_err());
    }

    #[test]
    fn backward_clock_cannot_freeze_liveness() {
        let mut app = new_room();
        app.call_as(ALICE, |s| s.join("Alice".to_owned(), 1000)).unwrap();
        // Alice's clock jumps BACKWARD (NTP correction) — her next heartbeats
        // carry older wall times. updated_at must still advance monotonically,
        // or the LWW merge would reject every future write and she'd read as
        // a ghost forever while demonstrably alive.
        app.call_as(ALICE, |s| s.heartbeat(900)).unwrap();
        let lobby = app.view(|s| s.get_lobby(1005));
        assert_eq!(lobby.online, vec![id_of(ALICE)], "still online after clock jump");
        assert!(lobby.members[0].updated_at > 1000, "updated_at advanced past the join");
    }

    #[test]
    fn posting_a_signal_counts_as_liveness() {
        let mut app = new_room();
        app.call_as(ALICE, |s| s.join("Alice".to_owned(), 1000)).unwrap();
        app.call_as(BOB, |s| s.join("Bob".to_owned(), 1000)).unwrap();
        // Alice's heartbeats stop (throttled window) but she keeps negotiating.
        app.call_as(ALICE, |s| {
            s.post_signal(id_of(BOB), "offer".to_owned(), "sdp".to_owned(), "c1".to_owned(), 1050)
        })
        .unwrap();
        let lobby = app.view(|s| s.get_lobby(1060));
        assert!(
            lobby.online.contains(&id_of(ALICE)),
            "actively-signaling member must not read as offline/ghost"
        );
    }

    // ── Chat ───────────────────────────────────────────────────────────────────

    #[test]
    fn chat_roundtrip_broadcast_and_seq_filtered() {
        let mut app = new_room();
        app.call_as(ALICE, |s| s.join("Alice".to_owned(), 1000)).unwrap();
        app.call_as(BOB, |s| s.join("Bob".to_owned(), 1000)).unwrap();

        let s1 = app.call_as(ALICE, |s| s.post_message("hi all".to_owned(), 1001)).unwrap();
        let s2 = app.call_as(BOB, |s| s.post_message("hey".to_owned(), 1002)).unwrap();
        assert!(s2 > s1);

        // Broadcast: BOTH members read the same history, oldest first, with the
        // sender's display name denormalized in.
        let all = app.call_as(ALICE, |s| s.get_messages(0));
        assert_eq!(all.len(), 2);
        assert_eq!(all[0].text, "hi all");
        assert_eq!(all[0].username, "Alice");
        assert_eq!(all[1].username, "Bob");
        // Sender-unique id (same LWW-seq-collision defence as signals).
        assert_eq!(all[0].id, format!("msg-{}-{}", all[0].seq, &id_of(ALICE)[..8]));

        // after_seq filtering drains only the new tail.
        let tail = app.call_as(BOB, |s| s.get_messages(s1));
        assert_eq!(tail.len(), 1);
        assert_eq!(tail[0].text, "hey");
    }

    #[test]
    fn chat_requires_membership_and_rejects_empty_or_oversized() {
        let mut app = new_room();
        assert!(app.call_as(ALICE, |s| s.post_message("hi".to_owned(), 1000)).is_err());

        app.call_as(ALICE, |s| s.join("Alice".to_owned(), 1000)).unwrap();
        assert!(app.call_as(ALICE, |s| s.post_message("   ".to_owned(), 1001)).is_err());
        let huge = "x".repeat(super::MAX_MESSAGE_CHARS + 1);
        assert!(app.call_as(ALICE, |s| s.post_message(huge, 1002)).is_err());
    }

    #[test]
    fn chat_prunes_to_cap_dropping_lowest_seqs() {
        let mut app = new_room();
        app.call_as(ALICE, |s| s.join("Alice".to_owned(), 1000)).unwrap();
        let over = 5;
        for i in 0..(super::MAX_MESSAGES as u64 + over) {
            app.call_as(ALICE, |s| s.post_message(format!("m{i}"), 1000 + i)).unwrap();
        }
        let msgs = app.call_as(ALICE, |s| s.get_messages(0));
        assert_eq!(msgs.len(), super::MAX_MESSAGES);
        assert_eq!(msgs.first().unwrap().seq, over + 1);
    }

    #[test]
    fn mailbox_prunes_to_cap_dropping_lowest_seqs() {
        let mut app = new_room();
        app.call_as(ALICE, |s| s.join("Alice".to_owned(), 1000)).unwrap();
        let over = 8;
        for i in 0..(MAX_SIGNALS as u64 + over) {
            app.call_as(ALICE, |s| {
                s.post_signal(id_of(BOB), "ice".to_owned(), format!("c{i}"), "c1".to_owned(), 1000 + i)
            })
            .unwrap();
        }
        let sigs = app.call_as(BOB, |s| s.get_signals(0));
        assert_eq!(sigs.len(), MAX_SIGNALS);
        // Seqs are 1..=cap+over; the `over` lowest were pruned.
        assert_eq!(sigs.first().unwrap().seq, over + 1);
    }
}
