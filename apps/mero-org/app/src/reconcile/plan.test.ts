import { describe, expect, it } from "vitest";
import { plan } from "./plan";
import type { ObservedApp, PlanInput } from "./types";

const ORG = "f".repeat(64);
const DRIVE = "1".repeat(64);
const ANA = "a".repeat(64);
const ADMIN = "0".repeat(64);
const ENG = "g-eng";
const OTHER_ORG = "e".repeat(64);
const APPLICATION = "2".repeat(64);
const PEER = "/ip4/10.0.0.1/udp/2528/quic-v1/p2p/12D3KooWAdmin";
const caps = (members: string[], c = 7) => new Map(members.map((m) => [m, c]));

function base(observed: ObservedApp[], extra: Partial<PlanInput> = {}): PlanInput {
  return {
    orgNamespaceId: ORG, now: 1_000,
    placements: [{ account: ANA, app: DRIVE, group: ENG, capabilities: 7 }],
    enrolments: [], leftAccounts: [], orgRootMembers: new Set([ADMIN, ANA]), orgAdmins: [ADMIN], peerAddrs: [PEER],
    groups: [{ id: ENG, name: "Engineering", parent: "", admins: [], member_count: 1, created_at: 0 }],
    apps: [{ id: DRIVE, package: "p", label: "Drive", admin_account: ADMIN, status: "ready", registered_at: 0, group_count: 1, application_id: APPLICATION, peer_addrs: [PEER] }],
    observed, ...extra,
  };
}

