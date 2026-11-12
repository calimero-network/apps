import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it, vi } from "vitest";
import { AppError } from "@calimero-network/mero-js";

vi.mock("./calimero", () => ({
  after: () => {},
  getClient: () => {
    throw new Error("tests pass a client");
  },
}));

import { METHODS, execute, messageOut, num, u64 } from "./meroChat";
import { withRoutes } from "@calimero-apps/connect/testing";

/** The committed component ABI: the contract this adapter must match. */
const abi = JSON.parse(
  readFileSync(resolve(__dirname, "../../../logic/res/abi.json"), "utf8"),
) as { methods: Record<string, { kind: string; params: [string, string][] }> };

function fakeClient(answer: unknown) {
  const call = vi.fn().mockResolvedValue({ index: 7, result: answer, events: [] });
  const view = vi.fn().mockResolvedValue({ index: 7, result: answer });
  return withRoutes({ call, view });
}

describe("the adapter's method table", () => {
  it("reaches every ABI method except init, each as the ABI runs it, with exactly its parameter names", async () => {
    const sent = new Map<string, { route: string; params: string[] }>();
    const record = (route: string) => async (_app: string, method: string, args: unknown = {}) => {
      sent.set(method, { route, params: Object.keys(args as object).sort() });
      return { index: 1, result: null, events: [] };
    };
    const client = withRoutes({ call: vi.fn(record("call")), view: vi.fn(record("view")) });
    // Every v1 name runs its generated method with v1's (empty) arguments.
    await Promise.all(Object.keys(METHODS).map((name) => execute("app-1", name, {}, client).catch(() => undefined)));
    const abiNames = Object.keys(abi.methods).filter((m) => abi.methods[m].kind !== "init").sort();
    expect([...sent.keys()].sort()).toEqual(abiNames);
    for (const name of abiNames) {
      const declared = abi.methods[name].params.map(([p]) => p).sort();
      expect(sent.get(name), name).toEqual({ route: abi.methods[name].kind, params: declared });
    }
  });
});

describe("conversions", () => {
  it("sends u64s as canonical decimal strings and reads them back as numbers", () => {
    expect(u64(1_700_000_000)).toBe("1700000000");
    expect(u64("42")).toBe("42");
    expect(u64(undefined)).toBe("0");
    expect(num("1700000000")).toBe(1_700_000_000);
    expect(num(3)).toBe(3);
  });

  it("puts a message back in v1's shape, emoji keys untouched", () => {
    const m = messageOut({
      index: "4",
      timestamp: "1700000000",
      sender: "acct-a",
      mentions: ["acct-b"],
      mentionsUsernames: ["bob"],
      files: [{ name: "a.pdf", mimeType: "application/pdf", size: "10", blobId: "ab", uploadedAt: "5" }],
      images: [],
      id: "m1_1700000000",
      text: "hi",
      editedOn: null,
      reactions: { "👍": ["acct-b"] },
      deleted: null,
      threadCount: 2,
      threadLastTimestamp: "1700000100",
      parentMessageId: null,
    });
    expect(m).toMatchObject({
      index: 4,
      timestamp: 1_700_000_000,
      mentions_usernames: ["bob"],
      files: [{ name: "a.pdf", mime_type: "application/pdf", size: 10, blob_id: "ab", uploaded_at: 5 }],
      reactions: { "👍": ["acct-b"] },
      thread_count: 2,
      thread_last_timestamp: 1_700_000_100,
    });
    expect(m.edited_on).toBeUndefined();
    expect(m.deleted).toBeUndefined();
  });
});

describe("execute", () => {
  it("sends v1's send_message as sendMessage with camelCase arguments", async () => {
    const client = fakeClient({ id: "m1", sender: "me", timestamp: "1", index: "0" });
    const out = await execute<{ id: string; timestamp: number }>(
      "app-1",
      "send_message",
      {
        message: "hello",
        mentions: [],
        mentions_usernames: ["everyone"],
        parent_message: undefined,
        timestamp: 1_700_000_000,
        files: [{ name: "f", mime_type: "text/plain", size: 3, blob_id_str: "ab".repeat(32) }],
      },
      withRoutes(client),
    );
    expect(client.call).toHaveBeenCalledWith("app-1", "sendMessage", {
      message: "hello",
      mentions: [],
      mentionsUsernames: ["everyone"],
      parentMessage: null,
      timestamp: "1700000000",
      files: [{ name: "f", mimeType: "text/plain", size: 3, blobIdStr: "ab".repeat(32) }],
      images: null,
    });
    expect(out).toMatchObject({ id: "m1", timestamp: 1 });
  });

  it("reads list_roles as [account, role] pairs", async () => {
    const client = fakeClient([["acct-a", "Admin"]]);
    await expect(execute("app-1", "list_roles", {}, withRoutes(client))).resolves.toEqual([["acct-a", "Admin"]]);
    expect(client.view).toHaveBeenCalledWith("app-1", "listRoles", {});
  });

  it("refuses a v1 method the contract does not have, as v1 did", async () => {
    await expect(execute("app-1", "get_channels", {}, withRoutes(fakeClient(null)))).rejects.toThrow(/Method not found/);
  });

  it("shows the contract's own message for a refusal", async () => {
    const client = fakeClient(null);
    client.call.mockRejectedValue(
      new AppError("app error", { code: "Forbidden", fields: { message: "You can only edit your own messages" } }),
    );
    await expect(
      execute("app-1", "edit_message", { message_id: "m", new_message: "x", timestamp: 1 }, withRoutes(client)),
    ).rejects.toThrow("You can only edit your own messages");
  });
});
