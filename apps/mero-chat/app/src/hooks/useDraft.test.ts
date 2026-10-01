/**
 * Unit tests for useDraft
 *
 * Coverage:
 *   - loads draft from WASM on mount / channel change
 *   - hasDraft reflects whether draft is non-empty
 *   - setDraft debounces WASM save by 4s
 *   - setDraft("") calls deleteDraft immediately, skips debounce
 *   - clearDraft calls deleteDraft immediately and resets state
 *   - switching channels cancels any pending debounce for the old channel
 *   - undefined channelName keeps draft empty, never calls API
 *
 * Run: pnpm exec vitest run src/hooks/useDraft.test.ts
 */

import { renderHook, act } from "@testing-library/react";
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

// ── Hoisted mocks (available before vi.mock factories run) ────────────────────

const { mockGetDraft, mockSaveDraft, mockDeleteDraft, mockGetContextId, mockGetContextIdentity } =
  vi.hoisted(() => ({
    mockGetDraft: vi.fn(),
    mockSaveDraft: vi.fn(),
    mockDeleteDraft: vi.fn(),
    mockGetContextId: vi.fn(),
    mockGetContextIdentity: vi.fn(),
  }));

vi.mock("../api/dataSource/clientApiDataSource", () => ({
  ClientApiDataSource: class {
    getDraft = mockGetDraft;
    saveDraft = mockSaveDraft;
    deleteDraft = mockDeleteDraft;
  },
}));

vi.mock("@calimero-network/mero-react", () => ({
  getContextId: mockGetContextId,
  getContextIdentity: mockGetContextIdentity,
}));

import { useDraft } from "./useDraft";

// ── Helpers ───────────────────────────────────────────────────────────────────

const DEBOUNCE_MS = 4_000;

/** Flush all pending promises so async useEffect bodies run to completion. */
async function flushPromises() {
  await act(async () => {
    await Promise.resolve();
    await Promise.resolve();
    await Promise.resolve();
  });
}

// ── Tests ─────────────────────────────────────────────────────────────────────

describe("useDraft — load", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.useFakeTimers();
    mockGetContextId.mockReturnValue("ctx-123");
    mockGetContextIdentity.mockReturnValue("identity-abc");
    mockGetDraft.mockResolvedValue({ data: "" });
    mockSaveDraft.mockResolvedValue({ data: undefined });
    mockDeleteDraft.mockResolvedValue({ data: undefined });
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it("calls getDraft with contextId, executorPublicKey and channel on mount", async () => {
    mockGetDraft.mockResolvedValue({ data: "hello world" });

    const { result } = renderHook(() => useDraft("general"));
    await flushPromises();

    expect(mockGetDraft).toHaveBeenCalledWith("ctx-123", "identity-abc", "general");
    expect(result.current.draft).toBe("hello world");
    expect(result.current.hasDraft).toBe(true);
  });

  it("starts with empty draft before the async load resolves", () => {
    mockGetDraft.mockReturnValue(new Promise(() => {})); // never resolves

    const { result } = renderHook(() => useDraft("general"));

    expect(result.current.draft).toBe("");
    expect(result.current.hasDraft).toBe(false);
  });

  it("hasDraft is false when persisted draft is empty string", async () => {
    mockGetDraft.mockResolvedValue({ data: "" });

    const { result } = renderHook(() => useDraft("general"));
    await flushPromises();

    expect(result.current.hasDraft).toBe(false);
    expect(result.current.draft).toBe("");
  });

  it("hasDraft is false when getDraft returns null data", async () => {
    mockGetDraft.mockResolvedValue({ data: null });

    const { result } = renderHook(() => useDraft("general"));
    await flushPromises();

    expect(result.current.hasDraft).toBe(false);
  });

  it("reloads draft when channel changes", async () => {
    mockGetDraft
      .mockResolvedValueOnce({ data: "draft-a" })
      .mockResolvedValueOnce({ data: "draft-b" });

    const { result, rerender } = renderHook(({ ch }) => useDraft(ch), {
      initialProps: { ch: "channel-a" },
    });

    await flushPromises();
    expect(result.current.draft).toBe("draft-a");

    rerender({ ch: "channel-b" });
    await flushPromises();

    expect(result.current.draft).toBe("draft-b");
    expect(mockGetDraft).toHaveBeenCalledTimes(2);
    expect(mockGetDraft).toHaveBeenLastCalledWith("ctx-123", "identity-abc", "channel-b");
  });

  it("does not call getDraft when channelName is undefined", async () => {
    renderHook(() => useDraft(undefined));
    await flushPromises();

    expect(mockGetDraft).not.toHaveBeenCalled();
  });

  it("does not call getDraft when contextId is missing", async () => {
    mockGetContextId.mockReturnValue(undefined);

    renderHook(() => useDraft("general"));
    await flushPromises();

    expect(mockGetDraft).not.toHaveBeenCalled();
  });

  it("resets draft to empty when channel becomes undefined", async () => {
    mockGetDraft.mockResolvedValue({ data: "something" });

    const { result, rerender } = renderHook(({ ch }) => useDraft(ch), {
      initialProps: { ch: "general" as string | undefined },
    });
    await flushPromises();
    expect(result.current.draft).toBe("something");

    rerender({ ch: undefined });

    expect(result.current.draft).toBe("");
  });
});

