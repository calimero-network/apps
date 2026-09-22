import { describe, expect, it } from "vitest";

import { MAX_DELTA, PINCH_RATE, wheelAction, type WheelLike } from "./wheel";

const VIEWPORT = { width: 1000, height: 800 };

function ev(over: Partial<WheelLike> = {}): WheelLike {
  return {
    deltaX: 0,
    deltaY: 0,
    deltaMode: 0,
    ctrlKey: false,
    metaKey: false,
    shiftKey: false,
    ...over,
  };
}

/** How much one gesture changes the zoom, as a percentage. */
const pct = (factor: number) => Math.round((factor - 1) * 1000) / 10;

describe("wheelAction", () => {
  describe("two fingers pan", () => {
    // The reported asymmetry: a horizontal swipe crawled and a vertical one
    // flew, because every wheel event zoomed and only deltaY was read.
    it("pans horizontally on a horizontal swipe", () => {
      expect(wheelAction(ev({ deltaX: 40 }), VIEWPORT)).toEqual({
        kind: "pan",
        dx: -40,
        dy: -0,
      });
    });

    it("pans vertically on a vertical swipe", () => {
      expect(wheelAction(ev({ deltaY: 40 }), VIEWPORT)).toEqual({
        kind: "pan",
        dx: -0,
        dy: -40,
      });
    });

    it("moves the same distance whichever axis the gesture is on", () => {
      const across = wheelAction(ev({ deltaX: 40 }), VIEWPORT);
      const down = wheelAction(ev({ deltaY: 40 }), VIEWPORT);
      expect(across.kind).toBe("pan");
      expect(down.kind).toBe("pan");
      const mag = (a: typeof across) =>
        a.kind === "pan" ? Math.hypot(a.dx, a.dy) : -1;
      expect(mag(across)).toBe(mag(down));
    });

    it("pans both axes at once on a diagonal swipe", () => {
      expect(wheelAction(ev({ deltaX: 10, deltaY: -20 }), VIEWPORT)).toEqual({
        kind: "pan",
        dx: -10,
        dy: 20,
      });
    });

    it("never zooms without a modifier", () => {
      expect(wheelAction(ev({ deltaY: 500 }), VIEWPORT).kind).toBe("pan");
    });

    it("does nothing when the gesture carries no movement", () => {
      expect(wheelAction(ev(), VIEWPORT)).toEqual({ kind: "none" });
    });
  });

  describe("shift is for a mouse with one wheel", () => {
    it("turns a vertical wheel into a horizontal pan", () => {
      expect(wheelAction(ev({ deltaY: 30, shiftKey: true }), VIEWPORT)).toEqual(
        {
          kind: "pan",
          dx: -30,
          dy: -0,
        },
      );
    });

    it("leaves a trackpad that already reported a horizontal delta alone", () => {
      // Honouring both would cancel the gesture out.
      expect(
        wheelAction(ev({ deltaX: 30, deltaY: 5, shiftKey: true }), VIEWPORT),
      ).toEqual({
        kind: "pan",
        dx: -30,
        dy: -5,
      });
    });
  });

  describe("pinch zooms, and fast", () => {
    it("zooms in on a pinch out", () => {
      const a = wheelAction(ev({ deltaY: -10, ctrlKey: true }), VIEWPORT);
      expect(a.kind).toBe("zoom");
      if (a.kind === "zoom") expect(a.factor).toBeGreaterThan(1);
    });

    it("zooms out on a pinch in", () => {
      const a = wheelAction(ev({ deltaY: 10, ctrlKey: true }), VIEWPORT);
      expect(a.kind).toBe("zoom");
      if (a.kind === "zoom") expect(a.factor).toBeLessThan(1);
    });

    // The "slow as fuck" report: a typical pinch delta moved the zoom ~1%.
    it("moves a typical pinch delta about 10%, not about 1%", () => {
      const a = wheelAction(ev({ deltaY: -10, ctrlKey: true }), VIEWPORT);
      if (a.kind !== "zoom") throw new Error("expected zoom");
      expect(pct(a.factor)).toBeGreaterThan(9);
      const old = 0.999 ** -10; // what it used to do
      expect(pct(old)).toBeLessThan(1.1);
      expect(a.factor).toBeGreaterThan(old);
    });

    it("is multiplicative, so a step feels the same at any zoom", () => {
      const a = wheelAction(ev({ deltaY: -10, ctrlKey: true }), VIEWPORT);
      const b = wheelAction(ev({ deltaY: -20, ctrlKey: true }), VIEWPORT);
      if (a.kind !== "zoom" || b.kind !== "zoom")
        throw new Error("expected zoom");
      // Twice the delta is the one-step factor squared.
      expect(b.factor).toBeCloseTo(a.factor ** 2, 10);
    });

    it("caps a flung trackpad's per-event jump", () => {
      const huge = wheelAction(ev({ deltaY: -9999, ctrlKey: true }), VIEWPORT);
      const capped = wheelAction(
        ev({ deltaY: -MAX_DELTA, ctrlKey: true }),
        VIEWPORT,
      );
      expect(huge).toEqual(capped);
      if (huge.kind === "zoom") {
        expect(huge.factor).toBeCloseTo(Math.exp(MAX_DELTA * PINCH_RATE), 10);
      }
    });
  });

  describe("⌘ + wheel zooms, at a mouse's scale", () => {
    it("zooms rather than pans", () => {
      expect(
        wheelAction(ev({ deltaY: -100, metaKey: true }), VIEWPORT).kind,
      ).toBe("zoom");
    });

    // One mouse notch is ~100, one pinch step ~10. Sharing a rate would make
    // one of them useless.
    it("moves one mouse notch by a comparable amount to one pinch step", () => {
      const notch = wheelAction(ev({ deltaY: -100, metaKey: true }), VIEWPORT);
      const pinch = wheelAction(ev({ deltaY: -10, ctrlKey: true }), VIEWPORT);
      if (notch.kind !== "zoom" || pinch.kind !== "zoom")
        throw new Error("expected zoom");
      const ratio = pct(notch.factor) / pct(pinch.factor);
      expect(ratio).toBeGreaterThan(0.5);
      expect(ratio).toBeLessThan(3);
    });

    it("treats a pinch as a pinch even with ⌘ also down", () => {
      const both = wheelAction(
        ev({ deltaY: -10, ctrlKey: true, metaKey: true }),
        VIEWPORT,
      );
      const pinch = wheelAction(ev({ deltaY: -10, ctrlKey: true }), VIEWPORT);
      expect(both).toEqual(pinch);
    });
  });

  // Firefox reports lines, not pixels. Read raw, the same gesture is ~16x
  // stronger there.
  describe("deltaMode", () => {
    it("reads a line-mode delta as 16px", () => {
      expect(wheelAction(ev({ deltaY: 3, deltaMode: 1 }), VIEWPORT)).toEqual({
        kind: "pan",
        dx: -0,
        dy: -48,
      });
    });

    it("reads a page-mode delta as one viewport", () => {
      expect(wheelAction(ev({ deltaY: 1, deltaMode: 2 }), VIEWPORT)).toEqual({
        kind: "pan",
        dx: -0,
        dy: -800,
      });
    });

    it("normalises before the zoom cap, not after", () => {
      // 10 lines = 160px, past the 120 cap.
      const lines = wheelAction(
        ev({ deltaY: -10, deltaMode: 1, ctrlKey: true }),
        VIEWPORT,
      );
      const capped = wheelAction(
        ev({ deltaY: -MAX_DELTA, ctrlKey: true }),
        VIEWPORT,
      );
      expect(lines).toEqual(capped);
    });
  });
});
