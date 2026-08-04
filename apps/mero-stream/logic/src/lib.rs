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

use std::str::FromStr;

use base64::engine::general_purpose::STANDARD as BASE64;
use base64::Engine as _;
use calimero_sdk::borsh::{BorshDeserialize, BorshSerialize};
use calimero_sdk::serde::{Deserialize, Serialize};
use calimero_sdk::{app, env as sdk_env, PublicKey};
use calimero_storage::address::Id;
use calimero_storage::collections::crdt_meta::MergeError;
use calimero_storage::collections::rekey::RekeyTarget;
use calimero_storage::collections::{
    AccessControl, LwwRegister, Mergeable as MergeableTrait, Ownable, UnorderedMap,
};

// ── Types ───────────────────────────────────────────────────────────────────

// A member id is the executor's public key, bs58-encoded — i.e. a plain `String`,
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

/// Approach 2: how many of the most recent opaque chunks to keep live.
///
/// Larger than FRAME_WINDOW because a real codec emits several chunks per second
/// per track and the window must comfortably span the keyframe interval — if the
/// window is shorter than the gap between keyframes, the reaper's keyframe clamp
/// ends up pinning nearly everything and the window stops bounding anything.
const CHUNK_WINDOW: u64 = 120;

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

/// One compressed media fragment produced by the in-WASM encoder. A frame with
/// an encoded stream over `MAX_CHUNK_BYTES` is split across several `Fragment`s
/// sharing one `seq` (the frame's base seq), distinguished by `chunk`.
///
/// `data` is the ONLY field that meaningfully crosses the wire — the raw input
/// never leaves the sender (C1/approach-3 property).
#[derive(BorshSerialize, BorshDeserialize, Serialize, Deserialize, Clone, Debug)]
#[borsh(crate = "calimero_sdk::borsh")]
#[serde(crate = "calimero_sdk::serde")]
#[serde(rename_all = "camelCase")]
pub struct Fragment {
    /// Global monotone frame sequence; key `frag-{seq}-{chunk}`, NEVER reused (C3).
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
        if other.created_at > self.created_at {
            *self = other.clone();
        }
        Ok(())
    }
}

// Flat record (no nested collections) → re-key is a no-op; the impl exists only
// to satisfy the `Mergeable: RekeyTarget` supertrait bound.
impl RekeyTarget for Fragment {
    fn rekey_relative_to(&mut self, _parent_id: Id) {}
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
#[derive(BorshSerialize, BorshDeserialize, Serialize, Deserialize, Clone, Debug)]
#[borsh(crate = "calimero_sdk::borsh")]
#[serde(crate = "calimero_sdk::serde")]
#[serde(rename_all = "camelCase")]
pub struct MediaChunk {
    /// Global monotone sequence; key `chunk-{seq}`, NEVER reused (C3).
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
        if other.created_at > self.created_at {
            *self = other.clone();
        }
        Ok(())
    }
}

impl RekeyTarget for MediaChunk {
    fn rekey_relative_to(&mut self, _parent_id: Id) {}
}

/// Read model for the receive side: what a peer needs to drive its decoder.
#[derive(Serialize, Deserialize, Clone, Debug)]
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
#[derive(Serialize, Deserialize, Clone, Debug)]
#[serde(crate = "calimero_sdk::serde")]
#[serde(rename_all = "camelCase")]
pub struct LiveStats {
    pub live_chunks: u32,
    pub next_chunk_seq: u64,
    pub oldest_live_chunk: u64,
    pub pruned_chunks: u64,
    pub last_keyframe_seq: u64,
    /// Summed `data` bytes currently live — the real "how much state is this
    /// stream holding" figure.
    pub live_bytes: u64,
}

// ── Membership (lightweight — just enough to reject non-members) ────────────────

/// A member of the stream context. Membership gates `encode_frame` (the probe
/// still requires an authenticated context member — never trust a client id).
#[derive(BorshSerialize, BorshDeserialize, Serialize, Deserialize, Clone, Debug)]
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
        if other.updated_at > self.updated_at {
            *self = other.clone();
        }
        Ok(())
    }
}

