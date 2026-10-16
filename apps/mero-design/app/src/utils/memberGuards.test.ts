import { describe, expect, it } from "vitest";
import { canRemoveMember, keepsAnAdmin } from "./memberGuards";

const ME = "a".repeat(64);
const BEN = "b".repeat(64);
const CY = "c".repeat(64);

describe("keepsAnAdmin", () => {
  it("lets a member go freely", () => {
    expect(keepsAnAdmin([{ identity: ME, role: "Admin" }, { identity: BEN, role: "Member" }], BEN)).toEqual({ ok: true });
  });
  it("lets an admin go while another admin remains", () => {
    expect(keepsAnAdmin([{ identity: ME, role: "Admin" }, { identity: BEN, role: "Admin" }], BEN).ok).toBe(true);
  });
  it("refuses to take the last admin away", () => {
    const r = keepsAnAdmin([{ identity: ME, role: "Admin" }, { identity: BEN, role: "Member" }], ME);
    expect(r.ok).toBe(false);
    expect(!r.ok && r.reason).toMatch(/last admin/);
  });
});

describe("canRemoveMember", () => {
  const team = [
    { identity: ME, role: "Admin" },
    { identity: BEN, role: "Member" },
    { identity: CY, role: "Admin" },
  ];

  it("lets an admin remove a member or another admin", () => {
    expect(canRemoveMember(team, ME, BEN).ok).toBe(true);
    expect(canRemoveMember(team, ME, CY).ok).toBe(true);
  });
  it("never removes yourself from here", () => {
    expect(canRemoveMember(team, ME, ME).ok).toBe(false);
  });
  it("is admin-only", () => {
    expect(canRemoveMember(team, BEN, CY).ok).toBe(false);
  });
  it("needs to know who you are", () => {
    expect(canRemoveMember(team, "", BEN).ok).toBe(false);
  });
});
