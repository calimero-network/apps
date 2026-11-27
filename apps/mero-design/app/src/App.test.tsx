import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import type { AppInfo, CalimeroClient, CalimeroSession } from "@calimero-network/mero-js";
import { SessionStore, resolveTarget } from "@calimero-apps/connect";
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";

import App from "./App";
import { APP } from "./session";
import { invites } from "./utils/inviteLink";

/** Hold an invite as a captured link would. */
function hold(link: { token: string; org?: string; returnTo?: string }) {
  invites.put({ token: link.token, org: link.org ?? null, team: null, doc: null, route: link.returnTo ?? null, extra: {} });
}
import type { SessionDeps } from "./session";
import { withRoutes } from "@calimero-apps/connect/testing";

// `useInstanceRelease` as on a page a node serves from `release.href` (a
// release's `/{version}/`), going nowhere but `release.navigate`. With no
// `href` it reads this test's own location: development, where it never moves.
const release = vi.hoisted(() => ({ href: null as string | null, navigate: vi.fn() }));
vi.mock("@calimero-apps/passkey", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@calimero-apps/passkey")>();
  return {
    ...actual,
    useInstanceRelease: (...[client, app]: Parameters<typeof actual.useInstanceRelease>) =>
      actual.useInstanceRelease(client, app, release.href ? { href: release.href, navigate: release.navigate } : {}),
  };
});
// The shared dialog is mero-react's to test: here only what the app hands it and does after.
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
              { "data-testid": "create-done", onClick: () => p.onCreated({ orgId: "org-new", name: "Studio", selfName: "Alice" }) },
              "done",
            ),
          )
        : null,
    AcceptInviteDialog: (p: {
      open: boolean;
      token: string;
      org?: string;
      appName?: string;
      labels?: object;
      onClose: () => void;
      onError?: (e: unknown) => void;
      onJoined: (j: { org: string }) => void;
    }) =>
      p.open
        ? createElement(
            "div",
            { "data-testid": "accept-dialog" },
            createElement("p", { "data-testid": "accept-props" }, `${p.token} ${p.appName}`),
            createElement("pre", { "data-testid": "accept-extra" }, JSON.stringify({ org: p.org, labels: p.labels })),
            createElement("button", { "data-testid": "accept-error", onClick: () => p.onError?.(new Error("spent")) }, "error"),
            createElement("button", { "data-testid": "accept-close", onClick: p.onClose }, "close"),
            createElement("button", { "data-testid": "accept-done", onClick: () => p.onJoined({ org: "org-1" }) }, "done"),
          )
        : null,
    InviteDialog: (p: {
      open: boolean;
      org: string;
      teams?: string[];
      appName?: string;
      labels?: { noun?: string; note?: string; title?: string };
      linkBase?: string;
    }) =>
      p.open
        ? createElement(
            "div",
            { "data-testid": "invite-dialog" },
            createElement("h2", { "data-testid": "invite-title" }, p.labels?.title),
            createElement("pre", { "data-testid": "invite-props" }, JSON.stringify({ org: p.org, teams: p.teams, appName: p.appName })),
            createElement("pre", { "data-testid": "invite-base" }, p.linkBase),
            createElement("pre", { "data-testid": "invite-labels" }, JSON.stringify({ noun: p.labels?.noun, note: p.labels?.note })),
          )
        : null,
  };
});

const HOST = `https://${"a".repeat(52)}.apps.calimero.network`;

// The landing page is generated and tested on its own; here it is the door.
vi.mock("./pages/landing/LandingPage", () => ({
  default: ({ onConnect }: { onConnect?: () => void }) => (
    <button type="button" onClick={onConnect}>
      Connect
    </button>
  ),
}));

