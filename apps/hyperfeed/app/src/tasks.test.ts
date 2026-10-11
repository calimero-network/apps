import { describe, expect, it } from "vitest";
import type { FeedItem } from "./generated/HyperfeedClient";
import { taskCandidates, taskOf, taskStatus } from "./tasks";

const NOW = new Date(2026, 9, 10, 15, 0).getTime();

function row(over: Partial<FeedItem>): FeedItem {
  return {
    id: "r", kind: "message", chain: "c1", chain_len: 1, chain_at: NOW - 60_000, app: "", source_context: "", source_label: "", title: "", body: "",
    at: NOW - 60_000, needs_you: false, status: "waiting", status_at: NOW - 60_000, note: "", ask: { kind: "", prompt: "", options: [], draft: "" },
    history: [{ status: "waiting", note: "", at: NOW - 60_000 }], method: "", category: "", why: "", intent_hash: "", executor: "", undoable: false,
    breach: "", reviewed_at: 0, from: "you", event: "", seen: true, reply_to: "", item_type: "", fields: "", reply_call: "", doing: "", doing_at: 0,
    attachments: [], steps: [], draft: "", stop_at: 0, headline: "", ...over,
  };
}

const appName = (k: string) => ({ "mero-issue-tracker": "Issues", "mero-bot": "This computer" })[k] ?? k;

const ask = row({ id: "c1", body: "Fix the agent digest card\nIt counts reads.", status: "thinking", doing: "Running the tests in apps", doing_at: NOW - 12_000 });
const ran = row({
  id: "a1", kind: "action", from: "", app: "mero-bot", title: "Bash: run the tests", status: "done", at: NOW - 30_000,
  history: [{ status: "done", note: "", at: NOW - 30_000 }],
});
const xabi = row({
  id: "n1", kind: "notification", from: "Xabi", app: "mero-issue-tracker", title: "Commented on the issue", status: "received", at: NOW - 20_000,
  history: [{ status: "received", note: "", at: NOW - 20_000 }],
});

describe("taskOf", () => {
  it("tells a chain you started as a post: goal, people, apps, status, live step", () => {
    const t = taskOf([ask, ran, xabi], { ...ask, chain_at: NOW - 12_000 }, appName, NOW)!;
    expect(t.goal).toBe("Fix the agent digest card");
    expect(t.people).toEqual([{ name: "Xabi", initials: "XA" }]);
    expect(t.apps).toEqual(["mero-bot", "mero-issue-tracker"]);
    expect(t.status).toEqual({ label: "Working", tone: "busy" });
    expect(t.live).toBe("Running the tests in apps · 12 s ago");
    // No PR, CI or merge yet: no milestones to tell.
    expect(t.track).toEqual([]);
  });

  it("carries the chain's milestones once there is a PR", () => {
    const pr = row({ id: "m1", kind: "message", from: "agent", body: "Opened PR #436", title: "Opened PR #436", status: "said", at: NOW - 10_000, history: [{ status: "said", note: "", at: NOW - 10_000 }] });
    const t = taskOf([ask, pr], { ...ask, chain_at: NOW - 10_000 }, appName, NOW)!;
    expect(t.track.map((m) => m.label)).toEqual(["Filed", "PR #436", "Working"]);
  });

  it("falls back to the last step once your agent is done", () => {
    const answered = { ...ask, status: "answered", doing: "" };
    const reply = row({ id: "m2", from: "agent", body: "Fixed in PR #420.", status: "said", reply_to: "c1", at: NOW - 5_000, history: [{ status: "said", note: "", at: NOW - 5_000 }] });
    const t = taskOf([answered, ran, reply], reply, appName, NOW)!;
    expect(t.status).toEqual({ label: "Done", tone: "good" });
    expect(t.live).toBe("Your agent: Fixed in PR #420.");
  });

  it("shows no live line while your question is all there is", () => {
    const fresh = { ...ask, status: "waiting", doing: "" };
    expect(taskOf([fresh], fresh, appName, NOW)!.live).toBe("");
  });

  it("is not a task when the chain starts with anything but your message", () => {
    expect(taskOf([xabi, ran], ran, appName, NOW)).toBeNull();
    expect(taskOf([], ran, appName, NOW)).toBeNull();
  });
});

describe("taskStatus", () => {
  it("says when your agent asks you, or anything else needs you", () => {
    expect(taskStatus(row({ from: "agent", status: "asked", needs_you: true }))).toEqual({ label: "Asks you", tone: "wait" });
    expect(taskStatus(row({ kind: "action", status: "pending", needs_you: true }))).toEqual({ label: "Needs you", tone: "wait" });
    expect(taskStatus(row({ kind: "action", status: "failed" }))).toEqual({ label: "Failed", tone: "bad" });
  });
});

describe("taskCandidates", () => {
  it("keeps your agent's chains that are live or moved today, newest first", () => {
    const old = row({ id: "o", chain: "old", status: "answered", chain_at: NOW - 3 * 86_400_000 });
    const today = row({ id: "t", chain: "today", status: "answered", chain_at: NOW - 3_600_000 });
    const working = row({ id: "w", chain: "w", status: "thinking", chain_at: NOW - 2 * 86_400_000 });
    expect(taskCandidates([old, xabi, working, today], NOW).map((i) => i.chain)).toEqual(["today", "w"]);
  });
});
