/**
 * Unit tests for usePresence
 *
 * Verifies:
 *   - heartbeat is called on mount and on interval
 *   - getPresence is called on mount and on interval
 *   - isOnline returns true for identities returned by getPresence
 *   - isOnline returns false for identities not returned
 *   - hook is disabled (no calls) when contextId or executorPublicKey is undefined
 *   - interval is cleared on unmount
 */

import { act, renderHook } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { usePresence, THRESHOLD_MS, HEARTBEAT_INTERVAL_MS } from "./usePresence";

// ── Mock ClientApiDataSource ────────────────────────────────────────────────

const mockHeartbeat = vi.fn();
const mockGetPresence = vi.fn();

vi.mock("../api/dataSource/clientApiDataSource", () => ({
  ClientApiDataSource: class {
    heartbeat = mockHeartbeat;
    getPresence = mockGetPresence;
  },
}));

// ── Timer mocks ──────────────────────────────────────────────────────────────

beforeEach(() => {
  vi.useFakeTimers();
  vi.clearAllMocks();

  // Default: heartbeat succeeds silently, getPresence returns nobody online.
  // Return API-style responses (not thrown errors) to match the hook's expectations.
  mockHeartbeat.mockResolvedValue({ data: null, error: null });
  mockGetPresence.mockResolvedValue({ data: [], error: null });
});

afterEach(() => {
  vi.useRealTimers();
});

// Flush all pending microtasks (promise resolutions) without advancing timers.
async function flushPromises() {
  // Two rounds of microtask flushing handle chained .then() callbacks.
  await act(async () => {
    await Promise.resolve();
    await Promise.resolve();
  });
}

const CTX = "ctx-test-123";
const KEY = "key-alice-456";

// ─────────────────────────────────────────────────────────────────────────────

