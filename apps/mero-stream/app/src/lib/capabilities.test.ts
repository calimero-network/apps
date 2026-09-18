import { describe, expect, it } from "vitest";
import { CAPABILITIES } from "@calimero-network/mero-js";

import { ADMIN_CAPABILITIES, MEMBER_CAPABILITIES } from "./groups";

/**
 * These two properties are the whole role system. Both were violated by the
 * single number (`15`) this replaced, in opposite directions, and neither
 * failure is visible from the UI — an over-granted member looks like a member
 * until they demote you, and an under-granted one gets a 403 from a button the
 * app happily rendered.
 */
describe("namespace capabilities", () => {
  it("does NOT let an invited member govern the space", () => {
    // The bug in `15`: MANAGE_MEMBERS was in the DEFAULT, so everyone admitted
    // could change anyone's role, including the person who invited them.
    expect(MEMBER_CAPABILITIES & CAPABILITIES.MANAGE_MEMBERS).toBe(0);
    expect(ADMIN_CAPABILITIES & CAPABILITIES.MANAGE_MEMBERS).not.toBe(0);
  });

  it("lets a member do every non-governing thing the app asks of them", () => {
    // The other half of the bug: `15` omitted the subgroup bits, so creating a
    // room worked for the namespace owner (who holds full caps regardless of
    // the default) and failed for everyone they invited.
    for (const cap of [
      "CAN_CREATE_CONTEXT",
      "CAN_INVITE_MEMBERS",
      "CAN_JOIN_OPEN_SUBGROUPS",
      "CAN_CREATE_SUBGROUP",
      "CAN_MANAGE_VISIBILITY",
      "CAN_MANAGE_METADATA",
    ] as const) {
      expect(MEMBER_CAPABILITIES & CAPABILITIES[cap]).not.toBe(0);
    }
  });

  it("withholds authorship-on-behalf from both roles", () => {
    // Lets a node publish writes attributed to ANOTHER member. That is publishing under
    // someone else's name. No call site here needs it.
    expect(MEMBER_CAPABILITIES & CAPABILITIES.CAN_AUTHOR_ON_BEHALF).toBe(0);
    expect(ADMIN_CAPABILITIES & CAPABILITIES.CAN_AUTHOR_ON_BEHALF).toBe(0);
  });

  it("admin is a strict superset of member", () => {
    expect(ADMIN_CAPABILITIES & MEMBER_CAPABILITIES).toBe(MEMBER_CAPABILITIES);
  });
});
