//! Mero Stream: streaming media *over Calimero*, on core's component SDK
//! (`calimero-sdk`).
//!
//! ## What this contract is (and is NOT)
//!
//! A **capacity probe**, deliberately doing the *wrong* thing to learn the
//! platform's ceiling with numbers. Real calls ride WebRTC peer to peer and
//! never touch a contract (Mero Meet); this one pushes media through the app's
//! replicated log on purpose.
//!
//! Two of the probe's three transports live here:
//!
//! - **Approach 3** (`encodeFrame` / `getFrame`): the frontend hands the
//!   contract a *raw* luma frame; a toy integer codec compresses it **in the
//!   component** and stores only the compressed fragments. `getFrame`
//!   reconstructs frames in the component on any read.
//! - **Approach 2** (`postChunk` / `getChunks`): the browser encodes with
//!   WebCodecs and the contract stores the opaque access units in a per-sender
//!   ring, pruned by wall-clock window.
//!
//! Approach 1 (media over ephemeral presence) never reaches the contract: it is
//! the node's `/apps/{app}/presence` channel, used from the frontend.
//!
//! ## What changed from v1
//!
//! v1 ran this app on every node and merged replicas with CRDTs, which is where
//! most of the old file went: last-writer-wins tie breaks, `max`-merging
//! cursors, owner stamps (`Authored`, `Moderated`, `Ownable`) and readers that
//! re-checked who wrote each row. The component runtime applies every write in
//! one log on the cluster's leader, so the state is plain maps and every write
//! rule is a check in the method:
//!
//! - a sender's fragments, chunks and cursor are keyed by **the caller's
//!   account** (`env::caller()`), and no method takes a sender id, so nobody can
//!   write, prune or plant rows under someone else's name;
//! - the stream's owner is the app instance's owner (`env::app_owner()`, its
//!   creator, v1's sole admin): only they rename the stream and sweep a
//!   departed sender's buffer.
//!
//! Every client-visible change is listed in the app README.
//!
//! ## Constraints kept from v1
//!
//! - **C1 Determinism.** The codec is integer-only, so a decode returns the
//!   same bytes on every replica (`frameChecksum` makes that assertable).
//! - **C2 Small entries.** Every stored fragment stays far under the 1 MiB run
//!   cap: frames are split at [`MAX_CHUNK_BYTES`], opaque chunks capped at
//!   [`MAX_MEDIA_CHUNK_BYTES`].
//! - **C3 Keys are never reused.** Sequence numbers are monotone, so a pruned
//!   key is never written again. (There are no tombstones to shadow it any
//!   more; the rule stays because a reader's cursor is a sequence number.)
//! - **C4 Toy codec.** Quantize luma to 4 bits, run-length encode.

use base64::engine::general_purpose::STANDARD as BASE64;
use base64::Engine as _;
use calimero_sdk::prelude::*;
use calimero_sdk::StorageError;
use serde::{Deserialize, Serialize};

// ── Limits ──────────────────────────────────────────────────────────────────

/// Codec id stored on each fragment (C4 ladder). 1 = quantize-4bit + RLE.
const CODEC_QUANT_RLE: u8 = 1;

/// Track id for a video luma stream. Part of the documented wire vocabulary.
pub const TRACK_VIDEO_LUMA: u8 = 0;

/// C2: ceiling on one stored fragment's `data`. A frame whose encoded stream is
/// larger is split into several fragments (chunks).
pub const MAX_CHUNK_BYTES: usize = 16 * 1024;

/// C2: the largest raw frame, in luma bytes (256x256).
pub const MAX_RAW_BYTES: usize = 256 * 256;

/// The largest frame dimension.
pub const MAX_DIM: u16 = 256;

/// C3: how many of the most recent frames (by global seq) a sender keeps.
pub const FRAME_WINDOW: u64 = 30;

/// Approach 2: how long a sender's chunks stay live, in milliseconds. Time,
/// not a row count, so the window does not shrink as senders join.
pub const LIVE_WINDOW_MS: u64 = 6_000;

/// Hard ceiling on live chunks per sender, whatever the client's clock says.
pub const MAX_LIVE_CHUNKS_PER_SENDER: u64 = 600;

/// A sender silent for this long has their buffer swept by the stream's owner.
pub const STALE_SENDER_MS: u64 = 30_000;

/// The most chunks or fragments one call reaps.
pub const MAX_PRUNE_PER_CALL: u64 = 256;