describe("usePresence", () => {
  it("calls heartbeat on mount", async () => {
    renderHook(() => usePresence(CTX, KEY));
    await flushPromises();

    expect(mockHeartbeat).toHaveBeenCalledWith(CTX, KEY);
  });

  it("calls getPresence on mount", async () => {
    renderHook(() => usePresence(CTX, KEY));
    await flushPromises();

    expect(mockGetPresence).toHaveBeenCalledTimes(1);
    expect(mockGetPresence.mock.calls[0][0]).toBe(CTX);
    expect(mockGetPresence.mock.calls[0][1]).toBe(KEY);
  });

  it("passes threshold_ns = THRESHOLD_MS × 1_000_000 to getPresence", async () => {
    renderHook(() => usePresence(CTX, KEY));
    await flushPromises();

    const thresholdArg = mockGetPresence.mock.calls[0][2] as number;
    expect(thresholdArg).toBe(THRESHOLD_MS * 1_000_000);
  });

  it("isOnline returns true for identities in getPresence response", async () => {
    mockGetPresence.mockResolvedValue({ data: ["alice.near", "bob.near"], error: null });

    const { result } = renderHook(() => usePresence(CTX, KEY));
    await flushPromises();

    expect(result.current.isOnline("alice.near")).toBe(true);
    expect(result.current.isOnline("bob.near")).toBe(true);
  });

  it("isOnline returns false for identities not in response", async () => {
    mockGetPresence.mockResolvedValue({ data: ["alice.near"], error: null });

    const { result } = renderHook(() => usePresence(CTX, KEY));
    await flushPromises();

    expect(result.current.isOnline("alice.near")).toBe(true);
    expect(result.current.isOnline("charlie.near")).toBe(false);
  });

  it("isOnline returns false when nobody is online", async () => {
    mockGetPresence.mockResolvedValue({ data: [], error: null });

    const { result } = renderHook(() => usePresence(CTX, KEY));
    await flushPromises();

    expect(result.current.isOnline("anyone.near")).toBe(false);
  });

  it("polls again on the interval", async () => {
    mockGetPresence
      .mockResolvedValueOnce({ data: [], error: null })              // initial poll
      .mockResolvedValueOnce({ data: ["alice.near"], error: null }); // after interval

    const { result } = renderHook(() => usePresence(CTX, KEY));

    // Let initial calls resolve
    await flushPromises();
    expect(result.current.isOnline("alice.near")).toBe(false);

    // Advance one interval → fires, then flush the resulting promises
    await act(async () => {
      vi.advanceTimersByTime(HEARTBEAT_INTERVAL_MS);
    });
    await flushPromises();

    expect(result.current.isOnline("alice.near")).toBe(true);
  });

  it("heartbeat is called again on the interval", async () => {
    renderHook(() => usePresence(CTX, KEY));

    await flushPromises();
    const initialCalls = mockHeartbeat.mock.calls.length;
    expect(initialCalls).toBeGreaterThan(0);

    await act(async () => {
      vi.advanceTimersByTime(HEARTBEAT_INTERVAL_MS);
    });
    await flushPromises();

    expect(mockHeartbeat.mock.calls.length).toBeGreaterThan(initialCalls);
  });

  it("makes no calls when contextId is undefined", async () => {
    renderHook(() => usePresence(undefined, KEY));
    await flushPromises();

    expect(mockHeartbeat).not.toHaveBeenCalled();
    expect(mockGetPresence).not.toHaveBeenCalled();
  });

  it("makes no calls when executorPublicKey is undefined", async () => {
    renderHook(() => usePresence(CTX, undefined));
    await flushPromises();

    expect(mockHeartbeat).not.toHaveBeenCalled();
    expect(mockGetPresence).not.toHaveBeenCalled();
  });

  it("makes no calls when both args are undefined", async () => {
    renderHook(() => usePresence(undefined, undefined));
    await flushPromises();

    expect(mockHeartbeat).not.toHaveBeenCalled();
    expect(mockGetPresence).not.toHaveBeenCalled();
  });

  it("clears the interval on unmount — no further calls", async () => {
    const { unmount } = renderHook(() => usePresence(CTX, KEY));

    await flushPromises();
    const callsAtUnmount = mockHeartbeat.mock.calls.length;
    unmount();

    await act(async () => {
      vi.advanceTimersByTime(60_000);
    });
    await flushPromises();

    expect(mockHeartbeat.mock.calls.length).toBe(callsAtUnmount);
  });

  it("online set updates when presence changes between polls", async () => {
    mockGetPresence
      .mockResolvedValueOnce({ data: ["alice.near", "bob.near"], error: null })
      .mockResolvedValueOnce({ data: ["alice.near"], error: null }); // bob went offline

    const { result } = renderHook(() => usePresence(CTX, KEY));

    await flushPromises();
    expect(result.current.isOnline("bob.near")).toBe(true);

    await act(async () => {
      vi.advanceTimersByTime(HEARTBEAT_INTERVAL_MS);
    });
    await flushPromises();

    expect(result.current.isOnline("bob.near")).toBe(false);
    expect(result.current.isOnline("alice.near")).toBe(true);
  });

  it("handles API error response gracefully — online set unchanged", async () => {
    // Return an API-style error (not a thrown error) so the void-chain doesn't
    // create unhandled rejections. The hook only checks resp.data so null data
    // leaves the online set untouched.
    mockGetPresence
      .mockResolvedValueOnce({ data: ["alice.near"], error: null })
      .mockResolvedValueOnce({ data: null, error: { code: 500, message: "Network error" } });

    const { result } = renderHook(() => usePresence(CTX, KEY));

    await flushPromises();
    expect(result.current.isOnline("alice.near")).toBe(true);

    // Second poll returns error response — online set should retain previous value
    await act(async () => {
      vi.advanceTimersByTime(HEARTBEAT_INTERVAL_MS);
    });
    await flushPromises();

    // Set is unchanged (data was null so the if branch was skipped)
    expect(result.current.isOnline("alice.near")).toBe(true);
  });
});
