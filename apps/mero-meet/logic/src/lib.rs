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
/// The frontend heartbeats every ~10s; 30s tolerates a couple of missed beats.
const PRESENCE_TTL_SECS: u64 = 30;

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
    /// Signaling mailbox. Keyed by signal id ("sig-{seq}"); pruned to MAX_SIGNALS.
    signals: UnorderedMap<SignalId, Signal>,
    /// Identities currently in the active call (the media session roster).
    call_participants: UnorderedSet<MemberId>,
    /// Monotonic signal sequence counter.
    next_seq: LwwRegister<u64>,
    /// Id of the currently-active call ("" = no call in progress).
    active_call: LwwRegister<String>,
    /// Role registry: the creator is the sole initial admin (host).
    roles: AccessControl,
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

    // ── Room ─────────────────────────────────────────────────────────────────

    pub fn get_room(&self, now: u64) -> RoomInfo {
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
        drop(existing);

        let presence = Presence {
            member_id: id.clone(),
            username,
            status: "available".to_string(),
            muted,
            video_on,
            call_id,
            joined_at,
            updated_at: now,
        };
        self.presence.insert(id.clone(), presence.clone())?;
        app::emit!(Event::PresenceChanged(id));
        Ok(presence)
    }

    /// Cheap liveness ping. **Silent CRDT write** — gossips to other nodes so
    /// they see me as online, but emits NO event (avoids SSE churn). This is
    /// mero-chat's heartbeat pattern.
    pub fn heartbeat(&mut self, now: u64) -> app::Result<()> {
        let id = Self::caller_id();
        if let Ok(Some(mut p)) = self.presence.get_mut(&id) {
            p.updated_at = now;
            drop(p);
        }
        Ok(())
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
            p.updated_at = now;
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
        if let Ok(Some(mut p)) = self.presence.get_mut(&id) {
            p.status = "away".to_string();
            p.call_id = None;
            p.updated_at = now;
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
        let members: Vec<Presence> = self
            .presence
            .entries()
            .map(|e| e.map(|(_, p)| p).collect())
            .unwrap_or_default();
        let online = members
            .iter()
            .filter(|p| now.saturating_sub(p.updated_at) <= PRESENCE_TTL_SECS)
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
        let mut call_id = self.active_call.get().clone();
        if call_id.is_empty() {
            // Deterministic id (no WASM randomness): starter prefix + clock.
            let prefix = &id[..id.len().min(8)];
            call_id = format!("call-{}-{}", prefix, now);
            self.active_call.set(call_id.clone());
            app::emit!(Event::CallStarted(call_id.clone()));
        }
        self.call_participants.insert(id.clone())?;
        if let Ok(Some(mut p)) = self.presence.get_mut(&id) {
            p.status = "in_call".to_string();
            p.call_id = Some(call_id.clone());
            p.updated_at = now;
            drop(p);
        }
        app::emit!(Event::PresenceChanged(id));
        Ok(call_id)
    }

    /// Leave the call but stay in the lobby.
    pub fn leave_call(&mut self, now: u64) -> app::Result<()> {
        let id = Self::caller_id();
        let _ = self.call_participants.remove(&id);
        if let Ok(Some(mut p)) = self.presence.get_mut(&id) {
            p.status = "available".to_string();
            p.call_id = None;
            p.updated_at = now;
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
        // SDP/ICE blobs are small; this is a sanity cap, not a real limit.
        if payload.len() > 64 * 1024 {
            app::bail!("signal payload too large");
        }
        let seq = self.next_seq.get().saturating_add(1);
        self.next_seq.set(seq);
        let sig_id = format!("sig-{}", seq);
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
    /// Keys are "sig-{seq}", so we reconstruct them — no side index needed.
    fn prune_signals(&mut self) {
        let len = self.signals.len().unwrap_or(0);
        if len <= MAX_SIGNALS {
            return;
        }
        let mut seqs: Vec<u64> = self
            .signals
            .entries()
            .map(|e| e.map(|(_, s)| s.seq).collect())
            .unwrap_or_default();
        seqs.sort_unstable();
        let to_drop = len - MAX_SIGNALS;
        for seq in seqs.into_iter().take(to_drop) {
            let _ = self.signals.remove(&format!("sig-{}", seq));
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
