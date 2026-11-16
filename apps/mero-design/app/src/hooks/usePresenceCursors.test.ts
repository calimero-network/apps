import { describe, expect, it } from "vitest";
import { presenceState } from "@calimero-network/mero-js";
import { cursorsOf, decodeCursor } from "./usePresenceCursors";

const hex = (v: unknown) => presenceState(new TextEncoder().encode(JSON.stringify(v)));
const entry = (account: string, device: string, state: string | null) =>
  ({ account, device, state }) as Parameters<typeof cursorsOf>[0] extends Iterable<infer E> ? E : never;

describe("live pointers from presence", () => {
  it("reads a pointer back from the hex the node keeps", () => {
    expect(decodeCursor(hex({ x: 12, y: 40 }))).toEqual({ x: 12, y: 40 });
    expect(decodeCursor(null)).toBeNull();
    expect(decodeCursor("zz")).toBeNull();
    expect(decodeCursor(hex({ typing: true }))).toBeNull();
  });

  it("lists everyone else's pointers, one per device, never your own", () => {
    const out = cursorsOf(
      [
        entry("acct-me", "d1", hex({ x: 1, y: 1 })),
        entry("acct-bob", "d2", hex({ x: 5, y: 6 })),
        entry("acct-bob", "d3", hex({ x: 7, y: 8 })),
        entry("acct-cy", "d4", hex({ nope: 1 })),
      ],
      { account: "acct-me" },
      1000,
    );
    expect(out).toEqual([
      { identity: "acct-bob/d2", account: "acct-bob", x: 5, y: 6, updatedAt: 1000 },
      { identity: "acct-bob/d3", account: "acct-bob", x: 7, y: 8, updatedAt: 1000 },
    ]);
  });
});
