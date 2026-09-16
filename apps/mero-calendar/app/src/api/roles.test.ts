import { describe, expect, it } from "vitest";

import {
  ADMIN_CAPABILITIES,
  CAN_CREATE_CONTEXT,
  CAN_INVITE_MEMBERS,
  CAN_JOIN_OPEN_SUBGROUPS,
  CAN_MANAGE_METADATA,
  MANAGE_MEMBERS,
  capabilitiesFor,
  roleLabel,
  roleOf,
} from "./roles";

describe("capability bits", () => {
  it("match core's MemberCapabilities", () => {
    // From crates/context/config/src/lib.rs. Pinned because these are a wire
    // format: core only ever ADDS bits (rejecting an unknown one would make
    // older peers fail to decode the op and diverge), so a value changing here
    // means this file drifted, not that core moved.
    expect(CAN_CREATE_CONTEXT).toBe(1);
    expect(CAN_INVITE_MEMBERS).toBe(2);
    expect(CAN_JOIN_OPEN_SUBGROUPS).toBe(4);
    expect(MANAGE_MEMBERS).toBe(8);
    expect(CAN_MANAGE_METADATA).toBe(256);
  });

  it("includes the metadata bit in Admin", () => {
    // Load-bearing: an admin who can create a calendar but cannot name it makes
    // calendars that show as raw context ids on every other member's node.
    expect(ADMIN_CAPABILITIES & CAN_MANAGE_METADATA).toBe(CAN_MANAGE_METADATA);
    expect(ADMIN_CAPABILITIES & CAN_CREATE_CONTEXT).toBe(CAN_CREATE_CONTEXT);
  });
});

describe("roleOf", () => {
  it("reads no capabilities as a member", () => {
    expect(roleOf(0)).toBe("member");
  });

  it("reads the full admin set as an admin", () => {
    expect(roleOf(ADMIN_CAPABILITIES)).toBe("admin");
  });

  it("reads a PARTIAL admin set as a member", () => {
    // Someone holding create-context but not manage-members is not an admin.
    // Reporting them as one would promise powers the node will refuse.
    expect(roleOf(CAN_CREATE_CONTEXT)).toBe("member");
    expect(roleOf(ADMIN_CAPABILITIES & ~MANAGE_MEMBERS)).toBe("member");
  });

  it("ignores bits it does not know about", () => {
    const future = 1 << 20;
    expect(roleOf(ADMIN_CAPABILITIES | future)).toBe("admin");
    expect(roleOf(future)).toBe("member");
  });
});

describe("capabilitiesFor", () => {
  it("promotes a bare member to the full admin set", () => {
    expect(capabilitiesFor("admin", 0)).toBe(ADMIN_CAPABILITIES);
  });

  it("demotes an admin back to nothing it should not keep", () => {
    expect(capabilitiesFor("member", ADMIN_CAPABILITIES)).toBe(0);
  });

  it("PRESERVES bits the role does not speak for", () => {
    // ⚠️ The invariant that stops this client from silently revoking
    // capabilities shipped after it was written. Core keeps adding bits; a
    // client that writes a whole mask from scratch would clear every one it has
    // never heard of, with no error anywhere.
    const future = 1 << 20;
    expect(capabilitiesFor("admin", future)).toBe(ADMIN_CAPABILITIES | future);
    expect(capabilitiesFor("member", ADMIN_CAPABILITIES | future)).toBe(future);
  });

  it("does not cost a demoted member their reach into open subgroups", () => {
    // CAN_JOIN_OPEN_SUBGROUPS is granted to ordinary members by default and
    // used as a deny-list. Clearing it on demotion would cut somebody out of
    // subgroups they already reach — a side effect nobody asked for.
    const admin = ADMIN_CAPABILITIES | CAN_JOIN_OPEN_SUBGROUPS;
    expect(capabilitiesFor("member", admin) & CAN_JOIN_OPEN_SUBGROUPS).toBe(
      CAN_JOIN_OPEN_SUBGROUPS,
    );
  });

  it("round-trips", () => {
    const start = CAN_JOIN_OPEN_SUBGROUPS;
    const promoted = capabilitiesFor("admin", start);
    expect(roleOf(promoted)).toBe("admin");
    const demoted = capabilitiesFor("member", promoted);
    expect(roleOf(demoted)).toBe("member");
    expect(demoted).toBe(start);
  });
});

describe("roleLabel", () => {
  it("names both roles", () => {
    expect(roleLabel("admin")).toBe("Admin");
    expect(roleLabel("member")).toBe("Member");
  });
});
