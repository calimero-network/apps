import { describe, expect, it } from "vitest";
import { plan } from "./plan";
import type { ObservedApp, PlanInput } from "./types";

const ORG = "f".repeat(64);
const DRIVE = "1".repeat(64);
const ANA = "a".repeat(64);
const ADMIN = "0".repeat(64);
const ENG = "g-eng";

function base(observed: ObservedApp[], extra: Partial<PlanInput> = {}): PlanInput {
  return {
    orgNamespaceId: ORG, now: 1_000,
    placements: [{ account: ANA, app: DRIVE, group: ENG, capabilities: 7 }],
    enrolments: [], leftAccounts: [],
    groups: [{ id: ENG, name: "Engineering", parent: "", admins: [], member_count: 1, created_at: 0 }],
    apps: [{ id: DRIVE, package: "p", label: "Drive", admin_account: ADMIN, status: "ready", registered_at: 0, group_count: 1 }],
    observed, ...extra,
  };
}

describe("plan", () => {
  it("creates the missing subgroup first and does nothing else for that group", () => {
    const ops = plan(base([{ appId: DRIVE, rootMembers: new Set([ADMIN, ANA]), subgroups: [] }]));
    expect(ops).toEqual([
      { kind: "create-subgroup", app: DRIVE, orgGroupId: ENG, name: "Engineering" },
      { kind: "record", account: ANA, app: DRIVE, state: "joined", subgroups: [], note: "" },
    ]);
  });

  it("mints an invitation for a member outside the namespace, once", () => {
    const ops = plan(base([{ appId: DRIVE, rootMembers: new Set([ADMIN]), subgroups: [{ groupId: "sg1", name: "Engineering", orgGroupId: ENG, members: new Set([ADMIN]) }] }], {
      placements: [{ account: ANA, app: DRIVE, group: ENG, capabilities: 7 }, { account: ANA, app: DRIVE, group: "g2", capabilities: 7 }],
      groups: [{ id: ENG, name: "Engineering", parent: "", admins: [], member_count: 1, created_at: 0 }, { id: "g2", name: "Two", parent: "", admins: [], member_count: 1, created_at: 0 }],
    }));
    expect(ops.filter((o) => o.kind === "mint-invitation")).toHaveLength(1);
    expect(ops.at(-1)).toEqual({ kind: "record", account: ANA, app: DRIVE, state: "invitation_pending", subgroups: [], note: "" });
  });

  it("does not re-mint while a pending invitation is live", () => {
    const ops = plan(base([{ appId: DRIVE, rootMembers: new Set([ADMIN]), subgroups: [{ groupId: "sg1", name: "Engineering", orgGroupId: ENG, members: new Set([ADMIN]) }] }], {
      enrolments: [{ account: ANA, app: DRIVE, state: "invitation_pending", invitation: "{}", invitation_expires: 5_000, subgroups: [], note: "", updated_at: 0 }],
    }));
    expect(ops).toEqual([]);
  });

  it("adds a joined member to the subgroup (reusing it by metadata, not name) and records joined until observed", () => {
    const ops = plan(base([{ appId: DRIVE, rootMembers: new Set([ADMIN, ANA]), subgroups: [{ groupId: "sg1", name: "Eng (renamed)", orgGroupId: ENG, members: new Set([ADMIN]) }] }]));
    expect(ops).toEqual([
      { kind: "add-member", app: DRIVE, subgroupId: "sg1", orgGroupId: ENG, account: ANA, capabilities: 7 },
      { kind: "record", account: ANA, app: DRIVE, state: "joined", subgroups: [], note: "" },
    ]);
  });

  it("records placed on the next round, once the add is observed", () => {
    const ops = plan(base([{ appId: DRIVE, rootMembers: new Set([ADMIN, ANA]), subgroups: [{ groupId: "sg1", name: "Engineering", orgGroupId: ENG, members: new Set([ADMIN, ANA]) }] }], {
      enrolments: [{ account: ANA, app: DRIVE, state: "joined", invitation: "", invitation_expires: 0, subgroups: [], note: "", updated_at: 0 }],
    }));
    expect(ops).toEqual([{ kind: "record", account: ANA, app: DRIVE, state: "placed", subgroups: ["sg1"], note: "" }]);
  });

  it("removes a member who left the org from the app namespace root", () => {
    const ops = plan(base([{ appId: DRIVE, rootMembers: new Set([ADMIN, ANA]), subgroups: [{ groupId: "sg1", name: "Engineering", orgGroupId: ENG, members: new Set([ADMIN]) }] }], {
      placements: [], leftAccounts: [ANA],
    }));
    expect(ops).toEqual([{ kind: "remove-member", app: DRIVE, subgroupId: DRIVE, orgGroupId: "", account: ANA }]);
  });

  it("is idempotent once placed", () => {
    const input = base([{ appId: DRIVE, rootMembers: new Set([ADMIN, ANA]), subgroups: [{ groupId: "sg1", name: "Engineering", orgGroupId: ENG, members: new Set([ADMIN, ANA]) }] }], {
      enrolments: [{ account: ANA, app: DRIVE, state: "placed", invitation: "", invitation_expires: 0, subgroups: ["sg1"], note: "", updated_at: 0 }],
    });
    expect(plan(input)).toEqual([]);
    expect(plan(input)).toEqual([]);
  });

  it("removes a member whose placement is gone, never an org admin, and records removed", () => {
    const ops = plan(base([{ appId: DRIVE, rootMembers: new Set([ADMIN, ANA]), subgroups: [{ groupId: "sg1", name: "Engineering", orgGroupId: ENG, members: new Set([ADMIN, ANA]) }] }], {
      placements: [],
      enrolments: [{ account: ANA, app: DRIVE, state: "placed", invitation: "", invitation_expires: 0, subgroups: ["sg1"], note: "", updated_at: 0 }],
    }));
    expect(ops).toEqual([
      { kind: "remove-member", app: DRIVE, subgroupId: "sg1", orgGroupId: ENG, account: ANA },
      { kind: "record", account: ANA, app: DRIVE, state: "removed", subgroups: [], note: "" },
    ]);
  });

  it("ignores apps that were not observed and apps pending admin", () => {
    const ops = plan(base([], { apps: [{ id: DRIVE, package: "p", label: "Drive", admin_account: ADMIN, status: "pending_admin", registered_at: 0, group_count: 1 }] }));
    expect(ops).toEqual([]);
  });
});
