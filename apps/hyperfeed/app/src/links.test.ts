import { describe, expect, it } from "vitest";
import type { FeedItem } from "./generated/HyperfeedClient";
import { appHome, appLink, canOpen, chatName, linkNamer, subjectFromLink } from "./links";
import type { LensHost } from "./lens/lens";
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

describe("appHome", () => {
  it("opens an app's front page signed in, and nothing for an app it does not know", () => {
    const url = new URL(appHome("sheets", session)!);
    expect(url.origin + url.pathname).toBe("https://mero-sheets.vercel.app/");
    expect(Object.fromEntries(new URLSearchParams(url.hash.slice(1)))).toEqual({
      access_token: "acc",
      refresh_token: "ref",
      node_url: "http://localhost:2428",
    });
    expect(appHome("sheets", null)).toBe("https://mero-sheets.vercel.app/");
    expect(appHome("evil", session)).toBeNull();
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

describe("subjectFromLink", () => {
  it("reads a subject from an app's address, or takes one as is", () => {
    expect(subjectFromLink("https://mero-issue-tracker-app.vercel.app/?context-id=repo1&issue=issue-7#access_token=x")).toBe("issue-tracker:repo1:issue-7");
    expect(subjectFromLink("https://mero-chat-pwa.vercel.app/?context-id=launch")).toBe("chat:launch");
    expect(subjectFromLink("https://mero-design.vercel.app/teams/g1/projects/board9")).toBe("design:board9");
    expect(subjectFromLink("issue-tracker:repo1:issue-7")).toBe("issue-tracker:repo1:issue-7");
    expect(subjectFromLink("https://example.com/?context-id=x")).toBe("");
    expect(subjectFromLink("https://mero-chat-pwa.vercel.app/")).toBe("");
    expect(subjectFromLink("just words")).toBe("");
  });
});

/** A chat context as its host answers: `info` from `get_info`, `profiles` from `get_profiles`. */
const chatHost = (info: unknown, profiles: unknown = [], names: Record<string, string> = {}): LensHost & { calls: string[] } => {
  const calls: string[] = [];
  return {
    calls,
    call: async <T,>(method: string) => {
      calls.push(method);
      if (method === "get_info") return info as T;
      if (method === "get_profiles") return profiles as T;
      throw new Error(`no ${method}`);
    },
    me: async () => new Set(["me-b58"]),
    name: async (id: string) => names[id] ?? "",
  };
};

describe("chatName", () => {
  it("names a channel by its name", async () => {
    expect(await chatName(chatHost({ name: "launch", context_type: "Channel" }))).toBe("#launch");
  });

  it("names a DM by the people in it besides you: their name on the node, else their username", async () => {
    const profiles = [
      { identity: "me-b58", username: "sandi" },
      { identity: "ronit-b58", username: "ronit" },
    ];
    // A DM's own name is the frontend's "private_dm": never shown.
    expect(await chatName(chatHost({ name: "private_dm", context_type: "Dm" }, profiles, { "ronit-b58": "Ronit Sabhaya" }))).toBe("DM with Ronit Sabhaya");
    expect(await chatName(chatHost({ name: "private_dm", context_type: "Dm" }, profiles))).toBe("DM with ronit");
    expect(await chatName(chatHost({ name: "private_dm", context_type: "Dm" }, [{ identity: "me-b58", username: "sandi" }]))).toBe("DM");
  });
});

describe("linkNamer", () => {
  const link = (context: string, app = "chat", item = "") => ({ app, context, item });

  it("names a whole chat once per context, and nothing else", async () => {
    const hosts: Record<string, ReturnType<typeof chatHost>> = {
      a: chatHost({ name: "launch", context_type: "Channel" }),
      b: chatHost({ name: "design", context_type: "Channel" }),
    };
    const name = linkNamer((ctx) => hosts[ctx] ?? null);
    expect(await name(link("a"))).toBe("#launch");
    expect(await name(link("b"))).toBe("#design");
    expect(await name(link("a"))).toBe("#launch");
    expect(hosts.a!.calls).toEqual(["get_info"]);
    // A thread in a chat, another app, or a context no host reaches: the chip names itself as before.
    expect(await name(link("a", "chat", "thread-1"))).toBe("");
    expect(await name(link("a", "issue-tracker"))).toBe("");
    expect(await name(link("gone"))).toBe("");
  });

  it("asks again after a failed read", async () => {
    let fail = true;
    const host = chatHost({ name: "launch", context_type: "Channel" });
    const name = linkNamer(() => ({ ...host, call: async <T,>(m: string, a: Record<string, unknown>) => (fail ? Promise.reject(new Error("down")) : host.call<T>(m, a)) }));
    expect(await name(link("a"))).toBe("");
    fail = false;
    expect(await name(link("a"))).toBe("#launch");
  });
});
