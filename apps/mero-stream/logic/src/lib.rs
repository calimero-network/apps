//! Mero Stream — streaming media *over Calimero* (Task 3, approach 3).
//!
//! ## What this contract is (and is NOT)
//!
//! This is a **capacity probe**, deliberately doing the *wrong* thing to learn
//! the node's ceiling with numbers. Unlike Mero Meet — where media rides native
//! WebRTC peer-to-peer and never touches the contract — this contract runs a
//! toy **codec inside the WASM logic itself** and pushes compressed media
//! fragments through the replicated CRDT/DAG/gossip pipeline.
//!
//! The distinguishing move (approach 3): the frontend hands the contract a
//! *raw* luma frame; `encode_frame` compresses it **in WASM** on the sender and
//! stores only the compressed fragment. The raw frame is a mutation *argument*,
//! so it stays local to the executing node — only the resulting **state delta**
//! (the compressed fragment) is sealed and gossiped. A `get_frame` view
//! reconstructs the frame in WASM on any node. "Encode AND decode straight from
//! the WASM logic."
//!
//! Shipping media over Calimero is explicitly a **non-goal** — the deliverable
//! is a stated ceiling with the first bottleneck named. See
//! `ROADMAP-TASKS/task-3-streaming-over-calimero.md`.
//!
//! ## Hard constraints baked into this design
//!
//! - **C1 Determinism.** State deltas replicate and a `view` decode must return
//!   the same bytes on every node. The codec is therefore **integer-only** — no
//!   float, no SIMD, no threads, no randomness, no wall clock (the contract
//!   takes `now: u64` as an arg for exactly this reason). No real codec.
//! - **C2 Small deltas.** Every stored fragment is a replicated delta and must
//!   stay well under the 1 MiB gossip/delta cap; we target the 4–32 KiB band and
//!   **sub-frame chunk** anything larger (see `MAX_CHUNK_BYTES`).
//! - **C3 Delete is a tombstone.** A CRDT remove leaves a tombstone that
//!   permanently shadows any later insert under the same key. So fragment keys
//!   are **globally monotone and never reused** (`frag-{seq}-{chunk}`, `seq`
//!   strictly increasing), and pruning the live window emits *more* tombstones —
//!   tombstone growth is a primary metric, not a footnote.
//! - **C4 Toy codec.** Codec #1: downscale is done in the browser canvas; the
//!   contract quantizes luma to 4-bit and RLE-encodes. Trivially deterministic;
//!   ratio tunable by geometry + (implicit) quant step.

use std::cmp::Ordering;
use std::str::FromStr;

use base64::engine::general_purpose::STANDARD as BASE64;
use base64::Engine as _;
use calimero_sdk::abi::AbiType;
use calimero_sdk::borsh::{BorshDeserialize, BorshSerialize};
use calimero_sdk::serde::{Deserialize, Serialize};
use calimero_sdk::{app, env as sdk_env, AccountId, PublicKey};
use calimero_storage::collections::crdt_meta::MergeError;
use calimero_storage::collections::{
    AccessControl, Authored, Frozen, LwwRegister, Mergeable as MergeableTrait, Moderated, Ownable,
    SortedMap, UnorderedMap,
};

// ── Types ───────────────────────────────────────────────────────────────────

// A member id is the executor's public key, hex-encoded — i.e. a plain `String`,
// which is why it is spelled out at every use site rather than aliased.
//
// There used to be an alias here. It cannot come back as-is: rc.19's ABI emitter
// resolves a NEWTYPE struct into an ABI alias, but it has no `visit_item_type`, so
// a plain `type Foo = String;` is never registered as a local type and the whole
// ABI emit fails with "type path error: unknown type: Foo" for every field that
// mentions it. A newtype WOULD satisfy the emitter, but it changes the borsh shape
// and therefore the on-disk state layout — not a trade worth making to recover a
// name. Revisit if core teaches the emitter to follow type aliases.

/// Codec id stored on each fragment (C4 ladder). 1 = quantize-4bit + RLE.
const CODEC_QUANT_RLE: u8 = 1;

/// Track id for a video luma stream. Audio (raw PCM → integer companding) would
/// be track 1, added later. `pub` — part of the contract's documented wire vocab.
pub const TRACK_VIDEO_LUMA: u8 = 0;

/// C2: hard ceiling on a single stored fragment's `data`. Each fragment is a
/// replicated delta; keeping it in the 4–32 KiB band keeps us far under the
/// 1 MiB gossip/delta cap. A frame whose encoded stream exceeds this is split
/// into multiple fragments (chunks) before storage.
const MAX_CHUNK_BYTES: usize = 16 * 1024;

/// C2: reject a raw frame larger than this many luma bytes (256×256). The codec
/// is a probe for *small* fragments; oversized input is a caller bug.
const MAX_RAW_BYTES: usize = 256 * 256;

/// Max frame dimension. Geometry is a primary knob for the load curve; this cap
/// keeps a single frame's decode bounded and its fragments small.
const MAX_DIM: u16 = 256;

/// C3: how many of the most-recent *frames* to keep live. Everything older than
/// `latest_base_seq - FRAME_WINDOW` is pruned — which emits a tombstone per
/// removed fragment. Small live window (good) traded for monotone tombstone
/// growth (the thing most likely to kill a sustained run).
const FRAME_WINDOW: u64 = 30;

/// Approach 2: how long a sender's chunks stay live, in milliseconds.
///
/// This used to be a count (`CHUNK_WINDOW = 120` entries) shared across every
/// sender, and that is what broke the first cross-network call (see
/// `retro/review.md`). A count-based window shrinks in *wall-clock* terms as
/// senders are added — 120 entries is ~4.8 s with one sender at 25 fps but only
/// ~2.4 s with two — so the more peers in the call, the less latency the window
/// can absorb. Over a relayed path where sync latency ran to seconds, a remote
/// peer's chunks arrived already below the local prune floor and were reaped on
/// arrival: the stream looked alive to the sender and was invisible to everyone
/// else.
///
/// Time is the honest unit. The window must exceed worst-case sync latency, and
/// it must not depend on how many people are in the call. 6 s is ~3x the
/// keyframe interval, so a joiner always has a decodable entry point, and it is
/// comfortably longer than the multi-second relay delays observed in the retro.
const LIVE_WINDOW_MS: u64 = 6_000;

/// Hard ceiling on live chunks per sender, independent of `LIVE_WINDOW_MS`.
///
/// The time window is driven by a client-supplied `now`, so a client with a
/// broken or hostile clock could otherwise pin state forever. 600 is ~24 s at
/// 25 fps — far above the time window in any healthy run, so this only ever
/// bites when the clock is wrong.
const MAX_LIVE_CHUNKS_PER_SENDER: u64 = 600;

/// Reap a sender's entire buffer once they have posted nothing for this long.
///
/// A sender only prunes its OWN chunks on the hot path (that is what removes the
/// cross-sender insert-vs-tombstone race). The cost of that isolation is that a
/// peer who closes the tab leaves their last window pinned forever, so somebody
/// else has to collect it. This is deliberately much larger than
/// `LIVE_WINDOW_MS`: by the time it fires, the departed sender has not written
/// for half a minute, so a cross-sender delete cannot realistically race a live
/// insert.
const STALE_SENDER_MS: u64 = 30_000;

/// Cap on how many chunks a single `post_chunk` may reap, so one call can never
/// walk an unbounded range. Anything left over is collected by the next call.
const MAX_PRUNE_PER_CALL: u64 = 256;

/// Approach 2: per-chunk ceiling for opaque codec output.
///
/// Deliberately much larger than `MAX_CHUNK_BYTES`. That 16 KiB figure is
/// approach 3's *design point* — the 4-32 KiB band the task doc picked to study
/// small fragments. Approach 2 does not get to choose: a chunk is whatever the
/// hardware encoder emitted, and a 480p keyframe is legitimately 30-60 KB even at
/// a modest bitrate. Capping those at 16 KiB would force sub-frame splitting and
/// reassembly-before-decode in the browser for no benefit.
///
/// 256 KiB keeps a single chunk ~4x under the 1 MiB gossip/delta cap, so one
/// chunk is still always one deliverable delta.
const MAX_MEDIA_CHUNK_BYTES: usize = 256 * 1024;

// ── Fragment (the only thing that gossips) ─────────────────────────────────────

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

/// One compressed media fragment produced by the in-WASM encoder. A frame with
/// an encoded stream over `MAX_CHUNK_BYTES` is split across several `Fragment`s
/// sharing one `seq` (the frame's base seq), distinguished by `chunk`.
///
/// `data` is the ONLY field that meaningfully crosses the wire — the raw input
/// never leaves the sender (C1/approach-3 property).
#[app::mergeable(id = "mero_stream::Fragment")]
#[derive(AbiType, BorshSerialize, BorshDeserialize, Serialize, Deserialize, Clone, Debug)]
#[borsh(crate = "calimero_sdk::borsh")]
#[serde(crate = "calimero_sdk::serde")]
#[serde(rename_all = "camelCase")]
pub struct Fragment {
    /// Global monotone frame sequence; key `frag-{from}-{seq}-{chunk}`, NEVER
    /// reused (C3).
    pub seq: u64,
    pub from: String,
    /// 0 = video luma, 1 = audio (future).
    pub track: u8,
    /// Sub-frame chunk index within this frame (C2).
    pub chunk: u16,
    /// Total chunks for this frame.
    pub chunks: u16,
    /// Decode geometry.
    pub width: u16,
    pub height: u16,
    /// Which toy codec produced `data` (C4 ladder).
    pub codec: u8,
    /// Compressed bytes for this chunk — the only thing that gossips.
    pub data: Vec<u8>,
    /// Sender-supplied capture timestamp, unix **MILLISECONDS**.
    ///
    /// Deliberately a different unit from `Member::joined_at`/`updated_at`
    /// (which are unix *seconds*). §4's headline metric is end-to-end fragment
    /// latency — capture → apply on a peer → render — and the whole point of the
    /// probe is that this lands in the hundreds-of-ms-to-seconds range. At
    /// second resolution the measurement quantizes to 0 s or 1 s and tells us
    /// nothing, so fragments carry millis.
    ///
    /// The contract never interprets this value (pruning is by `seq`, not time);
    /// it is opaque payload, so the unit is purely a producer/consumer contract
    /// between `encodeFrame` in the frontend and the latency sampler. It IS used
    /// for defensive newer-wins in `merge`, which only needs monotonicity.
    ///
    /// Cross-machine caveat: this is the SENDER's clock, so a latency computed
    /// against the receiver's clock includes any skew between them (mero-meet
    /// hit exactly this and had to normalize on a room clock). Trustworthy on
    /// the solo two-node harness, where both nodes share one host clock.
    pub created_at: u64,
}

impl MergeableTrait for Fragment {
    fn merge(&mut self, other: &Self) -> Result<(), MergeError> {
        // Fragments are immutable once posted and keyed by a globally unique
        // (seq, chunk); a merge of "the same" fragment is a no-op. Newer wins
        // defensively.
        if lww_take(self.created_at, other.created_at, self, other) {
            *self = other.clone();
        }
        Ok(())
    }
}

// ── Approach 2: an opaque chunk from a real browser codec ──────────────────────

/// One encoded chunk produced by **WebCodecs in the browser**, stored verbatim.
///
/// The whole point: this app cannot decode `data` and never tries. It is an
/// H.264/VP8 access unit (or a fragment of one) that only a real decoder
/// understands. We are a replicated ring buffer with metadata, nothing more.
///
/// Consequences of not interpreting it:
/// - **No determinism constraint.** Nodes store an identical blob without any
///   node computing it, so a float-heavy hardware codec is fine here.
/// - **We cannot validate it.** A member can store arbitrary bytes and the peer's
///   decoder is what rejects them. Membership is the only gate; that is the same
///   trust model as `post_signal` in mero-meet.
/// - **`is_keyframe` is sender-asserted.** We cannot verify it by parsing, and
///   pruning depends on it (see `last_keyframe_seq`). A member lying about it
///   degrades their own stream's recoverability, which is why it is acceptable —
///   but it is asserted, not proven.
#[app::mergeable(id = "mero_stream::MediaChunk")]
#[derive(AbiType, BorshSerialize, BorshDeserialize, Serialize, Deserialize, Clone, Debug)]
#[borsh(crate = "calimero_sdk::borsh")]
#[serde(crate = "calimero_sdk::serde")]
#[serde(rename_all = "camelCase")]
pub struct MediaChunk {
    /// Per-sender monotone sequence; key `chunk-{from}-{seq}`, NEVER reused (C3).
    pub seq: u64,
    pub from: String,
    /// 0 = video, 1 = audio. Both ride the same ring, interleaved by seq.
    pub track: u8,
    /// Sender-asserted: this chunk is independently decodable.
    pub is_keyframe: bool,
    /// Codec string the browser used, e.g. "avc1.42001f" or "opus". The peer
    /// feeds this straight back into its decoder config, so it must round-trip
    /// verbatim — a decoder configured differently from the encoder produces
    /// garbage or throws.
    pub codec: String,
    /// Decode geometry (video only; 0 for audio).
    pub width: u16,
    pub height: u16,
    /// Presentation timestamp in microseconds, as WebCodecs reports it. Distinct
    /// from `created_at`: this is the media clock the decoder needs, not a
    /// wall clock for latency arithmetic.
    pub timestamp_us: u64,
    /// The encoded bytes. Opaque.
    pub data: Vec<u8>,
    /// Sender's wall clock in unix MILLISECONDS (same convention as
    /// `Fragment::created_at` — §4 latency needs sub-second resolution).
    pub created_at: u64,
}

impl MergeableTrait for MediaChunk {
    fn merge(&mut self, other: &Self) -> Result<(), MergeError> {
        // Immutable once posted and keyed by a globally unique seq, so a merge of
        // "the same" chunk is a no-op. Newer wins defensively.
        if lww_take(self.created_at, other.created_at, self, other) {
            *self = other.clone();
        }
        Ok(())
    }
}

/// Per-sender chunk bookkeeping — one row per sender, in `chunk_cursors`.
///
/// **Every field is monotone and merges by `max`.** That is the whole point of
/// this type. The previous design held these as four *global* `LwwRegister`s
/// shared by every sender, which meant two peers posting concurrently
/// read-modify-wrote the same counter, minted the same `seq`, and then wrote the
/// same `chunk-{seq}` key — last-writer-wins silently destroyed one sender's
/// video. Splitting per sender means a row is written only by the sender it
/// belongs to on the hot path, and `max`-merge is commutative, associative and
/// idempotent, so it converges regardless of delivery order. There is no
/// last-writer to lose to.
#[derive(
    AbiType, BorshSerialize, BorshDeserialize, Serialize, Deserialize, Clone, Debug, Default,
)]
#[app::mergeable(id = "mero_stream::ChunkCursor")]
#[borsh(crate = "calimero_sdk::borsh")]
#[serde(crate = "calimero_sdk::serde")]
#[serde(rename_all = "camelCase")]
pub struct ChunkCursor {
    /// Highest seq this sender has minted. Never reused (C3).
    pub next_seq: u64,
    /// Lowest seq of theirs still live; everything below was pruned.
    pub oldest_live: u64,
    /// Seq of this sender's newest keyframe. Per-sender because each sender is
    /// an independent H.264 bitstream — a delta is only decodable against a
    /// keyframe from the SAME sender, so a global pointer let the reaper drop
    /// one sender's only keyframe while protecting another's.
    pub last_keyframe: u64,
    /// `created_at` of their newest chunk — drives the stale-sender sweep.
    pub newest_at: u64,
    /// How many of their chunks have been reaped (tombstone pressure, C3).
    pub pruned: u64,
    /// How many of their approach-3 FRAMES they have pruned. Per sender for the
    /// same reason as the rest: a shared counter lost concurrent increments and
    /// was anyone's to rewrite.
    pub frames_pruned: u64,
}

impl MergeableTrait for ChunkCursor {
    fn merge(&mut self, other: &Self) -> Result<(), MergeError> {
        // Monotone max on every field: order-independent by construction.
        self.next_seq = self.next_seq.max(other.next_seq);
        self.oldest_live = self.oldest_live.max(other.oldest_live);
        self.last_keyframe = self.last_keyframe.max(other.last_keyframe);
        self.newest_at = self.newest_at.max(other.newest_at);
        self.pruned = self.pruned.max(other.pruned);
        self.frames_pruned = self.frames_pruned.max(other.frames_pruned);
        Ok(())
    }
}

/// One sender's read cursor, both as input to `get_chunks` and as output from
/// `keyframe_cursors`.
///
/// Seq spaces are per sender now, so a single global "after_seq" is meaningless:
/// seq 40 from Alice and seq 40 from Bob are unrelated positions in unrelated
/// bitstreams.
#[derive(AbiType, Serialize, Deserialize, Clone, Debug, PartialEq, Eq)]
#[serde(crate = "calimero_sdk::serde")]
#[serde(rename_all = "camelCase")]
pub struct SenderCursor {
    pub from: String,
    pub after_seq: u64,
}

