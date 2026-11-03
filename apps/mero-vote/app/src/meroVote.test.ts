import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it, vi } from "vitest";

import { CALLS, VIEWS, decode, meroVote, type PollView } from "./meroVote";

/** The committed ABI of the contract (`mero-component build`; CI asserts it is current). */
const abi = JSON.parse(readFileSync(resolve(__dirname, "../../logic/res/abi.json"), "utf8")) as {
  methods: Record<string, { kind: string; params: Array<[string, string]> }>;
};

const byKind = (kind: string) =>
  Object.entries(abi.methods)
    .filter(([, m]) => m.kind === kind)
    .map(([name]) => name)
    .sort();

const P = { poll_id: "p1" };
const BRANCH = { c: "c", z: "z" };

describe("the client covers the contract", () => {
  it("calls exactly the contract's calls, and views exactly its views", () => {
    expect([...CALLS].sort()).toEqual(byKind("call"));
    expect([...VIEWS].sort()).toEqual(byKind("view"));
    expect(byKind("init")).toEqual(["init"]);
  });

  it("sends each method the parameter names the ABI declares", async () => {
    const sent = new Map<string, string[]>();
    const record = (_app: string, method: string, args: unknown = {}) => {
      sent.set(method, Object.keys(args as object).sort());
      return Promise.resolve({ index: 1, result: null, events: [] });
    };
    const c = meroVote({ call: vi.fn(record), view: vi.fn(record) }, "app-1");
    await Promise.all([
      c.whoami(),
      c.setName({ name: "Ada" }),
      c.roster(),
      c.createPoll({
        title: "t",
        description: "",
        options: ["a", "b"],
        min_choices: 1,
        max_choices: 1,
        trustees: ["x"],
        threshold: 1,
        voters: [],
        closes_at: null,
      }),
      c.listPolls(),
      c.getPoll(P),
      c.ceremony(P),
      c.publishTransportKey({ ...P, key: "k", proof: BRANCH }),
      c.publishDealing({ ...P, dealing: { commitments: [], proof: BRANCH, shares: [] } }),
      c.fileComplaint({ ...P, dealer: "d", secret: "s", proof: BRANCH }),
      c.openVoting(P),
      c.castBallot({ ...P, ballot: { choices: [], sum_proof: [] } }),
      c.closePoll(P),
      c.sealPoll(P),
      c.tallyInputs(P),
      c.publishPartial({ ...P, partials: [] }),
      c.getResult(P),
      c.getTranscript(P),
      c.anchorResult({ ...P, network: "git", reference: "v1" }),
    ]);
    for (const [name, method] of Object.entries(abi.methods)) {
      if (method.kind === "init") continue;
      expect(sent.get(name), name).toEqual(method.params.map(([p]) => p).sort());
    }
  });
});

describe("meroVote", () => {
  it("routes calls through the log and views to a node, camelCasing the arguments", async () => {
    const call = vi.fn().mockResolvedValue({ index: 3, result: "digest", events: [] });
    const view = vi.fn().mockResolvedValue({ index: 3, result: [] });
    const after = vi.fn();
    const c = meroVote({ call, view }, "app-1", after);

    const ballot = { choices: [], sum_proof: [] };
    expect(await c.castBallot({ poll_id: "p1", ballot })).toBe("digest");
    expect(call).toHaveBeenCalledWith("app-1", "castBallot", { pollId: "p1", ballot });
    await c.listPolls();
    expect(view).toHaveBeenCalledWith("app-1", "listPolls", {});
    expect(after).toHaveBeenCalledTimes(2);
  });

  it("sends a deadline as a decimal string, and none as null", async () => {
    const call = vi.fn().mockResolvedValue({ index: 1, result: "id", events: [] });
    const c = meroVote({ call, view: vi.fn() }, "app-1");
    const base = {
      title: "t",
      description: "",
      options: ["a", "b"],
      min_choices: 0,
      max_choices: 2,
      trustees: ["x"],
      threshold: 1,
      voters: [],
    };
    await c.createPoll({ ...base, closes_at: 1_700_000_600_000 });
    expect(call.mock.calls[0]![2]).toMatchObject({ minChoices: 0, maxChoices: 2, closesAt: "1700000600000" });
    await c.createPoll({ ...base, closes_at: null });
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
    const v: PollView = await meroVote({ call: vi.fn(), view }, "app-1").getPoll({ poll_id: "p1" });
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
