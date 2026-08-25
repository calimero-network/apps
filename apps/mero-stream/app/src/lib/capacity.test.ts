import { describe, expect, it } from "vitest";
import {
  GOSSIPSUB_MESH_N,
  KEYFRAME_COST_RATIO,
  MIN_ADAPTIVE_BITRATE,
  MIN_ADAPTIVE_FPS,
  adaptiveEncoding,
  adaptiveFps,
  dutyCycle,
  pressure,
  sendBudget,
  upstreamBitsPerSecond,
} from "./capacity";
import { maxPayloadBytes } from "./ephemeralFrames";

const DEFAULTS = {
  fps: 25,
  bitrate: 1_500_000,
  keyframeIntervalMs: 2000,
  fragmentPayloadBytes: maxPayloadBytes("avc1.42001f"),
};

describe("sendBudget", () => {
  it("splits the interval's bytes between one keyframe and the deltas", () => {
    const b = sendBudget(DEFAULTS);
    // 1.5 Mbps over 2 s = 375 KB, shared by 49 deltas + 1 keyframe at 8x
    // (25 fps x 2 s = 50 frames per interval).
    const total = 49 * b.deltaBytes + b.keyframeBytes;
    expect(total).toBeCloseTo((1_500_000 / 8) * 2, 0);
    expect(b.keyframeBytes / b.deltaBytes).toBeCloseTo(KEYFRAME_COST_RATIO, 6);
  });

  it("puts a delta in one fragment and a keyframe in several", () => {
    const b = sendBudget(DEFAULTS);
    expect(b.deltaFragments).toBe(1);
    expect(b.keyframeFragments).toBeGreaterThan(1);
  });

  it("lands the documented ~26.5 slices/s at the shipped defaults", () => {
    // The figure the plan's send-budget table is built on. Asserted so a change
    // to fps / bitrate / keyframe cadence cannot silently invalidate it.
    const b = sendBudget(DEFAULTS);
    expect(b.slicesPerSecond).toBeGreaterThan(25);
    expect(b.slicesPerSecond).toBeLessThan(28);
  });

  it("derives a publish-RTT ceiling from the SERIAL send loop", () => {
    const b = sendBudget(DEFAULTS);
    // ~26.5 slices/s -> ~38 ms per publish and no more.
    expect(b.maxSustainableRttMs).toBeCloseTo(1000 / b.slicesPerSecond, 6);
    expect(b.maxSustainableRttMs).toBeGreaterThan(35);
    expect(b.maxSustainableRttMs).toBeLessThan(41);
  });

  it("charges more slices for more frames at the SAME bitrate", () => {
    // The point of the fixed-bitrate design: raising fps buys smoothness at the
    // same byte rate. It is not free, though — each frame is its own publish, so
    // the serial send loop pays for it.
    const slow = sendBudget({ ...DEFAULTS, fps: 10 });
    const fast = sendBudget({ ...DEFAULTS, fps: 30 });
    expect(fast.slicesPerSecond).toBeGreaterThan(slow.slicesPerSecond);
    expect(fast.deltaBytes).toBeLessThan(slow.deltaBytes);
  });

  it("fragments a delta frame too once the bitrate is high enough", () => {
    const b = sendBudget({ ...DEFAULTS, bitrate: 40_000_000 });
    expect(b.deltaFragments).toBeGreaterThan(1);
  });

  it("still sends one slice for a frame with no bytes", () => {
    // Dropping it would publish nothing, emit no event, and skip a msgSeq —
    // which the probe reads as a lost frame.
    const b = sendBudget({ ...DEFAULTS, bitrate: 0 });
    expect(b.deltaFragments).toBe(1);
    expect(b.keyframeFragments).toBe(1);
    // 50 frames per 2 s interval, one slice each.
    expect(b.slicesPerSecond).toBeCloseTo(25, 6);
  });

  it("survives nonsense inputs instead of returning NaN", () => {
    const b = sendBudget({
      fps: 0,
      bitrate: -1,
      keyframeIntervalMs: 0,
      fragmentPayloadBytes: 0,
    });
    expect(Number.isFinite(b.deltaBytes)).toBe(true);
    expect(b.keyframeFragments).toBe(Number.POSITIVE_INFINITY);
  });
});