impl RekeyTarget for Member {
    fn rekey_relative_to(&mut self, _parent_id: Id) {}
}

// ── Views (read-model returned to the frontend) ────────────────────────────────

/// A frame reconstructed in-WASM by the decoder. `pixels` is raw luma
/// (1 byte/pixel, row-major, `width * height` long) — the frontend paints it to
/// a canvas. This is the second half of "decode straight from WASM logic".
#[derive(Serialize, Deserialize, Clone, Debug)]
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
#[derive(Serialize, Deserialize, Clone, Debug)]
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
    stream_name: Ownable<LwwRegister<String>>,
    /// Context members, by identity. Membership gates `encode_frame`.
    members: UnorderedMap<String, Member>,
    /// The media buffer. Keyed `frag-{seq}-{chunk}`; all chunks of a frame share
    /// `seq`. Pruned to a rolling `FRAME_WINDOW` of the most recent frames.
    fragments: UnorderedMap<String, Fragment>,
    /// Global monotone frame sequence. LwwRegister: two senders may mint the
    /// same base seq concurrently — that is fine here because fragment keys also
    /// embed the chunk and each frame stands alone (no cross-frame diff in codec
    /// #1). A colliding base seq merely groups two senders' chunks under one
    /// frame id; `from` disambiguates on read.
    next_seq: LwwRegister<u64>,
    /// Lowest frame seq we still retain — advanced by pruning. Together with
    /// `next_seq` this bounds the live window and reports tombstone pressure.
    oldest_live_seq: LwwRegister<u64>,
    /// Count of frames pruned so far (a proxy for tombstone accumulation, C3).
    pruned_frames: LwwRegister<u64>,
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
    /// Opaque encoded chunks, keyed `chunk-{seq}`.
    chunks: UnorderedMap<String, MediaChunk>,
    /// Global monotone chunk sequence. Never reused (C3).
    next_chunk_seq: LwwRegister<u64>,
    /// Lowest chunk seq still retained.
    oldest_live_chunk: LwwRegister<u64>,
    /// Chunks pruned so far (tombstone pressure).
    pruned_chunks: LwwRegister<u64>,
    /// Seq of the newest keyframe we have accepted.
    ///
    /// Load-bearing for pruning, not bookkeeping. A delta frame is meaningless
    /// without the keyframe it refs, so the reaper must never prune past the
    /// newest keyframe — do that and a peer joining mid-stream (or any peer that
    /// fell behind) has nothing decodable to start from and shows a grey canvas
    /// until the *next* keyframe, which may be seconds away.
    last_keyframe_seq: LwwRegister<u64>,
}

// ── Logic ─────────────────────────────────────────────────────────────────────

#[app::logic]
impl MeroStream {
    #[app::init]
    pub fn init(name: String) -> MeroStream {
        let me = Self::caller();
        let mut stream_name = Ownable::new_owned_by(me);
        let _ = stream_name.insert(LwwRegister::new(name));
        MeroStream {
            stream_name,
            members: UnorderedMap::new(),
            fragments: UnorderedMap::new(),
            next_seq: LwwRegister::new(0),
            oldest_live_seq: LwwRegister::new(0),
            pruned_frames: LwwRegister::new(0),
            roles: AccessControl::new(me),
            chunks: UnorderedMap::new(),
            next_chunk_seq: LwwRegister::new(0),
            oldest_live_chunk: LwwRegister::new(0),
            pruned_chunks: LwwRegister::new(0),
            last_keyframe_seq: LwwRegister::new(0),
        }
    }

    // ── Identity helpers ───────────────────────────────────────────────────────

    /// The real signer of this invocation. Never trust a client-supplied id.
    fn caller() -> PublicKey {
        sdk_env::executor_id().into()
    }

    fn caller_id() -> String {
        String::from(Self::caller())
    }

