import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it, vi } from "vitest";

import { CALLS, VIEWS, chat, toMessage, toSearchPage, type WireMessage } from "./chat";

/** The committed ABI of the contract (`mero-component build`; CI asserts it is current). */
const abi = JSON.parse(readFileSync(resolve(__dirname, "../../../logic/res/abi.json"), "utf8")) as {
  methods: Record<string, { kind: string; params: Array<[string, string]> }>;
};

const byKind = (kind: string) =>
  Object.entries(abi.methods)
    .filter(([, m]) => m.kind === kind)
    .map(([name]) => name)
    .sort();

const wire: WireMessage = {
  index: "4",
  timestamp: "1700000000",
  sender: "acc-bob",
  mentions: ["acc-carol"],
  mentionsUsernames: ["Carol"],
  files: [{ name: "r.pdf", mimeType: "application/pdf", size: "11", blobId: "ab".repeat(32), uploadedAt: "1700000000000" }],
  images: [],
  id: "m1",
  text: "<p>hi</p>",
  editedOn: null,
  reactions: { "👍": ["acc-carol"] },
  deleted: null,
  threadCount: 2,
  threadLastTimestamp: "1700000100",
  parentMessageId: null,
};

describe("the client covers the contract", () => {
  it("calls exactly the contract's calls, and views exactly its views", () => {
    expect([...CALLS].sort()).toEqual(byKind("call"));
    expect([...VIEWS].sort()).toEqual(byKind("view"));
    expect(byKind("init")).toEqual(["init"]);
  });

  it("sends each method the parameter names the ABI declares (no more)", async () => {
    const sent = new Map<string, string[]>();
    const record = (_app: string, method: string, args: unknown = {}) => {
      sent.set(method, Object.keys(args as object).sort());
      const result = method === "sendMessage" || method === "editMessage" ? wire : method.startsWith("search") ? { hits: [], nextCursor: null, frontierTimestamp: null } : method.startsWith("getMessages") ? { totalCount: 0, messages: [], startPosition: 0 } : null;
      return Promise.resolve({ index: 1, result, events: [] });
    };
    const c = chat({ call: vi.fn(record), view: vi.fn(record) }, "app-1");
    const blob = { name: "a", blob_id_str: "ab".repeat(32), mime_type: "x", size: 1 };
    await Promise.all([
      c.getInfo(),
      c.getChannelInfo("general"),
      c.updateInfo("n", "d"),
      c.markMessagesAsRead("general", 1),
      c.markAsRead(1),
      c.getUnreadCount(),
      c.getUnreadMentions(),
      c.setProfile("u", "a"),
      c.getProfiles("c", 10),
      c.saveDraft("c", "t"),
      c.getDraft("c"),
      c.deleteDraft("c"),
      c.getMemberRole("i"),
      c.listRoles("c", 10),
      c.setMemberRole("t", "Mod"),
      c.sendMessage({ message: "m", mentions: [], mentionsUsernames: [], parentMessage: "p", timestamp: 1, files: [blob], images: [blob] }),
      c.getMessages({ parentMessage: "p", limit: 1, offset: 1, searchTerm: "s" }),
      c.getMessagesFrom(0, 1),
      c.getMessageCount(),
      c.searchMessages("q", "c", 1),
      c.searchMessagesScan("q", "c", 1),
      c.messagePosition("m"),
      c.messageIdAt(0, "p"),
      c.updateReaction("m", "e", true),
      c.editMessage("m", "t", 1, "p"),
      c.deleteMessage("m", "p"),
    ]);
    for (const [name, method] of Object.entries(abi.methods)) {
      if (method.kind === "init") continue;
      expect(sent.get(name), name).toEqual(method.params.map(([p]) => p).sort());
    }
  });

  it("sends 64-bit integers as decimal strings and leaves out what is not given", async () => {
    const call = vi.fn().mockResolvedValue({ index: 1, result: wire, events: [] });
    const after = vi.fn();
    const c = chat({ call, view: vi.fn() }, "app-1", after);
    await c.sendMessage({ message: "hi", mentions: [], mentionsUsernames: [], timestamp: 1700000000.7 });
    expect(call).toHaveBeenCalledWith("app-1", "sendMessage", {
      message: "hi",
      mentions: [],
      mentionsUsernames: [],
      timestamp: "1700000000",
    });
    expect(after).toHaveBeenCalledTimes(1);
  });
});

describe("the adapter", () => {
  it("turns a message back into the shape the screens read", () => {
    expect(toMessage(wire)).toEqual({
      index: 4,
      id: "m1",
      sender: "acc-bob",
      text: "<p>hi</p>",
      timestamp: 1700000000,
      deleted: undefined,
      edited_on: undefined,
      reactions: { "👍": ["acc-carol"] },
      thread_count: 2,
      thread_last_timestamp: 1700000100,
      files: [{ name: "r.pdf", blob_id: "ab".repeat(32), mime_type: "application/pdf", size: 11, uploaded_at: 1700000000000 }],
      images: [],
      parent_message_id: undefined,
      mentions: ["acc-carol"],
      mentions_usernames: ["Carol"],
    });
    expect(toMessage({ ...wire, reactions: null, deleted: true, editedOn: "5" })).toMatchObject({
      reactions: {},
      deleted: true,
      edited_on: 5,
    });
  });

  it("turns a search page back, keeping a missing position null", () => {
    expect(
      toSearchPage({
        hits: [{ id: "m", parentMessageId: null, index: null, timestamp: "3", anchorTimestamp: "3", sender: "a", snippet: "s", matchStart: 0, matchEnd: 1 }],
        nextCursor: "20",
        frontierTimestamp: null,
      }),
    ).toEqual({
      hits: [{ id: "m", parent_message_id: null, index: null, timestamp: 3, anchor_timestamp: 3, sender: "a", snippet: "s", match_start: 0, match_end: 1 }],
      next_cursor: "20",
      frontier_timestamp: null,
    });
  });
});
