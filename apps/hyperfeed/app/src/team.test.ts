import { describe, expect, it } from "vitest";
import type { FeedItem } from "./generated/HyperfeedClient";
import { agentDigest, digestLine, groupSentence, headlineOf, isNoise, line, teamGroups } from "./team";

const NOW = new Date(2026, 9, 9, 15, 0).getTime();
const appName = (k: string) => ({ issues: "Issues", chat: "Chat" })[k] ?? k;

let n = 0;
function row(over: Partial<FeedItem>): FeedItem {
  const at = over.at ?? NOW - 60_000;
  return {
    id: `r${n++}`,
    kind: "notification",
    chain: `c${n}`,
    chain_len: 1,
    chain_at: at,
    app: "issues",
    source_context: "ctx",
    source_label: "",
    title: "",
    body: "",
    at,
    needs_you: false,
    status: "received",
    status_at: at,
    note: "",
    ask: { kind: "", prompt: "", options: [], draft: "" },
    history: [],
    method: "",
    category: "",
    why: "",
    intent_hash: "",
    executor: "",
    undoable: false,
    breach: "",
    reviewed_at: 0,
    from: "",
    event: "",
    seen: true,
    reply_to: "",
    item_type: "",
    fields: "",
    reply_call: "",
    doing: "",
    doing_at: 0,
    attachments: [],
    ...over,
  };
}

const comment = (from: string, at: number) =>
  row({ from, title: "Commented on an issue", fields: JSON.stringify({ from, what: "Create my feed fails" }), at, chain_at: at });