describe("dutyCycle", () => {
  const b = sendBudget(DEFAULTS);

  it("is a small fraction on a local node and saturated on a slow one", () => {
    expect(dutyCycle(b, 5)).toBeLessThan(0.2); // localhost
    expect(dutyCycle(b, 15)).toBeLessThan(0.5); // LAN
    expect(dutyCycle(b, b.maxSustainableRttMs)).toBeCloseTo(1, 6);
    expect(dutyCycle(b, 80)).toBeGreaterThan(1); // hopeless
  });

  it("treats a missing measurement as zero rather than NaN", () => {
    expect(dutyCycle(b, Number.NaN)).toBe(0);
    expect(dutyCycle(b, -1)).toBe(0);
  });
});

describe("upstreamBitsPerSecond", () => {
  const bitrate = 1_500_000;
  const mbps = (v: number) => v / 1_000_000;

  it("a 1:1 call costs a single stream's worth", () => {
    // The cheapest cell in the table, and the case verified working across two
    // networks: no forwarding at all, because there is only one peer.
    expect(
      mbps(
        upstreamBitsPerSecond({
          participants: 2,
          broadcasters: 2,
          bitrate,
          broadcasting: true,
        }),
      ),
    ).toBeCloseTo(1.5, 6);
  });

  it("matches the documented table at N=5 and N=6 with 4 broadcasters", () => {
    const at = (participants: number, broadcasting: boolean) =>
      mbps(
        upstreamBitsPerSecond({
          participants,
          broadcasters: 4,
          bitrate,
          broadcasting,
        }),
      );
    expect(at(5, true)).toBeCloseTo(19.5, 6);
    expect(at(5, false)).toBeCloseTo(18, 6);
    expect(at(6, true)).toBeCloseTo(21, 6);
    expect(at(6, false)).toBeCloseTo(18, 6);
  });

  it("stops charging MORE for forwarding once N exceeds the mesh target", () => {
    // The non-obvious half of the budget: mesh_n caps the forwarding term, so
    // adding spectators is flat. Only a broadcaster's own flood-publish grows.
    const spectator = (participants: number) =>
      upstreamBitsPerSecond({
        participants,
        broadcasters: 4,
        bitrate,
        broadcasting: false,
      });
    expect(spectator(GOSSIPSUB_MESH_N + 1)).toBe(spectator(50));
  });

  it("charges a broadcaster linearly in participants", () => {
    const cost = (participants: number) =>
      upstreamBitsPerSecond({
        participants,
        broadcasters: 4,
        bitrate,
        broadcasting: true,
      });
    expect(cost(20) - cost(19)).toBeCloseTo(bitrate, 6);
  });

  it("does not double-charge us for our own stream", () => {
    // `others` excludes us: we flood-publish our own frames, we never forward
    // them back.
    const alone = upstreamBitsPerSecond({
      participants: 4,
      broadcasters: 1,
      bitrate,
      broadcasting: true,
    });
    expect(mbps(alone)).toBeCloseTo(4.5, 6); // 3 peers, no forwarding
  });

  it("charges a pure spectator nothing when nobody is broadcasting", () => {
    expect(
      upstreamBitsPerSecond({
        participants: 6,
        broadcasters: 0,
        bitrate,
        broadcasting: false,
      }),
    ).toBe(0);
  });
});

describe("pressure", () => {
  it("flags a tight budget before it is actually over", () => {
    // The send loop shares the main thread with the encoder and every decoder,
    // so 70% spent waiting already stutters.
    expect(pressure(0.2)).toBe("ok");
    expect(pressure(0.7)).toBe("tight");
    expect(pressure(1)).toBe("over");
    expect(pressure(2.5)).toBe("over");
  });
});

