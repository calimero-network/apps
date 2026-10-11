import { describe, expect, it } from "vitest";
import type { FeedItem } from "./generated/HyperfeedClient";
import { ciOf, milestonesOf, prOf, trackLine } from "./milestones";

let at = 1_000;
function row(over: Partial<FeedItem>): FeedItem {
  at += 1_000;
  const status = over.status ?? "done";
  return {
    id: `r${at}`, kind: "action", chain: "c", chain_len: 1, chain_at: at, app: "mero-bot", source_context: "", source_label: "This computer",
    title: "", body: "", at, needs_you: false, status, status_at: at, note: "", ask: { kind: "", prompt: "", options: [], draft: "" },
    history: [{ status, note: "", at }], method: "", category: "", why: "", intent_hash: "", executor: "", undoable: false, breach: "",
    reviewed_at: 0, from: "", event: "", seen: true, reply_to: "", item_type: "", fields: "", reply_call: "", doing: "", doing_at: 0,
    attachments: [], steps: [], draft: "", stop_at: 0, headline: "", superseded_by: "", answers: "", answers_superseded: false, held_by: "", held_since: 0, ...over,
  };
}

const asked = (body: string, status = "answered") => row({ kind: "message", from: "you", app: "", source_label: "", body, title: body, status });
const said = (body: string) => row({ kind: "message", from: "agent", app: "", source_label: "", body, title: body, status: "said" });

describe("prOf and ciOf", () => {
  it("finds the pull request a text names", () => {
    expect(prOf("Opened PR #432")).toBe("432");
    expect(prOf("https://github.com/calimero-network/apps/pull/433")).toBe("433");
    expect(prOf("pull request #12 is up")).toBe("12");
    expect(prOf("Fixed issue #4")).toBe("");
  });

  it("reads what a text says of CI", () => {
    expect(ciOf("CI is green")).toBe("green");
    expect(ciOf("All checks passed")).toBe("green");
    expect(ciOf("2 checks failed")).toBe("red");
    expect(ciOf("Run tests in calimero")).toBe("");
    expect(ciOf("Looks green to me")).toBe("");
  });
});

describe("milestonesOf", () => {
  it("tells a task from filed to merged", () => {
    const rows = [
      asked("Fix the digest card"),
      row({ title: "Open a pull request in apps", body: "$ gh pr create", history: [{ status: "done", note: "https://github.com/calimero-network/apps/pull/436", at: 5_000 }] }),
      said("CI is green on PR #436."),
      row({ title: "Merge PR #436 in apps", body: "$ gh pr merge 436 --squash" }),
    ];
    // Opened with its link in the note, so it is the PR's own step.
    rows[1]!.history[0]!.at = rows[1]!.at;
    expect(trackLine(milestonesOf(rows))).toBe("Filed → PR #436 → CI green → Merged");
  });

  it("ends on where the task stands while it is not merged", () => {
    const rows = [asked("Fix the digest card", "thinking"), said("Opened PR #12."), said("2 checks failed on PR #12, looking.")];
    const lead = { ...rows[0]!, status: "thinking" };
    expect(trackLine(milestonesOf(rows, lead))).toBe("Filed → PR #12 → CI red → Working");
    const waiting = { ...rows[2]!, needs_you: true, status: "asked" };
    expect(trackLine(milestonesOf(rows, waiting))).toBe("Filed → PR #12 → CI red → Asks you");
  });

  it("keeps the latest word on CI", () => {
    const rows = [asked("Fix it"), said("CI failed on PR #3."), said("Pushed a fix: CI passed.")];
    expect(trackLine(milestonesOf(rows))).toBe("Filed → PR #3 → CI green → Done");
  });

  it("takes nothing you asked for as having happened, nor a proposal", () => {
    const rows = [asked("Fix the failing CI and get it merged"), row({ status: "pending", needs_you: true, title: "Merge PR #9", body: "$ gh pr merge 9" })];
    const track = milestonesOf(rows, rows[1]);
    expect(trackLine(track)).toBe("Filed → PR #9 → Needs you");
  });

  it("starts with an issue your agent filed", () => {
    const rows = [row({ app: "issues", method: "mero_issue_tracker_i_create_issue", title: "Filed: Create my feed fails" }), said("Opened PR #20 for it.")];
    expect(trackLine(milestonesOf(rows))).toBe("Filed → PR #20 → Done");
  });

  it("has no track without a PR, CI or merge to tell", () => {
    expect(milestonesOf([row({ title: "Posted your stand-up" })])).toEqual([]);
    expect(milestonesOf([])).toEqual([]);
    // A conversation: asked and answered is the chat itself, not a story.
    expect(milestonesOf([asked("Plan my week"), said("Here is your week.")])).toEqual([]);
  });
});
