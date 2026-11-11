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

import App from "./App";
import { migrateStoredInvite, selectionKey } from "./instances";
import { APP, type SessionDeps } from "./session";
import { withRoutes } from "@calimero-apps/connect/testing";

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
  return withRoutes({
    nodeUrl: "http://127.0.0.1:2501",
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
    view: vi.fn(async (_app: string, method: string) => ({ index: 1, result: method === "len" ? "3" : {} })),
    invite: vi.fn(async () => "tok-123"),
    redeemInvite: vi.fn(async () => ({})),
  });
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

describe("App", () => {
  it("shows the listing on a production copy no cluster serves", async () => {
    render(<App deps={deps(fakeClient(), { DEV: false })} storage={new Memory()} />);
    const open = await screen.findByRole("link", { name: "Open Scaffolding E2E" });
    // The node-served copy: mdma's `app_host.app_url("com.calimero.scaffolding-e2e")`.
    expect(open.getAttribute("href")).toBe("https://qckbkkvlixbqw4j52gqoy42wmdnlfesmicyhb5kxacymtsj5geaq.apps.calimero.network/");
    expect(screen.getByRole("link", { name: "Deploy your own on Calimero Cloud" }).getAttribute("href")).toBe(
      "https://cloud.calimero.network/v2",
    );
    expect(screen.queryByText(/VITE_CALIMERO_CLUSTER/)).toBeNull();
  });

  it("signs up with a passkey and creates a shared instance from the dev bundle", async () => {
    const client = fakeClient();
    const storage = new Memory();
    storage.setItem("calimero-active-tab", "kv");
    render(<App deps={deps(client)} storage={storage} />);

    fireEvent.click(await screen.findByTestId("signup-passkey"));
    await screen.findByText("Pick an app instance");
    expect(client.signUp).toHaveBeenCalledWith(expect.anything(), "");

    fireEvent.change(screen.getByLabelText("instance name"), { target: { value: "bench" } });
    fireEvent.click(screen.getByText("Create"));
    await waitFor(() => expect(client.createApp).toHaveBeenCalledWith("bench", "bundle-hash", { org: "org-1" }));
    await screen.findByRole("heading", { name: "KV Operations" });
    expect(storage.getItem(selectionKey(resolveTarget(DEV_ENV), "acct-alice"))).toContain("app-new");
  });

  it("calls the opened instance with the ABI's names and kinds", async () => {
    const client = fakeClient([
      { appId: "app-1", name: "bench", owner: "acct-alice", org: null, bundle: "bundle-hash", package: null, version: null },
    ]);
    const storage = new Memory();
    storage.setItem("calimero-active-tab", "kv");
    render(<App deps={deps(client)} storage={storage} />);

    fireEvent.click(await screen.findByTestId("signin-passkey"));
    fireEvent.click(await screen.findByText("Open"));
    await screen.findByRole("heading", { name: "KV Operations" });

    fireEvent.change(screen.getAllByPlaceholderText("key")[0] as HTMLElement, { target: { value: "k" } });
    fireEvent.change(screen.getAllByPlaceholderText("value")[0] as HTMLElement, { target: { value: "v" } });
    fireEvent.click(screen.getAllByText("Execute")[0] as HTMLElement);
    await waitFor(() => expect(client.call).toHaveBeenCalledWith("app-1", "set", { key: "k", value: "v" }));
    // The live entries panel polls the `entries` view.
    await waitFor(() => expect(client.view).toHaveBeenCalledWith("app-1", "entries", {}));
  });

  it("shows a signed-out visitor with an invitation an invitation page, then asks to join right after sign-in", async () => {
    const client = fakeClient();
    const storage = new Memory();
    const invites = pendingIn(storage, { token: "tok-9" });
    render(<App deps={deps(client)} storage={storage} invites={invites} />);
    const page = await screen.findByTestId("invitation-page");
    expect(page.textContent).toContain(
      "You've been invited to join the shared instance in the E2E test suite.",
    );
    fireEvent.click(screen.getByTestId("signin-passkey"));
    fireEvent.click(await screen.findByTestId("invitation-join"));
    await screen.findByText(/Invitation accepted/);
    expect(client.redeemInvite).toHaveBeenCalledTimes(1);
    expect(client.redeemInvite).toHaveBeenCalledWith("tok-9");
    expect(invites.token()).toBeNull();
  });

  it("\"Not now\" keeps the invitation, and a used or expired one is said plainly", async () => {
    const client = fakeClient();
    client.redeemInvite.mockRejectedValue(new CalimeroError(400, "REJECTED", "invite was used up, revoked or never existed"));
    const storage = new Memory();
    const invites = pendingIn(storage, { token: "tok-used" });
    render(<App deps={deps(client)} storage={storage} invites={invites} />);
    fireEvent.click(await screen.findByTestId("invitation-later"));
    expect(invites.token()).toBe("tok-used");
    fireEvent.click(await screen.findByTestId("signin-passkey"));
    fireEvent.click(await screen.findByTestId("invitation-join"));
    await screen.findByText(
      "This invite was already used or has expired. Ask the person who invited you for a new link.",
    );
    expect(invites.token()).toBeNull();
  });

  describe("invitations land in the invited org", () => {
    /** Two shared instances in two orgs: the one opened last, and the one an invite is for. */
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

    it("joining opens the invited org's instance, not the picker or the one open before", async () => {
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

    it("a member of the invited org lands in its instance on Continue, without spending the invite", async () => {
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

    it("a newcomer who joined at sign-up lands in the invited org's instance", async () => {
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

    it("an org with no instance this member may add says to ask an owner", async () => {
      const client = fakeClient([]);
      client.redeemInvite.mockResolvedValue({ org: "org-2" });
      Object.assign(client, { getOrg: vi.fn(async () => ({ members: { "acct-alice": "member" } })) });
      const storage = new Memory();
      signedIn(storage, false);
      const invites = pendingIn(storage, { token: "tok-9" });
      render(<App deps={deps(client)} storage={storage} invites={invites} />);
      fireEvent.click(await screen.findByTestId("invitation-join"));
      await screen.findByText(/Only an owner or admin of this organization can add an instance here/);
    });

    it.each([
      [401, "UNAUTHORIZED", "session expired"],
      [429, "RATE_LIMITED", "too many requests"],
    ])("keeps the invite when the redemption fails with %i", async (status, code, message) => {
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
      const client = fakeClient([...TWO_ORGS]);
      const storage = new Memory();
      signedIn(storage);
      const invites = pendingIn(storage, { token: "tok-9" });
      render(<App deps={deps(client)} storage={storage} invites={invites} />);
      await screen.findByTestId("invitation-join");
      fireEvent.click(screen.getByText("Sign out"));
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