/// Approach 2: the largest opaque chunk. 256 KiB of bytes is ~342 KiB of
/// base64, under the node's 512 KiB argument cap, and one chunk stays far
/// under the 1 MiB a run may write.
pub const MAX_MEDIA_CHUNK_BYTES: usize = 256 * 1024;

/// Rows per page when a method reads a whole collection (the SDK's maximum).
const PAGE: u32 = 1_000;

// ── Stored records ──────────────────────────────────────────────────────────

/// One compressed fragment of a frame. Keyed `(from, seq, chunk)`.
#[derive(Serialize, Deserialize, Clone, Debug)]
struct Fragment {
    track: u8,
    chunks: u16,
    width: u16,
    height: u16,
    codec: u8,
    /// Compressed bytes of this chunk of the frame: at most
    /// [`MAX_CHUNK_BYTES`], enforced by `encodeFrame`, which splits the
    /// encoded stream at that size (a frame is never more than 8 of these).
    #[serde(with = "calimero_sdk::json::bytes_auto")]
    data: Vec<u8>,
    /// The sender's capture clock, unix milliseconds.
    created_at: u64,
}

/// One opaque WebCodecs chunk. Keyed `(from, seq)`.
#[derive(Serialize, Deserialize, Clone, Debug)]
struct MediaChunk {
    track: u8,
    is_keyframe: bool,
    codec: String,
    width: u16,
    height: u16,
    timestamp_us: u64,
    /// The opaque access unit: at most [`MAX_MEDIA_CHUNK_BYTES`], enforced by
    /// `postChunk` (`ChunkTooLarge`). The only list in a stored value; the ring
    /// itself is the `chunks` map, one entry per chunk.
    #[serde(with = "calimero_sdk::json::bytes_auto")]
    data: Vec<u8>,
    created_at: u64,
}

/// Per-sender sequence, keyframe and pruning state. Keyed by the sender.
#[derive(Serialize, Deserialize, Clone, Debug, Default)]
struct ChunkCursor {
    /// Highest chunk seq this sender has minted. Never reused (C3).
    next_seq: u64,
    /// Lowest chunk seq of theirs still live.
    oldest_live: u64,
    /// Seq of their newest keyframe.
    last_keyframe: u64,
    /// `createdAt` of their newest chunk (drives the stale-sender sweep).
    newest_at: u64,
    /// How many of their chunks were reaped.
    pruned: u64,
    /// How many of their approach-3 frames they pruned.
    frames_pruned: u64,
}

/// A member's row. Keyed by account.
#[derive(Serialize, Deserialize, Clone, Debug)]
struct MemberRow {
    username: String,
    joined_at: u64,
    updated_at: u64,
}

// ── Answers ─────────────────────────────────────────────────────────────────
//
// camelCase on the wire; `u64` fields are decimal strings and bytes base64url
// (D20), as in every component app.

/// A member of the stream. `memberId` is the account.
#[derive(Serialize, Deserialize, Clone, Debug, PartialEq, Eq, AbiType)]
#[serde(rename_all = "camelCase")]
pub struct Member {
    pub member_id: String,
    pub username: String,
    #[serde(with = "calimero_sdk::json::u64_str")]
    pub joined_at: u64,
    #[serde(with = "calimero_sdk::json::u64_str")]
    pub updated_at: u64,
}

/// A frame reconstructed in the component. `pixels` is raw luma,
/// `width * height` bytes, base64url.
#[derive(Serialize, Deserialize, Clone, Debug, AbiType)]
#[serde(rename_all = "camelCase")]
pub struct DecodedFrame {
    #[serde(with = "calimero_sdk::json::u64_str")]
    pub seq: u64,
    pub from: String,
    pub track: u8,
    pub width: u16,
    pub height: u16,
    #[serde(with = "calimero_sdk::json::bytes_b64url")]
    pub pixels: Vec<u8>,
    #[serde(with = "calimero_sdk::json::u64_str")]
    pub created_at: u64,
    /// Summed compressed bytes of this frame's fragments.
    pub encoded_bytes: u32,
}

