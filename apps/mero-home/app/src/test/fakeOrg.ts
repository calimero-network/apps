import { vi } from "vitest";
import { NotFound, type AppInfo, type AppTeam, type CalimeroClient, type OrgInvite } from "@calimero-network/mero-js";

/**
 * A fake client over one organization, `acme`: Chat (closed, shared), Blocks
 * (closed) and a legacy CRM instance (organization access). Who the caller is
 * decides what core would answer: an admin sees every app team and person,
 * a member of Chat only Chat's people (core filters `getOrg`), a guest only
 * the app teams they are in.
 */
export const ORG = "acme";
export const CHAT = "com.calimero.chat";
export const BLOCKS = "com.calimero.mero-blocks";
export const CRM = "com.calimero.mero-crm";

export type As = "owner" | "admin" | "member" | "lead" | "guest";

export interface FakeOrgOptions {
  as?: As;
  /** The node has no app-team routes (before core#4890). */
  noRoute?: boolean;
  mode?: "shared" | "standalone" | "legacy";
  invites?: OrgInvite[];
  /** Chat's "members may invite" switch. */
  chatInvite?: boolean;
}

const ACCOUNT: Record<As, string> = {
  owner: "acct-ana",
  admin: "acct-ana",
  member: "acct-bob",
  lead: "acct-bob",
  guest: "acct-gus",
};

export function fakeOrg(opts: FakeOrgOptions = {}) {
  const as = opts.as ?? "owner";
  const me = ACCOUNT[as];
  const mode = opts.mode ?? "shared";
  const role = as === "lead" ? "member" : as;
  const admin = as === "owner" || as === "admin";

  const chat: AppTeam = {
    package: CHAT,
    teamId: "t-chat",
    name: "Chat",
    join: mode === "standalone" ? "everyone" : "invite",
    memberCount: 3,
    defaultCapabilities: opts.chatInvite || mode === "standalone" ? 2 : null,
    member: as !== "admin",
    manages: admin || as === "lead",
  };
  const blocks: AppTeam = {
    package: BLOCKS,
    teamId: "t-blocks",
    name: "Blocks",
    join: "invite",
    memberCount: 1,
    defaultCapabilities: null,
    member: as === "owner",
    manages: admin,
  };
  const visibleTeams =
    mode === "legacy" ? [] : as === "guest" ? [chat] : [chat, blocks];

  const everyone = { "acct-ana": "owner", "acct-bob": "member", "acct-cat": "member", "acct-gus": "guest" };
  // Core's directory filtering (decisions 2/3).
  const members: Record<string, string> = admin
    ? everyone
    : as === "guest"
      ? { "acct-gus": "guest", "acct-bob": "member" }
      : { "acct-ana": "owner", "acct-bob": "member", "acct-gus": "guest" };

  const apps: AppInfo[] = [
    { appId: "chat-1", name: "general", owner: "acct-ana", org: ORG, bundle: "b1", package: CHAT, version: "1.0.0" },
    { appId: "crm-1", name: "pipeline", owner: "acct-ana", org: ORG, bundle: "b3", package: CRM, version: "1.0.0" },
  ];
  let invites: OrgInvite[] = opts.invites ?? [];

  const client = {
    session: { accountId: me, sessionToken: "s", refreshToken: "r", expiresAt: 9e12 },
    me: vi.fn(async () => ({ accountId: me, orgs: [{ orgId: ORG, name: "Acme", role }] })),
    getOrg: vi.fn(async () => ({
      name: "Acme",
      mode,
      members,
      memberMetadata: { "acct-ana": { name: "Ana" }, "acct-bob": { name: "Bob" } },
      teams: {},
      releaseApprovers: [],
      publishes: [],
      newWorkStopped: null,
    })),
    listAppTeams: vi.fn(async () => {
      if (opts.noRoute) throw new NotFound("Not Found");
      return { mode, appTeams: visibleTeams };
    }),
    listApps: vi.fn(async () => (as === "guest" ? apps.filter((a) => a.package === CHAT) : apps)),
    getTeam: vi.fn(async (_org: string, team: string) => {
      if (team === "t-blocks" && !admin) throw new NotFound("no such team");
      const rows =
        team === "t-chat"
          ? [
              { account: "acct-ana", role: "lead" as const, capabilities: 0 },
              { account: "acct-bob", role: as === "lead" ? ("lead" as const) : ("member" as const), capabilities: 0 },
              { account: "acct-gus", role: "member" as const, capabilities: 0 },
            ]
          : [{ account: "acct-ana", role: "lead" as const, capabilities: 0 }];
      return { teamId: team, name: team, parent: null, join: "invite" as const, metadata: null, members: rows, children: [], apps: [] };
    }),
    listInvites: vi.fn(async () => invites),
    revokeInvite: vi.fn(async (_org: string, key: string) => {
      invites = invites.filter((i) => i.inviteKey !== key);
    }),
    invite: vi.fn(async () => "tok-new"),
    removeMember: vi.fn(async () => ({})),
    packages: vi.fn(async () => [
      { package: CHAT },
      { package: BLOCKS },
      { package: CRM },
      { package: "com.calimero.mero-sheets" },
      { package: "com.calimero.mero-home" },
    ]),
    scopeApps: vi.fn(async (_org: string, _p: unknown, o: { apps?: Array<{ package: string }> } = {}) => ({
      mode: "shared" as const,
      teams: (o.apps ?? []).map((a) => ({ package: a.package, teamId: `t-${a.package}`, created: true, apps: [], added: 0 })),
    })),
    setTeamDefaultCapabilities: vi.fn(async () => undefined),
  };
  return { client, asClient: client as unknown as CalimeroClient, me };
}

export const passkey = () => ({ create: vi.fn(), get: vi.fn() }) as never;
