import { describe, expect, it } from "vitest";
import { BUILT_IN, clip, decodePayload, hexToBase58, identitiesOf, toNotifications } from "./collector";
import type { LensHost } from "./lens/lens";
import { appKeyForPackage } from "./apps";

// What a lens makes of an event is lens/lens.test.ts's business. Here: the
// keys, and that an event the lens drops or cannot read costs nothing else.

const CHAT = { contextId: "ctx-chat", appKey: "chat", applicationId: "app-chat", label: "chat · ctx-ch" };
const bytes = (v: unknown) => Array.from(new TextEncoder().encode(JSON.stringify(v)));
const sent = (id: string) => ({ kind: "MessageSent", data: bytes({ message_id: id }) });

function chat(messages: Record<string, unknown>[], fail = new Set<string>()): LensHost {
  return {
    me: async () => new Set(["me"]),
    name: async (id) => (id === "maya" ? "Maya" : ""),
    call: async <T,>(method: string, args: Record<string, unknown>) => {
      if (fail.has(String(args.message_id))) throw new Error("refused");
      const answer =
        method === "message_position"
          ? messages.findIndex((m) => m.id === args.message_id)
          : method === "get_messages_from"
            ? { messages: messages.slice(args.start as number, (args.start as number) + 1) }
            : { name: "launch", context_type: "Channel" };
      return answer as T;
    },
  };
}
const msg = (id: string, text: string, mentions: string[] = []) => ({ id, sender: "maya", text, mentions, mentions_usernames: [] });

describe("toNotifications", () => {
  it("keys an event by context, transition and its place in the change", async () => {
    const host = chat([msg("m1", "lunch?"), msg("m2", "ping", ["me"])]);
    const out = await toNotifications(CHAT, { newRoot: "root-1", events: [sent("m1"), sent("m2")] }, "root-0", BUILT_IN.chat!, host);
    // m1 is channel chatter, so only m2 is recorded, still at index 1.
    expect(out.map((n) => n.key)).toEqual(["ctx-chat:root-0>root-1:1"]);
    expect(out[0]).toMatchObject({ app: "chat", source_context: "ctx-chat", event: "MessageSent", item_type: "message", from: "Maya", chain: "" });
  });

  it("keys the transition, so returning to an earlier state is a new event", async () => {
    const host = chat([msg("m1", "ping", ["me"])]);
    const key = async (prev: string, root: string) =>
      (await toNotifications(CHAT, { newRoot: root, events: [sent("m1")] }, prev, BUILT_IN.chat!, host))[0]!.key;
    const keys = [await key("", "root-a"), await key("root-a", "root-b"), await key("root-b", "root-a")];
    expect(new Set(keys).size).toBe(3);
  });

  it("drops an event its lens cannot read, and keeps the rest", async () => {
    const host = chat([msg("m2", "ping", ["me"])], new Set(["gone"]));
    const out = await toNotifications(CHAT, { newRoot: "r", events: [sent("gone"), sent("m2")] }, "", BUILT_IN.chat!, host);
    expect(out.map((n) => n.key)).toEqual(["ctx-chat:>r:1"]);
  });

  it("records nothing without a root to key it by, or without a lens", async () => {
    const host = chat([msg("m1", "ping", ["me"])]);
    expect(await toNotifications(CHAT, { events: [sent("m1")] }, "", BUILT_IN.chat!, host)).toEqual([]);
    expect(await toNotifications({ ...CHAT, appKey: "drive-docs" }, { newRoot: "r", events: [{ kind: "TextChanged", data: bytes({}) }] }, "", null, host)).toEqual([]);
  });

  it("stays inside the contract's limits, counted in bytes", async () => {
    const host = chat([msg("m1", "é".repeat(5000), ["me"])]);
    const [n] = await toNotifications(CHAT, { newRoot: "r".repeat(300), events: [sent("m1")] }, "", BUILT_IN.chat!, host);
    expect(n!.key.length).toBeLessThanOrEqual(200);
    expect(new TextEncoder().encode(n!.body).length).toBeLessThanOrEqual(2000);
  });
});

describe("helpers", () => {
  it("decodes whatever JSON an event carries", () => {
    expect(decodePayload(bytes({ a: 1 }))).toEqual({ a: 1 });
    expect(decodePayload(bytes("m1"))).toBe("m1");
    expect(decodePayload([0xff, 0xfe])).toBeNull();
  });

  it("writes an identity the way apps stamp it, base58 as well as hex", () => {
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
