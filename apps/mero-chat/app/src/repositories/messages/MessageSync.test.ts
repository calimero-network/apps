import { describe, expect, it } from "vitest";

import {
  CATCH_UP_PAGE,
  MAX_CATCH_UP_PAGES,
  MessageSyncEngine,
  type ChannelCursor,
  type MessagePage,
  type MessageSource,
  type MessageStore,
} from "./MessageSync";

interface Msg {
  index: number;
  id: string;
  text: string;
}

/** A channel on the node, as an ordered list. */
function nodeWith(
  count: number,
): MessageSource<Msg> & {
  calls: string[];
  mutate: (i: number, t: string) => void;
  range: MessageSource<Msg>["range"];
} {
  const all: Msg[] = Array.from({ length: count }, (_, i) => ({
    index: i,
    id: `id-${i}`,
    text: `m${i}`,
  }));
  const calls: string[] = [];
  return {
    calls,
    mutate(index: number, text: string) {
      const row = all[index];
      if (row) row.text = text;
    },
    async count() {
      calls.push("count");
      return all.length;
    },
    async range(_ctx, start, limit): Promise<MessagePage<Msg>> {
      calls.push(`range(${start},${limit})`);
      return {
        // Copies, not references: a real store serialises, so it cannot see a
        // later mutation of the node's own row. Sharing the object made the
        // store look self-updating and hid the staleness under test.
        messages: all.slice(start, start + limit).map((m) => ({ ...m })),
        totalCount: all.length,
      };
    },
  };
}

function memoryStore(): MessageStore<Msg> & { rows: Map<number, Msg> } {
  const rows = new Map<number, Msg>();
  let cursor: ChannelCursor | undefined;
  return {
    rows,
    async read(_ctx, start, limit) {
      const out: Msg[] = [];
      for (let i = start; i < start + limit; i++) {
        const row = rows.get(i);
        if (row) out.push(row);
      }
      return out;
    },
    async put(_ctx, messages) {
      messages.forEach((m) => rows.set(m.index, m));
    },
    async cursor() {
      return cursor;
    },
    async saveCursor(next) {
      cursor = next;
    },
  };
}

const CTX = "ctx-1";

