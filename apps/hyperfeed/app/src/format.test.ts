import { describe, expect, it } from "vitest";
import type { FeedItem } from "./generated/HyperfeedClient";
import { choicesFor, firstSentence, heldLine, headlineOfMessage, localCommand, plainMethod, rowTitle, saysMore, stepsOf } from "./format";

const row = (patch: Partial<FeedItem>): FeedItem =>
  ({
    id: "a1", kind: "action", chain: "a1", chain_len: 1, chain_at: 1, app: "issue-tracker", source_context: "", source_label: "",
    title: "", body: "", at: 1, needs_you: false, status: "done", status_at: 1, note: "", ask: { kind: "", prompt: "", options: [], draft: "" },
    history: [{ status: "done", at: 1, note: "" }], method: "", category: "", why: "", intent_hash: "", executor: "", undoable: false,
    breach: "", reviewed_at: 0, from: "", event: "", seen: true, reply_to: "", item_type: "", fields: "", reply_call: "", doing: "",
    doing_at: 0, attachments: [], ...patch,
  }) as FeedItem;

const appName = (key: string) => (key === "issue-tracker" ? "Issue tracker" : key);

describe("headlines", () => {
  const message = (patch: Partial<FeedItem>) => row({ kind: "message", from: "agent", status: "said", ...patch });

  it("derives a headline from the first sentence, at most 80 characters", () => {
    expect(firstSentence("The deploy is green. Three things changed:\n- a\n- b")).toBe("The deploy is green. Three things changed:");
    expect(firstSentence("Everything you asked for has been checked twice over today. Then more.")).toBe(
      "Everything you asked for has been checked twice over today.",
    );
    expect(firstSentence("## Results\n\nAll **good**.")).toBe("Results");
    expect(firstSentence("- **Ship it** now")).toBe("Ship it now");
    expect(firstSentence("Posted. There are two hellos now: delete the duplicate?")).toBe(
      "Posted. There are two hellos now: delete the duplicate?",
    );
    const long = firstSentence("word ".repeat(40));
    expect([...long].length).toBeLessThanOrEqual(80);
    expect(long.endsWith("…")).toBe(true);
    expect(long).not.toMatch(/ …$/);
    expect(firstSentence("v1.2 is out")).toBe("v1.2 is out");
    expect(firstSentence("")).toBe("");
  });

  it("uses the headline a message was written with, and derives one when it has none", () => {
    const body = "Here are ten ideas.\n1. One\n2. Two";
    expect(headlineOfMessage(message({ headline: "Ten ideas for the feed", title: "Ten ideas for the feed", body }))).toBe("Ten ideas for the feed");
    expect(headlineOfMessage(message({ headline: "", title: "Here are ten ideas.", body }))).toBe("Here are ten ideas.");
    // Rows from feeds made before headlines have no field at all.
    expect(headlineOfMessage(message({ headline: undefined as unknown as string, title: "Hi", body: "Hi" }))).toBe("Hi");
    expect(rowTitle(message({ headline: "Ten ideas", body }), appName)).toBe("Ten ideas");
    expect(headlineOfMessage(row({ title: "Posted the stand-up" }))).toBe("Posted the stand-up");
  });

  it("says a message says more only when its body goes past its headline", () => {
    expect(saysMore(message({ body: "Done." }))).toBe(false);
    expect(saysMore(message({ body: "Done. Two more lines\nhere." }))).toBe(true);
    expect(saysMore(message({ headline: "Report", body: "Report" }))).toBe(false);
    expect(saysMore(row({ body: "anything" }))).toBe(false);
  });
});

describe("plainMethod", () => {
  it("says a method as a person would", () => {
    expect(plainMethod("set_summary")).toBe("Set the summary");
    expect(plainMethod("create_issue")).toBe("Create an issue");
    expect(plainMethod("list_issues")).toBe("List issues");
    expect(plainMethod("get_issue")).toBe("Read the issue");
    expect(plainMethod("add_label")).toBe("Add a label");
    expect(plainMethod("set_resolution_criteria")).toBe("Set the resolution criteria");
    expect(plainMethod("sign")).toBe("Sign");
    expect(plainMethod("")).toBe("");
  });
});

