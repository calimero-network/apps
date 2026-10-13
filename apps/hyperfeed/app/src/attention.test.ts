import { describe, expect, it } from "vitest";
import type { FeedItem } from "./generated/HyperfeedClient";
import { alertOf, newAlerts, tabTitle, waitingKeys } from "./attention";

function row(over: Partial<FeedItem>): FeedItem {
  return {
    id: "r", kind: "message", chain: "c1", chain_len: 1, chain_at: 0, app: "", source_context: "", source_label: "", title: "", body: "",
    at: 0, needs_you: false, status: "waiting", status_at: 0, note: "", ask: { kind: "", prompt: "", options: [], draft: "" },
    history: [], method: "", category: "", why: "", intent_hash: "", executor: "", undoable: false,
    breach: "", reviewed_at: 0, from: "you", event: "", seen: true, reply_to: "", item_type: "", fields: "", reply_call: "", doing: "", doing_at: 0,
    attachments: [], steps: [], draft: "", stop_at: 0, headline: "", superseded_by: "", answers: "", answers_superseded: false, held_by: "", held_since: 0, subject: "", ...over,
  };
}

const appName = (k: string) => ({ "mero-issue-tracker": "Issues" })[k] ?? k;

const asks = row({ id: "m2", chain: "c1", from: "agent", status: "asked", needs_you: true, body: "Merge PR #12?", ask: { kind: "choice", prompt: "Merge it?", options: ["Yes", "No"], draft: "" } });
const approve = row({ id: "a1", chain: "c2", kind: "action", from: "", app: "mero-issue-tracker", title: "Close HF-31", status: "pending", needs_you: true });
const mention = row({ id: "n1", chain: "c3", kind: "notification", from: "Xabi", app: "mero-issue-tracker", title: "Assigned you an issue", body: "Feed loses rows", needs_you: true });
const quiet = row({ id: "n2", chain: "c4", kind: "notification", from: "Xabi", app: "mero-issue-tracker", title: "Commented", needs_you: false });

describe("newAlerts", () => {
  it("says nothing on the first read: what already waited is on the screen", () => {
    expect(newAlerts(null, [asks, approve], appName)).toEqual([]);
  });

  it("says what started needing you since the last read, and nothing else", () => {
    const before = waitingKeys([asks]);
    expect(newAlerts(before, [asks, approve, quiet], appName).map((a) => a.chain)).toEqual(["c2"]);
  });

  it("says a new question in a chain that already waited", () => {
    const before = waitingKeys([asks]);
    const again = { ...asks, id: "m3" };
    expect(newAlerts(before, [again], appName)).toHaveLength(1);
  });
});

describe("alertOf", () => {
  it("opens your agent's question in its chat, with the question it asks", () => {
    expect(alertOf(asks, appName)).toEqual({ chain: "c1", title: "Your agent asks you", body: "Merge it?", opens: "chat" });
  });

  it("asks for an approval with the action's title", () => {
    expect(alertOf(approve, appName)).toMatchObject({ title: "Approve?", body: "Close HF-31", opens: "feed" });
  });

  it("names the app and the person for a notification", () => {
    expect(alertOf(mention, appName)).toMatchObject({ title: "Issues: needs you", body: "Xabi assigned you an issue · Feed loses rows" });
  });
});

describe("tabTitle", () => {
  it("counts what waits in front of the title, and nothing when nothing waits", () => {
    expect(tabTitle(3, "Hyperfeed")).toBe("(3) Hyperfeed");
    expect(tabTitle(0, "Hyperfeed")).toBe("Hyperfeed");
  });
});
