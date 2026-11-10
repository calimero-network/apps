import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { CalimeroError, type AppInfo, type CalimeroClient, type CalimeroSession } from "@calimero-network/mero-js";
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
};
const ELSEWHERE: AppInfo = { ...BOARD, appId: "board-2", name: "Another team's board", org: "org-2" };

function fakeClient() {
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
  };
}

function deps(client: ReturnType<typeof fakeClient>): SessionDeps {
  return {
    env: DEV_ENV,
    makeClient: vi.fn(async () => client as unknown as CalimeroClient),
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
    expect(client.redeemInvite).not.toHaveBeenCalled();
    fireEvent.click(await screen.findByTestId("invitation-join"));
    await waitFor(() => expect(client.redeemInvite).toHaveBeenCalledWith("tok-1"));
    await waitFor(() => expect(window.location.pathname).toBe("/teams/org-1/projects"));
    expect(invites.token()).toBeNull();
  });
  it("asks your name once on joining a team that has none for you, and keeps it in the team", async () => {
    remember();
    hold({ token: "tok-1" });
    localStorage.setItem("calimero-names:last", "Alice A");
    const client = fakeClient();
    client.getOrg.mockResolvedValue({ name: "Design team", members: { [ME]: "member" }, memberMetadata: {} });
    render(<App deps={deps(client)} />);
    fireEvent.click(await screen.findByTestId("invitation-join"));
    await waitFor(() => expect(client.redeemInvite).toHaveBeenCalledWith("tok-1"));
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
    fireEvent.click(await screen.findByTestId("invitation-join"));
    await waitFor(() => expect(window.location.pathname).toBe("/teams/org-1/projects"));
    expect(screen.queryByTestId("username-input")).toBeNull();
    expect(client.setMemberMetadata).not.toHaveBeenCalled();
  });

  it("asks your name in a new team in the same step as its name, and keeps it in the team", async () => {
    remember();
    window.history.replaceState(null, "", "/teams");
    const client = fakeClient();
    client.me.mockResolvedValue({ orgs: [] });
    client.getOrg.mockResolvedValue({ name: "Studio", members: { [ME]: "owner" }, memberMetadata: {} });
    render(<App deps={deps(client)} />);
    fireEvent.change(await screen.findByTestId("first-team-input"), { target: { value: "Studio" } });
    const mine = screen.getByTestId("first-team-my-name") as HTMLInputElement;
    // Required: no name, no team.
    fireEvent.change(mine, { target: { value: " " } });
    expect((screen.getByTestId("first-team-create") as HTMLButtonElement).disabled).toBe(true);
    fireEvent.change(mine, { target: { value: "Alice" } });
    fireEvent.click(screen.getByTestId("first-team-create"));
    await waitFor(() => expect(client.createOrg).toHaveBeenCalledWith("Studio"));
    await waitFor(() => expect(client.setMemberMetadata).toHaveBeenCalledWith("org-new", ME, { name: "Alice" }));
    expect(localStorage.getItem("calimero-names:last")).toBe("Alice");
  });

  describe("an invitation link opened while signed out", () => {
    it("shows the invitation as the page, not the landing hero", async () => {
      hold({ token: "tok-1" });
      render(<App deps={deps(fakeClient())} />);
      expect(await screen.findByTestId("invitation-page")).toBeTruthy();
      expect(screen.getByText("You're invited")).toBeTruthy();
      expect(screen.getByTestId("signin-desc").textContent).toContain(
        "You've been invited to join the team in Mero Design.",
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
      fireEvent.click(await screen.findByTestId("invitation-join"));
      await waitFor(() => expect(client.redeemInvite).toHaveBeenCalledWith("tok-1"));
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
      fireEvent.click(await screen.findByTestId("invitation-join"));
      await waitFor(() => expect(window.location.pathname).toBe("/boards/board-1"));
    });

    it("creating the account joins in that step and opens the route the link names (B10)", async () => {
      window.history.replaceState(null, "", "/?invite=tok-1&org=org-1&to=%2Fteams%2Forg-1%2Fprojects%2Fboard-1");
      invites.capture(window.location);
      const client = fakeClient();
      render(<App deps={deps(client)} />);
      fireEvent.click(await screen.findByTestId("signup-passkey"));
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

  it("does not offer Join to someone already in the team, and keeps the link unspent", async () => {
    remember();
    hold({ token: "tok-1", org: "org-1" });
    const client = fakeClient();
    render(<App deps={deps(client)} />);
    expect(await screen.findByText("You're already in this team")).toBeTruthy();
    expect(screen.queryByTestId("invitation-join")).toBeNull();
    expect(client.redeemInvite).not.toHaveBeenCalled();
    expect(invites.token()).toBeNull();
  });

  it("says plainly when the invite was already used or has expired", async () => {
    remember();
    hold({ token: "tok-1" });
    const client = fakeClient();
    client.redeemInvite.mockRejectedValueOnce(new CalimeroError(404, "NOT_FOUND", "unknown invite"));
    render(<App deps={deps(client)} />);
    fireEvent.click(await screen.findByTestId("invitation-join"));
    expect((await screen.findByTestId("invitation-error")).textContent).toBe(
      "This invite was already used or has expired. Ask the person who invited you for a new link.",
    );
    expect(invites.token()).toBeNull();
  });

  it.each([
    [429, "RATE_LIMITED", /Too many tries/],
    [401, "UNAUTHENTICATED", /sign in again/],
  ])("keeps the invite when redeeming answers %i, and says to try again (B6)", async (status, code, says) => {
    remember();
    hold({ token: "tok-1" });
    const client = fakeClient();
    client.redeemInvite.mockRejectedValueOnce(new CalimeroError(status, code, "not now"));
    render(<App deps={deps(client)} />);
    fireEvent.click(await screen.findByTestId("invitation-join"));
    expect((await screen.findByTestId("invitation-error")).textContent).toMatch(says);
    expect(invites.token()).toBe("tok-1");
    expect(screen.getByTestId("invitation-join")).toBeTruthy();
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
