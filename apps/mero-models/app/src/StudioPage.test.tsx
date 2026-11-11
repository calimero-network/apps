import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { MemoryRouter, Route, Routes } from "react-router-dom";
import { CalimeroError, type AppInfo, type CalimeroSession } from "@calimero-network/mero-js";
import { useState } from "react";
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

import { StudioPage } from "./StudioPage";
import { useScene } from "./scene";
import { migrateStoredInvite, selectionKey } from "./scenes";
import { APP, useSession, type SessionDeps } from "./session";
import { withRoutes } from "@calimero-apps/connect/testing";

// The modeller itself is three.js and WebGL; these tests are about getting to it.
vi.mock("./studio/Studio", () => ({
  Studio: ({ contextId }: { contextId: string }) => {
    const scene = useScene();
    return (
      <p>
        studio {contextId} in {scene.org ?? "no org"} as {scene.accountId}
      </p>
    );
  },
}));

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
const LOCAL: Target = resolveTarget(DEV_ENV);

/** An invite store on `storage` holding `invite`, as `main.tsx` leaves it after capturing a link. */
function pendingIn(storage: KeyValueStorage, invite: Partial<PendingInvite> & { token: string }): InviteStore {
  const invites = createInviteStore(APP, { storage });
  invites.put({ org: null, team: null, doc: null, route: null, extra: {}, ...invite });
  return invites;
}

function scene(appId: string, name: string, org: string | null = "org-1"): AppInfo {
  return { appId, name, owner: ME, org, bundle: "bundle-hash", package: null, version: null };
}

function fakeClient(apps: AppInfo[] = []) {
  let session: CalimeroSession | undefined;
  return {
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
    createOrg: vi.fn(async () => "org-new"),
    createApp: vi.fn(async (name: string) => {
      apps.push(scene("app-new", name, "org-new"));
      return "app-new";
    }),
    invite: vi.fn(async () => "tok-123"),
    redeemInvite: vi.fn(async () => ({})),
  };
}

function deps(client: ReturnType<typeof fakeClient>, storage: KeyValueStorage): SessionDeps {
  return {
    env: DEV_ENV,
    storage,
    makeClient: vi.fn(async () => withRoutes(client)),
    passkey: () => ({ create: vi.fn(), get: vi.fn() }),
  };
}

/** What `App` does around the studio page: the session, with the invite store and where a join lands. */
function Harness({ deps, storage, invites }: { deps: SessionDeps; storage: KeyValueStorage; invites: InviteStore }) {
  const [landing, setLanding] = useState<{ org: string | null } | null>(null);
  const api = useSession(deps, invites, (joined, pending) => setLanding({ org: joined.org ?? pending?.org ?? null }));
  return (
    <StudioPage api={api} deps={deps} storage={storage} invites={invites} landing={landing} setLanding={setLanding} />
  );
}

function renderPage(
  client: ReturnType<typeof fakeClient>,
  storage: KeyValueStorage = new Memory(),
  invites: InviteStore = createInviteStore(APP, { storage }),
) {
  const d = deps(client, storage);
  render(
    <MemoryRouter initialEntries={["/studio"]}>
      <Routes>
        <Route path="/studio" element={<Harness deps={d} storage={storage} invites={invites} />} />
        <Route path="/" element={<p>landing page</p>} />
      </Routes>
    </MemoryRouter>,
  );
  return storage;
}

