import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { type AppInfo, type CalimeroSession } from "@calimero-network/mero-js";
import {
  SessionStore,
  createInviteStore,
  resolveTarget,
  type InviteStore,
  type KeyValueStorage,
  type PendingInvite,
  type Target,
} from "@calimero-apps/connect";
import { createElement } from "react";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { App } from "./App";
import type { SeatView, WireTableView } from "./chess";
import { APP, type SessionDeps } from "./session";
import { migrateStoredInvite, selectionKey } from "./tables";
import { storedName } from "./useChess";
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

// The shared dialog is mero-react's to test: here only what the app hands it and does after.
vi.mock("@calimero-network/mero-react", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@calimero-network/mero-react")>();
  return {
    ...actual,
    CreateWorkspaceDialog: (p: Parameters<typeof actual.CreateWorkspaceDialog>[0]) =>
      p.open
        ? createElement(
            "div",
            { "data-testid": "create-dialog" },
            createElement("h2", { "data-testid": "create-title" }, p.labels?.title),
            createElement(
              "button",
              { "data-testid": "create-done", onClick: () => void p.onCreated({ orgId: "org-1", name: "Friday blitz", selfName: "Ada" }) },
              "done",
            ),
          )
        : null,
    InviteDialog: (p: Parameters<typeof actual.InviteDialog>[0]) =>
      p.open
        ? createElement(
            "div",
            { "data-testid": "invite-dialog", "data-org": p.org, "data-base": p.linkBase, "data-noun": p.labels?.noun, "data-inviter": p.inviterName },
            createElement("h2", { "data-testid": "invite-title" }, p.labels?.title),
            createElement(
              "button",
              { "data-testid": "invite-done", onClick: () => p.onInvited?.({ token: "tok-123", link: `${p.linkBase}#invite=tok-123` }) },
              "done",
            ),
          )
        : null,
    AcceptInviteDialog: (p: Parameters<typeof actual.AcceptInviteDialog>[0]) =>
      p.open
        ? createElement(
            "div",
            { "data-testid": "accept-dialog", "data-token": p.token, "data-org": p.org, "data-title": p.labels?.title, "data-noun": p.labels?.noun },
            createElement("button", { "data-testid": "accept-fail", onClick: () => p.onError?.(new Error("spent")) }, "fail"),
            createElement("button", { "data-testid": "accept-done", onClick: () => p.onJoined({ org: "org-9", alreadyMember: false }) }, "join"),
            createElement("button", { "data-testid": "accept-member", onClick: () => p.onJoined({ org: "org-9", alreadyMember: true }) }, "member"),
            createElement("button", { "data-testid": "accept-close", onClick: p.onClose }, "close"),
          )
        : null,
  };
});

const SESSION: CalimeroSession = { accountId: "acct-alice", sessionToken: "s", refreshToken: "r", expiresAt: 9e12 };
const DEV_ENV = { DEV: true, VITE_CALIMERO_BUNDLE: "bundle-hash" };
const LOCAL: Target = resolveTarget(DEV_ENV);
const START = "rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBNR w KQkq - 0 1";

const seat = (s: string, member = "", name = ""): SeatView => ({ seat: s, member, name, online: member !== "" });

function tableView(over: Partial<WireTableView> = {}): WireTableView {
  return {
    title: "Table 1",
    createdAt: "0",
    game: 0,
    fen: START,
    sideToMove: "white",
    moves: [],
    legalMoves: [],
    status: "awaitingPlayers",
    result: "*",
    reason: "",
    check: false,
    claimableDraw: "",
    white: seat("white"),
    black: seat("black"),
    me: "acct-alice",
    myColor: "",
    myTurn: false,
    drawOfferFrom: "",
    players: [],
    gamesPlayed: 1,
    ...over,
  };
}

