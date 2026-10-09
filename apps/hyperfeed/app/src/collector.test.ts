import { describe, expect, it } from "vitest";
import { clip, decodePayload, hexToBase58, humanise, identitiesOf, plainText, toNotifications, type SourceReader } from "./collector";
import { appKeyForPackage } from "./apps";

const CHAT = { contextId: "ctx-chat", appKey: "chat", label: "chat · ctx-ch" };
const bytes = (v: unknown) => Array.from(new TextEncoder().encode(JSON.stringify(v)));

interface Msg {
  id: string;
  sender: string;
  text: string;
  mentions?: string[];
  mentions_usernames?: string[];
}

/** A chat context as the reader sees it, answering the methods mero-chat has. */
function chat(messages: Msg[], { dm = false, me = "me" } = {}): SourceReader & { calls: string[] } {
  const calls: string[] = [];
  return {
    calls,
    me: async () => new Set([me]),
    call: async <T,>(method: string, args: Record<string, unknown>): Promise<T> => {
      calls.push(method);
      const answer = (() => {
        switch (method) {
          case "message_position": {
            const i = messages.findIndex((m) => m.id === args.message_id);
            return i < 0 ? null : i;
          }
          case "get_messages_from": {
            const m = messages[args.start as number];
            return { messages: m ? [{ mentions: [], mentions_usernames: [], ...m }] : [] };
          }
          case "get_info":
            return { name: "launch", context_type: dm ? "Dm" : "Channel" };
          case "get_profiles":
            return [{ identity: "maya", username: "Maya" }];
          case "get_member_role":
            return "Mod";
          default:
            throw new Error(`no method ${method}`);
        }
      })();
      return answer as T;
    },
  };
}

const sent = (id: string) => ({ kind: "MessageSent", data: bytes({ message_id: id }) });

