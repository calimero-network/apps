import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { visibleInterval } from "./visibleInterval";

let state: DocumentVisibilityState = "visible";

beforeEach(() => {
  vi.useFakeTimers();
  vi.setSystemTime(0);
  state = "visible";
  vi.spyOn(document, "visibilityState", "get").mockImplementation(() => state);
});

afterEach(() => {
  vi.restoreAllMocks();
  vi.useRealTimers();
});

describe("visibleInterval", () => {
  it("ticks on the wall clock while visible", () => {
    const tick = vi.fn();
    const stop = visibleInterval(tick, 1000);
    vi.advanceTimersByTime(3000);
    expect(tick).toHaveBeenCalledTimes(3);
    stop();
    vi.advanceTimersByTime(3000);
    expect(tick).toHaveBeenCalledTimes(3);
  });

  it("skips ticks while hidden and runs once on return", () => {
    const tick = vi.fn();
    const stop = visibleInterval(tick, 1000);
    state = "hidden";
    vi.advanceTimersByTime(5000);
    expect(tick).not.toHaveBeenCalled();
    state = "visible";
    document.dispatchEvent(new Event("visibilitychange"));
    expect(tick).toHaveBeenCalledOnce();
    stop();
  });
});
