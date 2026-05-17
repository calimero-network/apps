import { describe, expect, it } from "vitest";
import type { GroupMember } from "../api/groupApi";
import { resolveCurrentGroupMemberIdentity } from "./groupMemberIdentity";

const buildMember = (
  identity: string,
  role: GroupMember["role"] = "Member",
): GroupMember => ({
  identity,
  role,
});

describe("resolveCurrentGroupMemberIdentity", () => {
  it("keeps a stored identity when it is still a group member", () => {
    const result = resolveCurrentGroupMemberIdentity({
      members: [buildMember("alice"), buildMember("bob")],
      storedMemberIdentity: "bob",
    });

    expect(result).toEqual({
      memberIdentity: "bob",
      source: "stored",
    });
  });

  it("falls back to the only member when the group has one member", () => {
    const result = resolveCurrentGroupMemberIdentity({
      members: [buildMember("solo", "Admin")],
      storedMemberIdentity: "",
    });

    expect(result).toEqual({
      memberIdentity: "solo",
      source: "single-member",
    });
  });

  it("does not guess when the stored identity is stale and multiple members exist", () => {
    const result = resolveCurrentGroupMemberIdentity({
      members: [buildMember("alice"), buildMember("bob")],
      storedMemberIdentity: "stale",
    });

    expect(result).toEqual({
      memberIdentity: "",
      source: "unresolved",
    });
  });
});
