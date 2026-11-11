import { describe, expect, it } from "vitest";
import type { AppInfo } from "@calimero-network/mero-js";

import { appTeamsLabel, holdingsLabel, markOrgFor, myOrgs, orgsWithApp, otherOrgs, packageTitle } from "./orgs";

const CHAT = { package: "com.calimero.chat" } as const;

function app(appId: string, org: string | null, pkg: string, name = appId): AppInfo {
  return { appId, name, owner: "acct-me", org, bundle: `b-${pkg}`, package: pkg, version: "1.0.0" };
}

/**
 * The account of the bug: in `overworld`, which holds only a Mero Blocks
 * world, and in `team`, which holds a chat instance.
 */
function fakeClient(opts: { role?: string; account?: string | null } = {}) {
  const apps = [
    app("blocks-1", "overworld", "com.calimero.mero-blocks", "overworld"),
    app("chat-1", "team", "com.calimero.chat", "general"),
    app("solo", null, "com.calimero.chat", "notes"),
  ];
  const orgs: Record<string, Record<string, unknown>> = {
    overworld: { members: { "acct-me": opts.role ?? "owner" } },
    team: { members: { "acct-me": "owner" } },
    empty: { members: { "acct-me": "admin" } },
  };
  return {
    session: opts.account === null ? null : { accountId: opts.account ?? "acct-me" },
    auth: {
      me: async () => ({
        orgs: [
          { orgId: "team", name: "Team", role: "owner" },
          { orgId: "overworld", name: "overworld", role: opts.role ?? "owner" },
          { orgId: "empty", name: "Empty", role: "admin" },
        ],
      }),
    },
    apps: {
      list: async (filter: { package?: string; bundle?: string } = {}) => ({
        apps: apps.filter((a) => (!filter.package || a.package === filter.package) && (!filter.bundle || a.bundle === filter.bundle)),
      }),
    },
    orgs: {
      get: async ({ org }: { org: string }) => {
        const o = orgs[org];
        if (!o) throw new Error("404");
        return o;
      },
    } as Record<string, unknown>,
  };
}

/** {@link fakeClient} as the client the helpers take (it answers only what they read). */
function asClient(fake: unknown): never {
  return fake as never;
}

describe("orgsWithApp: only the organizations holding this app", () => {
  it("leaves out an organization that holds only another app", async () => {
    const orgs = await orgsWithApp(asClient(fakeClient()), CHAT);
    expect(orgs.map((o) => o.orgId)).toEqual(["team"]);
  });

  it("filters by the bundle in development", async () => {
    expect((await orgsWithApp(asClient(fakeClient()), "b-com.calimero.mero-blocks")).map((o) => o.orgId)).toEqual(["overworld"]);
  });

  it("is empty for an app no organization of the account holds", async () => {
    expect(await orgsWithApp(asClient(fakeClient()), { package: "com.calimero.mero-sheets" })).toEqual([]);
  });
});

describe("otherOrgs: the explicit connect choice", () => {
  it("lists the other organizations with what they hold", async () => {
    const others = await otherOrgs(asClient(fakeClient()), CHAT);
    expect(others.map((o) => [o.orgId, o.label, o.canCreate])).toEqual([
      ["empty", "No apps yet", true],
      ["overworld", "Mero Blocks: overworld", true],
    ]);
  });

  it("leaves out an organization where the account may not create apps, unless asked", async () => {
    const client = asClient(fakeClient({ role: "guest" }));
    expect((await otherOrgs(client, CHAT)).map((o) => o.orgId)).toEqual(["empty"]);
    const all = await otherOrgs(client, CHAT, { includeNotAllowed: true });
    expect(all.find((o) => o.orgId === "overworld")?.canCreate).toBe(false);
  });

  it("keeps an organization whose rights cannot be told (the node decides)", async () => {
    const others = await otherOrgs(asClient(fakeClient({ account: null })), CHAT);
    expect(others.map((o) => [o.orgId, o.canCreate])).toEqual([
      ["empty", null],
      ["overworld", null],
    ]);
  });
});

