import { describe, expect, it } from "vitest";
import { WHEEL_NOTCH, WheelSteps } from "../src/input/wheel";

describe("WheelSteps", () => {
  it("steps immediately on a mouse notch", () => {
    const w = new WheelSteps();
    expect(w.push(WHEEL_NOTCH, 0, 0)).toBe(1);
    expect(w.push(-WHEEL_NOTCH, 0, 10)).toBe(-1);
  });

  it("does not step on a single small trackpad delta", () => {
    expect(new WheelSteps().push(3, 0, 0)).toBe(0);
  });

  it("turns a trackpad flick into a couple of notches, not dozens", () => {
    const w = new WheelSteps();
    let steps = 0;
    let events = 0;
    // one macOS two-finger flick: ~40 events with a decaying momentum tail
    for (let i = 0, d = 12; i < 40; i++, d = Math.max(1, d * 0.92)) {
      steps += w.push(d, 0, i * 8);
      events++;
    }
    expect(events).toBe(40);
    expect(steps).toBeGreaterThan(0);
    expect(steps).toBeLessThanOrEqual(4); // the old code stepped 40 times
  });

  it("accumulates small deltas until they add up to a notch", () => {
    const w = new WheelSteps();
    for (let i = 0; i < 9; i++) expect(w.push(10, 0, i * 10)).toBe(0);
    expect(w.push(10, 0, 100)).toBe(1); // 10 × 10px = one notch
  });

  it("forgets a leftover after the gesture ends", () => {
    const w = new WheelSteps();
    expect(w.push(90, 0, 0)).toBe(0); // just short of a notch
    expect(w.push(90, 0, 5_000)).toBe(0); // new gesture: the 90 did not carry over
  });

  it("normalizes line and page delta modes", () => {
    expect(new WheelSteps().push(7, 1, 0)).toBe(1); // 7 lines × 16px > one notch
    expect(new WheelSteps().push(1, 2, 0)).toBe(4); // one page = 400px = 4 notches
  });

  it("reports multiple notches from one big delta", () => {
    expect(new WheelSteps().push(WHEEL_NOTCH * 3, 0, 0)).toBe(3);
  });
});
