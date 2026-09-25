import { beforeEach, describe, expect, it } from "vitest";
import type { GroupMember } from "../api/groupApi";
import { findSelfMember, resolveCurrentGroupMemberIdentity } from "./groupMemberIdentity";
import {
  clearRegisteredContextIdentities,
  registerAccountIdentity,
} from "./selfIdentity";

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

describe("findSelfMember", () => {
  beforeEach(() => {
    clearRegisteredContextIdentities();
  });

  it("finds the row when the server keys members by the same signing key it reports as self", () => {
    // merod 0.11.0-rc.20 shape: members[].identity and selfIdentity are both
    // the base58 signing key.
    const members = [buildMember("67dkUZ", "Admin"), buildMember("9g9W2a")];

    expect(findSelfMember({ members, selfIdentity: "67dkUZ" })).toEqual(
      buildMember("67dkUZ", "Admin"),
    );
  });

  it("finds the row when members are keyed by ACCOUNT but selfIdentity is a signing key", () => {
    // core master shape: GroupMemberEntry.identity is an AccountId while
    // ListGroupMembersResponse.self_identity is still a PublicKey, so a
    // direct === can never match and every role check fails closed —
    // an admin reads as a plain user. See calimero-network/core#3402.
    registerAccountIdentity("6deb0c0c");
    const members = [buildMember("6deb0c0c", "Admin"), buildMember("aaaaaaaa")];

    expect(findSelfMember({ members, selfIdentity: "67dkUZ" })).toEqual(
      buildMember("6deb0c0c", "Admin"),
    );
  });

  it("returns undefined when no row belongs to this node", () => {
    const members = [buildMember("alice"), buildMember("bob")];

    expect(findSelfMember({ members, selfIdentity: "67dkUZ" })).toBeUndefined();
  });

  it("never matches another member's row", () => {
    registerAccountIdentity("6deb0c0c");
    const members = [buildMember("alice"), buildMember("bob")];

    expect(findSelfMember({ members, selfIdentity: "" })).toBeUndefined();
  });
});