describe("MessageSyncEngine", () => {
  it("refreshes the whole loaded range when the id is unknown", async () => {
    // The case that bit in practice: an edit names a message this session
    // never loaded, so there is no index for it. Falling back to the NEWEST
    // page misses anything the user has scrolled back to — and scrolling back
    // will not repair it either, because `loadOlder` only fetches BEFORE what
    // is already displayed. Refresh what is on screen instead.
    const store = memoryStore();
    const node = nodeWith(200);
    const engine = new MessageSyncEngine<Msg>(store, node);

    await engine.catchUp(CTX);
    const cold = new MessageSyncEngine<Msg>(store, node);
    node.mutate(120, "m120-edited");
    node.calls.length = 0;

    const changed = await cold.refreshLoaded(CTX, 120);

    expect(node.calls).toEqual(["range(120,80)"]);
    expect(changed.find((m) => m.index === 120)?.text).toBe("m120-edited");
  });

  it("reports only what actually changed", async () => {
    const store = memoryStore();
    const node = nodeWith(200);
    const engine = new MessageSyncEngine<Msg>(store, node);

    await engine.catchUp(CTX);
    const changed = await engine.refreshLoaded(CTX, 190);

    // Nothing moved, so nothing to re-render.
    expect(changed).toEqual([]);
  });

  it("refreshLoaded on an unknown channel does nothing", async () => {
    const store = memoryStore();
    const node = nodeWith(200);
    const engine = new MessageSyncEngine<Msg>(store, node);

    expect(await engine.refreshLoaded(CTX, 0)).toEqual([]);
    expect(node.calls).toEqual([]);
  });

  it("reads older messages from the node even when the store holds them", async () => {
    // The rule this pins: the store may accelerate a paint, it may not ANSWER a
    // read. A stored row froze its reactions and its text at write time, so
    // returning it as the answer is how an edit or a reaction on an old message
    // stays invisible. The node is the truth; the store is a fallback.
    const store = memoryStore();
    const node = nodeWith(200);
    const engine = new MessageSyncEngine<Msg>(store, node);

    await engine.catchUp(CTX);
    await engine.loadOlder(CTX, 20, 100);
    node.mutate(85, "m85-edited");
    node.calls.length = 0;

    const older = await engine.loadOlder(CTX, 20, 100);

    expect(node.calls).toEqual(["range(80,20)"]);
    expect(older.find((m) => m.index === 85)?.text).toBe("m85-edited");
  });

  it("falls back to stored history when the node cannot be reached", async () => {
    // Offline is the one case the store exists for. It must serve the read
    // rather than fail it.
    const store = memoryStore();
    const node = nodeWith(200);
    const engine = new MessageSyncEngine<Msg>(store, node);

    await engine.catchUp(CTX);
    await engine.loadOlder(CTX, 20, 100);

    const realRange = node.range;
    node.range = async () => {
      throw new Error("offline");
    };

    const older = await engine.loadOlder(CTX, 20, 100);
    expect(older.map((m) => m.index)).toEqual(
      Array.from({ length: 20 }, (_, i) => 80 + i),
    );

    node.range = realRange;
  });

  it("fails rather than reporting an empty page when offline and unstored", async () => {
    const store = memoryStore();
    const node = nodeWith(200);
    const engine = new MessageSyncEngine<Msg>(store, node);

    await engine.catchUp(CTX);
    node.range = async () => {
      throw new Error("offline");
    };

    await expect(engine.loadOlder(CTX, 20, 50)).rejects.toThrow("offline");
  });

  it("refreshes one message by id, without dragging the window back", async () => {
    // A reaction names the message it changed. Refreshing THAT message is the
    // difference between a reaction appearing wherever it lands and appearing
    // only if it happens to be near the bottom.
    const store = memoryStore();
    const node = nodeWith(60);
    const engine = new MessageSyncEngine<Msg>(store, node);

    await engine.catchUp(CTX);
    node.mutate(12, "m12-reacted");
    node.calls.length = 0;

    const refreshed = await engine.refreshMessage(CTX, "id-12");

    expect(refreshed?.text).toBe("m12-reacted");
    expect(store.rows.get(12)?.text).toBe("m12-reacted");
    // Exactly the one row, not the tail.
    expect(node.calls).toEqual(["range(12,1)"]);
  });

  it("falls back to the newest window for an id it has never seen", async () => {
    // After a reload the engine has no id map — the rows are on disk, their
    // ids are not. Refreshing the window is strictly better than doing
    // nothing, and bounded.
    const store = memoryStore();
    const node = nodeWith(30);
    const engine = new MessageSyncEngine<Msg>(store, node);

    await engine.catchUp(CTX);
    const cold = new MessageSyncEngine<Msg>(store, node);
    node.mutate(29, "m29-reacted");
    node.calls.length = 0;

    const refreshed = await cold.refreshMessage(CTX, "id-29", 5);

    expect(node.calls).toEqual(["range(25,5)"]);
    expect(refreshed?.text).toBe("m29-reacted");
  });

  it("returns null when the id is unknown and not in the fallback window", async () => {
    const store = memoryStore();
    const node = nodeWith(30);
    const engine = new MessageSyncEngine<Msg>(store, node);

    await engine.catchUp(CTX);
    const cold = new MessageSyncEngine<Msg>(store, node);

    const refreshed = await cold.refreshMessage(CTX, "id-2", 3);

    // Honest about not having found it, rather than returning something else.
    expect(refreshed).toBeNull();
  });

  it("learns ids from every path that yields messages", async () => {
    const store = memoryStore();
    const node = nodeWith(200);
    const engine = new MessageSyncEngine<Msg>(store, node);

    await engine.catchUp(CTX);
    // Scrolling back is how an older message becomes addressable.
    await engine.loadOlder(CTX, 20, 100);
    node.mutate(85, "m85-reacted");
    node.calls.length = 0;

    const refreshed = await engine.refreshMessage(CTX, "id-85");

    expect(node.calls).toEqual(["range(85,1)"]);
    expect(refreshed?.text).toBe("m85-reacted");
  });

  it("catchUp does not notice a message that changed in place", async () => {
    // The gap this pins: catchUp walks FORWARD from the cursor. A reaction
    // mutates an existing message without changing the count, so catchUp sees
    // nothing newer, fetches nothing, and the stored copy keeps its old
    // reactions for as long as the channel stays open.
    const store = memoryStore();
    const node = nodeWith(3);
    const engine = new MessageSyncEngine<Msg>(store, node);

    await engine.catchUp(CTX);
    expect(store.rows.get(1)?.text).toBe("m1");

    // Someone reacts to message 1: same index, same count, new content.
    node.mutate(1, "m1-reacted");
    node.calls.length = 0;

    const result = await engine.catchUp(CTX);

    expect(result.fetched).toBe(0);
    expect(node.calls).toEqual(["count"]);
    expect(store.rows.get(1)?.text).toBe("m1");
  });

  it("refreshNewest re-reads what the store already holds", async () => {
    const store = memoryStore();
    const node = nodeWith(3);
    const engine = new MessageSyncEngine<Msg>(store, node);

    await engine.catchUp(CTX);
    node.mutate(1, "m1-reacted");
    node.calls.length = 0;

    const refreshed = await engine.refreshNewest(CTX, 10);

    expect(store.rows.get(1)?.text).toBe("m1-reacted");
    expect(refreshed.map((m) => m.text)).toContain("m1-reacted");
    // It must go to the node: serving the local copy is the bug it fixes.
    expect(node.calls.some((c) => c.startsWith("range("))).toBe(true);
  });

  it("refreshNewest is bounded by the limit it is given", async () => {
    const store = memoryStore();
    const node = nodeWith(50);
    const engine = new MessageSyncEngine<Msg>(store, node);

    await engine.catchUp(CTX);
    node.calls.length = 0;

    await engine.refreshNewest(CTX, 5);

    // Only the tail is re-read — a reaction should not drag the whole history
    // back across the wire.
    expect(node.calls).toEqual(["range(45,5)"]);
  });

  it("refreshNewest on a channel with no cursor does nothing", async () => {
    const store = memoryStore();
    const node = nodeWith(3);
    const engine = new MessageSyncEngine<Msg>(store, node);

    const refreshed = await engine.refreshNewest(CTX, 10);

    expect(refreshed).toEqual([]);
    expect(node.calls).toEqual([]);
  });

  it("on a first visit stores the newest page, not the whole history", async () => {
    // Opening a channel with years of history must not download all of it
    // before the first paint. The newest page is what the user is looking at.
    const store = memoryStore();
    const node = nodeWith(1000);
    const sync = new MessageSyncEngine(store, node);

    const result = await sync.catchUp(CTX);

    expect(result.fetched).toBe(CATCH_UP_PAGE);
    expect(store.rows.has(999)).toBe(true);
    expect(store.rows.has(0)).toBe(false);
    expect((await store.cursor(CTX))?.highestIndex).toBe(999);
  });

  it("costs one count call when already current", async () => {
    // The common case on every reconnect. It must not transfer message bodies
    // to discover there is nothing to transfer.
    const store = memoryStore();
    const node = nodeWith(10);
    const sync = new MessageSyncEngine(store, node);

    await sync.catchUp(CTX);
    node.calls.length = 0;

    const result = await sync.catchUp(CTX);

    expect(result).toEqual({ fetched: 0, upToDate: true });
    expect(node.calls).toEqual(["count"]);
  });

  it("fetches exactly what was missed while closed", async () => {
    // The two-hours-later case: no overlap to dedupe, no gap left behind.
    const store = memoryStore();
    const sync = new MessageSyncEngine(store, nodeWith(10));
    await sync.catchUp(CTX);

    const later = nodeWith(25);
    const resumed = new MessageSyncEngine(store, later);
    later.calls.length = 0;

    const result = await resumed.catchUp(CTX);

    expect(result).toEqual({ fetched: 15, upToDate: true });
    expect(later.calls).toContain(`range(10,${CATCH_UP_PAGE})`);
    for (let i = 0; i < 25; i++) expect(store.rows.has(i)).toBe(true);
  });

  it("caps a very long absence instead of blocking on thousands of messages", async () => {
    const store = memoryStore();
    const sync = new MessageSyncEngine(store, nodeWith(10));
    await sync.catchUp(CTX);

    const later = nodeWith(10 + CATCH_UP_PAGE * (MAX_CATCH_UP_PAGES + 3));
    const resumed = new MessageSyncEngine(store, later);

    const result = await resumed.catchUp(CTX);

    expect(result.fetched).toBe(CATCH_UP_PAGE * MAX_CATCH_UP_PAGES);
    expect(result.upToDate).toBe(false);
  });

  it("goes to the node for older messages the store does not hold", async () => {
    // The first backfill after a fresh catch-up: nothing below the window is on
    // disk yet, so this SHOULD be a fetch.
    const store = memoryStore();
    const node = nodeWith(200);
    const sync = new MessageSyncEngine(store, node);
    await sync.catchUp(CTX); // holds 100..199 only

    node.calls.length = 0;
    const older = await sync.loadOlder(CTX, 20);

    expect(node.calls).toEqual(["range(80,20)"]);
    expect(older.map((m) => m.index)).toEqual(
      Array.from({ length: 20 }, (_, i) => 80 + i),
    );
  });

  it("falls through to the node when the store runs out", async () => {
    const store = memoryStore();
    const node = nodeWith(200);
    const sync = new MessageSyncEngine(store, node);
    await sync.catchUp(CTX);

    // Drop what the store holds below the window, as an eviction would.
    for (let i = 100; i < 120; i++) store.rows.delete(i);
    await store.saveCursor({
      contextId: CTX,
      lowestIndex: 120,
      highestIndex: 199,
      knownTotal: 200,
    });

    node.calls.length = 0;
    const older = await sync.loadOlder(CTX, 20);

    expect(node.calls).toEqual(["range(100,20)"]);
    expect(older).toHaveLength(20);
  });

  it("applies a live message that lands exactly where the copy ends", async () => {
    const store = memoryStore();
    const node = nodeWith(5);
    const sync = new MessageSyncEngine(store, node);
    await sync.catchUp(CTX);

    node.calls.length = 0;
    const outcome = await sync.applyLive(CTX, { index: 5, id: "id-5", text: "live" });

    expect(outcome).toBe("applied");
    expect(node.calls).toEqual([]);
    expect((await store.cursor(CTX))?.highestIndex).toBe(5);
  });

  it("resyncs rather than writing a live message that would leave a hole", async () => {
    // The important one. An event arriving ahead of the cursor means something
    // in between was missed. Writing it would make the cursor claim contiguity
    // it does not have, and no later read could detect the gap.
    const store = memoryStore();
    const sync = new MessageSyncEngine(store, nodeWith(5));
    await sync.catchUp(CTX);

    const later = nodeWith(9);
    const resumed = new MessageSyncEngine(store, later);

    const outcome = await resumed.applyLive(CTX, { index: 8, id: "id-8", text: "ahead" });

    expect(outcome).toBe("resynced");
    // Everything in between is present, not just the message that arrived.
    for (let i = 0; i < 9; i++) expect(store.rows.has(i)).toBe(true);
    expect((await store.cursor(CTX))?.highestIndex).toBe(8);
  });
});

