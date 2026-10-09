import { describe, expect, it } from "vitest";
import { decodePayload, humanise, toNotifications } from "./collector";
import { appKeyForPackage } from "./apps";

const SOURCE = { contextId: "ctx-chat", appKey: "chat", label: "chat · ctx-ch" };
const bytes = (v: unknown) => Array.from(new TextEncoder().encode(JSON.stringify(v)));

describe("toNotifications", () => {
  it("keys each event by context, root and index, so every device records it once", () => {
    const out = toNotifications(SOURCE, {
      newRoot: "root-1",
      events: [
        { kind: "MessageSent", data: bytes({ channel: "#launch", text: "hi", sender: "Maya" }) },
        { kind: "IssueAssigned", data: bytes({ title: "HF-31" }) },
      ],
    });
    expect(out.map((n) => n.key)).toEqual(["ctx-chat:root-1:0", "ctx-chat:root-1:1"]);
    expect(out[0]).toMatchObject({ app: "chat", title: "New message in #launch", body: "hi", from: "Maya" });
    expect(out[1]).toMatchObject({ title: "Assigned an issue to you", body: "HF-31", needs_you: true });
  });

  it("files an unknown kind under its name and skips bookkeeping", () => {
    const out = toNotifications(SOURCE, {
      newRoot: "r",
      events: [{ kind: "PollClosingSoon", data: null }, { kind: "Read", data: null }],
    });
    expect(out).toHaveLength(1);
    expect(out[0]?.title).toBe("Poll closing soon");
  });

  it("records nothing without a root hash to key it by", () => {
    expect(toNotifications(SOURCE, { events: [{ kind: "MessageSent" }] })).toEqual([]);
  });

  it("stays inside the contract's limits", () => {
    const [n] = toNotifications(SOURCE, {
      newRoot: "r".repeat(300),
      events: [{ kind: "MessageSent", data: bytes({ text: "x".repeat(5000) }) }],
    });
    expect(n!.key.length).toBeLessThanOrEqual(200);
    expect(n!.body.length).toBeLessThanOrEqual(2000);
  });
});

describe("helpers", () => {
  it("humanises event kinds", () => {
    expect(humanise("UpdatePublished")).toBe("Update published");
  });

  it("decodes only JSON objects", () => {
    expect(decodePayload(bytes({ a: 1 }))).toEqual({ a: 1 });
    expect(decodePayload(bytes([1, 2]))).toEqual({});
    expect(decodePayload([0xff, 0xfe])).toEqual({});
  });

  it("derives a contract-safe app key from a package", () => {
    expect(appKeyForPackage("com.calimero.mero-chat", "abc")).toBe("chat");
    expect(appKeyForPackage("com.example.Notes_App", "abc")).toBe("notes-app");
    expect(appKeyForPackage(undefined, "ABCDEF123456")).toBe("app-abcdef12");
  });
});
