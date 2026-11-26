import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
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
import { afterEach, describe, expect, it, vi } from "vitest";

import { App } from "./App";
import type { SessionDeps } from "./session";
import { APP } from "./session";
import { migrateStoredInvite, selectionKey } from "./stores";
import { withRoutes } from "@calimero-apps/connect/testing";

afterEach(() => {
  cleanup();
  joinedOrg = "org-1";
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

function fakeClient(apps: AppInfo[] = []) {
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
      apps.push({ appId: "app-new", name, owner: "acct-alice", org: "org-1", bundle: "bundle-hash", package: null, version: null, deployment: null });
      return "app-new";
    }),
    call: vi.fn(async () => ({ index: 1, result: null, events: [] })),
    view: vi.fn(async () => ({ index: 1, result: {} })),
    events: vi.fn(async function* () {}),
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

/** The org the mocked accept dialog reports joining. */
let joinedOrg = "org-1";

// The shared dialogs are mero-react"s to test: here only what the app hands them and does after.
vi.mock("@calimero-network/mero-react", async (importOriginal) => {
  const { createElement } = await import("react");
  return {
    ...(await importOriginal<object>()),
    CreateWorkspaceDialog: (p: {
      open: boolean;
      defaultSelfName?: string;
      release: unknown;
      labels?: { title?: string };
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
              { "data-testid": "create-done", onClick: () => p.onCreated({ orgId: "org-1", name: "team", selfName: "Alice" }) },
              "done",
            ),
          )
        : null,
    InviteDialog: (p: { open: boolean; org: string; linkBase?: string; labels?: { title?: string; noun?: string } }) =>
      p.open
        ? createElement(
            "div",
            { "data-testid": "invite-dialog" },
            createElement("h2", { "data-testid": "invite-title" }, p.labels?.title),
            createElement("pre", { "data-testid": "invite-props" }, JSON.stringify({ org: p.org, linkBase: p.linkBase, noun: p.labels?.noun })),
          )
        : null,
    AcceptInviteDialog: (p: {
      open: boolean;
      token: string;
      org?: string;
      labels?: { noun?: string };
      onClose: () => void;
      onError?: (e: unknown) => void;
      onJoined: (j: { org: string; alreadyMember: boolean }) => void;
    }) =>
      p.open
        ? createElement(
            "div",
            { "data-testid": "accept-dialog" },
            createElement("pre", { "data-testid": "accept-token" }, p.token),
            createElement("pre", { "data-testid": "accept-props" }, JSON.stringify({ org: p.org, noun: p.labels?.noun })),
            createElement("button", { "data-testid": "accept-fail", onClick: () => p.onError?.(new Error("spent")) }, "fail"),
            createElement("button", { "data-testid": "accept-join", onClick: () => p.onJoined({ org: joinedOrg, alreadyMember: false }) }, "join"),
            createElement("button", { "data-testid": "accept-member", onClick: () => p.onJoined({ org: joinedOrg, alreadyMember: true }) }, "member"),
            createElement("button", { "data-testid": "accept-close", onClick: p.onClose }, "close"),
          )
        : null,
  };
});

const LOCAL: Target = resolveTarget(DEV_ENV);

/** An invite store on `storage` holding `invite`, as `main.tsx` leaves it after capturing a link. */
function pendingIn(storage: KeyValueStorage, invite: Partial<PendingInvite> & { token: string }): InviteStore {
  const invites = createInviteStore(APP, { storage });
  invites.put({ org: null, team: null, doc: null, route: null, extra: {}, ...invite });
  return invites;
}

/** Two shared stores in two orgs: the one opened last, and the one an invite is for. */
const TWO_ORGS: AppInfo[] = [
  { appId: "app-a", name: "alpha", owner: "acct-bob", org: "org-1", bundle: "bundle-hash", package: null, version: null, deployment: null },
  { appId: "app-b", name: "beta", owner: "acct-bob", org: "org-2", bundle: "bundle-hash", package: null, version: null, deployment: null },
];

describe("App", () => {
  it("says why a production build cannot connect", async () => {
    render(<App deps={deps(fakeClient(), { DEV: false, VITE_CALIMERO_CLUSTER: "eu-shared-1" })} storage={new Memory()} />);
    await screen.findByText(/VITE_CALIMERO_MIN_RELEASE is not set/);
  });

  it("tells the node shield which store is open, so its popover checks the node's code", async () => {
    const client = fakeClient([
      { appId: "app-1", name: "mine", owner: "acct-alice", org: "", bundle: "bundle-hash", package: null, version: null, deployment: null },
    ]);
    // A node that passes its check and binds the dev bundle's hash to the open instance.
    const attestApp = vi.fn(async () => ({ url: "https://n1.example", mock: false, appHash: "bundle-hash", checkedAt: Date.now() }));
    Object.assign(client, {
      nodeUrl: "https://n1.example",
      verification: () => undefined,
      verify: vi.fn(async () => ({ status: "verified", url: "https://n1.example", mock: false, release: "2.3.148", profile: "locked-read-only", checkedAt: Date.now() })),
      attestApp,
    });
    const storage = new Memory();
    new SessionStore(APP, LOCAL, storage).save(SESSION);
    storage.setItem(selectionKey(LOCAL, "acct-alice"), JSON.stringify({ appId: "app-1", name: "mine", org: "" }));
    render(<App deps={deps(client)} storage={storage} />);
    await screen.findByText("mine");
    await waitFor(() => expect(screen.getByTestId("node-shield").getAttribute("aria-label")).toBe("Verified node"));
    fireEvent.click(screen.getByTestId("node-shield"));
    await waitFor(() => expect(attestApp).toHaveBeenCalledWith("app-1", "https://n1.example"));
    await screen.findByText("Node runs the code bundle this app was built for");
  });

  it("places the node shield in the signed-in footer, with no floating one beside it", async () => {
    const storage = new Memory();
    new SessionStore(APP, LOCAL, storage).save(SESSION);
    render(<App deps={deps(fakeClient())} storage={storage} />);
    await screen.findByText("Your stores");
    // findBy fails on none and on more than one, so this also proves there is a single shield.
    const shield = await screen.findByTestId("node-shield");
    expect(shield.closest("footer")).not.toBeNull();
  });

  it("sends a listing page no cluster serves to the copy Calimero Cloud serves instead of failing", async () => {
    // A static listing build: no cluster and no floor, so it asks no directory either.
    const d = { ...deps(fakeClient(), { DEV: false }), servedNodes: async () => null };
    render(<App deps={d} storage={new Memory()} />);
    const open = await screen.findByRole("link", { name: "Open KV Store" });
    // The node-served copy: mdma's `app_host.app_url("com.calimero.kv-store")`.
    expect(open.getAttribute("href")).toBe("https://2g7omgwwdshuse6hygzvhssf4w3ute5zc3vjlpor7zknkoyrwxdq.apps.calimero.network/");
    expect(screen.getByRole("link", { name: "Deploy your own on Calimero Cloud" }).getAttribute("href")).toBe(
      "https://cloud.calimero.network/deploy",
    );
    expect(screen.queryByText(/VITE_CALIMERO_CLUSTER/)).toBeNull();
    expect(screen.queryByText("Cannot connect")).toBeNull();
  });

  it("connects a page the cluster serves without a cluster name in the build", async () => {
    const client = fakeClient();
    const d = {
      ...deps(client, { DEV: false, VITE_CALIMERO_MIN_RELEASE: "2.3.136" }),
      servedNodes: async () => ["https://n1.example", "https://n2.example"],
    };
    render(<App deps={d} storage={new Memory()} />);
    await screen.findByText(/Connected to Calimero Cloud/);
    expect(d.makeClient).toHaveBeenCalledWith(
      expect.objectContaining({ kind: "cloud", nodes: ["https://n1.example", "https://n2.example"], minReleaseVersion: "2.3.136" }),
    );
  });

  it("signs up with a passkey, keeps the session, and creates a shared store from the dev bundle", async () => {
    const client = fakeClient();
    const storage = new Memory();
    render(<App deps={deps(client)} storage={storage} />);

    await screen.findByText(/Connected to merod local \(3 nodes\)/);
    fireEvent.click(screen.getByText("Create an account"));
    await screen.findByText("Your stores");
    expect(client.signUp).toHaveBeenCalledWith(expect.anything(), "");
    expect(new SessionStore(APP, LOCAL, storage).load()).toEqual(SESSION);
    await waitFor(() => expect(client.listApps).toHaveBeenCalledWith({ bundle: "bundle-hash" }));

    // Shared by default: the org, its name and yours come from the shared dialog.
    expect(screen.queryByLabelText("store name")).toBeNull();
    fireEvent.click(screen.getByText("Create"));
    expect(JSON.parse((await screen.findByTestId("create-release")).textContent ?? "null")).toEqual({ package: "com.calimero.kv-store" });
    fireEvent.click(screen.getByTestId("create-done"));
    await screen.findByText("Write");
    expect(client.createOrg).not.toHaveBeenCalled();
    expect(client.createApp).toHaveBeenCalledWith("team", "bundle-hash", { org: "org-1" });
    await waitFor(() => expect(client.view).toHaveBeenCalledWith("app-new", "entries", {}));

    fireEvent.click(screen.getByText("Create an invitation link"));
    expect((await screen.findByTestId("invite-title")).textContent).toBe("Invite to this store");
    const props = JSON.parse(screen.getByTestId("invite-props").textContent ?? "");
    expect(props).toMatchObject({ org: "org-1", noun: "store" });
    expect(new URL(props.linkBase).searchParams.get("org")).toBe("org-1");
  });

  it("creates a private store with no org and no dialog", async () => {
    const client = fakeClient();
    render(<App deps={deps(client)} storage={new Memory()} />);

    await screen.findByText(/Connected to merod local \(3 nodes\)/);
    fireEvent.click(screen.getByText("Create an account"));
    await screen.findByText("Your stores");
    fireEvent.click(screen.getByLabelText(/shared/));
    fireEvent.change(screen.getByLabelText("store name"), { target: { value: "mine" } });
    fireEvent.click(screen.getByText("Create"));
    await screen.findByText("Write");
    expect(client.createApp).toHaveBeenCalledWith("mine", "bundle-hash");
    expect(client.createOrg).not.toHaveBeenCalled();
    expect(screen.queryByTestId("create-dialog")).toBeNull();
  });

  it("restores the session and the store opened last time", async () => {
    const client = fakeClient([
      { appId: "app-1", name: "mine", owner: "acct-alice", org: "", bundle: "bundle-hash", package: null, version: null, deployment: null },
    ]);
    const storage = new Memory();
    new SessionStore(APP, LOCAL, storage).save(SESSION);
    storage.setItem(selectionKey(LOCAL, "acct-alice"), JSON.stringify({ appId: "app-1", name: "mine", org: "" }));
    render(<App deps={deps(client)} storage={storage} />);

    await screen.findByText("mine");
    expect(client.useSession).toHaveBeenCalledWith(SESSION);
    expect(client.signIn).not.toHaveBeenCalled();
    await screen.findByText(/This store is private/);

    fireEvent.click(screen.getByText("Change store"));
    await screen.findByText("Your stores");
  });

  it("shows a signed-out visitor with an invitation an invitation page, and \"Not now\" keeps it", async () => {
    const client = fakeClient();
    const storage = new Memory();
    const invites = pendingIn(storage, { token: "tok-9" });
    render(<App deps={deps(client)} storage={storage} invites={invites} />);
    const page = await screen.findByTestId("invitation-page");
    expect(page.textContent).toContain(
      "You've been invited to join the shared store in KV Store.",
    );
    expect(screen.queryByRole("dialog")).toBeNull();

    fireEvent.click(screen.getByTestId("invitation-later"));
    expect(screen.queryByTestId("invitation-page")).toBeNull();
    await screen.findByText("Sign in with passkey");
    expect(invites.token()).toBe("tok-9");
  });

  it("an invited newcomer creates the account and joins in one click, and lands in the store list", async () => {
    const client = fakeClient();
    const storage = new Memory();
    const invites = pendingIn(storage, { token: "tok-9" });
    render(<App deps={deps(client)} storage={storage} invites={invites} />);

    const create = await screen.findByTestId("signup-passkey");
    expect(create.textContent).toBe("Create your account and join the shared store");
    fireEvent.click(create);
    await waitFor(() => expect(client.signUp).toHaveBeenCalledWith(expect.anything(), "", { invite: "tok-9" }));
    expect(client.signIn).not.toHaveBeenCalled();
    expect(await screen.findByText("Invitation accepted: the shared store is in your list.")).toBeTruthy();
    expect(client.redeemInvite).not.toHaveBeenCalled();
    expect(screen.queryByTestId("accept-dialog")).toBeNull();
    expect(invites.token()).toBeNull();
  });

  it("an invited newcomer who joined at sign-up lands in the invited org's store", async () => {
    const client = fakeClient([...TWO_ORGS]);
    // The node names the org a sign-up joined in its answer.
    const signUp = client.signUp.getMockImplementation()!;
    client.signUp.mockImplementation(async () => ({ ...(await signUp()), org: "org-2" }));
    const storage = new Memory();
    const invites = pendingIn(storage, { token: "tok-9", org: "org-2" });
    render(<App deps={deps(client)} storage={storage} invites={invites} />);
    fireEvent.click(await screen.findByTestId("signup-passkey"));
    await screen.findByText("beta");
    expect(screen.getByText("app-b")).toBeTruthy();
    expect(client.redeemInvite).not.toHaveBeenCalled();
    expect(invites.token()).toBeNull();
  });

  it("asks to join right after signing in, and redeems only on Join", async () => {
    const client = fakeClient();
    const storage = new Memory();
    const invites = pendingIn(storage, { token: "tok-9" });
    render(<App deps={deps(client)} storage={storage} invites={invites} />);
    await screen.findByTestId("invitation-page");
    fireEvent.click(screen.getByTestId("signin-passkey"));
    expect((await screen.findByTestId("accept-token")).textContent).toBe("tok-9");
    expect(client.redeemInvite).not.toHaveBeenCalled();
    fireEvent.click(screen.getByTestId("accept-join"));
    await screen.findByText(/Invitation accepted/);
    expect(invites.token()).toBeNull();
  });

  it("continuing as an existing member claims no acceptance", async () => {
    const client = fakeClient();
    const storage = new Memory();
    const invites = pendingIn(storage, { token: "tok-9" });
    render(<App deps={deps(client)} storage={storage} invites={invites} />);
    await screen.findByTestId("invitation-page");
    fireEvent.click(screen.getByTestId("signin-passkey"));
    fireEvent.click(await screen.findByTestId("accept-member"));
    await screen.findByText("You're already in this store");
    expect(screen.queryByText(/Invitation accepted/)).toBeNull();
    expect(invites.token()).toBeNull();
  });

  it("joining opens the invited org's store, not the picker or the store open before", async () => {
    const client = fakeClient([...TWO_ORGS]);
    joinedOrg = "org-2";
    const storage = new Memory();
    new SessionStore(APP, LOCAL, storage).save(SESSION);
    storage.setItem(selectionKey(LOCAL, "acct-alice"), JSON.stringify({ appId: "app-a", name: "alpha", org: "org-1" }));
    const invites = pendingIn(storage, { token: "tok-9" });
    render(<App deps={deps(client)} storage={storage} invites={invites} />);
    fireEvent.click(await screen.findByTestId("accept-join"));
    await screen.findByText("beta");
    expect(screen.getByText("app-b")).toBeTruthy();
    expect(JSON.parse(storage.getItem(selectionKey(LOCAL, "acct-alice")) ?? "{}").appId).toBe("app-b");
    expect(invites.token()).toBeNull();
  });

  it("hands the dialog the link's org and the store wording, so the dialog skips a member", async () => {
    const client = fakeClient([...TWO_ORGS]);
    const storage = new Memory();
    new SessionStore(APP, LOCAL, storage).save(SESSION);
    const invites = pendingIn(storage, { token: "tok-9", org: "org-2" });
    render(<App deps={deps(client)} storage={storage} invites={invites} />);
    const props = JSON.parse((await screen.findByTestId("accept-props")).textContent ?? "");
    expect(props).toEqual({ org: "org-2", noun: "store" });
    expect(client.redeemInvite).not.toHaveBeenCalled();
  });

  it("a refused join forgets the token but keeps the dialog on screen", async () => {
    const storage = new Memory();
    new SessionStore(APP, LOCAL, storage).save(SESSION);
    const invites = pendingIn(storage, { token: "tok-9" });
    render(<App deps={deps(fakeClient())} storage={storage} invites={invites} />);
    fireEvent.click(await screen.findByTestId("accept-fail"));
    await waitFor(() => expect(invites.token()).toBeNull());
    expect(screen.getByTestId("accept-dialog")).toBeTruthy();
    fireEvent.click(screen.getByTestId("accept-close"));
    await waitFor(() => expect(screen.queryByTestId("accept-dialog")).toBeNull());
  });

  it("an org with no store this member may add says to ask an owner", async () => {
    const client = fakeClient([]);
    joinedOrg = "org-2";
    Object.assign(client, { getOrg: vi.fn(async () => ({ members: { "acct-alice": "member" } })) });
    const storage = new Memory();
    new SessionStore(APP, LOCAL, storage).save(SESSION);
    const invites = pendingIn(storage, { token: "tok-9" });
    render(<App deps={deps(client)} storage={storage} invites={invites} />);
    fireEvent.click(await screen.findByTestId("accept-join"));
    await screen.findByText(/Only an owner or admin of this organization can add a store here/);
  });

  it("Not now joins nothing and forgets the invite", async () => {
    const client = fakeClient();
    const storage = new Memory();
    new SessionStore(APP, LOCAL, storage).save(SESSION);
    const invites = pendingIn(storage, { token: "tok-9" });
    render(<App deps={deps(client)} storage={storage} invites={invites} />);
    fireEvent.click(await screen.findByTestId("accept-close"));
    await waitFor(() => expect(screen.queryByTestId("accept-dialog")).toBeNull());
    expect(client.redeemInvite).not.toHaveBeenCalled();
    expect(invites.token()).toBeNull();
  });

  it("signing out drops the pending invite, so the next person is not asked to join", async () => {
    const client = fakeClient();
    const storage = new Memory();
    new SessionStore(APP, LOCAL, storage).save(SESSION);
    const invites = pendingIn(storage, { token: "tok-9" });
    render(<App deps={deps(client)} storage={storage} invites={invites} />);
    await screen.findByTestId("accept-dialog");
    fireEvent.click(screen.getByText("Sign out"));
    await screen.findByText("Sign in with passkey");
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

  it("signs out and forgets the session", async () => {
    const client = fakeClient();
    const storage = new Memory();
    new SessionStore(APP, LOCAL, storage).save(SESSION);
    render(<App deps={deps(client)} storage={storage} />);
    await screen.findByText("Sign out");
    fireEvent.click(screen.getByText("Sign out"));
    await screen.findByText("Sign in with passkey");
    expect(client.signOut).toHaveBeenCalled();
    expect(new SessionStore(APP, LOCAL, storage).load()).toBeNull();
  });
});