describe("MessageSyncEngine.newest", () => {
  it("paints from the store without touching the node", async () => {
    // The offline reopen: history must appear before, and regardless of,
    // whether the node can be reached.
    const store = memoryStore();
    const node = nodeWith(200);
    await new MessageSyncEngine(store, node).catchUp(CTX);

    const offline: MessageSource<Msg> = {
      async count() {
        throw new Error("node unreachable");
      },
      async range() {
        throw new Error("node unreachable");
      },
    };
    const reopened = new MessageSyncEngine(store, offline);

    const painted = await reopened.newest(CTX, 30);

    expect(painted.map((m) => m.index)).toEqual(
      Array.from({ length: 30 }, (_, i) => 170 + i),
    );
  });

  it("returns nothing for a channel never opened before", async () => {
    const sync = new MessageSyncEngine(memoryStore(), nodeWith(50));
    expect(await sync.newest(CTX, 30)).toEqual([]);
  });

  it("does not claim messages below what is stored", async () => {
    const store = memoryStore();
    const sync = new MessageSyncEngine(store, nodeWith(10));
    await sync.catchUp(CTX);

    // Ask for more than the channel holds.
    const painted = await sync.newest(CTX, 500);

    expect(painted).toHaveLength(10);
  });
});

describe("MessageSyncEngine.loadOlder anchoring", () => {
  it("continues from what the view shows, not from what the store holds", async () => {
    // The hole bug: a catch-up can leave the store holding much more than the
    // view is painting. Walking back from the store's bound returns a block
    // that does not join onto the screen, and the gap is invisible afterwards.
    const store = memoryStore();
    const node = nodeWith(150);
    const sync = new MessageSyncEngine(store, node);

    await sync.catchUp(CTX); // stores 50..149
    const painted = await sync.newest(CTX, 20); // view shows 130..149
    expect(painted[0].index).toBe(130);

    const older = await sync.loadOlder(CTX, 20, painted[0].index);

    // Joins onto the view: 110..129, immediately before what is displayed.
    expect(older.map((m) => m.index)).toEqual(
      Array.from({ length: 20 }, (_, i) => 110 + i),
    );
  });

  it("keeps the store's low bound falling, never rising", async () => {
    // The bound describes contiguous coverage; reading nearer the top must not
    // narrow it, or a later backfill would refetch what is already on disk.
    const store = memoryStore();
    const sync = new MessageSyncEngine(store, nodeWith(150));
    await sync.catchUp(CTX); // lowestIndex 50

    await sync.loadOlder(CTX, 20, 130); // reads 110..129, above the bound

    expect((await store.cursor(CTX))?.lowestIndex).toBe(50);
  });

  it("stops at the beginning of the channel", async () => {
    const store = memoryStore();
    const sync = new MessageSyncEngine(store, nodeWith(150));
    await sync.catchUp(CTX);

    expect(await sync.loadOlder(CTX, 20, 0)).toEqual([]);
  });

  it("does not run off the start when fewer remain than asked for", async () => {
    const store = memoryStore();
    const sync = new MessageSyncEngine(store, nodeWith(150));
    await sync.catchUp(CTX);

    const older = await sync.loadOlder(CTX, 20, 5);

    expect(older.map((m) => m.index)).toEqual([0, 1, 2, 3, 4]);
  });
});