describe("rowTitle", () => {
  it("says an older title made of the bare method in plain words", () => {
    expect(rowTitle(row({ method: "set_summary", title: "set summary in issue-tracker" }), appName)).toBe("Set the summary in Issue tracker");
    expect(rowTitle(row({ app: "node", method: "create_context", title: "create context on the node" }), appName)).toBe(
      "Create a context on the node",
    );
  });

  it("keeps every other title as it is", () => {
    expect(rowTitle(row({ method: "set_summary", title: "Set the summary of an issue in Issue tracker" }), appName)).toBe(
      "Set the summary of an issue in Issue tracker",
    );
    expect(rowTitle(row({ kind: "notification", method: "", title: "Xabi commented" }), appName)).toBe("Xabi commented");
  });
});

describe("choicesFor a failed action", () => {
  const failed = (patch: Partial<FeedItem>) => choicesFor(row({ status: "failed", ...patch }));

  it("offers Retry and Decline when a retry could work", () => {
    expect(failed({ app: "chat", method: "send_message", note: "timed out" })).toMatchObject({ approve: "Retry", decline: true, archive: false });
  });

  it("offers only Archive for a decision only you can make", () => {
    for (const [app, method] of [["hyperfeed", "set_guard"], ["hyperfeed", "hyperfeed_set_policy"], ["other", "set_policy"], ["hyperfeed", "say"]]) {
      expect(failed({ app, method })).toMatchObject({ approve: undefined, decline: false, archive: true });
    }
  });

  it("offers only Archive for a method the app does not have", () => {
    expect(failed({ app: "hyperfeed", method: "rename_everything" })).toMatchObject({ approve: undefined, decline: false, archive: true });
    for (const note of ['method "pin" not found', "Unknown method: pin", "no such method pin", "MethodNotFound"]) {
      expect(failed({ app: "chat", method: "pin", note })).toMatchObject({ approve: undefined, archive: true });
    }
    // Hyperfeed's own methods the agent may call are known: a retry of one can work.
    expect(failed({ app: "hyperfeed", method: "record_action" }).approve).toBe("Retry");
    // "not found" about something else is not a missing method.
    expect(failed({ app: "chat", method: "send_message", note: "channel not found" }).approve).toBe("Retry");
  });

  it("leaves a pending proposal to Approve and Decline", () => {
    expect(choicesFor(row({ status: "pending", app: "hyperfeed", method: "nope" }))).toMatchObject({ approve: "Approve", decline: true, archive: false });
  });
});

describe("localCommand", () => {
  const local = { app: "mero-bot", source_label: "This computer", method: "Bash", body: "$ cargo mero bundle" };

  it("is the command behind a row for a tool on your computer", () => {
    expect(localCommand(row(local))).toBe("$ cargo mero bundle");
    expect(localCommand(row({ app: "chat", method: "send_message", body: "Shipped it" }))).toBe("");
    expect(localCommand(row({ kind: "notification", app: "mero-bot", source_label: "This computer", body: "$ ls" }))).toBe("");
  });

  it("is folded away rather than told in the flow", () => {
    expect(stepsOf(row({ ...local, title: "Bundle the contract in apps" }), "mero-bot")[0]!.detail).toBe("");
    expect(stepsOf(row({ app: "chat", title: "Post it", body: "Shipped it" }), "Chat")[0]!.detail).toBe("Shipped it");
  });
});

describe("heldLine", () => {
  it("says which agent is on a chain, and for how long", () => {
    const now = 10 * 60_000;
    expect(heldLine({ held_by: "mero-bot@studio", held_since: now - 2 * 60_000 }, now)).toBe("mero-bot on studio · 2 min");
    expect(heldLine({ held_by: "mero-bot@studio", held_since: now - 5_000 }, now)).toBe("mero-bot on studio · just now");
    expect(heldLine({ held_by: "", held_since: 0 }, now)).toBe("");
    expect(heldLine(undefined, now)).toBe("");
  });
});
