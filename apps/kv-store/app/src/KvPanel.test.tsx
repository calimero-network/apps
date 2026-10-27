import { cleanup, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

// ── When a just-joined context counts as arrived ─────────────────────────────
//
// The invitation dialog holds "Syncing…" until this panel clears the joined
// namespace's flag. It must do so on the first read of the entries that comes
// back, EMPTY included: an empty map is an answer, and only a read that fails
// (the node does not hold the context's state yet) is still waiting.

const entries = vi.fn();
vi.mock("./useKvStore", () => ({ useKvStore: () => ({ entries }) }));

const NAMESPACE = "ns-1";
vi.mock("@calimero-apps/cloud", async (importOriginal) => ({
  ...(await importOriginal<Record<string, unknown>>()),
  useContextGroup: () => ({ groupId: NAMESPACE, loading: false, error: null }),
}));

const { isNamespaceJustJoined, markNamespaceJustJoined } = await import(
  "@calimero-apps/cloud"
);
const { KvPanel } = await import("./KvPanel");

beforeEach(() => {
  entries.mockReset();
  sessionStorage.clear();
  markNamespaceJustJoined(NAMESPACE);
});

afterEach(() => {
  cleanup();
  vi.useRealTimers();
  sessionStorage.clear();
});

describe("KvPanel after a join", () => {
  it("counts an empty map as arrived", async () => {
    entries.mockResolvedValue({});
    render(<KvPanel contextId="ctx-1" />);

    await waitFor(() => expect(isNamespaceJustJoined(NAMESPACE)).toBe(false));
    expect(screen.getByText("Empty.")).toBeTruthy();
  });

  it("keeps waiting while the read fails, and stops at the first one that answers", async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true });
    // The read after the failing one answers only when the test says so. With
    // time still advancing, the poll can fire while the test is looking for
    // the syncing text; an answer it gave on its own would clear the flag
    // before the assertion below, which is a race in the test, not the panel.
    let answer!: (value: Record<string, string>) => void;
    const answered = new Promise<Record<string, string>>((resolve) => {
      answer = resolve;
    });
    entries
      .mockRejectedValueOnce(new Error("context state not found"))
      .mockImplementation(() => answered);
    render(<KvPanel contextId="ctx-1" />);

    expect(
      await screen.findByText("Syncing from the other members…"),
    ).toBeTruthy();
    expect(isNamespaceJustJoined(NAMESPACE)).toBe(true);

    answer({ greeting: "hello" });
    await vi.advanceTimersByTimeAsync(2_500);
    await waitFor(() => expect(isNamespaceJustJoined(NAMESPACE)).toBe(false));
    expect(screen.getByText("hello")).toBeTruthy();
  });
});