/// Per-sender slice of `get_live_stats`.
#[derive(AbiType, Serialize, Deserialize, Clone, Debug)]
#[serde(crate = "calimero_sdk::serde")]
#[serde(rename_all = "camelCase")]
pub struct SenderStats {
    pub from: String,
    pub next_seq: u64,
    pub oldest_live: u64,
    pub last_keyframe: u64,
    pub newest_at: u64,
    pub pruned: u64,
    pub live_chunks: u32,
    pub live_bytes: u64,
}

/// Read model for the receive side: what a peer needs to drive its decoder.
#[derive(AbiType, Serialize, Deserialize, Clone, Debug)]
#[serde(crate = "calimero_sdk::serde")]
#[serde(rename_all = "camelCase")]
pub struct ChunkView {
    pub seq: u64,
    pub from: String,
    pub track: u8,
    pub is_keyframe: bool,
    pub codec: String,
    pub width: u16,
    pub height: u16,
    pub timestamp_us: u64,
    /// Base64 — the RPC layer is JSON, and a raw `Vec<u8>` serializes as a JSON
    /// array of numbers (~3 bytes of text per byte of payload). Base64 is ~1.37x
    /// instead, so a 22 KB keyframe travels as ~30 KB of JSON rather than ~80 KB.
    pub data_b64: String,
    pub created_at: u64,
}

/// Approach-2 instrumentation snapshot.
#[derive(AbiType, Serialize, Deserialize, Clone, Debug)]
#[serde(crate = "calimero_sdk::serde")]
#[serde(rename_all = "camelCase")]
pub struct LiveStats {
    pub live_chunks: u32,
    /// Summed `data` bytes currently live — the real "how much state is this
    /// stream holding" figure.
    pub live_bytes: u64,
    /// Total chunks reaped across every sender.
    pub pruned_chunks: u64,
    /// Per-sender breakdown. The flat `nextChunkSeq` / `oldestLiveChunk` /
    /// `lastKeyframeSeq` fields this replaced were only meaningful while a
    /// single global seq space existed; with per-sender spaces a single number
    /// would be a lie.
    pub senders: Vec<SenderStats>,
}

// ── Membership (lightweight — just enough to reject non-members) ────────────────

/// A member of the stream context. Membership gates `encode_frame` (the probe
/// still requires an authenticated context member — never trust a client id).
#[app::mergeable(id = "mero_stream::Member")]
#[derive(AbiType, BorshSerialize, BorshDeserialize, Serialize, Deserialize, Clone, Debug)]
#[borsh(crate = "calimero_sdk::borsh")]
#[serde(crate = "calimero_sdk::serde")]
#[serde(rename_all = "camelCase")]
pub struct Member {
    pub member_id: String,
    pub username: String,
    pub joined_at: u64,
    pub updated_at: u64,
}

impl MergeableTrait for Member {
    fn merge(&mut self, other: &Self) -> Result<(), MergeError> {
        if lww_take(self.updated_at, other.updated_at, self, other) {
            *self = other.clone();
        }
        Ok(())
    }
}

// ── Views (read-model returned to the frontend) ────────────────────────────────

/// A frame reconstructed in-WASM by the decoder. `pixels` is raw luma
/// (1 byte/pixel, row-major, `width * height` long) — the frontend paints it to
/// a canvas. This is the second half of "decode straight from WASM logic".
#[derive(AbiType, Serialize, Deserialize, Clone, Debug)]
#[serde(crate = "calimero_sdk::serde")]
#[serde(rename_all = "camelCase")]
pub struct DecodedFrame {
    pub seq: u64,
    pub from: String,
    pub track: u8,
    pub width: u16,
    pub height: u16,
    /// Raw luma, `width * height` bytes.
    pub pixels: Vec<u8>,
    /// Capture timestamp in unix **milliseconds** (see `Fragment::created_at`) —
    /// the receive side subtracts it from its own clock to get §4 latency.
    pub created_at: u64,
    /// Sum of the stored (compressed) chunk bytes for this frame — lets the
    /// frontend log compression ratio without a second call.
    pub encoded_bytes: u32,
}

/// Instrumentation snapshot (§4 metrics — the deliverable). Cheap counters a
/// load generator / e2e can poll to chart the failure curve.
#[derive(AbiType, Serialize, Deserialize, Clone, Debug)]
#[serde(crate = "calimero_sdk::serde")]
#[serde(rename_all = "camelCase")]
pub struct StreamStats {
    pub name: String,
    pub member_count: u32,
    /// Fragments (chunks) currently live in state.
    pub live_fragments: u32,
    /// Highest frame seq ever allocated (monotone; also == total frames sent).
    pub next_seq: u64,
    /// Lowest frame seq still live (frames below this were pruned → tombstones).
    pub oldest_live_seq: u64,
    /// How many frames have been pruned (each pruned fragment is a tombstone, C3).
    pub pruned_frames: u64,
}

// ── Events (pushed to subscribed frontends over SSE) ───────────────────────────

#[app::event]
pub enum Event {
    Initialized(),
    /// A member joined the stream context.
    MemberJoined(String),
    /// A frame's fragments were stored. Payload is the frame's base seq; a peer
    /// calls `get_frame(after_seq)` to drain and render.
    FramePosted(u64),
    /// Frames below this seq were pruned (tombstones emitted, C3).
    FramesPruned(u64),
    /// Approach 2: an opaque WebCodecs chunk was stored. Payload is its seq; a
    /// peer calls `get_chunks(after_seq)` to drain and feed its decoder.
    ChunkPosted(u64),
}

// ── State ───────────────────────────────────────────────────────────────────

#[app::state(emits = Event)]
pub struct MeroStream {
    /// Stream/room name; `Ownable` so only the owner's rename converges.
    ///
    /// Empty until the first rename — see [`Self::initial_name`] for why, and
    /// read through [`Self::stream_name_str`] rather than touching either
    /// directly.
    stream_name: Ownable<LwwRegister<String>>,
    /// The name `init` was called with.
    ///
    /// **`Ownable::insert` cannot be used inside `init` on core rc.20.** The cell
    /// is still detached from the state tree at that point: the writer set is
    /// carried through by the constructor, but the inserted VALUE is silently
    /// dropped — `insert` returns `Ok`, and a later read returns `Ok("")`.
    ///
    /// So the init name lives here, and `stream_name` takes over from the first
    /// owner rename onwards. `Frozen`, because it is the name everyone sees until
    /// that rename: as a plain register any member's patched node could rewrite
    /// it, walking straight around the `Ownable` gate.
    initial_name: Frozen<String>,
    /// Context members, keyed by DEVICE. `Authored`: the account that joins
    /// with a device owns its row, and that owner stamp is the account the
    /// device speaks for — the verified device→account pairing every node
    /// enforces, which a field or a side table could not be.
    ///
    /// Keys are per owner (core rc.57), so a second account can file a row of
    /// its own under someone else's device. A device held by exactly one
    /// account speaks for it; one claimed by several speaks for nobody (see
    /// `account_of`), so a claimant never gets to post as someone else.
    members: Authored<UnorderedMap<String, Member>>,
    /// The approach-3 buffer. Keyed `frag-{from}-{seq:020}-{chunk:05}`; owned by
    /// the sender, so only they can overwrite or prune it, and `from` in the key
    /// keeps two senders that mint one `seq` apart.
    fragments: Authored<SortedMap<String, Fragment>>,
    /// Global monotone frame sequence. LwwRegister: two senders may mint the
    /// same base seq concurrently — that is fine here because fragment keys
    /// embed the sender and each frame stands alone (no cross-frame diff in
    /// codec #1).
    ///
    /// ⚠️ Still shared, so a member's patched node can jump it (to `u64::MAX`,
    /// say) and stall approach 3 for everyone. A shared counter cannot be
    /// protected against its members' own contributions; the fix is per-sender
    /// seq spaces with per-sender read cursors, which approach 2 has and this
    /// deliberately-wrong probe path does not.
    next_seq: LwwRegister<u64>,
    /// Role registry: the creator is the sole initial admin.
    roles: AccessControl,

    // ── Approach 2: opaque chunks encoded by a REAL codec in the browser ──────
    //
    // Everything above is approach 3 (toy codec runs in WASM). These fields are
    // the parallel approach-2 path and are deliberately separate state, so the
    // measured approach-3 baseline keeps working untouched.
    //
    // The difference that matters: this app never looks inside `data`. The
    // browser encodes with WebCodecs (hardware H.264/VP8) and hands us bytes we
    // only store and replicate. Because we never interpret them, the C1
    // determinism constraint does not apply — every node stores the identical
    // blob without any node having to *compute* it. That is precisely what makes
    // a real codec (and therefore a realistic resolution) legal here and illegal
    // in approach 3.
    /// Opaque encoded chunks, keyed `chunk-{from}-{seq:020}`.
    ///
    /// `from` is in the key on purpose. Without it, two senders that minted the
    /// same seq collided on one key and last-writer-wins destroyed one of them —
    /// the defect behind the one-directional video in `retro/review.md`. The seq
    /// is zero-padded so key order is seq order and a sender's window is one
    /// range read.
    ///
    /// `Moderated`: a chunk is owned by its sender's account, so nobody else can
    /// overwrite or delete it, and the moderators (the creator) may reap a
    /// departed sender's buffer. Readers still check each chunk's owner against
    /// the sender's member row, because anyone can INSERT a new key under
    /// someone else's `from`.
    chunks: Moderated<SortedMap<String, MediaChunk>>,
    /// Per-sender sequence / keyframe / pruning state, keyed by device and owned
    /// by its sender. See [`ChunkCursor`] for why this is per sender and merges
    /// by `max`; `Authored` is what stops another member from pushing someone
    /// else's `max` to `u64::MAX` and freezing their stream for good.
    chunk_cursors: Authored<UnorderedMap<String, ChunkCursor>>,
}

// ── Logic ─────────────────────────────────────────────────────────────────────

#[app::logic]
impl MeroStream {
    #[app::init]
    pub fn init(name: String) -> MeroStream {
        // Ownership and the admin tier are ACCOUNT-scoped since rc.20; member ids
        // stay device-scoped (see the `members` field).
        let me = Self::caller_account();
        // Deliberately NOT `stream_name.insert(name)` — see `initial_name`. The
        // value would be silently dropped here and the stream would come up
        // nameless.
        let stream_name = Ownable::new_owned_by(me);
        MeroStream {
            stream_name,
            initial_name: Frozen::new(name),
            members: Authored::new(),
            fragments: Authored::new(),
            next_seq: LwwRegister::new(0),
            roles: AccessControl::new(me),
            // The creator is the first moderator: the one account allowed to
            // reap a departed sender's chunks.
            chunks: Moderated::new(),
            chunk_cursors: Authored::new(),
        }
    }

    // ── Identity helpers ───────────────────────────────────────────────────────

    /// The real signer of this invocation. Never trust a client-supplied id.
    ///
    /// A member id here is a DEVICE key, and stays one. A stream is per-writer
    /// state — one person broadcasting from a laptop and watching on a phone is
    /// genuinely two peers — and it is what the frontend reads back from
    /// `identities-owned`. Authorization is the opposite case and gates on
    /// [`Self::caller_account`]; the `members` row's owner stamp records the
    /// device→account pairing, so two devices of one person share permissions.
    ///
    /// Do NOT reach for `env::executor_id()` to get this. rc.20 split identity
    /// into account + device (core #3320) and left that shim meaning the
    /// device; rc.23 flips it to the ACCOUNT (core #3510), so it now means the
    /// opposite of what this function returns.
    fn caller() -> PublicKey {
        sdk_env::device_id().into()
    }

    /// The account this call is authorized as — what `AccessControl`,
    /// `Ownable` and every owner stamp gate on. Two devices belonging to one
    /// person report the same account.
    fn caller_account() -> AccountId {
        AccountId::from(sdk_env::account_id())
    }

    /// The account a member's device speaks for: the owner stamp on its member
    /// row, which every node verified when it applied the join.
    ///
    /// Keys are per owner, so a key-only `owner_of` names only the CALLER. The
    /// row is read across owners: exactly one account holding it is the
    /// device's account, and a device claimed by several has none.
    fn account_of(&self, member: &str) -> Option<AccountId> {
        match self.members.entries_at(&member.to_owned()).ok()?.as_slice() {
            [(owner, _)] => Some(*owner),
            _ => None,
        }
    }

    /// `from`'s account's OWN entry at every distinct key of `rows` (a range
    /// read, which lists a key once per account holding it). Anyone can insert
    /// a key under someone else's `from`; that entry is theirs and never read.
    fn senders_own<V>(
        map: &Moderated<SortedMap<String, V>>,
        account: &AccountId,
        rows: impl Iterator<Item = (String, V)>,
    ) -> Vec<V>
    where
        V: BorshSerialize + BorshDeserialize + 'static,
    {
        let mut out = Vec::new();
        let mut last: Option<String> = None;
        for (key, _) in rows {
            if last.as_ref() == Some(&key) {
                continue;
            }
            if let Ok(Some(value)) = map.get_by(account, &key) {
                out.push(value);
            }
            last = Some(key);
        }
        out
    }

    /// Whether `owner` is the account that owns `from`'s member row. Anyone
    /// can insert a key under someone else's `from`, so every read of another
    /// sender's media checks this.
    fn written_by(&self, owner: &AccountId, from: &str) -> bool {
        self.account_of(from).as_ref() == Some(owner)
    }

    fn caller_id() -> String {
        String::from(Self::caller())
    }

    fn parse_pk(value: &str) -> app::Result<PublicKey> {
        PublicKey::from_str(value).map_err(|_| app::err!("invalid member public key"))
    }

    /// The stream's display name.
    ///
    /// The owner-gated cell wins once it holds anything; before the first rename
    /// it is empty and the name `init` was given is the answer. See
    /// [`Self::initial_name`].
    fn stream_name_str(&self) -> String {
        let renamed = self
            .stream_name
            .get()
            .map(|r| r.get().clone())
            .unwrap_or_default();
        if renamed.is_empty() {
            self.initial_name.get().cloned().unwrap_or_default()
        } else {
            renamed
        }
    }

    fn require_member(&self) -> app::Result<String> {
        let id = Self::caller_id();
        if !self.members.owned_by_me(&id)? {
            app::bail!("join the stream before this operation");
        }
        Ok(id)
    }

    /// The caller's own cursor row, created on first use. A row under this
    /// device that another account created is refused rather than written
    /// through — nobody but its owner can change it anyway.
    fn own_cursor(&mut self, from: &str) -> app::Result<ChunkCursor> {
        let key = from.to_owned();
        // Keys are per owner: `get` reads the caller's own row, and another
        // account's row under this device is a different entry.
        match self.chunk_cursors.get(&key)? {
            Some(cursor) => Ok(cursor),
            None => {
                self.chunk_cursors.insert(key, ChunkCursor::default())?;
                Ok(ChunkCursor::default())
            }
        }
    }

    // ── Membership ───────────────────────────────────────────────────────────

    /// Join the stream context. Idempotent (re-join updates the display name).
    pub fn join(&mut self, username: String, now: u64) -> app::Result<Member> {
        let id = Self::caller_id();
        // Keys are per owner, so a second account could file a row of its own
        // under this device; `account_of` would then read the device as
        // nobody's. Refuse it here rather than write it.
        if self
            .members
            .entries_at(&id)?
            .iter()
            .any(|(owner, _)| *owner != Self::caller_account())
        {
            app::bail!("this device is registered to another account");
        }
        let member = match self.members.get(&id)? {
            Some(existing) => {
                // `joined_at` is immutable after first join.
                let member = Member {
                    member_id: id.clone(),
                    username,
                    joined_at: existing.joined_at,
                    updated_at: now,
                };
                self.members.update(&id, member.clone())?;
                member
            }
            None => {
                let member = Member {
                    member_id: id.clone(),
                    username,
                    joined_at: now,
                    updated_at: now,
                };
                self.members.insert(id.clone(), member.clone())?;
                member
            }
        };
        app::emit!(Event::MemberJoined(id));
        Ok(member)
    }

    pub fn get_members(&self) -> Vec<Member> {
        self.members
            .entries()
            .map(|e| e.map(|(_, m)| m).collect())
            .unwrap_or_default()
    }

    // ── Encode (the Task-3 core: codec runs IN WASM) ────────────────────────────

