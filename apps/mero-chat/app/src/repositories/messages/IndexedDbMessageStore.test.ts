import "fake-indexeddb/auto";
import { beforeEach, describe, expect, it } from "vitest";

import { resetDbForTests } from "../core/db";
import { IndexedDbMessageStore } from "./IndexedDbMessageStore";
import {
  MessageSyncEngine,
  type MessagePage,
  type MessageSource,
} from "./MessageSync";

// jsdom provides no SubtleCrypto, and the at-rest key needs a real one. Node
// exposes WebCrypto as a global from 20 onwards, so no `node:crypto` import —
// which would also drag @types/node into an app that otherwise has no Node
// types, just to reach something already standing on `globalThis`.
if (!globalThis.crypto?.subtle) {
  throw new Error(
    "No SubtleCrypto available; these tests need Node 20+ or a WebCrypto polyfill",
  );
}

interface Msg {
  index: number;
  text: string;
}

function nodeWith(count: number): MessageSource<Msg> & { calls: string[] } {
  const all: Msg[] = Array.from({ length: count }, (_, i) => ({
    index: i,
    text: `m${i}`,
  }));
  const calls: string[] = [];
  return {
    calls,
    async count() {
      calls.push("count");
      return all.length;
    },
    async range(_ctx, start, limit): Promise<MessagePage<Msg>> {
      calls.push(`range(${start},${limit})`);
      return { messages: all.slice(start, start + limit), totalCount: all.length };
    },
  };
}

const CTX = "ctx-db";

describe("IndexedDbMessageStore", () => {
  beforeEach(async () => {
    await resetDbForTests();
    await new Promise<void>((r) => {
      const req = indexedDB.deleteDatabase("mero-chat-repositories");
      req.onsuccess = () => r();
      req.onerror = () => r();
      req.onblocked = () => r();
    });
  });

  it("round-trips messages through encryption", async () => {
    const store = new IndexedDbMessageStore<Msg>();
    await store.put(CTX, [
      { index: 0, text: "hello" },
      { index: 1, text: "world" },
    ]);

    expect(await store.read(CTX, 0, 2)).toEqual([
      { index: 0, text: "hello" },
      { index: 1, text: "world" },
    ]);
  });

  it("stores the body as ciphertext, keeping only the position readable", async () => {
    // The claim the threat model rests on: a disk-level reader sees positions,
    // not words.
    const store = new IndexedDbMessageStore<Msg>();
    await store.put(CTX, [{ index: 7, text: "a-very-distinctive-secret" }]);

    // Read the raw rows as a disk-level attacker would: no unsealing.
    const raw = await new Promise<Record<string, unknown>[]>((resolve) => {
      const req = indexedDB.open("mero-chat-repositories");
      req.onsuccess = () => {
        const db = req.result;
        const get = db
          .transaction("messages", "readonly")
          .objectStore("messages")
          .getAll();
        get.onsuccess = () => {
          // Close it: a connection left open blocks the next test's delete.
          const rows = get.result;
          db.close();
          resolve(rows);
        };
      };
    });

    expect(raw).toHaveLength(1);
    expect(raw[0].index).toBe(7);
    expect(JSON.stringify(raw)).not.toContain("a-very-distinctive-secret");
  });

  it("reads only the requested window, not the whole channel", async () => {
    const store = new IndexedDbMessageStore<Msg>();
    await store.put(
      CTX,
      Array.from({ length: 50 }, (_, i) => ({ index: i, text: `m${i}` })),
    );

    const window = await store.read(CTX, 10, 5);

    expect(window.map((m) => m.index)).toEqual([10, 11, 12, 13, 14]);
  });

  it("keeps channels apart", async () => {
    const store = new IndexedDbMessageStore<Msg>();
    await store.put(CTX, [{ index: 0, text: "mine" }]);
    await store.put("other", [{ index: 0, text: "theirs" }]);

    expect(await store.read(CTX, 0, 1)).toEqual([{ index: 0, text: "mine" }]);
  });

  it("merges a backfill into stored history instead of replacing it", async () => {
    const store = new IndexedDbMessageStore<Msg>();
    await store.put(CTX, [{ index: 5, text: "newer" }]);
    await store.put(CTX, [{ index: 4, text: "older" }]);

    expect(await store.read(CTX, 4, 2)).toEqual([
      { index: 4, text: "older" },
      { index: 5, text: "newer" },
    ]);
  });

  it("fills the database as the user scrolls, and reopens without the node", async () => {
    // End to end, and the point of the whole exercise: scrolling up pulls from
    // the node ONCE, and the next session serves the same history from disk.
    const store = new IndexedDbMessageStore<Msg>();
    const node = nodeWith(200);
    const sync = new MessageSyncEngine(store, node);

    await sync.catchUp(CTX);
    await sync.loadOlder(CTX, 20); // 80..99, fetched
    await sync.loadOlder(CTX, 20); // 60..79, fetched
    expect(node.calls).toContain("range(80,20)");
    expect(node.calls).toContain("range(60,20)");

    // A later session: the connection is dropped and rebuilt, as on reload.
    await resetDbForTests();
    const reopened = new IndexedDbMessageStore<Msg>();
    const scrolled = await reopened.read(CTX, 60, 40);

    expect(scrolled.map((m) => m.index)).toEqual(
      Array.from({ length: 40 }, (_, i) => 60 + i),
    );
  });
});
