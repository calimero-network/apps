import { describe, expect, it } from "vitest";
import { buildRoster, initials, shortId } from "./people";

describe("initials", () => {
  it("takes the first two letters of a single word", () => {
    expect(initials("Ana")).toBe("AN");
    expect(initials("bo")).toBe("BO");
  });

  it("takes first + last for a multi-word name", () => {
    expect(initials("Ana Kovac")).toBe("AK");
    expect(initials("Mary Jane Watson")).toBe("MW");
  });

  it("never returns empty, so an avatar always has a glyph", () => {
    // A blank avatar reads as a rendering bug, so an unusable name falls back.
    expect(initials("")).toBe("??");
    expect(initials("   ")).toBe("??");
    expect(initials("\t\n")).toBe("??");
  });

  it("collapses runs of whitespace instead of producing an empty word", () => {
    expect(initials("  Ana    Kovac  ")).toBe("AK");
  });

  it("does not split a surrogate pair", () => {
    // `"👋x".slice(0, 2)` splits the pair and renders a replacement glyph, which
    // is why this walks code points rather than UTF-16 units.
    expect(initials("👋x")).toBe("👋X");
    expect(initials("👋 wave")).toBe("👋W");
  });

  it("handles a one-character name", () => {
    expect(initials("A")).toBe("A");
  });
});

describe("buildRoster", () => {
  const base = {
    me: "me",
    selfName: "You",
    selfLive: false,
    liveIds: new Set<string>(),
  };

  it("marks us as ourselves and overrides our stored name", () => {
    // A rename is local and instant; the contract roster is a poll behind, and
    // showing the user their old name for ten seconds reads as a failed rename.
    const r = buildRoster({
      ...base,
      members: [{ memberId: "me", name: "stale-name" }],
      selfName: "Fresh",
    });
    expect(r).toHaveLength(1);
    expect(r[0].isSelf).toBe(true);
    expect(r[0].name).toBe("Fresh");
  });

  it("takes OUR live state from selfLive, not from liveIds", () => {
    // We never decode our own echo, so we are never in `liveIds` even while
    // broadcasting. Reading it there would show us as watching while live.
    const r = buildRoster({
      ...base,
      members: [{ memberId: "me", name: "You" }],
      selfLive: true,
    });
    expect(r[0].live).toBe(true);
  });

  it("marks a remote member live when their frames are arriving", () => {
    const r = buildRoster({
      ...base,
      members: [
        { memberId: "me", name: "You" },
        { memberId: "a", name: "Ana" },
        { memberId: "b", name: "Bo" },
      ],
      liveIds: new Set(["a"]),
    });
    const byId = Object.fromEntries(r.map((p) => [p.memberId, p]));
    expect(byId.a.live).toBe(true);
    expect(byId.b.live).toBe(false);
  });

  it("includes a broadcaster who is not in the roster yet", () => {
    // Real case: the contract roster is a poll behind, so someone who joins and
    // immediately broadcasts has a tile before they have a row.
    const r = buildRoster({
      ...base,
      members: [{ memberId: "me", name: "You" }],
      liveIds: new Set(["newcomer-abcdefghijk"]),
    });
    expect(r).toHaveLength(2);
    const extra = r.find((p) => p.memberId === "newcomer-abcdefghijk")!;
    expect(extra.live).toBe(true);
    expect(extra.isSelf).toBe(false);
    expect(extra.name).toBe(shortId("newcomer-abcdefghijk"));
  });

  it("does not duplicate a live member who IS in the roster", () => {
    const r = buildRoster({
      ...base,
      members: [
        { memberId: "me", name: "You" },
        { memberId: "a", name: "Ana" },
      ],
      liveIds: new Set(["a"]),
    });
    expect(r.filter((p) => p.memberId === "a")).toHaveLength(1);
  });

  it("sorts self first, then live, then by name", () => {
    const r = buildRoster({
      ...base,
      members: [
        { memberId: "z", name: "Zoe" },
        { memberId: "me", name: "You" },
        { memberId: "a", name: "Ana" },
        { memberId: "b", name: "Bo" },
      ],
      liveIds: new Set(["z", "b"]),
    });
    // me (self) → Bo, Zoe (live, alphabetical) → Ana (watching)
    expect(r.map((p) => p.memberId)).toEqual(["me", "b", "z", "a"]);
  });

  it("breaks a name tie on member id so the order never flickers", () => {
    // Two people can legitimately pick the same nickname. Without the id
    // tiebreak the sort is unstable and the rows swap on every re-render.
    const a = buildRoster({
      ...base,
      members: [
        { memberId: "id-b", name: "Sam" },
        { memberId: "id-a", name: "Sam" },
      ],
    });
    const b = buildRoster({
      ...base,
      members: [
        { memberId: "id-a", name: "Sam" },
        { memberId: "id-b", name: "Sam" },
      ],
    });
    expect(a.map((p) => p.memberId)).toEqual(["id-a", "id-b"]);
    expect(b.map((p) => p.memberId)).toEqual(a.map((p) => p.memberId));
  });

  it("returns an empty roster rather than throwing on no input", () => {
    expect(buildRoster({ ...base, members: [] })).toEqual([]);
  });

  it("keeps a live remote sender when we are not in the roster at all", () => {
    // Happens before our own `join` lands.
    const r = buildRoster({
      ...base,
      members: [],
      liveIds: new Set(["a-long-member-id"]),
    });
    expect(r).toHaveLength(1);
    expect(r[0].live).toBe(true);
  });
});
