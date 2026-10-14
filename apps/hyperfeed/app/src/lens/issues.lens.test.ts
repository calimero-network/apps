import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { fillReplyCall, parseLens, runLens, type LensHost } from "./lens";
import { validateLens, type Abi } from "./validate";

const APPS = path.resolve(__dirname, "../../../..");
const abi = JSON.parse(readFileSync(path.join(APPS, "mero-issue-tracker/logic/res/abi.json"), "utf8")) as Abi;
const lens = parseLens(readFileSync(path.join(__dirname, "fixtures", "issues.json"), "utf8"));

// Accounts as mero-issue-tracker writes them (`caller()`): 32 bytes, hex.
const ME_HEX = "11".repeat(32);
const MAYA = "22".repeat(32);
const PRIYA = "33".repeat(32);
const ME = new Set([ME_HEX, "me-b58"]);
const SOURCE = { contextId: "ctx-iss", appKey: "issues", label: "issues · ctx-is" };

const issueView = (extra: Record<string, unknown> = {}) => ({
  id: "issue-1",
  title: "Sync stalls after reconnect",
  summary: "Peers stop syncing after a network flap.",
  impact: "Data diverges",
  repro: "Toggle wifi",
  resolution_criteria: "Sync resumes",
  status: "Open",
  priority: "high",
  assignee: null as string | null,
  labels: ["sync"],
  created_by: MAYA,
  created_at: 1_760_000_000_000,
  ...extra,
});
const comment = (id: string, author: string, body: string, created_at: number) => ({
  id,
  issue_id: "issue-1",
  author,
  body,
  created_at,
  edited_at: null,
});

/** mero-issue-tracker's get_issue as the caller sees it: the issue and its thread, oldest first. */
function issuesHost(issue: ReturnType<typeof issueView>, comments: ReturnType<typeof comment>[] = []): LensHost & { calls: string[] } {
  const calls: string[] = [];
  return {
    calls,
    me: async () => ME,
    name: async (id) => (id === MAYA ? "Maya" : id === PRIYA ? "Priya" : ""),
    call: async <T,>(method: string, args: Record<string, unknown>) => {
      calls.push(method);
      if (method === "get_issue" && args.issue_id === issue.id) return { issue, comments } as T;
      throw new Error(`no method ${method}`);
    },
  };
}

describe("issues lens", () => {
  it("is valid against mero-issue-tracker's ABI", () => {
    expect(validateLens(lens, abi)).toEqual([]);
  });

  it("records a teammate's comment on your issue, answerable with a comment", async () => {
    const host = issuesHost(issueView({ created_by: ME_HEX }), [
      comment("comment-1", MAYA, "Seen it too", 1),
      comment("comment-2", PRIYA, "I can reproduce on main.", 2),
    ]);
    const out = await runLens(lens, "CommentAdded", { id: "comment-2", issue_id: "issue-1" }, SOURCE, host);
    expect(out.kind).toBe("recorded");
    if (out.kind !== "recorded") return;
    expect(out.reading).toMatchObject({
      item_type: "message",
      title: "Commented on your issue Sync stalls after reconnect",
      from: "Priya",
      body: "I can reproduce on main.",
      source_label: "Issue: Sync stalls after reconnect",
      needs_you: true,
      ask: { kind: "reply", prompt: "Comment on the issue" },
    });
    expect(JSON.parse(out.reading.fields)).toMatchObject({ from_id: PRIYA, is_dm: false });
    expect(fillReplyCall(out.reading.reply_call, "Fixed in #42")).toEqual({
      method: "add_comment",
      args: { issue_id: "issue-1", body: "Fixed in #42" },
    });
  });

  it("records a comment on an issue assigned to you", async () => {
    const host = issuesHost(issueView({ assignee: ME_HEX }), [comment("comment-1", MAYA, "Any news?", 1)]);
    const out = await runLens(lens, "CommentAdded", { id: "comment-1", issue_id: "issue-1" }, SOURCE, host);
    expect(out.kind).toBe("recorded");
    if (out.kind === "recorded") expect(out.reading.title).toBe("Commented on Sync stalls after reconnect (assigned to you)");
  });

  it("skips your own comment, and comments on issues that are not yours", async () => {
    const own = issuesHost(issueView({ created_by: ME_HEX }), [comment("comment-1", ME_HEX, "Note to self", 1)]);
    expect((await runLens(lens, "CommentAdded", { id: "comment-1", issue_id: "issue-1" }, SOURCE, own)).kind).toBe("skipped");
    const theirs = issuesHost(issueView({ assignee: PRIYA }), [comment("comment-1", PRIYA, "On it", 1)]);
    expect((await runLens(lens, "CommentAdded", { id: "comment-1", issue_id: "issue-1" }, SOURCE, theirs)).kind).toBe("skipped");
    // The newest comment is not the event's (it synced out of order): skipped, not misattributed.
    const later = issuesHost(issueView({ created_by: ME_HEX }), [comment("comment-1", MAYA, "a", 1), comment("comment-2", PRIYA, "b", 2)]);
    expect((await runLens(lens, "CommentAdded", { id: "comment-1", issue_id: "issue-1" }, SOURCE, later)).kind).toBe("skipped");
  });

  it("records an issue assigned to you", async () => {
    const host = issuesHost(issueView({ assignee: ME_HEX }));
    const out = await runLens(lens, "IssueAssigneeChanged", { id: "issue-1" }, SOURCE, host);
    expect(out.kind).toBe("recorded");
    if (out.kind !== "recorded") return;
    expect(out.reading).toMatchObject({
      item_type: "assignment",
      title: "Assigned to you: Sync stalls after reconnect",
      body: "high priority · Open\nPeers stop syncing after a network flap.",
      source_label: "Issues",
      needs_you: true,
      reply_call: "",
    });
    expect(JSON.parse(out.reading.fields)).toMatchObject({ what: "Sync stalls after reconnect" });
  });

  it("skips an assignment to someone else, or to yourself on your own issue", async () => {
    const other = issuesHost(issueView({ assignee: PRIYA }));
    expect((await runLens(lens, "IssueAssigneeChanged", { id: "issue-1" }, SOURCE, other)).kind).toBe("skipped");
    const self = issuesHost(issueView({ assignee: ME_HEX, created_by: ME_HEX }));
    expect((await runLens(lens, "IssueAssigneeChanged", { id: "issue-1" }, SOURCE, self)).kind).toBe("skipped");
  });

  it("ignores bookkeeping", async () => {
    const host = issuesHost(issueView());
    const out = await runLens(lens, "IssueStatusChanged", { id: "issue-1", status: "Done" }, SOURCE, host);
    expect(out).toEqual({ kind: "skipped", why: "IssueStatusChanged is ignored" });
    expect(host.calls).toEqual([]);
  });

  it("names every event the app emits", () => {
    expect(Object.keys(lens.events).sort()).toEqual(abi.events.map((e) => e.name).sort());
  });
});
