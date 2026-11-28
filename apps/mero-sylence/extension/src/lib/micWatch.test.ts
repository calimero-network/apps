import { describe, expect, it } from "vitest";
import { MIC_SILENT_MS, MicWatch } from "./micWatch";

describe("the microphone watch", () => {
  it("tells once when the mic is silent for a minute while the call talks", () => {
    const w = new MicWatch(0);
    w.heard("others", 0.1, 5_000);
    expect(w.silent(MIC_SILENT_MS - 1)).toBe(false);
    expect(w.silent(MIC_SILENT_MS)).toBe(true);
    expect(w.silent(MIC_SILENT_MS + 4_000)).toBe(false);
  });

  it("says nothing while the person talks", () => {
    const w = new MicWatch(0);
    for (let t = 0; t <= 120_000; t += 4_000) {
      w.heard("others", 0.1, t);
      w.heard("you", 0.05, t);
      expect(w.silent(t)).toBe(false);
    }
  });

  it("says nothing in a quiet call (nobody talks, the mic is not the problem)", () => {
    const w = new MicWatch(0);
    expect(w.silent(5 * MIC_SILENT_MS)).toBe(false);
  });

  it("tells again after the mic came back and went silent again", () => {
    const w = new MicWatch(0);
    w.heard("others", 0.1, 1_000);
    expect(w.silent(MIC_SILENT_MS)).toBe(true);
    w.heard("you", 0.05, 70_000);
    expect(w.silent(70_000 + MIC_SILENT_MS)).toBe(true);
  });

  it("does not count noise floor as the mic speaking", () => {
    const w = new MicWatch(0);
    w.heard("others", 0.1, 1_000);
    w.heard("you", 0.001, 30_000);
    expect(w.silent(MIC_SILENT_MS)).toBe(true);
  });
});
