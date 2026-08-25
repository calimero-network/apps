import { describe, expect, it } from "vitest";
import { buildDmMemberOptions } from "./dmMemberOptions";

describe("buildDmMemberOptions", () => {
  it("keeps only other group member identities and preserves known labels", () => {
    const options = buildDmMemberOptions({
      groupMembers: [
        { identity: "member-me", role: "Admin" },
        { identity: "member-a", alias: "Alice Alias", role: "Member" },
        { identity: "member-b", role: "Member" },
      ],
      currentMemberIdentity: "member-me",
      labelsByIdentity: new Map([
        ["member-a", "Alice"],
        ["member-b", "Bob"],
      ]),
    });

    expect(Array.from(options.entries())).toEqual([
      ["member-a", "Alice Alias"],
      ["member-b", "Bob"],
    ]);
  });

  it("prefers alias over labelsByIdentity when both exist", () => {
    const options = buildDmMemberOptions({
      groupMembers: [
        { identity: "member-me", role: "Member" },
        // member-a has both an alias and a labelsByIdentity entry; alias wins
        { identity: "member-a", alias: "Alias Name", role: "Member" },
      ],
      currentMemberIdentity: "member-me",
      labelsByIdentity: new Map([["member-a", "Label Name"]]),
    });

    expect(options.get("member-a")).toBe("Alias Name");
  });

  it("falls back to labelsByIdentity when alias is absent", () => {
    const options = buildDmMemberOptions({
      groupMembers: [
        { identity: "member-me", role: "Member" },
        { identity: "member-b", role: "Member" },
      ],
      currentMemberIdentity: "member-me",
      labelsByIdentity: new Map([["member-b", "Label Only"]]),
    });

    expect(options.get("member-b")).toBe("Label Only");
  });

  it("includes a member with no name, shown as a truncated account", () => {
    // Reverses an earlier decision. The comment here used to read "showing raw
    // identity hashes in the DM member list is confusing" — true, but the
    // remedy was to drop the person from the list entirely, which made them
    // impossible to message and said nothing about why. A truncated account is
    // the honest middle: identifiable, unmistakably not a name.
    const options = buildDmMemberOptions({
      groupMembers: [
        { identity: "member-me", role: "Member" },
        { identity: "abcd1234efgh5678", role: "Member" },
      ],
      currentMemberIdentity: "member-me",
      labelsByIdentity: new Map(),
    });

    expect(options.size).toBe(1);
    expect(options.get("abcd1234efgh5678")).toBe("abcd…5678");
    expect(options.has("member-me")).toBe(false);
  });

  it("still prefers a real name over the account fallback", () => {
    const options = buildDmMemberOptions({
      groupMembers: [
        { identity: "member-me", role: "Member" },
        { identity: "abcd1234efgh5678", alias: "Alice", role: "Member" },
      ],
      currentMemberIdentity: "member-me",
      labelsByIdentity: new Map(),
    });

    expect(options.get("abcd1234efgh5678")).toBe("Alice");
  });

  it("never lists you as someone to message", () => {
    // The self-exclusion must not depend on having a name: without it, an
    // unnamed user would now appear in their own picker.
    const options = buildDmMemberOptions({
      groupMembers: [{ identity: "member-me", role: "Member" }],
      currentMemberIdentity: "member-me",
      labelsByIdentity: new Map(),
    });

    expect(options.size).toBe(0);
  });

});
