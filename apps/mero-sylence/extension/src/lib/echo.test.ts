import { describe, expect, it } from "vitest";
import { EchoGate, isMicPhantom, voicedMs } from "./echo";

const RATE = 16_000;

/** Speech-like audio: noise bursts whose loudness changes every 60–300 ms. */
function speech(seconds: number, seed: number): Float32Array {
  let s = seed;
  const rnd = () => ((s = (s * 1103515245 + 12345) % 2 ** 31) / 2 ** 31);
  const out = new Float32Array(seconds * RATE);
  let i = 0;
  while (i < out.length) {
    const len = Math.floor((0.06 + rnd() * 0.24) * RATE);
    const amp = rnd() < 0.3 ? 0.002 : 0.05 + rnd() * 0.25;
    for (let j = 0; j < len && i < out.length; j++, i++) out[i] = (rnd() * 2 - 1) * amp;
  }
  return out;
}

function noise(n: number, amp: number, seed: number): Float32Array {
  let s = seed;
  const out = new Float32Array(n);
  for (let i = 0; i < n; i++) out[i] = (((s = (s * 1103515245 + 12345) % 2 ** 31) / 2 ** 31) * 2 - 1) * amp;
  return out;
}

/** The call's audio, `delayMs` later and quieter, plus room noise: what leaks into the mic. */
function leak(call: Float32Array, fromMs: number, toMs: number, delayMs: number, gain: number): Float32Array {
  const from = (fromMs * RATE) / 1000;
  const n = ((toMs - fromMs) * RATE) / 1000;
  const d = (delayMs * RATE) / 1000;
  const room = noise(n, 0.003, 7);
  const out = new Float32Array(n);
  for (let i = 0; i < n; i++) out[i] = (call[from + i - d] ?? 0) * gain + room[i]!;
  return out;
}

function gateWith(call: Float32Array): EchoGate {
  const gate = new EchoGate();
  for (let i = 0; i < call.length; i += 128) gate.pushReference(call.subarray(i, i + 128));
  return gate;
}

describe("echo gate", () => {
  const call = speech(20, 1);
  const gate = gateWith(call);

  it("takes the call leaking into the mic for an echo", () => {
    for (const delay of [0, 120, 350, 700]) {
      expect(gate.isEcho(leak(call, 5_000, 9_000, delay, 0.15), 5_000), `delay ${delay}`).toBe(true);
    }
  });

  it("keeps the user's own voice, alone or over the call", () => {
    const own = speech(4, 99);
    expect(gate.isEcho(own, 5_000)).toBe(false);
    const both = leak(call, 5_000, 9_000, 200, 0.1);
    for (let i = 0; i < both.length; i++) both[i]! += own[i]!;
    expect(gate.isEcho(both, 5_000)).toBe(false);
  });

  it("is never an echo while the call is quiet", () => {
    const quiet = gateWith(noise(20 * RATE, 0.001, 3));
    expect(quiet.isEcho(speech(3, 5), 2_000)).toBe(false);
  });
});

describe("mic phantoms", () => {
  it("drops a stock phrase with hardly any voice, keeps real speech", () => {
    expect(isMicPhantom("Thank you.", 200)).toBe(true);
    expect(isMicPhantom("Thank you.", 1_500)).toBe(false);
    expect(isMicPhantom("Thank you for the update on pricing.", 100)).toBe(false);
    expect(voicedMs(noise(RATE, 0.001, 1))).toBe(0);
    expect(voicedMs(noise(RATE, 0.2, 1))).toBeGreaterThan(900);
  });
});