    fn parse_pk(value: &str) -> app::Result<PublicKey> {
        PublicKey::from_str(value).map_err(|_| app::err!("invalid member public key"))
    }

    fn stream_name_str(&self) -> String {
        self.stream_name
            .get()
            .map(|r| r.get().clone())
            .unwrap_or_default()
    }

    fn require_member(&self) -> app::Result<String> {
        let id = Self::caller_id();
        if self.members.get(&id)?.is_none() {
            app::bail!("join the stream before this operation");
        }
        Ok(id)
    }

    // ── Membership ───────────────────────────────────────────────────────────

    /// Join the stream context. Idempotent (re-join updates the display name).
    pub fn join(&mut self, username: String, now: u64) -> app::Result<Member> {
        let id = Self::caller_id();
        // Read the prior row into an owned local, then drop the borrow before
        // the mutating insert (mirrors mero-meet's join). `joined_at` is
        // immutable after first join.
        let existing = self.members.get(&id)?;
        let joined_at = existing.as_ref().map(|m| m.joined_at).unwrap_or(now);
        drop(existing);
        let member = Member {
            member_id: id.clone(),
            username,
            joined_at,
            updated_at: now,
        };
        self.members.insert(id.clone(), member.clone())?;
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
    /// keys, prune the live window, and emit `FramePosted(base_seq)`.
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
            self.fragments.insert(Self::frag_key(seq, i as u16), frag)?;
        }

