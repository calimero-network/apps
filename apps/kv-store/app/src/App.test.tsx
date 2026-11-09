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
import { migrateStoredInvite, selectionKey } from "./stores";

afterEach(cleanup);

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
      apps.push({ appId: "app-new", name, owner: "acct-alice", org: "org-1", bundle: "bundle-hash", package: null, version: null });
      return "app-new";
    }),
    call: vi.fn(async () => ({ index: 1, result: null, events: [] })),
    view: vi.fn(async () => ({ index: 1, result: {} })),
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

const LOCAL: Target = resolveTarget(DEV_ENV);

/** An invite store on `storage` holding `invite`, as `main.tsx` leaves it after capturing a link. */
function pendingIn(storage: KeyValueStorage, invite: Partial<PendingInvite> & { token: string }): InviteStore {
  const invites = createInviteStore(APP, { storage });
  invites.put({ org: null, team: null, doc: null, route: null, extra: {}, ...invite });
  return invites;
}

/** Two shared stores in two orgs: the one opened last, and the one an invite is for. */
const TWO_ORGS: AppInfo[] = [
  { appId: "app-a", name: "alpha", owner: "acct-bob", org: "org-1", bundle: "bundle-hash", package: null, version: null },
  { appId: "app-b", name: "beta", owner: "acct-bob", org: "org-2", bundle: "bundle-hash", package: null, version: null },
];