/// Approach-3 instrumentation.
#[derive(Serialize, Deserialize, Clone, Debug, AbiType)]
#[serde(rename_all = "camelCase")]
pub struct StreamStats {
    pub name: String,
    pub member_count: u32,
    /// Fragments (chunks) currently live.
    pub live_fragments: u32,
    /// Highest frame seq ever allocated.
    #[serde(with = "calimero_sdk::json::u64_str")]
    pub next_seq: u64,
    /// Lowest frame seq still live (0 when none is).
    #[serde(with = "calimero_sdk::json::u64_str")]
    pub oldest_live_seq: u64,
    /// Frames pruned so far, every sender.
    #[serde(with = "calimero_sdk::json::u64_str")]
    pub pruned_frames: u64,
}

/// One sender's read cursor: input to `getChunks`, output of `keyframeCursors`.
#[derive(Serialize, Deserialize, Clone, Debug, PartialEq, Eq, AbiType)]
#[serde(rename_all = "camelCase")]
pub struct SenderCursor {
    pub from: String,
    #[serde(with = "calimero_sdk::json::u64_str")]
    pub after_seq: u64,
}

/// What a peer needs to feed its decoder. `dataB64` is standard base64, as v1.
#[derive(Serialize, Deserialize, Clone, Debug, AbiType)]
#[serde(rename_all = "camelCase")]
pub struct ChunkView {
    #[serde(with = "calimero_sdk::json::u64_str")]
    pub seq: u64,
    pub from: String,
    pub track: u8,
    pub is_keyframe: bool,
    pub codec: String,
    pub width: u16,
    pub height: u16,
    #[serde(with = "calimero_sdk::json::u64_str")]
    pub timestamp_us: u64,
    pub data_b64: String,
    #[serde(with = "calimero_sdk::json::u64_str")]
    pub created_at: u64,
}

/// One sender's slice of [`LiveStats`].
#[derive(Serialize, Deserialize, Clone, Debug, AbiType)]
#[serde(rename_all = "camelCase")]
pub struct SenderStats {
    pub from: String,
    #[serde(with = "calimero_sdk::json::u64_str")]
    pub next_seq: u64,
    #[serde(with = "calimero_sdk::json::u64_str")]
    pub oldest_live: u64,
    #[serde(with = "calimero_sdk::json::u64_str")]
    pub last_keyframe: u64,
    #[serde(with = "calimero_sdk::json::u64_str")]
    pub newest_at: u64,
    #[serde(with = "calimero_sdk::json::u64_str")]
    pub pruned: u64,
    pub live_chunks: u32,
    #[serde(with = "calimero_sdk::json::u64_str")]
    pub live_bytes: u64,
}

/// Approach-2 instrumentation.
#[derive(Serialize, Deserialize, Clone, Debug, AbiType)]
#[serde(rename_all = "camelCase")]
pub struct LiveStats {
    pub live_chunks: u32,
    #[serde(with = "calimero_sdk::json::u64_str")]
    pub live_bytes: u64,
    #[serde(with = "calimero_sdk::json::u64_str")]
    pub pruned_chunks: u64,
    pub senders: Vec<SenderStats>,
}

// ── State ───────────────────────────────────────────────────────────────────

/// One stream room.
#[app::state(version = 1)]
pub struct MeroStream {
    /// The stream's display name.
    name: Cell<String>,
    /// account -> member row.
    members: UnorderedMap<String, MemberRow>,
    /// Approach 3: `(from, seq, chunk)` -> fragment. Tuple keys read in key
    /// order, so one sender's frames are one prefix read.
    fragments: UnorderedMap<(String, u64, u16), Fragment>,
    /// The global frame sequence.
    next_seq: Counter,
    /// Approach 2: `(from, seq)` -> opaque chunk.
    chunks: UnorderedMap<(String, u64), MediaChunk>,
    /// Approach 2: sender -> cursor.
    chunk_cursors: UnorderedMap<String, ChunkCursor>,
}

#[app::logic]
impl MeroStream {
    /// A new stream named `name` (`""` when not given; `renameStream` sets it
    /// later). The creator owns the app instance, which makes them the
    /// stream's owner.
    #[app::init]
    pub fn init(name: Option<String>) -> app::Result<Self> {
        let mut state = Self::load();
        state.name.set(&name.unwrap_or_default())?;
        env::emit(Event::Initialized, Audience::All)?;
        Ok(state)
    }

    // ── Membership ──────────────────────────────────────────────────────────

