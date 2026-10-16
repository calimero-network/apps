import { describe, expect, it } from "vitest";
import type { ActionSetView, FeedItem, SettingsView } from "./generated/HyperfeedClient";
import {
  ALLOW_AFTER,
  BRIEF_BUDGET,
  allowOffer,
  briefOf,
  pressLine,
  recommendationOf,
  reversibility,
  statusLine,
  summaryLine,
  tuneRule,
  urgency,
  whyShown,
} from "./brief";

const NOW = new Date(2026, 9, 16, 15, 0).getTime();
const HOUR = 3_600_000;
const SINCE = NOW - 6 * HOUR;
const appName = (k: string) => (k === "chat" ? "Chat" : k);

let n = 0;
function row(over: Partial<FeedItem>): FeedItem {
  n++;
  const at = NOW - n * 60_000;
  return {
    id: `r${n}`, kind: "notification", chain: `c${n}`, chain_len: 1, chain_at: at, app: "chat", source_context: "ctx",
    source_label: "", title: `Row ${n}`, body: "", at, needs_you: false, status: "received", status_at: at, note: "",
    ask: { kind: "", prompt: "", options: [], draft: "" }, history: [], method: "", category: "", why: "", intent_hash: "", executor: "",
    undoable: false, breach: "", reviewed_at: 0, from: "", event: "", seen: true, reply_to: "", item_type: "", fields: "", reply_call: "",
    doing: "", doing_at: 0, attachments: [], steps: [], draft: "", stop_at: 0, headline: "", mode: "", superseded_by: "", answers: "",
    answers_superseded: false, held_by: "", held_since: 0, subject: "",
    ...over,
  };
}

describe("brief: ranking", () => {
  it("ranks a breach, then a guard, then a failure, then a proposal, then a notification", () => {
    const note = row({ needs_you: true });
    const proposal = row({ kind: "action", status: "pending", needs_you: true });
    const failed = row({ kind: "action", status: "failed", needs_you: true });
    const guarded = row({ kind: "action", status: "pending", category: "sign", needs_you: true });
    const breach = row({ kind: "action", status: "done", breach: "should have asked", needs_you: true });
    const b = briefOf([note, proposal, failed, guarded, breach], NOW, SINCE);
    expect(b.decisions.map((i) => i.id)).toEqual([breach.id, guarded.id, failed.id, proposal.id, note.id]);
  });

  it("puts something due within the hour above a guard", () => {
    const guarded = row({ kind: "action", status: "pending", category: "sign", needs_you: true });
    const due = row({ needs_you: true, item_type: "assignment", fields: JSON.stringify({ due: NOW + 20 * 60_000 }) });
    expect(urgency(due, NOW)).toBeGreaterThan(urgency(guarded, NOW));
    expect(briefOf([guarded, due], NOW, SINCE).decisions[0]!.id).toBe(due.id);
  });

  it("moves what has waited longer up within its kind", () => {
    const fresh = row({ kind: "action", status: "pending", needs_you: true, status_at: NOW - 60_000 });
    const old = row({ kind: "action", status: "pending", needs_you: true, status_at: NOW - 5 * HOUR });
    expect(briefOf([fresh, old], NOW, SINCE).decisions[0]!.id).toBe(old.id);
  });

  it("says why it is pressing now", () => {
    expect(pressLine(row({ fields: JSON.stringify({ due: NOW + 20 * 60_000 }) }), NOW)).toEqual({ text: expect.stringMatching(/^Due .* · in 20 min$/), hot: true });
    expect(pressLine(row({ fields: JSON.stringify({ due: NOW - 2 * HOUR }) }), NOW)?.text).toBe("Overdue · 2 h ago");
    expect(pressLine(row({ fields: JSON.stringify({ due: "This sprint" }) }), NOW)?.text).toBe("Due: This sprint");
    expect(pressLine(row({ status_at: NOW - 2 * HOUR }), NOW)?.text).toBe("Waiting 2 h");
    expect(pressLine(row({ status_at: NOW - 5 * 60_000 }), NOW)).toBeNull();
  });

  it("shows only the budget and holds the rest back", () => {
    const many = Array.from({ length: BRIEF_BUDGET + 2 }, () => row({ needs_you: true }));
    const b = briefOf(many, NOW, SINCE);
    expect(b.shown).toHaveLength(BRIEF_BUDGET);
    expect(b.held).toHaveLength(2);
  });
});

