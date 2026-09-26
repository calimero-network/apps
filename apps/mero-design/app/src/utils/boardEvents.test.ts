import { describe, it, expect } from "vitest";
import { collectBoardChanges } from "./boardEvents";

const bytes = (v: unknown) => Array.from(new TextEncoder().encode(JSON.stringify(v)));
const ev = (kind: string, value?: unknown) => ({ kind, data: value === undefined ? [] : bytes(value) });
const mutation = (...events: ReturnType<typeof ev>[]) => ({ newRoot: "r", events });

describe("collectBoardChanges", () => {
  it("reads a batch event's ids", () => {
    const c = collectBoardChanges(mutation(ev("ElementsAdded", ["a", "b", "c"])));
    expect(c.fetch).toEqual(["a", "b", "c"]);
    expect(c.remove).toEqual([]);
  });

  it("folds many single events in one mutation into one fetch", () => {
    // What an older bundle's paste looks like on the wire.
    const c = collectBoardChanges(mutation(ev("ElementAdded", "a"), ev("ElementUpdated", "b"), ev("ElementAdded", "a")));
    expect(c.fetch).toEqual(["a", "b"]);
  });

  it("does not fetch what the same mutation deleted, and does fetch what it re-added", () => {
    const c = collectBoardChanges(mutation(
      ev("ElementsAdded", ["a", "b"]),
      ev("ElementsDeleted", ["a"]),
      ev("ElementDeleted", "c"),
      ev("ElementAdded", "c"),
    ));
    expect(c.fetch.sort()).toEqual(["b", "c"]);
    expect(c.remove).toEqual(["a"]);
  });

  it("maps the rest of the board's events to what they re-read", () => {
    const c = collectBoardChanges(mutation(
      ev("LayerReordered"),
      ev("CommentAdded", "k"),
      ev("CommentDeleted", "k2"),
      ev("CursorMoved", "me"),
      ev("OwnerTransferred", "x"),
    ));
    expect(c).toMatchObject({ layers: true, comments: true, removedComments: ["k2"], cursors: true, role: true, members: true });
  });

  it("ignores what it cannot read", () => {
    expect(collectBoardChanges(null).fetch).toEqual([]);
    expect(collectBoardChanges({}).fetch).toEqual([]);
    const c = collectBoardChanges({ events: [{ kind: "ElementsAdded", data: [0xff] }, { kind: "Mystery" }] });
    expect(c.fetch).toEqual([]);
  });
});
