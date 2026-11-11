import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { CalimeroError, type AppInfo, type CalimeroSession } from "@calimero-network/mero-js";
import {
  SessionStore,
  createInviteStore,
  resolveTarget,
  type InviteStore,
  type KeyValueStorage,
  type PendingInvite,
  type Target,
} from "@calimero-apps/connect";
import { beforeAll, describe, expect, it, vi } from "vitest";

import { App } from "./App";
import { migrateStoredInvite, selectionKey } from "./arenas";
import type { ArenaView, FighterView } from "./kombat";
import { APP, type SessionDeps } from "./session";
import { withRoutes } from "@calimero-apps/connect/testing";

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

beforeAll(() => {
  // jsdom has no 2D canvas; the cabinet and portraits draw nothing without one.
  HTMLCanvasElement.prototype.getContext = (() => null) as typeof HTMLCanvasElement.prototype.getContext;
});

const SESSION: CalimeroSession = { accountId: "acct-alice", sessionToken: "s", refreshToken: "r", expiresAt: 9e12 };
const DEV_ENV = { DEV: true, VITE_CALIMERO_BUNDLE: "bundle-hash" };
const LOCAL: Target = resolveTarget(DEV_ENV);

/** An invite store on `storage` holding `invite`, as `main.tsx` leaves it after capturing a link. */
function pendingIn(storage: KeyValueStorage, invite: Partial<PendingInvite> & { token: string }): InviteStore {
  const invites = createInviteStore(APP, { storage });
  invites.put({ org: null, team: null, doc: null, route: null, extra: {}, ...invite });
  return invites;
}

const corner = (seat: string, member = "", name = ""): FighterView => ({
  seat,
  member,
  name,
  fighter: seat === "p1" ? "kinetic" : "cryo",
  hp: 100,
  roundsWon: 0,
  matchesWon: 0,
  online: member !== "",
});

function arenaView(over: Partial<ArenaView> = {}): ArenaView {
  return {
    title: "Arena",
    createdAt: "0",
    matchIndex: 0,
    round: 0,
    status: "waiting",
    roundResults: [],
    winner: "",
    flawless: false,
    p1: corner("p1"),
    p2: corner("p2"),
    me: "acct-alice",
    mySeat: "",
    hits: [],
    matchActions: 0,
    totalActions: "0",
    maxHp: 100,
    roundsToWin: 2,
    ...over,
  };
}

function fakeClient(apps: AppInfo[] = [], view: ArenaView = arenaView()) {
  let session: CalimeroSession | undefined;
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
    call: vi.fn(async () => ({ index: 2, result: null, events: [] })),
    view: vi.fn(async (_app: string, method: string) => ({ index: 1, result: method === "arena" ? view : [] })),
    events: vi.fn(async function* () {}),
    publishPresence: vi.fn(async () => {}),
    presenceStream: vi.fn(async function* () {}),
    invite: vi.fn(async () => "tok-123"),
    redeemInvite: vi.fn(async () => ({})),
  };
  return client;
}

function deps(client: ReturnType<typeof fakeClient>, env: SessionDeps["env"] = DEV_ENV): SessionDeps {
  return {
    env,
    makeClient: vi.fn(async () => withRoutes(client)),
    passkey: () => ({ create: vi.fn(), get: vi.fn() }),
  };
}

function at(path: string) {
  window.history.replaceState(null, "", path);
}

