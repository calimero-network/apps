import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { visibleInterval } from "./visibleInterval";

function setVisibility(state: "visible" | "hidden") {
  Object.defineProperty(document, "visibilityState", { configurable: true, get: () => state });
  document.dispatchEvent(new Event("visibilitychange"));
}

describe("visibleInterval", () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime(0);
    setVisibility("visible");
  });
  afterEach(() => {
    vi.useRealTimers();
    setVisibility("visible");
  });

  it("ticks on the wall clock's multiples while visible", () => {
    vi.setSystemTime(10_000);
    const tick = vi.fn();
    const stop = visibleInterval(tick, 30_000);
    vi.advanceTimersByTime(19_999);
    expect(tick).not.toHaveBeenCalled();
    vi.advanceTimersByTime(1);
    expect(tick).toHaveBeenCalledTimes(1);
    vi.advanceTimersByTime(30_000);
    expect(tick).toHaveBeenCalledTimes(2);
    stop();
    vi.advanceTimersByTime(60_000);
    expect(tick).toHaveBeenCalledTimes(2);
  });

  it("skips ticks while hidden and runs once on return", () => {
    const tick = vi.fn();
    const stop = visibleInterval(tick, 30_000);
    setVisibility("hidden");
    vi.advanceTimersByTime(90_000);
    expect(tick).not.toHaveBeenCalled();
    setVisibility("visible");
    expect(tick).toHaveBeenCalledTimes(1);
    stop();
  });
});
