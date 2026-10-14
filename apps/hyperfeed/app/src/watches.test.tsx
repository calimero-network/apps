import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { act, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { useEffect, useState } from "react";
import { DemoBackend } from "./demo";
import { useFeed } from "./useFeed";
import { FeedView } from "./FeedView";
import { ChatView } from "./ChatView";
import { nodeBackend, type AppRpc } from "./backend";
import { clearGithubCache } from "./github";
import { fakeGitHub } from "./test/github";
import { describeWatch, newWatch } from "./watches";
import type { HyperfeedClient, WatchInput } from "./generated/HyperfeedClient";

const merge434 = (chain: string): WatchInput => ({
  chain,
  condition: "pr_green",
  repo: "calimero-network/apps",
  pr: 434,
  branch: "",
  action: "merge",
  text: "",
  agent: "mero-bot@studio",
});

describe("watches, in words", () => {
  it("says what each one waits for and does", () => {
    expect(describeWatch(merge434("c"))).toBe("Merge calimero-network/apps#434 when calimero-network/apps#434's checks are green");
    expect(
      describeWatch({ ...merge434("c"), condition: "branch_red", pr: 0, action: "turn", text: "Find the failing check and fix it" }),
    ).toBe("Your agent: Find the failing check and fix it when CI on the default branch of calimero-network/apps goes red");
  });

  it("refuses what the contract refuses", () => {
    expect(() => newWatch({ ...merge434("c"), condition: "pr_red" }, "w", 0)).toThrow(/merge goes with pr_green only/);
    expect(() => newWatch({ ...merge434("c"), pr: 0 }, "w", 0)).toThrow(/needs the pull request's number/);
    expect(() => newWatch({ ...merge434("c"), repo: "apps" }, "w", 0)).toThrow(/owner\/name/);
    expect(() => newWatch({ ...merge434("c"), action: "notify" }, "w", 0)).toThrow(/text must not be empty/);
  });

  it("reads a feed made before watches as having none", async () => {
    const client = {
      watches: () => Promise.reject(Object.assign(new Error("FunctionCallError"), { data: 'method "watches" not found' })),
    } as unknown as HyperfeedClient;
    const rpc: AppRpc = { execute: async () => undefined as never };
    expect(await nodeBackend(client, rpc).watches!("c1")).toEqual([]);
  });
});

function FeedHarness({ backend }: { backend: DemoBackend }) {
  const [nudge, setNudge] = useState(0);
  useEffect(() => backend.subscribe(() => setNudge((n) => n + 1)), [backend]);
  const feed = useFeed(backend, nudge);
  return <FeedView feed={feed} query="" />;
}

function ChatHarness({ backend, chain }: { backend: DemoBackend; chain: string }) {
  const [nudge, setNudge] = useState(0);
  useEffect(() => backend.subscribe(() => setNudge((n) => n + 1)), [backend]);
  const feed = useFeed(backend, nudge);
  return <ChatView feed={feed} chain={chain} onOpen={() => undefined} />;
}

describe("a task's watches", () => {
  beforeEach(() => {
    vi.stubGlobal("fetch", fakeGitHub([]));
  });
  afterEach(() => {
    vi.unstubAllGlobals();
    clearGithubCache();
  });

  it("show on the task while they wait, and Cancel stops one", async () => {
    const backend = new DemoBackend(true, 0);
    render(<FeedHarness backend={backend} />);
    const asked = await act(async () => backend.say("", "Merge #434 when it's green"));
    await act(async () => {
      backend.agentAck(asked.id);
      backend.agentProgress(asked.id, "Setting a watch");
    });
    const tasks = await screen.findByRole("region", { name: "Your tasks" });
    const post = await within(tasks).findByRole("article", { name: "Merge #434 when it's green" });
    expect(within(post).queryByRole("list", { name: "Watches" })).toBeNull();

    const w = await act(async () => backend.addWatch(merge434(asked.chain)));
    const watches = await within(post).findByRole("list", { name: "Watches" });
    expect(watches).toHaveTextContent("Watching");
    expect(watches).toHaveTextContent("Merge calimero-network/apps#434 when");

    await act(async () => {
      fireEvent.click(within(watches).getByRole("button", { name: /^Cancel: Merge calimero-network\/apps#434/ }));
    });
    await waitFor(() => expect(within(post).queryByRole("list", { name: "Watches" })).toBeNull());
    expect((await backend.watches(asked.chain))[0]).toMatchObject({ id: w.id, status: "cancelled" });
  });

  it("show in the chat with where each stands, fired ones too, and a fired one has no Cancel", async () => {
    const backend = new DemoBackend(false, 0);
    const asked = await backend.say("", "Watch main and fix it if red");
    const w = backend.addWatch({ ...merge434(asked.chain), condition: "branch_red", pr: 0, action: "turn", text: "Fix main" });
    render(<ChatHarness backend={backend} chain={asked.chain} />);
    const watches = await screen.findByRole("list", { name: "Watches" });
    expect(within(watches).getByRole("button", { name: /^Cancel/ })).toBeInTheDocument();

    await act(async () => {
      backend.moveWatch(w.id, "firing", "mero-bot@studio#1");
      backend.moveWatch(w.id, "done", "Started a turn: CI on the default branch: 0 of 1 checks passed, failing: ci");
    });
    await waitFor(() => expect(watches).toHaveTextContent("Fired"));
    expect(watches).toHaveTextContent("Started a turn");
    expect(within(watches).queryByRole("button", { name: /^Cancel/ })).toBeNull();
    // It fires once: the demo keeps the contract's rule.
    expect(() => backend.moveWatch(w.id, "firing", "mero-bot@laptop#1")).toThrow(/fires once/);
  });
});