describe("plan", () => {
  it("creates the missing subgroup first and does nothing else for that group", () => {
    const ops = plan(base([{ appId: DRIVE, rootMembers: new Set([ADMIN, ANA]), subgroups: [] }]));
    expect(ops).toEqual([
      { kind: "create-subgroup", app: DRIVE, orgGroupId: ENG, name: "Engineering" },
      { kind: "record", account: ANA, app: DRIVE, state: "added", subgroups: [], note: "" },
    ]);
  });

  it("adds a member outside the namespace at its root, then places them in the same pass", () => {
    const ops = plan(base([{ appId: DRIVE, rootMembers: new Set([ADMIN]), subgroups: [{ groupId: "sg1", name: "Engineering", orgGroupId: ENG, org: ORG, members: new Set([ADMIN]), capabilities: caps([ADMIN]) }] }]));
    expect(ops).toEqual([
      { kind: "add-root-member", app: DRIVE, account: ANA },
      { kind: "add-member", app: DRIVE, subgroupId: "sg1", orgGroupId: ENG, account: ANA, capabilities: 7 },
      { kind: "record", account: ANA, app: DRIVE, state: "added", subgroups: [], note: "" },
    ]);
  });

  it("keeps the app's follow addresses current, and leaves them be when they could not be read", () => {
    const placed = [{ appId: DRIVE, rootMembers: new Set([ADMIN, ANA]), subgroups: [{ groupId: "sg1", name: "Engineering", orgGroupId: ENG, org: ORG, members: new Set([ADMIN, ANA]), capabilities: caps([ADMIN, ANA]) }] }];
    const enrolments = [{ account: ANA, app: DRIVE, state: "placed", subgroups: ["sg1"], note: "", updated_at: 0 }];
    const moved = "/ip4/10.0.0.2/udp/2528/quic-v1/p2p/12D3KooWAdmin";
    expect(plan(base(placed, { enrolments, peerAddrs: [moved] }))).toEqual([{ kind: "set-app-peers", app: DRIVE, peerAddrs: [moved] }]);
    expect(plan(base(placed, { enrolments, peerAddrs: null }))).toEqual([]);
    expect(plan(base(placed, { enrolments }))).toEqual([]);
  });

  it("adds a root member to the subgroup (reusing it by metadata, not name) and records added until observed", () => {
    const ops = plan(base([{ appId: DRIVE, rootMembers: new Set([ADMIN, ANA]), subgroups: [{ groupId: "sg1", name: "Eng (renamed)", orgGroupId: ENG, org: ORG, members: new Set([ADMIN]), capabilities: caps([ADMIN]) }] }]));
    expect(ops).toEqual([
      { kind: "add-member", app: DRIVE, subgroupId: "sg1", orgGroupId: ENG, account: ANA, capabilities: 7 },
      { kind: "record", account: ANA, app: DRIVE, state: "added", subgroups: [], note: "" },
    ]);
  });

  it("records placed on the next round, once the add is observed", () => {
    const ops = plan(base([{ appId: DRIVE, rootMembers: new Set([ADMIN, ANA]), subgroups: [{ groupId: "sg1", name: "Engineering", orgGroupId: ENG, org: ORG, members: new Set([ADMIN, ANA]), capabilities: caps([ADMIN, ANA]) }] }], {
      enrolments: [{ account: ANA, app: DRIVE, state: "added", subgroups: [], note: "", updated_at: 0 }],
    }));
    expect(ops).toEqual([{ kind: "record", account: ANA, app: DRIVE, state: "placed", subgroups: ["sg1"], note: "" }]);
  });

  it("removes a member who left the org from the app namespace root", () => {
    const ops = plan(base([{ appId: DRIVE, rootMembers: new Set([ADMIN, ANA]), subgroups: [{ groupId: "sg1", name: "Engineering", orgGroupId: ENG, org: ORG, members: new Set([ADMIN]), capabilities: caps([ADMIN]) }] }], {
      placements: [], leftAccounts: [ANA],
    }));
    expect(ops).toEqual([
      { kind: "remove-member", app: DRIVE, subgroupId: DRIVE, orgGroupId: "", account: ANA },
      { kind: "remove-member", app: ORG, subgroupId: ORG, orgGroupId: "", account: ANA },
    ]);
  });

  it("is idempotent once placed", () => {
    const input = base([{ appId: DRIVE, rootMembers: new Set([ADMIN, ANA]), subgroups: [{ groupId: "sg1", name: "Engineering", orgGroupId: ENG, org: ORG, members: new Set([ADMIN, ANA]), capabilities: caps([ADMIN, ANA]) }] }], {
      enrolments: [{ account: ANA, app: DRIVE, state: "placed", subgroups: ["sg1"], note: "", updated_at: 0 }],
    });
    expect(plan(input)).toEqual([]);
    expect(plan(input)).toEqual([]);
  });

  it("removes a member whose placement is gone, never an org admin, and records removed", () => {
    const ops = plan(base([{ appId: DRIVE, rootMembers: new Set([ADMIN, ANA]), subgroups: [{ groupId: "sg1", name: "Engineering", orgGroupId: ENG, org: ORG, members: new Set([ADMIN, ANA]), capabilities: caps([ADMIN, ANA]) }] }], {
      placements: [],
      enrolments: [{ account: ANA, app: DRIVE, state: "placed", subgroups: ["sg1"], note: "", updated_at: 0 }],
    }));
    expect(ops).toEqual([
      { kind: "remove-member", app: DRIVE, subgroupId: "sg1", orgGroupId: ENG, account: ANA },
      { kind: "record", account: ANA, app: DRIVE, state: "removed", subgroups: [], note: "" },
    ]);
  });

  it("ignores apps that were not observed and apps pending admin", () => {
    const ops = plan(base([], { apps: [{ id: DRIVE, package: "p", label: "Drive", admin_account: ADMIN, status: "pending_admin", registered_at: 0, group_count: 1, application_id: APPLICATION, peer_addrs: [PEER] }] }));
    expect(ops).toEqual([]);
  });

  it("removes a member who left the org from the org namespace root, never an org admin", () => {
    const ops = plan(base([], { placements: [], leftAccounts: [ANA, ADMIN] }));
    expect(ops).toEqual([{ kind: "remove-member", app: ORG, subgroupId: ORG, orgGroupId: "", account: ANA }]);
    expect(plan(base([], { placements: [], leftAccounts: [ANA], orgRootMembers: new Set([ADMIN]) }))).toEqual([]);
  });

  it("re-caps a placed member whose access row was downgraded from 7 to 4, and keeps them placed", () => {
    const ops = plan(base([{ appId: DRIVE, rootMembers: new Set([ADMIN, ANA]), subgroups: [{ groupId: "sg1", name: "Engineering", orgGroupId: ENG, org: ORG, members: new Set([ADMIN, ANA]), capabilities: new Map([[ADMIN, 1], [ANA, 7]]) }] }], {
      placements: [{ account: ANA, app: DRIVE, group: ENG, capabilities: 4 }],
      enrolments: [{ account: ANA, app: DRIVE, state: "placed", subgroups: ["sg1"], note: "", updated_at: 0 }],
    }));
    expect(ops).toEqual([{ kind: "set-capabilities", app: DRIVE, subgroupId: "sg1", orgGroupId: ENG, account: ANA, capabilities: 4 }]);
  });

  it("a failed row is left alone while the retry op is still emitted", () => {
    const ops = plan(base([{ appId: DRIVE, rootMembers: new Set([ADMIN, ANA]), subgroups: [{ groupId: "sg1", name: "Engineering", orgGroupId: ENG, org: ORG, members: new Set([ADMIN]), capabilities: caps([ADMIN]) }] }], {
      enrolments: [{ account: ANA, app: DRIVE, state: "failed", subgroups: [], note: "boom", updated_at: 0 }],
    }));
    expect(ops).toEqual([{ kind: "add-member", app: DRIVE, subgroupId: "sg1", orgGroupId: ENG, account: ANA, capabilities: 7 }]);
  });

  it("clears a failed row once nothing is left to retry", () => {
    const ops = plan(base([{ appId: DRIVE, rootMembers: new Set([ADMIN, ANA]), subgroups: [{ groupId: "sg1", name: "Engineering", orgGroupId: ENG, org: ORG, members: new Set([ADMIN, ANA]), capabilities: caps([ADMIN, ANA]) }] }], {
      enrolments: [{ account: ANA, app: DRIVE, state: "failed", subgroups: [], note: "boom", updated_at: 0 }],
    }));
    expect(ops).toEqual([{ kind: "record", account: ANA, app: DRIVE, state: "placed", subgroups: ["sg1"], note: "" }]);
  });

  it("neither reuses nor empties another org's subgroup with the same org-group id", () => {
    const foreign = { groupId: "sgX", name: "Engineering", orgGroupId: ENG, org: OTHER_ORG, members: new Set([ADMIN, "b".repeat(64)]), capabilities: new Map<string, number>() };
    const ops = plan(base([{ appId: DRIVE, rootMembers: new Set([ADMIN, ANA]), subgroups: [foreign] }]));
    expect(ops).toEqual([
      { kind: "create-subgroup", app: DRIVE, orgGroupId: ENG, name: "Engineering" },
      { kind: "record", account: ANA, app: DRIVE, state: "added", subgroups: [], note: "" },
    ]);
  });
});