describe("MessageSyncEngine backfill de-duplication", () => {
  it("collapses two simultaneous backfills of the same range into one fetch", async () => {
    // A scroll to the top can fire "load older" twice before the first
    // resolves. Both then read the same anchor and ask for the same messages.
    const store = memoryStore();
    const node = nodeWith(200);
    const sync = new MessageSyncEngine(store, node);
    await sync.catchUp(CTX);
    node.calls.length = 0;

    const [a, b] = await Promise.all([
      sync.loadOlder(CTX, 20, 100),
      sync.loadOlder(CTX, 20, 100),
    ]);

    expect(node.calls).toEqual(["range(80,20)"]);
    expect(a.map((m) => m.index)).toEqual(b.map((m) => m.index));
  });

  it("does not confuse backfills of different ranges", async () => {
    const store = memoryStore();
    const node = nodeWith(200);
    const sync = new MessageSyncEngine(store, node);
    await sync.catchUp(CTX);
    node.calls.length = 0;

    const [a, b] = await Promise.all([
      sync.loadOlder(CTX, 20, 100),
      sync.loadOlder(CTX, 20, 60),
    ]);

    expect(a[0].index).toBe(80);
    expect(b[0].index).toBe(40);
    expect(node.calls.sort()).toEqual(["range(40,20)", "range(80,20)"]);
  });

  it("lets a later backfill of the same range run once the first is done", async () => {
    const store = memoryStore();
    const node = nodeWith(200);
    const sync = new MessageSyncEngine(store, node);
    await sync.catchUp(CTX);

    await sync.loadOlder(CTX, 20, 100);
    node.calls.length = 0;
    const again = await sync.loadOlder(CTX, 20, 100);

    // Fetched again: the node answers reads now. What this pins is that the
    // second call RUNS at all — the single-flight guard must release once the
    // first settles, or a range could never be re-read.
    expect(node.calls).toEqual(["range(80,20)"]);
    expect(again.map((m) => m.index)).toEqual(
      Array.from({ length: 20 }, (_, i) => 80 + i),
    );
  });
});

