import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import {
  CalimeroError,
  DEFAULT_ORG_CAPABILITIES,
  ORG_CAPABILITIES,
  type AppInfo,
  type CalimeroSession,
} from "@calimero-network/mero-js";
import { SessionStore, resolveTarget, type KeyValueStorage } from "@calimero-apps/connect";
import { MemoryRouter } from "react-router-dom";
import { afterEach, beforeAll, describe, expect, it, vi } from "vitest";
import App from "./App";
import { SessionProvider } from "./SessionProvider";
import { ToastProvider } from "./contexts/ToastContext";
import { MEMBER_DEFAULTS, dropInvite, inviteLink, migrateLegacyInvite, pendingInvite } from "./lib/streams";

/** Hold an invite stored the way an earlier build stored it: it moves into the shared store. */
function hold(legacy: string) {
  localStorage.setItem("mero-stream:pending-invite", legacy);
  migrateLegacyInvite();
}
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
  window.matchMedia ??= ((q: string) => ({
    matches: false,
    media: q,
    onchange: null,
    addListener: () => {},
    removeListener: () => {},
    addEventListener: () => {},
    removeEventListener: () => {},
    dispatchEvent: () => false,
  })) as typeof window.matchMedia;
  HTMLDialogElement.prototype.showModal ??= function (this: HTMLDialogElement) {
    this.open = true;
  };
  HTMLDialogElement.prototype.close ??= function (this: HTMLDialogElement) {
    this.open = false;
  };
});

afterEach(() => {
  cleanup();
  localStorage.clear();
  dropInvite();
});

const SESSION: CalimeroSession = {
  accountId: "acct-alice",
  sessionToken: "s",
  refreshToken: "r",
  expiresAt: 9e12,
};

function fakeClient() {
  let session: CalimeroSession | undefined;
  const apps: AppInfo[] = [];
  const orgs: { orgId: string; name: string; role: string }[] = [];
  // org -> account -> member metadata, as `setMemberMetadata` leaves it.
  const meta: Record<string, Record<string, Record<string, unknown>>> = {};
  /** The org's member defaults as the node keeps them (`setCapabilities` without `at`). */
  const defaults = new Map<string, number>();
  const metadata = new Map<string, unknown>();
  const room = (app: string) => ({ appId: app, name: app, owner: "acct-alice", org: "org-1", bundle: "b", package: null, version: null });
  return withRoutes({
    apps,
    orgs,
    meta,
    room,
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
    me: vi.fn(async () => ({ accountId: "acct-alice", orgs })),
    getOrg: vi.fn(async (org: string): Promise<Record<string, unknown>> => ({
      name: orgs.find((o) => o.orgId === org)?.name ?? "Stream",
      members: { "acct-alice": "owner" },
      memberMetadata: meta[org] ?? {},
      defaultCapabilities: defaults.get(org) ?? DEFAULT_ORG_CAPABILITIES,
      metadata: metadata.get(org) ?? null,
    })),
    setOrgMetadata: vi.fn(async (org: string, m: unknown) => {
      metadata.set(org, m);
    }),
    setCapabilities: vi.fn(async (org: string, caps: number, _pk: unknown, at?: { account?: string }) => {
      if (!at?.account) defaults.set(org, caps);
    }),
    listApps: vi.fn(async (f?: { bundle?: string }) => apps.filter((a) => !f?.bundle || a.bundle === f.bundle)),
    getApp: vi.fn(async (app: string) => ({ appId: app })),
    createOrg: vi.fn(async (name: string) => {
      orgs.push({ orgId: "org-1", name, role: "Owner" });
      return "org-1";
    }),
    createApp: vi.fn(async (name: string) => {
      apps.push({ ...room("app-1"), name });
      return "app-1";
    }),
    call: vi.fn(async (_app: string, method: string, args: Record<string, unknown>) => ({
      index: 2,
      result:
        method === "join"
          ? { memberId: "acct-alice", username: args.username, joinedAt: args.now, updatedAt: args.now }
          : null,
      events: [],
    })),
    view: vi.fn(async (_app: string, method: string) => ({
      index: 1,
      result:
        method === "getStats"
          ? { name: "", memberCount: 0, liveFragments: 0, nextSeq: "0", oldestLiveSeq: "0", prunedFrames: "0" }
          : [],
    })),
    events: vi.fn(async function* () {}),
    publishPresence: vi.fn(async () => {}),
    presenceStream: vi.fn(async function* () {}),
    invite: vi.fn(async () => "tok-123"),
    redeemInvite: vi.fn(async () => ({})),
    setMemberMetadata: vi.fn(async (org: string, account: string, m: Record<string, unknown>) => {
      meta[org] = { ...meta[org], [account]: m };
    }),
  });
}

