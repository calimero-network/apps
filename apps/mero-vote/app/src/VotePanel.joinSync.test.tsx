// Right after joining from an invitation the node may not hold the context's
// state yet: the read fails (`Uninitialized`), and no event follows when the
// state lands. The panel used to re-read only on events, so the invitation
// dialog sat on "Syncing…" and the polls never showed; it now re-reads on a
// timer while the gate is up. A read that succeeds is the context having
// arrived, so an empty poll list then is a real answer.

import { act, cleanup, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { isNamespaceJustJoined, markNamespaceJustJoined, JOIN_SYNC_POLL_MS } from "@calimero-apps/cloud";

const ME = "a".repeat(64);

vi.mock("@calimero-apps/cloud", async (orig) => ({
  ...(await orig<typeof import("@calimero-apps/cloud")>()),
  useMero: () => ({ admin: null, mero: null }),
  useContextGroup: () => ({ groupId: "ns1", loading: false, error: null }),
  useSubscription: () => undefined,
}));

const node = vi.hoisted(() => ({ polls: [] as unknown[], synced: true }));
const client = {
  whoami: vi.fn().mockResolvedValue({ account: ME }),
  roster: vi.fn().mockResolvedValue([]),
  listPolls: vi.fn(async () => {
    if (!node.synced) throw new Error("Uninitialized");
    return node.polls;
  }),
  setName: vi.fn().mockResolvedValue(undefined),
};
vi.mock("./useMeroVote", async (orig) => ({
  ...(await orig<typeof import("./useMeroVote")>()),
  useMeroVote: () => client,
}));

const { VotePanel } = await import("./VotePanel");

const advance = (ms: number) => act(() => vi.advanceTimersByTimeAsync(ms));

beforeEach(() => {
  vi.useFakeTimers({ shouldAdvanceTime: true });
  sessionStorage.clear();
  node.polls = [];
  node.synced = true;
  client.listPolls.mockClear();
});

afterEach(() => {
  cleanup();
  vi.useRealTimers();
});

describe("VotePanel right after joining", () => {
  it("re-reads a context that has not synced yet until its polls arrive", async () => {
    markNamespaceJustJoined("ns1");
    node.synced = false;
    render(<VotePanel contextId="ctx1" joinedNamespace="ns1" />);
    await advance(100);
    expect(client.listPolls).toHaveBeenCalledTimes(1);
    expect(isNamespaceJustJoined("ns1")).toBe(true);

    await advance(JOIN_SYNC_POLL_MS);
    expect(client.listPolls.mock.calls.length).toBeGreaterThan(1);
    expect(isNamespaceJustJoined("ns1")).toBe(true);

    // The state lands with no live event to announce it.
    node.synced = true;
    node.polls = [{ poll_id: "p1", title: "Lunch", creator: ME, phase: "Voting", created_at: 0, ballots: 0 }];
    await advance(JOIN_SYNC_POLL_MS);

    expect(await screen.findByText("Lunch")).toBeTruthy();
    expect(isNamespaceJustJoined("ns1")).toBe(false);
    const reads = client.listPolls.mock.calls.length;
    await advance(JOIN_SYNC_POLL_MS * 2);
    expect(client.listPolls.mock.calls.length).toBe(reads);
  });

  it("settles on an empty poll list once the context has synced", async () => {
    markNamespaceJustJoined("ns1");
    render(<VotePanel contextId="ctx1" joinedNamespace="ns1" />);
    await advance(100);
    expect(isNamespaceJustJoined("ns1")).toBe(false);
  });
});
