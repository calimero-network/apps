import { act, renderHook } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { FeedBackend } from "./backend";
import { GONE_CONFIRMATIONS, POLL_MS, useFeed } from "./useFeed";
import { visibleInterval } from "./visibleInterval";

function backendWith(feed: () => Promise<unknown>) {
  const reads = vi.fn(feed);
  const backend = {
    feed: reads,
    settings: vi.fn(async () => ({})),
    lenses: vi.fn(async () => []),
  } as unknown as FeedBackend;
  return { backend, reads };
}

const page = { items: [] };
const flush = () => act(async () => {});

function setHidden(hidden: boolean) {
  Object.defineProperty(document, "visibilityState", { configurable: true, get: () => (hidden ? "hidden" : "visible") });
  document.dispatchEvent(new Event("visibilitychange"));
}

describe("visibleInterval", () => {
  beforeEach(() => vi.useFakeTimers());
  afterEach(() => {
    setHidden(false);
    vi.useRealTimers();
  });

  it("skips ticks while hidden and runs one on return", () => {
    const tick = vi.fn();
    const stop = visibleInterval(tick, 1_000);
    vi.advanceTimersByTime(1_000);
    expect(tick).toHaveBeenCalledTimes(1);
    setHidden(true);
    vi.advanceTimersByTime(5_000);
    expect(tick).toHaveBeenCalledTimes(1);
    setHidden(false);
    expect(tick).toHaveBeenCalledTimes(2);
    stop();
    vi.advanceTimersByTime(5_000);
    expect(tick).toHaveBeenCalledTimes(2);
  });
});

describe("useFeed", () => {
  beforeEach(() => vi.useFakeTimers());
  afterEach(() => vi.useRealTimers());

  it("polls only when nothing was read for a poll's length", async () => {
    vi.setSystemTime(1_000 * POLL_MS);
    const { backend, reads } = backendWith(async () => page);
    const { rerender } = renderHook(({ nudge }) => useFeed(backend, nudge), { initialProps: { nudge: 0 } });
    await flush();
    expect(reads).toHaveBeenCalledTimes(1);
    // An event keeps the feed current: the next tick has nothing to catch up on.
    await act(async () => {
      vi.advanceTimersByTime(POLL_MS - 1_000);
    });
    expect(reads).toHaveBeenCalledTimes(1);
    rerender({ nudge: 1 });
    await flush();
    expect(reads).toHaveBeenCalledTimes(2);
    await act(async () => {
      vi.advanceTimersByTime(1_000);
    });
    expect(reads).toHaveBeenCalledTimes(2);
    // Quiet for a whole poll: it reads.
    await act(async () => {
      vi.advanceTimersByTime(POLL_MS);
    });
    expect(reads).toHaveBeenCalledTimes(3);
  });

  it("closes a feed that is gone instead of failing every read", async () => {
    const notFound = Object.assign(new Error("not found"), { status: 404 });
    const { backend, reads } = backendWith(async () => {
      throw notFound;
    });
    const onGone = vi.fn();
    const { result, rerender } = renderHook(({ nudge }) => useFeed(backend, nudge, onGone), { initialProps: { nudge: 0 } });
    await flush();
    expect(onGone).not.toHaveBeenCalled();
    expect(result.current.error).toBe("not found");
    for (let n = 1; n < GONE_CONFIRMATIONS; n++) {
      rerender({ nudge: n });
      await flush();
    }
    expect(onGone).toHaveBeenCalledTimes(1);
    expect(reads).toHaveBeenCalledTimes(GONE_CONFIRMATIONS);
  });

  it("does not close a feed on another error", async () => {
    const { backend } = backendWith(async () => {
      throw Object.assign(new Error("forbidden"), { status: 403 });
    });
    const onGone = vi.fn();
    const { rerender } = renderHook(({ nudge }) => useFeed(backend, nudge, onGone), { initialProps: { nudge: 0 } });
    await flush();
    rerender({ nudge: 1 });
    await flush();
    rerender({ nudge: 2 });
    await flush();
    expect(onGone).not.toHaveBeenCalled();
  });
});
