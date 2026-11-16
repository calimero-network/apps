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
              { "data-testid": "create-done", onClick: () => p.onCreated({ orgId: "org-1", name: "Team", selfName: "Alice" }) },
              "done",
            ),
          )
        : null,
    InviteDialog: (p: { open: boolean; org: string; teams?: string[]; appName?: string; linkBase?: string; labels?: { noun?: string; title?: string; note?: string }; onClose: () => void }) =>
      p.open
        ? createElement(
            "div",
            { "data-testid": "invite-dialog" },
            createElement("h2", { "data-testid": "invite-title" }, p.labels?.title),
            createElement("p", { "data-testid": "invite-labels" }, JSON.stringify({ noun: p.labels?.noun, note: p.labels?.note })),
            createElement("pre", { "data-testid": "invite-props" }, JSON.stringify({ org: p.org, teams: p.teams, appName: p.appName, linkBase: p.linkBase })),
            createElement("button", { "data-testid": "invite-close", onClick: p.onClose }, "close"),
          )
        : null,
    AcceptInviteDialog: (p: { open: boolean; token: string; org?: string; appName?: string; labels?: { noun?: string; title?: string; body?: string }; onClose: () => void; onError?: (e: unknown) => void; onJoined: (j: { org: string }) => void }) =>
      p.open
        ? createElement(
            "div",
            { "data-testid": "accept-dialog" },
            createElement("pre", { "data-testid": "accept-props" }, JSON.stringify({ token: p.token, org: p.org, appName: p.appName, labels: p.labels })),
            createElement("button", { "data-testid": "accept-done", onClick: () => p.onJoined({ org: "org-1" }) }, "join"),
            createElement("button", { "data-testid": "accept-close", onClick: p.onClose }, "close"),
            createElement("button", { "data-testid": "accept-spent", onClick: () => p.onError?.(new CalimeroError(400, "REJECTED", "unknown invite")) }, "spent"),
            createElement("button", { "data-testid": "accept-offline", onClick: () => p.onError?.(new CalimeroError(503, "UNAVAILABLE", "node unreachable")) }, "offline"),
          )
        : null,
  };
});

import App from "./App";
import { SessionProvider } from "./SessionProvider";
import { ToastProvider } from "./contexts/ToastContext";
import { MEMBER_DEFAULTS, dropInvite, migrateLegacyInvite, pendingInvite } from "./lib/streams";

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
    listAppTeams: vi.fn(async (org: string) => {
      if (org !== "org-1") throw new CalimeroError(404, "NOT_FOUND", "no such org");
      return {
        mode: "standalone",
        appTeams: [{ package: "com.calimero.mero-stream", teamId: "team-stream", name: "Mero Stream", join: "everyone", memberCount: 1, defaultCapabilities: 0, member: true }],
      };
    }),
    redeemInvite: vi.fn(async () => ({})),
    setMemberMetadata: vi.fn(async (org: string, account: string, m: Record<string, unknown>) => {
      meta[org] = { ...meta[org], [account]: m };
    }),
  });
}

const ENV = { DEV: true, VITE_CALIMERO_BUNDLE: "b" };

const PACKAGE_ENV = { DEV: true, VITE_CALIMERO_PACKAGE: "com.calimero.mero-stream" };

