import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { NotFound, type AppInfo, type CalimeroClient, type CalimeroSession } from "@calimero-network/mero-js";
import { SessionStore, resolveTarget, type KeyValueStorage, type Target } from "@calimero-apps/connect";
import { describe, expect, it, vi } from "vitest";

import { App } from "./App";
import type { SeatView, WireTableView } from "./chess";
import { APP, type SessionDeps } from "./session";
import { selectionKey } from "./tables";

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
    makeClient: vi.fn(async () => client as unknown as CalimeroClient),
    passkey: () => ({ create: vi.fn(), get: vi.fn() }),
  };
}

function at(path: string) {
  window.history.replaceState(null, "", path);
}

function opened(storage: Memory, org: string | null = "org-1") {
  new SessionStore(APP, LOCAL, storage).save(SESSION);
  storage.setItem(selectionKey(LOCAL, "acct-alice"), JSON.stringify({ appId: "app-1", name: "Table 1", org }));
}

describe("App", () => {
  it("shows the listing on a production copy no cluster serves", async () => {
    at("/play");
    render(<App deps={deps(fakeClient(), { DEV: false })} storage={new Memory()} />);
    const open = await screen.findByRole("link", { name: "Open Mero Chess" });
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
    fireEvent.click(screen.getByText("Create a passkey"));
    await screen.findByText("Sit down at a table");
    expect(client.signUp).toHaveBeenCalledWith(expect.anything(), "");
    expect(new SessionStore(APP, LOCAL, storage).load()).toEqual(SESSION);
    expect(client.listApps).toHaveBeenCalledWith({ bundle: "bundle-hash" });

    fireEvent.click(screen.getByText("New table"));
    await screen.findByText("Invite an opponent");
    expect(client.createOrg).toHaveBeenCalledWith("Table 1");
    expect(client.createApp).toHaveBeenCalledWith("Table 1", "bundle-hash", {
      org: "org-1",
      initArgs: { title: "Table 1", now: expect.stringMatching(/^\d+$/) },
    });
    await waitFor(() =>
      expect(client.view).toHaveBeenCalledWith("app-new", "table", { now: expect.stringMatching(/^\d+$/) }),
    );
    // The table announces the player and streams its events.
    await waitFor(() =>
      expect(client.call).toHaveBeenCalledWith("app-new", "join", { name: "Guest", now: expect.stringMatching(/^\d+$/) }),
    );
    await waitFor(() => expect(client.events).toHaveBeenCalledWith("app-new", 2, expect.anything()));

    fireEvent.click(screen.getByText("Create invite link"));
    const link = await screen.findByLabelText("invitation link");
    expect(link.textContent).toMatch(/invite=tok-123&table=app-new/);
    expect(client.invite).toHaveBeenCalledWith("org-1", "member", expect.anything());
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

  it("redeems an invitation opened before signing in and opens the table it names", async () => {
    at("/play");
    const client = fakeClient([
      { appId: "app-9", name: "Their table", owner: "acct-bob", org: "org-9", bundle: "bundle-hash", package: null, version: null },
    ]);
    const storage = new Memory();
    storage.setItem(`${APP}:pending-invite`, JSON.stringify({ token: "tok-9", table: "app-9" }));
    render(<App deps={deps(client)} storage={storage} />);
    fireEvent.click(await screen.findByText("Continue with passkey"));
    await waitFor(() => expect(client.view).toHaveBeenCalledWith("app-9", "table", expect.anything()));
    expect(client.redeemInvite).toHaveBeenCalledWith("tok-9");
    expect(storage.getItem(`${APP}:pending-invite`)).toBeNull();
  });

  it("drops an invitation the cluster refuses", async () => {
    at("/play");
    const client = fakeClient();
    client.redeemInvite.mockRejectedValue(new NotFound("no such invite"));
    const storage = new Memory();
    storage.setItem(`${APP}:pending-invite`, JSON.stringify({ token: "tok-used", table: null }));
    new SessionStore(APP, LOCAL, storage).save(SESSION);
    render(<App deps={deps(client)} storage={storage} />);
    await screen.findByText(/could not be accepted/);
    await waitFor(() => expect(storage.getItem(`${APP}:pending-invite`)).toBeNull());
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
    await screen.findByText("Continue with passkey");
    expect(client.signOut).toHaveBeenCalled();
    expect(new SessionStore(APP, LOCAL, storage).load()).toBeNull();
  });
});
