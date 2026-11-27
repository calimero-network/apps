import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { NotFound, type AppInfo, type CalimeroSession } from "@calimero-network/mero-js";
import {
  SessionStore,
  createInviteStore,
  resolveTarget,
  type InviteStore,
  type KeyValueStorage,
  type PendingInvite,
  type Target,
} from "@calimero-apps/connect";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { App } from "./App";
import type { SessionDeps } from "./session";
import { APP } from "./session";
import { migrateStoredInvite, selectionKey } from "./teams";
import { withRoutes } from "@calimero-apps/connect/testing";

beforeEach(() => {
  JOINED_ORG = "org-9";
});

afterEach(() => {
  cleanup();
  // The name last used for an org (`@calimero-apps/names`) is the browser's.
  globalThis.localStorage.clear();
});

// The shared dialog is mero-react"s to test: here only what the app hands it and does after.
vi.mock("@calimero-network/mero-react", async (importOriginal) => {
  const { createElement } = await import("react");
  return {
    ...(await importOriginal<object>()),
    CreateWorkspaceDialog: (p: {
      open: boolean;
      defaultSelfName?: string;
      release: unknown;
      labels?: { title?: string; noun?: string };
      onCreated: (w: { orgId: string; name: string; selfName: string }) => void;
    }) =>
      p.open
        ? createElement(
            "div",
            { "data-testid": "create-dialog" },
            createElement("h2", { "data-testid": "create-title" }, p.labels?.title),
            createElement("p", { "data-testid": "create-self" }, p.defaultSelfName),
            createElement("pre", { "data-testid": "create-release" }, JSON.stringify(p.release)),
            createElement(
              "button",
              { "data-testid": "create-done", onClick: () => p.onCreated({ orgId: "org-1", name: "Platform", selfName: "Alice" }) },
              "done",
            ),
          )
        : null,
    InviteDialog: (p: {
      open: boolean;
      org: string;
      linkBase?: string;
      labels?: { title?: string; noun?: string };
      onInvited?: (i: { token: string; link: string }) => void;
    }) =>
      p.open
        ? createElement(
            "div",
            { "data-testid": "invite-dialog", "data-org": p.org, "data-base": p.linkBase, "data-noun": p.labels?.noun },
            createElement("h2", { "data-testid": "invite-title" }, p.labels?.title),
            createElement(
              "button",
              { "data-testid": "invite-done", onClick: () => p.onInvited?.({ token: "tok-123", link: `${p.linkBase}#invite=tok-123` }) },
              "done",
            ),
          )
        : null,
    AcceptInviteDialog: (p: {
      open: boolean;
      token: string;
      org?: string;
      labels?: { noun?: string };
      onJoined: (j: { org: string; alreadyMember: boolean }) => void;
      onClose: () => void;
      onError?: (e: unknown) => void;
    }) =>
      p.open
        ? createElement(
            "div",
            { "data-testid": "accept-dialog", "data-token": p.token, "data-org": p.org, "data-noun": p.labels?.noun },
            createElement("button", { "data-testid": "accept-fail", onClick: () => p.onError?.(new Error("spent")) }, "fail"),
            createElement("button", { "data-testid": "accept-done", onClick: () => p.onJoined({ org: JOINED_ORG, alreadyMember: false }) }, "join"),
            createElement("button", { "data-testid": "accept-member", onClick: () => p.onJoined({ org: JOINED_ORG, alreadyMember: true }) }, "member"),
            createElement("button", { "data-testid": "accept-close", onClick: p.onClose }, "close"),
          )
        : null,
  };
});

// The org the mocked accept dialog reports having joined.
let JOINED_ORG = "org-9";

class Memory implements KeyValueStorage {
  readonly items = new Map<string, string>();
  getItem(k: string) {
    return this.items.get(k) ?? null;
  }
  setItem(k: string, v: string) {
    this.items.set(k, v);
  }
  removeItem(k: string) {
    this.items.delete(k);
  }
}

const SESSION: CalimeroSession = { accountId: "acct-alice", sessionToken: "s", refreshToken: "r", expiresAt: 9e12 };
const DEV_ENV = { DEV: true, VITE_CALIMERO_BUNDLE: "bundle-hash" };
const LOCAL: Target = resolveTarget(DEV_ENV);

