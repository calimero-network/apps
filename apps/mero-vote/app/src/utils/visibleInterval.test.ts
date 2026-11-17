import { afterEach, describe, expect, it, vi } from "vitest";

import { visibleInterval } from "./visibleInterval";

function setVisibility(state: "visible" | "hidden") {
  Object.defineProperty(document, "visibilityState", { configurable: true, get: () => state });
  document.dispatchEvent(new Event("visibilitychange"));
}

afterEach(() => {
  setVisibility("visible");
  vi.useRealTimers();
});

describe("visibleInterval", () => {
  it("ticks on the wall clock's multiples, skips hidden ticks and catches up on return", () => {
    vi.useFakeTimers();
    vi.setSystemTime(25_000);
    const tick = vi.fn();
    const stop = visibleInterval(tick, 30_000);

    vi.advanceTimersByTime(4_999);
    expect(tick).not.toHaveBeenCalled();
    vi.advanceTimersByTime(1);
    expect(tick).toHaveBeenCalledTimes(1);

    setVisibility("hidden");
    vi.advanceTimersByTime(60_000);
    expect(tick).toHaveBeenCalledTimes(1);

    setVisibility("visible");
    expect(tick).toHaveBeenCalledTimes(2);

    stop();
    vi.advanceTimersByTime(60_000);
    setVisibility("visible");
    expect(tick).toHaveBeenCalledTimes(2);
  });
});