beforeAll(() => {
  window.scrollTo = vi.fn() as never;
  class Observer {
    observe() {}
    unobserve() {}
    disconnect() {}
  }
  (globalThis as Record<string, unknown>).IntersectionObserver = Observer;
  (globalThis as Record<string, unknown>).ResizeObserver = Observer;
  window.matchMedia = ((query: string) => ({
    matches: false,
    media: query,
    addEventListener: () => {},
    removeEventListener: () => {},
    addListener: () => {},
    removeListener: () => {},
    onchange: null,
    dispatchEvent: () => false,
  })) as never;
});

beforeEach(() => {
  localStorage.clear();
  sessionStorage.clear();
  release.href = null;
  release.navigate.mockClear();
  window.history.replaceState(null, "", "/");
});
afterEach(cleanup);

const ME = "acct-alice";
const SESSION: CalimeroSession = { accountId: ME, sessionToken: "s", refreshToken: "r", expiresAt: 9e12 };
const DEV_ENV = { DEV: true, VITE_CALIMERO_BUNDLE: "bundle-hash" };

const BOARD: AppInfo = {
  appId: "board-1",
  name: "Landing page",
  owner: ME,
  org: "org-1",
  bundle: "bundle-hash",
  package: null,
  version: null,
  deployment: null,
};
const ELSEWHERE: AppInfo = { ...BOARD, appId: "board-2", name: "Another team's board", org: "org-2" };

function fakeClient() {
  let session: CalimeroSession | undefined;
  return withRoutes({
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
    me: vi.fn(async () => ({ orgs: [{ orgId: "org-1", name: "Design team", role: "owner" }] })),
    getOrg: vi.fn(async () => ({
      name: "Design team",
      members: { [ME]: "owner", "acct-bob": "member" } as Record<string, string>,
      memberMetadata: { [ME]: { name: "Alice" } } as Record<string, { name: string }>,
    })),
    listApps: vi.fn(async () => [BOARD, ELSEWHERE]),
    createApp: vi.fn(async () => "board-new"),
    call: vi.fn(async () => ({ index: 1, result: null, events: [] })),
    view: vi.fn(async (_app: string, method: string) => ({
      index: 1,
      result: method === "getBoard" ? { name: "Landing page v2", description: "", elementCount: 0, memberCount: 1, owner: ME } : [],
    })),
    events: vi.fn(async function* () {}),
    redeemInvite: vi.fn(async () => ({ org: "org-1" })),
    setMemberMetadata: vi.fn(async () => undefined),
    createOrg: vi.fn(async () => "org-new"),
    setCapabilities: vi.fn(async () => undefined),
  });
}

function deps(client: ReturnType<typeof fakeClient>): SessionDeps {
  return {
    env: DEV_ENV,
    makeClient: vi.fn(async () => withRoutes(client)),
    passkey: () => ({ create: vi.fn(), get: vi.fn() }),
  };
}

/** A session an earlier visit left behind. */
function remember() {
  const store = new SessionStore(APP, resolveTarget(DEV_ENV));
  store.sync({ session: SESSION } as unknown as CalimeroClient);
}