/** An invite store on `storage` holding `invite`, as `main.tsx` leaves it after capturing a link. */
function pendingIn(storage: KeyValueStorage, invite: Partial<PendingInvite> & { token: string }): InviteStore {
  const invites = createInviteStore(APP, { storage });
  invites.put({ org: null, team: null, doc: null, route: null, extra: {}, ...invite });
  return invites;
}

/** A team as the contract answers its views. */
function contract() {
  const state = { teamName: "", names: {} as Record<string, string>, posted: [] as unknown[] };
  const view = vi.fn(async (_app: string, method: string, args: Record<string, unknown> = {}) => {
    const result = (() => {
      switch (method) {
        case "whoami":
          return "acct-alice";
        case "getName":
          return state.names[args.account as string] ?? "";
        case "teamName":
          return state.teamName;
        case "getDay":
          return { day: args.day, updates: state.posted };
        case "getWeek":
          return [];
        case "members":
        case "currentBlockers":
        case "tags":
          return [];
        case "listDays":
          return { days: [], nextCursor: null };
        case "listDecisions":
          return { items: [], nextCursor: null };
        default:
          throw new Error(`unexpected view ${method}`);
      }
    })();
    return { index: 1, result };
  });
  const call = vi.fn(async (_app: string, method: string, args: Record<string, unknown> = {}) => {
    if (method === "setTeamName") state.teamName = args.name as string;
    if (method === "setName") state.names["acct-alice"] = args.name as string;
    if (method === "postUpdate") {
      state.posted = [
        {
          ...args,
          author: "acct-alice",
          authorName: state.names["acct-alice"] ?? "",
          createdAt: "1700000000000",
          editedAt: "1700000000000",
          helpers: [],
        },
      ];
    }
    return { index: 2, result: null, events: [] };
  });
  return { state, view, call };
}

function fakeClient(apps: AppInfo[] = []) {
  let session: CalimeroSession | undefined;
  const team = contract();
  /** Each org's member metadata: where your name in it lives. */
  const orgs: Record<string, Record<string, unknown>> = {};
  const client = {
    get session() {
      return session;
    },
    useSession: vi.fn((s: CalimeroSession) => {
      session = s;
    }),
    signIn: vi.fn(async () => {
      session = SESSION;
      return SESSION;
    }),
    signUp: vi.fn(async () => {
      session = SESSION;
      return SESSION;
    }),
    signOut: vi.fn(async () => {
      session = undefined;
    }),
    listApps: vi.fn(async () => apps),
    createOrg: vi.fn(async () => "org-1"),
    createApp: vi.fn(async (name: string) => {
      apps.push({ appId: "app-new", name, owner: "acct-alice", org: "org-1", bundle: "bundle-hash", package: null, version: null, deployment: null });
      return "app-new";
    }),
    call: team.call,
    view: team.view,
    events: vi.fn(async function* () {}),
    invite: vi.fn(async () => "tok-123"),
    redeemInvite: vi.fn(async () => ({})),
    getOrg: vi.fn(async (org: string) => ({ orgId: org, memberMetadata: orgs[org] ?? {} })),
    setMemberMetadata: vi.fn(async (org: string, account: string, meta: Record<string, unknown>) => {
      orgs[org] = { ...orgs[org], [account]: meta };
    }),
  };
  return { client, team, orgs };
}

function deps(client: ReturnType<typeof fakeClient>["client"], env: SessionDeps["env"] = DEV_ENV): SessionDeps {
  return {
    env,
    makeClient: vi.fn(async () => withRoutes(client)),
    passkey: () => ({ create: vi.fn(), get: vi.fn() }),
  };
}

