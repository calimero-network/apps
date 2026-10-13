import { describe, expect, it, vi } from "vitest";
import { execute, type Executor } from "./execute";
import type { OrgBackend } from "../backend";

const ORG = "f".repeat(64); const DRIVE = "1".repeat(64); const ANA = "a".repeat(64);

function admin(): Executor {
  return {
    createGroupInNamespace: vi.fn(async () => ({ groupId: "sg1" })),
    setGroupMetadata: vi.fn(async () => {}),
    addGroupMembers: vi.fn(async () => {}),
    setMemberCapabilities: vi.fn(async () => {}),
    removeGroupMembers: vi.fn(async () => {}),
    createNamespaceInvitation: vi.fn(async () => ({ invitation: { invitation: { group_id: DRIVE }, inviter_signature: "sig" } })),
  } as unknown as Executor;
}
function backend(): OrgBackend {
  return { enrolments: vi.fn(async () => []), recordEnrolment: vi.fn(async () => {}) } as unknown as OrgBackend;
}

describe("execute", () => {
  it("creates a restricted subgroup and stamps the org group in its metadata", async () => {
    const a = admin(); const b = backend();
    const r = await execute([{ kind: "create-subgroup", app: DRIVE, orgGroupId: "g-eng", name: "Engineering" }], a, b, ORG);
    expect(r.applied).toBe(1);
    expect(a.createGroupInNamespace).toHaveBeenCalledWith(DRIVE, { groupName: "Engineering", visibility: "restricted" });
    expect(a.setGroupMetadata).toHaveBeenCalledWith("sg1", { name: "Engineering", data: { "org-group": "g-eng", org: ORG } });
  });

  it("mints an invitation and stores it on the enrolment", async () => {
    const a = admin(); const b = backend();
    await execute([{ kind: "mint-invitation", app: DRIVE, account: ANA }], a, b, ORG);
    const call = (b.recordEnrolment as ReturnType<typeof vi.fn>).mock.calls[0]![0];
    expect(call.state).toBe("invitation_pending");
    expect(JSON.parse(call.invitation).inviter_signature).toBe("sig");
    expect(call.invitationExpires).toBeGreaterThan(Date.now());
  });

  it("adds, sets capabilities, and records a failure without stopping", async () => {
    const a = admin(); const b = backend();
    (a.addGroupMembers as ReturnType<typeof vi.fn>).mockRejectedValueOnce(new Error("boom"));
    const r = await execute([
      { kind: "add-member", app: DRIVE, subgroupId: "sg1", orgGroupId: "g-eng", account: ANA, capabilities: 7 },
      { kind: "remove-member", app: DRIVE, subgroupId: "sg1", orgGroupId: "g-eng", account: "b".repeat(64) },
    ], a, b, ORG);
    expect(r.failed).toHaveLength(1);
    expect(r.applied).toBe(1);
    expect(b.recordEnrolment).toHaveBeenCalledWith(expect.objectContaining({ account: ANA, state: "failed", note: "boom" }));
    expect(a.removeGroupMembers).toHaveBeenCalledWith("sg1", { members: ["b".repeat(64)] });
  });
});
