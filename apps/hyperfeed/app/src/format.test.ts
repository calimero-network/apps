import { describe, expect, it } from "vitest";
import type { FeedItem } from "./generated/HyperfeedClient";
import { localCommand, plainMethod, rowTitle, stepsOf } from "./format";

const row = (patch: Partial<FeedItem>): FeedItem =>
  ({
    id: "a1", kind: "action", chain: "a1", chain_len: 1, chain_at: 1, app: "issue-tracker", source_context: "", source_label: "",
    title: "", body: "", at: 1, needs_you: false, status: "done", status_at: 1, note: "", ask: { kind: "", prompt: "", options: [], draft: "" },
    history: [{ status: "done", at: 1, note: "" }], method: "", category: "", why: "", intent_hash: "", executor: "", undoable: false,
    breach: "", reviewed_at: 0, from: "", event: "", seen: true, reply_to: "", item_type: "", fields: "", reply_call: "", doing: "",
    doing_at: 0, attachments: [], ...patch,
  }) as FeedItem;

const appName = (key: string) => (key === "issue-tracker" ? "Issue tracker" : key);

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
