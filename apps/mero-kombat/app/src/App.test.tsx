import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { NotFound, type AppInfo, type CalimeroClient, type CalimeroSession } from "@calimero-network/mero-js";
import { SessionStore, resolveTarget, type KeyValueStorage, type Target } from "@calimero-apps/connect";
import { beforeAll, describe, expect, it, vi } from "vitest";

import { App } from "./App";
import { selectionKey } from "./arenas";
import type { ArenaView, FighterView } from "./kombat";
import { APP, type SessionDeps } from "./session";

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
    makeClient: vi.fn(async () => client as unknown as CalimeroClient),
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
    fireEvent.click(screen.getByText("Create a passkey"));
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
    expect(link.textContent).toMatch(/invite=tok-123&arena=app-new&org=org-1/);
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
    const pending = JSON.stringify({ token: "tok-9", arena: null });
    storage.setItem(`${APP}:pending-invite`, pending);
    render(<App deps={deps(fakeClient())} storage={storage} />);
    const page = await screen.findByTestId("invitation-page");
    expect(page.textContent).toContain(
      "You've been invited to join an arena in Mero Kombat. Sign in or create an account to accept.",
    );
    expect(screen.getByText("Continue with passkey")).toBeTruthy();
    expect(document.querySelector(".cal-lp-root")).toBeNull();

    fireEvent.click(screen.getByTestId("invitation-later"));
    await waitFor(() => expect(document.querySelector(".cal-lp-root")).not.toBeNull());
    expect(storage.getItem(`${APP}:pending-invite`)).toBe(pending);
  });

  it("tells a member of the invited org they are already in it, without spending the invite", async () => {
    at("/play");
    const client = Object.assign(fakeClient(), {
      me: vi.fn(async () => ({ accountId: "acct-alice", orgs: [{ orgId: "org-9" }] })),
    });
    const storage = new Memory();
    storage.setItem(`${APP}:pending-invite`, JSON.stringify({ token: "tok-9", arena: null, org: "org-9" }));
    new SessionStore(APP, LOCAL, storage).save(SESSION);
    render(<App deps={deps(client)} storage={storage} />);
    expect((await screen.findByTestId("invitation-outcome")).textContent).toContain(
      "You're already in this arena's organization",
    );
    expect(client.redeemInvite).not.toHaveBeenCalled();
    expect(storage.getItem(`${APP}:pending-invite`)).toBeNull();
  });

  it("asks to join an invitation opened before signing in, then opens the arena it names", async () => {
    at("/play");
    const client = fakeClient([
      { appId: "app-9", name: "Their ring", owner: "acct-bob", org: "org-9", bundle: "bundle-hash", package: null, version: null },
    ]);
    const storage = new Memory();
    storage.setItem(`${APP}:pending-invite`, JSON.stringify({ token: "tok-9", arena: "app-9" }));
    render(<App deps={deps(client)} storage={storage} />);
    fireEvent.click(await screen.findByText("Continue with passkey"));
    // Asked, not done: nothing is redeemed before "Join".
    fireEvent.click(await screen.findByTestId("invitation-join"));
    await screen.findByText("Their ring");
    expect(client.redeemInvite).toHaveBeenCalledWith("tok-9");
    expect(storage.getItem(`${APP}:pending-invite`)).toBeNull();
    await waitFor(() => expect(client.view).toHaveBeenCalledWith("app-9", "arena", expect.anything()));
  });

  it("drops an invitation the cluster refuses", async () => {
    at("/play");
    const client = fakeClient();
    client.redeemInvite.mockRejectedValue(new NotFound("no such invite"));
    const storage = new Memory();
    storage.setItem(`${APP}:pending-invite`, JSON.stringify({ token: "tok-used", arena: null }));
    new SessionStore(APP, LOCAL, storage).save(SESSION);
    render(<App deps={deps(client)} storage={storage} />);
    fireEvent.click(await screen.findByTestId("invitation-join"));
    await screen.findByText(
      "This invite was already used or has expired. Ask the person who invited you for a new link.",
    );
    await waitFor(() => expect(storage.getItem(`${APP}:pending-invite`)).toBeNull());
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
    await screen.findByText("Continue with passkey");
    expect(client.signOut).toHaveBeenCalled();
    expect(new SessionStore(APP, LOCAL, storage).load()).toBeNull();
  });
});
