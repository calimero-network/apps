import { describe, expect, it } from "vitest";

import {
  accountGrants,
  grantPeople,
  grantedAccounts,
  grantedTeam,
  grantedTeams,
  grantsAnyone,
  grantsOf,
  grantsOrg,
  type ReadGrant,
} from "./grants";
import { orgCluster } from "./testing";

describe("grantsOf", () => {
  it("reads every kind core answers, and a link as read-only", () => {
    const record = {
      grants: [
        { kind: "org" },
        { kind: "team", team: "t1" },
        { kind: "account", account: "acct-bob" },
        { kind: "account", account: "acct-gus", scope: { channel: "partners" } },
        { kind: "anyone" },
        { kind: "link", link: "l1", ratePerMinute: 60, createdBy: "acct-me", createdAt: 1 },
      ],
    };
    expect(grantsOf(record)).toEqual(record.grants);
  });

  it("[] for a record without grants (or the removed `access`), and skips malformed grants", () => {
    expect(grantsOf({ access: { kind: "org" } })).toEqual([]);
    expect(grantsOf(null)).toEqual([]);
    expect(grantsOf({ grants: [{ kind: "team" }, { kind: "account", account: "" }, { kind: "owner" }, null, { kind: "org" }] })).toEqual([
      { kind: "org" },
    ]);
  });
});

describe("reading grants", () => {
  const grants: ReadGrant[] = [
    { kind: "team", team: "t1" },
    { kind: "account", account: "acct-bob" },
    { kind: "account", account: "acct-gus", scope: { channel: "x" } },
  ];

  it("one kind each", () => {
    expect(grantedTeams(grants)).toEqual(["t1"]);
    expect(grantedTeam(grants)).toBe("t1");
    expect(grantedTeam([...grants, { kind: "team", team: "t2" }])).toBeNull();
    expect(grantedTeam([{ kind: "org" }])).toBeNull();
    expect(grantedAccounts(grants)).toEqual(["acct-bob", "acct-gus"]);
    expect(grantsOrg(grants)).toBe(false);
    expect(grantsOrg([{ kind: "org" }])).toBe(true);
    expect(grantsAnyone([{ kind: "anyone" }])).toBe(true);
    expect(grantsAnyone(grants)).toBe(false);
  });

  it("grantPeople: the owner, named accounts and the people of the org and teams; nobody for `anyone`", () => {
    const sources = { org: () => ["acct-a", "acct-b"], team: (t: string) => (t === "t1" ? ["acct-c"] : []) };
    expect(grantPeople("acct-me", [], sources)).toEqual(["acct-me"]);
    expect(grantPeople("acct-me", grants, sources)).toEqual(["acct-me", "acct-c", "acct-bob", "acct-gus"]);
    expect(grantPeople("acct-me", [{ kind: "org" }], sources)).toEqual(["acct-me", "acct-a", "acct-b"]);
    expect(grantPeople("acct-me", [{ kind: "anyone" }], sources)).toEqual(["acct-me"]);
  });

  it("accountGrants: one per account, deduplicated, with the scope when given", () => {
    expect(accountGrants(["a", "b", "a", ""])).toEqual([
      { kind: "account", account: "a" },
      { kind: "account", account: "b" },
    ]);
    expect(accountGrants(["a"], { channel: "c" })).toEqual([{ kind: "account", account: "a", scope: { channel: "c" } }]);
  });
});

describe("writing grants", () => {
  it("the test cluster refuses the removed `access` as core does, and keeps grants", async () => {
    const cluster = orgCluster();
    const org = cluster.addOrg();
    await expect(
      cluster.client.apps.create({ name: "x", bundle: "b", org, access: { kind: "org" } } as never),
    ).rejects.toMatchObject({ status: 400, code: "ACCESS_REMOVED" });
    const { appId } = await cluster.client.apps.create({ name: "x", bundle: "b", org });
    expect(cluster.state.apps.get(appId)!.grants).toEqual([{ kind: "org" }]);
    await cluster.client.apps.access({ app: appId, grants: accountGrants(["acct-bob"]) });
    expect(cluster.state.apps.get(appId)!.grants).toEqual([{ kind: "account", account: "acct-bob" }]);
    expect(grantsOf(await cluster.client.apps.get({ app: appId }))).toEqual([{ kind: "account", account: "acct-bob" }]);
  });
});
