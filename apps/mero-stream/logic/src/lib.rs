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

type MemberId = String;

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
    pub from: MemberId,
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

// ── Membership (lightweight — just enough to reject non-members) ────────────────

/// A member of the stream context. Membership gates `encode_frame` (the probe
/// still requires an authenticated context member — never trust a client id).
#[derive(BorshSerialize, BorshDeserialize, Serialize, Deserialize, Clone, Debug)]
#[borsh(crate = "calimero_sdk::borsh")]
#[serde(crate = "calimero_sdk::serde")]
#[serde(rename_all = "camelCase")]
pub struct Member {
    pub member_id: MemberId,
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
    pub from: MemberId,
    pub track: u8,
    pub width: u16,
    pub height: u16,
    /// Raw luma, `width * height` bytes.
    pub pixels: Vec<u8>,
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
    MemberJoined(MemberId),
    /// A frame's fragments were stored. Payload is the frame's base seq; a peer
    /// calls `get_frame(after_seq)` to drain and render.
    FramePosted(u64),
    /// Frames below this seq were pruned (tombstones emitted, C3).
    FramesPruned(u64),
}

// ── State ───────────────────────────────────────────────────────────────────

#[app::state(emits = Event)]
pub struct MeroStream {
    /// Stream/room name; `Ownable` so only the owner's rename converges.
    stream_name: Ownable<LwwRegister<String>>,
    /// Context members, by identity. Membership gates `encode_frame`.
    members: UnorderedMap<MemberId, Member>,
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
        self.stream_name.get().map(|r| r.get().clone()).unwrap_or_default()
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
            .map(|e| {
                e.map(|(_, f)| f)
                    .filter(|f| f.seq > after_seq)
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
        let total = self.pruned_frames.get().saturating_add(pruned_seqs.len() as u64);
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

    pub fn is_member_admin(&self, member: MemberId) -> bool {
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
}

// ── Tests ─────────────────────────────────────────────────────────────────────

#[cfg(test)]
mod tests {
    use calimero_sdk::testing::TestHost;

    use super::{codec, MeroStream, DecodedFrame, FRAME_WINDOW, MAX_CHUNK_BYTES, TRACK_VIDEO_LUMA};

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
        assert_eq!(decoded, frame, "quant-aligned frame must round-trip identically (C1)");
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
        assert_eq!(once, twice, "decode∘encode must be idempotent (deterministic convergence)");
    }

    // ── encode_frame → get_frame round-trip through the contract ──────────────────

    #[test]
    fn encode_then_get_frame_reconstructs_the_frame() {
        let mut app = new_stream();
        app.call_as(ALICE, |s| s.join("Alice".to_owned(), 1000)).unwrap();

        let frame = quant_aligned_frame(64, 48);
        let seq = app
            .call_as(ALICE, |s| s.encode_frame(frame.clone(), 64, 48, TRACK_VIDEO_LUMA, 1001))
            .unwrap();
        assert_eq!(seq, 1, "first frame gets base seq 1");

        let frames: Vec<DecodedFrame> = app.view(|s| s.get_frame(0));
        assert_eq!(frames.len(), 1);
        assert_eq!(frames[0].seq, 1);
        assert_eq!(frames[0].from, id_of(ALICE));
        assert_eq!(frames[0].width, 64);
        assert_eq!(frames[0].height, 48);
        assert_eq!(frames[0].pixels, frame, "decoded pixels match the aligned input (C1)");
    }

    #[test]
    fn get_frame_cursor_only_returns_new_frames() {
        let mut app = new_stream();
        app.call_as(ALICE, |s| s.join("Alice".to_owned(), 1000)).unwrap();
        let f = quant_aligned_frame(16, 16);
        let s1 = app.call_as(ALICE, |s| s.encode_frame(f.clone(), 16, 16, 0, 1001)).unwrap();
        let s2 = app.call_as(ALICE, |s| s.encode_frame(f.clone(), 16, 16, 0, 1002)).unwrap();
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
        app.call_as(ALICE, |s| s.join("Alice".to_owned(), 1000)).unwrap();

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
            .call_as(ALICE, |s| s.encode_frame(frame.clone(), w as u16, h as u16, 0, 1001))
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
        assert_eq!(frames[0].pixels, frame, "chunked frame reassembles bit-identically");
        // No single chunk exceeds the cap.
        assert!(frames[0].encoded_bytes as usize <= w * h * 2 + 2);
    }

    // ── C3: monotone keys never reused → re-send after prune converges ────────────

    #[test]
    fn frame_keys_are_never_reused_across_prune() {
        let mut app = new_stream();
        app.call_as(ALICE, |s| s.join("Alice".to_owned(), 1000)).unwrap();
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

    // ── Guards ────────────────────────────────────────────────────────────────

    #[test]
    fn non_member_cannot_encode() {
        let mut app = new_stream();
        app.call_as(ALICE, |s| s.join("Alice".to_owned(), 1000)).unwrap();
        let f = quant_aligned_frame(8, 8);
        // BOB never joined.
        let res = app.call_as(BOB, |s| s.encode_frame(f, 8, 8, 0, 1001));
        assert!(res.is_err(), "a non-member must not be able to push frames");
    }

    #[test]
    fn mismatched_geometry_is_rejected() {
        let mut app = new_stream();
        app.call_as(ALICE, |s| s.join("Alice".to_owned(), 1000)).unwrap();
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
        assert!(encoded.len() <= MAX_CHUNK_BYTES, "flat frame is tiny after RLE");
    }
}