describe("the studio's front door", () => {
  it("signs in with a passkey, lists the scenes, and opens one", async () => {
    const client = fakeClient([scene("app-2", "Robot"), scene("app-1", "Castle")]);
    const storage = renderPage(client);

    fireEvent.click(await screen.findByTestId("signin-passkey"));
    expect(await screen.findByText("Castle")).toBeTruthy();
    await waitFor(() => expect(client.listApps).toHaveBeenCalledWith({ bundle: "bundle-hash" }));
    // Sorted by name, and the studio they belong to listed once.
    const titles = screen.getAllByTestId("scene-item").map((b) => b.textContent);
    expect(titles[0]).toContain("Castle");
    expect(screen.getAllByText("org-1")).toHaveLength(1);

    fireEvent.click(screen.getByText("Robot"));
    expect(await screen.findByText(`studio app-2 in org-1 as ${ME}`)).toBeTruthy();
    // Remembered for this account on this target.
    const key = selectionKey(resolveTarget(DEV_ENV), ME);
    expect(JSON.parse(storage.getItem(key)!)).toEqual({ appId: "app-2", name: "Robot", org: "org-1" });
  });

  it("makes a new scene in a studio of its own", async () => {
    const client = fakeClient();
    renderPage(client);
    fireEvent.click(await screen.findByTestId("signin-passkey"));
    expect(await screen.findByText(/No scenes yet/)).toBeTruthy();
    fireEvent.change(screen.getByLabelText("Scene name"), { target: { value: "Spaceship" } });
    fireEvent.click(screen.getByTestId("new-scene"));
    expect(await screen.findByText(`studio app-new in org-new as ${ME}`)).toBeTruthy();
    expect(client.createOrg).toHaveBeenCalledWith("Spaceship");
    expect(client.createApp).toHaveBeenCalledWith("Spaceship", "bundle-hash", { org: "org-new" });
  });

  it("adds a scene to a studio it is already in", async () => {
    const client = fakeClient([scene("app-1", "Castle")]);
    renderPage(client);
    fireEvent.click(await screen.findByTestId("signin-passkey"));
    fireEvent.click(await screen.findByRole("button", { name: "Add scene" }));
    await waitFor(() => expect(client.createApp).toHaveBeenCalledWith("Untitled scene", "bundle-hash", { org: "org-1" }));
    expect(client.createOrg).not.toHaveBeenCalled();
  });

  it("shows a signed-out visitor with an invitation an invitation page, and \"Not now\" keeps it", async () => {
    const storage = new Memory();
    const invites = pendingIn(storage, { token: "tok-9" });
    renderPage(fakeClient(), storage, invites);
    const page = await screen.findByTestId("invitation-page");
    expect(page.textContent).toContain(
      "You've been invited to join the studio in Mero Models.",
    );
    expect(screen.getByTestId("signin-passkey")).toBeTruthy();
    expect(screen.getByTestId("signup-passkey")).toBeTruthy();

    fireEvent.click(screen.getByTestId("invitation-later"));
    expect(await screen.findByText("landing page")).toBeTruthy();
    expect(invites.token()).toBe("tok-9");
  });

  it("tells a member of the invited studio they are already in it, without spending the invite", async () => {
    const client = Object.assign(fakeClient(), {
      me: vi.fn(async () => ({ accountId: ME, orgs: [{ orgId: "org-1" }] })),
    });
    const storage = new Memory();
    const invites = pendingIn(storage, { token: "tok-9", org: "org-1" });
    renderPage(client, storage, invites);
    fireEvent.click(await screen.findByTestId("signin-passkey"));
    expect((await screen.findByTestId("invitation-outcome")).textContent).toContain("You're already in the studio");
    expect(client.redeemInvite).not.toHaveBeenCalled();
    expect(invites.token()).toBeNull();
  });

  it("says plainly when the invite was already used or has expired", async () => {
    const client = fakeClient();
    client.redeemInvite.mockRejectedValueOnce(new CalimeroError(404, "NOT_FOUND", "unknown invite"));
    const storage = new Memory();
    const invites = pendingIn(storage, { token: "tok-used" });
    renderPage(client, storage, invites);
    fireEvent.click(await screen.findByTestId("signin-passkey"));
    fireEvent.click(await screen.findByTestId("invitation-join"));
    expect(
      await screen.findByText(
        "This invite was already used or has expired. Ask the person who invited you for a new link.",
      ),
    ).toBeTruthy();
    expect(invites.token()).toBeNull();
  });

  it("asks to join right after signing in from the invitation page, and redeems only on Join", async () => {
    const client = fakeClient();
    const storage = new Memory();
    const invites = pendingIn(storage, { token: "tok-9" });
    renderPage(client, storage, invites);
    expect(await screen.findByText("You're invited")).toBeTruthy();
    fireEvent.click(screen.getByTestId("signin-passkey"));
    fireEvent.click(await screen.findByTestId("invitation-join"));
    expect(await screen.findByText(/Invitation accepted/)).toBeTruthy();
    expect(client.redeemInvite).toHaveBeenCalledWith("tok-9");
    expect(invites.token()).toBeNull();
  });

  it("creates an account with a new passkey, no name needed", async () => {
    const client = fakeClient();
    renderPage(client);
    fireEvent.click(await screen.findByTestId("signup-passkey"));
    await waitFor(() => expect(client.signUp).toHaveBeenCalledWith(expect.anything(), ""));
  });

  describe("invitations land in the invited studio", () => {
    /** Two shared scenes in two orgs: the one opened last, and the one an invite is for. */
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

    it("joining opens the invited org's scene, not the picker or the one open before", async () => {
      const client = fakeClient([...TWO_ORGS]);
      client.redeemInvite.mockResolvedValue({ org: "org-2" });
      const storage = new Memory();
      signedIn(storage);
      const invites = pendingIn(storage, { token: "tok-9" });
      renderPage(client, storage, invites);
      fireEvent.click(await screen.findByTestId("invitation-join"));
      await waitFor(() => expect(selected(storage)).toBe("app-b"));
      expect(client.redeemInvite).toHaveBeenCalledWith("tok-9");
      expect(invites.token()).toBeNull();
    });

    it("a member of the invited org lands in its scene on Continue, without spending the invite", async () => {
      const client = fakeClient([...TWO_ORGS]);
      Object.assign(client, { me: vi.fn(async () => ({ accountId: "acct-alice", orgs: [{ orgId: "org-2" }] })) });
      const storage = new Memory();
      signedIn(storage);
      const invites = pendingIn(storage, { token: "tok-9", org: "org-2" });
      renderPage(client, storage, invites);
      await screen.findByTestId("invitation-outcome");
      fireEvent.click(screen.getByTestId("invitation-continue"));
      await waitFor(() => expect(selected(storage)).toBe("app-b"));
      expect(client.redeemInvite).not.toHaveBeenCalled();
      expect(invites.token()).toBeNull();
    });

    it("a newcomer who joined at sign-up lands in the invited org's scene", async () => {
      const client = fakeClient([...TWO_ORGS]);
      // The node names the org a sign-up joined in its answer.
      const signUp = client.signUp.getMockImplementation()!;
      client.signUp.mockImplementation(async () => ({ ...(await signUp()), org: "org-2" }));
      const storage = new Memory();
      const invites = pendingIn(storage, { token: "tok-9", org: "org-2" });
      renderPage(client, storage, invites);
      fireEvent.click(await screen.findByTestId("signup-passkey"));
      await waitFor(() => expect(client.signUp).toHaveBeenCalledWith(expect.anything(), "", { invite: "tok-9" }));
      await waitFor(() => expect(selected(storage)).toBe("app-b"));
      expect(client.redeemInvite).not.toHaveBeenCalled();
      expect(invites.token()).toBeNull();
    });

    it("an org with no scene this member may add says to ask an owner", async () => {
      const client = fakeClient([]);
      client.redeemInvite.mockResolvedValue({ org: "org-2" });
      Object.assign(client, { getOrg: vi.fn(async () => ({ members: { "acct-alice": "member" } })) });
      const storage = new Memory();
      signedIn(storage, false);
      const invites = pendingIn(storage, { token: "tok-9" });
      renderPage(client, storage, invites);
      fireEvent.click(await screen.findByTestId("invitation-join"));
      await screen.findByText(/Only an owner or admin of this organization can add a scene here/);
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
      renderPage(client, storage, invites);
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
      renderPage(client, storage, invites);
      await screen.findByTestId("invitation-join");
      fireEvent.click(screen.getByText("Log out"));
      await screen.findByTestId("signin-passkey");
      expect(invites.token()).toBeNull();
      expect(screen.queryByTestId("invitation-page")).toBeNull();
    });

    it("a member who may not add a scene to a studio is told to ask an owner instead", async () => {
      const client = fakeClient([...TWO_ORGS]);
      Object.assign(client, {
        getOrg: vi.fn(async (org: string) =>
          org === "org-2" ? { members: { "acct-alice": "member" } } : { members: { "acct-alice": "owner" } },
        ),
      });
      const storage = new Memory();
      signedIn(storage, false);
      renderPage(client, storage);
      await screen.findByTestId("ask-an-owner");
      expect(screen.getByTestId("ask-an-owner").textContent).toContain(
        "Only an owner or admin of this organization can add a scene here",
      );
      // The studio this account owns keeps its button.
      expect(screen.getAllByText("Add scene")).toHaveLength(1);
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
