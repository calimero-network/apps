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
import { migrateStoredInvite, selectionKey } from "./groups";
import type { SessionDeps } from "./session";
import { APP } from "./session";
import { withRoutes } from "@calimero-apps/connect/testing";

beforeEach(() => {
  JOINED_ORG = "org-1";
});

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
    makeClient: vi.fn(async () => withRoutes(client)),
    passkey: () => ({ create: vi.fn(), get: vi.fn() }),
  };
}

// The shared dialog is mero-react"s to test: here only what the app hands it and does after.
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
              { "data-testid": "create-done", onClick: () => p.onCreated({ orgId: "org-1", name: "Offsite", selfName: "Alice" }) },
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
let JOINED_ORG = "org-1";

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
    const open = await screen.findByRole("link", { name: "Open Hyperfeed Vote" });
    // The node-served copy: mdma's `app_host.app_url("com.calimero.mero-vote")`.
    expect(open.getAttribute("href")).toBe("https://qpe2mqkuj625tmvqshuqe4n5mz5plntrdqnltdbahtprjk42hsta.apps.calimero.network/");
    expect(screen.getByRole("link", { name: "Deploy your own on Calimero Cloud" }).getAttribute("href")).toBe(
      "https://cloud.calimero.network/deploy",
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

    // The org, its name and yours come from the shared dialog.
    fireEvent.click(screen.getByText("Create voting group"));
    expect(JSON.parse((await screen.findByTestId("create-release")).textContent ?? "null")).toEqual({ package: "com.calimero.mero-vote" });
    fireEvent.click(screen.getByTestId("create-done"));
    await screen.findByText("Where is the offsite?");
    expect(client.createOrg).not.toHaveBeenCalled();
    expect(client.createApp).toHaveBeenCalledWith("Offsite", "bundle-hash", { org: "org-1" });
    expect(client.view).toHaveBeenCalledWith("app-new", "listPolls", {});
    expect(screen.getByText("2 ballots")).toBeTruthy();
    expect(storage.getItem(selectionKey(LOCAL, ME))).toContain("app-new");

    fireEvent.click(screen.getByRole("button", { name: "Invite" }));
    expect(screen.getByTestId("invite-title").textContent).toBe("Invite to this group");
    const dialog = screen.getByTestId("invite-dialog");
    expect(dialog.dataset.org).toBe("org-1");
    expect(dialog.dataset.noun).toBe("group");
    expect(new URL(dialog.dataset.base ?? "").searchParams.toString()).toBe("org=org-1");
    fireEvent.click(screen.getByTestId("invite-done"));
    expect(client.invite).not.toHaveBeenCalled();
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
    // From the log's head: what is committed is read, not replayed.
    await waitFor(() => expect(client.events).toHaveBeenCalledWith("app-1", 2, expect.anything()));

    fireEvent.click(screen.getByLabelText("Change group"));
    await screen.findByText("Choose a voting group");
    await screen.findByText("Board");
  });

  it("closes a group that no longer admits the account, back to the picker", async () => {
    const client = fakeClient([
      { appId: "app-1", name: "Board", owner: ME, org: "org-1", bundle: "bundle-hash", package: null, version: null },
    ]);
    client.events = vi.fn(() => ({
      [Symbol.asyncIterator]: () => ({ next: () => Promise.reject(new NotFound("not found")) }),
    })) as unknown as typeof client.events;
    const storage = new Memory();
    new SessionStore(APP, LOCAL, storage).save(SESSION);
    storage.setItem(selectionKey(LOCAL, ME), JSON.stringify({ appId: "app-1", name: "Board", org: "org-1" }));
    render(<App deps={deps(client)} storage={storage} />);

    await screen.findByText("You no longer have access to that voting group.");
    await screen.findByText("Choose a voting group");
    expect(storage.getItem(selectionKey(LOCAL, ME))).toBeNull();
  });

  it("closes the group when its stream ends and the node then refuses a read", async () => {
    const client = fakeClient([
      { appId: "app-1", name: "Board", owner: ME, org: "org-1", bundle: "bundle-hash", package: null, version: null },
    ]);
    // Taken out of the org: the stream just ends, and every read is refused.
    client.view = vi.fn(async (_app: string, method: string) => {
      if (method === "whoami") return { index: 1, result: VIEWS[method] ?? null };
      throw new NotFound("no such app");
    }) as unknown as typeof client.view;
    const storage = new Memory();
    new SessionStore(APP, LOCAL, storage).save(SESSION);
    storage.setItem(selectionKey(LOCAL, ME), JSON.stringify({ appId: "app-1", name: "Board", org: "org-1" }));
    render(<App deps={deps(client)} storage={storage} />);

    await screen.findByText("You no longer have access to that voting group.");
    expect(storage.getItem(selectionKey(LOCAL, ME))).toBeNull();
  });

  it("shows a signed-out visitor with an invitation an invitation page, and \"Not now\" keeps it", async () => {
    const client = fakeClient();
    const storage = new Memory();
    const invites = pendingIn(storage, { token: "tok-9" });
    render(<App deps={deps(client)} storage={storage} invites={invites} />);
    const page = await screen.findByTestId("invitation-page");
    expect(page.textContent).toContain(
      "You've been invited to join the voting group in Hyperfeed Vote.",
    );
    expect(screen.queryByText(/verifiable tallies/)).toBeNull();
    expect(screen.queryByRole("dialog")).toBeNull();

    fireEvent.click(screen.getByTestId("invitation-later"));
    await screen.findByText(/verifiable tallies/);
    expect(invites.token()).toBe("tok-9");
  });

  it("asks to join right after signing in, and joins only on Join", async () => {
    const client = fakeClient();
    const storage = new Memory();
    const invites = pendingIn(storage, { token: "tok-9" });
    render(<App deps={deps(client)} storage={storage} invites={invites} />);
    await screen.findByText("You're invited");
    fireEvent.click(screen.getByTestId("signin-passkey"));
    expect((await screen.findByTestId("accept-dialog")).dataset.token).toBe("tok-9");
    expect(invites.token()).toBe("tok-9");
    fireEvent.click(screen.getByTestId("accept-done"));
    await screen.findByText(/Invitation accepted/);
    expect(invites.token()).toBeNull();
  });

  it("says the person is already in when they continue as a member", async () => {
    const client = fakeClient();
    const storage = new Memory();
    const invites = pendingIn(storage, { token: "tok-9" });
    render(<App deps={deps(client)} storage={storage} invites={invites} />);
    fireEvent.click(await screen.findByTestId("signin-passkey"));
    fireEvent.click(await screen.findByTestId("accept-member"));
    await screen.findByText("You're already in this voting group.");
    expect(screen.queryByText(/Invitation accepted/)).toBeNull();
  });

  it("hands the accept dialog the link's org and the group wording", async () => {
    const client = fakeClient();
    const storage = new Memory();
    const invites = pendingIn(storage, { token: "tok-9", org: "org-1" });
    new SessionStore(APP, LOCAL, storage).save(SESSION);
    render(<App deps={deps(client)} storage={storage} invites={invites} />);
    const dialog = await screen.findByTestId("accept-dialog");
    expect(dialog.dataset).toMatchObject({ org: "org-1", noun: "group" });
  });

  it("forgets a spent link when the node refuses it, and keeps the dialog open", async () => {
    const client = fakeClient();
    const storage = new Memory();
    const invites = pendingIn(storage, { token: "tok-9", org: "org-1" });
    new SessionStore(APP, LOCAL, storage).save(SESSION);
    render(<App deps={deps(client)} storage={storage} invites={invites} />);
    fireEvent.click(await screen.findByTestId("accept-fail"));
    expect(invites.token()).toBeNull();
    expect(screen.getByTestId("accept-dialog")).toBeTruthy();
  });

  it("closing the accept dialog joins nothing and forgets the invite", async () => {
    const client = fakeClient();
    const storage = new Memory();
    const invites = pendingIn(storage, { token: "tok-9" });
    new SessionStore(APP, LOCAL, storage).save(SESSION);
    render(<App deps={deps(client)} storage={storage} invites={invites} />);
    fireEvent.click(await screen.findByTestId("accept-close"));
    await waitFor(() => expect(invites.token()).toBeNull());
    expect(screen.queryByTestId("accept-dialog")).toBeNull();
    expect(client.redeemInvite).not.toHaveBeenCalled();
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
      JOINED_ORG = "org-2";
      Object.assign(client, { getOrg: vi.fn(async () => ({ members: { "acct-alice": "member" } })) });
      const storage = new Memory();
      signedIn(storage, false);
      const invites = pendingIn(storage, { token: "tok-9" });
      render(<App deps={deps(client)} storage={storage} invites={invites} />);
      fireEvent.click(await screen.findByTestId("accept-done"));
      await screen.findByText(/Only an owner or admin of this organization can add a voting group here/);
    });

    it("signing out drops the pending invite, so the next person is not asked to join", async () => {
      const client = fakeClient([...TWO_ORGS]);
      const storage = new Memory();
      signedIn(storage);
      const invites = pendingIn(storage, { token: "tok-9" });
      render(<App deps={deps(client)} storage={storage} invites={invites} />);
      await screen.findByTestId("accept-dialog");
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
