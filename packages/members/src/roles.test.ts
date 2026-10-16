import { describe, expect, it } from "vitest";

import {
  LAST_ADMIN_REASON,
  canChangeRole,
  canRemoveMember,
  countAdmins,
  memberRoleOf,
  roleLabel,
} from "./roles";
import { parseMembers } from "./useWorkspaceMembers";

describe("canChangeRole", () => {
  const base = { canManage: true, isSelf: false, adminCount: 2 } as const;

  it("lets an admin promote a member and demote another admin", () => {
    expect(canChangeRole({ ...base, currentRole: "Member", nextRole: "Admin" }).allowed).toBe(true);
    expect(canChangeRole({ ...base, currentRole: "Admin", nextRole: "Member" }).allowed).toBe(true);
  });

  it("refuses someone who cannot manage members", () => {
    const v = canChangeRole({ ...base, canManage: false, currentRole: "Member", nextRole: "Admin" });
    expect(v.allowed).toBe(false);
    expect(v.reason).toMatch(/only an admin/i);
  });

  it("never demotes the last admin, including yourself", () => {
    for (const isSelf of [true, false]) {
      const v = canChangeRole({ ...base, isSelf, adminCount: 1, currentRole: "Admin", nextRole: "Member" });
      expect(v).toEqual({ allowed: false, reason: LAST_ADMIN_REASON });
    }
  });

  it("lets you step down while another admin remains", () => {
    expect(
      canChangeRole({ ...base, isSelf: true, currentRole: "Admin", nextRole: "Member" }).allowed,
    ).toBe(true);
  });

  it("offers nothing for the role a member already has, or for a TEE node", () => {
    expect(canChangeRole({ ...base, currentRole: "admin", nextRole: "Admin" }).allowed).toBe(false);
    expect(canChangeRole({ ...base, currentRole: "RelayTee", nextRole: "Admin" }).allowed).toBe(false);
  });
});

describe("canRemoveMember", () => {
  const base = { canManage: true, isSelf: false, adminCount: 2 } as const;

  it("lets an admin remove a member or another admin", () => {
    expect(canRemoveMember({ ...base, role: "Member" }).allowed).toBe(true);
    expect(canRemoveMember({ ...base, role: "Admin" }).allowed).toBe(true);
  });

  it("never removes yourself, the last admin, or a TEE node", () => {
    expect(canRemoveMember({ ...base, isSelf: true, role: "Member" }).allowed).toBe(false);
    expect(canRemoveMember({ ...base, adminCount: 1, role: "Admin" }).reason).toBe(LAST_ADMIN_REASON);
    expect(canRemoveMember({ ...base, role: "ReadOnlyTee" }).allowed).toBe(false);
  });

  it("refuses someone who cannot manage members", () => {
    expect(canRemoveMember({ ...base, canManage: false, role: "Member" }).allowed).toBe(false);
  });
});

describe("role helpers", () => {
  it("counts admins case-insensitively", () => {
    expect(countAdmins([{ role: "Admin" }, { role: "admin" }, { role: "Member" }, {}])).toBe(2);
  });

  it("reads only Admin and Member as choosable roles", () => {
    expect(memberRoleOf("ADMIN")).toBe("Admin");
    expect(memberRoleOf("Member")).toBe("Member");
    expect(memberRoleOf("ReadOnly")).toBeNull();
    expect(roleLabel("ReadOnly")).toBe("Read-only");
  });
});

describe("parseMembers", () => {
  it("reads the {members} envelope, a bare array, and the legacy alias", () => {
    const a = "a".repeat(64);
    expect(parseMembers({ members: [{ identity: a, role: "Admin", name: " Ana " }] })).toEqual([
      { identity: a, role: "Admin", name: "Ana" },
    ]);
    expect(parseMembers([{ identity: a, alias: "Ana" }])).toEqual([{ identity: a, role: "Member", name: "Ana" }]);
    expect(parseMembers({ nope: true })).toEqual([]);
    expect(parseMembers([{ role: "Admin" }])).toEqual([]);
  });
});