describe("App", () => {
  it("signs in with a passkey from the landing page and opens the team's boards", async () => {
    const client = fakeClient();
    render(<App deps={deps(client)} />);
    fireEvent.click(await screen.findByText("Connect"));
    fireEvent.click(await screen.findByTestId("signin-passkey"));
    await waitFor(() => expect(client.signIn).toHaveBeenCalled());
    // The board's own name (the contract's) wins over the instance's.
    await screen.findAllByText("Landing page v2");
    expect(client.listApps).toHaveBeenCalledWith({ bundle: "bundle-hash" });
    expect(screen.queryByText("Another team's board")).toBeNull();
    expect(client.view).toHaveBeenCalledWith("board-1", "getBoard", {});
  });

  it("asks before redeeming an invitation, then opens the team", async () => {
    remember();
    hold({ token: "tok-1" });
    const client = fakeClient();
    render(<App deps={deps(client)} />);
    expect((await screen.findByTestId("accept-props")).textContent).toBe("tok-1 Hyperfeed Design");
    expect(invites.token()).toBe("tok-1");
    fireEvent.click(screen.getByTestId("accept-done"));
    await waitFor(() => expect(window.location.pathname).toBe("/teams/org-1/projects"));
    expect(client.redeemInvite).not.toHaveBeenCalled();
    expect(invites.token()).toBeNull();
  });
  it("asks your name once on joining a team that has none for you, and keeps it in the team", async () => {
    remember();
    hold({ token: "tok-1" });
    localStorage.setItem("calimero-names:last", "Alice A");
    const client = fakeClient();
    client.getOrg.mockResolvedValue({ name: "Design team", members: { [ME]: "member" }, memberMetadata: {} });
    render(<App deps={deps(client)} />);
    fireEvent.click(await screen.findByTestId("accept-done"));
    // Offered the name used last.
    const input = (await screen.findByTestId("username-input")) as HTMLInputElement;
    expect(input.value).toBe("Alice A");
    fireEvent.change(input, { target: { value: "Alice" } });
    fireEvent.click(screen.getByTestId("username-submit"));
    await waitFor(() => expect(client.setMemberMetadata).toHaveBeenCalledWith("org-1", ME, { name: "Alice" }));
    await waitFor(() => expect(window.location.pathname).toBe("/teams/org-1/projects"));
  });

  it("does not ask for a name on joining a team that already has yours", async () => {
    remember();
    hold({ token: "tok-1" });
    const client = fakeClient();
    render(<App deps={deps(client)} />);
    fireEvent.click(await screen.findByTestId("accept-done"));
    await waitFor(() => expect(window.location.pathname).toBe("/teams/org-1/projects"));
    expect(screen.queryByTestId("username-input")).toBeNull();
    expect(client.setMemberMetadata).not.toHaveBeenCalled();
  });

  it("opens the shared dialog from the empty state, and names you in the team it made", async () => {
    remember();
    window.history.replaceState(null, "", "/teams");
    const client = fakeClient();
    client.me.mockResolvedValue({ orgs: [] });
    client.getOrg.mockResolvedValue({ name: "Studio", members: { [ME]: "owner" }, memberMetadata: {} });
    localStorage.setItem("calimero-names:last", "Alice");
    render(<App deps={deps(client)} />);
    fireEvent.click(await screen.findByTestId("first-team-create"));
    expect((await screen.findByTestId("create-title")).textContent).toBe("New team");
    expect(screen.getByTestId("create-self").textContent).toBe("Alice");
    fireEvent.click(screen.getByTestId("create-done"));
    await waitFor(() => expect(client.setMemberMetadata).toHaveBeenCalledWith("org-new", ME, { name: "Alice" }));
    await waitFor(() => expect(window.location.pathname).toBe("/teams/org-new/projects"));
    expect(client.createOrg).not.toHaveBeenCalled();
  });

  describe("an invitation link opened while signed out", () => {
    it("shows the invitation as the page, not the landing hero", async () => {
      hold({ token: "tok-1" });
      render(<App deps={deps(fakeClient())} />);
      expect(await screen.findByTestId("invitation-page")).toBeTruthy();
      expect(screen.getByText("You're invited")).toBeTruthy();
      expect(screen.getByTestId("signin-desc").textContent).toContain(
        "You've been invited to join the team in Hyperfeed Design.",
      );
      expect(screen.getByTestId("signin-passkey")).toBeTruthy();
      expect(screen.getByTestId("signup-passkey")).toBeTruthy();
      // The landing page (mocked as its CTA) is not behind it.
      expect(screen.queryByText("Connect")).toBeNull();
    });

    it("signing in goes straight to the join prompt, then into the team", async () => {
      hold({ token: "tok-1" });
      const client = fakeClient();
      render(<App deps={deps(client)} />);
      fireEvent.click(await screen.findByTestId("signin-passkey"));
      await waitFor(() => expect(client.signIn).toHaveBeenCalled());
      fireEvent.click(await screen.findByTestId("accept-done"));
      await waitFor(() => expect(window.location.pathname).toBe("/teams/org-1/projects"));
      expect(invites.token()).toBeNull();
    });

    it("after joining, goes on to the route the link was opened on", async () => {
      hold({ token: "tok-1", returnTo: "/boards/board-1" });
      const client = fakeClient();
      render(<App deps={deps(client)} />);
      fireEvent.click(await screen.findByTestId("signin-passkey"));
      // The team list's own redirect into the team lands first (it is async):
      // joining is asked over it.
      await waitFor(() => expect(window.location.pathname).toBe("/teams/org-1/projects"));
      fireEvent.click(await screen.findByTestId("accept-done"));
      await waitFor(() => expect(window.location.pathname).toBe("/boards/board-1"));
    });

    it("creating the account joins in that step and opens the route the link names (B10)", async () => {
      window.history.replaceState(null, "", "/?invite=tok-1&org=org-1&to=%2Fteams%2Forg-1%2Fprojects%2Fboard-1");
      invites.capture(window.location);
      const client = fakeClient();
      render(<App deps={deps(client)} />);
      fireEvent.click(await screen.findByTestId("signup-passkey"));
      fireEvent.click(await screen.findByTestId("signup-create"));
      await waitFor(() => expect(client.signUp).toHaveBeenCalledWith(expect.anything(), "", { invite: "tok-1" }));
      await waitFor(() => expect(window.location.pathname).toBe("/teams/org-1/projects/board-1"));
      await new Promise((r) => setTimeout(r, 300));
      expect(window.location.pathname).toBe("/teams/org-1/projects/board-1");
      expect(client.redeemInvite).not.toHaveBeenCalled();
      expect(invites.token()).toBeNull();
    });

    it("Not now shows the landing page and keeps the token", async () => {
      hold({ token: "tok-1" });
      render(<App deps={deps(fakeClient())} />);
      fireEvent.click(await screen.findByTestId("invitation-not-now"));
      expect(await screen.findByText("Connect")).toBeTruthy();
      expect(screen.queryByTestId("invitation-page")).toBeNull();
      expect(invites.token()).not.toBeNull();
      // Signing in from the landing page still offers it.
      fireEvent.click(screen.getByText("Connect"));
      expect((await screen.findByTestId("signin-desc")).textContent).toContain("You've been invited");
    });
  });

  it("hands the dialog the team the link names and the team wording, and clears a spent link on error", async () => {
    remember();
    hold({ token: "tok-1", org: "org-1" });
    render(<App deps={deps(fakeClient())} />);
    expect(JSON.parse((await screen.findByTestId("accept-extra")).textContent ?? "")).toEqual({
      org: "org-1",
      labels: { noun: "team", title: "Join this team", body: expect.stringContaining("boards"), join: "Join the team" },
    });
    expect(invites.token()).toBe("tok-1");
    fireEvent.click(screen.getByTestId("accept-error"));
    expect(invites.token()).toBeNull();
    expect(screen.queryByTestId("accept-dialog")).toBeTruthy();
  });

  it("opens the team a member continues into, without redeeming", async () => {
    remember();
    hold({ token: "tok-1", org: "org-1" });
    const client = fakeClient();
    render(<App deps={deps(client)} />);
    fireEvent.click(await screen.findByTestId("accept-done"));
    await waitFor(() => expect(window.location.pathname).toBe("/teams/org-1/projects"));
    expect(client.redeemInvite).not.toHaveBeenCalled();
    expect(invites.token()).toBeNull();
  });

  it("opens the shared invite dialog from the shell, worded for the team and linking to it", async () => {
    remember();
    window.history.replaceState(null, "", "/teams/org-1/projects");
    const client = fakeClient();
    render(<App deps={deps(client)} />);
    fireEvent.click(await screen.findByTitle("Invite people to Design team"));
    expect((await screen.findByTestId("invite-title")).textContent).toBe("Invite to Design team");
    expect(JSON.parse(screen.getByTestId("invite-props").textContent ?? "")).toEqual({ org: "org-1", teams: [], appName: "Hyperfeed Design" });
    expect(new URL(screen.getByTestId("invite-base").textContent ?? "").searchParams.get("org")).toBe("org-1");
    expect(JSON.parse(screen.getByTestId("invite-labels").textContent ?? "")).toEqual({ noun: "team" });
  });

  it("closing the join dialog drops the invite and joins nothing", async () => {
    remember();
    hold({ token: "tok-1" });
    const client = fakeClient();
    render(<App deps={deps(client)} />);
    fireEvent.click(await screen.findByTestId("accept-close"));
    await waitFor(() => expect(screen.queryByTestId("accept-dialog")).toBeNull());
    expect(client.redeemInvite).not.toHaveBeenCalled();
    expect(invites.token()).toBeNull();
  });

  it("tells a member who may not add a board to ask an owner, instead of offering Create (B8)", async () => {
    remember();
    const client = fakeClient();
    client.me.mockResolvedValue({ orgs: [{ orgId: "org-1", name: "Design team", role: "member" }] });
    // A member with the node's default capabilities: no CREATE_APP.
    client.getOrg.mockResolvedValue({
      name: "Design team",
      members: { [ME]: "member", "acct-bob": "owner" },
      memberMetadata: { [ME]: { name: "Alice" } },
    });
    client.listApps.mockResolvedValue([]);
    window.history.replaceState(null, "", "/teams/org-1/projects");
    render(<App deps={deps(client)} />);
    expect((await screen.findByTestId("create-board-ask")).textContent).toMatch(/Only an owner or admin/);
    expect(screen.queryByTestId("create-project-btn")).toBeNull();
    expect(screen.queryByTestId("new-board-btn")).toBeNull();
  });
});

