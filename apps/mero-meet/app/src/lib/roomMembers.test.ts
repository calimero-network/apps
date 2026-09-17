import { describe, expect, it } from "vitest";
import { labelMembers, memberLabel, summariseMembers } from "./roomMembers";

// Deliberately the FULL contract row, not a bare NamedMember: these labels are
// fed real roster rows, and a fixture trimmed to the minimum would not notice
// if the label code started reading a field it should not.
const member = (memberId: string, username: string) => ({
  memberId,
  username,
  joinedAt: 0,
  updatedAt: 0,
});

const ALICE = "a".repeat(64);
const BOB = "b".repeat(64);
const CAROL = "c".repeat(64);
const DAVE = "d".repeat(64);

describe("memberLabel", () => {
  it("uses the name the member chose", () => {
    expect(memberLabel(member(ALICE, "fran1"), "").label).toBe("fran1");
  });

  it("falls back to a short id and says so when there is no name", () => {
    // A member can be in the context before opening the room and picking a
    // name. Rendering an empty chip there is worse than a short id, but the
    // caller has to know it is a placeholder rather than a name.
    const l = memberLabel(member(ALICE, ""), "");
    expect(l.label).toBe("aaaaaaaa…");
    expect(l.anonymous).toBe(true);
  });

  it("treats whitespace as no name", () => {
    expect(memberLabel(member(ALICE, "   "), "").anonymous).toBe(true);
  });

  it("marks the caller", () => {
    expect(memberLabel(member(ALICE, "fran1"), ALICE).isSelf).toBe(true);
    expect(memberLabel(member(BOB, "bob"), ALICE).isSelf).toBe(false);
  });

  it("does not mark anyone when the caller is unknown", () => {
    expect(memberLabel(member(ALICE, "fran1"), "").isSelf).toBe(false);
  });
});

describe("labelMembers", () => {
  it("puts self first, then named members, then anonymous ones", () => {
    const rows = labelMembers(
      [member(CAROL, ""), member(BOB, "bob"), member(ALICE, "fran1")],
      ALICE,
    );
    expect(rows.map((r) => r.label)).toEqual(["fran1", "bob", "cccccccc…"]);
  });

  it("orders named members alphabetically, so the list does not reshuffle", () => {
    const rows = labelMembers([member(BOB, "zoe"), member(CAROL, "adam")], "");
    expect(rows.map((r) => r.label)).toEqual(["adam", "zoe"]);
  });

  it("handles an empty roster", () => {
    expect(labelMembers([], ALICE)).toEqual([]);
  });
});

describe("summariseMembers", () => {
  it("names the caller 'You' rather than repeating their nickname", () => {
    const rows = labelMembers([member(ALICE, "fran1")], ALICE);
    expect(summariseMembers(rows)).toBe("You");
  });

  it("counts the overflow instead of dropping it", () => {
    // "+1" is the difference between a truncated list and a wrong one.
    const rows = labelMembers(
      [
        member(ALICE, "a1"),
        member(BOB, "b1"),
        member(CAROL, "c1"),
        member(DAVE, "d1"),
      ],
      "",
    );
    expect(summariseMembers(rows, 3)).toBe("a1, b1, c1 +1");
  });

  it("does not add an overflow marker when everyone fits", () => {
    const rows = labelMembers([member(ALICE, "a1"), member(BOB, "b1")], "");
    expect(summariseMembers(rows, 3)).toBe("a1, b1");
  });

  it("is empty for an empty roster", () => {
    expect(summariseMembers([])).toBe("");
  });
});