    /// Join the stream, or change your display name. Idempotent: `joinedAt`
    /// stays the first join's. Emits `MemberJoined { account }` every time.
    pub fn join(&mut self, username: String, now: u64) -> app::Result<Member> {
        let id = caller_account()?;
        let joined_at = self
            .members
            .get(&id)?
            .map_or(now, |existing| existing.joined_at);
        let row = MemberRow {
            username,
            joined_at,
            updated_at: now,
        };
        let _previous = self.members.insert(&id, &row)?;
        env::emit(
            Event::MemberJoined {
                account: id.clone(),
            },
            Audience::All,
        )?;
        Ok(member(id, row))
    }

    /// Every member, in account order.
    #[app::view]
    pub fn get_members(&self) -> app::Result<Vec<Member>> {
        Ok(read_all(|o| self.members.page(o))?
            .into_iter()
            .map(|(id, row)| member(id, row))
            .collect())
    }

    // ── Approach 3: the codec runs in the component ─────────────────────────

    /// Encode one raw luma frame in the component, split it into fragments of
    /// at most [`MAX_CHUNK_BYTES`], store them, prune the caller's frames
    /// older than [`FRAME_WINDOW`], and emit `FramePosted { seq }`. Returns the
    /// frame's seq.
    ///
    /// `raw` is `width * height` luma bytes (base64url on the wire). `now` is
    /// the capture time in unix milliseconds. `NotJoined` before `join`;
    /// `ZeroDimension`, `DimensionTooLarge`, `RawTooLarge`, `RawLengthMismatch`
    /// for a frame the codec does not take (a refused frame takes no seq).
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
            return Err(Error::ZeroDimension.into());
        }
        if width > MAX_DIM || height > MAX_DIM {
            return Err(Error::DimensionTooLarge { max: MAX_DIM }.into());
        }
        let expected = usize::from(width) * usize::from(height);
        if expected > MAX_RAW_BYTES {
            return Err(Error::RawTooLarge {
                max: MAX_RAW_BYTES as u32,
            }
            .into());
        }
        if raw.len() != expected {
            return Err(Error::RawLengthMismatch {
                expected: expected as u32,
                got: raw.len() as u32,
            }
            .into());
        }

        let encoded = codec::encode_quant_rle(&raw);
        let pieces: Vec<&[u8]> = if encoded.is_empty() {
            vec![&encoded[..]]
        } else {
            encoded.chunks(MAX_CHUNK_BYTES).collect()
        };
        // At most 256x256 pixels, at most two bytes each: 8 chunks.
        let count = pieces.len() as u16;

        let seq = self.next_seq.increment()?;
        for (i, piece) in pieces.into_iter().enumerate() {
            let _previous = self.fragments.insert(
                &(from.clone(), seq, i as u16),
                &Fragment {
                    track,
                    chunks: count,
                    width,
                    height,
                    codec: CODEC_QUANT_RLE,
                    data: piece.to_vec(),
                    created_at: now,
                },
            )?;
        }

        self.prune_own_frames(&from, seq.saturating_sub(FRAME_WINDOW))?;
        env::emit(Event::FramePosted { seq }, Audience::All)?;
        Ok(seq)
    }

    /// Every frame with `seq > afterSeq`, decoded in the component, oldest
    /// first (by seq, then sender). A frame missing a fragment is skipped.
    #[app::view]
    pub fn get_frame(&self, after_seq: u64) -> app::Result<Vec<DecodedFrame>> {
        let mut frags: Vec<((String, u64, u16), Fragment)> = read_all(|o| self.fragments.page(o))?
            .into_iter()
            .filter(|((_, seq, _), _)| *seq > after_seq)
            .collect();
        frags.sort_by(|(a, _), (b, _)| {
            a.1.cmp(&b.1)
                .then_with(|| a.0.cmp(&b.0))
                .then_with(|| a.2.cmp(&b.2))
        });

        let mut out = Vec::new();
        let mut i = 0;
        while i < frags.len() {
            let start = i;
            let (from, seq) = (frags[i].0 .0.clone(), frags[i].0 .1);
            while i < frags.len() && frags[i].0 .1 == seq && frags[i].0 .0 == from {
                i += 1;
            }
            let group = &frags[start..i];
            let first = &group[0].1;
            if group.len() != usize::from(first.chunks) {
                continue;
            }
            let encoded: Vec<u8> = group
                .iter()
                .flat_map(|(_, f)| f.data.iter().copied())
                .collect();
            let pixels = codec::decode_quant_rle(
                &encoded,
                usize::from(first.width) * usize::from(first.height),
            );
            out.push(DecodedFrame {
                seq,
                from,
                track: first.track,
                width: first.width,
                height: first.height,
                pixels,
                created_at: first.created_at,
                encoded_bytes: encoded.len() as u32,
            });
        }
        Ok(out)
    }

    /// FNV-1a 64 of frame `seq`'s decoded pixels, or `null` when no live,
    /// complete frame has that seq. Equal checksums mean equal pixels (C1).
    #[app::view]
    pub fn frame_checksum(&self, seq: u64) -> app::Result<Option<u64>> {
        Ok(self
            .get_frame(seq.saturating_sub(1))?
            .into_iter()
            .find(|f| f.seq == seq)
            .map(|f| codec::fnv1a64(&f.pixels)))
    }

    /// Remove the caller's own fragments of frames with `seq < beforeSeq`, at
    /// most [`MAX_PRUNE_PER_CALL`]. `NotJoined` before `join`.
    pub fn prune_frames(&mut self, before_seq: u64) -> app::Result<()> {
        let me = self.require_member()?;
        self.prune_own_frames(&me, before_seq)
    }

    /// Approach-3 instrumentation.
    #[app::view]
    pub fn get_stats(&self) -> app::Result<StreamStats> {
        let oldest = read_all(|o| self.fragments.page(o))?
            .into_iter()
            .map(|((_, seq, _), _)| seq)
            .min()
            .unwrap_or(0);
        let pruned = read_all(|o| self.chunk_cursors.page(o))?
            .into_iter()
            .fold(0u64, |n, (_, c)| n.saturating_add(c.frames_pruned));
        Ok(StreamStats {
            name: self.name.get()?.unwrap_or_default(),
            member_count: u32::try_from(self.members.len()?).unwrap_or(u32::MAX),
            live_fragments: u32::try_from(self.fragments.len()?).unwrap_or(u32::MAX),
            next_seq: self.next_seq.get()?,
            oldest_live_seq: oldest,
            pruned_frames: pruned,
        })
    }

    // ── Approach 2: opaque chunks from a real browser codec ─────────────────

    /// Store one WebCodecs chunk (`dataB64`, standard base64) as the caller's
    /// next seq, reap the caller's chunks older than [`LIVE_WINDOW_MS`] (never
    /// their newest keyframe), and, for the stream's owner, sweep senders
    /// silent for [`STALE_SENDER_MS`]. Emits `ChunkPosted { seq }`; returns the
    /// seq. `now` is unix milliseconds.
    ///
    /// `NotJoined`, `BadBase64`, `EmptyChunk`, `ChunkTooLarge`,
    /// `CodecRequired`.
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
            .map_err(|_| AppError::from(Error::BadBase64))?;
        if data.is_empty() {
            return Err(Error::EmptyChunk.into());
        }
        if data.len() > MAX_MEDIA_CHUNK_BYTES {
            return Err(Error::ChunkTooLarge {
                max: MAX_MEDIA_CHUNK_BYTES as u32,
            }
            .into());
        }
        if codec.is_empty() {
            return Err(Error::CodecRequired.into());
        }

        let mut cursor = self.chunk_cursors.get(&from)?.unwrap_or_default();
        let seq = cursor.next_seq.saturating_add(1);
        cursor.next_seq = seq;
        if is_keyframe {
            cursor.last_keyframe = seq;
        }
        cursor.newest_at = cursor.newest_at.max(now);
        if cursor.oldest_live == 0 {
            cursor.oldest_live = seq;
        }
        let _previous = self.chunks.insert(
            &(from.clone(), seq),
            &MediaChunk {
                track,
                is_keyframe,
                codec,
                width,
                height,
                timestamp_us,
                data,
                created_at: now,
            },
        )?;
        let _previous = self.chunk_cursors.insert(&from, &cursor)?;

        self.prune_own_chunks(&from, now)?;
        self.sweep_stale_senders(&from, now)?;
        env::emit(Event::ChunkPosted { seq }, Audience::All)?;
        Ok(seq)
    }

    /// Every live chunk past the caller's per-sender cursors, grouped by
    /// sender (account order), ascending within each. A sender missing from
    /// `cursors` starts at their newest live keyframe, and is left out while
    /// they have none.
    #[app::view]
    pub fn get_chunks(&self, cursors: Vec<SenderCursor>) -> app::Result<Vec<ChunkView>> {
        let mut out = Vec::new();
        for (from, cursor) in read_all(|o| self.chunk_cursors.page(o))? {
            let start = match cursors.iter().find(|k| k.from == from) {
                Some(k) => k.after_seq.saturating_add(1),
                None => match self.live_keyframe_of(&from, &cursor)? {
                    0 => continue,
                    floor => floor,
                },
            };
            for (seq, c) in self.sender_chunks(&from, start)? {
                out.push(ChunkView {
                    seq,
                    from: from.clone(),
                    track: c.track,
                    is_keyframe: c.is_keyframe,
                    codec: c.codec,
                    width: c.width,
                    height: c.height,
                    timestamp_us: c.timestamp_us,
                    data_b64: BASE64.encode(&c.data),
                    created_at: c.created_at,
                });
            }
        }
        Ok(out)
    }

    /// Each sender's newest live keyframe, in account order.
    #[app::view]
    pub fn keyframe_cursors(&self) -> app::Result<Vec<SenderCursor>> {
        let mut out = Vec::new();
        for (from, cursor) in read_all(|o| self.chunk_cursors.page(o))? {
            let seq = self.live_keyframe_of(&from, &cursor)?;
            if seq != 0 {
                out.push(SenderCursor {
                    from,
                    after_seq: seq,
                });
            }
        }
        Ok(out)
    }

    /// Approach-2 instrumentation, per sender in account order.
    #[app::view]
    pub fn get_live_stats(&self) -> app::Result<LiveStats> {
        let mut senders = Vec::new();
        for (from, cur) in read_all(|o| self.chunk_cursors.page(o))? {
            // A cursor that only ever counted approach-3 frames has no chunks.
            if cur.next_seq == 0 {
                continue;
            }
            let live = self.sender_chunks(&from, 0)?;
            senders.push(SenderStats {
                live_chunks: live.len() as u32,
                live_bytes: live
                    .iter()
                    .fold(0u64, |n, (_, c)| n.saturating_add(c.data.len() as u64)),
                from,
                next_seq: cur.next_seq,
                oldest_live: cur.oldest_live,
                last_keyframe: cur.last_keyframe,
                newest_at: cur.newest_at,
                pruned: cur.pruned,
            });
        }
        Ok(LiveStats {
            live_chunks: senders.iter().map(|s| s.live_chunks).sum(),
            live_bytes: senders.iter().map(|s| s.live_bytes).sum(),
            pruned_chunks: senders.iter().map(|s| s.pruned).sum(),
            senders,
        })
    }

    /// Prune the caller's own chunks below `beforeSeq`, never past their
    /// newest keyframe, at most [`MAX_PRUNE_PER_CALL`]. `NotJoined`.
    pub fn prune_chunks(&mut self, before_seq: u64) -> app::Result<()> {
        let me = self.require_member()?;
        let Some(mut cursor) = self.chunk_cursors.get(&me)? else {
            return Ok(());
        };
        let clamped = if cursor.last_keyframe == 0 {
            before_seq
        } else {
            before_seq.min(cursor.last_keyframe)
        };
        if clamped == 0 {
            return Ok(());
        }
        let doomed: Vec<u64> = self
            .sender_chunks_between(&me, cursor.oldest_live.max(1), clamped)?
            .into_iter()
            .map(|(seq, _)| seq)
            .collect();
        let mut removed = 0u64;
        let mut reached = clamped;
        for seq in doomed {
            if removed == MAX_PRUNE_PER_CALL {
                reached = seq;
                break;
            }
            if self.chunks.remove(&(me.clone(), seq))?.is_some() {
                removed += 1;
            }
        }
        if reached > cursor.oldest_live {
            cursor.oldest_live = reached;
        }
        cursor.pruned = cursor.pruned.saturating_add(removed);
        let _previous = self.chunk_cursors.insert(&me, &cursor)?;
        Ok(())
    }

    // ── Admin ───────────────────────────────────────────────────────────────

    /// Rename the stream. The stream's owner only (`NotOwner`).
    pub fn rename_stream(&mut self, name: String) -> app::Result<()> {
        if caller_account()? != env::app_owner() {
            return Err(Error::NotOwner.into());
        }
        self.name.set(&name)?;
        Ok(())
    }

    /// Whether `member` (an account) is the stream's admin: its owner.
    #[app::view]
    pub fn is_member_admin(&self, member: String) -> app::Result<bool> {
        Ok(!member.is_empty() && member == env::app_owner())
    }

    // ── internals ───────────────────────────────────────────────────────────

    fn require_member(&self) -> app::Result<String> {
        let id = caller_account()?;
        if !self.members.contains(&id)? {
            return Err(Error::NotJoined.into());
        }
        Ok(id)
    }

    /// `from`'s chunks with `seq >= from_seq`, oldest first.
    fn sender_chunks(&self, from: &str, from_seq: u64) -> app::Result<Vec<(u64, MediaChunk)>> {
        self.sender_chunks_between(from, from_seq, u64::MAX)
    }

    /// `from`'s chunks with `from_seq <= seq < to_seq`, oldest first.
    fn sender_chunks_between(
        &self,
        from: &str,
        from_seq: u64,
        to_seq: u64,
    ) -> app::Result<Vec<(u64, MediaChunk)>> {
        let prefix = [from.to_key_part()];
        let rows = read_all(|o| {
            self.chunks.prefix(
                &prefix,
                o.from(vec![from_seq.to_key_part()])
                    .to(vec![to_seq.to_key_part()]),
            )
        })?;
        Ok(rows.into_iter().map(|((_, seq), c)| (seq, c)).collect())
    }

    /// The sender's newest keyframe seq while it is still live, else 0.
    fn live_keyframe_of(&self, from: &str, cursor: &ChunkCursor) -> app::Result<u64> {
        let seq = cursor.last_keyframe;
        if seq == 0 || !self.chunks.contains(&(from.to_owned(), seq))? {
            return Ok(0);
        }
        Ok(seq)
    }

    /// Age out the caller's own trailing chunks: older than the live window,
    /// never on or past their newest keyframe unless the count backstop
    /// ([`MAX_LIVE_CHUNKS_PER_SENDER`]) demands it. Every seq visited counts
    /// against [`MAX_PRUNE_PER_CALL`], holes included.
    fn prune_own_chunks(&mut self, from: &str, now: u64) -> app::Result<()> {
        let key = from.to_owned();
        let Some(mut cursor) = self.chunk_cursors.get(&key)? else {
            return Ok(());
        };
        let cutoff = now.saturating_sub(LIVE_WINDOW_MS);
        let count_floor = cursor
            .next_seq
            .saturating_sub(MAX_LIVE_CHUNKS_PER_SENDER)
            .saturating_add(1);

        let mut removed = 0u64;
        let mut steps = 0u64;
        let mut seq = cursor.oldest_live.max(1);
        while seq < cursor.next_seq && steps < MAX_PRUNE_PER_CALL {
            steps += 1;
            let over_count = seq < count_floor;
            if !over_count && cursor.last_keyframe != 0 && seq >= cursor.last_keyframe {
                break;
            }
            let too_old = match self.chunks.get(&(key.clone(), seq))? {
                Some(c) => c.created_at < cutoff,
                None => {
                    seq += 1;
                    continue;
                }
            };
            if !(too_old || over_count) {
                break;
            }
            if self.chunks.remove(&(key.clone(), seq))?.is_some() {
                removed += 1;
            }
            seq += 1;
        }

        if removed > 0 || seq > cursor.oldest_live {
            cursor.oldest_live = seq;
            cursor.pruned = cursor.pruned.saturating_add(removed);
            let _previous = self.chunk_cursors.insert(&key, &cursor)?;
        }
        Ok(())
    }

    /// Collect the buffer of every sender silent for [`STALE_SENDER_MS`]. Only
    /// when the caller is the stream's owner (v1's moderator); at most
    /// [`MAX_PRUNE_PER_CALL`] chunks per call. The departed sender's cursor is
    /// left as it is.
    fn sweep_stale_senders(&mut self, me: &str, now: u64) -> app::Result<()> {
        if me != env::app_owner() {
            return Ok(());
        }
        let cutoff = now.saturating_sub(STALE_SENDER_MS);
        let stale: Vec<String> = read_all(|o| self.chunk_cursors.page(o))?
            .into_iter()
            .filter(|(from, cur)| from != me && cur.newest_at < cutoff && cur.next_seq != 0)
            .map(|(from, _)| from)
            .collect();

        let mut budget = MAX_PRUNE_PER_CALL;
        for from in stale {
            let prefix = [from.to_key_part()];
            let page = self.chunks.prefix(
                &prefix,
                FindOpts::default().limit(u32::try_from(budget).unwrap_or(PAGE)),
            )?;
            for ((_, seq), _) in page.items {
                if self.chunks.remove(&(from.clone(), seq))?.is_some() {
                    budget -= 1;
                }
            }
            if budget == 0 {
                break;
            }
        }
        Ok(())
    }

    /// Remove `from`'s own fragments of frames below `before_seq`, at most
    /// [`MAX_PRUNE_PER_CALL`]; count the frames and emit `FramesPruned`.
    fn prune_own_frames(&mut self, from: &str, before_seq: u64) -> app::Result<()> {
        if before_seq == 0 {
            return Ok(());
        }
        let prefix = [from.to_key_part()];
        let doomed = self
            .fragments
            .prefix(
                &prefix,
                FindOpts::default()
                    .limit(MAX_PRUNE_PER_CALL as u32)
                    .to(vec![before_seq.to_key_part()]),
            )?
            .items;
        let mut pruned_seqs: Vec<u64> = Vec::new();
        for (key, _) in doomed {
            let seq = key.1;
            if self.fragments.remove(&key)?.is_some() && !pruned_seqs.contains(&seq) {
                pruned_seqs.push(seq);
            }
        }
        if pruned_seqs.is_empty() {
            return Ok(());
        }
        let key = from.to_owned();
        let mut cursor = self.chunk_cursors.get(&key)?.unwrap_or_default();
        cursor.frames_pruned = cursor
            .frames_pruned
            .saturating_add(pruned_seqs.len() as u64);
        let _previous = self.chunk_cursors.insert(&key, &cursor)?;
        env::emit(Event::FramesPruned { before_seq }, Audience::All)?;
        Ok(())
    }
}