describe("adaptiveFps", () => {
  it("gives a solo broadcaster the whole budget", () => {
    expect(adaptiveFps(25, 1)).toBe(25);
  });

  it("halves the rate for two, which is the measured fix", () => {
    // Two authors at 25 fps each measured 43% delivery; two at ~13 put the same
    // ~26.5 slices/s on the wire as the one-author case that measured 96%.
    expect(adaptiveFps(25, 2)).toBe(13);
  });

  it("keeps the AGGREGATE slice rate roughly constant", () => {
    // The whole point: the transport's loss tracks aggregate rate, not
    // head-count. Within rounding, N x adaptiveFps(base, N) should stay at base.
    for (const n of [1, 2]) {
      const aggregate = n * adaptiveFps(25, n);
      expect(aggregate).toBeGreaterThanOrEqual(25);
      expect(aggregate).toBeLessThanOrEqual(28);
    }
  });

  it("floors at a rate that still reads as motion", () => {
    // Below ~10 fps video is a slideshow, so dividing further is pointless —
    // that is where the broadcaster CAP takes over from the rate.
    expect(adaptiveFps(25, 10)).toBe(MIN_ADAPTIVE_FPS);
    expect(adaptiveFps(25, 100)).toBe(MIN_ADAPTIVE_FPS);
  });

  it("never raises a rate that is already below the floor", () => {
    // Someone who deliberately set 5 fps must not be pushed up to 10.
    expect(adaptiveFps(5, 1)).toBe(5);
    expect(adaptiveFps(5, 4)).toBe(5);
    expect(adaptiveFps(8, 3)).toBe(8);
  });

  it("treats zero or negative broadcasters as one", () => {
    // The occupancy readout is briefly 0 before our own claim lands, and
    // dividing by it would be a crash or an Infinity on screen.
    expect(adaptiveFps(25, 0)).toBe(25);
    expect(adaptiveFps(25, -3)).toBe(25);
  });

  it("is monotone: more broadcasters never means a higher rate", () => {
    let prev = Infinity;
    for (let n = 1; n <= 8; n++) {
      const f = adaptiveFps(25, n);
      expect(f).toBeLessThanOrEqual(prev);
      prev = f;
    }
  });
});

describe("adaptiveEncoding", () => {
  const BASE = { fps: 25, bitrate: 1_500_000 };

  it("gives a solo broadcaster the whole budget", () => {
    expect(adaptiveEncoding(BASE, 1)).toEqual(BASE);
  });

  it("divides BOTH knobs for two, not just the frame rate", () => {
    // Dividing fps alone leaves a fixed bitrate over fewer frames, so each frame
    // grows: the keyframe went from ~53 KB (4 fragments) to ~101 KB (7), and a
    // 7-fragment keyframe loses a fragment far more readily. Halving the bitrate
    // too keeps the frame — and the fragment count — the same shape as solo.
    // NOTE: this reduces load; it does NOT recover delivery. See capacity.ts.
    const two = adaptiveEncoding(BASE, 2);
    expect(two.fps).toBe(13);
    expect(two.bitrate).toBe(750_000);
  });

  it("keeps the fragment shape stable as broadcasters are added", () => {
    // The actual property that matters. Same delta-fragment count and a keyframe
    // that does not balloon, whether one person is live or two.
    const payload = maxPayloadBytes("avc1.42001f");
    const solo = sendBudget({
      ...adaptiveEncoding(BASE, 1),
      keyframeIntervalMs: 2000,
      fragmentPayloadBytes: payload,
    });
    const duo = sendBudget({
      ...adaptiveEncoding(BASE, 2),
      keyframeIntervalMs: 2000,
      fragmentPayloadBytes: payload,
    });
    expect(duo.deltaFragments).toBe(solo.deltaFragments);
    expect(duo.keyframeFragments).toBeLessThanOrEqual(solo.keyframeFragments);
  });

  // Kept even though sharing was measured NOT to recover delivery: the load
  // reduction is the reason it still ships, so it is the thing worth asserting.
  it("roughly halves the aggregate slice rate per broadcaster", () => {
    const payload = maxPayloadBytes("avc1.42001f");
    const rate = (n: number) =>
      sendBudget({
        ...adaptiveEncoding(BASE, n),
        keyframeIntervalMs: 2000,
        fragmentPayloadBytes: payload,
      }).slicesPerSecond;
    // Two broadcasters at about half the solo slice rate each, so the AGGREGATE
    // stays near the single-broadcaster figure — which halves upstream and keeps
    // publish RTT low, whatever it does not do for delivery.
    expect(2 * rate(2)).toBeLessThan(1.3 * rate(1));
  });

  it("floors both knobs rather than dividing to nothing", () => {
    const many = adaptiveEncoding(BASE, 20);
    expect(many.fps).toBe(MIN_ADAPTIVE_FPS);
    expect(many.bitrate).toBe(MIN_ADAPTIVE_BITRATE);
  });

  it("never raises a budget that already sits below the floors", () => {
    const low = { fps: 6, bitrate: 200_000 };
    expect(adaptiveEncoding(low, 1)).toEqual(low);
    expect(adaptiveEncoding(low, 5)).toEqual(low);
  });

  it("survives a zero budget without producing NaN", () => {
    const z = adaptiveEncoding({ fps: 0, bitrate: 0 }, 3);
    expect(Number.isFinite(z.fps)).toBe(true);
    expect(z.bitrate).toBe(0);
  });
});