        self.prune_frames_internal(seq);
        app::emit!(Event::FramePosted(seq));
        Ok(seq)
    }

    /// Fragment storage key. Monotone `seq` + `chunk` → globally unique and NEVER
    /// reused, so a re-send after a prune lands on a fresh key and converges
    /// (C3: a reused key would be permanently shadowed by the prune's tombstone).
    fn frag_key(seq: u64, chunk: u16) -> String {
        format!("frag-{}-{}", seq, chunk)
    }

    // ── Decode (view — reconstructs frames in WASM) ──────────────────────────────

    /// Reassemble + decode every frame with `seq > after_seq`, oldest first.
    /// Read-only (no delta). The frontend tracks the highest seq it has rendered
    /// and passes it back. Frames whose chunks are not all present yet are
    /// skipped (a partially-gossiped frame is not decodable).
    pub fn get_frame(&self, after_seq: u64) -> Vec<DecodedFrame> {
        // Collect live fragments above the cursor, grouped by (seq, from).
        let mut frags: Vec<Fragment> = self
            .fragments
            .entries()
            .map(|e| e.map(|(_, f)| f).filter(|f| f.seq > after_seq).collect())
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

        let seq = self.next_chunk_seq.get().saturating_add(1);
        self.next_chunk_seq.set(seq);
        if is_keyframe {
            self.last_keyframe_seq.set(seq);
        }

        let chunk = MediaChunk {
            seq,
            from,
            track,
            is_keyframe,
            codec,
            width,
            height,
            timestamp_us,
            data,
            created_at: now,
        };
        self.chunks.insert(Self::chunk_key(seq), chunk)?;

        self.prune_chunks_internal(seq);
        app::emit!(Event::ChunkPosted(seq));
        Ok(seq)
    }

    /// Chunk storage key. Monotone and NEVER reused (C3).
    fn chunk_key(seq: u64) -> String {
        format!("chunk-{}", seq)
    }

    /// Every live chunk with `seq > after_seq`, oldest first (view, no delta).
    ///
    /// The peer passes back the highest seq it has fed its decoder. Returns
    /// base64 so the JSON transport stays ~1.37x rather than ~3x.
    pub fn get_chunks(&self, after_seq: u64) -> Vec<ChunkView> {
        let mut out: Vec<ChunkView> = self
            .chunks
            .entries()
            .map(|e| {
                e.map(|(_, c)| c)
                    .filter(|c| c.seq > after_seq)
                    .map(|c| ChunkView {
                        seq: c.seq,
                        from: c.from.clone(),
                        track: c.track,
                        is_keyframe: c.is_keyframe,
                        codec: c.codec.clone(),
                        width: c.width,
                        height: c.height,
                        timestamp_us: c.timestamp_us,
                        data_b64: BASE64.encode(&c.data),
                        created_at: c.created_at,
                    })
                    .collect()
            })
            .unwrap_or_default();
        // Decoders are order-sensitive: a delta frame fed before its reference
        // produces garbage or throws.
        out.sort_by_key(|c| c.seq);
        out
    }

    /// The newest keyframe still live, or `None`.
    ///
    /// A peer joining mid-stream calls this first: feeding a decoder a delta
    /// frame with no preceding keyframe cannot produce a picture, so the join
    /// path is "find the keyframe, start there", not "start at whatever is
    /// newest".
    pub fn keyframe_cursor(&self) -> Option<u64> {
        let seq = *self.last_keyframe_seq.get();
        if seq == 0 {
            return None;
        }
        // Confirm it is still live rather than trusting the register — the
        // reaper protects it, but a peer that has not synced yet may legitimately
        // not hold it.
        match self.chunks.get(&Self::chunk_key(seq)) {
            Ok(Some(_)) => Some(seq),
            _ => None,
        }
    }

    pub fn get_live_stats(&self) -> LiveStats {
        let live_bytes = self
            .chunks
            .entries()
            .map(|e| e.map(|(_, c)| c.data.len() as u64).sum::<u64>())
            .unwrap_or(0);
        LiveStats {
            live_chunks: self.chunks.len().unwrap_or(0) as u32,
            next_chunk_seq: *self.next_chunk_seq.get(),
            oldest_live_chunk: *self.oldest_live_chunk.get(),
            pruned_chunks: *self.pruned_chunks.get(),
            last_keyframe_seq: *self.last_keyframe_seq.get(),
            live_bytes,
        }
    }

    /// Keyframe-safe reaper. Keeps a rolling window, but **never prunes the
    /// newest keyframe or anything after it**.
    ///
    /// Without that clamp the window boundary eventually lands past the last
    /// keyframe and every remaining chunk is a delta with no reference — the
    /// stream is live, replicating, and undecodable, which is the worst failure
    /// mode available because nothing looks broken from the sender's side.
    fn prune_chunks_internal(&mut self, latest_seq: u64) {
        let window_floor = latest_seq.saturating_sub(CHUNK_WINDOW);
        let keyframe = *self.last_keyframe_seq.get();
        // Never step past the newest keyframe.
        let threshold = if keyframe == 0 {
            window_floor
        } else {
            window_floor.min(keyframe)
        };
        if threshold > *self.oldest_live_chunk.get() {
            self.prune_chunks_below(threshold);
        }
    }

    /// Explicit reaper (membership-gated). Still honours the keyframe clamp —
    /// an operator cannot ask for an undecodable stream.
    pub fn prune_chunks(&mut self, before_seq: u64) -> app::Result<()> {
        self.require_member()?;
        let keyframe = *self.last_keyframe_seq.get();
        let clamped = if keyframe == 0 {
            before_seq
        } else {
            before_seq.min(keyframe)
        };
        self.prune_chunks_below(clamped);
        Ok(())
    }

    /// Remove every chunk with `seq < before_seq`. Each removal is a replicated
    /// tombstone (C3) — the cost this whole task exists to measure.
    fn prune_chunks_below(&mut self, before_seq: u64) {
        if before_seq == 0 {
            return;
        }
        let start = *self.oldest_live_chunk.get().max(&1);
        let mut removed = 0u64;
        for seq in start..before_seq {
            if self
                .chunks
                .remove(&Self::chunk_key(seq))
                .unwrap_or(None)
                .is_some()
            {
                removed += 1;
            }
        }
        if removed > 0 {
            let total = self.pruned_chunks.get().saturating_add(removed);
            self.pruned_chunks.set(total);
        }
        if before_seq > *self.oldest_live_chunk.get() {
            self.oldest_live_chunk.set(before_seq);
        }
    }

    // ── Prune (explicit reaper; every removal is a tombstone — C3) ────────────────

    /// Remove all fragments belonging to frames with `seq < before_seq`.
    /// Callable explicitly (an experiment may drive it) and also inline after
    /// every `encode_frame`. Requires membership.
    pub fn prune_frames(&mut self, before_seq: u64) -> app::Result<()> {
        self.require_member()?;
        self.prune_below(before_seq);
        Ok(())
    }

    /// Keep only the most recent `FRAME_WINDOW` frames relative to `latest_seq`.
    fn prune_frames_internal(&mut self, latest_seq: u64) {
        let threshold = latest_seq.saturating_sub(FRAME_WINDOW);
        if threshold > *self.oldest_live_seq.get() {
            self.prune_below(threshold);
        }
    }

    /// Remove every fragment whose frame seq is `< before_seq`. Each removal is a
    /// replicated tombstone (C3) — that cost is exactly what Task 3 measures.
    fn prune_below(&mut self, before_seq: u64) {
        if before_seq == 0 {
            return;
        }
        let doomed: Vec<String> = self
            .fragments
            .entries()
            .map(|e| {
                e.map(|(k, f)| (k, f.seq))
                    .filter(|(_, seq)| *seq < before_seq)
                    .map(|(k, _)| k)
                    .collect()
            })
            .unwrap_or_default();
        if doomed.is_empty() {
            return;
        }
        // Count distinct pruned frame seqs for the stats counter.
        let mut pruned_seqs: Vec<u64> = Vec::new();
        for key in &doomed {
            if let Ok(Some(f)) = self.fragments.get(key) {
                if !pruned_seqs.contains(&f.seq) {
                    pruned_seqs.push(f.seq);
                }
            }
        }
        for key in doomed {
            let _ = self.fragments.remove(&key);
        }
        self.oldest_live_seq.set(before_seq);
        let total = self
            .pruned_frames
            .get()
            .saturating_add(pruned_seqs.len() as u64);
        self.pruned_frames.set(total);
        app::emit!(Event::FramesPruned(before_seq));
    }

    // ── Instrumentation ──────────────────────────────────────────────────────

    pub fn get_stats(&self) -> StreamStats {
        StreamStats {
            name: self.stream_name_str(),
            member_count: self.members.len().unwrap_or(0) as u32,
            live_fragments: self.fragments.len().unwrap_or(0) as u32,
            next_seq: *self.next_seq.get(),
            oldest_live_seq: *self.oldest_live_seq.get(),
            pruned_frames: *self.pruned_frames.get(),
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

    pub fn is_member_admin(&self, member: String) -> bool {
        match Self::parse_pk(&member) {
            Ok(pk) => self.roles.is_admin(&pk),
            Err(_) => false,
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
        codec, DecodedFrame, MeroStream, BASE64, CHUNK_WINDOW, FRAME_WINDOW, MAX_CHUNK_BYTES,
        MAX_DIM, MAX_MEDIA_CHUNK_BYTES, TRACK_VIDEO_LUMA,
    };
    use base64::Engine as _;
    use calimero_sdk::app;

    const ALICE: [u8; 32] = [0x11; 32];
    const BOB: [u8; 32] = [0x22; 32];

    fn id_of(bytes: [u8; 32]) -> String {
        bs58::encode(bytes).into_string()
    }

    fn new_stream() -> TestHost<MeroStream> {
        TestHost::new(|| MeroStream::init("probe".to_owned()))
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

        let got = app.view(|s| s.get_chunks(seq - 1));
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
            .view(|s| s.get_chunks(0))
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

        // One keyframe, then far more deltas than CHUNK_WINDOW.
        let kf = post(&mut app, ALICE, b"keyframe", true, 1000).unwrap();
        for k in 0..(CHUNK_WINDOW + 50) {
            post(&mut app, ALICE, b"delta", false, 1001 + k).unwrap();
        }

        let stats = app.view(|s| s.get_live_stats());
        assert_eq!(stats.last_keyframe_seq, kf);
        // The window wanted to prune well past `kf`; the clamp held it back.
        assert!(
            stats.oldest_live_chunk <= kf,
            "window advanced past the keyframe: oldest={} kf={}",
            stats.oldest_live_chunk,
            kf
        );
        // And the keyframe is genuinely still readable, so a joiner can start.
        assert_eq!(app.view(|s| s.keyframe_cursor()), Some(kf));
        assert!(app
            .view(|s| s.get_chunks(kf - 1))
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
        for k in 0..10 {
            post(&mut app, ALICE, b"delta", false, 1001 + k).unwrap();
        }
        // A second keyframe, then enough traffic to push the window past kf1.
        let second_kf = post(&mut app, ALICE, b"kf2", true, 2000).unwrap();
        for k in 0..(CHUNK_WINDOW + 20) {
            post(&mut app, ALICE, b"delta", false, 2001 + k).unwrap();
        }

        let stats = app.view(|s| s.get_live_stats());
        assert_eq!(stats.last_keyframe_seq, second_kf);
        assert!(
            stats.oldest_live_chunk > first_kf,
            "the superseded keyframe should have been released (oldest={} first_kf={})",
            stats.oldest_live_chunk,
            first_kf
        );
        assert!(stats.pruned_chunks > 0);
        // The CURRENT keyframe still survives — a joiner is never left stranded.
        assert_eq!(app.view(|s| s.keyframe_cursor()), Some(second_kf));
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
            app.view(|s| s.keyframe_cursor()),
            Some(kf),
            "even prune(everything) must leave the keyframe"
        );
    }

    #[test]
    fn keyframe_cursor_is_none_before_any_keyframe() {
        // A joiner must be able to tell "nothing decodable yet" from "start here",
        // including the case where only delta frames have been posted.
        let mut app = new_stream();
        app.call_as(ALICE, |s| s.join("Alice".to_owned(), 1000))
            .unwrap();
        assert_eq!(app.view(|s| s.keyframe_cursor()), None);
        post(&mut app, ALICE, b"delta-only", false, 1000).unwrap();
        assert_eq!(app.view(|s| s.keyframe_cursor()), None);
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
        // None of the rejects may consume a seq.
        assert_eq!(app.view(|s| s.get_live_stats()).next_chunk_seq, 0);
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
        assert_eq!(
            (fresh.live_chunks, fresh.live_bytes, fresh.next_chunk_seq),
            (0, 0, 0)
        );

        post(&mut app, ALICE, &[1u8; 100], true, 1000).unwrap();
        post(&mut app, ALICE, &[2u8; 250], false, 1001).unwrap();
        let stats = app.view(|s| s.get_live_stats());
        assert_eq!(stats.live_chunks, 2);
        assert_eq!(
            stats.live_bytes, 350,
            "live_bytes is the real state footprint"
        );
        assert_eq!(stats.next_chunk_seq, 2);
        assert_eq!(stats.last_keyframe_seq, 1);
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

        let all = app.view(|s| s.get_chunks(0));
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
        assert_eq!(app.view(|s| s.get_live_stats()).next_chunk_seq, 1);
        assert_eq!(app.view(|s| s.get_frame(0)).len(), 1);
        assert_eq!(app.view(|s| s.get_chunks(0)).len(), 1);
    }

    #[test]
    fn a_non_member_cannot_rename_the_stream() {
        let mut app = new_stream();
        app.call_as(ALICE, |s| s.join("Alice".to_owned(), 1000))
            .unwrap();
        assert!(app
            .call_as(BOB, |s| s.rename_stream("hijacked".to_owned()))
            .is_err());
        assert_eq!(app.view(|s| s.get_stats()).name, "probe");
    }
}