describe("otherOrgs: labels from app teams (core#4890)", () => {
  function withTeams(appTeamList: (org: string) => Promise<unknown>) {
    const c = fakeClient();
    return asClient({ ...c, orgs: { ...c.orgs, appTeamList: ({ org }: { org: string }) => appTeamList(org) } });
  }

  it("names an org's apps from its app teams, so closed apps are not 'No apps yet'", async () => {
    const client = withTeams(async (org) => {
      if (org === "empty") {
        return {
          mode: "shared",
          appTeams: [
            { package: "com.calimero.mero-crm", teamId: "t1", name: "CRM", join: "invite", memberCount: 4, defaultCapabilities: null, member: false, manages: false },
            { package: "com.calimero.mero-blocks", teamId: "t2", name: "Blocks", join: "invite", memberCount: 2, defaultCapabilities: null, member: true, manages: false },
          ],
        };
      }
      return { mode: "legacy", appTeams: [] };
    });
    const others = await otherOrgs(client, CHAT);
    expect(others.map((o) => [o.orgId, o.label, o.mode])).toEqual([
      ["empty", "Blocks, CRM (not yours)", "shared"],
      // A legacy org (no app teams) keeps the instance label.
      ["overworld", "Mero Blocks: overworld", "legacy"],
    ]);
    expect(others[0]?.apps).toHaveLength(2);
  });

  it("only an owner or admin may add this app to an org that has app teams (core#4890)", async () => {
    const shared = { mode: "shared", appTeams: [{ package: "com.calimero.mero-blocks", teamId: "t", name: "Blocks", join: "invite", memberCount: 1, defaultCapabilities: null, member: true, manages: false }] };
    // A member granted CREATE_APP org-wide: enough in a legacy org, not once it has app teams.
    const client = asClient({
      ...fakeClient({ role: "member" }),
      orgs: {
        get: async () => ({ members: { "acct-me": "member" }, capabilities: { "acct-me": 1 } }),
        appTeamList: async () => shared,
      },
    });
    const all = await otherOrgs(client, CHAT, { includeNotAllowed: true });
    expect(all.find((o) => o.orgId === "overworld")?.canCreate).toBe(false);
    // The admin of `empty` still may.
    expect(all.find((o) => o.orgId === "empty")?.canCreate).toBe(true);
  });

  it("falls back to today's label on a node without the route (404)", async () => {
    const client = withTeams(async () => {
      throw Object.assign(new Error("Not Found"), { status: 404 });
    });
    const others = await otherOrgs(client, CHAT);
    expect(others.map((o) => [o.orgId, o.label, o.apps, o.mode])).toEqual([
      ["empty", "No apps yet", null, null],
      ["overworld", "Mero Blocks: overworld", null, null],
    ]);
  });

  it("appTeamsLabel is null with no teams, and uses the package title for a nameless team", () => {
    expect(appTeamsLabel([])).toBeNull();
    expect(
      appTeamsLabel([
        { package: "com.calimero.mero-sheets", teamId: "t", name: "", join: "everyone", memberCount: 1, defaultCapabilities: 2, member: true, manages: true },
      ]),
    ).toBe("Mero Sheets");
  });
});

describe("labels", () => {
  it("names a package in words", () => {
    expect(packageTitle("com.calimero.mero-blocks")).toBe("Mero Blocks");
    expect(packageTitle("com.calimero.chat")).toBe("Mero Chat");
    expect(packageTitle("com.calimero.kv-store")).toBe("KV Store");
  });

  it("joins several holdings, and falls back to the instance name", () => {
    expect(
      holdingsLabel([
        { appId: "a", name: "overworld", package: "com.calimero.mero-blocks" },
        { appId: "b", name: "dev", package: null },
      ]),
    ).toBe("Mero Blocks: overworld, dev");
  });

  it("myOrgs sorts by name and drops malformed rows", async () => {
    const client = { auth: { me: async () => ({ orgs: [{ orgId: "b", name: "B" }, { name: "x" }, { orgId: "a", name: "A", role: "owner" }] }) } };
    expect(await myOrgs(client as never)).toEqual([
      { orgId: "a", name: "A", role: "owner" },
      { orgId: "b", name: "B", role: "member" },
    ]);
  });
});

describe("organizations made for an app before it holds an instance", () => {
  function client() {
    const metadata: Record<string, unknown> = { empty: { theme: "dark" } };
    const base = fakeClient();
    return {
      ...base,
      orgs: {
        get: async ({ org }: { org: string }) => ({
          ...(await (base.orgs.get as (a: { org: string }) => Promise<Record<string, unknown>>)({ org })),
          metadata: metadata[org] ?? null,
        }),
        metadata: async ({ org, metadata: m }: { org: string; metadata: unknown }) => {
          metadata[org] = m;
          return {};
        },
      },
      metadata,
    };
  }

  it("markOrgFor merges the mark into the metadata, and the org is listed with `marked`", async () => {
    const c = client();
    expect(await markOrgFor(c as never, "empty", CHAT)).toBe(true);
    expect(c.metadata.empty).toEqual({ theme: "dark", createdFor: "com.calimero.chat" });
    expect((await orgsWithApp(c as never, CHAT)).map((o) => o.orgId)).toEqual(["team"]);
    expect((await orgsWithApp(c as never, CHAT, { marked: true })).map((o) => o.orgId)).toEqual(["empty", "team"]);
    expect((await otherOrgs(c as never, CHAT)).map((o) => o.orgId)).toEqual(["overworld"]);
  });

  it("a mark for another app does not list it", async () => {
    const c = client();
    await markOrgFor(c as never, "empty", { package: "com.calimero.mero-forum" });
    expect((await orgsWithApp(c as never, CHAT, { marked: true })).map((o) => o.orgId)).toEqual(["team"]);
  });
});
