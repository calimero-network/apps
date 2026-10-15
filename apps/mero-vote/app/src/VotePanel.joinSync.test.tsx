// Right after joining from an invitation the node may not hold the context's
// polls yet: the read comes back empty, and no event follows when they land.
// That empty list is not the context's real answer, so it may not settle the
// join-sync gate (which closes the invitation dialog onto "No polls yet"); the
// panel re-reads on a timer until the polls arrive.

import { act, cleanup, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { isNamespaceJustJoined, markNamespaceJustJoined, JOIN_SYNC_POLL_MS } from "@calimero-network/mero-react";

const ME = "a".repeat(64);

vi.mock("@calimero-network/mero-react", async (orig) => ({
  ...(await orig<typeof import("@calimero-network/mero-react")>()),
  useMero: () => ({ admin: null, mero: null }),
  useContextGroup: () => ({ groupId: "ns1", loading: false, error: null }),
  useSubscription: () => undefined,
}));

const node = vi.hoisted(() => ({ polls: [] as unknown[] }));
const client = {
  whoami: vi.fn().mockResolvedValue({ account: ME }),
  roster: vi.fn().mockResolvedValue([]),
  listPolls: vi.fn(async () => node.polls),
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
  client.listPolls.mockClear();
});

afterEach(() => {
  cleanup();
  vi.useRealTimers();
});

describe("VotePanel right after joining", () => {
  it("does not settle on an empty poll list, and re-reads until the polls arrive", async () => {
    markNamespaceJustJoined("ns1");
    render(<VotePanel contextId="ctx1" joinedNamespace="ns1" />);
    await advance(100);
    expect(client.listPolls).toHaveBeenCalledTimes(1);
    expect(isNamespaceJustJoined("ns1")).toBe(true);

    await advance(JOIN_SYNC_POLL_MS);
    expect(client.listPolls.mock.calls.length).toBeGreaterThan(1);
    expect(isNamespaceJustJoined("ns1")).toBe(true);

    // The polls land with no live event to announce them.
    node.polls = [{ poll_id: "p1", title: "Lunch", creator: ME, phase: "Voting", created_at: 0, ballots: 0 }];
    await advance(JOIN_SYNC_POLL_MS);

    expect(await screen.findByText("Lunch")).toBeTruthy();
    expect(isNamespaceJustJoined("ns1")).toBe(false);
  });

  it("settles on an empty poll list at once when not just joined", async () => {
    render(<VotePanel contextId="ctx1" />);
    await advance(100);
    expect(isNamespaceJustJoined("ns1")).toBe(false);
    const reads = client.listPolls.mock.calls.length;
    await advance(JOIN_SYNC_POLL_MS * 2);
    expect(client.listPolls.mock.calls.length).toBe(reads);
  });
});