    /// Encode one raw luma frame **inside the WASM runtime**, split it into
    /// `≤ MAX_CHUNK_BYTES` fragments, store them under monotone never-reused
    /// keys, prune the caller's live window, and emit `FramePosted(base_seq)`.
    ///
    /// `raw` is `width * height` luma bytes (1 byte/pixel). It is a mutation
    /// argument, so it is local to THIS node — only the compressed fragments
    /// enter the replicated delta. Returns the frame's base seq.
    ///
    /// Guards: caller must be a member; `raw` must match the geometry and stay
    /// within `MAX_RAW_BYTES`; dimensions within `MAX_DIM`.
    /// `now` is the capture time in unix **milliseconds** — not seconds, unlike
    /// every other `now` arg in this contract. See `Fragment::created_at`: §4's
    /// end-to-end latency metric is unmeasurable at second resolution.
    pub fn encode_frame(
        &mut self,
        raw: Vec<u8>,
        width: u16,
        height: u16,
        track: u8,
        now: u64,
    ) -> app::Result<u64> {
        let from = self.require_member()?;

        if width == 0 || height == 0 {
            app::bail!("frame has zero dimension");
        }
        if width > MAX_DIM || height > MAX_DIM {
            app::bail!("frame dimension exceeds MAX_DIM");
        }
        let expected = width as usize * height as usize;
        if expected > MAX_RAW_BYTES {
            app::bail!("raw frame exceeds MAX_RAW_BYTES");
        }
        if raw.len() != expected {
            app::bail!("raw length does not match width*height");
        }

        // ── Encode in WASM (integer-only, deterministic — C1) ──
        let encoded = codec::encode_quant_rle(&raw);

        // ── Allocate the frame's base seq (monotone; keys never reused — C3) ──
        let seq = self.next_seq.get().saturating_add(1);
        self.next_seq.set(seq);

        // ── Sub-frame chunk (C2) ──
        let chunks: Vec<&[u8]> = if encoded.is_empty() {
            vec![&encoded[..]]
        } else {
            encoded.chunks(MAX_CHUNK_BYTES).collect()
        };
        let n_chunks = chunks.len();
        if n_chunks > u16::MAX as usize {
            app::bail!("frame produced too many chunks");
        }

        for (i, ch) in chunks.into_iter().enumerate() {
            let frag = Fragment {
                seq,
                from: from.clone(),
                track,
                chunk: i as u16,
                chunks: n_chunks as u16,
                width,
                height,
                codec: CODEC_QUANT_RLE,
                data: ch.to_vec(),
                created_at: now,
            };
            self.fragments
                .insert(Self::frag_key(&from, seq, i as u16), frag)?;
        }

        // Keep only our own most recent `FRAME_WINDOW` frames.
        let threshold = seq.saturating_sub(FRAME_WINDOW);
        self.prune_own_frames(&from, threshold)?;
        app::emit!(Event::FramePosted(seq));
        Ok(seq)
    }

    /// Fragment storage key. Sender + monotone `seq` + `chunk` → globally unique
    /// and NEVER reused, so a re-send after a prune lands on a fresh key and
    /// converges (C3: a reused key would be permanently shadowed by the prune's
    /// tombstone). Zero-padded, so one sender's frames are one ordered range.
    fn frag_key(from: &str, seq: u64, chunk: u16) -> String {
        format!("frag-{from}-{seq:020}-{chunk:05}")
    }

    // ── Decode (view — reconstructs frames in WASM) ──────────────────────────────

    /// Reassemble + decode every frame with `seq > after_seq`, oldest first.
    /// Read-only (no delta). The frontend tracks the highest seq it has rendered
    /// and passes it back. Frames whose chunks are not all present yet are
    /// skipped (a partially-gossiped frame is not decodable), and so is any
    /// fragment its sender did not write.
    pub fn get_frame(&self, after_seq: u64) -> Vec<DecodedFrame> {
        // Collect live fragments above the cursor.
        // With owners: keys are per owner, so a key-only `owner_of` would name
        // only the caller.
        let mut frags: Vec<Fragment> = self
            .fragments
            .entries_with_owners()
            .map(|e| {
                e.into_iter()
                    .filter(|(owner, _, f)| f.seq > after_seq && self.written_by(owner, &f.from))
                    .map(|(_, _, f)| f)
                    .collect()
            })
            .unwrap_or_default();
        // Deterministic order: by seq, then sender, then chunk.
        frags.sort_by(|a, b| {
            a.seq
                .cmp(&b.seq)
                .then_with(|| a.from.cmp(&b.from))
                .then_with(|| a.chunk.cmp(&b.chunk))
        });

        let mut out: Vec<DecodedFrame> = Vec::new();
        let mut i = 0;
        while i < frags.len() {
            let seq = frags[i].seq;
            let from = frags[i].from.clone();
            // Slice of this (seq, from) frame's chunks.
            let start = i;
            while i < frags.len() && frags[i].seq == seq && frags[i].from == from {
                i += 1;
            }
            let group = &frags[start..i];
            let expected_chunks = group[0].chunks as usize;
            // Only decode a fully-present frame (all chunks arrived).
            if group.len() != expected_chunks {
                continue;
            }
            let mut encoded: Vec<u8> = Vec::new();
            for f in group {
                encoded.extend_from_slice(&f.data);
            }
            let encoded_bytes = encoded.len() as u32;
            let width = group[0].width;
            let height = group[0].height;
            let pixels = codec::decode_quant_rle(&encoded, width as usize * height as usize);
            out.push(DecodedFrame {
                seq,
                from,
                track: group[0].track,
                width,
                height,
                pixels,
                created_at: group[0].created_at,
                encoded_bytes,
            });
        }
        out
    }

    /// Checksum of frame `seq`'s DECODED pixels, computed in WASM (view).
    ///
    /// Exists to make C1 — "the in-WASM codec is bit-identical on every node" —
    /// assertable across the wire. Two nodes that received the same fragments
    /// independently decode and hash them; equal checksums mean equal pixels.
    ///
    /// The alternative was comparing whole pixel arrays in the e2e, which
    /// merobox's assertion DSL cannot express: `contains(...)`/`regex(...)` split
    /// their arguments on every comma, and `json_subset` does not recurse into
    /// dicts nested in a list. Asserting a substring like "255" instead — which
    /// is what the draft workflow did — passes on any response that merely
    /// contains those digits anywhere, including a width or a byte count, so it
    /// proved nothing. A `u64` compares as a scalar.
    ///
    /// Returns `None` for a seq with no live, fully-present frame (pruned, never
    /// sent, or still missing chunks) — an absent frame is not an error.
    pub fn frame_checksum(&self, seq: u64) -> Option<u64> {
        // Reuse the one decode path so the checksum can never drift from what
        // `get_frame` actually hands the renderer.
        self.get_frame(seq.saturating_sub(1))
            .into_iter()
            .find(|f| f.seq == seq)
            .map(|f| codec::fnv1a64(&f.pixels))
    }

    // ── Approach 2: store/serve opaque chunks from a real browser codec ─────────

    /// Store one WebCodecs-encoded chunk. **The approach-2 core.**
    ///
    /// `data_b64` is base64 because the RPC layer is JSON (see `ChunkView`).
    /// `now` is unix MILLISECONDS, like `encode_frame`.
    ///
    /// No codec work happens here — that is the entire design. We decode base64
    /// to bytes, store them, advance the window, and emit an event. Compare
    /// `encode_frame`, which burns ~10 ms of WASM on a 3 KB frame; this is a
    /// memcpy, so a realistic resolution stops being CPU-bound on the node.
    /// Nine parameters is past clippy's threshold, and deliberate: these arrive as
    /// NAMED fields in a JSON-RPC `argsJson` object, so the flat list *is* the wire
    /// contract. Grouping them into a struct would nest the JSON one level and
    /// break every caller for a purely cosmetic win.
    #[allow(clippy::too_many_arguments)]
    pub fn post_chunk(
        &mut self,
        data_b64: String,
        track: u8,
        is_keyframe: bool,
        codec: String,
        width: u16,
        height: u16,
        timestamp_us: u64,
        now: u64,
    ) -> app::Result<u64> {
        let from = self.require_member()?;

        let data = BASE64
            .decode(data_b64.as_bytes())
            .map_err(|_| app::err!("data_b64 is not valid base64"))?;
        if data.is_empty() {
            app::bail!("chunk is empty");
        }
        // C2: one chunk is one replicated delta. The browser is told to keep
        // chunks small, but a client is not trusted to obey — a single oversize
        // chunk would be silently undeliverable (it exceeds the gossip transmit
        // size), so reject it here where the sender still sees the error.
        if data.len() > MAX_MEDIA_CHUNK_BYTES {
            app::bail!("chunk exceeds MAX_MEDIA_CHUNK_BYTES; lower the bitrate or resolution");
        }
        // A decoder must be configured with the exact codec string the encoder
        // used, so an empty one is unusable downstream.
        if codec.is_empty() {
            app::bail!("codec string is required");
        }

        // Mint from OUR OWN counter. Nothing another sender does can move it, so
        // two peers posting at the same instant can no longer mint the same seq.
        let mut cursor = self.own_cursor(&from)?;
        let seq = cursor.next_seq.saturating_add(1);
        cursor.next_seq = seq;
        if is_keyframe {
            cursor.last_keyframe = seq;
        }
        cursor.newest_at = cursor.newest_at.max(now);
        if cursor.oldest_live == 0 {
            cursor.oldest_live = seq;
        }

        let chunk = MediaChunk {
            seq,
            from: from.clone(),
            track,
            is_keyframe,
            codec,
            width,
            height,
            timestamp_us,
            data,
            created_at: now,
        };
        self.chunks.insert(Self::chunk_key(&from, seq), chunk)?;
        self.chunk_cursors.update(&from, cursor)?;

        // Reap our own trailing chunks, then collect anyone who has gone away.
        self.prune_own_chunks(&from, now)?;
        self.sweep_stale_senders(&from, now)?;
        app::emit!(Event::ChunkPosted(seq));
        Ok(seq)
    }

    /// Chunk storage key. Per sender, monotone within that sender, NEVER reused
    /// (C3). See the `chunks` field for why `from` is part of the key; the seq is
    /// zero-padded so key order is seq order.
    fn chunk_key(from: &str, seq: u64) -> String {
        format!("chunk-{from}-{seq:020}")
    }

    /// Every genuine live chunk of `from` with `seq >= from_seq`, oldest first:
    /// one range read over that sender's keys, dropping any chunk the sender's
    /// account did not write.
    fn sender_chunks(&self, from: &str, from_seq: u64) -> Vec<MediaChunk> {
        // `:` sorts right after `9`, so this bounds every zero-padded seq.
        let end = format!("chunk-{from}-:");
        let Some(account) = self.account_of(from) else {
            return Vec::new();
        };
        self.chunks
            .range(Self::chunk_key(from, from_seq)..end)
            .map(|rows| Self::senders_own(&self.chunks, &account, rows))
            .unwrap_or_default()
    }

    /// Senders whose cursor row their own account wrote, with that cursor.
    fn genuine_cursors(&self) -> Vec<(String, ChunkCursor)> {
        self.chunk_cursors
            .entries_with_owners()
            .map(|e| {
                e.into_iter()
                    .filter(|(owner, from, _)| self.written_by(owner, from))
                    .map(|(_, from, cursor)| (from, cursor))
                    .collect()
            })
            .unwrap_or_default()
    }

    /// Every live chunk newer than the caller's per-sender cursor, oldest first
    /// (view, no delta).
    ///
    /// `cursors` carries one `after_seq` per sender the caller is already
    /// decoding. **A sender the caller has never seen is served from that
    /// sender's own newest live keyframe**, which is what makes joining
    /// mid-call work: feeding a decoder a delta frame with no preceding
    /// keyframe cannot produce a picture, and each sender is an independent
    /// bitstream, so "newest keyframe" only means anything per sender.
    ///
    /// That folds in the old `keyframe_cursor()` round-trip — joining is now one
    /// call instead of "ask for the cursor, then ask for chunks".
    ///
    /// Each sender is one range read from its own start, so the cost is what is
    /// returned, not the whole buffer. Returns base64 so the JSON transport
    /// stays ~1.37x rather than ~3x.
    pub fn get_chunks(&self, cursors: Vec<SenderCursor>) -> Vec<ChunkView> {
        let mut senders = self.genuine_cursors();
        // Decoders are order-sensitive: a delta frame fed before its reference
        // produces garbage or throws. Group by sender, ascending within each, so
        // the caller can feed every decoder straight through.
        senders.sort_by(|a, b| a.0.cmp(&b.0));
        let mut out = Vec::new();
        for (from, _) in senders {
            let start = match cursors.iter().find(|k| k.from == from) {
                Some(k) => k.after_seq.saturating_add(1),
                // Unknown sender: start at their newest live keyframe. A zero
                // floor means they have no live keyframe at all, so there is
                // nothing decodable to hand over yet — send none of it rather
                // than deltas the decoder will throw on.
                None => match self.live_keyframe_of(&from) {
                    0 => continue,
                    floor => floor,
                },
            };
            out.extend(
                self.sender_chunks(&from, start)
                    .into_iter()
                    .map(|c| ChunkView {
                        seq: c.seq,
                        from: c.from,
                        track: c.track,
                        is_keyframe: c.is_keyframe,
                        codec: c.codec,
                        width: c.width,
                        height: c.height,
                        timestamp_us: c.timestamp_us,
                        data_b64: BASE64.encode(&c.data),
                        created_at: c.created_at,
                    }),
            );
        }
        out
    }

    /// That sender's newest keyframe seq if it is still live, else 0.
    fn live_keyframe_of(&self, from: &str) -> u64 {
        let key = from.to_owned();
        let Some(account) = self.account_of(from) else {
            return 0;
        };
        // The sender's own cursor and chunk, read by name.
        let seq = match self.chunk_cursors.get_by(&account, &key) {
            Ok(Some(c)) => c.last_keyframe,
            _ => return 0,
        };
        if seq == 0 {
            return 0;
        }
        // Confirm it is still live, and the sender's own, rather than trusting
        // the cursor — the reaper protects it, but a peer that has not synced
        // yet may legitimately not hold it.
        let chunk = Self::chunk_key(from, seq);
        match self.chunks.contains_by(&account, &chunk) {
            Ok(true) => seq,
            _ => 0,
        }
    }

    /// Newest live keyframe per sender — one entry for each sender that
    /// currently offers a decodable entry point.
    ///
    /// `get_chunks` already defaults unknown senders to this, so the receive
    /// path no longer needs to call it. Kept for diagnostics and e2e assertions.
    pub fn keyframe_cursors(&self) -> Vec<SenderCursor> {
        let mut out: Vec<SenderCursor> = self
            .genuine_cursors()
            .into_iter()
            .filter_map(|(from, _)| {
                let seq = self.live_keyframe_of(&from);
                (seq != 0).then_some(SenderCursor {
                    from,
                    after_seq: seq,
                })
            })
            .collect();
        out.sort_by(|a, b| a.from.cmp(&b.from));
        out
    }

    pub fn get_live_stats(&self) -> LiveStats {
        let mut senders: Vec<SenderStats> = self
            .genuine_cursors()
            .into_iter()
            // A cursor that only ever counted approach-3 frames has no chunks.
            .filter(|(_, cur)| cur.next_seq != 0)
            .map(|(from, cur)| {
                let live = self.sender_chunks(&from, 0);
                SenderStats {
                    live_chunks: live.len() as u32,
                    live_bytes: live
                        .iter()
                        .fold(0u64, |bytes, c| bytes.saturating_add(c.data.len() as u64)),
                    from,
                    next_seq: cur.next_seq,
                    oldest_live: cur.oldest_live,
                    last_keyframe: cur.last_keyframe,
                    newest_at: cur.newest_at,
                    pruned: cur.pruned,
                }
            })
            .collect();
        senders.sort_by(|a, b| a.from.cmp(&b.from));

        LiveStats {
            live_chunks: senders.iter().map(|s| s.live_chunks).sum(),
            live_bytes: senders.iter().map(|s| s.live_bytes).sum(),
            pruned_chunks: senders.iter().map(|s| s.pruned).sum(),
            senders,
        }
    }

