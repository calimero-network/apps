import { describe, expect, it } from "vitest";
import {
  CAN_CREATE_CONTEXT,
  CAN_INVITE_MEMBERS,
  CAN_JOIN_OPEN_SUBGROUPS,
  buildGroupCapabilitiesMask,
  canCreateGroupContexts,
  readGroupCapabilitiesMask,
} from "./groupCapabilities";

describe("groupCapabilities", () => {
  it("builds a bitmask from the capability toggles", () => {
    expect(
      buildGroupCapabilitiesMask({
        canCreateContext: true,
        canInviteMembers: false,
        canJoinOpenSubgroups: true,
        canCreateSubgroup: false,
        canDeleteSubgroup: false,
        canManageVisibility: false,
      }),
    ).toBe(CAN_CREATE_CONTEXT + CAN_JOIN_OPEN_SUBGROUPS);
  });

  it("reads the toggle states from a bitmask", () => {
    expect(
      readGroupCapabilitiesMask(CAN_INVITE_MEMBERS + CAN_JOIN_OPEN_SUBGROUPS),
    ).toEqual({
      canCreateContext: false,
      canInviteMembers: true,
      canJoinOpenSubgroups: true,
      canCreateSubgroup: false,
      canDeleteSubgroup: false,
      canManageVisibility: false,
    });
  });

  it("detects create-context permission from the bitmask", () => {
    expect(canCreateGroupContexts(CAN_CREATE_CONTEXT)).toBe(true);
    expect(canCreateGroupContexts(CAN_INVITE_MEMBERS)).toBe(false);
  });
});
