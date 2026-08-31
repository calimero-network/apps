import { describe, expect, it } from "vitest";
import { DAY_LENGTH_SECS, dayFactor, dayPhase, skyColor } from "../src/engine/sim";

describe("day/night cycle", () => {
  it("is periodic", () => {
    expect(dayPhase(0)).toBe(dayPhase(DAY_LENGTH_SECS));
    expect(dayFactor(100)).toBeCloseTo(dayFactor(100 + DAY_LENGTH_SECS), 10);
  });

  it("is brightest at midday and darkest at midnight", () => {
    const midday = dayFactor(DAY_LENGTH_SECS * 0.25);
    const midnight = dayFactor(DAY_LENGTH_SECS * 0.75);
    expect(midday).toBeCloseTo(1, 5);
    expect(midnight).toBeCloseTo(0.08, 5);
    expect(midday).toBeGreaterThan(midnight);
  });

  it("never goes fully dark (you can always see a little)", () => {
    for (let t = 0; t < DAY_LENGTH_SECS; t += 10) {
      expect(dayFactor(t)).toBeGreaterThanOrEqual(0.08);
      expect(dayFactor(t)).toBeLessThanOrEqual(1);
    }
  });

  it("sky color components stay in range and track brightness", () => {
    const day = skyColor(DAY_LENGTH_SECS * 0.25);
    const night = skyColor(DAY_LENGTH_SECS * 0.75);
    for (const c of [...day, ...night]) {
      expect(c).toBeGreaterThanOrEqual(0);
      expect(c).toBeLessThanOrEqual(1);
    }
    expect(day[2]).toBeGreaterThan(night[2]);
  });

  it("identical elapsed time gives identical sky on every peer (shared clock)", () => {
    expect(skyColor(1234)).toEqual(skyColor(1234));
    expect(dayFactor(1234)).toBe(dayFactor(1234));
  });
});
