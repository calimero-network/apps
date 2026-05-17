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

  it("omits members with no label (no alias and not in labelsByIdentity)", () => {
    // Members without any display name are excluded from the picker —
    // showing raw identity hashes in the DM/channel member list is confusing.
    const options = buildDmMemberOptions({
      groupMembers: [
        { identity: "member-me", role: "Member" },
        { identity: "member-a", role: "Member" },
      ],
      currentMemberIdentity: "member-me",
      labelsByIdentity: new Map(),
    });

    expect(options.size).toBe(0);
    expect(options.has("member-me")).toBe(false);
    expect(options.has("member-a")).toBe(false);
  });
});
