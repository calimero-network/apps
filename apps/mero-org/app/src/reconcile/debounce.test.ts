import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { debounce } from "./debounce";

describe("debounce", () => {
  beforeEach(() => { vi.useFakeTimers(); });
  afterEach(() => { vi.useRealTimers(); });

  it("runs once after a burst of changes goes quiet", () => {
    const fn = vi.fn();
    const kick = debounce(fn, 1_000);
    kick(); vi.advanceTimersByTime(500); kick(); vi.advanceTimersByTime(500); kick();
    expect(fn).not.toHaveBeenCalled();
    vi.advanceTimersByTime(1_000);
    expect(fn).toHaveBeenCalledTimes(1);
  });

  it("runs nothing once cancelled", () => {
    const fn = vi.fn();
    const kick = debounce(fn, 1_000);
    kick(); kick.cancel();
    vi.advanceTimersByTime(5_000);
    expect(fn).not.toHaveBeenCalled();
  });
});
