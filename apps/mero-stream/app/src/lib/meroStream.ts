import type { CalimeroClient } from "@calimero-network/mero-js";
import type {
  ChunkView,
  DecodedFrame,
  LiveStats,
  Member,
  SenderCursor,
  SenderStats,
  StreamStats,
} from "../types";

/** The package a production instance is created from. */
export const PACKAGE = "com.calimero.mero-stream";

/**
 * Every contract method this client calls, with its parameters in ABI order.
 * meroStream.test.ts asserts this is exactly the committed `res/abi.json`.
 */
export const METHODS: Record<string, readonly string[]> = {
  join: ["username", "now"],
  getMembers: [],
  encodeFrame: ["raw", "width", "height", "track", "now"],
  getFrame: ["afterSeq"],
  frameChecksum: ["seq"],
  pruneFrames: ["beforeSeq"],
  getStats: [],
  postChunk: [
    "dataB64",
    "track",
    "isKeyframe",
    "codec",
    "width",
    "height",
    "timestampUs",
    "now",
  ],
  getChunks: ["cursors"],
  keyframeCursors: [],
  getLiveStats: [],
  pruneChunks: ["beforeSeq"],
  renameStream: ["name"],
  isMemberAdmin: ["member"],
};

// ── Wire shapes (D20: u64 as a decimal string, bytes as base64url) ───────────

type U64 = string;

interface WireMember {
  memberId: string;
  username: string;
  joinedAt: U64;
  updatedAt: U64;
}

interface WireFrame {
  seq: U64;
  from: string;
  track: number;
  width: number;
  height: number;
  pixels: string;
  createdAt: U64;
  encodedBytes: number;
}

interface WireStats {
  name: string;
  memberCount: number;
  liveFragments: number;
  nextSeq: U64;
  oldestLiveSeq: U64;
  prunedFrames: U64;
}

interface WireChunk {
  seq: U64;
  from: string;
  track: number;
  isKeyframe: boolean;
  codec: string;
  width: number;
  height: number;
  timestampUs: U64;
  dataB64: string;
  createdAt: U64;
}

interface WireCursor {
  from: string;
  afterSeq: U64;
}

interface WireSenderStats {
  from: string;
  nextSeq: U64;
  oldestLive: U64;
  lastKeyframe: U64;
  newestAt: U64;
  pruned: U64;
  liveChunks: number;
  liveBytes: U64;
}

interface WireLiveStats {
  liveChunks: number;
  liveBytes: U64;
  prunedChunks: U64;
  senders: WireSenderStats[];
}

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

// ── The client ───────────────────────────────────────────────────────────────

export type StreamClient = Pick<CalimeroClient, "call" | "view">;

export interface ChunkInput {
  dataB64: string;
  track: number;
  isKeyframe: boolean;
  codec: string;
  width: number;
  height: number;
  timestampUs: number;
}

/**
 * The contract, bound to one room (an app instance), in v1's shapes: numbers
 * where the wire has decimal strings, `pixels` as a byte array. `after` runs
 * after each request (keeps the stored session current).
 */
export function meroStream(client: StreamClient, app: string, after: () => void = () => {}) {
  const call = async <T>(method: string, args: Record<string, unknown>): Promise<T> => {
    try {
      return (await client.call(app, method, args)).result as T;
    } finally {
      after();
    }
  };
  const view = async <T>(method: string, args: Record<string, unknown>): Promise<T> => {
    try {
      return (await client.view(app, method, args)).result as T;
    } finally {
      after();
    }
  };

  return {
    join: async (username: string, nowSecs: number) =>
      member(await call<WireMember>("join", { username, now: u64(nowSecs) })),
    getMembers: async () => (await view<WireMember[]>("getMembers", {})).map(member),

    encodeFrame: async (
      raw: ArrayLike<number>,
      width: number,
      height: number,
      track: number,
      nowMs: number,
    ) =>
      num(
        await call<U64>("encodeFrame", {
          raw: toBase64Url(raw),
          width,
          height,
          track,
          now: u64(nowMs),
        }),
      ),
    getFrame: async (afterSeq: number) =>
      (await view<WireFrame[]>("getFrame", { afterSeq: u64(afterSeq) })).map(frame),
    /** FNV-1a 64 of a frame's pixels, a decimal string (it does not fit a JS number), or null. */
    frameChecksum: (seq: number) => view<U64 | null>("frameChecksum", { seq: u64(seq) }),
    pruneFrames: async (beforeSeq: number) => {
      await call<null>("pruneFrames", { beforeSeq: u64(beforeSeq) });
    },
    getStats: async () => stats(await view<WireStats>("getStats", {})),

    postChunk: async (c: ChunkInput, nowMs: number) =>
      num(
        await call<U64>("postChunk", {
          dataB64: c.dataB64,
          track: c.track,
          isKeyframe: c.isKeyframe,
          codec: c.codec,
          width: c.width,
          height: c.height,
          timestampUs: u64(c.timestampUs),
          now: u64(nowMs),
        }),
      ),
    getChunks: async (cursors: SenderCursor[]) =>
      (
        await view<WireChunk[]>("getChunks", {
          cursors: cursors.map((k) => ({ from: k.from, afterSeq: u64(k.afterSeq) })),
        })
      ).map(chunk),
    keyframeCursors: async (): Promise<SenderCursor[]> =>
      (await view<WireCursor[]>("keyframeCursors", {})).map((k) => ({
        from: k.from,
        afterSeq: num(k.afterSeq),
      })),
    getLiveStats: async () => liveStats(await view<WireLiveStats>("getLiveStats", {})),
    pruneChunks: async (beforeSeq: number) => {
      await call<null>("pruneChunks", { beforeSeq: u64(beforeSeq) });
    },

    renameStream: async (name: string) => {
      await call<null>("renameStream", { name });
    },
    isMemberAdmin: (memberId: string) => view<boolean>("isMemberAdmin", { member: memberId }),
  };
}

export type MeroStreamClient = ReturnType<typeof meroStream>;