describe("App", () => {
  it("shows the listing on a production copy no cluster serves, and still offers practice", async () => {
    at("/play");
    render(<App deps={deps(fakeClient(), { DEV: false })} storage={new Memory()} />);
    const open = await screen.findByRole("link", { name: "Open Mero Kombat" });
    // The node-served copy: mdma's `app_host.app_url("com.calimero.mero-kombat")`.
    expect(open.getAttribute("href")).toBe("https://orqxfngg5qothc2ka2egy5yxatlmyty5y26jpy37ypltr4c26ksa.apps.calimero.network/");
    expect(screen.getByRole("link", { name: "Deploy your own on Calimero Cloud" }).getAttribute("href")).toBe(
      "https://cloud.calimero.network/v2",
    );
    expect(screen.queryByText(/VITE_CALIMERO_CLUSTER/)).toBeNull();
    expect(screen.getByText("Practice vs CPU")).toBeInTheDocument();
  });

  it("signs up with a passkey, creates an arena in a new organization, and invites an opponent", async () => {
    at("/play");
    const client = fakeClient();
    const storage = new Memory();
    render(<App deps={deps(client)} storage={storage} />);

    await screen.findByText(/merod local \(3 nodes\)/);
    fireEvent.click(screen.getByTestId("signup-passkey"));
    await screen.findByText("Enter the arena");
    expect(client.signUp).toHaveBeenCalledWith(expect.anything(), "");
    expect(new SessionStore(APP, LOCAL, storage).load()).toEqual(SESSION);
    await waitFor(() => expect(client.listApps).toHaveBeenCalledWith({ bundle: "bundle-hash" }));

    fireEvent.click(screen.getByText("New arena"));
    await screen.findByText("Invite an opponent");
    expect(client.createOrg).toHaveBeenCalledWith("Arena 1");
    expect(client.createApp).toHaveBeenCalledWith("Arena 1", "bundle-hash", {
      org: "org-1",
      initArgs: { title: "Arena 1", now: expect.stringMatching(/^\d+$/) },
    });
    await waitFor(() =>
      expect(client.view).toHaveBeenCalledWith("app-new", "arena", { now: expect.stringMatching(/^\d+$/) }),
    );
    // The arena announces the player, and streams its events and presence.
    await waitFor(() =>
      expect(client.call).toHaveBeenCalledWith("app-new", "join", expect.objectContaining({ fighter: "kinetic" })),
    );
    await waitFor(() => expect(client.events).toHaveBeenCalledWith("app-new", 2, expect.anything()));
    expect(client.presenceStream).toHaveBeenCalledWith("app-new", expect.anything());

    fireEvent.click(screen.getByText("Create invite link"));
    const link = await screen.findByLabelText("invitation link");
    expect(link.textContent).toMatch(/invite=tok-123&org=org-1&arena=app-new/);
    expect(client.invite).toHaveBeenCalledWith("org-1", "member", expect.anything());
  });

  it("takes a corner and calls a rematch through the contract", async () => {
    at("/play");
    const client = fakeClient(
      [],
      arenaView({
        status: "finished",
        winner: "p1",
        mySeat: "p1",
        p1: corner("p1", "acct-alice", "Alice"),
        p2: corner("p2", "acct-bob", "Bob"),
      }),
    );
    const storage = new Memory();
    new SessionStore(APP, LOCAL, storage).save(SESSION);
    storage.setItem(selectionKey(LOCAL, "acct-alice"), JSON.stringify({ appId: "app-1", name: "Ring", org: "org-1" }));
    render(<App deps={deps(client)} storage={storage} />);

    fireEvent.click(await screen.findByTestId("rematch"));
    await waitFor(() =>
      expect(client.call).toHaveBeenCalledWith("app-1", "rematch", { now: expect.stringMatching(/^\d+$/) }),
    );
  });

  it("offers the open corner on a waiting arena", async () => {
    at("/play");
    const client = fakeClient([], arenaView({ p1: corner("p1", "acct-bob", "Fighter") }));
    const storage = new Memory();
    new SessionStore(APP, LOCAL, storage).save(SESSION);
    storage.setItem(selectionKey(LOCAL, "acct-alice"), JSON.stringify({ appId: "app-1", name: "Ring", org: null }));
    render(<App deps={deps(client)} storage={storage} />);

    // A corner filed under the contract's default name shows a short account id.
    await screen.findByText("acct-bob");
    await screen.findByText(/belongs to your account alone/);
    fireEvent.change(screen.getByLabelText("your name"), { target: { value: "Alice" } });
    fireEvent.click(screen.getByTestId("sit-p2"));
    await waitFor(() =>
      expect(client.call).toHaveBeenCalledWith("app-1", "sit", {
        seat: "p2",
        name: "Alice",
        fighter: expect.any(String),
        now: expect.stringMatching(/^\d+$/),
      }),
    );

    fireEvent.click(screen.getByText("Arenas"));
    await screen.findByText("Enter the arena");
    expect(storage.getItem(selectionKey(LOCAL, "acct-alice"))).toBeNull();
  });

  it("shows a signed-out visitor with an invitation an invitation page, and \"Not now\" keeps it", async () => {
    at("/");
    const storage = new Memory();
    const invites = pendingIn(storage, { token: "tok-9" });
    render(<App deps={deps(fakeClient())} storage={storage} invites={invites} />);
    const page = await screen.findByTestId("invitation-page");
    expect(page.textContent).toContain(
      "You've been invited to join the arena in Mero Kombat.",
    );
    expect(screen.getByTestId("signin-passkey")).toBeTruthy();
    expect(document.querySelector(".cal-lp-root")).toBeNull();

    fireEvent.click(screen.getByTestId("invitation-later"));
    await waitFor(() => expect(document.querySelector(".cal-lp-root")).not.toBeNull());
    expect(invites.token()).toBe("tok-9");
  });

  it("tells a member of the invited org they are already in it, without spending the invite", async () => {
    at("/play");
    const client = Object.assign(fakeClient(), {
      me: vi.fn(async () => ({ accountId: "acct-alice", orgs: [{ orgId: "org-9" }] })),
    });
    const storage = new Memory();
    const invites = pendingIn(storage, { token: "tok-9", org: "org-9" });
    new SessionStore(APP, LOCAL, storage).save(SESSION);
    render(<App deps={deps(client)} storage={storage} invites={invites} />);
    expect((await screen.findByTestId("invitation-outcome")).textContent).toContain(
      "You're already in the arena",
    );
    expect(client.redeemInvite).not.toHaveBeenCalled();
    expect(invites.token()).toBeNull();
  });

  it("asks to join an invitation opened before signing in, then opens the arena it names", async () => {
    at("/play");
    const client = fakeClient([
      { appId: "app-9", name: "Their ring", owner: "acct-bob", org: "org-9", bundle: "bundle-hash", package: null, version: null },
    ]);
    const storage = new Memory();
    const invites = pendingIn(storage, { token: "tok-9", extra: { arena: "app-9" } });
    render(<App deps={deps(client)} storage={storage} invites={invites} />);
    fireEvent.click(await screen.findByTestId("signin-passkey"));
    // Asked, not done: nothing is redeemed before "Join".
    fireEvent.click(await screen.findByTestId("invitation-join"));
    await screen.findByText("Their ring");
    expect(client.redeemInvite).toHaveBeenCalledWith("tok-9");
    expect(invites.token()).toBeNull();
    await waitFor(() => expect(client.view).toHaveBeenCalledWith("app-9", "arena", expect.anything()));
  });

  it("an invited newcomer creates the account and joins in one click, and the arena opens", async () => {
    at("/play");
    const client = fakeClient([
      { appId: "app-9", name: "Their ring", owner: "acct-bob", org: "org-9", bundle: "bundle-hash", package: null, version: null },
    ]);
    // The session reads the invite from the page's storage, as in the browser.
    const invites = pendingIn(localStorage, { token: "tok-9", extra: { arena: "app-9" } });
    try {
      render(<App deps={deps(client)} storage={localStorage} invites={invites} />);
      const create = await screen.findByTestId("signup-passkey");
      expect(create.textContent).toBe("Create your account and join the arena");
      fireEvent.click(create);
      await screen.findByText("Their ring");
      expect(client.signUp).toHaveBeenCalledWith(expect.anything(), "", { invite: "tok-9" });
      expect(client.signIn).not.toHaveBeenCalled();
      expect(client.redeemInvite).not.toHaveBeenCalled();
      expect(invites.token()).toBeNull();
    } finally {
      localStorage.clear();
    }
  });

  it("drops an invitation the cluster refuses", async () => {
    at("/play");
    const client = fakeClient();
    // Core's answer for a used, revoked or unknown invite.
    client.redeemInvite.mockRejectedValue(
      new CalimeroError(400, "REJECTED", "invite was used up, revoked or never existed"),
    );
    const storage = new Memory();
    const invites = pendingIn(storage, { token: "tok-used" });
    new SessionStore(APP, LOCAL, storage).save(SESSION);
    render(<App deps={deps(client)} storage={storage} invites={invites} />);
    fireEvent.click(await screen.findByTestId("invitation-join"));
    await screen.findByText(
      "This invite was already used or has expired. Ask the person who invited you for a new link.",
    );
    await waitFor(() => expect(invites.token()).toBeNull());
  });

  it("sends a signed-in visitor from the landing page into the app, and signs out", async () => {
    at("/");
    const client = fakeClient();
    const storage = new Memory();
    new SessionStore(APP, LOCAL, storage).save(SESSION);
    render(<App deps={deps(client)} storage={storage} />);
    await screen.findByText("Enter the arena");
    expect(window.location.pathname).toBe("/play");

    fireEvent.click(screen.getByText("Log out"));
    await screen.findByTestId("signin-passkey");
    expect(client.signOut).toHaveBeenCalled();
    expect(new SessionStore(APP, LOCAL, storage).load()).toBeNull();
  });

  describe("invitations land in the invited org", () => {
    /** Two shared arenas in two orgs: the one opened last, and the one an invite is for. */
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

    it("joining opens the invited org's arena, not the picker or the one open before", async () => {
      at("/play");
      const client = fakeClient([...TWO_ORGS]);
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

    it("a member of the invited org lands in its arena on Continue, without spending the invite", async () => {
      at("/play");
      const client = fakeClient([...TWO_ORGS]);
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

    it("a newcomer who joined at sign-up lands in the invited org's arena", async () => {
      at("/play");
      const client = fakeClient([...TWO_ORGS]);
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

    it("an org with no arena this member may add says to ask an owner", async () => {
      at("/play");
      const client = fakeClient([]);
      client.redeemInvite.mockResolvedValue({ org: "org-2" });
      Object.assign(client, { getOrg: vi.fn(async () => ({ members: { "acct-alice": "member" } })) });
      const storage = new Memory();
      signedIn(storage, false);
      const invites = pendingIn(storage, { token: "tok-9" });
      render(<App deps={deps(client)} storage={storage} invites={invites} />);
      fireEvent.click(await screen.findByTestId("invitation-join"));
      await screen.findByText(/Only an owner or admin of this organization can add an arena here/);
    });

    it.each([
      [401, "UNAUTHORIZED", "session expired"],
      [429, "RATE_LIMITED", "too many requests"],
    ])("keeps the invite when the redemption fails with %i", async (status, code, message) => {
      at("/play");
      const client = fakeClient([...TWO_ORGS]);
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
      at("/play");
      const client = fakeClient([...TWO_ORGS]);
      const storage = new Memory();
      signedIn(storage);
      const invites = pendingIn(storage, { token: "tok-9" });
      render(<App deps={deps(client)} storage={storage} invites={invites} />);
      await screen.findByTestId("invitation-join");
      fireEvent.click(screen.getByText("Log out"));
      await screen.findByTestId("signin-passkey");
      expect(invites.token()).toBeNull();
      expect(screen.queryByTestId("invitation-page")).toBeNull();
    });

    it("a member who may not add an arena to an organization is told to ask an owner instead", async () => {
      at("/play");
      const client = fakeClient([...TWO_ORGS]);
      Object.assign(client, {
        getOrg: vi.fn(async (org: string) =>
          org === "org-2" ? { members: { "acct-alice": "member" } } : { members: { "acct-alice": "owner" } },
        ),
      });
      const storage = new Memory();
      signedIn(storage, false);
      render(<App deps={deps(client)} storage={storage} invites={createInviteStore(APP, { storage })} />);
      expect((await screen.findByTestId("ask-an-owner")).textContent).toContain(
        "Only an owner or admin of this organization can add an arena here",
      );
      // The organization this account owns keeps its button.
      expect(screen.getAllByText("Add arena")).toHaveLength(1);
    });

    it("moves an invite an older build stored under its own key into the shared store", () => {
      const storage = new Memory();
      storage.setItem(`${APP}:pending-invite`, JSON.stringify({ token: "tok-old", arena: "app-9", org: "org-2" }));
      const invites = createInviteStore(APP, { storage, keep: ["arena"] });
      migrateStoredInvite(invites, storage);
      expect(invites.pending()).toMatchObject({ token: "tok-old", org: "org-2", extra: { arena: "app-9" } });
      expect(storage.getItem(`${APP}:pending-invite`)).toBeNull();

      // A link opened just now wins over the old one.
      const fresh = pendingIn(new Memory(), { token: "tok-new" });
      const old = new Memory();
      old.setItem(`${APP}:pending-invite`, JSON.stringify({ token: "tok-old" }));
      migrateStoredInvite(fresh, old);
      expect(fresh.token()).toBe("tok-new");
    });
  });
});
