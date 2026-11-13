import { beforeEach, describe, expect, it, vi } from "vitest";

const h = vi.hoisted(() => ({
  app: undefined as string | undefined,
  chatOnly: false,
  chatTeam: false,
  openConsentPage: vi.fn(),
  platform: {
    chatOnlyIn: vi.fn(),
    hasChatTeam: vi.fn(),
    removeFromChatTeam: vi.fn(async () => {}),
    deleteOrg: vi.fn(async () => {}),
    leaveChat: vi.fn(async () => ({ left: "org" as const, lastApp: false })),
    leaveChatOrg: vi.fn(async () => {}),
    removeFromChat: vi.fn(async () => "org" as const),
    renameOrg: vi.fn(async () => {}),
    setMemberRole: vi.fn(async () => {}),
  },
}));

vi.mock("./platform", () => ({
  ...h.platform,
  run: (fn: (c: unknown) => Promise<unknown>) =>
    fn({
      auth: { me: async () => ({ accountId: "acct-me", ...(h.app ? { app: h.app } : {}) }) },
      openConsentPage: h.openConsentPage,
    }),
}));
vi.mock("../utils/servedByNode", () => ({ nodeBasename: () => "/" }));
vi.mock("./calimero", () => ({ getAccountId: () => "acct-me" }));

type Actions = typeof import("./orgActions");

// `frontendBound` is asked once per load: a fresh module per case.
async function load(): Promise<Actions> {
  vi.resetModules();
  return import("./orgActions");
}

beforeEach(() => {
  vi.clearAllMocks();
  sessionStorage.clear();
  h.app = undefined;
  h.chatOnly = false;
  h.chatTeam = false;
  h.platform.chatOnlyIn.mockImplementation(async () => h.chatOnly);
  h.platform.hasChatTeam.mockImplementation(async () => h.chatTeam);
  h.openConsentPage.mockImplementation(async (_req, opts: { confirm: (s: { code: string }) => boolean }) => {
    opts.confirm({ code: "ABC-DEF" });
    return { requestId: "r1" };
  });
  vi.spyOn(window, "confirm").mockReturnValue(true);
});

/** Each action, the consent request it makes on Chat's frontend, and the route it calls otherwise. */
const cases: Array<{
  name: string;
  act: (a: Actions) => Promise<unknown>;
  request: Record<string, unknown>;
  direct: () => ReturnType<typeof vi.fn>;
  args: unknown[];
}> = [
  {
    name: "organization admin",
    act: (a) => a.setOrgRole("o", "acct-bob", "admin"),
    request: { kind: "setMemberRole", subject: { org: "o", account: "acct-bob", role: "admin" } },
    direct: () => h.platform.setMemberRole,
    args: ["o", "acct-bob", "admin"],
  },
  {
    name: "remove from the organization",
    act: (a) => a.removeFromWorkspace("o", "acct-bob"),
    request: { kind: "removeMember", subject: { org: "o", account: "acct-bob" } },
    direct: () => h.platform.removeFromChat,
    args: ["o", "acct-bob"],
  },
  {
    name: "leave the workspace",
    act: (a) => a.leaveWorkspace("o"),
    request: { kind: "leaveOrg", subject: { org: "o" } },
    direct: () => h.platform.leaveChat,
    args: ["o"],
  },
  {
    name: "leave the organization",
    act: (a) => a.leaveWorkspaceOrg("o"),
    request: { kind: "leaveOrg", subject: { org: "o" } },
    direct: () => h.platform.leaveChatOrg,
    args: ["o"],
  },
  {
    name: "rename",
    act: (a) => a.renameWorkspace("o", "Acme"),
    request: { kind: "renameOrg", subject: { org: "o", name: "Acme" } },
    direct: () => h.platform.renameOrg,
    args: ["o", "Acme"],
  },
  {
    name: "delete",
    act: (a) => a.deleteWorkspace("o"),
    request: { kind: "deleteOrg", subject: { org: "o" } },
    direct: () => h.platform.deleteOrg,
    args: ["o"],
  },
];

describe("organization-wide changes", () => {
  for (const c of cases) {
    it(`${c.name}: on Chat's frontend, through the consent page`, async () => {
      h.app = "chat";
      const actions = await load();
      void c.act(actions);
      await vi.waitFor(() => expect(h.openConsentPage).toHaveBeenCalled());
      expect(h.openConsentPage.mock.calls[0]?.[0]).toMatchObject(c.request);
      expect(c.direct()).not.toHaveBeenCalled();
    });

    it(`${c.name}: unbound, the route directly`, async () => {
      const actions = await load();
      await c.act(actions);
      expect(c.direct()).toHaveBeenCalledWith(...c.args);
      expect(h.openConsentPage).not.toHaveBeenCalled();
    });
  }

  it("with chat's app team, removing and leaving take a row off it, with no consent page", async () => {
    h.app = "chat";
    h.chatTeam = true;
    const actions = await load();
    expect(await actions.removeFromWorkspace("o", "acct-bob")).toBe("app");
    expect(await actions.leaveWorkspace("o")).toEqual({ left: "app", lastApp: true });
    expect(h.platform.removeFromChatTeam).toHaveBeenCalledWith("o", "acct-bob");
    expect(h.platform.removeFromChatTeam).toHaveBeenCalledWith("o", "acct-me");
    expect(h.openConsentPage).not.toHaveBeenCalled();
    expect(h.platform.removeFromChat).not.toHaveBeenCalled();
    expect(h.platform.leaveChat).not.toHaveBeenCalled();
  });

  it("in a shared organization, removing and leaving stay Chat's own, even on its frontend", async () => {
    h.app = "chat";
    h.chatOnly = true;
    const actions = await load();
    await actions.removeFromWorkspace("o", "acct-bob");
    await actions.leaveWorkspace("o");
    expect(h.platform.removeFromChat).toHaveBeenCalledWith("o", "acct-bob");
    expect(h.platform.leaveChat).toHaveBeenCalledWith("o");
    expect(h.openConsentPage).not.toHaveBeenCalled();
  });
});
