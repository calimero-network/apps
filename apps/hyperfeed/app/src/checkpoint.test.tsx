import { describe, expect, it } from "vitest";
import { act, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { useEffect, useState } from "react";
import { FeedView } from "./FeedView";
import { DemoBackend } from "./demo";
import { useFeed } from "./useFeed";
import { nodeBackend } from "./backend";
import { checkpointByline, checkpointSections, prHref, type CheckpointView } from "./checkpoint";
import type { CheckpointInput, HyperfeedClient } from "./generated/HyperfeedClient";

const NOW = 1_800_000_000_000;

const view = (over: Partial<CheckpointView> = {}): CheckpointView => ({
  chain: "c1",
  done: "Found the bug",
  next: "Write the fix",
  branches: ["mero-bot/chain-1"],
  worktrees: [],
  prs: ["calimero-network/apps#12"],
  questions: [],
  author: "mero-bot@studio",
  updated_at: NOW - 4 * 60_000,
  ...over,
});

const input = (over: Partial<CheckpointInput> = {}): CheckpointInput => ({
  done: "Found the bug in the digest card",
  next: "Open a PR once the tests pass",
  branches: ["mero-bot/chain-1"],
  worktrees: ["/w/apps-chain-1"],
  prs: ["calimero-network/apps#12"],
  questions: ["Squash or merge?"],
  author: "mero-bot@studio",
  ...over,
});

describe("a checkpoint, read", () => {
  it("lists what it says, in order, leaving out what is empty", () => {
    expect(checkpointSections(view()).map((s) => s.label)).toEqual(["Done", "Next", "PRs", "Branches"]);
    expect(checkpointSections(view({ done: "", next: "", branches: [], prs: [] }))).toEqual([]);
  });

  it("says who wrote it and when", () => {
    expect(checkpointByline(view(), NOW)).toBe("mero-bot on studio · 4 min");
    expect(checkpointByline(view({ author: "" }), NOW)).toBe("Your agent · 4 min");
  });

  it("links a PR by URL or owner/repo#n", () => {
    expect(prHref("calimero-network/apps#12")).toBe("https://github.com/calimero-network/apps/pull/12");
    expect(prHref("https://github.com/x/y/pull/3")).toBe("https://github.com/x/y/pull/3");
    expect(prHref("the big PR")).toBeNull();
  });
});

describe("the demo keeps checkpoints as the contract does", () => {
  it("keeps one per chain, the latest replacing the last, and checks it", async () => {
    const backend = new DemoBackend(false, 0);
    const asked = await backend.say("", "Fix the digest card");
    expect(await backend.checkpoint(asked.chain)).toBeNull();
    const first = backend.setCheckpoint(asked.chain, input());
    const second = backend.setCheckpoint(asked.chain, input({ done: "  PR open  ", questions: ["", "Merge?"] }));
    expect(second.updated_at).toBeGreaterThan(first.updated_at);
    expect(await backend.checkpoint(asked.chain)).toMatchObject({ done: "PR open", questions: ["Merge?"] });
    expect(() => backend.setCheckpoint("no-chain", input())).toThrow(/no chain/);
    expect(() => backend.setCheckpoint(asked.chain, input({ done: "", next: " " }))).toThrow();
    expect(() => backend.setCheckpoint(asked.chain, input({ prs: Array.from({ length: 11 }, (_, n) => `#${n}`) }))).toThrow();
  });
});

describe("the node backend", () => {
  it("reads a feed made before checkpoints as having none", async () => {
    const client = {
      checkpoint: () => Promise.reject({ type: "FunctionCallError", data: 'method "checkpoint" not found' }),
    } as unknown as HyperfeedClient;
    const backend = nodeBackend(client, { execute: async () => undefined as never });
    expect(await backend.checkpoint!("c1")).toBeNull();
  });

  it("reads no checkpoint as null", async () => {
    const client = { checkpoint: () => Promise.resolve(null) } as unknown as HyperfeedClient;
    expect(await nodeBackend(client, { execute: async () => undefined as never }).checkpoint!("c1")).toBeNull();
  });
});

function Harness({ backend }: { backend: DemoBackend }) {
  const [nudge, setNudge] = useState(0);
  useEffect(() => backend.subscribe(() => setNudge((n) => n + 1)), [backend]);
  const feed = useFeed(backend, nudge);
  return <FeedView feed={feed} query="" />;
}

describe("a task's checkpoint in the feed", () => {
  it("shows behind Where it stands on the task, and the latest one", async () => {
    const backend = new DemoBackend(true, 0);
    render(<Harness backend={backend} />);
    const asked = await act(async () => backend.say("", "Fix the agent digest card"));
    await act(async () => {
      backend.agentAck(asked.id);
      backend.agentProgress(asked.id, "Running the tests in apps");
    });
    const tasks = await screen.findByRole("region", { name: "Your tasks" });
    const post = await within(tasks).findByRole("article", { name: "Fix the agent digest card" });
    // No checkpoint yet: nothing behind the post.
    expect(within(post).queryByText("Where it stands")).toBeNull();

    await act(async () => {
      backend.setCheckpoint(asked.chain, input());
    });
    const stands = await within(post).findByText("Where it stands");
    await act(async () => {
      fireEvent.click(stands);
    });
    expect(post).toHaveTextContent("Found the bug in the digest card");
    expect(post).toHaveTextContent("Open a PR once the tests pass");
    expect(post).toHaveTextContent("Squash or merge?");
    expect(within(post).getByRole("link", { name: "calimero-network/apps#12" })).toHaveAttribute(
      "href",
      "https://github.com/calimero-network/apps/pull/12",
    );
    expect(post).toHaveTextContent("mero-bot on studio");

    await act(async () => {
      backend.setCheckpoint(asked.chain, input({ done: "PR #12 is open", next: "Merge once CI is green" }));
    });
    await waitFor(() => expect(post).toHaveTextContent("Merge once CI is green"));
    expect(post).not.toHaveTextContent("Open a PR once the tests pass");
  });
});
