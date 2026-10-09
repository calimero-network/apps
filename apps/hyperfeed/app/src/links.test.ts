import { describe, expect, it } from "vitest";
import type { FeedItem } from "./generated/HyperfeedClient";
import { appLink, canOpen } from "./links";
import { laneOf } from "./format";

const row = (patch: Partial<FeedItem>): FeedItem =>
  ({
    id: "r1", kind: "notification", chain: "r1", chain_len: 1, chain_at: 1, app: "chat", source_context: "ctx-1",
    source_label: "#launch", title: "Mentioned you", body: "", at: 1, needs_you: false, status: "received", status_at: 1,
    note: "", ask: { kind: "", prompt: "", options: [], draft: "" }, history: [], method: "", category: "", why: "",
    intent_hash: "", executor: "", undoable: false, breach: "", reviewed_at: 0, from: "Maya", event: "", seen: false,
    reply_to: "", item_type: "", fields: "", reply_call: "", ...patch,
  }) as FeedItem;

const session = { nodeUrl: "http://localhost:2428", accessToken: "acc", refreshToken: "ref" };

describe("appLink", () => {
  it("opens Chat at the channel, signed in to your node", () => {
    const url = new URL(appLink(row({}), { session, applicationId: "chat-app" })!);
    expect(url.origin).toBe("https://mero-chat-pwa.vercel.app");
    expect(url.searchParams.get("context-id")).toBe("ctx-1");
    const hash = new URLSearchParams(url.hash.slice(1));
    expect(Object.fromEntries(hash)).toEqual({
      access_token: "acc",
      refresh_token: "ref",
      node_url: "http://localhost:2428",
      application_id: "chat-app",
    });
  });

  it("opens a Design document under its team", () => {
    const url = appLink(row({ app: "design", source_context: "doc 1" }), { session: null, groupId: "team-9" });
    expect(url).toBe("https://mero-design.vercel.app/teams/team-9/projects/doc%201");
  });

  it("never hands your session to an app it does not know", () => {
    expect(appLink(row({ app: "evil" }), { session })).toBeNull();
    expect(canOpen(row({ app: "evil" }))).toBe(false);
    expect(canOpen(row({ source_context: "" }))).toBe(false);
    expect(canOpen(row({}))).toBe(true);
  });
});

describe("laneOf", () => {
  it("is to do when anything in the chain needs you", () => {
    expect(laneOf(row({ needs_you: true }))).toBe("todo");
  });
  it("is in progress while your agent or the feed carries it", () => {
    expect(laneOf(row({ kind: "message", from: "you", status: "waiting", app: "" }))).toBe("progress");
    expect(laneOf(row({ kind: "message", from: "you", status: "thinking", app: "" }))).toBe("progress");
    expect(laneOf(row({ kind: "action", status: "approved" }))).toBe("progress");
    expect(laneOf(row({ status: "answered" }))).toBe("progress");
  });
  it("is done once settled", () => {
    expect(laneOf(row({ kind: "message", from: "agent", status: "said", app: "" }))).toBe("done");
    expect(laneOf(row({ kind: "action", status: "done" }))).toBe("done");
    expect(laneOf(row({ status: "delivered" }))).toBe("done");
    expect(laneOf(row({}))).toBe("done");
  });
});