    /// Age out **our own** trailing chunks. Time-based, keyframe-safe.
    ///
    /// Two properties matter here, and the old reaper had neither:
    ///
    /// 1. **A sender only ever reaps its own chunks on this path.** Concurrent
    ///    `insert` of `chunk-X` on one node and `remove` of `chunk-X` on another
    ///    is the insert-races-tombstone pattern that does not converge; keeping
    ///    deletes owned by the writer removes the race entirely rather than
    ///    hoping it stays rare.
    /// 2. **The window is wall-clock, not a row count**, so it does not shrink
    ///    as senders join and it can be sized against real sync latency.
    ///
    /// The keyframe clamp is unchanged in spirit but now per sender: never drop
    /// our newest keyframe or anything after it. Without it the window boundary
    /// eventually lands past the last keyframe and every remaining chunk is a
    /// delta with no reference — live, replicating, and undecodable, which is the
    /// worst failure mode available because nothing looks broken from the
    /// sender's side.
    ///
    /// Every seq visited counts against `MAX_PRUNE_PER_CALL`, holes included: a
    /// cursor whose `next_seq` sits far past its live chunks must cost one
    /// bounded call, not a walk over every empty seq in between.
    fn prune_own_chunks(&mut self, from: &str, now: u64) -> app::Result<()> {
        let key = from.to_owned();
        let Some(mut cursor) = self.chunk_cursors.get(&key)? else {
            return Ok(());
        };

        let cutoff = now.saturating_sub(LIVE_WINDOW_MS);
        // Backstop for a broken/hostile clock: if the time window is not
        // retiring anything, still refuse to hold more than this many.
        let count_floor = cursor
            .next_seq
            .saturating_sub(MAX_LIVE_CHUNKS_PER_SENDER)
            .saturating_add(1);

        let start = cursor.oldest_live.max(1);
        let mut removed = 0u64;
        let mut steps = 0u64;
        let mut seq = start;
        while seq < cursor.next_seq && steps < MAX_PRUNE_PER_CALL {
            steps += 1;
            let over_count = seq < count_floor;
            // Never step on or past our own newest keyframe — *unless* the count
            // backstop demands it.
            //
            // The clamp normally wins, because dropping the keyframe leaves every
            // surviving chunk an undecodable delta. But a sender that stops
            // emitting keyframes would then pin its buffer forever, and the clamp
            // would have converted "briefly undecodable" into "unbounded state".
            // An undecodable window self-heals on the next keyframe
            // (KEYFRAME_INTERVAL_MS, ~2 s); an unbounded buffer never does. So
            // past the hard ceiling the backstop takes precedence.
            if !over_count && cursor.last_keyframe != 0 && seq >= cursor.last_keyframe {
                break;
            }
            let chunk_key = Self::chunk_key(from, seq);
            // Our own chunk only: keys are per owner, so somebody else's key
            // under our `from` is their entry, and reads as a hole here.
            let too_old = match self.chunks.get(&chunk_key)? {
                Some(c) => c.created_at < cutoff,
                // Already gone — advance over the hole.
                None => {
                    seq += 1;
                    continue;
                }
            };
            if !(too_old || over_count) {
                break;
            }
            if self.chunks.remove(&chunk_key)?.is_some() {
                removed += 1;
            }
            seq += 1;
        }

        if removed > 0 || seq > cursor.oldest_live {
            cursor.oldest_live = seq;
            cursor.pruned = cursor.pruned.saturating_add(removed);
            self.chunk_cursors.update(&key, cursor)?;
        }
        Ok(())
    }

    /// Collect the buffer of any sender that has stopped posting.
    ///
    /// Self-pruning bounds a *live* sender, but a peer who closes the tab leaves
    /// their last window pinned forever, so someone else has to collect it. That
    /// someone is a MODERATOR of `chunks` (the creator): a chunk is owned by its
    /// sender, and every node refuses anyone else's delete. It is safe because
    /// `STALE_SENDER_MS` (30 s) is five times the live window: by the time it
    /// fires the owner has not written for half a minute, so the delete cannot
    /// realistically race a live insert.
    ///
    /// The departed sender's cursor is theirs, so it is left as it is; the sweep
    /// reads their live chunks as one range instead of walking seqs from it,
    /// which also means a cursor claiming `next_seq = u64::MAX` costs nothing.
    fn sweep_stale_senders(&mut self, me: &str, now: u64) -> app::Result<()> {
        if !self.chunks.is_moderator(&Self::caller_account()) {
            return Ok(());
        }
        let cutoff = now.saturating_sub(STALE_SENDER_MS);
        let stale: Vec<(AccountId, String)> = self
            .chunk_cursors
            .entries_with_owners()
            .map(|e| {
                // `next_seq != 0`: the sender has posted chunks. Not
                // `oldest_live < next_seq`, which skipped a sender who left
                // with exactly one live chunk.
                e.into_iter()
                    .filter(|(_, from, cur)| {
                        from != me && cur.newest_at < cutoff && cur.next_seq != 0
                    })
                    .map(|(owner, from, _)| (owner, from))
                    .collect()
            })
            .unwrap_or_default();

        let mut budget = MAX_PRUNE_PER_CALL;
        for (owner, from) in stale {
            // No keyframe clamp: the sender is gone, so there is no stream left
            // to keep decodable.
            let end = format!("chunk-{from}-:");
            let keys: Vec<String> = self
                .chunks
                .range(Self::chunk_key(&from, 0)..end)?
                .map(|(key, _)| key)
                .take(budget as usize)
                .collect();
            // The departed sender's own chunks, by name: keys are per owner,
            // and a key-only `remove` removes only the caller's own entry.
            for key in keys {
                if self.chunks.remove_by(&owner, &key)?.is_some() {
                    budget -= 1;
                }
            }
            if budget == 0 {
                break;
            }
        }
        Ok(())
    }

    /// Explicit reaper (membership-gated). Prunes **only the caller's own**
    /// chunks, and still honours their keyframe clamp — an operator cannot ask
    /// for an undecodable stream, nor reach into someone else's buffer.
    ///
    /// At most `MAX_PRUNE_PER_CALL` chunks per call, read as one range over the
    /// live ones: `before_seq = u64::MAX` is one bounded call, not a walk.
    pub fn prune_chunks(&mut self, before_seq: u64) -> app::Result<()> {
        let me = self.require_member()?;
        let key = me.clone();
        let Some(mut cursor) = self.chunk_cursors.get(&key)? else {
            return Ok(());
        };
        if !self.chunk_cursors.owned_by_me(&key)? {
            return Ok(());
        }
        let clamped = if cursor.last_keyframe == 0 {
            before_seq
        } else {
            before_seq.min(cursor.last_keyframe)
        };
        if clamped == 0 {
            return Ok(());
        }

        let doomed: Vec<(String, u64)> = self
            .chunks
            .range(Self::chunk_key(&me, cursor.oldest_live.max(1))..Self::chunk_key(&me, clamped))?
            .map(|(key, c)| (key, c.seq))
            .collect();
        let mut removed = 0u64;
        let mut reached = clamped;
        for (key, seq) in doomed {
            if !self.chunks.owned_by_me(&key)? {
                continue;
            }
            if removed == MAX_PRUNE_PER_CALL {
                reached = seq;
                break;
            }
            if self.chunks.remove(&key)?.is_some() {
                removed += 1;
            }
        }
        if reached > cursor.oldest_live {
            cursor.oldest_live = reached;
        }
        cursor.pruned = cursor.pruned.saturating_add(removed);
        self.chunk_cursors.update(&key, cursor)?;
        Ok(())
    }

    // ── Prune (explicit reaper; every removal is a tombstone — C3) ────────────────

    /// Remove the CALLER'S fragments of frames with `seq < before_seq`.
    /// Callable explicitly (an experiment may drive it) and also inline after
    /// every `encode_frame`. Requires membership, and reaches only the caller's
    /// own frames: every node refuses a delete of anyone else's.
    pub fn prune_frames(&mut self, before_seq: u64) -> app::Result<()> {
        let me = self.require_member()?;
        self.prune_own_frames(&me, before_seq)
    }

    /// Remove `from`'s own fragments below `before_seq`: one range read over
    /// that sender's keys, at most `MAX_PRUNE_PER_CALL` removals. Each removal
    /// is a replicated tombstone (C3) — that cost is exactly what Task 3
    /// measures.
    fn prune_own_frames(&mut self, from: &str, before_seq: u64) -> app::Result<()> {
        if before_seq == 0 {
            return Ok(());
        }
        let doomed: Vec<(String, u64)> = self
            .fragments
            .range(Self::frag_key(from, 0, 0)..Self::frag_key(from, before_seq, 0))?
            .map(|(key, f)| (key, f.seq))
            .take(MAX_PRUNE_PER_CALL as usize)
            .collect();
        let mut pruned_seqs: Vec<u64> = Vec::new();
        for (key, seq) in doomed {
            if !self.fragments.owned_by_me(&key)? {
                continue;
            }
            if self.fragments.remove(&key)?.is_some() && !pruned_seqs.contains(&seq) {
                pruned_seqs.push(seq);
            }
        }
        if pruned_seqs.is_empty() {
            return Ok(());
        }
        let mut cursor = self.own_cursor(from)?;
        cursor.frames_pruned = cursor
            .frames_pruned
            .saturating_add(pruned_seqs.len() as u64);
        self.chunk_cursors.update(&from.to_owned(), cursor)?;
        app::emit!(Event::FramesPruned(before_seq));
        Ok(())
    }

    // ── Instrumentation ──────────────────────────────────────────────────────

    pub fn get_stats(&self) -> StreamStats {
        let frames: Vec<u64> = self
            .fragments
            .entries()
            .map(|e| e.map(|(_, f)| f.seq).collect())
            .unwrap_or_default();
        StreamStats {
            name: self.stream_name_str(),
            member_count: self.members.len().unwrap_or(0) as u32,
            live_fragments: frames.len() as u32,
            next_seq: *self.next_seq.get(),
            oldest_live_seq: frames.iter().copied().min().unwrap_or(0),
            pruned_frames: self
                .genuine_cursors()
                .iter()
                .fold(0u64, |n, (_, c)| n.saturating_add(c.frames_pruned)),
        }
    }

    // ── Admin ──────────────────────────────────────────────────────────────────

    pub fn rename_stream(&mut self, name: String) -> app::Result<()> {
        // `Ownable` enforces owner-only convergence at the merge layer, and
        // `only_owner()` fail-fasts a non-owner rename at the API (same pattern
        // as mero-meet's `rename_room`).
        self.stream_name.only_owner()?;
        self.stream_name.insert(LwwRegister::new(name))?;
        Ok(())
    }

    /// Whether the given MEMBER key's owner is an admin.
    ///
    /// Takes a device key (what the frontend has) but resolves it through the
    /// member row's owner stamp to the `AccountId` that `AccessControl` is keyed
    /// by since rc.20. A member who has never joined has no known account, so
    /// this is `false` rather than an error — the caller asked a yes/no
    /// question.
    pub fn is_member_admin(&self, member: String) -> bool {
        if Self::parse_pk(&member).is_err() {
            return false;
        }
        match self.account_of(&member) {
            Some(account) => self.roles.is_admin(&account),
            None => false,
        }
    }
}

// ── Codec #1: quantize-4bit + RLE (integer-only, deterministic — C1/C4) ─────────
//
// The whole codec path is pure integer arithmetic on `u8`/`u16`, so it is
// bit-identical on every wasmer build and CPU (C1). No float, no lookup that
// depends on rounding.
//
//   quantize:   q = p >> 4            (8-bit luma → 4-bit, 0..15)
//   reconstruct r = (q << 4) | q      (4-bit → 8-bit; maps 0..15 → 0,17,…,255)
//   RLE:        stream of [run: u8 (1..=255), value: u8 (0..15)] pairs
//
// Round-trip is exactly the identity on any frame whose pixels are already of
// the form `(q << 4) | q` (see the bit-identity test), which is what proves C1.
mod codec {
    /// Quantize one 8-bit luma sample to 4-bit (0..15).
    #[inline]
    fn quantize(p: u8) -> u8 {
        p >> 4
    }

    /// Reconstruct an 8-bit luma sample from a 4-bit value (0..15 → 0,17,…,255).
    #[inline]
    fn reconstruct(q: u8) -> u8 {
        (q << 4) | q
    }

    /// Encode raw luma → quantized RLE byte stream. Deterministic, integer-only.
    pub fn encode_quant_rle(raw: &[u8]) -> Vec<u8> {
        let mut out = Vec::new();
        let mut idx = 0;
        while idx < raw.len() {
            let v = quantize(raw[idx]);
            let mut run: u16 = 1;
            // Extend the run while the quantized value matches and the run fits
            // in a u8 (255 max per pair — deterministic split above that).
            while idx + (run as usize) < raw.len()
                && quantize(raw[idx + run as usize]) == v
                && run < 255
            {
                run += 1;
            }
            out.push(run as u8);
            out.push(v);
            idx += run as usize;
        }
        out
    }

    /// Decode a quantized RLE byte stream → raw luma of exactly `expected` bytes.
    /// Defensive: a truncated/oversized stream is clamped to `expected` so a
    /// partially-gossiped fragment can never panic a view.
    pub fn decode_quant_rle(encoded: &[u8], expected: usize) -> Vec<u8> {
        let mut out = Vec::with_capacity(expected);
        let mut i = 0;
        while i + 1 < encoded.len() && out.len() < expected {
            let run = encoded[i] as usize;
            let v = reconstruct(encoded[i + 1] & 0x0f);
            for _ in 0..run {
                if out.len() >= expected {
                    break;
                }
                out.push(v);
            }
            i += 2;
        }
        // Pad if the stream was short (missing chunk) so geometry stays valid.
        while out.len() < expected {
            out.push(0);
        }
        out
    }

    /// FNV-1a 64 over a byte slice. Integer-only and endianness-free (it consumes
    /// one byte at a time), so it is as deterministic as the codec itself (C1) —
    /// which is the whole reason it exists rather than a `DefaultHasher`, whose
    /// output Rust explicitly does not guarantee across builds.
    ///
    /// Not a security primitive; a collision-resistance argument is not needed
    /// for "did these two nodes decode the same pixels".
    pub fn fnv1a64(bytes: &[u8]) -> u64 {
        const OFFSET_BASIS: u64 = 0xcbf2_9ce4_8422_2325;
        const PRIME: u64 = 0x0000_0100_0000_01b3;
        let mut hash = OFFSET_BASIS;
        for b in bytes {
            hash ^= *b as u64;
            hash = hash.wrapping_mul(PRIME);
        }
        hash
    }
}

// ── Tests ─────────────────────────────────────────────────────────────────────

#[cfg(test)]
mod tests {
    use calimero_sdk::testing::TestHost;

    use super::{
        codec, ChunkCursor, DecodedFrame, MergeableTrait as _, MeroStream, SenderCursor, BASE64,
        FRAME_WINDOW, LIVE_WINDOW_MS, MAX_CHUNK_BYTES, MAX_DIM, MAX_LIVE_CHUNKS_PER_SENDER,
        MAX_MEDIA_CHUNK_BYTES, STALE_SENDER_MS, TRACK_VIDEO_LUMA,
    };
    use base64::Engine as _;
    use calimero_sdk::app;

    const ALICE: [u8; 32] = [0x11; 32];
    const BOB: [u8; 32] = [0x22; 32];
    /// Two more, for the four-broadcaster tests.
    ///
    /// The CONTRACT is not capped at all: `post_chunk` accepts any member. These
    /// tests exist because every per-sender guard in here had only ever been
    /// proved against TWO senders — exactly the number that cannot distinguish
    /// "isolated per sender" from "isolated from the one other sender". Four is
    /// the useful test width regardless of what any client permits.
    ///
    /// (The client's cooperative cap is a separate thing, currently 2 and set by
    /// measurement in `app/src/lib/slots.ts`. It has no bearing on these tests.)
    const CAROL: [u8; 32] = [0x33; 32];
    const DAVE: [u8; 32] = [0x44; 32];
    /// `AccessControl` and `Ownable` are keyed by ACCOUNT since rc.20, and
    /// `call_as` keeps the caller's account on purpose (two devices, one person).
    /// A test peer that must NOT inherit the creator's rights needs its own.
    const BOB_ACCOUNT: [u8; 32] = [0xB0; 32];

    /// Render an id the way the contract does. `member_id` is
    /// `String::from(caller())`, i.e. the SDK stringifying a `PublicKey` —
    /// which core 0.11.0-rc.27 made hex (base58 removed, core#3691). This was
    /// `bs58::encode`; every `member_id == id_of(..)` assertion below compared
    /// against the wrong string the moment the SDK bumped.
    fn id_of(bytes: [u8; 32]) -> String {
        hex::encode(bytes)
    }

    /// "Give me everything from these senders" — the cursor set that the old
    /// global `get_chunks(0)` used to mean.
    fn from_zero(who: &[[u8; 32]]) -> Vec<SenderCursor> {
        who.iter()
            .map(|w| SenderCursor {
                from: id_of(*w),
                after_seq: 0,
            })
            .collect()
    }

    /// A single sender's cursor.
    fn at(who: [u8; 32], after_seq: u64) -> Vec<SenderCursor> {
        vec![SenderCursor {
            from: id_of(who),
            after_seq,
        }]
    }

    /// That sender's slice of `get_live_stats`.
    fn sender_stats(app: &mut TestHost<MeroStream>, who: [u8; 32]) -> super::SenderStats {
        let want = id_of(who);
        app.view(|s| s.get_live_stats())
            .senders
            .into_iter()
            .find(|s| s.from == want)
            .unwrap_or_else(|| panic!("no stats for sender {want}"))
    }

    /// A fresh stream whose creator is also the `chunks` moderator, as on a
    /// node.
    ///
    /// `TestHost` runs `init` with the storage layer's writer left at its own
    /// default rather than the SDK account, so `Moderated::new()` names that
    /// default as the first moderator while `roles` and `stream_name` name the
    /// SDK account. On a node the two are one account. Rotating the moderators
    /// to the creator restores that, so the tests exercise the real split: the
    /// creator sweeps, anyone else does not.
    fn new_stream() -> TestHost<MeroStream> {
        let mut app = TestHost::new(|| MeroStream::init("probe".to_owned()));
        let creator = calimero_sdk::AccountId::from(app.account_id());
        let genesis = *app
            .view(|s| s.chunks.moderators())
            .iter()
            .next()
            .expect("init names a moderator")
            .as_bytes();
        app.call_as_account(genesis, genesis, |s| {
            s.chunks.set_moderators([creator].into_iter().collect())
        })
        .expect("rotate the moderators to the creator");
        app
    }

