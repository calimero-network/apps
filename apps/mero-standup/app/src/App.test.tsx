import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { CalimeroError, type AppInfo, type CalimeroClient, type CalimeroSession } from "@calimero-network/mero-js";
import {
  SessionStore,
  createInviteStore,
  resolveTarget,
  type InviteStore,
  type KeyValueStorage,
  type PendingInvite,
  type Target,
} from "@calimero-apps/connect";
import { afterEach, describe, expect, it, vi } from "vitest";

import { App } from "./App";
import type { SessionDeps } from "./session";
import { APP } from "./session";
import { migrateStoredInvite, selectionKey } from "./teams";

afterEach(() => {
  cleanup();
  // The name last used for an org (`@calimero-apps/names`) is the browser's.
  globalThis.localStorage.clear();
});

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
      apps.push({ appId: "app-new", name, owner: "acct-alice", org: "org-1", bundle: "bundle-hash", package: null, version: null });
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
    makeClient: vi.fn(async () => client as unknown as CalimeroClient),
    passkey: () => ({ create: vi.fn(), get: vi.fn() }),
  };
}

describe("App", () => {
  it("shows the listing on a production copy no cluster serves", async () => {
    render(<App deps={deps(fakeClient().client, { DEV: false })} storage={new Memory()} />);
    const open = await screen.findByRole("link", { name: "Open Mero Standup" });
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
    await screen.findByText("Your teams");
    expect(client.signUp).toHaveBeenCalledWith(expect.anything(), "");
    expect(new SessionStore(APP, LOCAL, storage).load()).toEqual(SESSION);
    await waitFor(() => expect(client.listApps).toHaveBeenCalledWith({ bundle: "bundle-hash" }));

    fireEvent.change(screen.getByLabelText("team name"), { target: { value: "Platform" } });
    // Your name in the new team is asked in the same step, and required.
    expect((screen.getByText("Start a new team") as HTMLButtonElement).disabled).toBe(true);
    fireEvent.change(screen.getByLabelText("your name in this team"), { target: { value: "Alice" } });
    fireEvent.click(screen.getByText("Start a new team"));
    await screen.findByText("Platform");
    expect(client.createOrg).toHaveBeenCalledWith("Platform");
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
    expect(client.events).toHaveBeenCalledWith("app-new", 0, expect.anything());
  });

  it("restores the session and the team opened last time, and invites into the team's org", async () => {
    const { client, team } = fakeClient([
      { appId: "app-1", name: "Infra", owner: "acct-alice", org: "org-9", bundle: "bundle-hash", package: null, version: null },
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
    fireEvent.click(await screen.findByText("Create invite link"));
    // The link names the org, so a member opening it is told rather than spending it.
    await screen.findByText(/invite=tok-123&org=org-9/);
    expect(client.invite).toHaveBeenCalledWith("org-9", "member", expect.anything());

    fireEvent.click(screen.getByLabelText("account menu"));
    fireEvent.click(screen.getByText("Switch team"));
    await screen.findByText("Your teams");
  });

  it("never asks in a team whose org has your name, and feeds it to the team's contract", async () => {
    const { client, team, orgs } = fakeClient([
      { appId: "app-1", name: "Infra", owner: "acct-bob", org: "org-9", bundle: "bundle-hash", package: null, version: null },
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
      { appId: "app-1", name: "Infra", owner: "acct-bob", org: "org-9", bundle: "bundle-hash", package: null, version: null },
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
    client.redeemInvite.mockResolvedValue({ org: "org-9" });
    const storage = new Memory();
    const invites = pendingIn(storage, { token: "tok-9" });
    new SessionStore(APP, LOCAL, storage).save(SESSION);
    globalThis.localStorage.setItem("calimero-names:last", "Alice");
    render(<App deps={deps(client)} storage={storage} invites={invites} />);
    fireEvent.click(await screen.findByTestId("invitation-join"));
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
      "You've been invited to join the team in Mero Standup.",
    );
    expect(screen.queryByText(/Async standups and a decision log/)).toBeNull();
    expect(screen.queryByRole("dialog")).toBeNull();

    fireEvent.click(screen.getByTestId("invitation-later"));
    await screen.findByText(/Async standups and a decision log/);
    expect(invites.token()).toBe("tok-9");
  });

  it("asks to join right after signing in, and redeems only on Join", async () => {
    const { client } = fakeClient();
    const storage = new Memory();
    const invites = pendingIn(storage, { token: "tok-9" });
    render(<App deps={deps(client)} storage={storage} invites={invites} />);
    await screen.findByTestId("invitation-page");
    fireEvent.click(screen.getByTestId("signin-passkey"));
    fireEvent.click(await screen.findByTestId("invitation-join"));
    await screen.findByText(/Invitation accepted/);
    expect(client.redeemInvite).toHaveBeenCalledTimes(1);
    expect(client.redeemInvite).toHaveBeenCalledWith("tok-9");
    expect(invites.token()).toBeNull();
  });

  it("tells a member of the invited org they are already in it, without spending the invite", async () => {
    const { client } = fakeClient();
    Object.assign(client, { me: vi.fn(async () => ({ accountId: "acct-alice", orgs: [{ orgId: "org-9" }] })) });
    const storage = new Memory();
    const invites = pendingIn(storage, { token: "tok-9", org: "org-9" });
    new SessionStore(APP, LOCAL, storage).save(SESSION);
    render(<App deps={deps(client)} storage={storage} invites={invites} />);
    expect((await screen.findByTestId("invitation-outcome")).textContent).toContain("You're already in the team");
    expect(client.redeemInvite).not.toHaveBeenCalled();
    expect(invites.token()).toBeNull();
    fireEvent.click(screen.getByTestId("invitation-continue"));
    await screen.findByText("Your teams");
  });

  it("says plainly when the invite was already used or has expired", async () => {
    const refusing = fakeClient().client;
    refusing.redeemInvite.mockRejectedValue(new CalimeroError(400, "REJECTED", "invite was used up, revoked or never existed"));
    const storage = new Memory();
    const invites = pendingIn(storage, { token: "tok-used" });
    new SessionStore(APP, LOCAL, storage).save(SESSION);
    render(<App deps={deps(refusing)} storage={storage} invites={invites} />);
    fireEvent.click(await screen.findByTestId("invitation-join"));
    await screen.findByText(
      "This invite was already used or has expired. Ask the person who invited you for a new link.",
    );
    expect(invites.token()).toBeNull();
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
      { appId: "app-a", name: "alpha", owner: "acct-bob", org: "org-1", bundle: "bundle-hash", package: null, version: null },
      { appId: "app-b", name: "beta", owner: "acct-bob", org: "org-2", bundle: "bundle-hash", package: null, version: null },
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
      client.redeemInvite.mockResolvedValue({ org: "org-2" });
      const storage = new Memory();
      signedIn(storage);
      const invites = pendingIn(storage, { token: "tok-9" });
      render(<App deps={deps(client)} storage={storage} invites={invites} />);
      fireEvent.click(await screen.findByTestId("invitation-join"));
      await waitFor(() => expect(selected(storage)).toBe("app-b"));
      expect(client.redeemInvite).toHaveBeenCalledWith("tok-9");
      expect(invites.token()).toBeNull();
    });

    it("a member of the invited org lands in its team on Continue, without spending the invite", async () => {
      const { client } = fakeClient([...TWO_ORGS]);
      Object.assign(client, { me: vi.fn(async () => ({ accountId: "acct-alice", orgs: [{ orgId: "org-2" }] })) });
      const storage = new Memory();
      signedIn(storage);
      const invites = pendingIn(storage, { token: "tok-9", org: "org-2" });
      render(<App deps={deps(client)} storage={storage} invites={invites} />);
      await screen.findByTestId("invitation-outcome");
      fireEvent.click(screen.getByTestId("invitation-continue"));
      await waitFor(() => expect(selected(storage)).toBe("app-b"));
      expect(client.redeemInvite).not.toHaveBeenCalled();
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
      await waitFor(() => expect(client.signUp).toHaveBeenCalledWith(expect.anything(), "", { invite: "tok-9" }));
      await waitFor(() => expect(selected(storage)).toBe("app-b"));
      expect(client.redeemInvite).not.toHaveBeenCalled();
      expect(invites.token()).toBeNull();
    });

    it("an org with no team this member may add says to ask an owner", async () => {
      const { client } = fakeClient([]);
      client.redeemInvite.mockResolvedValue({ org: "org-2" });
      Object.assign(client, { getOrg: vi.fn(async () => ({ members: { "acct-alice": "member" } })) });
      const storage = new Memory();
      signedIn(storage, false);
      const invites = pendingIn(storage, { token: "tok-9" });
      render(<App deps={deps(client)} storage={storage} invites={invites} />);
      fireEvent.click(await screen.findByTestId("invitation-join"));
      await screen.findByText(/Only an owner or admin of this organization can add a team here/);
    });

    it.each([
      [401, "UNAUTHORIZED", "session expired"],
      [429, "RATE_LIMITED", "too many requests"],
    ])("keeps the invite when the redemption fails with %i", async (status, code, message) => {
      const { client } = fakeClient([...TWO_ORGS]);
      client.redeemInvite.mockRejectedValue(new CalimeroError(status, code, message));
      const storage = new Memory();
      signedIn(storage);
      const invites = pendingIn(storage, { token: "tok-9" });
      render(<App deps={deps(client)} storage={storage} invites={invites} />);
      fireEvent.click(await screen.findByTestId("invitation-join"));
      await screen.findByText(/Your invite is kept/);
      expect(invites.token()).toBe("tok-9");
      expect(screen.getByTestId("invitation-join")).toBeTruthy();
    });

    it("signing out drops the pending invite, so the next person is not asked to join", async () => {
      const { client } = fakeClient([...TWO_ORGS]);
      const storage = new Memory();
      signedIn(storage);
      const invites = pendingIn(storage, { token: "tok-9" });
      render(<App deps={deps(client)} storage={storage} invites={invites} />);
      await screen.findByTestId("invitation-join");
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
