import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { CalimeroError, type AppInfo, type CalimeroClient, type CalimeroSession } from "@calimero-network/mero-js";
import { SessionStore, resolveTarget } from "@calimero-apps/connect";
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";

import App from "./App";
import { APP } from "./session";
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
      members: { [ME]: "owner", "acct-bob": "member" },
      memberMetadata: { [ME]: { name: "Alice" } },
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
    localStorage.setItem(`${APP}:pending-invite`, JSON.stringify({ token: "tok-1" }));
    const client = fakeClient();
    render(<App deps={deps(client)} />);
    expect(client.redeemInvite).not.toHaveBeenCalled();
    fireEvent.click(await screen.findByTestId("invitation-join"));
    await waitFor(() => expect(client.redeemInvite).toHaveBeenCalledWith("tok-1"));
    await waitFor(() => expect(window.location.pathname).toBe("/teams/org-1/projects"));
    expect(localStorage.getItem(`${APP}:pending-invite`)).toBeNull();
  });
  describe("an invitation link opened while signed out", () => {
    const PENDING = `${APP}:pending-invite`;

    it("shows the invitation as the page, not the landing hero", async () => {
      localStorage.setItem(PENDING, JSON.stringify({ token: "tok-1" }));
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
      localStorage.setItem(PENDING, JSON.stringify({ token: "tok-1" }));
      const client = fakeClient();
      render(<App deps={deps(client)} />);
      fireEvent.click(await screen.findByTestId("signin-passkey"));
      await waitFor(() => expect(client.signIn).toHaveBeenCalled());
      fireEvent.click(await screen.findByTestId("invitation-join"));
      await waitFor(() => expect(client.redeemInvite).toHaveBeenCalledWith("tok-1"));
      await waitFor(() => expect(window.location.pathname).toBe("/teams/org-1/projects"));
      expect(localStorage.getItem(PENDING)).toBeNull();
    });

    it("after joining, goes on to the route the link was opened on", async () => {
      localStorage.setItem(PENDING, JSON.stringify({ token: "tok-1", returnTo: "/boards/board-1" }));
      const client = fakeClient();
      render(<App deps={deps(client)} />);
      fireEvent.click(await screen.findByTestId("signin-passkey"));
      fireEvent.click(await screen.findByTestId("invitation-join"));
      await waitFor(() => expect(window.location.pathname).toBe("/boards/board-1"));
    });

    it("Not now shows the landing page and keeps the token", async () => {
      localStorage.setItem(PENDING, JSON.stringify({ token: "tok-1" }));
      render(<App deps={deps(fakeClient())} />);
      fireEvent.click(await screen.findByTestId("invitation-not-now"));
      expect(await screen.findByText("Connect")).toBeTruthy();
      expect(screen.queryByTestId("invitation-page")).toBeNull();
      expect(localStorage.getItem(PENDING)).not.toBeNull();
      // Signing in from the landing page still offers it.
      fireEvent.click(screen.getByText("Connect"));
      expect((await screen.findByTestId("signin-desc")).textContent).toContain("You've been invited");
    });
  });

  it("does not offer Join to someone already in the team, and keeps the link unspent", async () => {
    remember();
    localStorage.setItem(`${APP}:pending-invite`, JSON.stringify({ token: "tok-1", org: "org-1" }));
    const client = fakeClient();
    render(<App deps={deps(client)} />);
    expect(await screen.findByText("You're already in this team")).toBeTruthy();
    expect(screen.queryByTestId("invitation-join")).toBeNull();
    expect(client.redeemInvite).not.toHaveBeenCalled();
    expect(localStorage.getItem(`${APP}:pending-invite`)).toBeNull();
  });

  it("says plainly when the invite was already used or has expired", async () => {
    remember();
    localStorage.setItem(`${APP}:pending-invite`, JSON.stringify({ token: "tok-1" }));
    const client = fakeClient();
    client.redeemInvite.mockRejectedValueOnce(new CalimeroError(404, "NOT_FOUND", "unknown invite"));
    render(<App deps={deps(client)} />);
    fireEvent.click(await screen.findByTestId("invitation-join"));
    expect((await screen.findByTestId("invitation-error")).textContent).toBe(
      "This invite was already used or has expired. Ask the person who invited you for a new link.",
    );
    expect(localStorage.getItem(`${APP}:pending-invite`)).toBeNull();
  });
});