describe("the team view's reading of the feed", () => {
  it("tells a row as a person doing something to something", () => {
    const h = headlineOf(
      row({ from: "Xabi", title: "Assigned you an issue", item_type: "assignment", fields: JSON.stringify({ from: "Xabi", what: "Create my feed fails" }) }),
      appName,
    );
    expect(h).toMatchObject({ who: "Xabi", initials: "XA", verb: "assigned you an issue", object: "Create my feed fails", person: true });
    expect(headlineOf(row({ kind: "action", status: "pending", title: "Send the deck to Maya" }), appName)).toMatchObject({
      who: "Your agent",
      verb: "",
      object: "Send the deck to Maya",
      person: false,
    });
    // The title already names the subject: it is not said twice.
    expect(
      headlineOf(row({ from: "Tomás", title: "Assigned HF-31 to you", fields: JSON.stringify({ from: "Tomás", what: "HF-31" }) }), appName),
    ).toMatchObject({ verb: "assigned HF-31 to you", object: "" });
    expect(headlineOf(row({ title: "Build failed" }), appName).who).toBe("Issues");
  });

  it("keeps a card's text to its first line", () => {
    expect(line("Done in code.\n\nMore below")).toBe("Done in code.");
    expect(line("x".repeat(200), 10)).toBe("xxxxxxxxx…");
  });

  it("hides the reads your agent made, never what needs you", () => {
    expect(isNoise(row({ kind: "action", status: "done", method: "mero_issue_tracker_i_get_issue" }))).toBe(true);
    expect(isNoise(row({ kind: "action", status: "done", method: "list_docs" }))).toBe(true);
    expect(isNoise(row({ kind: "action", status: "done", method: "create_issue" }))).toBe(false);
    expect(isNoise(row({ kind: "action", status: "pending", needs_you: true, method: "get_issue" }))).toBe(false);
    expect(isNoise(row({ kind: "action", status: "done", method: "budget_update" }))).toBe(false);
  });

  it("groups your team's updates on one subject into one card with every face", () => {
    const groups = teamGroups(
      [comment("Xabi", NOW - 3_000), comment("Maya", NOW - 2_000), comment("Xabi", NOW - 1_000), row({ from: "Priya", title: "Opened a poll", fields: JSON.stringify({ question: "Offsite" }) })],
      appName,
    );
    expect(groups).toHaveLength(2);
    expect(groups[0]).toMatchObject({ subject: "Create my feed fails", at: NOW - 1_000 });
    expect(groups[0]!.items).toHaveLength(3);
    expect(groups[0]!.people.map((p) => p.name)).toEqual(["Xabi", "Maya"]);
  });

  it("groups by the issue, not by the comment's text, as the issue-tracker lens records them", () => {
    // The approved issue-tracker lens: a comment is { from, text, where: "Issue: <title>" }; a status move is { from, what: <title>, where: <repo> }.
    const said = (from: string, text: string, issue: string, at: number) =>
      row({ from, title: "Commented on your issue", item_type: "message", fields: JSON.stringify({ from, text, where: `Issue: ${issue}`, is_dm: false }), at, chain_at: at });
    const moved = (from: string, issue: string, at: number) =>
      row({ from, title: "Your issue is now Done", item_type: "change", fields: JSON.stringify({ from, what: issue, summary: "Moved to Done", where: "https://github.com/calimero-network/apps" }), at, chain_at: at });
    const groups = teamGroups(
      [
        said("Xabi", "Seen it on rc.83 too.", "Create my feed fails", NOW - 5_000),
        said("Maya", "The namespace step works, the context step doesn't.", "Create my feed fails", NOW - 4_000),
        moved("Priya", "Create my feed fails", NOW - 3_000),
        said("Maya", "Looking now.", "Token expires in minutes", NOW - 2_000),
        // Assigned to you: it needs you, so it is in the strip above, not here.
        row({ from: "Xabi", title: "Assigned you an issue", item_type: "assignment", needs_you: true, fields: JSON.stringify({ from: "Xabi", what: "Hide plumbing rows" }) }),
      ],
      appName,
    );
    expect(groups.map((g) => [g.subject, g.items.length])).toEqual([
      ["Issue: Token expires in minutes", 1],
      ["Issue: Create my feed fails", 3],
    ]);
    const feed = groups[1]!;
    // Whoever acted last leads; every face is on the card once.
    expect(feed.people.map((p) => p.name)).toEqual(["Priya", "Xabi", "Maya"]);
    expect(groupSentence(feed, appName)).toMatchObject({ who: "Priya and 2 others", verb: "your issue is now Done", object: "Issue: Create my feed fails", person: true });
    expect(groupSentence(groups[0]!, appName)).toMatchObject({ who: "Maya", verb: "commented on your issue", object: "Issue: Token expires in minutes" });
  });

  it("says who acted: one name, two names, or the latest and how many others", () => {
    const at = (s: number) => NOW - s * 1_000;
    const said = (from: string, s: number) =>
      row({ app: "chat", title: "Mentioned you", fields: JSON.stringify({ from, text: `hi ${s}`, where: "#launch", is_dm: false }), at: at(s), chain_at: at(s) });
    const [two] = teamGroups([said("Maya", 2), said("Xabi", 1)], appName);
    expect(groupSentence(two!, appName)).toMatchObject({ who: "Xabi and Maya", verb: "mentioned you", object: "#launch" });
    const [one] = teamGroups([said("Maya", 2), said("Maya", 1)], appName);
    expect(groupSentence(one!, appName).who).toBe("Maya");
  });

  it("keeps DMs from different people apart", () => {
    const dm = (from: string) => row({ app: "chat", title: "Sent you a message", fields: JSON.stringify({ from, text: "ping", where: "DM", is_dm: true }) });
    expect(teamGroups([dm("Maya"), dm("Xabi"), dm("Maya")], appName).map((g) => [g.subject, g.items.length])).toEqual(
      expect.arrayContaining([
        ["DM from Maya", 2],
        ["DM from Xabi", 1],
      ]),
    );
  });

  it("leaves what needs you, and your agent's rows, out of the team's activity", () => {
    const groups = teamGroups([row({ from: "Xabi", needs_you: true, title: "Assigned you" }), row({ kind: "action", status: "done", title: "Posted" })], appName);
    expect(groups).toEqual([]);
  });

  it("sums up your agent's day in one line", () => {
    const yesterday = NOW - 86_400_000;
    const d = agentDigest(
      [
        row({ kind: "action", status: "done", method: "create_issue" }),
        row({ kind: "action", status: "done", method: "send_message" }),
        row({ kind: "action", status: "done", method: "get_issue" }),
        row({ kind: "action", status: "failed", method: "move_deal" }),
        row({ kind: "action", status: "approved", method: "book" }),
        row({ kind: "action", status: "pending", needs_you: true, method: "sign" }),
        row({ kind: "message", from: "agent", status: "said" }),
        row({ kind: "message", from: "you", status: "thinking" }),
        row({ kind: "action", status: "done", method: "old", at: yesterday, chain_at: yesterday }),
        row({ from: "Xabi", title: "Mentioned you" }),
      ],
      NOW,
    );
    expect(d).toMatchObject({ filed: 1, done: 1, failed: 1, working: 2, answered: 1, waiting: 1 });
    // What needs you is counted, not listed: it is in the strip on top.
    expect(d.items).toHaveLength(6);
    expect(digestLine(d)).toBe("Filed 1 issue, did 1 other thing, answered 1 message, 2 in progress, 1 failed, 1 waiting on you.");
    expect(digestLine(agentDigest([], NOW))).toBe("Nothing yet today.");
  });

  it("says what kind of work your agent did, and what waits on you from any day", () => {
    const yesterday = NOW - 86_400_000;
    const d = agentDigest(
      [
        row({ kind: "action", status: "done", method: "mero_issue_tracker_i_create_issue" }),
        row({ kind: "action", status: "done", method: "create_issue" }),
        row({ kind: "action", status: "done", app: "mero-bot", method: "Bash" }),
        row({ kind: "message", from: "agent", status: "said", needs_you: true, at: yesterday, chain_at: yesterday }),
      ],
      NOW,
    );
    expect(digestLine(d)).toBe("Filed 2 issues, ran 1 command on your computer, 1 waiting on you.");
  });
});