describe("MessageSyncEngine.loadAround", () => {
  it("centres a window on the linked message", async () => {
    const store = memoryStore();
    const sync = new MessageSyncEngine(store, nodeWith(200));

    const around = await sync.loadAround(CTX, 100, 5);

    expect(around.map((m) => m.index)).toEqual([
      95, 96, 97, 98, 99, 100, 101, 102, 103, 104, 105,
    ]);
  });

  it("does not run off the start for a link near the beginning", async () => {
    const store = memoryStore();
    const sync = new MessageSyncEngine(store, nodeWith(200));

    const around = await sync.loadAround(CTX, 2, 5);

    expect(around[0].index).toBe(0);
    expect(around.map((m) => m.index)).toContain(2);
  });

  it("serves a window already on disk without asking the node", async () => {
    const store = memoryStore();
    const node = nodeWith(200);
    const sync = new MessageSyncEngine(store, node);
    await sync.catchUp(CTX); // stores 100..199
    node.calls.length = 0;

    const around = await sync.loadAround(CTX, 150, 5);

    expect(node.calls).toEqual([]);
    expect(around.map((m) => m.index)).toContain(150);
  });

  it("writes a fetched window down, so the same link is free next time", async () => {
    const store = memoryStore();
    const node = nodeWith(200);
    const sync = new MessageSyncEngine(store, node);

    await sync.loadAround(CTX, 40, 3);
    node.calls.length = 0;
    const again = await sync.loadAround(CTX, 40, 3);

    expect(node.calls).toEqual([]);
    expect(again.map((m) => m.index)).toContain(40);
  });

  it("leaves the cursor alone", async () => {
    // The cursor means "contiguous from the newest end". A window from the
    // middle does not extend that, and saying it did would make a later
    // backfill skip a gap it never filled.
    const store = memoryStore();
    const sync = new MessageSyncEngine(store, nodeWith(200));
    await sync.catchUp(CTX);
    const before = await store.cursor(CTX);

    await sync.loadAround(CTX, 20, 5);

    expect(await store.cursor(CTX)).toEqual(before);
  });
});
