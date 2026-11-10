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
import { migrateStoredInvite, selectionKey } from "./groups";
import type { SessionDeps } from "./session";
import { APP } from "./session";

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

const ME = "acct-alice";
const SESSION: CalimeroSession = { accountId: ME, sessionToken: "s", refreshToken: "r", expiresAt: 9e12 };
const DEV_ENV = { DEV: true, VITE_CALIMERO_BUNDLE: "bundle-hash" };

/** What the contract answers, as the node sends it: 64-bit integers as decimal strings. */
const VIEWS: Record<string, unknown> = {
  whoami: { account: ME },
  roster: [{ account: ME, name: "Alice" }],
  listPolls: [
    {
      poll_id: "p1",
      title: "Where is the offsite?",
      creator: ME,
      phase: "Voting",
      created_at: "1700000000000",
      ballots: 2,
    },
  ],
};

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
      apps.push({ appId: "app-new", name, owner: ME, org: "org-1", bundle: "bundle-hash", package: null, version: null });
      return "app-new";
    }),
    call: vi.fn(async () => ({ index: 1, result: null, events: [] })),
    view: vi.fn(async (_app: string, method: string) => ({ index: 1, result: VIEWS[method] ?? null })),
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

describe("App", () => {
  it("shows the listing on a production copy no cluster serves", async () => {
    render(<App deps={deps(fakeClient(), { DEV: false })} storage={new Memory()} />);
    const open = await screen.findByRole("link", { name: "Open Mero Vote" });
    // The node-served copy: mdma's `app_host.app_url("com.calimero.mero-vote")`.
    expect(open.getAttribute("href")).toBe("https://qpe2mqkuj625tmvqshuqe4n5mz5plntrdqnltdbahtprjk42hsta.apps.calimero.network/");
    expect(screen.getByRole("link", { name: "Deploy your own on Calimero Cloud" }).getAttribute("href")).toBe(
      "https://cloud.calimero.network/v2",
    );
    expect(screen.queryByText(/VITE_CALIMERO_CLUSTER/)).toBeNull();
  });

  it("signs up with a passkey, creates a voting group from the dev bundle, shows its polls and invites", async () => {
    const client = fakeClient();
    const storage = new Memory();
    render(<App deps={deps(client)} storage={storage} />);

    await screen.findByText(/Connected to merod local \(3 nodes\)/);
    fireEvent.click(screen.getByTestId("signup-passkey"));
    await screen.findByText("Choose a voting group");
    expect(client.signUp).toHaveBeenCalledWith(expect.anything(), "");
    expect(new SessionStore(APP, LOCAL, storage).load()).toEqual(SESSION);
    // The picker lists groups in an effect, after its heading has rendered.
    await waitFor(() => expect(client.listApps).toHaveBeenCalledWith({ bundle: "bundle-hash" }));

    fireEvent.change(screen.getByLabelText("Group name"), { target: { value: "Offsite" } });
    fireEvent.click(screen.getByText("Create voting group"));
    await screen.findByText("Where is the offsite?");
    expect(client.createOrg).toHaveBeenCalledWith("Offsite");
    expect(client.createApp).toHaveBeenCalledWith("Offsite", "bundle-hash", { org: "org-1" });
    expect(client.view).toHaveBeenCalledWith("app-new", "listPolls", {});
    expect(screen.getByText("2 ballots")).toBeTruthy();
    expect(storage.getItem(selectionKey(LOCAL, ME))).toContain("app-new");

    fireEvent.click(screen.getByText("Create invite link"));
    await screen.findByText(/invite=tok-123&org=org-1/);
    expect(client.invite).toHaveBeenCalledWith("org-1", "member", expect.anything());
  });

  it("joins the roster with a name", async () => {
    const client = fakeClient([
      { appId: "app-1", name: "Board", owner: ME, org: "org-1", bundle: "bundle-hash", package: null, version: null },
    ]);
    const storage = new Memory();
    new SessionStore(APP, LOCAL, storage).save(SESSION);
    storage.setItem(selectionKey(LOCAL, ME), JSON.stringify({ appId: "app-1", name: "Board", org: "org-1" }));
    render(<App deps={deps(client)} storage={storage} />);

    await screen.findByText("Where is the offsite?");
    fireEvent.change(screen.getByLabelText("Your name"), { target: { value: "Alicia" } });
    fireEvent.click(screen.getByText("Rename"));
    await waitFor(() => expect(client.call).toHaveBeenCalledWith("app-1", "setName", { name: "Alicia" }));
  });

  it("restores the session and the group opened last time, and goes back to the picker", async () => {
    const client = fakeClient([
      { appId: "app-1", name: "Board", owner: ME, org: "org-1", bundle: "bundle-hash", package: null, version: null },
    ]);
    const storage = new Memory();
    new SessionStore(APP, LOCAL, storage).save(SESSION);
    storage.setItem(selectionKey(LOCAL, ME), JSON.stringify({ appId: "app-1", name: "Board", org: "org-1" }));
    render(<App deps={deps(client)} storage={storage} />);

    await screen.findByText("Where is the offsite?");
    expect(client.useSession).toHaveBeenCalledWith(SESSION);
    expect(client.signIn).not.toHaveBeenCalled();
    expect(client.events).toHaveBeenCalledWith("app-1", 0, expect.anything());

    fireEvent.click(screen.getByLabelText("Change group"));
    await screen.findByText("Choose a voting group");
    await screen.findByText("Board");
  });

  it("shows a signed-out visitor with an invitation an invitation page, and \"Not now\" keeps it", async () => {
    const client = fakeClient();
    const storage = new Memory();
    const invites = pendingIn(storage, { token: "tok-9" });
    render(<App deps={deps(client)} storage={storage} invites={invites} />);
    const page = await screen.findByTestId("invitation-page");
    expect(page.textContent).toContain(
      "You've been invited to join the voting group in Mero Vote.",
    );
    expect(screen.queryByText(/verifiable tallies/)).toBeNull();
    expect(screen.queryByRole("dialog")).toBeNull();

    fireEvent.click(screen.getByTestId("invitation-later"));
    await screen.findByText(/verifiable tallies/);
    expect(invites.token()).toBe("tok-9");
  });

  it("asks to join right after signing in, and redeems only on Join", async () => {
    const client = fakeClient();
    const storage = new Memory();
    const invites = pendingIn(storage, { token: "tok-9" });
    render(<App deps={deps(client)} storage={storage} invites={invites} />);
    await screen.findByText("You're invited");
    fireEvent.click(screen.getByTestId("signin-passkey"));
    fireEvent.click(await screen.findByTestId("invitation-join"));
    await screen.findByText(/Invitation accepted/);
    expect(client.redeemInvite).toHaveBeenCalledTimes(1);
    expect(client.redeemInvite).toHaveBeenCalledWith("tok-9");
    expect(invites.token()).toBeNull();
  });

  it("tells a member of the invited org they are already in it, without spending the invite", async () => {
    const client = fakeClient();
    Object.assign(client, { me: vi.fn(async () => ({ accountId: ME, orgs: [{ orgId: "org-1" }] })) });
    const storage = new Memory();
    const invites = pendingIn(storage, { token: "tok-9", org: "org-1" });
    new SessionStore(APP, LOCAL, storage).save(SESSION);
    render(<App deps={deps(client)} storage={storage} invites={invites} />);
    expect((await screen.findByTestId("invitation-outcome")).textContent).toContain(
      "You're already in the voting group",
    );
    expect(client.redeemInvite).not.toHaveBeenCalled();
    expect(invites.token()).toBeNull();
  });

  it("says plainly when the invite was already used or has expired", async () => {
    const refusing = fakeClient();
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

  it("logs out, forgetting the session and the open group", async () => {
    const client = fakeClient();
    const storage = new Memory();
    new SessionStore(APP, LOCAL, storage).save(SESSION);
    storage.setItem(selectionKey(LOCAL, ME), JSON.stringify({ appId: "app-1", name: "Board", org: "org-1" }));
    render(<App deps={deps(client)} storage={storage} />);
    await screen.findByText("Where is the offsite?");
    fireEvent.click(screen.getByTestId("logout-btn"));
    await screen.findByTestId("signin-passkey");
    expect(client.signOut).toHaveBeenCalled();
    expect(new SessionStore(APP, LOCAL, storage).load()).toBeNull();
    expect(storage.getItem(selectionKey(LOCAL, ME))).toBeNull();
  });

  describe("invitations land in the invited org", () => {
    /** Two shared voting groups in two orgs: the one opened last, and the one an invite is for. */
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

    it("joining opens the invited org's voting group, not the picker or the one open before", async () => {
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

    it("a member of the invited org lands in its voting group on Continue, without spending the invite", async () => {
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

    it("a newcomer who joined at sign-up lands in the invited org's voting group", async () => {
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

    it("an org with no voting group this member may add says to ask an owner", async () => {
      const client = fakeClient([]);
      client.redeemInvite.mockResolvedValue({ org: "org-2" });
      Object.assign(client, { getOrg: vi.fn(async () => ({ members: { "acct-alice": "member" } })) });
      const storage = new Memory();
      signedIn(storage, false);
      const invites = pendingIn(storage, { token: "tok-9" });
      render(<App deps={deps(client)} storage={storage} invites={invites} />);
      fireEvent.click(await screen.findByTestId("invitation-join"));
      await screen.findByText(/Only an owner or admin of this organization can add a voting group here/);
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
      fireEvent.click(screen.getByTestId("logout-btn"));
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