describe("App", () => {
  it("shows the listing on a production copy no cluster serves", async () => {
    render(<App deps={deps(fakeClient().client, { DEV: false })} storage={new Memory()} />);
    const open = await screen.findByRole("link", { name: "Open Hyperfeed Standup" });
    // The node-served copy: mdma's `app_host.app_url("com.calimero.mero-standup")`.
    expect(open.getAttribute("href")).toBe("https://qhccatngyvytjdczbj4ffuikquvmcffnf7kwju6uyr3cmp652uxa.apps.calimero.network/");
    expect(screen.getByRole("link", { name: "Deploy your own on Calimero Cloud" }).getAttribute("href")).toBe(
      "https://cloud.calimero.network/v2",
    );
    expect(screen.queryByText(/VITE_CALIMERO_CLUSTER/)).toBeNull();
  });

  it("signs up with a passkey, starts a team from the dev bundle, names it, and posts an update", async () => {
    const { client, team } = fakeClient();
    const storage = new Memory();
    render(<App deps={deps(client)} storage={storage} />);

    await screen.findByText(/Connected to merod local \(3 nodes\)/);
    fireEvent.click(screen.getByTestId("signup-passkey"));
    fireEvent.click(screen.getByTestId("signup-create"));
    await screen.findByText("Your teams");
    expect(client.signUp).toHaveBeenCalledWith(expect.anything(), "");
    expect(new SessionStore(APP, LOCAL, storage).load()).toEqual(SESSION);
    await waitFor(() => expect(client.listApps).toHaveBeenCalledWith({ bundle: "bundle-hash" }));

    // The org, its name and yours come from the shared dialog.
    fireEvent.click(screen.getByText("Start a new team"));
    expect(JSON.parse((await screen.findByTestId("create-release")).textContent ?? "null")).toEqual({ package: "com.calimero.mero-standup" });
    fireEvent.click(screen.getByTestId("create-done"));
    await screen.findByText("Platform");
    expect(client.createOrg).not.toHaveBeenCalled();
    expect(client.createApp).toHaveBeenCalledWith("Platform", "bundle-hash", { org: "org-1" });
    expect(client.setMemberMetadata).toHaveBeenCalledWith("org-1", "acct-alice", { name: "Alice" });
    expect(team.call).toHaveBeenCalledWith("app-new", "setTeamName", { name: "Platform" });
    expect(JSON.parse(storage.getItem(selectionKey(LOCAL, "acct-alice"))!)).toMatchObject({ appId: "app-new" });

    // The org's name goes to the team's contract without asking.
    await waitFor(() => expect(team.call).toHaveBeenCalledWith("app-new", "setName", { name: "Alice" }));
    expect(screen.queryByText("Welcome to the team")).toBeNull();

    fireEvent.change(screen.getByLabelText("done"), { target: { value: "Wrote the guide" } });
    fireEvent.click(screen.getByText("Post update"));
    await waitFor(() =>
      expect(team.call).toHaveBeenCalledWith("app-new", "postUpdate", expect.objectContaining({ done: "Wrote the guide" })),
    );
    await screen.findByText("Wrote the guide");
    expect(client.events).toHaveBeenCalledWith("app-new", 2, expect.anything());
  });

  it("restores the session and the team opened last time, and invites into the team's org", async () => {
    const { client, team } = fakeClient([
      { appId: "app-1", name: "Infra", owner: "acct-alice", org: "org-9", bundle: "bundle-hash", package: null, version: null, deployment: null },
    ]);
    team.state.teamName = "Infra";
    team.state.names["acct-alice"] = "Alice";
    const storage = new Memory();
    new SessionStore(APP, LOCAL, storage).save(SESSION);
    storage.setItem(selectionKey(LOCAL, "acct-alice"), JSON.stringify({ appId: "app-1", name: "Infra", org: "org-9" }));
    render(<App deps={deps(client)} storage={storage} />);

    await screen.findByText("Infra");
    expect(client.useSession).toHaveBeenCalledWith(SESSION);
    expect(client.signIn).not.toHaveBeenCalled();
    expect(team.view).toHaveBeenCalledWith("app-1", "whoami", {});

    fireEvent.click(screen.getByRole("tab", { name: "Invite" }));
    fireEvent.click(await screen.findByRole("button", { name: "Invite" }));
    expect(screen.getByTestId("invite-title").textContent).toBe("Invite to this team");
    expect(screen.getByTestId("invite-dialog").dataset.noun).toBe("team");
    // The link names the org, so a member opening it is told rather than spending it.
    const dialog = screen.getByTestId("invite-dialog");
    expect(dialog.dataset.org).toBe("org-9");
    expect(new URL(dialog.dataset.base ?? "").searchParams.toString()).toBe("org=org-9");
    fireEvent.click(screen.getByTestId("invite-done"));
    expect(client.invite).not.toHaveBeenCalled();

    fireEvent.click(screen.getByLabelText("account menu"));
    fireEvent.click(screen.getByText("Switch team"));
    await screen.findByText("Your teams");
  });

  it("closes a team that no longer admits the account, back to the picker", async () => {
    const { client } = fakeClient([
      { appId: "app-1", name: "Infra", owner: "acct-bob", org: "org-9", bundle: "bundle-hash", package: null, version: null, deployment: null },
    ]);
    client.events = vi.fn(() => ({
      [Symbol.asyncIterator]: () => ({ next: () => Promise.reject(new NotFound("not found")) }),
    })) as unknown as typeof client.events;
    const storage = new Memory();
    new SessionStore(APP, LOCAL, storage).save(SESSION);
    storage.setItem(selectionKey(LOCAL, "acct-alice"), JSON.stringify({ appId: "app-1", name: "Infra", org: "org-9" }));
    render(<App deps={deps(client)} storage={storage} />);
    await screen.findByText("You no longer have access to that team.");
    await screen.findByText("Your teams");
    expect(storage.getItem(selectionKey(LOCAL, "acct-alice"))).toBeNull();
  });

  it("never asks in a team whose org has your name, and feeds it to the team's contract", async () => {
    const { client, team, orgs } = fakeClient([
      { appId: "app-1", name: "Infra", owner: "acct-bob", org: "org-9", bundle: "bundle-hash", package: null, version: null, deployment: null },
    ]);
    orgs["org-9"] = { "acct-alice": { name: "Alice" } };
    const storage = new Memory();
    new SessionStore(APP, LOCAL, storage).save(SESSION);
    storage.setItem(selectionKey(LOCAL, "acct-alice"), JSON.stringify({ appId: "app-1", name: "Infra", org: "org-9" }));
    render(<App deps={deps(client)} storage={storage} />);
    await waitFor(() => expect(team.call).toHaveBeenCalledWith("app-1", "setName", { name: "Alice" }));
    expect(screen.queryByText("Welcome to the team")).toBeNull();
    expect(client.setMemberMetadata).not.toHaveBeenCalled();
  });

  it("asks once in a team whose org has no name for you, and saves it on the org", async () => {
    const { client, team, orgs } = fakeClient([
      { appId: "app-1", name: "Infra", owner: "acct-bob", org: "org-9", bundle: "bundle-hash", package: null, version: null, deployment: null },
    ]);
    const storage = new Memory();
    new SessionStore(APP, LOCAL, storage).save(SESSION);
    storage.setItem(selectionKey(LOCAL, "acct-alice"), JSON.stringify({ appId: "app-1", name: "Infra", org: "org-9" }));
    render(<App deps={deps(client)} storage={storage} />);
    await screen.findByText("Welcome to the team");
    fireEvent.change(screen.getByLabelText("your name"), { target: { value: "Alice" } });
    fireEvent.click(screen.getByText("Continue"));
    await waitFor(() => expect(client.setMemberMetadata).toHaveBeenCalledWith("org-9", "acct-alice", { name: "Alice" }));
    expect(team.call).toHaveBeenCalledWith("app-1", "setName", { name: "Alice" });
    await waitFor(() => expect(screen.queryByText("Welcome to the team")).toBeNull());
    expect(orgs["org-9"]).toEqual({ "acct-alice": { name: "Alice" } });
  });

  it("asks your name in the org right after joining it, once", async () => {
    const { client } = fakeClient();
    Object.assign(client, { me: vi.fn(async () => ({ accountId: "acct-alice", orgs: [] })) });
    const storage = new Memory();
    const invites = pendingIn(storage, { token: "tok-9" });
    new SessionStore(APP, LOCAL, storage).save(SESSION);
    globalThis.localStorage.setItem("calimero-names:last", "Alice");
    render(<App deps={deps(client)} storage={storage} invites={invites} />);
    fireEvent.click(await screen.findByTestId("accept-done"));
    await screen.findByText("Your name in this team");
    expect((screen.getByLabelText("your name") as HTMLInputElement).value).toBe("Alice");
    fireEvent.click(screen.getByText("Save"));
    await waitFor(() => expect(client.setMemberMetadata).toHaveBeenCalledWith("org-9", "acct-alice", { name: "Alice" }));
    await waitFor(() => expect(screen.queryByText("Your name in this team")).toBeNull());
  });

  it("shows a signed-out visitor with an invitation an invitation page, and \"Not now\" keeps it", async () => {
    const { client } = fakeClient();
    const storage = new Memory();
    const invites = pendingIn(storage, { token: "tok-9" });
    render(<App deps={deps(client)} storage={storage} invites={invites} />);
    const page = await screen.findByTestId("invitation-page");
    expect(page.textContent).toContain(
      "You've been invited to join the team in Hyperfeed Standup.",
    );
    expect(screen.queryByText(/Async standups and a decision log/)).toBeNull();
    expect(screen.queryByRole("dialog")).toBeNull();

    fireEvent.click(screen.getByTestId("invitation-later"));
    await screen.findByText(/Async standups and a decision log/);
    expect(invites.token()).toBe("tok-9");
  });

  it("asks to join right after signing in, and joins only on Join", async () => {
    const { client } = fakeClient();
    const storage = new Memory();
    const invites = pendingIn(storage, { token: "tok-9" });
    render(<App deps={deps(client)} storage={storage} invites={invites} />);
    await screen.findByTestId("invitation-page");
    fireEvent.click(screen.getByTestId("signin-passkey"));
    expect((await screen.findByTestId("accept-dialog")).dataset.token).toBe("tok-9");
    expect(invites.token()).toBe("tok-9");
    fireEvent.click(screen.getByTestId("accept-done"));
    await screen.findByText("Your name in this team");
    expect(invites.token()).toBeNull();
  });

  it("says the person is already in when they continue as a member", async () => {
    const { client } = fakeClient();
    const storage = new Memory();
    client.getOrg.mockResolvedValue({ orgId: "org-9", memberMetadata: {}, members: { "acct-alice": "owner" } } as never);
    const invites = pendingIn(storage, { token: "tok-9" });
    render(<App deps={deps(client)} storage={storage} invites={invites} />);
    fireEvent.click(await screen.findByTestId("signin-passkey"));
    fireEvent.click(await screen.findByTestId("accept-member"));
    expect(await screen.findByText("You're already in this team.")).toBeTruthy();
    expect(screen.queryByText(/Invitation accepted/)).toBeNull();
  });

  it("hands the accept dialog the link's org and the team wording", async () => {
    const { client } = fakeClient();
    const storage = new Memory();
    const invites = pendingIn(storage, { token: "tok-9", org: "org-9" });
    new SessionStore(APP, LOCAL, storage).save(SESSION);
    render(<App deps={deps(client)} storage={storage} invites={invites} />);
    const dialog = await screen.findByTestId("accept-dialog");
    expect(dialog.dataset).toMatchObject({ org: "org-9", noun: "team" });
  });

  it("forgets a spent link when the node refuses it, and keeps the dialog open", async () => {
    const { client } = fakeClient();
    const storage = new Memory();
    const invites = pendingIn(storage, { token: "tok-9", org: "org-9" });
    new SessionStore(APP, LOCAL, storage).save(SESSION);
    render(<App deps={deps(client)} storage={storage} invites={invites} />);
    fireEvent.click(await screen.findByTestId("accept-fail"));
    expect(invites.token()).toBeNull();
    expect(screen.getByTestId("accept-dialog")).toBeTruthy();
  });

  it("closing the accept dialog joins nothing and forgets the invite", async () => {
    const { client } = fakeClient();
    const storage = new Memory();
    const invites = pendingIn(storage, { token: "tok-9" });
    new SessionStore(APP, LOCAL, storage).save(SESSION);
    render(<App deps={deps(client)} storage={storage} invites={invites} />);
    fireEvent.click(await screen.findByTestId("accept-close"));
    await waitFor(() => expect(invites.token()).toBeNull());
    expect(screen.queryByTestId("accept-dialog")).toBeNull();
    expect(client.redeemInvite).not.toHaveBeenCalled();
  });

  it("logs out and forgets the session", async () => {
    const { client } = fakeClient();
    const storage = new Memory();
    new SessionStore(APP, LOCAL, storage).save(SESSION);
    render(<App deps={deps(client)} storage={storage} />);
    await screen.findByText("Your teams");
    fireEvent.click(screen.getByLabelText("account menu"));
    fireEvent.click(screen.getByText("Log out"));
    await screen.findByTestId("signin-passkey");
    expect(client.signOut).toHaveBeenCalled();
    expect(new SessionStore(APP, LOCAL, storage).load()).toBeNull();
  });

  describe("invitations land in the invited org", () => {
    /** Two shared teams in two orgs: the one opened last, and the one an invite is for. */
    const TWO_ORGS: AppInfo[] = [
      { appId: "app-a", name: "alpha", owner: "acct-bob", org: "org-1", bundle: "bundle-hash", package: null, version: null, deployment: null },
      { appId: "app-b", name: "beta", owner: "acct-bob", org: "org-2", bundle: "bundle-hash", package: null, version: null, deployment: null },
    ];
    const selected = (storage: KeyValueStorage) =>
      (JSON.parse(storage.getItem(selectionKey(LOCAL, "acct-alice")) ?? "null") as { appId?: string } | null)?.appId;

    function signedIn(storage: KeyValueStorage, lastOpened = true) {
      new SessionStore(APP, LOCAL, storage).save(SESSION);
      if (lastOpened) {
        storage.setItem(selectionKey(LOCAL, "acct-alice"), JSON.stringify({ appId: "app-a", name: "alpha", org: "org-1" }));
      }
    }

    it("joining opens the invited org's team, not the picker or the one open before", async () => {
      const { client } = fakeClient([...TWO_ORGS]);
      JOINED_ORG = "org-2";
      const storage = new Memory();
      signedIn(storage);
      const invites = pendingIn(storage, { token: "tok-9" });
      render(<App deps={deps(client)} storage={storage} invites={invites} />);
      await screen.findByTestId("accept-dialog");
      await waitFor(() => expect(client.listApps).toHaveBeenCalled());
      fireEvent.click(screen.getByTestId("accept-done"));
      await waitFor(() => expect(selected(storage)).toBe("app-b"));
      expect(invites.token()).toBeNull();
    });

    it("a newcomer who joined at sign-up lands in the invited org's team", async () => {
      const { client } = fakeClient([...TWO_ORGS]);
      // The node names the org a sign-up joined in its answer.
      const signUp = client.signUp.getMockImplementation()!;
      client.signUp.mockImplementation(async () => ({ ...(await signUp()), org: "org-2" }));
      const storage = new Memory();
      const invites = pendingIn(storage, { token: "tok-9", org: "org-2" });
      render(<App deps={deps(client)} storage={storage} invites={invites} />);
      fireEvent.click(await screen.findByTestId("signup-passkey"));
      fireEvent.click(await screen.findByTestId("signup-create"));
      await waitFor(() => expect(client.signUp).toHaveBeenCalledWith(expect.anything(), "", { invite: "tok-9" }));
      await waitFor(() => expect(selected(storage)).toBe("app-b"));
      expect(client.redeemInvite).not.toHaveBeenCalled();
      expect(invites.token()).toBeNull();
    });

    it("an org with no team this member may add says to ask an owner", async () => {
      const { client } = fakeClient([]);
      JOINED_ORG = "org-2";
      Object.assign(client, { getOrg: vi.fn(async () => ({ members: { "acct-alice": "member" } })) });
      const storage = new Memory();
      signedIn(storage, false);
      const invites = pendingIn(storage, { token: "tok-9" });
      render(<App deps={deps(client)} storage={storage} invites={invites} />);
      fireEvent.click(await screen.findByTestId("accept-done"));
      await screen.findByText(/Only an owner or admin of this organization can add a team here/);
    });

    it("signing out drops the pending invite, so the next person is not asked to join", async () => {
      const { client } = fakeClient([...TWO_ORGS]);
      const storage = new Memory();
      signedIn(storage);
      const invites = pendingIn(storage, { token: "tok-9" });
      render(<App deps={deps(client)} storage={storage} invites={invites} />);
      await screen.findByTestId("accept-dialog");
      fireEvent.click(screen.getByLabelText("account menu"));
      fireEvent.click(screen.getByText("Log out"));
      await screen.findByTestId("signin-passkey");
      expect(invites.token()).toBeNull();
      expect(screen.queryByTestId("invitation-page")).toBeNull();
    });

    it("moves an invite an older build stored under its own key into the shared store", () => {
      const storage = new Memory();
      storage.setItem(`${APP}:pending-invite`, "tok-old");
      storage.setItem(`${APP}:pending-invite-org`, "org-2");
      const invites = createInviteStore(APP, { storage });
      migrateStoredInvite(invites, storage);
      expect(invites.pending()).toMatchObject({ token: "tok-old", org: "org-2" });
      expect(storage.getItem(`${APP}:pending-invite`)).toBeNull();
      expect(storage.getItem(`${APP}:pending-invite-org`)).toBeNull();

      // A link opened just now wins over the old one.
      const fresh = pendingIn(new Memory(), { token: "tok-new" });
      const old = new Memory();
      old.setItem(`${APP}:pending-invite`, "tok-old");
      migrateStoredInvite(fresh, old);
      expect(fresh.token()).toBe("tok-new");
    });
  });
});