    /// A frame whose pixels are all of the form (q<<4)|q, so quantize→reconstruct
    /// is the identity — this is what makes the round-trip *bit-identical* and
    /// proves the codec is deterministic (C1).
    fn quant_aligned_frame(w: usize, h: usize) -> Vec<u8> {
        (0..w * h)
            .map(|i| {
                let q = (i % 16) as u8;
                (q << 4) | q
            })
            .collect()
    }

    // ── C1: determinism / bit-identical round-trip ───────────────────────────────

    #[test]
    fn codec_round_trip_is_bit_identical_on_aligned_frame() {
        let frame = quant_aligned_frame(64, 48);
        let encoded = codec::encode_quant_rle(&frame);
        let decoded = codec::decode_quant_rle(&encoded, frame.len());
        assert_eq!(
            decoded, frame,
            "quant-aligned frame must round-trip identically (C1)"
        );
    }

    #[test]
    fn codec_encode_is_deterministic() {
        let frame = quant_aligned_frame(32, 32);
        assert_eq!(
            codec::encode_quant_rle(&frame),
            codec::encode_quant_rle(&frame),
            "encode must be a pure deterministic function (C1)"
        );
    }

    #[test]
    fn codec_quantization_is_idempotent_under_reencode() {
        // Arbitrary (non-aligned) input: decode(encode(x)) must be a fixed point
        // of the codec — re-encoding the decoded frame yields the same bytes.
        let frame: Vec<u8> = (0..64 * 48).map(|i| (i * 7 % 256) as u8).collect();
        let once = codec::decode_quant_rle(&codec::encode_quant_rle(&frame), frame.len());
        let twice = codec::decode_quant_rle(&codec::encode_quant_rle(&once), once.len());
        assert_eq!(
            once, twice,
            "decode∘encode must be idempotent (deterministic convergence)"
        );
    }

    // ── encode_frame → get_frame round-trip through the contract ──────────────────

    #[test]
    fn encode_then_get_frame_reconstructs_the_frame() {
        let mut app = new_stream();
        app.call_as(ALICE, |s| s.join("Alice".to_owned(), 1000))
            .unwrap();

        let frame = quant_aligned_frame(64, 48);
        let seq = app
            .call_as(ALICE, |s| {
                s.encode_frame(frame.clone(), 64, 48, TRACK_VIDEO_LUMA, 1001)
            })
            .unwrap();
        assert_eq!(seq, 1, "first frame gets base seq 1");

        let frames: Vec<DecodedFrame> = app.view(|s| s.get_frame(0));
        assert_eq!(frames.len(), 1);
        assert_eq!(frames[0].seq, 1);
        assert_eq!(frames[0].from, id_of(ALICE));
        assert_eq!(frames[0].width, 64);
        assert_eq!(frames[0].height, 48);
        assert_eq!(
            frames[0].pixels, frame,
            "decoded pixels match the aligned input (C1)"
        );
    }

    #[test]
    fn get_frame_cursor_only_returns_new_frames() {
        let mut app = new_stream();
        app.call_as(ALICE, |s| s.join("Alice".to_owned(), 1000))
            .unwrap();
        let f = quant_aligned_frame(16, 16);
        let s1 = app
            .call_as(ALICE, |s| s.encode_frame(f.clone(), 16, 16, 0, 1001))
            .unwrap();
        let s2 = app
            .call_as(ALICE, |s| s.encode_frame(f.clone(), 16, 16, 0, 1002))
            .unwrap();
        assert!(s2 > s1);
        // Cursor at s1 → only the second frame comes back.
        let newer = app.view(move |s| s.get_frame(s1));
        assert_eq!(newer.len(), 1);
        assert_eq!(newer[0].seq, s2);
    }

    // ── C2: sub-frame chunking splits and reassembles ────────────────────────────

    #[test]
    fn large_frame_is_chunked_and_reassembles() {
        let mut app = new_stream();
        app.call_as(ALICE, |s| s.join("Alice".to_owned(), 1000))
            .unwrap();

        // A worst-case incompressible frame: every adjacent pair differs in its
        // quantized value, so RLE emits a 2-byte pair per pixel and the encoded
        // stream is ~2× the pixel count — forcing multiple chunks at 256×256.
        let (w, h) = (256usize, 256usize);
        let frame: Vec<u8> = (0..w * h)
            .map(|i| {
                let q = if i % 2 == 0 { 0u8 } else { 15u8 };
                (q << 4) | q
            })
            .collect();
        let seq = app
            .call_as(ALICE, |s| {
                s.encode_frame(frame.clone(), w as u16, h as u16, 0, 1001)
            })
            .unwrap();

        // The frame must have been split into >1 fragment (C2).
        let stats = app.view(|s| s.get_stats());
        assert!(
            stats.live_fragments > 1,
            "an incompressible 256x256 frame must chunk into multiple fragments, got {}",
            stats.live_fragments
        );

        // …and still reassemble to the exact input.
        let frames = app.view(move |s| s.get_frame(seq - 1));
        assert_eq!(frames.len(), 1);
        assert_eq!(
            frames[0].pixels, frame,
            "chunked frame reassembles bit-identically"
        );
        // No single chunk exceeds the cap.
        assert!(frames[0].encoded_bytes as usize <= w * h * 2 + 2);
    }

    // ── C3: monotone keys never reused → re-send after prune converges ────────────

    #[test]
    fn frame_keys_are_never_reused_across_prune() {
        let mut app = new_stream();
        app.call_as(ALICE, |s| s.join("Alice".to_owned(), 1000))
            .unwrap();
        let f = quant_aligned_frame(8, 8);

        // Send enough frames to force pruning of the earliest ones.
        let n = FRAME_WINDOW + 5;
        let mut last = 0;
        for k in 0..n {
            last = app
                .call_as(ALICE, |s| s.encode_frame(f.clone(), 8, 8, 0, 1001 + k))
                .unwrap();
        }
        assert_eq!(last, n, "seq is strictly monotone across all sends");

        // Live window is bounded, oldest frames pruned (tombstones emitted, C3).
        let stats = app.view(|s| s.get_stats());
        assert!(stats.pruned_frames > 0, "old frames must have been pruned");
        assert!(stats.oldest_live_seq > 0);

        // The newest frames are still readable and correct — i.e. later inserts
        // under fresh keys were NOT shadowed by earlier prune tombstones.
        let frames = app.view(|s| s.get_frame(0));
        assert!(!frames.is_empty(), "recent frames survive and decode");
        assert!(
            frames.iter().all(|fr| fr.pixels == f),
            "every live frame decodes correctly after prunes (no key-reuse shadowing)"
        );
        // Every live seq is above the pruned watermark.
        assert!(frames.iter().all(|fr| fr.seq >= stats.oldest_live_seq));
    }

    // ── frame_checksum: the scalar C1 proof the 2-node e2e asserts on ─────────────

    #[test]
    fn checksum_is_stable_and_matches_the_decoded_pixels() {
        let mut app = new_stream();
        app.call_as(ALICE, |s| s.join("Alice".to_owned(), 1000))
            .unwrap();
        let frame = quant_aligned_frame(16, 16);
        let seq = app
            .call_as(ALICE, |s| {
                s.encode_frame(frame.clone(), 16, 16, TRACK_VIDEO_LUMA, 1_751_955_010_123)
            })
            .unwrap();

        let checksum = app.view(|s| s.frame_checksum(seq)).expect("frame is live");
        // Repeated views must agree — a view is a pure function of state (C1).
        assert_eq!(checksum, app.view(|s| s.frame_checksum(seq)).unwrap());
        // And it must be the hash of exactly what get_frame hands the renderer,
        // so the e2e's checksum equality really is a pixel-equality claim.
        let decoded = app.view(|s| s.get_frame(seq - 1));
        let pixels = &decoded.iter().find(|f| f.seq == seq).unwrap().pixels;
        assert_eq!(checksum, codec::fnv1a64(pixels));
        // The frame was quant-aligned, so the pixels are the ORIGINAL input and
        // the checksum is the checksum of what the camera produced.
        assert_eq!(checksum, codec::fnv1a64(&frame));
    }

    #[test]
    fn checksum_separates_frames_that_differ_by_one_pixel() {
        // The property the e2e leans on: if the far node decoded anything other
        // than these exact pixels, the scalar must not match. A quantized codec
        // makes this subtle — a difference inside one 4-bit bucket is *supposed*
        // to vanish, so perturb by a full bucket (+16) to get a real difference.
        let base = quant_aligned_frame(8, 8);
        let mut perturbed = base.clone();
        perturbed[40] = perturbed[40].wrapping_add(16);
        let q = |v: &[u8]| {
            codec::fnv1a64(&codec::decode_quant_rle(
                &codec::encode_quant_rle(v),
                v.len(),
            ))
        };
        assert_ne!(
            q(&base),
            q(&perturbed),
            "a one-bucket pixel change must change the checksum"
        );
    }

    #[test]
    fn checksum_is_none_for_a_frame_that_is_not_live() {
        let mut app = new_stream();
        app.call_as(ALICE, |s| s.join("Alice".to_owned(), 1000))
            .unwrap();
        // Never sent.
        assert_eq!(app.view(|s| s.frame_checksum(1)), None);
        // Sent, then pruned away — absent is not an error, so the e2e can
        // distinguish "not there yet" from "decoded differently".
        let f = quant_aligned_frame(8, 8);
        for k in 0..FRAME_WINDOW + 5 {
            app.call_as(ALICE, |s| s.encode_frame(f.clone(), 8, 8, 0, 1001 + k))
                .unwrap();
        }
        assert_eq!(
            app.view(|s| s.frame_checksum(1)),
            None,
            "a pruned frame reports absent"
        );
    }

    // ── Guards ────────────────────────────────────────────────────────────────

    #[test]
    fn non_member_cannot_encode() {
        let mut app = new_stream();
        app.call_as(ALICE, |s| s.join("Alice".to_owned(), 1000))
            .unwrap();
        let f = quant_aligned_frame(8, 8);
        // BOB never joined.
        let res = app.call_as(BOB, |s| s.encode_frame(f, 8, 8, 0, 1001));
        assert!(res.is_err(), "a non-member must not be able to push frames");
    }

    #[test]
    fn mismatched_geometry_is_rejected() {
        let mut app = new_stream();
        app.call_as(ALICE, |s| s.join("Alice".to_owned(), 1000))
            .unwrap();
        // Claim 16x16 but send only 8x8 worth of bytes.
        let res = app.call_as(ALICE, |s| s.encode_frame(vec![0u8; 64], 16, 16, 0, 1001));
        assert!(res.is_err(), "raw length must match width*height");
    }

    #[test]
    fn chunk_cap_is_respected_per_fragment() {
        // Sanity on the constant itself: a full-white frame RLE-compresses to a
        // handful of bytes, so it is always one chunk well under the cap.
        let frame = vec![0xFFu8; 200 * 200];
        let encoded = codec::encode_quant_rle(&frame);
        assert!(
            encoded.len() <= MAX_CHUNK_BYTES,
            "flat frame is tiny after RLE"
        );
    }

    #[test]
    fn zero_and_oversize_geometry_are_rejected() {
        let mut app = new_stream();
        app.call_as(ALICE, |s| s.join("Alice".to_owned(), 1000))
            .unwrap();

        // Zero dimensions: `expected` would be 0 and a 0-byte "frame" would be
        // accepted as valid, quietly polluting the seq series with empty frames.
        assert!(app
            .call_as(ALICE, |s| s.encode_frame(vec![], 0, 48, 0, 1001))
            .is_err());
        assert!(app
            .call_as(ALICE, |s| s.encode_frame(vec![], 64, 0, 0, 1001))
            .is_err());

        // Past MAX_DIM. Checked before the length check, so a caller cannot get
        // an oversize geometry accepted by matching raw.len() to it.
        // A 1-pixel-tall strip that is one pixel too wide, with raw.len() matching
        // it exactly — so only the MAX_DIM check can reject this.
        let over = MAX_DIM as usize + 1;
        assert!(app
            .call_as(ALICE, |s| s.encode_frame(
                vec![0u8; over],
                over as u16,
                1,
                0,
                1001
            ))
            .is_err());
    }

    #[test]
    fn a_rejected_frame_does_not_consume_a_seq() {
        // Guards must run BEFORE the seq is allocated. If a rejected frame burned
        // a seq, a receiver's gap counter would report phantom drops for frames
        // that were never sent — corrupting the §4 drop metric with sender-side
        // validation failures.
        let mut app = new_stream();
        app.call_as(ALICE, |s| s.join("Alice".to_owned(), 1000))
            .unwrap();
        let before = app.view(|s| s.get_stats()).next_seq;
        assert!(app
            .call_as(ALICE, |s| s.encode_frame(vec![0u8; 10], 64, 48, 0, 1001))
            .is_err());
        assert_eq!(
            app.view(|s| s.get_stats()).next_seq,
            before,
            "a rejected frame must not advance the monotone seq"
        );
    }

    #[test]
    fn non_member_cannot_prune() {
        // prune_frames is membership-gated like encode_frame — otherwise any
        // caller could delete a stream's live window, and every removal is a
        // replicated tombstone (C3) that can never be taken back.
        let mut app = new_stream();
        app.call_as(ALICE, |s| s.join("Alice".to_owned(), 1000))
            .unwrap();
        let f = quant_aligned_frame(8, 8);
        app.call_as(ALICE, |s| s.encode_frame(f, 8, 8, 0, 1001))
            .unwrap();
        assert!(app.call_as(BOB, |s| s.prune_frames(1)).is_err());
        // Alice (a member) can.
        assert!(app.call_as(ALICE, |s| s.prune_frames(1)).is_ok());
    }

    // ── Codec edges ───────────────────────────────────────────────────────────────

    #[test]
    fn codec_splits_runs_longer_than_255() {
        // The run length is a u8, so a flat region longer than 255 must split into
        // several (run, value) pairs. Getting this wrong truncates a flat frame,
        // and a flat frame is exactly what a webcam produces against a blank wall.
        let frame = vec![0x77u8; 1000];
        let encoded = codec::encode_quant_rle(&frame);
        assert_eq!(encoded.len() % 2, 0, "output is (run, value) pairs");
        // ceil(1000/255) = 4 pairs.
        assert_eq!(encoded.len(), 8);
        assert_eq!(codec::decode_quant_rle(&encoded, frame.len()), frame);
    }

    #[test]
    fn codec_handles_degenerate_sizes() {
        // Empty input must not produce a phantom pair, and a single pixel must
        // round-trip — both hit the `while idx < raw.len()` boundary.
        assert!(codec::encode_quant_rle(&[]).is_empty());
        assert_eq!(codec::decode_quant_rle(&[], 0), Vec::<u8>::new());
        let one = vec![0x33u8];
        assert_eq!(
            codec::decode_quant_rle(&codec::encode_quant_rle(&one), 1),
            one
        );
    }

    #[test]
    fn decode_pads_a_truncated_stream_instead_of_panicking() {
        // A partially-gossiped fragment must never panic a view — get_frame is
        // called on every SSE nudge, and a panic there would take out the whole
        // read path rather than just skipping one frame.
        let frame = quant_aligned_frame(16, 16);
        let encoded = codec::encode_quant_rle(&frame);
        let truncated = &encoded[..encoded.len() / 2];
        let decoded = codec::decode_quant_rle(truncated, frame.len());
        assert_eq!(decoded.len(), frame.len(), "geometry stays valid");
        // An odd-length stream (a pair cut in half) is also safe.
        assert_eq!(
            codec::decode_quant_rle(&encoded[..1], frame.len()).len(),
            frame.len()
        );
    }

    #[test]
    fn decode_clamps_a_stream_that_claims_more_pixels_than_expected() {
        // Defensive against a crafted/oversized fragment: the decoder must fill
        // exactly `expected` and stop, never grow past the frame geometry.
        let oversized = vec![255u8, 0x0f]; // one run of 255 pixels
        assert_eq!(codec::decode_quant_rle(&oversized, 10).len(), 10);
    }

    #[test]
    fn quantization_discards_only_the_low_nibble() {
        // The codec's lossiness is a documented 4-bit quantization. Pin it, so a
        // future codec change that silently alters fidelity fails here rather
        // than quietly changing what every recorded measurement means.
        let raw: Vec<u8> = (0..=255u8).collect();
        let decoded = codec::decode_quant_rle(&codec::encode_quant_rle(&raw), raw.len());
        for (i, (r, d)) in raw.iter().zip(decoded.iter()).enumerate() {
            let q = r >> 4;
            assert_eq!(
                *d,
                (q << 4) | q,
                "pixel {i}: value {r} must reconstruct from its 4-bit bucket"
            );
        }
    }