describe("toNotifications", () => {
  it("records a mention of you, with who said what and where", async () => {
    const reader = chat([{ id: "m1", sender: "maya", text: "<p>Can you pull the <b>numbers</b>?</p>", mentions: ["me"] }]);
    const [n] = await toNotifications(CHAT, { newRoot: "root-1", events: [sent("m1")] }, "", reader);
    expect(n).toMatchObject({
      key: "ctx-chat:>root-1:0",
      app: "chat",
      title: "Mentioned you",
      from: "Maya",
      body: "Can you pull the numbers?",
      source_label: "#launch",
      needs_you: true,
      ask: { kind: "reply", prompt: "Reply in #launch" },
    });
  });

  it("records a DM, and a mention of everyone", async () => {
    const dm = await toNotifications(CHAT, { newRoot: "r", events: [sent("m1")] }, "", chat([{ id: "m1", sender: "maya", text: "hi" }], { dm: true }));
    expect(dm[0]).toMatchObject({ title: "Sent you a message", source_label: "DM", ask: { prompt: "Reply to Maya" } });
    const all = await toNotifications(
      CHAT,
      { newRoot: "r", events: [sent("m1")] },
      "",
      chat([{ id: "m1", sender: "maya", text: "standup!", mentions_usernames: ["here"] }]),
    );
    expect(all[0]?.title).toBe("Mentioned everyone in #launch");
  });

  it("records nothing for the rest of a channel, or for what you said yourself", async () => {
    const reader = chat([
      { id: "m1", sender: "maya", text: "lunch?" },
      { id: "m2", sender: "me", text: "@me note to self", mentions: ["me"] },
    ]);
    expect(await toNotifications(CHAT, { newRoot: "r", events: [sent("m1"), sent("m2")] }, "", reader)).toEqual([]);
  });

  it("records nothing an app has no reader for: keystrokes, cursors, edits", async () => {
    const docs = { contextId: "ctx-docs", appKey: "drive-docs", label: "drive-docs · ctx-do" };
    const reader = chat([]);
    const events = [{ kind: "TextChanged", data: bytes({ block: "b", doc: "d" }) }];
    expect(await toNotifications(docs, { newRoot: "r", events }, "", reader)).toEqual([]);
    const chatNoise = [{ kind: "MessageEdited", data: bytes("m1") }, { kind: "ReactionUpdated", data: bytes("m1") }];
    expect(await toNotifications(CHAT, { newRoot: "r", events: chatNoise }, "", reader)).toEqual([]);
    expect(reader.calls).toEqual([]);
  });

  it("records your own role changing, and nobody else's", async () => {
    const mine = await toNotifications(CHAT, { newRoot: "r", events: [{ kind: "RoleUpdated", data: bytes("me") }] }, "", chat([]));
    expect(mine[0]).toMatchObject({ title: "Your role changed", body: "You are now Mod in #launch.", needs_you: false });
    expect(await toNotifications(CHAT, { newRoot: "r", events: [{ kind: "RoleUpdated", data: bytes("maya") }] }, "", chat([]))).toEqual([]);
  });

  it("keys an event by its place in the change, so a skipped one never shifts a key", async () => {
    const reader = chat([
      { id: "m1", sender: "maya", text: "lunch?" },
      { id: "m2", sender: "maya", text: "@me ping", mentions: ["me"] },
    ]);
    const out = await toNotifications(CHAT, { newRoot: "root-1", events: [sent("m1"), sent("m2")] }, "root-0", reader);
    expect(out.map((n) => n.key)).toEqual(["ctx-chat:root-0>root-1:1"]);
  });

  it("drops an event its reader cannot read, and keeps the rest", async () => {
    const reader = chat([{ id: "m2", sender: "maya", text: "ping", mentions: ["me"] }]);
    const broken: SourceReader = {
      me: reader.me,
      call: async <T,>(method: string, args: Record<string, unknown>) => {
        if (args.message_id === "gone") throw new Error("refused");
        return reader.call<T>(method, args);
      },
    };
    const out = await toNotifications(CHAT, { newRoot: "r", events: [sent("gone"), sent("m2")] }, "", broken);
    expect(out.map((n) => n.key)).toEqual(["ctx-chat:>r:1"]);
  });

  it("records nothing without a root hash to key it by", async () => {
    expect(await toNotifications(CHAT, { events: [sent("m1")] }, "", chat([]))).toEqual([]);
  });

  it("stays inside the contract's limits, counted in bytes", async () => {
    const reader = chat([{ id: "m1", sender: "maya", text: "é".repeat(5000), mentions: ["me"] }]);
    const [n] = await toNotifications(CHAT, { newRoot: "r".repeat(300), events: [sent("m1")] }, "", reader);
    expect(n!.key.length).toBeLessThanOrEqual(200);
    expect(new TextEncoder().encode(n!.body).length).toBeLessThanOrEqual(2000);
  });
});

describe("helpers", () => {
  it("humanises event kinds", () => {
    expect(humanise("UpdatePublished")).toBe("Update published");
  });

  it("decodes whatever JSON an event carries", () => {
    expect(decodePayload(bytes({ a: 1 }))).toEqual({ a: 1 });
    expect(decodePayload(bytes("m1"))).toBe("m1");
    expect(decodePayload([0xff, 0xfe])).toBeNull();
  });

  it("reads a message without its markup", () => {
    expect(plainText("<p>a &amp; b</p><p>c</p>")).toBe("a & b\nc");
  });

  it("writes your identity the way apps stamp it, base58 as well as hex", () => {
    // Known vectors: bs58 of 0x0000ff and of 32 bytes of 0x01.
    expect(hexToBase58("0000ff")).toBe("115Q");
    expect(hexToBase58("01".repeat(32))).toBe("4vJ9JU1bJJE96FWSJKvHsmmFADCg4gpZQff4P3bkLKi");
    expect(hexToBase58("xyz")).toBe("");
    expect(identitiesOf(["0000ff", null, ""])).toEqual(new Set(["0000ff", "115Q"]));
  });

  it("clips on a character boundary", () => {
    expect(clip("aé", 2)).toBe("a");
    expect(clip("abc", 5)).toBe("abc");
  });

  it("derives a contract-safe app key from a package", () => {
    expect(appKeyForPackage("com.calimero.mero-chat", "abc")).toBe("chat");
    expect(appKeyForPackage("com.example.Notes_App", "abc")).toBe("notes-app");
    expect(appKeyForPackage(undefined, "ABCDEF123456")).toBe("app-abcdef12");
  });
});