describe("useDraft — setDraft debounce", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.useFakeTimers();
    mockGetContextId.mockReturnValue("ctx-123");
    mockGetContextIdentity.mockReturnValue("identity-abc");
    mockGetDraft.mockResolvedValue({ data: "" });
    mockSaveDraft.mockResolvedValue({ data: undefined });
    mockDeleteDraft.mockResolvedValue({ data: undefined });
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it("updates draft state immediately when setDraft is called", async () => {
    const { result } = renderHook(() => useDraft("general"));
    await flushPromises();

    act(() => result.current.setDraft("typed text"));

    expect(result.current.draft).toBe("typed text");
    expect(result.current.hasDraft).toBe(true);
  });

  it("does NOT call saveDraft before debounce window elapses", async () => {
    const { result } = renderHook(() => useDraft("general"));
    await flushPromises();

    act(() => result.current.setDraft("not saved yet"));
    act(() => vi.advanceTimersByTime(DEBOUNCE_MS - 1));

    expect(mockSaveDraft).not.toHaveBeenCalled();
  });

  it("calls saveDraft after the full debounce window", async () => {
    const { result } = renderHook(() => useDraft("general"));
    await flushPromises();

    act(() => result.current.setDraft("save me"));
    act(() => vi.advanceTimersByTime(DEBOUNCE_MS));

    expect(mockSaveDraft).toHaveBeenCalledWith("ctx-123", "identity-abc", "general", "save me");
  });

  it("resets debounce on rapid keystrokes — saveDraft fires only once with final value", async () => {
    const { result } = renderHook(() => useDraft("general"));
    await flushPromises();

    act(() => result.current.setDraft("a"));
    act(() => vi.advanceTimersByTime(1000));
    act(() => result.current.setDraft("ab"));
    act(() => vi.advanceTimersByTime(1000));
    act(() => result.current.setDraft("abc"));
    act(() => vi.advanceTimersByTime(DEBOUNCE_MS));

    expect(mockSaveDraft).toHaveBeenCalledTimes(1);
    expect(mockSaveDraft).toHaveBeenCalledWith("ctx-123", "identity-abc", "general", "abc");
  });

  it("calls deleteDraft immediately when setDraft is called with empty string", async () => {
    const { result } = renderHook(() => useDraft("general"));
    await flushPromises();

    act(() => result.current.setDraft("some text"));
    act(() => result.current.setDraft(""));

    expect(mockDeleteDraft).toHaveBeenCalledWith("ctx-123", "identity-abc", "general");
    expect(mockSaveDraft).not.toHaveBeenCalled();
  });

  it("cancels pending debounce when field is cleared — saveDraft never fires", async () => {
    const { result } = renderHook(() => useDraft("general"));
    await flushPromises();

    act(() => result.current.setDraft("text"));
    act(() => result.current.setDraft(""));
    act(() => vi.advanceTimersByTime(DEBOUNCE_MS));

    expect(mockSaveDraft).not.toHaveBeenCalled();
  });

  it("hasDraft reflects current text correctly", async () => {
    const { result } = renderHook(() => useDraft("general"));
    await flushPromises();

    expect(result.current.hasDraft).toBe(false);
    act(() => result.current.setDraft("text"));
    expect(result.current.hasDraft).toBe(true);
    act(() => result.current.setDraft(""));
    expect(result.current.hasDraft).toBe(false);
  });
});

describe("useDraft — clearDraft", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.useFakeTimers();
    mockGetContextId.mockReturnValue("ctx-123");
    mockGetContextIdentity.mockReturnValue("identity-abc");
    mockGetDraft.mockResolvedValue({ data: "" });
    mockSaveDraft.mockResolvedValue({ data: undefined });
    mockDeleteDraft.mockResolvedValue({ data: undefined });
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it("resets draft state to empty", async () => {
    const { result } = renderHook(() => useDraft("general"));
    await flushPromises();

    act(() => result.current.setDraft("hello"));
    act(() => result.current.clearDraft());

    expect(result.current.draft).toBe("");
    expect(result.current.hasDraft).toBe(false);
  });

  it("calls deleteDraft immediately", async () => {
    const { result } = renderHook(() => useDraft("general"));
    await flushPromises();

    act(() => result.current.setDraft("hello"));
    act(() => result.current.clearDraft());

    expect(mockDeleteDraft).toHaveBeenCalledWith("ctx-123", "identity-abc", "general");
  });

  it("cancels any pending debounced save — saveDraft must not fire", async () => {
    const { result } = renderHook(() => useDraft("general"));
    await flushPromises();

    act(() => result.current.setDraft("draft text"));
    act(() => result.current.clearDraft());
    act(() => vi.advanceTimersByTime(DEBOUNCE_MS));

    expect(mockSaveDraft).not.toHaveBeenCalled();
    expect(mockDeleteDraft).toHaveBeenCalledTimes(1);
  });
});