    // ── Multi-sender + partial frames (the get_frame grouping logic) ──────────────

    #[test]
    fn frames_from_two_senders_stay_separate() {
        // Fragments are grouped by (seq, from). Two members encoding concurrently
        // must not have their chunks merged into one corrupt frame.
        let mut app = new_stream();
        app.call_as(ALICE, |s| s.join("Alice".to_owned(), 1000))
            .unwrap();
        app.call_as(BOB, |s| s.join("Bob".to_owned(), 1000))
            .unwrap();

        let a_frame = quant_aligned_frame(8, 8);
        let b_frame: Vec<u8> = a_frame.iter().map(|p| p ^ 0xFF).collect();
        app.call_as(ALICE, |s| s.encode_frame(a_frame.clone(), 8, 8, 0, 1001))
            .unwrap();
        app.call_as(BOB, |s| s.encode_frame(b_frame.clone(), 8, 8, 0, 1002))
            .unwrap();

        let frames = app.view(|s| s.get_frame(0));
        assert_eq!(frames.len(), 2, "one frame per sender");
        let alice_id = id_of(ALICE);
        let from_alice = frames.iter().find(|f| f.from == alice_id).unwrap();
        let from_bob = frames.iter().find(|f| f.from != alice_id).unwrap();
        assert_eq!(from_alice.pixels, a_frame);
        assert_eq!(from_bob.pixels, b_frame);
    }

    #[test]
    fn get_frame_returns_frames_in_ascending_seq_order() {
        // The renderer advances a cursor to the highest seq it has seen, so
        // out-of-order delivery here would make it skip frames permanently.
        let mut app = new_stream();
        app.call_as(ALICE, |s| s.join("Alice".to_owned(), 1000))
            .unwrap();
        let f = quant_aligned_frame(4, 4);
        for k in 0..5 {
            app.call_as(ALICE, |s| s.encode_frame(f.clone(), 4, 4, 0, 1001 + k))
                .unwrap();
        }
        let seqs: Vec<u64> = app.view(|s| s.get_frame(0)).iter().map(|f| f.seq).collect();
        let mut sorted = seqs.clone();
        sorted.sort_unstable();
        assert_eq!(seqs, sorted, "frames must come back oldest-first");
    }

    #[test]
    fn a_multi_chunk_frame_checksums_the_same_as_its_pixels() {
        // Ties chunking (C2) to the checksum the e2e asserts on: a frame big
        // enough to split must reassemble before hashing, or a chunked frame
        // would report a different checksum on every node that received a
        // different chunk subset.
        let mut app = new_stream();
        app.call_as(ALICE, |s| s.join("Alice".to_owned(), 1000))
            .unwrap();
        // High-entropy so RLE cannot compress it under the chunk cap.
        let w = 256usize;
        let h = 200usize;
        let frame: Vec<u8> = (0..w * h).map(|i| ((i * 37) % 256) as u8).collect();
        let seq = app
            .call_as(ALICE, |s| {
                s.encode_frame(frame.clone(), w as u16, h as u16, 0, 1001)
            })
            .unwrap();

        let stats = app.view(|s| s.get_stats());
        assert!(
            stats.live_fragments > 1,
            "frame must actually have split into multiple chunks (got {})",
            stats.live_fragments
        );

        let decoded = app.view(|s| s.get_frame(seq - 1));
        let f = decoded.iter().find(|f| f.seq == seq).unwrap();
        assert_eq!(f.pixels.len(), w * h, "reassembled to full geometry");
        assert_eq!(
            app.view(|s| s.frame_checksum(seq)).unwrap(),
            codec::fnv1a64(&f.pixels)
        );
    }

    // ── Stats + admin ─────────────────────────────────────────────────────────────

    #[test]
    fn stats_track_the_live_window_and_the_tombstone_count() {
        let mut app = new_stream();
        app.call_as(ALICE, |s| s.join("Alice".to_owned(), 1000))
            .unwrap();
        let fresh = app.view(|s| s.get_stats());
        assert_eq!(fresh.next_seq, 0);
        assert_eq!(fresh.live_fragments, 0);
        assert_eq!(fresh.pruned_frames, 0);
        assert_eq!(fresh.member_count, 1);

        let f = quant_aligned_frame(4, 4);
        for k in 0..3 {
            app.call_as(ALICE, |s| s.encode_frame(f.clone(), 4, 4, 0, 1001 + k))
                .unwrap();
        }
        let after = app.view(|s| s.get_stats());
        assert_eq!(after.next_seq, 3, "one seq per frame");
        assert_eq!(after.live_fragments, 3, "small frames are one chunk each");
        assert_eq!(after.pruned_frames, 0, "still inside FRAME_WINDOW");
        assert_eq!(after.name, "probe");
    }

    #[test]
    fn explicit_prune_removes_only_below_the_watermark() {
        let mut app = new_stream();
        app.call_as(ALICE, |s| s.join("Alice".to_owned(), 1000))
            .unwrap();
        let f = quant_aligned_frame(4, 4);
        for k in 0..5 {
            app.call_as(ALICE, |s| s.encode_frame(f.clone(), 4, 4, 0, 1001 + k))
                .unwrap();
        }
        app.call_as(ALICE, |s| s.prune_frames(4)).unwrap();
        let seqs: Vec<u64> = app.view(|s| s.get_frame(0)).iter().map(|f| f.seq).collect();
        assert_eq!(seqs, vec![4, 5], "frames below the watermark are gone");
        // prune_frames(0) is a documented no-op — an off-by-one there would wipe
        // the whole window on a caller passing a default 0.
        app.call_as(ALICE, |s| s.prune_frames(0)).unwrap();
        assert_eq!(app.view(|s| s.get_frame(0)).len(), 2);
    }

    #[test]
    fn membership_is_idempotent_and_updates_the_name() {
        // The frontend auto-joins on every mount, so a second join must not
        // duplicate the member or reset the roster.
        let mut app = new_stream();
        app.call_as(ALICE, |s| s.join("Alice".to_owned(), 1000))
            .unwrap();
        app.call_as(ALICE, |s| s.join("Alice Renamed".to_owned(), 2000))
            .unwrap();
        let members = app.view(|s| s.get_members());
        assert_eq!(members.len(), 1, "re-joining must not duplicate a member");
        assert_eq!(members[0].username, "Alice Renamed");
    }

    // ── Approach 2: opaque chunks from a real browser codec ───────────────────────

    fn b64(bytes: &[u8]) -> String {
        BASE64.encode(bytes)
    }

    /// Post one chunk with the boilerplate filled in.
    fn post(
        app: &mut TestHost<MeroStream>,
        who: [u8; 32],
        data: &[u8],
        keyframe: bool,
        now: u64,
    ) -> app::Result<u64> {
        app.call_as(who, |s| {
            s.post_chunk(
                b64(data),
                0,
                keyframe,
                "avc1.42001f".to_owned(),
                640,
                480,
                now * 1000,
                now,
            )
        })
    }

    #[test]
    fn a_chunk_round_trips_byte_for_byte_without_being_interpreted() {
        // The approach-2 claim: arbitrary encoded bytes come back exactly as sent.
        // Deliberately NOT valid H.264 — this app must not care, and a test using
        // a real access unit would hide it if we ever started parsing.
        let mut app = new_stream();
        app.call_as(ALICE, |s| s.join("Alice".to_owned(), 1000))
            .unwrap();
        let payload: Vec<u8> = (0..500).map(|i| ((i * 31) % 256) as u8).collect();
        let seq = post(&mut app, ALICE, &payload, true, 1_751_955_010).unwrap();

        let got = app.view(|s| s.get_chunks(at(ALICE, seq - 1)));
        assert_eq!(got.len(), 1);
        assert_eq!(BASE64.decode(got[0].data_b64.as_bytes()).unwrap(), payload);
        // The decoder config must survive verbatim, or the peer decodes garbage.
        assert_eq!(got[0].codec, "avc1.42001f");
        assert_eq!((got[0].width, got[0].height), (640, 480));
        assert!(got[0].is_keyframe);
    }

    #[test]
    fn chunks_come_back_in_seq_order() {
        // Decoders are order-sensitive: a delta frame before its reference throws.
        let mut app = new_stream();
        app.call_as(ALICE, |s| s.join("Alice".to_owned(), 1000))
            .unwrap();
        post(&mut app, ALICE, b"key", true, 1000).unwrap();
        for k in 1..6 {
            post(&mut app, ALICE, b"delta", false, 1000 + k).unwrap();
        }
        let seqs: Vec<u64> = app
            .view(|s| s.get_chunks(from_zero(&[ALICE])))
            .iter()
            .map(|c| c.seq)
            .collect();
        let mut sorted = seqs.clone();
        sorted.sort_unstable();
        assert_eq!(seqs, sorted);
    }

    #[test]
    fn the_reaper_never_prunes_past_the_newest_keyframe() {
        // THE approach-2 regression. If the rolling window is allowed to advance
        // past the last keyframe, every surviving chunk is a delta with no
        // reference: the stream keeps replicating and is silently undecodable.
        let mut app = new_stream();
        app.call_as(ALICE, |s| s.join("Alice".to_owned(), 1000))
            .unwrap();

        // One keyframe, then deltas spanning several times the live window.
        let kf = post(&mut app, ALICE, b"keyframe", true, 1000).unwrap();
        let span = LIVE_WINDOW_MS * 4;
        for k in 1..=100u64 {
            post(&mut app, ALICE, b"delta", false, 1000 + k * (span / 100)).unwrap();
        }

        let st = sender_stats(&mut app, ALICE);
        assert_eq!(st.last_keyframe, kf);
        // The window wanted to prune well past `kf`; the clamp held it back.
        assert!(
            st.oldest_live <= kf,
            "window advanced past the keyframe: oldest={} kf={}",
            st.oldest_live,
            kf
        );
        // And the keyframe is genuinely still readable, so a joiner can start.
        assert_eq!(
            app.view(|s| s.keyframe_cursors()),
            vec![SenderCursor {
                from: id_of(ALICE),
                after_seq: kf
            }]
        );
        assert!(app
            .view(|s| s.get_chunks(at(ALICE, kf - 1)))
            .iter()
            .any(|c| c.seq == kf && c.is_keyframe));
    }

    #[test]
    fn a_newer_keyframe_releases_the_older_one_for_pruning() {
        // The clamp must not be a permanent leak: once a NEWER keyframe exists,
        // everything before it becomes prunable, otherwise live state grows
        // forever and the window bounds nothing.
        let mut app = new_stream();
        app.call_as(ALICE, |s| s.join("Alice".to_owned(), 1000))
            .unwrap();
        let first_kf = post(&mut app, ALICE, b"kf1", true, 1000).unwrap();
        for k in 1..=10u64 {
            post(&mut app, ALICE, b"delta", false, 1000 + k * 100).unwrap();
        }
        // A second keyframe far enough ahead that kf1's era falls out of the
        // window, then more traffic so the reaper actually runs.
        let base = 1000 + LIVE_WINDOW_MS * 3;
        let second_kf = post(&mut app, ALICE, b"kf2", true, base).unwrap();
        for k in 1..=10u64 {
            post(&mut app, ALICE, b"delta", false, base + k * 100).unwrap();
        }

        let st = sender_stats(&mut app, ALICE);
        assert_eq!(st.last_keyframe, second_kf);
        assert!(
            st.oldest_live > first_kf,
            "the superseded keyframe should have been released (oldest={} first_kf={})",
            st.oldest_live,
            first_kf
        );
        assert!(st.pruned > 0);
        assert!(app.view(|s| s.get_live_stats()).pruned_chunks > 0);
        // The CURRENT keyframe still survives — a joiner is never left stranded.
        assert_eq!(
            app.view(|s| s.keyframe_cursors()),
            vec![SenderCursor {
                from: id_of(ALICE),
                after_seq: second_kf
            }]
        );
    }

    #[test]
    fn explicit_prune_cannot_strand_the_stream_either() {
        // prune_chunks is membership-gated AND clamped: an operator asking to wipe
        // everything must not be able to produce an undecodable live stream.
        let mut app = new_stream();
        app.call_as(ALICE, |s| s.join("Alice".to_owned(), 1000))
            .unwrap();
        let kf = post(&mut app, ALICE, b"kf", true, 1000).unwrap();
        for k in 0..5 {
            post(&mut app, ALICE, b"delta", false, 1001 + k).unwrap();
        }
        assert!(app.call_as(BOB, |s| s.prune_chunks(9999)).is_err());
        app.call_as(ALICE, |s| s.prune_chunks(9999)).unwrap();
        assert_eq!(
            app.view(|s| s.keyframe_cursors()),
            vec![SenderCursor {
                from: id_of(ALICE),
                after_seq: kf
            }],
            "even prune(everything) must leave the keyframe"
        );
    }

    #[test]
    fn explicit_prune_cannot_reach_another_senders_buffer() {
        // prune_chunks is scoped to the caller. Letting one member reap another
        // member's chunks reintroduces exactly the cross-sender delete that the
        // per-sender split exists to remove.
        let mut app = new_stream();
        app.call_as(ALICE, |s| s.join("Alice".to_owned(), 1000))
            .unwrap();
        app.call_as(BOB, |s| s.join("Bob".to_owned(), 1000))
            .unwrap();
        post(&mut app, ALICE, b"a-kf", true, 1000).unwrap();
        for k in 1..=4u64 {
            post(&mut app, ALICE, b"a-delta", false, 1000 + k).unwrap();
        }
        let before = sender_stats(&mut app, ALICE).live_chunks;

        // Bob asks to wipe everything. Only Bob's (empty) buffer is in scope.
        app.call_as(BOB, |s| s.prune_chunks(u64::MAX)).unwrap();

        assert_eq!(
            sender_stats(&mut app, ALICE).live_chunks,
            before,
            "Bob's prune must not touch Alice's chunks"
        );
    }

    #[test]
    fn keyframe_cursors_is_empty_before_any_keyframe() {
        // A joiner must be able to tell "nothing decodable yet" from "start here",
        // including the case where only delta frames have been posted.
        let mut app = new_stream();
        app.call_as(ALICE, |s| s.join("Alice".to_owned(), 1000))
            .unwrap();
        assert!(app.view(|s| s.keyframe_cursors()).is_empty());
        post(&mut app, ALICE, b"delta-only", false, 1000).unwrap();
        assert!(app.view(|s| s.keyframe_cursors()).is_empty());
        // And a fresh joiner is handed nothing rather than undecodable deltas.
        assert!(app.view(|s| s.get_chunks(vec![])).is_empty());
    }

    #[test]
    fn chunk_guards_reject_what_the_wire_cannot_carry() {
        let mut app = new_stream();
        app.call_as(ALICE, |s| s.join("Alice".to_owned(), 1000))
            .unwrap();

        // Not base64.
        assert!(app
            .call_as(ALICE, |s| s.post_chunk(
                "!!!not base64!!!".to_owned(),
                0,
                true,
                "avc1".to_owned(),
                640,
                480,
                0,
                1000
            ))
            .is_err());
        // Empty payload.
        assert!(post(&mut app, ALICE, b"", true, 1000).is_err());
        // Over the per-delta cap — rejected here so the sender sees it, rather
        // than becoming a silently undeliverable gossip message.
        let too_big = vec![7u8; MAX_MEDIA_CHUNK_BYTES + 1];
        assert!(post(&mut app, ALICE, &too_big, true, 1000).is_err());
        // Missing codec string: the peer could not configure a decoder.
        assert!(app
            .call_as(ALICE, |s| s.post_chunk(
                b64(b"x"),
                0,
                true,
                String::new(),
                640,
                480,
                0,
                1000
            ))
            .is_err());
        // None of the rejects may consume a seq — no cursor row at all yet.
        assert!(app.view(|s| s.get_live_stats()).senders.is_empty());
    }

    #[test]
    fn a_non_member_cannot_post_chunks() {
        let mut app = new_stream();
        app.call_as(ALICE, |s| s.join("Alice".to_owned(), 1000))
            .unwrap();
        assert!(post(&mut app, BOB, b"payload", true, 1000).is_err());
    }

    #[test]
    fn live_stats_track_bytes_and_the_keyframe() {
        let mut app = new_stream();
        app.call_as(ALICE, |s| s.join("Alice".to_owned(), 1000))
            .unwrap();
        let fresh = app.view(|s| s.get_live_stats());
        assert_eq!((fresh.live_chunks, fresh.live_bytes), (0, 0));
        assert!(fresh.senders.is_empty());

        post(&mut app, ALICE, &[1u8; 100], true, 1000).unwrap();
        post(&mut app, ALICE, &[2u8; 250], false, 1001).unwrap();
        let stats = app.view(|s| s.get_live_stats());
        assert_eq!(stats.live_chunks, 2);
        assert_eq!(
            stats.live_bytes, 350,
            "live_bytes is the real state footprint"
        );
        let st = sender_stats(&mut app, ALICE);
        assert_eq!(st.next_seq, 2);
        assert_eq!(st.last_keyframe, 1);
        assert_eq!((st.live_chunks, st.live_bytes), (2, 350));
    }