/// A typed refusal: `422 APP_ERROR` with `{ code, fields }`. Each replaces one
/// of v1's `app::bail!` messages (listed in the README).
#[app::error]
pub enum Error {
    /// The caller has not called `join` (v1: "join the stream before this operation").
    NotJoined,
    /// A frame dimension is zero.
    ZeroDimension,
    /// A frame dimension is over `max`.
    DimensionTooLarge { max: u16 },
    /// `width * height` is over `max` luma bytes.
    RawTooLarge { max: u32 },
    /// `raw` is not `width * height` bytes.
    RawLengthMismatch { expected: u32, got: u32 },
    /// `dataB64` is not standard base64.
    BadBase64,
    /// The chunk has no bytes.
    EmptyChunk,
    /// The chunk is over `max` bytes; lower the bitrate or resolution.
    ChunkTooLarge { max: u32 },
    /// A chunk needs its codec string (the decoder is configured with it).
    CodecRequired,
    /// Only the stream's owner may do this.
    NotOwner,
}

/// Nudges: each means "read again". Every field is named (D63), so the data is
/// `{"account": ...}` / `{"seq": ...}` on the wire (u64s as decimal strings).
#[app::event]
pub enum Event {
    /// The stream was created.
    Initialized,
    /// An account joined (or renamed itself).
    MemberJoined { account: String },
    /// A frame was stored; its seq.
    FramePosted { seq: u64 },
    /// Frames below this seq were pruned.
    FramesPruned { before_seq: u64 },
    /// An approach-2 chunk was stored; its seq.
    ChunkPosted { seq: u64 },
}

// ── free helpers ────────────────────────────────────────────────────────────

/// The account the caller acts for; `LoginRequired` for anyone else.
fn caller_account() -> app::Result<String> {
    match env::caller() {
        Caller::Account(account) | Caller::ApiKey { account, .. } => Ok(account),
        Caller::Public | Caller::System | Caller::App(_) => Err(AppError::login_required()),
    }
}

fn member(member_id: String, row: MemberRow) -> Member {
    Member {
        member_id,
        username: row.username,
        joined_at: row.joined_at,
        updated_at: row.updated_at,
    }
}

/// Every row a paged read returns, page after page.
fn read_all<T>(
    mut read: impl FnMut(FindOpts) -> Result<Page<T>, StorageError>,
) -> Result<Vec<T>, StorageError> {
    let mut out = Vec::new();
    let mut opts = FindOpts::default().limit(PAGE);
    loop {
        let page = read(opts.clone())?;
        out.extend(page.items);
        match page.next {
            Some(next) => opts = FindOpts::default().limit(PAGE).cursor(next),
            None => return Ok(out),
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

// ── Codec unit tests (pure functions; the contract is tested on the engine in tests/) ──

#[cfg(test)]
mod tests {
    use super::codec;

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
}