function fakeClient(apps: AppInfo[] = [], view: WireTableView = tableView()) {
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
    call: vi.fn(async (_app: string, _method: string, _args?: unknown) => ({ index: 2, result: null as unknown, events: [] })),
    view: vi.fn(async (_app: string, method: string) => ({ index: 1, result: method === "table" ? view : [] })),
    events: vi.fn(async function* () {}),
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

/** An invite store on `storage` holding `invite`, as `main.tsx` leaves it after capturing a link. */
function pendingIn(storage: KeyValueStorage, invite: Partial<PendingInvite> & { token: string }): InviteStore {
  const invites = createInviteStore(APP, { storage });
  invites.put({ org: null, team: null, doc: null, route: null, extra: {}, ...invite });
  return invites;
}

/** A table in someone else's organization, out of reach until joined. */
const THEIRS: AppInfo = { appId: "app-9", name: "Their table", owner: "acct-bob", org: "org-9", bundle: "bundle-hash", package: null, version: null };

function at(path: string) {
  window.history.replaceState(null, "", path);
}

function opened(storage: Memory, org: string | null = "org-1") {
  new SessionStore(APP, LOCAL, storage).save(SESSION);
  storage.setItem(selectionKey(LOCAL, "acct-alice"), JSON.stringify({ appId: "app-1", name: "Table 1", org }));
}

beforeEach(() => sessionStorage.clear());

describe("App", () => {
  it("shows the listing on a production copy no cluster serves", async () => {
    at("/play");
    render(<App deps={deps(fakeClient(), { DEV: false })} storage={new Memory()} />);
    const open = await screen.findByRole("link", { name: "Open Hyperfeed Chess" });
    // The node-served copy: mdma's `app_host.app_url("com.calimero.mero-chess")`.
    expect(open.getAttribute("href")).toBe("https://3ivxhznpoikah6ubhlzsco4mvjdbfckcjcotgzps3fokcpjpynjq.apps.calimero.network/");
    expect(screen.getByRole("link", { name: "Deploy your own on Calimero Cloud" }).getAttribute("href")).toBe(
      "https://cloud.calimero.network/v2",
    );
    expect(screen.queryByText(/VITE_CALIMERO_CLUSTER/)).toBeNull();
  });

  it("signs up with a passkey, creates a table in a new organization, and invites an opponent", async () => {
    at("/play");
    const client = fakeClient();
    const storage = new Memory();
    render(<App deps={deps(client)} storage={storage} />);

    await screen.findByText(/merod local \(3 nodes\)/);
    fireEvent.click(screen.getByTestId("signup-passkey"));
    await screen.findByText("Sit down at a table");
    expect(client.signUp).toHaveBeenCalledWith(expect.anything(), "");
    expect(new SessionStore(APP, LOCAL, storage).load()).toEqual(SESSION);
    // The table list is asked for after the signed-in page renders, not before it.
    await waitFor(() => expect(client.listApps).toHaveBeenCalledWith({ bundle: "bundle-hash" }));

    fireEvent.click(screen.getByText("New table"));
    expect(screen.getByTestId("create-title").textContent).toBe("New table");
    fireEvent.click(screen.getByTestId("create-done"));
    await screen.findByText("Invite an opponent");
    expect(client.createOrg).not.toHaveBeenCalled();
    expect(client.createApp).toHaveBeenCalledWith("Friday blitz", "bundle-hash", {
      org: "org-1",
      initArgs: { title: "Friday blitz", now: expect.stringMatching(/^\d+$/) },
    });
    expect(storedName()).toBe("Ada");
    await waitFor(() =>
      expect(client.view).toHaveBeenCalledWith("app-new", "table", { now: expect.stringMatching(/^\d+$/) }),
    );
    // The table announces the player and streams its events.
    await waitFor(() =>
      expect(client.call).toHaveBeenCalledWith("app-new", "join", { name: "Ada", now: expect.stringMatching(/^\d+$/) }),
    );
    await waitFor(() => expect(client.events).toHaveBeenCalledWith("app-new", 2, expect.anything()));

    fireEvent.click(screen.getByText("Invite"));
    expect(screen.getByTestId("invite-title").textContent).toBe("Invite to this table");
    // The link names the org (a member is told so instead of spending it), the
    // table to open and the inviter (a seatless inviter by a short account id).
    const dialog = screen.getByTestId("invite-dialog");
    expect(dialog.dataset.org).toBe("org-1");
    expect(dialog.dataset).toMatchObject({ noun: "table", inviter: "Ada" });
    expect(new URL(dialog.dataset.base ?? "").searchParams.toString()).toBe("org=org-1&table=app-new&from=Ada");
    fireEvent.click(screen.getByTestId("invite-done"));
    expect(client.invite).not.toHaveBeenCalled();
  });

  it("shows why the table could not be made once its organization exists", async () => {
    at("/play");
    const client = fakeClient();
    client.createApp.mockRejectedValueOnce(new Error("quota exceeded"));
    render(<App deps={deps(client)} storage={new Memory()} />);
    fireEvent.click(await screen.findByTestId("signup-passkey"));
    fireEvent.click(await screen.findByText("New table"));
    fireEvent.click(screen.getByTestId("create-done"));
    expect(await screen.findByText(/quota exceeded/)).toBeTruthy();
  });

  it("takes the free seat with the typed name, and goes back to the lobby", async () => {
    at("/play");
    const client = fakeClient([], tableView({ white: seat("white", "acct-bob", "Guest") }));
    const storage = new Memory();
    opened(storage, null);
    render(<App deps={deps(client)} storage={storage} />);

    // A seat filed under the contract's default name shows a short account id.
    await screen.findByText("acct-bob");
    await screen.findByText(/belongs to your account alone/);
    fireEvent.change(screen.getByLabelText("your name"), { target: { value: "Alice" } });
    fireEvent.click(screen.getByTestId("sit-black"));
    await waitFor(() =>
      expect(client.call).toHaveBeenCalledWith("app-1", "sit", {
        seat: "black",
        name: "Alice",
        now: expect.stringMatching(/^\d+$/),
      }),
    );

    fireEvent.click(screen.getByText("Change table"));
    await screen.findByText("Sit down at a table");
    expect(storage.getItem(selectionKey(LOCAL, "acct-alice"))).toBeNull();
  });

  it("plays a legal move through the contract", async () => {
    at("/play");
    const client = fakeClient(
      [],
      tableView({
        status: "inProgress",
        white: seat("white", "acct-alice", "Alice"),
        black: seat("black", "acct-bob", "Bob"),
        myColor: "white",
        myTurn: true,
        legalMoves: ["e2e3", "e2e4"],
      }),
    );
    const storage = new Memory();
    opened(storage);
    render(<App deps={deps(client)} storage={storage} />);

    fireEvent.click(await screen.findByTestId("square-e2"));
    fireEvent.click(screen.getByTestId("square-e4"));
    await waitFor(() =>
      expect(client.call).toHaveBeenCalledWith("app-1", "play", { uci: "e2e4", now: expect.stringMatching(/^\d+$/) }),
    );
  });

  it("shows a refusal in v1's words", async () => {
    at("/play");
    const client = fakeClient(
      [],
      tableView({ status: "finished", result: "1-0", reason: "checkmate", white: seat("white", "acct-alice", "Alice"), black: seat("black", "acct-bob", "Bob"), myColor: "white" }),
    );
    const { AppError } = await import("@calimero-network/mero-js");
    client.call.mockImplementation(async (_app: string, method: string) => {
      if (method === "rematch") throw new AppError("refused", { code: "GameNotFinished", fields: {} });
      return { index: 2, result: null, events: [] };
    });
    const storage = new Memory();
    opened(storage);
    render(<App deps={deps(client)} storage={storage} />);

    fireEvent.click(await screen.findByTestId("rematch"));
    expect(await screen.findByTestId("error")).toHaveTextContent("finish this game first");
    expect(client.call).toHaveBeenCalledWith("app-1", "rematch", { now: expect.stringMatching(/^\d+$/) });
  });

  describe("an invitation opened by a signed-in player", () => {
    function signedIn(storage: KeyValueStorage) {
      new SessionStore(APP, LOCAL, storage).save(SESSION);
    }

    it("asks in the shared dialog, and opens the table the link named once joined", async () => {
      at("/play");
      const theirs: AppInfo[] = [];
      const client = fakeClient(theirs);
      const storage = new Memory();
      signedIn(storage);
      const invites = pendingIn(storage, { token: "tok-9", extra: { table: "app-9", from: "Bob" } });
      render(<App deps={deps(client)} storage={storage} invites={invites} />);

      expect((await screen.findByTestId("accept-dialog")).dataset.token).toBe("tok-9");
      expect(client.redeemInvite).not.toHaveBeenCalled();

      theirs.push(THEIRS);
      fireEvent.click(screen.getByTestId("accept-done"));
      await waitFor(() => expect(client.view).toHaveBeenCalledWith("app-9", "table", expect.anything()));
      expect(invites.token()).toBeNull();
      expect(JSON.parse(storage.getItem(selectionKey(LOCAL, "acct-alice")) ?? "null")).toMatchObject({ appId: "app-9" });
    });

    it("says the player is already in when they continue as a member", async () => {
      at("/play");
      const client = fakeClient();
      const storage = new Memory();
      signedIn(storage);
      const invites = pendingIn(storage, { token: "tok-9" });
      render(<App deps={deps(client)} storage={storage} invites={invites} />);
      fireEvent.click(await screen.findByTestId("accept-member"));
      expect(await screen.findByText("You're already in this table.")).toBeTruthy();
      expect(screen.queryByText(/Invitation accepted/)).toBeNull();
    });

    it("an invitation link opened later asks too: a session already there does not join on its own", async () => {
      at("/play");
      const client = fakeClient();
      const storage = new Memory();
      signedIn(storage);
      const invites = createInviteStore(APP, { storage, keep: ["table", "from"] });
      render(<App deps={deps(client)} storage={storage} invites={invites} />);
      await screen.findByText("Sit down at a table");
      invites.put({ token: "tok-9", org: null, team: null, doc: null, route: null, extra: {} });
      expect((await screen.findByTestId("accept-dialog")).dataset.token).toBe("tok-9");
      expect(client.redeemInvite).not.toHaveBeenCalled();
    });

    it("closing the dialog joins nothing and forgets the invite", async () => {
      at("/play");
      const client = fakeClient();
      const storage = new Memory();
      signedIn(storage);
      const invites = pendingIn(storage, { token: "tok-9", extra: { table: "app-9", from: "Bob" } });
      render(<App deps={deps(client)} storage={storage} invites={invites} />);
      fireEvent.click(await screen.findByTestId("accept-close"));
      await screen.findByText("Sit down at a table");
      expect(screen.queryByTestId("accept-dialog")).toBeNull();
      expect(client.redeemInvite).not.toHaveBeenCalled();
      expect(invites.token()).toBeNull();
    });

    it("hands the dialog the link's org and the inviter's wording", async () => {
      at("/play");
      const storage = new Memory();
      signedIn(storage);
      const invites = pendingIn(storage, { token: "tok-9", org: "org-9", extra: { table: "app-9", from: "Bob" } });
      render(<App deps={deps(fakeClient([]))} storage={storage} invites={invites} />);
      const dialog = await screen.findByTestId("accept-dialog");
      expect(dialog.dataset).toMatchObject({ org: "org-9", noun: "table", title: "Join Bob's game" });
    });

    it("words the dialog by the table alone when the link names no inviter", async () => {
      at("/play");
      const storage = new Memory();
      signedIn(storage);
      const invites = pendingIn(storage, { token: "tok-9", org: "org-9" });
      render(<App deps={deps(fakeClient([]))} storage={storage} invites={invites} />);
      const dialog = await screen.findByTestId("accept-dialog");
      expect(dialog.dataset.noun).toBe("table");
      expect(dialog.dataset.title).toBeUndefined();
    });

    it("forgets a spent link when the node refuses it, and keeps the dialog open", async () => {
      at("/play");
      const storage = new Memory();
      signedIn(storage);
      const invites = pendingIn(storage, { token: "tok-9", org: "org-9" });
      render(<App deps={deps(fakeClient([]))} storage={storage} invites={invites} />);
      fireEvent.click(await screen.findByTestId("accept-fail"));
      expect(invites.token()).toBeNull();
      expect(screen.getByTestId("accept-dialog")).toBeTruthy();
    });

    it("signing out drops the pending invite, so the next person is not asked to join", async () => {
      at("/play");
      const client = fakeClient();
      const storage = new Memory();
      signedIn(storage);
      const invites = pendingIn(storage, { token: "tok-9" });
      render(<App deps={deps(client)} storage={storage} invites={invites} />);
      await screen.findByTestId("accept-dialog");
      fireEvent.click(screen.getByText("Log out"));
      await screen.findByTestId("signin-passkey");
      expect(invites.token()).toBeNull();
      expect(screen.queryByTestId("invitation-page")).toBeNull();
      expect(client.redeemInvite).not.toHaveBeenCalled();
    });
  });

  it("an invited newcomer creates the account and joins in one click, and the table opens", async () => {
    at("/play");
    const client = fakeClient([{ ...THEIRS }]);
    const storage = new Memory();
    const invites = pendingIn(storage, { token: "tok-9", org: "org-9", extra: { table: "app-9" } });
    render(<App deps={deps(client)} storage={storage} invites={invites} />);
    fireEvent.click(await screen.findByTestId("signup-passkey"));
    await waitFor(() => expect(client.view).toHaveBeenCalledWith("app-9", "table", expect.anything()));
    expect(client.signUp).toHaveBeenCalledWith(expect.anything(), "", { invite: "tok-9" });
    // Joined at sign-up: nothing left to ask or redeem.
    expect(client.redeemInvite).not.toHaveBeenCalled();
    expect(screen.queryByTestId("accept-dialog")).toBeNull();
    expect(invites.token()).toBeNull();
  });

  it("signing in from the invitation page still asks before joining", async () => {
    at("/play");
    const client = fakeClient();
    const storage = new Memory();
    const invites = pendingIn(storage, { token: "tok-9", extra: { from: "Bob" } });
    render(<App deps={deps(client)} storage={storage} invites={invites} />);
    fireEvent.click(await screen.findByTestId("signin-passkey"));
    expect((await screen.findByTestId("accept-dialog")).dataset.token).toBe("tok-9");
    expect(client.redeemInvite).not.toHaveBeenCalled();
  });

  it("moves an invite an older build stored under its own key into the shared store", () => {
    const storage = new Memory();
    storage.setItem(`${APP}:pending-invite`, JSON.stringify({ token: "tok-old", table: "app-9" }));
    const invites = createInviteStore(APP, { storage, keep: ["table", "from"] });
    migrateStoredInvite(invites, storage);
    expect(invites.pending()).toMatchObject({ token: "tok-old", extra: { table: "app-9" } });
    expect(storage.getItem(`${APP}:pending-invite`)).toBeNull();

    // A link opened just now wins over the old one.
    const fresh = pendingIn(new Memory(), { token: "tok-new" });
    const old = new Memory();
    old.setItem(`${APP}:pending-invite`, JSON.stringify({ token: "tok-old" }));
    migrateStoredInvite(fresh, old);
    expect(fresh.token()).toBe("tok-new");
  });

  describe("an invitation link opened while signed out", () => {
    it("shows the invitation as the page, not the landing hero", async () => {
      at("/");
      const storage = new Memory();
      const invites = pendingIn(storage, { token: "tok-9", extra: { table: "app-9" } });
      render(<App deps={deps(fakeClient())} storage={storage} invites={invites} />);
      expect(await screen.findByTestId("invitation-page")).toBeTruthy();
      expect(window.location.pathname).toBe("/play");
      expect(screen.getByText("You're invited")).toBeTruthy();
      expect(screen.getByTestId("signin-desc").textContent).toContain(
        "You've been invited to join the table in Hyperfeed Chess.",
      );
      expect(screen.getByTestId("signin-passkey")).toBeTruthy();
      expect(screen.getByTestId("signup-passkey")).toBeTruthy();
      expect(document.querySelector(".cal-lp-root")).toBeNull();
    });

    it("Not now shows the landing page and keeps the token", async () => {
      at("/play");
      const storage = new Memory();
      const invites = pendingIn(storage, { token: "tok-9", extra: { table: "app-9" } });
      render(<App deps={deps(fakeClient())} storage={storage} invites={invites} />);
      fireEvent.click(await screen.findByTestId("invitation-not-now"));
      await waitFor(() => expect(window.location.pathname).toBe("/"));
      expect(document.querySelector(".cal-lp-root")).not.toBeNull();
      expect(invites.token()).toBe("tok-9");
    });
  });

  it("tells the node shield which table is open, so its popover checks the node's code", async () => {
    at("/play");
    const client = fakeClient([], tableView({ status: "inProgress", white: seat("white", "acct-alice", "Alice"), black: seat("black", "acct-bob", "Bob"), myColor: "white" }));
    // A node that passes its check and binds the dev bundle's hash to the open instance.
    const attestApp = vi.fn(async () => ({ url: "https://n1.example", mock: false, appHash: "bundle-hash", checkedAt: Date.now() }));
    Object.assign(client, {
      nodeUrl: "https://n1.example",
      verification: () => undefined,
      verify: vi.fn(async () => ({ status: "verified", url: "https://n1.example", mock: false, release: "2.3.148", profile: "locked-read-only", checkedAt: Date.now() })),
      attestApp,
    });
    const storage = new Memory();
    opened(storage);
    render(<App deps={deps(client)} storage={storage} />);
    await screen.findByTestId("square-e2");
    await waitFor(() => expect(screen.getByTestId("node-shield").getAttribute("aria-label")).toBe("Verified node"));
    fireEvent.click(screen.getByTestId("node-shield"));
    await waitFor(() => expect(attestApp).toHaveBeenCalledWith("app-1", "https://n1.example"));
    await screen.findByText("Node runs the code bundle this app was built for");
  });

  it("places the node shield in the top bar, with no floating one beside it", async () => {
    at("/play");
    const storage = new Memory();
    new SessionStore(APP, LOCAL, storage).save(SESSION);
    render(<App deps={deps(fakeClient())} storage={storage} />);
    await screen.findByText("Sit down at a table");
    // findBy fails on none and on more than one, so this also proves there is a single shield.
    const shield = await screen.findByTestId("node-shield");
    expect(shield.closest("header.topbar")).not.toBeNull();
  });

  it("sends a signed-in visitor from the landing page into the app, and signs out", async () => {
    at("/");
    const client = fakeClient();
    const storage = new Memory();
    new SessionStore(APP, LOCAL, storage).save(SESSION);
    render(<App deps={deps(client)} storage={storage} />);
    await screen.findByText("Sit down at a table");
    expect(window.location.pathname).toBe("/play");

    fireEvent.click(screen.getByText("Log out"));
    await screen.findByTestId("signin-passkey");
    expect(client.signOut).toHaveBeenCalled();
    expect(new SessionStore(APP, LOCAL, storage).load()).toBeNull();
  });
});