    #[test]
    fn audio_and_video_share_one_ring_and_stay_distinguishable() {
        // Approach 2 gets audio for free: it is just another opaque codec output.
        // Both tracks ride the same seq series, and `track` is what separates them
        // on the receive side.
        let mut app = new_stream();
        app.call_as(ALICE, |s| s.join("Alice".to_owned(), 1000))
            .unwrap();
        app.call_as(ALICE, |s| {
            s.post_chunk(
                b64(b"video"),
                0,
                true,
                "avc1.42001f".to_owned(),
                640,
                480,
                0,
                1000,
            )
        })
        .unwrap();
        app.call_as(ALICE, |s| {
            s.post_chunk(b64(b"audio"), 1, true, "opus".to_owned(), 0, 0, 0, 1001)
        })
        .unwrap();

        let all = app.view(|s| s.get_chunks(from_zero(&[ALICE])));
        assert_eq!(all.len(), 2);
        let video = all.iter().find(|c| c.track == 0).unwrap();
        let audio = all.iter().find(|c| c.track == 1).unwrap();
        assert_eq!(video.codec, "avc1.42001f");
        assert_eq!(audio.codec, "opus");
        assert_eq!(BASE64.decode(audio.data_b64.as_bytes()).unwrap(), b"audio");
    }

    #[test]
    fn approach_3_state_is_untouched_by_approach_2() {
        // The two paths must not interfere — approach 3 is the measured baseline.
        let mut app = new_stream();
        app.call_as(ALICE, |s| s.join("Alice".to_owned(), 1000))
            .unwrap();
        post(&mut app, ALICE, b"opaque", true, 1000).unwrap();
        let frame = quant_aligned_frame(8, 8);
        app.call_as(ALICE, |s| s.encode_frame(frame, 8, 8, 0, 1001))
            .unwrap();

        assert_eq!(app.view(|s| s.get_stats()).next_seq, 1);
        assert_eq!(sender_stats(&mut app, ALICE).next_seq, 1);
        assert_eq!(app.view(|s| s.get_frame(0)).len(), 1);
        assert_eq!(app.view(|s| s.get_chunks(from_zero(&[ALICE]))).len(), 1);
    }

    // ── Cross-network regressions (see retro/review.md) ──────────────────────

    #[test]
    fn two_senders_posting_the_same_seq_do_not_overwrite_each_other() {
        // THE regression behind the one-directional call. Both senders mint
        // seq 1, 2, 3... from their own counters — under the old shared
        // LwwRegister they collided on one `chunk-{seq}` key and last-writer-wins
        // silently destroyed one side's video.
        let mut app = new_stream();
        app.call_as(ALICE, |s| s.join("Alice".to_owned(), 1000))
            .unwrap();
        app.call_as(BOB, |s| s.join("Bob".to_owned(), 1000))
            .unwrap();

        // Interleaved, exactly as two peers in a call behave.
        for k in 0..5u64 {
            let a = post(&mut app, ALICE, b"alice-frame", k == 0, 1000 + k).unwrap();
            let b = post(&mut app, BOB, b"bob-frame", k == 0, 1000 + k).unwrap();
            // Both really do mint the same numbers — that is the point.
            assert_eq!((a, b), (k + 1, k + 1));
        }

        let all = app.view(|s| s.get_chunks(from_zero(&[ALICE, BOB])));
        assert_eq!(all.len(), 10, "no chunk may be lost to a key collision");

        // And each side's bytes are intact, not the other's.
        for c in &all {
            let want: &[u8] = if c.from == id_of(ALICE) {
                b"alice-frame"
            } else {
                b"bob-frame"
            };
            assert_eq!(BASE64.decode(c.data_b64.as_bytes()).unwrap(), want);
        }
        assert_eq!(all.iter().filter(|c| c.from == id_of(ALICE)).count(), 5);
        assert_eq!(all.iter().filter(|c| c.from == id_of(BOB)).count(), 5);
    }

    #[test]
    fn one_senders_traffic_does_not_reap_anothers_chunks() {
        // The second half of the same bug: the old reaper ran on every post from
        // ANY sender against one global window, so a fast sender's writes pushed
        // a slower/laggier sender's chunks below the prune floor and deleted them
        // on arrival. A sender must only ever reap its own.
        let mut app = new_stream();
        app.call_as(ALICE, |s| s.join("Alice".to_owned(), 1000))
            .unwrap();
        app.call_as(BOB, |s| s.join("Bob".to_owned(), 1000))
            .unwrap();

        // Alice posts a keyframe and goes quiet.
        post(&mut app, ALICE, b"alice-kf", true, 1000).unwrap();
        let alice_live = sender_stats(&mut app, ALICE).live_chunks;
        assert_eq!(alice_live, 1);

        // Bob then floods — well past the old 120-entry window, but still inside
        // STALE_SENDER_MS so Alice has not been collected as departed.
        for k in 1..=200u64 {
            post(&mut app, BOB, b"bob-delta", k == 1, 1000 + k).unwrap();
        }

        assert_eq!(
            sender_stats(&mut app, ALICE).live_chunks,
            1,
            "Bob's traffic must not reap Alice's keyframe"
        );
        // Alice is still joinable — the thing that was actually broken.
        assert!(app
            .view(|s| s.keyframe_cursors())
            .iter()
            .any(|c| c.from == id_of(ALICE)));
    }

    #[test]
    fn the_live_window_is_wall_clock_not_a_row_count() {
        // A count-based window shrank in wall-clock terms as senders were added
        // (120 entries is ~4.8 s with one sender at 25 fps, ~2.4 s with two), so
        // the more peers in the call the less latency it could absorb. Time is
        // the unit that does not move.
        let mut app = new_stream();
        app.call_as(ALICE, |s| s.join("Alice".to_owned(), 1000))
            .unwrap();

        // A dense burst: 300 chunks inside one second. Far more rows than the old
        // 120-entry window, but all of it well within LIVE_WINDOW_MS, so none of
        // it may be reaped.
        for k in 0..300u64 {
            post(&mut app, ALICE, b"x", k == 0, 1000 + k / 300).unwrap();
        }
        assert_eq!(
            sender_stats(&mut app, ALICE).live_chunks,
            300,
            "a dense burst inside the time window must survive in full"
        );

        // Now jump past the window with a fresh keyframe, releasing the old era.
        let t = 1000 + LIVE_WINDOW_MS * 2;
        post(&mut app, ALICE, b"new-kf", true, t).unwrap();
        post(&mut app, ALICE, b"after", false, t + 1).unwrap();
        let st = sender_stats(&mut app, ALICE);
        assert!(
            st.live_chunks < 300,
            "chunks older than the window should have been released (live={})",
            st.live_chunks
        );
        assert!(st.pruned > 0);
    }

    #[test]
    fn a_broken_clock_cannot_pin_state_forever() {
        // `now` is client-supplied, so the time window alone is not a bound. The
        // count backstop is what stops a stuck or hostile clock from holding
        // unbounded state.
        let mut app = new_stream();
        app.call_as(ALICE, |s| s.join("Alice".to_owned(), 1000))
            .unwrap();
        // Time never advances, so the time window retires nothing.
        post(&mut app, ALICE, b"kf", true, 1000).unwrap();
        for _ in 0..(MAX_LIVE_CHUNKS_PER_SENDER + 200) {
            post(&mut app, ALICE, b"delta", false, 1000).unwrap();
        }
        let st = sender_stats(&mut app, ALICE);
        assert!(
            u64::from(st.live_chunks) <= MAX_LIVE_CHUNKS_PER_SENDER + 1,
            "count backstop did not bound a frozen clock (live={})",
            st.live_chunks
        );
    }

    #[test]
    fn a_departed_senders_buffer_is_eventually_collected() {
        // Self-pruning bounds a live sender but cannot collect one who closed the
        // tab — their last window would otherwise stay pinned forever.
        let mut app = new_stream();
        app.call_as(ALICE, |s| s.join("Alice".to_owned(), 1000))
            .unwrap();
        app.call_as(BOB, |s| s.join("Bob".to_owned(), 1000))
            .unwrap();

        for k in 0..5u64 {
            post(&mut app, ALICE, b"alice", k == 0, 1000 + k).unwrap();
        }
        assert_eq!(sender_stats(&mut app, ALICE).live_chunks, 5);

        // Alice goes away. Bob keeps posting until well past the stale horizon.
        let t = 1000 + STALE_SENDER_MS + 1000;
        post(&mut app, BOB, b"bob", true, t).unwrap();

        assert_eq!(
            sender_stats(&mut app, ALICE).live_chunks,
            0,
            "a departed sender's buffer must be collected"
        );
        // Bob, who is still live, is untouched.
        assert_eq!(sender_stats(&mut app, BOB).live_chunks, 1);
    }

    #[test]
    fn a_live_sender_is_never_swept_as_stale() {
        // The sweep is the one place a node deletes someone else's chunks, so it
        // must not fire while they are still posting.
        let mut app = new_stream();
        app.call_as(ALICE, |s| s.join("Alice".to_owned(), 1000))
            .unwrap();
        app.call_as(BOB, |s| s.join("Bob".to_owned(), 1000))
            .unwrap();

        // Both post steadily across a span longer than STALE_SENDER_MS.
        let step = STALE_SENDER_MS / 4;
        for k in 0..6u64 {
            let t = 1000 + k * step;
            post(&mut app, ALICE, b"alice", true, t).unwrap();
            post(&mut app, BOB, b"bob", true, t).unwrap();
        }
        assert!(sender_stats(&mut app, ALICE).live_chunks > 0);
        assert!(sender_stats(&mut app, BOB).live_chunks > 0);
    }

    #[test]
    fn a_joiner_starts_at_each_senders_own_keyframe() {
        // The old global keyframe pointer meant a joiner's cursor landed mid-GOP
        // for every sender except whoever keyframed last. Per sender, everyone
        // gets a decodable entry point.
        let mut app = new_stream();
        app.call_as(ALICE, |s| s.join("Alice".to_owned(), 1000))
            .unwrap();
        app.call_as(BOB, |s| s.join("Bob".to_owned(), 1000))
            .unwrap();

        post(&mut app, ALICE, b"a-kf", true, 1000).unwrap();
        post(&mut app, ALICE, b"a-d1", false, 1001).unwrap();
        post(&mut app, BOB, b"b-kf", true, 1002).unwrap();
        post(&mut app, BOB, b"b-d1", false, 1003).unwrap();
        // Alice keyframes again; Bob does not.
        post(&mut app, ALICE, b"a-kf2", true, 1004).unwrap();
        post(&mut app, ALICE, b"a-d2", false, 1005).unwrap();

        // A joiner passes no cursors at all.
        let got = app.view(|s| s.get_chunks(vec![]));

        // Every sender's slice must begin on one of their own keyframes.
        for who in [ALICE, BOB] {
            let first = got
                .iter()
                .find(|c| c.from == id_of(who))
                .unwrap_or_else(|| panic!("joiner got nothing from {}", id_of(who)));
            assert!(
                first.is_keyframe,
                "joiner's first chunk from {} is not a keyframe",
                id_of(who)
            );
        }
    }

    #[test]
    fn chunk_cursor_merges_the_same_regardless_of_order() {
        // The whole reason for max-merge instead of LwwRegister: concurrent
        // updates must converge whatever order they arrive in.
        let a = ChunkCursor {
            next_seq: 10,
            oldest_live: 3,
            last_keyframe: 8,
            newest_at: 5_000,
            pruned: 2,
            frames_pruned: 1,
        };
        let b = ChunkCursor {
            next_seq: 7,
            oldest_live: 5,
            last_keyframe: 6,
            newest_at: 9_000,
            pruned: 4,
            frames_pruned: 0,
        };

        let mut ab = a.clone();
        ab.merge(&b).unwrap();
        let mut ba = b.clone();
        ba.merge(&a).unwrap();

        // Commutative.
        assert_eq!(
            (
                ab.next_seq,
                ab.oldest_live,
                ab.last_keyframe,
                ab.newest_at,
                ab.pruned
            ),
            (
                ba.next_seq,
                ba.oldest_live,
                ba.last_keyframe,
                ba.newest_at,
                ba.pruned
            )
        );
        assert_eq!((ab.next_seq, ab.oldest_live), (10, 5));
        assert_eq!((ab.last_keyframe, ab.newest_at, ab.pruned), (8, 9_000, 4));
        assert_eq!((ab.frames_pruned, ba.frames_pruned), (1, 1));

        // Idempotent — re-delivering the same update changes nothing.
        let mut again = ab.clone();
        again.merge(&b).unwrap();
        assert_eq!(again.next_seq, ab.next_seq);
        assert_eq!(again.pruned, ab.pruned);
    }

    #[test]
    fn a_non_owner_cannot_rename_the_stream() {
        let mut app = new_stream();
        app.call_as(ALICE, |s| s.join("Alice".to_owned(), 1000))
            .unwrap();
        // `call_as_account`, not `call_as`: ownership is keyed by ACCOUNT since
        // rc.20, and `call_as` deliberately keeps the caller's account (two
        // devices of one person). A peer that must not inherit the creator's
        // rights needs an account of its own — under plain `call_as`, Bob is
        // simply another of the creator's devices and the rename SUCCEEDS.
        assert!(app
            .call_as_account(BOB_ACCOUNT, BOB, |s| s.rename_stream("hijacked".to_owned()))
            .is_err());
        assert_eq!(app.view(|s| s.get_stats()).name, "probe");
    }

    #[test]
    fn the_owner_can_rename_and_the_new_name_sticks() {
        // The other half of the gate, and the regression guard for the init-time
        // seed: `get_stats().name` must be the init name before any rename and
        // the new one after. `Ownable::insert` inside `init` is silently dropped
        // on rc.20 (see the `initial_name` field), so a stream that reported ""
        // here would look "renamed to nothing" rather than broken.
        let mut app = new_stream();
        assert_eq!(app.view(|s| s.get_stats()).name, "probe");
        app.call_as(ALICE, |s| s.rename_stream("renamed".to_owned()))
            .unwrap();
        assert_eq!(app.view(|s| s.get_stats()).name, "renamed");
    }
    // ── Four broadcasters: the shipped cap, exercised as a cap ───────────────────
    //
    // Every per-sender guarantee below already had a two-sender test. Two is the
    // weakest interesting number: with one other sender, "each sender is isolated"
    // and "the two senders do not collide" are indistinguishable, and an
    // off-by-one that leaks into the NEXT sender's buffer has no next sender to
    // leak into. Four is what the app now permits, so four is what these check.

    /// Every broadcaster joins and posts `frames` interleaved, keyframe first —
    /// the shape of a real four-way call rather than four sequential monologues.
    fn four_way(frames: u64) -> (TestHost<MeroStream>, [[u8; 32]; 4]) {
        let who = [ALICE, BOB, CAROL, DAVE];
        let mut app = new_stream();
        for (i, w) in who.iter().enumerate() {
            app.call_as(*w, |s| s.join(format!("peer{i}"), 1000))
                .unwrap();
        }
        for k in 0..frames {
            for (i, w) in who.iter().enumerate() {
                // Distinct bytes per sender AND per frame, so a mix-up is visible
                // rather than merely possible.
                let payload = format!("s{i}-f{k}");
                post(&mut app, *w, payload.as_bytes(), k == 0, 1000 + k).unwrap();
            }
        }
        (app, who)
    }

    #[test]
    fn four_senders_keep_four_independent_seq_spaces() {
        let (mut app, who) = four_way(6);

        // Each sender minted 1..=6 from its OWN counter. Nothing another sender
        // does may move it — with one shared counter these would be 1..=24.
        for w in who {
            let st = sender_stats(&mut app, w);
            assert_eq!(st.next_seq, 6, "sender {} lost its own seq space", id_of(w));
        }

        let all = app.view(|s| s.get_chunks(from_zero(&who)));
        assert_eq!(all.len(), 24, "no chunk may be lost to a key collision");

        // And every chunk still carries its own sender's bytes.
        for c in &all {
            let idx = who.iter().position(|w| id_of(*w) == c.from).unwrap();
            let got = BASE64.decode(c.data_b64.as_bytes()).unwrap();
            let want = format!("s{idx}-f{}", c.seq - 1);
            assert_eq!(
                String::from_utf8(got).unwrap(),
                want,
                "chunk {} from {} carries another sender's payload",
                c.seq,
                c.from
            );
        }
    }

