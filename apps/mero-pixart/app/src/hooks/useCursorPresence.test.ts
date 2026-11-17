import { describe, expect, it } from "vitest";
import type { PresenceEntry } from "@calimero-network/mero-js";

import { cursorsOf, decodeCursor } from "./useCursorPresence";

const hex = (v: unknown) =>
  Array.from(new TextEncoder().encode(JSON.stringify(v)), (b) => b.toString(16).padStart(2, "0")).join("");

const entry = (account: string, device: string, state: string | null) =>
  ({ account, device, state }) as unknown as PresenceEntry;

describe("decodeCursor", () => {
  it("reads a published position", () => {
    expect(decodeCursor(hex({ x: 12, y: 40 }))).toEqual({ x: 12, y: 40 });
  });

  it("ignores what is not a position", () => {
    expect(decodeCursor(null)).toBeNull();
    expect(decodeCursor("zz")).toBeNull();
    expect(decodeCursor(hex({ typing: true }))).toBeNull();
  });
});

describe("cursorsOf", () => {
  it("one cursor per other account, the newest of its devices", () => {
    const seen = new Map([
      ["bob/a", 100],
      ["bob/b", 200],
      ["me/a", 300],
    ]);
    const cursors = cursorsOf(
      [entry("bob", "a", hex({ x: 1, y: 1 })), entry("bob", "b", hex({ x: 2, y: 2 })), entry("me", "a", hex({ x: 3, y: 3 }))],
      "me",
      seen,
    );
    expect(cursors).toEqual([{ identity: "bob", x: 2, y: 2, updatedAt: 200 }]);
  });
});
