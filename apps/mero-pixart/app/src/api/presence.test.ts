import { describe, expect, it } from "vitest";

import { applyEntry, decodeCursor, encodeCursor } from "./presence";

const hex = (bytes: Uint8Array) => [...bytes].map((b) => b.toString(16).padStart(2, "0")).join("");

describe("pointers as presence", () => {
  it("round-trips a pointer through an entry's hex state", () => {
    expect(decodeCursor(hex(encodeCursor(12.4, -3.6)))).toEqual({ x: 12, y: -4 });
    expect(decodeCursor(null)).toBeNull();
    expect(decodeCursor("zz")).toBeNull();
    expect(decodeCursor(hex(new TextEncoder().encode("not json")))).toBeNull();
  });

  it("keeps one pointer per device, and drops a device that left", () => {
    const state = hex(encodeCursor(1, 2));
    let cursors = applyEntry([], { account: "ana", device: "laptop", state }, 10);
    cursors = applyEntry(cursors, { account: "ana", device: "tablet", state }, 11);
    cursors = applyEntry(cursors, { account: "ana", device: "laptop", state: hex(encodeCursor(5, 6)) }, 12);
    expect(cursors).toEqual([
      { identity: "ana", device: "tablet", x: 1, y: 2, updatedAt: 11 },
      { identity: "ana", device: "laptop", x: 5, y: 6, updatedAt: 12 },
    ]);
    expect(applyEntry(cursors, { account: "ana", device: "tablet", state: null })).toHaveLength(1);
  });
});