function renderApp(client: ReturnType<typeof fakeClient>, path: string, signedIn = false, env: SessionDeps["env"] = ENV) {
  const storage = new Memory();
  if (signedIn) new SessionStore(APP, resolveTarget(env), storage).save(SESSION);
  const deps: SessionDeps = {
    env,
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
    // Pressed until the dialog is up: a click before the session settles is lost when the landing page remounts.
    await waitFor(() => {
      fireEvent.click(screen.getAllByText(/^Sign in$/)[0]);
      expect(screen.getByTestId("signup-passkey")).toBeTruthy();
    });
    fireEvent.click(screen.getByTestId("signup-passkey"));
    await screen.findByText("Your streams");
    expect(client.signUp).toHaveBeenCalledWith(expect.anything(), "");
    await screen.findByTestId("streams-empty");

    // The org, its name and yours come from the shared dialog.
    fireEvent.click(screen.getByTestId("create-stream"));
    expect(JSON.parse((await screen.findByTestId("create-release")).textContent ?? "null")).toEqual({ package: "com.calimero.mero-stream" });
    fireEvent.click(screen.getByTestId("create-done"));
    await waitFor(() => expect(client.setCapabilities).toHaveBeenCalled());
    expect(client.createOrg).not.toHaveBeenCalled();
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

  it("asks once, for the stream, when a member continues a room link in a stream with no name for them", async () => {
    const client = fakeClient();
    client.orgs.push({ orgId: "org-1", name: "Team", role: "Owner" });
    client.apps.push(client.room("app-1"));
    localStorage.setItem("calimero-names:last", "Alice from Globex");
    hold(JSON.stringify({ token: "tok-9", stream: "org-1", room: "app-1", name: "Standup" }));
    renderApp(client, "/streams", true);
    fireEvent.click(await screen.findByTestId("accept-done"));
    await waitFor(() => expect((screen.getByTestId("invitation-name-input") as HTMLInputElement).value).toBe("Alice from Globex"));
    expect(client.redeemInvite).not.toHaveBeenCalled();
    fireEvent.click(screen.getByTestId("invitation-name-save"));
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
    expect(client.call).not.toHaveBeenCalledWith("app-1", "join", expect.objectContaining({ username: "guest" }));
    expect(pendingInvite()).toBeNull();
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

  describe("inviting", () => {
    const props = async () => JSON.parse((await screen.findByTestId("invite-props")).textContent ?? "null");

    async function openRooms(env: SessionDeps["env"], client = fakeClient()) {
      client.orgs.push({ orgId: "org-1", name: "Team", role: "Owner" });
      client.apps.push(client.room("app-1"));
      renderApp(client, "/streams/org-1", true, env);
      await screen.findByText("1 room");
      return client;
    }

    it("opens the shared dialog for the whole stream, with the app team of a package app", async () => {
      await openRooms(PACKAGE_ENV);
      fireEvent.click(screen.getByTestId("invite-namespace"));
      expect(await props()).toEqual({ org: "org-1", teams: ["team-stream"], appName: "Mero Stream", linkBase: `${window.location.origin}/?org=org-1&name=Team` });
      expect(screen.getByTestId("invite-title").textContent).toBe("Invite to Team");
      fireEvent.click(screen.getByTestId("invite-close"));
      await waitFor(() => expect(screen.queryByTestId("invite-dialog")).toBeNull());
    });

    it("opens it for one room, whose link names the room", async () => {
      await openRooms(ENV);
      fireEvent.click(screen.getByTestId("invite-room"));
      const shown = await props();
      expect(shown.teams).toEqual([]);
      expect(shown.linkBase).toContain("room=app-1");
      expect(screen.getByTestId("invite-title").textContent).toBe("Invite to app-1");
    });

    it("opens it from the stream list too", async () => {
      const client = fakeClient();
      client.orgs.push({ orgId: "org-1", name: "Team", role: "Owner" });
      client.apps.push(client.room("app-1"));
      renderApp(client, "/streams", true, PACKAGE_ENV);
      fireEvent.click(await screen.findByTestId("invite-btn"));
      expect(await props()).toMatchObject({ org: "org-1", teams: ["team-stream"] });
      expect(screen.getByTestId("invite-title").textContent).toBe("Invite to \u201cTeam\u201d");
    });

    it("labels the dialog, with the app-only note when the stream keeps its apps apart", async () => {
      const client = fakeClient();
      client.listAppTeams.mockResolvedValue({ mode: "shared", appTeams: [{ package: "com.calimero.mero-stream", teamId: "team-stream", name: "S", join: "everyone", memberCount: 1, defaultCapabilities: 0, member: true }] });
      await openRooms(PACKAGE_ENV, client);
      fireEvent.click(screen.getByTestId("invite-namespace"));
      const labels = JSON.parse((await screen.findByTestId("invite-labels")).textContent ?? "null");
      expect(labels.noun).toBe("stream");
      expect(labels.note).toMatch(/^Invites to Mero Stream only/);
    });

    it("says so, and opens nothing, when the stream has no team for the app", async () => {
      const client = fakeClient();
      client.listAppTeams.mockResolvedValue({ mode: "standalone", appTeams: [{ package: "com.calimero.other", teamId: "t", name: "O", join: "everyone", memberCount: 1, defaultCapabilities: 0, member: true }] });
      await openRooms(PACKAGE_ENV, client);
      fireEvent.click(screen.getByTestId("invite-namespace"));
      expect((await screen.findByTestId("rooms-error")).textContent).toMatch(/has not set up com.calimero.mero-stream/);
      expect(screen.queryByTestId("invite-dialog")).toBeNull();
    });
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

  it("hands the dialog the invite's stream, so a member is told so and nothing is redeemed", async () => {
    const client = fakeClient();
    client.orgs.push({ orgId: "org-1", name: "Team", role: "Owner" });
    hold(JSON.stringify({ token: "tok-9", stream: "org-1", room: null, name: "Team" }));
    renderApp(client, "/streams", true);
    expect(JSON.parse((await screen.findByTestId("accept-props")).textContent ?? "null").org).toBe("org-1");
    expect(screen.queryByTestId("invitation-member")).toBeNull();
    expect(client.redeemInvite).not.toHaveBeenCalled();
  });

  it("drops a stored token the node says is spent, and keeps it for a network failure", async () => {
    hold(JSON.stringify({ token: "tok-9", stream: "org-1", room: null, name: "Team" }));
    renderApp(fakeClient(), "/streams", true);
    fireEvent.click(await screen.findByTestId("accept-offline"));
    expect(pendingInvite()?.token).toBe("tok-9");
    fireEvent.click(screen.getByTestId("accept-spent"));
    expect(pendingInvite()).toBeNull();
  });

  it("hands the shared dialog the token, and drops it when the person closes the dialog", async () => {
    const client = fakeClient();
    hold(JSON.stringify({ token: "tok-9", stream: "org-1", room: null, name: "Team" }));
    renderApp(client, "/streams", true);
    expect(JSON.parse((await screen.findByTestId("accept-props")).textContent ?? "null")).toEqual({
      token: "tok-9",
      org: "org-1",
      appName: "Mero Stream",
      labels: { noun: "stream", title: "Join \u201cTeam\u201d?", body: "Joining gives you access to the stream and every room in it." },
    });
    expect(pendingInvite()?.token).toBe("tok-9");
    fireEvent.click(screen.getByTestId("accept-close"));
    await waitFor(() => expect(screen.queryByTestId("accept-dialog")).toBeNull());
    expect(pendingInvite()).toBeNull();
  });

  it("joins through the shared dialog after sign-in, asks for your name, and opens that room", async () => {
    const client = fakeClient();
    client.apps.push(client.room("app-1"));
    hold(JSON.stringify({ token: "tok-9", stream: "org-1", room: "app-1", name: "Standup" }));
    renderApp(client, "/");

    await screen.findByText("You're invited");
    fireEvent.click(await screen.findByTestId("signin-passkey"));
    const join = await screen.findByTestId("accept-done");
    client.orgs.push({ orgId: "org-1", name: "Team", role: "Member" });
    fireEvent.click(join);
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
    hold(JSON.stringify({ token: "tok-9", stream: "org-1", room: "app-1", name: "Standup" }));
    renderApp(client, "/streams", true);
    // Not a member until the dialog redeems the invitation.
    const join = await screen.findByTestId("accept-done");
    client.orgs.push({ orgId: "org-1", name: "Team", role: "Member" });
    fireEvent.click(join);
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
});