describe("App", () => {
  it("says why a production build cannot connect", async () => {
    render(<App deps={deps(fakeClient(), { DEV: false, VITE_CALIMERO_CLUSTER: "eu-shared-1" })} storage={new Memory()} />);
    await screen.findByText(/VITE_CALIMERO_MIN_RELEASE is not set/);
  });

  it("sends a listing page no cluster serves to the copy Calimero Cloud serves instead of failing", async () => {
    // A static listing build: no cluster and no floor, so it asks no directory either.
    const d = { ...deps(fakeClient(), { DEV: false }), servedNodes: async () => null };
    render(<App deps={d} storage={new Memory()} />);
    const open = await screen.findByRole("link", { name: "Open KV Store" });
    // The node-served copy: mdma's `app_host.app_url("com.calimero.kv-store")`.
    expect(open.getAttribute("href")).toBe("https://2g7omgwwdshuse6hygzvhssf4w3ute5zc3vjlpor7zknkoyrwxdq.apps.calimero.network/");
    expect(screen.getByRole("link", { name: "Deploy your own on Calimero Cloud" }).getAttribute("href")).toBe(
      "https://cloud.calimero.network/v2",
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

    fireEvent.change(screen.getByLabelText("store name"), { target: { value: "team" } });
    fireEvent.click(screen.getByText("Create"));
    await screen.findByText("Write");
    expect(client.createOrg).toHaveBeenCalledWith("team");
    expect(client.createApp).toHaveBeenCalledWith("team", "bundle-hash", { org: "org-1" });
    await waitFor(() => expect(client.view).toHaveBeenCalledWith("app-new", "entries", {}));

    fireEvent.click(screen.getByText("Create an invitation link"));
    await screen.findByText(/invite=tok-123&org=org-1/);
    expect(client.invite).toHaveBeenCalledWith("org-1", "member", expect.anything());
  });

  it("restores the session and the store opened last time", async () => {
    const client = fakeClient([
      { appId: "app-1", name: "mine", owner: "acct-alice", org: null, bundle: "bundle-hash", package: null, version: null },
    ]);
    const storage = new Memory();
    new SessionStore(APP, LOCAL, storage).save(SESSION);
    storage.setItem(selectionKey(LOCAL, "acct-alice"), JSON.stringify({ appId: "app-1", name: "mine", org: null }));
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
    expect(screen.queryByTestId("invitation-prompt")).toBeNull();
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
    fireEvent.click(await screen.findByTestId("invitation-join"));
    await screen.findByText(/Invitation accepted/);
    expect(client.redeemInvite).toHaveBeenCalledTimes(1);
    expect(client.redeemInvite).toHaveBeenCalledWith("tok-9");
    expect(invites.token()).toBeNull();
  });

  it("joining opens the invited org's store, not the picker or the store open before", async () => {
    const client = fakeClient([...TWO_ORGS]);
    client.redeemInvite.mockResolvedValue({ org: "org-2" });
    const storage = new Memory();
    new SessionStore(APP, LOCAL, storage).save(SESSION);
    storage.setItem(selectionKey(LOCAL, "acct-alice"), JSON.stringify({ appId: "app-a", name: "alpha", org: "org-1" }));
    const invites = pendingIn(storage, { token: "tok-9" });
    render(<App deps={deps(client)} storage={storage} invites={invites} />);
    fireEvent.click(await screen.findByTestId("invitation-join"));
    await screen.findByText("beta");
    expect(screen.getByText("app-b")).toBeTruthy();
    expect(JSON.parse(storage.getItem(selectionKey(LOCAL, "acct-alice")) ?? "{}").appId).toBe("app-b");
    expect(invites.token()).toBeNull();
  });

  it("a member of the invited org lands in its store on Continue, without spending the invite", async () => {
    const client = fakeClient([...TWO_ORGS]);
    Object.assign(client, { me: vi.fn(async () => ({ accountId: "acct-alice", orgs: [{ orgId: "org-2" }] })) });
    const storage = new Memory();
    new SessionStore(APP, LOCAL, storage).save(SESSION);
    storage.setItem(selectionKey(LOCAL, "acct-alice"), JSON.stringify({ appId: "app-a", name: "alpha", org: "org-1" }));
    const invites = pendingIn(storage, { token: "tok-9", org: "org-2" });
    render(<App deps={deps(client)} storage={storage} invites={invites} />);
    await screen.findByTestId("invitation-outcome");
    fireEvent.click(screen.getByTestId("invitation-continue"));
    await screen.findByText("beta");
    expect(screen.getByText("app-b")).toBeTruthy();
    expect(client.redeemInvite).not.toHaveBeenCalled();
  });

  it("an org with no store this member may add says to ask an owner", async () => {
    const client = fakeClient([]);
    client.redeemInvite.mockResolvedValue({ org: "org-2" });
    Object.assign(client, { getOrg: vi.fn(async () => ({ members: { "acct-alice": "member" } })) });
    const storage = new Memory();
    new SessionStore(APP, LOCAL, storage).save(SESSION);
    const invites = pendingIn(storage, { token: "tok-9" });
    render(<App deps={deps(client)} storage={storage} invites={invites} />);
    fireEvent.click(await screen.findByTestId("invitation-join"));
    await screen.findByText(/Only an owner or admin of this organization can add a store here/);
  });

  it.each([
    [401, "UNAUTHORIZED", "session expired"],
    [429, "RATE_LIMITED", "too many requests"],
  ])("keeps the invite when the redemption fails with %i", async (status, code, message) => {
    const client = fakeClient();
    client.redeemInvite.mockRejectedValue(new CalimeroError(status, code, message));
    const storage = new Memory();
    new SessionStore(APP, LOCAL, storage).save(SESSION);
    const invites = pendingIn(storage, { token: "tok-9" });
    render(<App deps={deps(client)} storage={storage} invites={invites} />);
    fireEvent.click(await screen.findByTestId("invitation-join"));
    await screen.findByText(/Your invite is kept/);
    expect(invites.token()).toBe("tok-9");
    expect(screen.getByTestId("invitation-join")).toBeTruthy();
  });

  it("signing out drops the pending invite, so the next person is not asked to join", async () => {
    const client = fakeClient();
    const storage = new Memory();
    new SessionStore(APP, LOCAL, storage).save(SESSION);
    const invites = pendingIn(storage, { token: "tok-9" });
    render(<App deps={deps(client)} storage={storage} invites={invites} />);
    await screen.findByTestId("invitation-join");
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

  it("tells a member of the invited org they are already in it, without spending the invite", async () => {
    const client = fakeClient();
    Object.assign(client, { me: vi.fn(async () => ({ accountId: "acct-alice", orgs: [{ orgId: "org-1" }] })) });
    const storage = new Memory();
    const invites = pendingIn(storage, { token: "tok-9", org: "org-1" });
    new SessionStore(APP, LOCAL, storage).save(SESSION);
    render(<App deps={deps(client)} storage={storage} invites={invites} />);
    expect((await screen.findByTestId("invitation-outcome")).textContent).toContain(
      "You're already in the shared store",
    );
    expect(client.redeemInvite).not.toHaveBeenCalled();
    expect(invites.token()).toBeNull();
  });

  it("says plainly when the invite was already used or has expired", async () => {
    const refusing = fakeClient();
    // Core's answer for a used, revoked or unknown invite.
    refusing.redeemInvite.mockRejectedValue(
      new CalimeroError(400, "REJECTED", "invite was used up, revoked or never existed"),
    );
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
