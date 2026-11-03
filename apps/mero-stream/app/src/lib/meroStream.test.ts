import { describe, expect, it, vi } from "vitest";
import abiText from "../../../logic/res/abi.json?raw";
import { fromBase64Url, meroStream, METHODS, toBase64Url } from "./meroStream";

interface Abi {
  methods: Record<string, { kind: string; params: [string, string][] }>;
}
const abi = JSON.parse(abiText) as Abi;

describe("the typed client matches the committed ABI", () => {
  it("covers every method but init, with the ABI's parameter names in order", () => {
    const fromAbi = Object.fromEntries(
      Object.entries(abi.methods)
        .filter(([, m]) => m.kind !== "init")
        .map(([name, m]) => [name, m.params.map(([p]) => p)]),
    );
    expect(METHODS).toEqual(fromAbi);
  });
});

function fake(results: Record<string, unknown>) {
  return {
    call: vi.fn(async (_app: string, method: string) => ({
      index: 3,
      result: results[method] ?? null,
      events: [],
    })),
    view: vi.fn(async (_app: string, method: string) => ({
      index: 3,
      result: results[method] ?? null,
    })),
  };
}

describe("meroStream: wire shapes back to the screens' shapes", () => {
  it("sends u64s as decimal strings and raw luma as base64url", async () => {
    const client = fake({ encodeFrame: "7" });
    const after = vi.fn();
    const s = meroStream(client, "room-1", after);
    const seq = await s.encodeFrame([0, 17, 255], 3, 1, 0, 1751955010000.7);
    expect(seq).toBe(7);
    expect(client.call).toHaveBeenCalledWith("room-1", "encodeFrame", {
      raw: toBase64Url([0, 17, 255]),
      width: 3,
      height: 1,
      track: 0,
      now: "1751955010000",
    });
    expect(after).toHaveBeenCalled();
  });

  it("decodes frames: decimal strings to numbers, base64url pixels to bytes", async () => {
    const client = fake({
      getFrame: [
        {
          seq: "4",
          from: "acct",
          track: 0,
          width: 2,
          height: 1,
          pixels: toBase64Url([255, 0]),
          createdAt: "1751955010000",
          encodedBytes: 4,
        },
      ],
    });
    const frames = await meroStream(client, "r").getFrame(3);
    expect(client.view).toHaveBeenCalledWith("r", "getFrame", { afterSeq: "3" });
    expect(frames).toEqual([
      {
        seq: 4,
        from: "acct",
        track: 0,
        width: 2,
        height: 1,
        pixels: [255, 0],
        createdAt: 1751955010000,
        encodedBytes: 4,
      },
    ]);
  });

  it("decodes members, stats, chunks, cursors and live stats", async () => {
    const client = fake({
      getMembers: [{ memberId: "a", username: "A", joinedAt: "1", updatedAt: "2" }],
      getStats: {
        name: "n",
        memberCount: 1,
        liveFragments: 2,
        nextSeq: "3",
        oldestLiveSeq: "1",
        prunedFrames: "0",
      },
      getChunks: [
        {
          seq: "1",
          from: "a",
          track: 0,
          isKeyframe: true,
          codec: "avc1.42001f",
          width: 640,
          height: 480,
          timestampUs: "33333",
          dataB64: "AAAAAWf//oA=",
          createdAt: "5",
        },
      ],
      keyframeCursors: [{ from: "a", afterSeq: "1" }],
      getLiveStats: {
        liveChunks: 1,
        liveBytes: "8",
        prunedChunks: "0",
        senders: [
          {
            from: "a",
            nextSeq: "1",
            oldestLive: "1",
            lastKeyframe: "1",
            newestAt: "5",
            pruned: "0",
            liveChunks: 1,
            liveBytes: "8",
          },
        ],
      },
    });
    const s = meroStream(client, "r");
    expect(await s.getMembers()).toEqual([
      { memberId: "a", username: "A", joinedAt: 1, updatedAt: 2 },
    ]);
    expect((await s.getStats()).nextSeq).toBe(3);
    const [c] = await s.getChunks([{ from: "a", afterSeq: 0 }]);
    expect(client.view).toHaveBeenCalledWith("r", "getChunks", {
      cursors: [{ from: "a", afterSeq: "0" }],
    });
    expect(c.timestampUs).toBe(33333);
    expect(c.dataB64).toBe("AAAAAWf//oA=");
    expect(await s.keyframeCursors()).toEqual([{ from: "a", afterSeq: 1 }]);
    const live = await s.getLiveStats();
    expect(live.liveBytes).toBe(8);
    expect(live.senders[0].lastKeyframe).toBe(1);
  });

  it("keeps the checksum a string: a u64 does not fit a JS number", async () => {
    const client = fake({ frameChecksum: "18446744073709551557" });
    expect(await meroStream(client, "r").frameChecksum(1)).toBe("18446744073709551557");
  });

  it("round-trips base64url", () => {
    const bytes = Uint8Array.from({ length: 300 }, (_, i) => (i * 37) % 256);
    expect(fromBase64Url(toBase64Url(bytes))).toEqual(bytes);
    expect(toBase64Url([251, 255])).toBe("-_8");
  });
});
