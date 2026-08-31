// Scroll-wheel → discrete notches.
//
// A two-finger trackpad scroll is not one wheel "notch": macOS emits dozens of
// small-delta events per flick, plus a momentum tail. A hotbar bound straight to
// `wheel` therefore spun through every slot several times per gesture, which on
// a MacBook reads as "the scroll wheel is broken". Accumulating into notches
// fixes that without slowing a real mouse down: one mouse notch is ~100px, so it
// still steps on the very first event.
//
// Kept byte-identical between mero-blocks and merraria — both have a hotbar.

/** One mouse notch in CSS pixels — the step size a hotbar advances by. */
export const WHEEL_NOTCH = 100;
/** A gap this long ends a scroll gesture, so leftovers don't leak into the next. */
export const WHEEL_GAP_MS = 250;

export class WheelSteps {
  private acc = 0;
  private last = -Infinity;

  constructor(
    private readonly notch = WHEEL_NOTCH,
    private readonly gapMs = WHEEL_GAP_MS,
  ) {}

  /** Signed number of notches this event completes (usually 0). */
  push(deltaY: number, deltaMode = 0, now = Date.now()): number {
    if (now - this.last > this.gapMs) this.acc = 0;
    this.last = now;
    // deltaMode: 0 = pixels, 1 = lines, 2 = pages — normalize to pixels
    const px = deltaY * (deltaMode === 1 ? 16 : deltaMode === 2 ? 400 : 1);
    this.acc += px;
    const steps = Math.trunc(this.acc / this.notch);
    if (steps !== 0) this.acc -= steps * this.notch;
    return steps;
  }
}
