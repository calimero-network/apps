import { describe, expect, it } from "vitest";
import { celestialPos, DAY_LENGTH_SECS, dayFactor, skyGradient } from "../src/engine/sim";

describe("day/night", () => {
  it("is periodic and bounded", () => {
    expect(dayFactor(100)).toBeCloseTo(dayFactor(100 + DAY_LENGTH_SECS), 10);
    for (let t = 0; t < DAY_LENGTH_SECS; t += 10) {
      expect(dayFactor(t)).toBeGreaterThanOrEqual(0.08);
      expect(dayFactor(t)).toBeLessThanOrEqual(1);
    }
  });

  it("midday is bright, midnight dark", () => {
    expect(dayFactor(DAY_LENGTH_SECS * 0.25)).toBeCloseTo(1, 5);
    expect(dayFactor(DAY_LENGTH_SECS * 0.75)).toBeCloseTo(0.08, 5);
  });

  it("sun during day, moon at night", () => {
    expect(celestialPos(DAY_LENGTH_SECS * 0.25).isSun).toBe(true);
    expect(celestialPos(DAY_LENGTH_SECS * 0.75).isSun).toBe(false);
  });

  it("sky gradient returns valid css colors", () => {
    for (const c of [...skyGradient(0), ...skyGradient(DAY_LENGTH_SECS / 2)]) {
      expect(c).toMatch(/^rgb\(\d+,\d+,\d+\)$/);
    }
  });

  it("same elapsed time => same sky on every peer", () => {
    expect(skyGradient(1234)).toEqual(skyGradient(1234));
  });
});