    #[test]
    fn a_fourth_sender_does_not_reap_the_other_three() {
        // `post_chunk` runs the reaper on every post. The two-sender version of
        // this test proves a sender does not reap "the other one"; with three
        // others it also proves the reaper is not walking the whole table.
        let (mut app, who) = four_way(3);
        let before: Vec<u32> = who
            .iter()
            .map(|w| sender_stats(&mut app, *w).live_chunks)
            .collect();

        // Dave alone keeps posting, well past the live window, so his own reaper
        // runs many times over.
        for k in 0..40u64 {
            post(&mut app, DAVE, b"dave", false, 2000 + k).unwrap();
        }

        for (i, w) in who.iter().enumerate().take(3) {
            let st = sender_stats(&mut app, *w);
            assert_eq!(
                st.live_chunks,
                before[i],
                "sender {} lost chunks to Dave's reaper",
                id_of(*w)
            );
            assert_eq!(st.pruned, 0, "sender {} was pruned by Dave", id_of(*w));
        }
    }

    #[test]
    fn a_joiner_starts_at_all_four_senders_own_keyframes() {
        // A joiner sends an EMPTY cursor set. Each sender is an independent
        // bitstream, so the contract has to pick four different entry points —
        // one global keyframe pointer would hand three of the four a delta frame
        // with no reference, which a decoder throws on rather than degrading.
        let (mut app, who) = four_way(2);
        for w in who {
            post(&mut app, w, b"kf2", true, 1010).unwrap();
            post(&mut app, w, b"delta", false, 1011).unwrap();
        }

        let served = app.view(|s| s.get_chunks(vec![]));
        for w in who {
            let mine: Vec<_> = served.iter().filter(|c| c.from == id_of(w)).collect();
            assert!(
                !mine.is_empty(),
                "joiner was served nothing at all from {}",
                id_of(w)
            );
            assert!(
                mine[0].is_keyframe,
                "joiner starts mid-GOP for {} (first served seq {})",
                id_of(w),
                mine[0].seq
            );
        }

        // Four cursors back, one per sender, and each at that sender's keyframe.
        let cursors = app.view(|s| s.keyframe_cursors());
        assert_eq!(cursors.len(), 4);
    }

    #[test]
    fn one_departed_sender_out_of_four_is_swept_and_the_rest_survive() {
        // The stale sweep runs from ANOTHER sender's post. With two senders,
        // "sweep the departed one" and "sweep everyone but me" produce the same
        // observable result. With four they do not.
        //
        // `now` here is MILLISECONDS (post_chunk's clock, unlike every other
        // method's seconds), and the sweep ZEROES a departed sender's buffer
        // rather than dropping the row — so this reads live_chunks, not presence
        // in the sender list.
        let (mut app, who) = four_way(2);
        for w in who {
            assert_eq!(sender_stats(&mut app, w).live_chunks, 2);
        }

        // Alice, Bob and Carol carry on well past the stale horizon; Dave left.
        let late = 1000 + STALE_SENDER_MS + 1000;
        for k in 0..3u64 {
            for w in [ALICE, BOB, CAROL] {
                post(&mut app, w, b"still-here", k == 0, late + k).unwrap();
            }
        }

        assert_eq!(
            sender_stats(&mut app, DAVE).live_chunks,
            0,
            "the departed sender's buffer was never collected"
        );
        for w in [ALICE, BOB, CAROL] {
            assert!(
                sender_stats(&mut app, w).live_chunks > 0,
                "live sender {} was swept as stale",
                id_of(w)
            );
        }
    }
    #[test]
    fn four_senders_cursors_advance_independently() {
        // The receive loop keeps one cursor PER sender and passes the whole set in
        // one call. A cursor set that is behind on one sender and current on the
        // others must return exactly the gap — not everything, and not nothing.
        let (app, who) = four_way(5);

        let mut cursors: Vec<SenderCursor> = who
            .iter()
            .map(|w| SenderCursor {
                from: id_of(*w),
                after_seq: 5,
            })
            .collect();
        assert!(
            app.view(|s| s.get_chunks(cursors.clone())).is_empty(),
            "a fully caught-up cursor set must return nothing"
        );

        // Rewind ONE sender by two frames.
        cursors[2].after_seq = 3;
        let got = app.view(|s| s.get_chunks(cursors));
        assert_eq!(
            got.len(),
            2,
            "only the rewound sender's gap should come back"
        );
        assert!(got.iter().all(|c| c.from == id_of(CAROL)));
        assert_eq!(
            got.iter().map(|c| c.seq).collect::<Vec<_>>(),
            vec![4, 5],
            "the gap must come back in ascending seq order"
        );
    }

    #[test]
    fn an_absent_cursor_among_four_is_treated_as_a_new_sender() {
        // Omitting a sender is how the receive loop says "never seen them" — after
        // a peer timeout it DELETES the cursor rather than keeping a stale one, so
        // a returning peer must be served from their keyframe and not replayed
        // from wherever they left off.
        let (mut app, who) = four_way(2);
        for w in who {
            post(&mut app, w, b"kf", true, 1005).unwrap();
        }

        // Caught up on three, absent for Carol.
        let cursors: Vec<SenderCursor> = [ALICE, BOB, DAVE]
            .iter()
            .map(|w| SenderCursor {
                from: id_of(*w),
                after_seq: 3,
            })
            .collect();

        let got = app.view(|s| s.get_chunks(cursors));
        assert!(
            got.iter().all(|c| c.from == id_of(CAROL)),
            "only the omitted sender should be served"
        );
        assert!(
            got.first().is_some_and(|c| c.is_keyframe),
            "an omitted sender must start at their own keyframe, not their oldest chunk"
        );
    }

    #[test]
    fn live_stats_report_all_four_senders_separately() {
        let (app, _who) = four_way(4);
        let stats = app.view(|s| s.get_live_stats());
        assert_eq!(stats.senders.len(), 4);

        // The aggregate must be the sum of the parts. A shared counter would make
        // liveChunks agree while the per-sender rows disagreed, or vice versa.
        let summed: u32 = stats.senders.iter().map(|s| s.live_chunks).sum();
        assert_eq!(stats.live_chunks, summed);
        let summed_bytes: u64 = stats.senders.iter().map(|s| s.live_bytes).sum();
        assert_eq!(stats.live_bytes, summed_bytes);

        for row in &stats.senders {
            assert_eq!(row.next_seq, 4);
            assert_eq!(
                row.last_keyframe, 1,
                "each sender keyframed on its own frame 1"
            );
        }
    }

    #[test]
    fn a_non_member_among_four_broadcasters_still_cannot_post() {
        // The membership gate is per call, not per stream: a fifth identity that
        // never joined must be refused even while four members are mid-call.
        let (mut app, _) = four_way(2);
        const ELI: [u8; 32] = [0x55; 32];
        assert!(
            post(&mut app, ELI, b"gatecrash", true, 1100).is_err(),
            "a non-member posted into a running four-way call"
        );
        assert_eq!(
            app.view(|s| s.get_live_stats()).senders.len(),
            4,
            "the refused post must not create a sender row"
        );
    }

    #[test]
    fn a_four_member_roster_is_complete_and_ordered_by_nobody_in_particular() {
        // `get_members` is what labels the tiles. All four have to be there, each
        // with the name THEY joined under — a roster that loses one leaves a tile
        // captioned with a truncated public key.
        let (app, who) = four_way(1);
        let members = app.view(|s| s.get_members());
        assert_eq!(members.len(), 4);
        for (i, w) in who.iter().enumerate() {
            let m = members
                .iter()
                .find(|m| m.member_id == id_of(*w))
                .unwrap_or_else(|| panic!("roster is missing {}", id_of(*w)));
            assert_eq!(m.username, format!("peer{i}"));
        }
    }

    // ── Storage-enforced ownership (holds against a patched node) ─────────────
    //
    // Each of these writes through the collections directly, the way a patched
    // node would, and checks what every node's apply step lets through.

    /// A different PERSON (account and device of their own), who has joined.
    const MALLORY: [u8; 32] = [0x4D; 32];
    const MALLORY_ACCOUNT: [u8; 32] = [0x4A; 32];

    fn with_mallory() -> TestHost<MeroStream> {
        let mut app = new_stream();
        app.call_as(ALICE, |s| s.join("Alice".to_owned(), 1000))
            .unwrap();
        app.call_as_account(MALLORY_ACCOUNT, MALLORY, |s| {
            s.join("Mallory".to_owned(), 1000)
        })
        .unwrap();
        app
    }

    #[test]
    fn a_forged_cursor_cannot_stall_the_reaper_or_the_sweep() {
        // The sweep used to count only chunks it actually removed, so a cursor
        // claiming `next_seq = u64::MAX` over an empty buffer walked ~2^64 empty
        // seqs on every post. Both loops are now bounded by steps.
        let mut app = new_stream();
        app.call_as(ALICE, |s| s.join("Alice".to_owned(), 1000))
            .unwrap();
        app.call_as(BOB, |s| s.join("Bob".to_owned(), 1000))
            .unwrap();
        post(&mut app, ALICE, b"alice", true, 1000).unwrap();
        // Alice's own node pushes her cursor to the ceiling (her row, so storage
        // allows it) — the worst her cursor can look to anyone else.
        app.call_as(ALICE, |s| {
            s.chunk_cursors.modify(&id_of(ALICE), |c| {
                c.next_seq = u64::MAX - 1;
                c.last_keyframe = 0;
            })
        })
        .unwrap();
        // Her own reaper finishes in one bounded call...
        post(&mut app, ALICE, b"alice", false, 1001).unwrap();
        // ...and so does the creator's sweep of her once she goes quiet.
        let late = 1001 + STALE_SENDER_MS + 1000;
        post(&mut app, BOB, b"bob", true, late).unwrap();
        assert_eq!(sender_stats(&mut app, ALICE).live_chunks, 0);
    }

    #[test]
    fn nobody_but_the_sender_rewrites_or_removes_their_chunks_or_cursor() {
        let mut app = with_mallory();
        let seq = post(&mut app, ALICE, b"alice", true, 1000).unwrap();
        let key = MeroStream::chunk_key(&id_of(ALICE), seq);
        let alice = id_of(ALICE);
        let alice_account = super::AccountId::from(app.account_id());

        // Keys are per owner: Mallory's key-only remove names her own entry
        // at the key, of which there is none; removing Alice's by name needs
        // a moderator.
        assert!(app
            .call_as_account(MALLORY_ACCOUNT, MALLORY, |s| s.chunks.remove(&key))
            .unwrap()
            .is_none());
        assert!(app
            .call_as_account(MALLORY_ACCOUNT, MALLORY, |s| s
                .chunks
                .remove_by(&alice_account, &key))
            .is_err());
        assert!(app
            .call_as_account(MALLORY_ACCOUNT, MALLORY, |s| {
                s.chunks.modify(&key, |c| c.data = b"forged".to_vec())
            })
            .is_err());
        assert!(
            app.call_as_account(MALLORY_ACCOUNT, MALLORY, |s| {
                s.chunk_cursors.modify(&alice, |c| c.next_seq = u64::MAX)
            })
            .is_err(),
            "a max-merged cursor pushed to u64::MAX would freeze her stream for good"
        );
        assert_eq!(sender_stats(&mut app, ALICE).next_seq, seq);

        // Her own prune still works.
        app.call_as(ALICE, |s| s.prune_chunks(u64::MAX)).unwrap();
    }

    #[test]
    fn a_chunk_planted_under_someone_elses_id_is_never_served() {
        let mut app = with_mallory();
        let seq = post(&mut app, ALICE, b"alice", true, 1000).unwrap();
        // A NEW key under Alice's id is Mallory's to insert — storage stamps it
        // as Mallory's, and every read drops it.
        app.call_as_account(MALLORY_ACCOUNT, MALLORY, |s| {
            s.chunks.insert(
                MeroStream::chunk_key(&id_of(ALICE), seq + 1),
                super::MediaChunk {
                    seq: seq + 1,
                    from: id_of(ALICE),
                    track: 0,
                    is_keyframe: true,
                    codec: "avc1.42001f".to_owned(),
                    width: 640,
                    height: 480,
                    timestamp_us: 0,
                    data: b"fake keyframe".to_vec(),
                    created_at: 1001,
                },
            )
        })
        .unwrap();

        let served = app.view(|s| s.get_chunks(at(ALICE, 0)));
        assert_eq!(served.len(), 1);
        assert_eq!(served[0].data_b64, BASE64.encode(b"alice"));
        assert_eq!(sender_stats(&mut app, ALICE).live_chunks, 1);
    }

    #[test]
    fn only_a_moderator_sweeps_a_departed_sender() {
        let mut app = with_mallory();
        post(&mut app, ALICE, b"alice", true, 1000).unwrap();
        let late = 1000 + STALE_SENDER_MS + 1000;
        // Mallory is live and posting, but not a moderator: Alice's buffer is
        // not hers to reap.
        app.call_as_account(MALLORY_ACCOUNT, MALLORY, |s| {
            s.post_chunk(
                b64(b"m"),
                0,
                true,
                "avc1.42001f".to_owned(),
                640,
                480,
                0,
                late,
            )
        })
        .unwrap();
        assert_eq!(sender_stats(&mut app, ALICE).live_chunks, 1);
        // The creator's post sweeps it.
        app.call_as(BOB, |s| s.join("Bob".to_owned(), 1000))
            .unwrap();
        post(&mut app, BOB, b"bob", true, late).unwrap();
        assert_eq!(sender_stats(&mut app, ALICE).live_chunks, 0);
    }

    #[test]
    fn a_member_prunes_only_their_own_frames() {
        let mut app = with_mallory();
        let f = quant_aligned_frame(4, 4);
        app.call_as(ALICE, |s| s.encode_frame(f.clone(), 4, 4, 0, 1001))
            .unwrap();
        // `prune_frames(u64::MAX)` used to wipe every sender's frames.
        app.call_as_account(MALLORY_ACCOUNT, MALLORY, |s| s.prune_frames(u64::MAX))
            .unwrap();
        assert_eq!(app.view(|s| s.get_frame(0)).len(), 1);
        app.call_as(ALICE, |s| s.prune_frames(u64::MAX)).unwrap();
        assert!(app.view(|s| s.get_frame(0)).is_empty());
        assert_eq!(app.view(|s| s.get_stats()).pruned_frames, 1);
    }

    #[test]
    fn a_frame_planted_under_someone_elses_id_is_never_decoded() {
        let mut app = with_mallory();
        let f = quant_aligned_frame(4, 4);
        let seq = app
            .call_as(ALICE, |s| s.encode_frame(f.clone(), 4, 4, 0, 1001))
            .unwrap();
        let key = MeroStream::frag_key(&id_of(ALICE), seq, 0);
        assert!(app
            .call_as_account(MALLORY_ACCOUNT, MALLORY, |s| {
                s.fragments.modify(&key, |frag| frag.data = vec![255, 15])
            })
            .is_err());
        app.call_as_account(MALLORY_ACCOUNT, MALLORY, |s| {
            s.fragments.insert(
                MeroStream::frag_key(&id_of(ALICE), seq + 1, 0),
                super::Fragment {
                    seq: seq + 1,
                    from: id_of(ALICE),
                    track: 0,
                    chunk: 0,
                    chunks: 1,
                    width: 4,
                    height: 4,
                    codec: 1,
                    data: vec![16, 15],
                    created_at: 1002,
                },
            )
        })
        .unwrap();
        let frames = app.view(|s| s.get_frame(0));
        assert_eq!(frames.len(), 1);
        assert_eq!(frames[0].pixels, f);
    }

    #[test]
    fn a_device_row_belongs_to_the_account_that_joined_with_it() {
        let mut app = with_mallory();
        // Mallory cannot re-register Alice's device (to rename it, or to be
        // resolved as its account).
        assert!(app
            .call_as_account(MALLORY_ACCOUNT, ALICE, |s| s
                .join("Alice?".to_owned(), 2000))
            .is_err());
        // Keys are per owner: Mallory's key-only remove names her own row
        // under Alice's device, of which there is none.
        assert!(app
            .call_as_account(MALLORY_ACCOUNT, MALLORY, |s| {
                s.members.remove(&id_of(ALICE))
            })
            .unwrap()
            .is_none());
        // The admin check reads the owner stamp, from any account.
        assert!(app.view(|s| s.is_member_admin(id_of(ALICE))));
        assert!(!app.view(|s| s.is_member_admin(id_of(MALLORY))));
        assert!(app.call_as_account(MALLORY_ACCOUNT, MALLORY, |s| s
            .is_member_admin(id_of(ALICE))));
        assert_eq!(app.view(|s| s.get_stats()).name, "probe");

        // A patched node writing a row of Mallory's own under Alice's device
        // does not make the device Mallory's: a device two accounts claim
        // speaks for nobody, so Mallory can never post as Alice.
        app.call_as_account(MALLORY_ACCOUNT, MALLORY, |s| {
            s.members.insert(
                id_of(ALICE),
                super::Member {
                    member_id: id_of(ALICE),
                    username: "Alice?".to_owned(),
                    joined_at: 0,
                    updated_at: 0,
                },
            )
        })
        .unwrap();
        assert!(!app.view(|s| s.is_member_admin(id_of(ALICE))));
    }
}
