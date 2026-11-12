import { describe, expect, it, vi } from "vitest";

import { MeroVoteClient } from "./generated/client";
import { decode, u64Arg, type PollView } from "./meroVote";
import { withRoutes } from "@calimero-apps/connect/testing";

describe("the contract through the generated client", () => {
  it("routes calls through the log and views to a node, camelCasing the arguments", async () => {
    const call = vi.fn().mockResolvedValue({ index: 3, result: "digest", events: [] });
    const view = vi.fn().mockResolvedValue({ index: 3, result: [] });
    const after = vi.fn();
    const c = new MeroVoteClient(withRoutes({ call, view }), "app-1", { after });

    const ballot = { choices: [], sum_proof: [] };
    expect(await c.castBallot({ pollId: "p1", ballot })).toBe("digest");
    expect(call).toHaveBeenCalledWith("app-1", "castBallot", { pollId: "p1", ballot });
    await c.listPolls();
    expect(view).toHaveBeenCalledWith("app-1", "listPolls", {});
    expect(after).toHaveBeenCalledTimes(2);
  });

  it("sends a deadline as a decimal string, and none as null", async () => {
    const call = vi.fn().mockResolvedValue({ index: 1, result: "id", events: [] });
    const c = new MeroVoteClient(withRoutes({ call, view: vi.fn() }), "app-1");
    const base = {
      title: "t",
      description: "",
      options: ["a", "b"],
      minChoices: 0,
      maxChoices: 2,
      trustees: ["x"],
      threshold: 1,
      voters: [],
    };
    await c.createPoll({ ...base, closesAt: u64Arg(1_700_000_600_000.7) });
    expect(call.mock.calls[0]![2]).toMatchObject({ minChoices: 0, maxChoices: 2, closesAt: "1700000600000" });
    await c.createPoll({ ...base, closesAt: u64Arg(null) });
    expect(call.mock.calls[1]![2]).toMatchObject({ closesAt: null });
  });

  it("turns every 64-bit field back into a number, at any depth", async () => {
    const wire = {
      poll_id: "p1",
      definition: { title: "t", created_at: "1700000000000", closes_at: null, min_choices: 1 },
      state: {
        phase: "Closed",
        election: { key: "k", opened_at: "1700000000001" },
        closing_at: "1700000000002",
        closure: { counted: [], aggregate: [], closed_at: "1700000000003" },
        anchor: { digest: "d", network: "n", reference: "r", anchored_at: "1700000000004" },
      },
      turnout: [{ voter: "v", digest: "d", cast_at: "1700000000005" }],
      my_digest: "1234",
    };
    const view = vi.fn().mockResolvedValue({ index: 1, result: wire });
    const v = decode<PollView>(await new MeroVoteClient(withRoutes({ call: vi.fn(), view }), "app-1").getPoll({ pollId: "p1" }));
    expect(v.definition.created_at).toBe(1_700_000_000_000);
    expect(v.definition.closes_at).toBeNull();
    expect(v.state.election?.opened_at).toBe(1_700_000_000_001);
    expect(v.state.closing_at).toBe(1_700_000_000_002);
    expect(v.state.closure?.closed_at).toBe(1_700_000_000_003);
    expect(v.state.anchor?.anchored_at).toBe(1_700_000_000_004);
    expect(v.turnout[0]!.cast_at).toBe(1_700_000_000_005);
    // Other strings stay strings, even all-digit ones.
    expect(v.my_digest).toBe("1234");
  });

  it("leaves answers without 64-bit fields as they are", () => {
    expect(decode(["a", 1, null, { counts: [1, 2] }])).toEqual(["a", 1, null, { counts: [1, 2] }]);
  });
});