const ENV = { DEV: true, VITE_CALIMERO_BUNDLE: "b" };

function renderApp(client: ReturnType<typeof fakeClient>, path: string, signedIn = false) {
  const storage = new Memory();
  if (signedIn) new SessionStore(APP, resolveTarget(ENV), storage).save(SESSION);
  const deps: SessionDeps = {
    env: ENV,
    makeClient: vi.fn(async () => withRoutes(client)),
    passkey: () => ({ create: vi.fn(), get: vi.fn() }) as never,
    storage,
  };
  return render(
    <SessionProvider deps={deps}>
      <MemoryRouter initialEntries={[path]}>
        <ToastProvider>
          <App />
        </ToastProvider>
      </MemoryRouter>
    </SessionProvider>,
  );
}

describe("App", () => {
  it("signs up with a passkey and creates a stream (an org), then a room in it (an app instance)", async () => {
    const client = fakeClient();
    renderApp(client, "/streams");

    // Signed out: the landing page; its connect opens the passkey sign-in.
    fireEvent.click((await screen.findAllByText(/^Sign in$/))[0]);
    fireEvent.click(await screen.findByTestId("signup-passkey"));
    await screen.findByText("Your streams");
    expect(client.signUp).toHaveBeenCalledWith(expect.anything(), "");
    await screen.findByTestId("streams-empty");

    fireEvent.change(screen.getByTestId("stream-name-input"), { target: { value: "Team" } });
    // Your name in the stream is asked with it, once.
    expect((screen.getByTestId("create-stream") as HTMLButtonElement).disabled).toBe(true);
    fireEvent.change(screen.getByTestId("stream-self-name-input"), { target: { value: "Alice" } });
    fireEvent.click(screen.getByTestId("create-stream"));
    await waitFor(() => expect(client.createOrg).toHaveBeenCalledWith("Team"));
    await waitFor(() =>
      expect(client.setMemberMetadata).toHaveBeenCalledWith("org-1", "acct-alice", { name: "Alice" }),
    );
    // Its members may create rooms: the org's default, with the owner's passkey.
    await waitFor(() =>
      expect(client.setCapabilities).toHaveBeenCalledWith("org-1", MEMBER_DEFAULTS, expect.anything()),
    );
    await screen.findByText("No rooms in this stream");

    fireEvent.change(screen.getByTestId("room-name-input"), { target: { value: "Standup" } });
    fireEvent.click(screen.getByTestId("create-room"));
    await waitFor(() =>
      expect(client.createApp).toHaveBeenCalledWith("Standup", "b", {
        org: "org-1",
        initArgs: { name: "Standup" },
      }),
    );
    // Into the call, which joins the room's contract with the stream's name,
    // without asking for it again.
    await waitFor(() =>
      expect(client.call).toHaveBeenCalledWith(
        "app-1",
        "join",
        expect.objectContaining({ username: "Alice" }),
      ),
    );
    expect(client.call).not.toHaveBeenCalledWith("app-1", "join", expect.objectContaining({ username: "guest" }));
    expect((screen.getByTestId("people-dialog") as HTMLDialogElement).open).toBe(false);
  });

  it("asks once, for the stream, when a room opens in a stream with no name for you", async () => {
    const client = fakeClient();
    client.orgs.push({ orgId: "org-1", name: "Team", role: "Owner" });
    client.apps.push(client.room("app-1"));
    localStorage.setItem("calimero-names:last", "Alice from Globex");
    // An already-member's room link: opened, not redeemed.
    hold(JSON.stringify({ token: "tok-9", stream: "org-1", room: "app-1", name: "Standup" }));
    renderApp(client, "/streams", true);
    fireEvent.click(await screen.findByTestId("invitation-open"));
    await waitFor(() =>
      expect(client.call).toHaveBeenCalledWith("app-1", "join", expect.objectContaining({ username: "guest" })),
    );
    await waitFor(() => expect((screen.getByTestId("people-dialog") as HTMLDialogElement).open).toBe(true));
    const input = screen.getByTestId("username-input") as HTMLInputElement;
    expect(input.value).toBe("Alice from Globex");
    fireEvent.click(screen.getByTestId("username-submit"));
    await waitFor(() =>
      expect(client.setMemberMetadata).toHaveBeenCalledWith("org-1", "acct-alice", { name: "Alice from Globex" }),
    );
    await waitFor(() =>
      expect(client.call).toHaveBeenCalledWith(
        "app-1",
        "join",
        expect.objectContaining({ username: "Alice from Globex" }),
      ),
    );
  });

  it("does not list an org made for another app; connects it on request by creating a room there", async () => {
    const client = fakeClient();
    client.orgs.push({ orgId: "ow", name: "overworld", role: "Owner" });
    client.apps.push({ appId: "w1", name: "overworld", owner: "acct-alice", org: "ow", bundle: "blocks", package: "com.calimero.mero-blocks", version: null });
    renderApp(client, "/streams", true);
    await screen.findByTestId("streams-empty");
    expect(screen.queryByTestId("connect-org-ow")).toBeNull();
    fireEvent.click(screen.getByTestId("connect-existing-org"));
    const choice = await screen.findByTestId("connect-org-ow");
    expect(choice.textContent).toContain("Mero Blocks: overworld");
    fireEvent.click(choice);
    await waitFor(() =>
      expect(client.createApp).toHaveBeenCalledWith("General", "b", { org: "ow", initArgs: { name: "General" } }),
    );
    expect(client.createOrg).not.toHaveBeenCalled();
  });

  it("invites to a stream with a passkey approval and shows the link", async () => {
    const client = fakeClient();
    client.orgs.push({ orgId: "org-1", name: "Team", role: "Owner" });
    client.apps.push(client.room("app-1"));
    renderApp(client, "/streams/org-1", true);

    await screen.findByText("1 room");
    fireEvent.click(screen.getByTestId("invite-namespace"));
    const link = await screen.findByTestId("invite-link");
    expect(client.invite).toHaveBeenCalledWith("org-1", "member", expect.anything());
    expect(link.textContent).toContain("invite=tok-123");
    expect(link.textContent).toContain("org=org-1");
  });

  it("signed out with a pending invite, shows the invitation page instead of the landing page", async () => {
    hold(JSON.stringify({ token: "tok-9", stream: "org-1", room: null, name: "Team" }));
    renderApp(fakeClient(), "/streams/org-1");
    await screen.findByText("You're invited");
    expect(screen.getByTestId("signup-passkey")).toBeTruthy();
    expect(screen.getByTestId("signin-passkey")).toBeTruthy();
    expect(document.querySelector(".cal-lp-root")).toBeNull();
  });

  it("\"Not now\" on the invitation page shows the landing page and keeps the token", async () => {
    hold(JSON.stringify({ token: "tok-9", stream: "org-1", room: null, name: "Team" }));
    renderApp(fakeClient(), "/");
    fireEvent.click(await screen.findByTestId("invitation-not-now"));
    await waitFor(() => expect(document.querySelector(".cal-lp-root")).not.toBeNull());
    expect(pendingInvite()).not.toBeNull();
  });

  it("does not redeem an invite into a stream the account is already in", async () => {
    const client = fakeClient();
    client.orgs.push({ orgId: "org-1", name: "Team", role: "Owner" });
    hold(JSON.stringify({ token: "tok-9", stream: "org-1", room: null, name: "Team" }));
    renderApp(client, "/streams", true);
    await screen.findByTestId("invitation-member");
    expect(screen.getByText("You're already in this stream")).toBeTruthy();
    expect(client.redeemInvite).not.toHaveBeenCalled();
    expect(pendingInvite()).toBeNull();
  });

  it("says plainly when the invite was already used or has expired", async () => {
    const client = fakeClient();
    client.redeemInvite.mockRejectedValueOnce(new CalimeroError(404, "NOT_FOUND", "unknown invite"));
    hold(JSON.stringify({ token: "tok-9", stream: "org-1", room: null, name: "Team" }));
    renderApp(client, "/streams", true);
    fireEvent.click(await screen.findByTestId("invitation-join"));
    expect((await screen.findByTestId("invitation-error")).textContent).toBe(
      "This invite was already used or has expired. Ask the person who invited you for a new link.",
    );
    expect(pendingInvite()).toBeNull();
  });

  it.each([
    [429, "RATE_LIMITED", /Too many tries/],
    [401, "UNAUTHENTICATED", /sign in again/],
  ])("keeps the invite when redeeming answers %i, and says to try again (B6)", async (status, code, says) => {
    const client = fakeClient();
    client.redeemInvite.mockRejectedValueOnce(new CalimeroError(status, code, "not now"));
    hold(JSON.stringify({ token: "tok-9", stream: "org-1", room: null, name: "Team" }));
    renderApp(client, "/streams", true);
    fireEvent.click(await screen.findByTestId("invitation-join"));
    expect((await screen.findByTestId("invitation-error")).textContent).toMatch(says);
    expect(pendingInvite()?.token).toBe("tok-9");
    expect(screen.getByTestId("invitation-join")).toBeTruthy();
  });

  it("redeems an opened room invitation after sign-in and opens that room", async () => {
    const client = fakeClient();
    client.apps.push(client.room("app-1"));
    // Not a member until the invitation is redeemed.
    client.redeemInvite.mockImplementation(async () => {
      client.orgs.push({ orgId: "org-1", name: "Team", role: "Member" });
      return {};
    });
    hold(JSON.stringify({ token: "tok-9", stream: "org-1", room: "app-1", name: "Standup" }));
    renderApp(client, "/");

    await screen.findByText("You're invited");
    fireEvent.click(await screen.findByTestId("signin-passkey"));
    fireEvent.click(await screen.findByTestId("invitation-join"));
    await waitFor(() => expect(client.redeemInvite).toHaveBeenCalledWith("tok-9"));
    // Joined a stream with no name for you: asked once, then into the room
    // with it.
    fireEvent.change(await screen.findByTestId("invitation-name-input"), { target: { value: "Alice" } });
    fireEvent.click(screen.getByTestId("invitation-name-save"));
    await waitFor(() =>
      expect(client.setMemberMetadata).toHaveBeenCalledWith("org-1", "acct-alice", { name: "Alice" }),
    );
    await waitFor(() =>
      expect(client.call).toHaveBeenCalledWith("app-1", "join", expect.objectContaining({ username: "Alice" })),
    );
    expect(pendingInvite()).toBeNull();
  });

  it("joining a stream that already has your name does not ask for it", async () => {
    const client = fakeClient();
    client.apps.push(client.room("app-1"));
    client.meta["org-1"] = { "acct-alice": { name: "Alice" } };
    client.redeemInvite.mockImplementation(async () => {
      client.orgs.push({ orgId: "org-1", name: "Team", role: "Member" });
      return {};
    });
    hold(JSON.stringify({ token: "tok-9", stream: "org-1", room: "app-1", name: "Standup" }));
    renderApp(client, "/streams", true);
    fireEvent.click(await screen.findByTestId("invitation-join"));
    await waitFor(() =>
      expect(client.call).toHaveBeenCalledWith("app-1", "join", expect.objectContaining({ username: "Alice" })),
    );
    expect(screen.queryByTestId("invitation-name")).toBeNull();
    expect(client.setMemberMetadata).not.toHaveBeenCalled();
  });

  it("an invited newcomer creates the account and joins in one click, and lands in the room", async () => {
    const client = fakeClient();
    client.apps.push(client.room("app-1"));
    // The sign-up that carries the invite joins its stream.
    client.signUp.mockImplementation(async (...args: unknown[]) => {
      if ((args[2] as { invite?: string } | undefined)?.invite) {
        client.orgs.push({ orgId: "org-1", name: "Team", role: "Member" });
      }
      return SESSION;
    });
    hold(JSON.stringify({ token: "tok-9", stream: "org-1", room: "app-1", name: "Standup" }));
    renderApp(client, "/");

    const create = await screen.findByTestId("signup-passkey");
    expect(create.textContent).toBe("Create your account and join the stream");
    fireEvent.click(create);
    await waitFor(() => expect(client.signUp).toHaveBeenCalledWith(expect.anything(), "", { invite: "tok-9" }));
    await waitFor(() =>
      expect(client.call).toHaveBeenCalledWith("app-1", "join", expect.anything()),
    );
    expect(client.signIn).not.toHaveBeenCalled();
    expect(client.redeemInvite).not.toHaveBeenCalled();
    expect(screen.queryByTestId("invitation-prompt")).toBeNull();
    expect(pendingInvite()).toBeNull();
  });

  /** Alice as a plain member of org-1, whose org's member defaults are `defaultCapabilities` (core's own unless set). */
  function asMember(defaultCapabilities = DEFAULT_ORG_CAPABILITIES) {
    const client = fakeClient();
    client.orgs.push({ orgId: "org-1", name: "Team", role: "Member" });
    client.getOrg.mockImplementation(async () => ({
      name: "Team",
      members: { "acct-alice": "member", "acct-bob": "owner" },
      memberMetadata: {},
      defaultCapabilities,
    }));
    return client;
  }

  it("offers Create room to a member of a stream made here (members may create rooms)", async () => {
    const client = asMember(MEMBER_DEFAULTS);
    renderApp(client, "/streams/org-1", true);
    expect(await screen.findByTestId("create-room")).toBeTruthy();
    expect(screen.queryByTestId("create-room-ask")).toBeNull();
    // Only an owner or admin changes the stream's setting.
    expect(screen.queryByTestId("members-create-rooms")).toBeNull();
  });

  it("tells a member of a stream with the default off to ask an owner", async () => {
    const client = asMember(DEFAULT_ORG_CAPABILITIES & ~ORG_CAPABILITIES.CREATE_APP);
    renderApp(client, "/streams/org-1", true);
    expect((await screen.findByTestId("create-room-ask")).textContent).toMatch(/Only an owner or admin/);
    expect(screen.queryByTestId("create-room")).toBeNull();
  });

  it("lets the owner turn \"Members can create rooms\" off and on, with a passkey approval", async () => {
    const client = fakeClient();
    client.orgs.push({ orgId: "org-1", name: "Team", role: "Owner" });
    await client.setCapabilities("org-1", MEMBER_DEFAULTS, null);
    client.setCapabilities.mockClear();
    renderApp(client, "/streams/org-1", true);

    const toggle = (await screen.findByTestId("members-create-rooms")) as HTMLInputElement;
    await waitFor(() => expect(toggle.checked).toBe(true));
    fireEvent.click(toggle);
    await waitFor(() =>
      expect(client.setCapabilities).toHaveBeenCalledWith(
        "org-1",
        MEMBER_DEFAULTS & ~ORG_CAPABILITIES.CREATE_APP,
        expect.anything(),
      ),
    );
    await waitFor(() => expect(toggle.checked).toBe(false));
    fireEvent.click(toggle);
    await waitFor(() =>
      expect(client.setCapabilities).toHaveBeenLastCalledWith("org-1", MEMBER_DEFAULTS, expect.anything()),
    );
    await waitFor(() => expect(toggle.checked).toBe(true));
  });

  it("tells a member who may not add a room to ask an owner, instead of offering Create room (B8)", async () => {
    // A stream made before member defaults: a plain member has no CREATE_APP.
    const client = asMember();
    renderApp(client, "/streams/org-1", true);
    expect((await screen.findByTestId("create-room-ask")).textContent).toMatch(/Only an owner or admin/);
    expect(screen.queryByTestId("create-room")).toBeNull();
    expect(screen.queryByText(/Create one above/)).toBeNull();
  });

  it("still offers Create room to the stream's owner", async () => {
    const client = fakeClient();
    client.orgs.push({ orgId: "org-1", name: "Team", role: "Owner" });
    renderApp(client, "/streams/org-1", true);
    expect(await screen.findByTestId("create-room")).toBeTruthy();
    expect(screen.queryByTestId("create-room-ask")).toBeNull();
  });

  it("builds invitation links on this frontend's own origin", () => {
    expect(
      inviteLink("t", { stream: "o" }, { href: "https://x.apps.calimero.network/streams" }),
    ).toBe("https://x.apps.calimero.network/?invite=t&org=o");
  });
});