describe("useDraft — channel switch", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.useFakeTimers();
    mockGetContextId.mockReturnValue("ctx-123");
    mockGetContextIdentity.mockReturnValue("identity-abc");
    mockGetDraft.mockResolvedValue({ data: "" });
    mockSaveDraft.mockResolvedValue({ data: undefined });
    mockDeleteDraft.mockResolvedValue({ data: undefined });
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it("flushes pending debounced save immediately when channel changes", async () => {
    const { result, rerender } = renderHook(({ ch }) => useDraft(ch), {
      initialProps: { ch: "channel-a" },
    });
    await flushPromises();

    act(() => result.current.setDraft("unsaved text"));
    rerender({ ch: "channel-b" });

    // Flush happens synchronously in the cleanup — no need to advance timers.
    expect(mockSaveDraft).toHaveBeenCalledWith(
      "ctx-123",
      "identity-abc",
      "channel-a",
      "unsaved text",
    );
  });

  it("loads the new channel draft after switching", async () => {
    mockGetDraft
      .mockResolvedValueOnce({ data: "draft-a" })
      .mockResolvedValueOnce({ data: "draft-b" });

    const { result, rerender } = renderHook(({ ch }) => useDraft(ch), {
      initialProps: { ch: "channel-a" },
    });
    await flushPromises();
    expect(result.current.draft).toBe("draft-a");

    rerender({ ch: "channel-b" });
    await flushPromises();

    expect(result.current.draft).toBe("draft-b");
  });

  it("calls getDraft for each channel switch", async () => {
    const { rerender } = renderHook(({ ch }) => useDraft(ch), {
      initialProps: { ch: "channel-a" },
    });
    await flushPromises();

    rerender({ ch: "channel-b" });
    await flushPromises();

    expect(mockGetDraft).toHaveBeenCalledTimes(2);
    expect(mockGetDraft).toHaveBeenNthCalledWith(1, "ctx-123", "identity-abc", "channel-a");
    expect(mockGetDraft).toHaveBeenNthCalledWith(2, "ctx-123", "identity-abc", "channel-b");
  });
});

describe("useDraft — the key is an identity, not a label", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.useFakeTimers();
    mockGetContextId.mockReturnValue("ctx-123");
    mockGetContextIdentity.mockReturnValue("identity-abc");
    mockGetDraft.mockResolvedValue({ data: "" });
    mockSaveDraft.mockResolvedValue({ data: undefined });
    mockDeleteDraft.mockResolvedValue({ data: undefined });
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it("keeps a DM draft reachable when the other person renames themselves", async () => {
    // A DM used to be keyed by the counterpart's DISPLAY NAME. A rename then
    // changed the key: the draft stayed in storage and became unreachable, with
    // nothing to report it. Keyed by the conversation's context instead, the
    // name can change freely.
    const dmContext = "ctx-dm-with-alice";
    mockGetDraft.mockResolvedValue({ data: "unsent reply" });

    const { result, rerender } = renderHook(({ key }) => useDraft(key), {
      initialProps: { key: dmContext },
    });
    await flushPromises();
    expect(result.current.draft).toBe("unsent reply");

    // Alice becomes "Alice (away)". The key does not move with her.
    rerender({ key: dmContext });
    await flushPromises();

    expect(result.current.draft).toBe("unsent reply");
    for (const call of mockGetDraft.mock.calls) {
      expect(call[2]).toBe(dmContext);
    }
  });

  it("reloads when the conversation actually changes", async () => {
    // The flip side: a different key IS a different draft, and must not show
    // the previous conversation's text.
    mockGetDraft.mockResolvedValue({ data: "draft for general" });
    const { result, rerender } = renderHook(({ key }) => useDraft(key), {
      initialProps: { key: "general" },
    });
    await flushPromises();
    expect(result.current.draft).toBe("draft for general");

    mockGetDraft.mockResolvedValue({ data: "draft for random" });
    rerender({ key: "random" });
    await flushPromises();

    expect(result.current.draft).toBe("draft for random");
    expect(mockGetDraft).toHaveBeenLastCalledWith(
      "ctx-123",
      "identity-abc",
      "random",
    );
  });
});
