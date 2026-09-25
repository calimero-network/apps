/**
 * Unit tests for usePresence
 *
 * Presence moved from a WASM `heartbeat` + `get_presence` poll to the node's
 * ephemeral channel, so the assertions about those calls are gone with them.
 * What survives is the behaviour callers actually depend on:
 *
 *   - isOnline is true for identities present in the context, false otherwise
 *   - hasOtherOnline ignores your own key and reports anyone else
 *   - the hook is disabled (no subscription, no publish) without both a
 *     contextId and an executorPublicKey
 *   - entering a context announces you exactly once
 */

import { renderHook } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { usePresence } from "./usePresence";

const mockSetPresence = vi.fn();
let mockPeers = new Map<string, Record<string, never>>();
const mockUseEphemeral = vi.fn();

vi.mock("@calimero-network/mero-react", () => ({
  useEphemeral: (contextId: string | null) => {
    mockUseEphemeral(contextId);
    return { peers: mockPeers, setPresence: mockSetPresence, ageOf: () => undefined, error: null };
  },
}));

const ME = "myContextKey";
const OTHER = "otherContextKey";

beforeEach(() => {
  vi.clearAllMocks();
  mockPeers = new Map();
});

describe("usePresence", () => {
  it("reports an identity present in the context as online", () => {
    mockPeers = new Map([[OTHER, {}]]);
    const { result } = renderHook(() => usePresence("ctx-1", ME));
    expect(result.current.isOnline(OTHER)).toBe(true);
  });

  it("reports an identity absent from the context as offline", () => {
    mockPeers = new Map([[OTHER, {}]]);
    const { result } = renderHook(() => usePresence("ctx-1", ME));
    expect(result.current.isOnline("somebodyElse")).toBe(false);
  });

  it("reports nobody online when the context is empty", () => {
    const { result } = renderHook(() => usePresence("ctx-1", ME));
    expect(result.current.isOnline(OTHER)).toBe(false);
    expect(result.current.hasOtherOnline(ME)).toBe(false);
  });

  // The DM fallback: used when `dm.otherIdentity` hasn't resolved to a context
  // executor key yet, so the caller can only ask "is anyone but me here?".
  it("hasOtherOnline finds a peer that is not my own key", () => {
    mockPeers = new Map([[OTHER, {}]]);
    const { result } = renderHook(() => usePresence("ctx-1", ME));
    expect(result.current.hasOtherOnline(ME)).toBe(true);
  });

  it("hasOtherOnline ignores my own key", () => {
    // `peers` excludes our own echo, but a caller may pass a key that happens
    // to be in the map; it must never count as "someone else".
    mockPeers = new Map([[ME, {}]]);
    const { result } = renderHook(() => usePresence("ctx-1", ME));
    expect(result.current.hasOtherOnline(ME)).toBe(false);
  });

  it("announces presence once on entering a context", () => {
    renderHook(() => usePresence("ctx-1", ME));
    expect(mockSetPresence).toHaveBeenCalledTimes(1);
  });

  it("is disabled without a contextId", () => {
    renderHook(() => usePresence(undefined, ME));
    expect(mockUseEphemeral).toHaveBeenCalledWith(null);
    expect(mockSetPresence).not.toHaveBeenCalled();
  });

  it("is disabled without an executorPublicKey", () => {
    renderHook(() => usePresence("ctx-1", undefined));
    expect(mockUseEphemeral).toHaveBeenCalledWith(null);
    expect(mockSetPresence).not.toHaveBeenCalled();
  });
});
