import type {
  ChunkView,
  DecodedFrame,
  LiveStats,
  Member,
  SenderCursor,
  SenderStats,
  StreamStats,
} from "../types";
import type {
  ChunkView as WireChunk,
  DecodedFrame as WireFrame,
  LiveStats as WireLiveStats,
  Member as WireMember,
  SenderCursor as WireCursor,
  SenderStats as WireSenderStats,
  StreamStats as WireStats,
} from "../generated/client";

/** The package a production instance is created from. */
export const PACKAGE = "com.calimero.mero-stream";

// The contract is called through `MeroStreamClient`, which `meroctl app
// codegen` writes from logic/res/abi.json (`src/generated/client.ts`): u64
// arguments as decimal strings (`u64`), bytes as base64url (`toBase64Url`).
// The ABI describes its records, so the generated client types each answer;
// the `to*` conversions below turn them back into the shapes the screens were
// written against.

// ── Wire shapes (D20: u64 as a decimal string, bytes as base64url) ───────────
//
// The contract's records, as the generated client types them from the ABI.

type U64 = string;

// ── Conversions ──────────────────────────────────────────────────────────────

/** A decimal-string u64 as a number. Every value here is far below 2^53. */
export const num = (v: U64 | number | null | undefined): number =>
  v === null || v === undefined ? 0 : Number(v);

/** A whole millisecond (or second) count as the decimal string a u64 takes. */
export const u64 = (v: number): U64 => String(Math.max(0, Math.floor(v)));

export function toBase64Url(bytes: ArrayLike<number>): string {
  let bin = "";
  const arr = Uint8Array.from(bytes);
  for (let i = 0; i < arr.length; i += 0x8000) {
    bin += String.fromCharCode(...arr.subarray(i, i + 0x8000));
  }
  return btoa(bin).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

export function fromBase64Url(text: string): Uint8Array {
  const b64 = text.replace(/-/g, "+").replace(/_/g, "/");
  const bin = atob(b64 + "===".slice((b64.length + 3) % 4));
  const out = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
  return out;
}

const member = (m: WireMember): Member => ({
  memberId: m.memberId,
  username: m.username,
  joinedAt: num(m.joinedAt),
  updatedAt: num(m.updatedAt),
});

const frame = (f: WireFrame): DecodedFrame => ({
  seq: num(f.seq),
  from: f.from,
  track: f.track,
  width: f.width,
  height: f.height,
  pixels: Array.from(fromBase64Url(f.pixels)),
  createdAt: num(f.createdAt),
  encodedBytes: f.encodedBytes,
});

const stats = (s: WireStats): StreamStats => ({
  name: s.name,
  memberCount: s.memberCount,
  liveFragments: s.liveFragments,
  nextSeq: num(s.nextSeq),
  oldestLiveSeq: num(s.oldestLiveSeq),
  prunedFrames: num(s.prunedFrames),
});

const chunk = (c: WireChunk): ChunkView => ({
  seq: num(c.seq),
  from: c.from,
  track: c.track,
  isKeyframe: c.isKeyframe,
  codec: c.codec,
  width: c.width,
  height: c.height,
  timestampUs: num(c.timestampUs),
  dataB64: c.dataB64,
  createdAt: num(c.createdAt),
});

const sender = (s: WireSenderStats): SenderStats => ({
  from: s.from,
  nextSeq: num(s.nextSeq),
  oldestLive: num(s.oldestLive),
  lastKeyframe: num(s.lastKeyframe),
  newestAt: num(s.newestAt),
  pruned: num(s.pruned),
  liveChunks: s.liveChunks,
  liveBytes: num(s.liveBytes),
});

const liveStats = (s: WireLiveStats): LiveStats => ({
  liveChunks: s.liveChunks,
  liveBytes: num(s.liveBytes),
  prunedChunks: num(s.prunedChunks),
  senders: s.senders.map(sender),
});

// ── Answers, in the screens' shapes ──────────────────────────────────────────

/** `join`'s answer. */
export const toMember = (v: WireMember): Member => member(v);
/** `getMembers`'s answer. */
export const toMembers = (v: WireMember[]): Member[] => v.map(member);
/** `getFrame`'s answer: `pixels` as a byte array. */
export const toFrames = (v: WireFrame[]): DecodedFrame[] => v.map(frame);
/** `getStats`'s answer. */
export const toStats = (v: WireStats): StreamStats => stats(v);
/** `getChunks`'s answer. */
export const toChunks = (v: WireChunk[]): ChunkView[] => v.map(chunk);
/** `keyframeCursors`'s answer. */
export const toCursors = (v: WireCursor[]): SenderCursor[] =>
  v.map((k) => ({ from: k.from, afterSeq: num(k.afterSeq) }));
/** `getLiveStats`'s answer. */
export const toLiveStats = (v: WireLiveStats): LiveStats => liveStats(v);
/** `getChunks`'s argument: each cursor's sequence as a u64. */
export const wireCursors = (cursors: SenderCursor[]): WireCursor[] =>
  cursors.map((k) => ({ from: k.from, afterSeq: u64(k.afterSeq) }));

export interface ChunkInput {
  dataB64: string;
  track: number;
  isKeyframe: boolean;
  codec: string;
  width: number;
  height: number;
  timestampUs: number;
}
