import { describe, expect, it } from "vitest";
import type { FeedItem } from "./generated/HyperfeedClient";
import { BRIEF_BUDGET, briefOf, recommendationOf, reversibility, statusLine, summaryLine, urgency, whyShown } from "./brief";

const NOW = new Date(2026, 9, 16, 15, 0).getTime();
const appName = (k: string) => (k === "chat" ? "Chat" : k);

let n = 0;
function row(over: Partial<FeedItem>): FeedItem {
  n++;
  return {
    id: `r${n}`, kind: "notification", chain: `c${n}`, chain_len: 1, chain_at: NOW - n * 60_000, app: "chat", source_context: "ctx",
    source_label: "", title: `Row ${n}`, body: "", at: NOW - n * 60_000, needs_you: false, status: "received", status_at: 0, note: "",
    ask: { kind: "", prompt: "", options: [], draft: "" }, history: [], method: "", category: "", why: "", intent_hash: "", executor: "",
    undoable: false, breach: "", reviewed_at: 0, from: "", event: "", seen: true, reply_to: "", item_type: "", fields: "", reply_call: "",
    doing: "", doing_at: 0, attachments: [], steps: [], draft: "", stop_at: 0, headline: "", mode: "", superseded_by: "", answers: "",
    answers_superseded: false, held_by: "", held_since: 0, subject: "",
    ...over,
  };
}

describe("brief", () => {
  it("ranks a breach, then a guard, then a failure, then a proposal, then a notification", () => {
    const note = row({ needs_you: true });
    const proposal = row({ kind: "action", status: "pending", needs_you: true });
    const failed = row({ kind: "action", status: "failed", needs_you: true });
    const guarded = row({ kind: "action", status: "pending", category: "sign", needs_you: true });
    const breach = row({ kind: "action", status: "done", breach: "should have asked", needs_you: true });
    const b = briefOf([note, proposal, failed, guarded, breach], NOW);
    expect(b.decisions.map((i) => i.id)).toEqual([breach.id, guarded.id, failed.id, proposal.id, note.id]);
    expect(urgency(breach)).toBeGreaterThan(urgency(guarded));
  });

  it("shows only the budget and holds the rest back", () => {
    const many = Array.from({ length: BRIEF_BUDGET + 2 }, () => row({ needs_you: true }));
    const b = briefOf(many, NOW);
    expect(b.shown).toHaveLength(BRIEF_BUDGET);
    expect(b.held).toHaveLength(2);
  });

  it("splits what moves from what was handled today, counting what can still be undone", () => {
    const moving = row({ kind: "action", status: "approved" });
    const done = row({ kind: "action", status: "done", undoable: true, method: "send_message" });
    const read = row({ kind: "action", status: "done", method: "list_messages" });
    const yesterday = row({ kind: "action", status: "done", chain_at: NOW - 3 * 86_400_000, at: NOW - 3 * 86_400_000 });
    const b = briefOf([moving, done, read, yesterday], NOW);
    expect(b.moving.map((i) => i.id)).toEqual([moving.id]);
    expect(b.handled.map((i) => i.id)).toEqual([done.id]);
    expect(b.undoable).toBe(1);
  });

  it("says all quiet when nothing waits or moves", () => {
    const b = briefOf([row({ kind: "action", status: "done", method: "send_message" })], NOW);
    expect(statusLine(b)).toBe("All quiet · 1 handled today");
    expect(summaryLine(b)).toBe("Nothing needs you. Taken care of today: 1 thing.");
    expect(statusLine(briefOf([], NOW))).toBe("All quiet");
  });

  it("counts decisions in the status line", () => {
    const b = briefOf([row({ needs_you: true }), row({ needs_you: true }), row({ kind: "action", status: "approved" })], NOW);
    expect(statusLine(b)).toBe("2 decisions for you · 1 moving");
    expect(summaryLine(b)).toBe("2 things need you.");
  });

  it("says why a row reached you", () => {
    expect(whyShown(row({ kind: "action", status: "pending", category: "money" }), appName)).toBe("Spending or moving money always needs you.");
    expect(whyShown(row({ kind: "action", status: "pending" }), appName)).toBe("Your rules for Chat say ask first.");
    expect(whyShown(row({ item_type: "assignment", from: "Xabi" }), appName)).toBe("Xabi assigned it to you.");
    expect(whyShown(row({ kind: "message", status: "asked" }), appName)).toBe("Your agent can't go on without your answer.");
  });

  it("labels your agent's case by whether it proposes or already did it", () => {
    expect(recommendationOf(row({ kind: "action", status: "pending", why: "Maya asked." }))?.label).toBe("Why your agent proposes it");
    expect(recommendationOf(row({ kind: "action", status: "done", why: "You asked." }))?.label).toBe("Why your agent did it");
    expect(recommendationOf(row({}))).toBeNull();
  });

  it("tells a proposal that can be undone from one that can't", () => {
    expect(reversibility(row({ kind: "action", status: "pending", undoable: true }))).toBe("undoable");
    expect(reversibility(row({ kind: "action", status: "pending" }))).toBe("final");
    expect(reversibility(row({ kind: "action", status: "done", undoable: true }))).toBe("");
  });
});