describe("the release a board runs (useInstanceRelease)", () => {
  /** The board's page, while `board-1` runs `version`. */
  function openBoard(version: string) {
    const client = Object.assign(fakeClient(), withRoutes({
      getApp: vi.fn(async () => ({ appId: "board-1", org: "org-1" })),
      appsReportAll: vi.fn(async () => ({ apps: [{ app: "board-1", package: { package: "com.calimero.design", version } }] })),
    }));
    remember();
    window.history.replaceState(null, "", "/teams/org-1/projects/board-1");
    render(<App deps={deps(client)} />);
    return client;
  }
  const board = () => document.querySelector('[data-testid="board-pending"], [data-testid="board-empty-hint"]');

  it("moves a served page to the frontend of the release the board runs, and shows nothing of it meanwhile", async () => {
    release.href = `${HOST}/1.2.0/teams/org-1/projects/board-1`;
    openBoard("1.0.0");
    await waitFor(() => expect(release.navigate).toHaveBeenCalledWith(`${HOST}/app/board-1/teams/org-1/projects/board-1`));
    expect(release.navigate).toHaveBeenCalledTimes(1);
    await waitFor(() => expect(board()).toBeNull());
  });

  it("stays on a served page of the release the board runs", async () => {
    release.href = `${HOST}/1.2.0/teams/org-1/projects/board-1`;
    const client = openBoard("1.2.0");
    await waitFor(() => expect(client.appsReportAll).toHaveBeenCalledWith("org-1"));
    await new Promise((r) => setTimeout(r, 0));
    expect(release.navigate).not.toHaveBeenCalled();
    await waitFor(() => expect(board()).not.toBeNull());
  });

  it("does nothing in development", async () => {
    const client = openBoard("1.0.0");
    await waitFor(() => expect(board()).not.toBeNull());
    await new Promise((r) => setTimeout(r, 0));
    expect(client.getApp).not.toHaveBeenCalled();
    expect(release.navigate).not.toHaveBeenCalled();
  });
});