describe("brief: done for you and filtered out", () => {
  it("keeps what your agent did apart from notifications that did not need you", () => {
    const moving = row({ kind: "action", status: "approved" });
    const done = row({ kind: "action", status: "done", undoable: true, method: "send_message" });
    const read = row({ kind: "action", status: "done", method: "list_messages" });
    const before = row({ kind: "action", status: "done", chain_at: SINCE - HOUR, at: SINCE - HOUR });
    const general1 = row({ source_context: "g", source_label: "#general" });
    const general2 = row({ source_context: "g", source_label: "#general" });
    const doc = row({ app: "docs", source_context: "d", source_label: "Pricing v4" });
    const b = briefOf([moving, done, read, before, general1, general2, doc], NOW, SINCE, appName);
    expect(b.moving.map((i) => i.id)).toEqual([moving.id]);
    expect(b.done.map((i) => i.id)).toEqual([done.id]);
    expect(b.undoable).toBe(1);
    expect(b.filteredCount).toBe(3);
    expect(b.filtered.map((g) => [g.where, g.items.length])).toEqual([
      ["#general", 2],
      ["Pricing v4", 1],
    ]);
  });

  it("asks for a rule your agent keeps when you tune a source", () => {
    const g = { key: "k", app: "chat", where: "#general", items: [] };
    expect(tuneRule(g, false, appName)).toMatch(/fewer updates from #general in Chat/);
    expect(tuneRule(g, true, appName)).toMatch(/Bring me updates from #general in Chat/);
  });
});

describe("brief: lines", () => {
  it("says all quiet when nothing waits or moves", () => {
    const b = briefOf([row({ kind: "action", status: "done", method: "send_message" }), row({})], NOW, SINCE);
    expect(statusLine(b)).toBe("All quiet · 2 handled");
    expect(summaryLine(b, true, NOW)).toBe("While you were away your agent took care of 1 thing and filtered out 1 notification. Nothing needs you.");
    expect(statusLine(briefOf([], NOW, SINCE))).toBe("All quiet");
    expect(summaryLine(briefOf([], NOW, SINCE), false, NOW)).toBe("Nothing has happened yet today. Nothing needs you.");
  });

  it("counts decisions, and how many are due within the hour", () => {
    const due = row({ needs_you: true, fields: JSON.stringify({ due: NOW + 10 * 60_000 }) });
    const b = briefOf([due, row({ needs_you: true }), row({ kind: "action", status: "approved" })], NOW, SINCE);
    expect(statusLine(b)).toBe("2 decisions for you · 1 moving");
    expect(summaryLine(b, false, NOW)).toBe("Nothing has happened yet today. 2 things need you, 1 within the hour.");
  });

  it("says why a row reached you", () => {
    expect(whyShown(row({ kind: "action", status: "pending", category: "money" }), appName, NOW)).toMatch(/^Spending or moving money always needs you/);
    expect(whyShown(row({ kind: "action", status: "pending", status_at: NOW }), appName, NOW)).toBe("Your rules for Chat say ask first.");
    expect(whyShown(row({ kind: "action", status: "pending", status_at: NOW - 2 * HOUR }), appName, NOW)).toBe("Your rules for Chat say ask first. It has been waiting 2 h.");
    expect(whyShown(row({ item_type: "assignment", from: "Xabi", status_at: NOW }), appName, NOW)).toBe("Xabi assigned it to you.");
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

describe("brief: always allow", () => {
  const sets: ActionSetView[] = [
    {
      app: "chat", application_id: "a", summary: "", status: "approved", updated_at: 1,
      actions: [
        { id: "send", label: "Send messages", description: "", category: "", writes: true, methods: ["send_message"] },
        { id: "invite", label: "Invite people", description: "", category: "invite", writes: true, methods: ["invite"] },
      ],
    } as ActionSetView,
  ];
  const settings = { policies: [], action_modes: [] } as unknown as SettingsView;
  const approved = () => row({ kind: "action", method: "send_message", status: "done", history: [{ status: "pending", note: "", at: 0 }, { status: "approved", note: "", at: 0 }] as FeedItem["history"] });
  const pending = (over: Partial<FeedItem> = {}) => row({ kind: "action", method: "send_message", status: "pending", needs_you: true, ...over });

  it(`offers it after ${ALLOW_AFTER} approvals and no decline`, () => {
    const item = pending();
    const past = Array.from({ length: ALLOW_AFTER }, approved);
    expect(allowOffer(item, [item, ...past], sets, settings, NOW)).toEqual({ app: "chat", action: "send", label: "Send messages", approved: ALLOW_AFTER });
    expect(allowOffer(item, [item, ...past.slice(1)], sets, settings, NOW)).toBeNull();
  });

  it("never after a decline, for a guard, or once it is set to act", () => {
    const item = pending();
    const past = Array.from({ length: ALLOW_AFTER }, approved);
    const declined = row({ kind: "action", method: "send_message", status: "declined" });
    expect(allowOffer(item, [item, ...past, declined], sets, settings, NOW)).toBeNull();
    const guarded = pending({ method: "invite" });
    expect(allowOffer(guarded, [guarded, ...past], sets, settings, NOW)).toBeNull();
    const acting = { ...settings, action_modes: [{ app: "chat", action: "send", mode: "act" }] } as SettingsView;
    expect(allowOffer(item, [item, ...past], sets, acting, NOW)).toBeNull();
    expect(allowOffer(item, [item, ...past], [], settings, NOW)).toBeNull();
  });
});
