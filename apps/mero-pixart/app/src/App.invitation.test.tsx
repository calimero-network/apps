/**
 * An invite link: the invitation page for a signed-out visitor, "Join the
 * team?" right after signing in, and the two ends that spend nothing (already
 * a member) or cannot (a spent invite). Runs the real App, router and passkey
 * session on a mocked CalimeroClient.
 */
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { BrowserRouter } from "react-router-dom";
import { CalimeroError, type CalimeroClient, type CalimeroSession } from "@calimero-network/mero-js";
import { SessionStore, resolveTarget } from "@calimero-apps/connect";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import App from "./App";
import { SessionProvider } from "./api/sessionContext";
import { APP, type SessionDeps } from "./api/session";
import { invites } from "./api/teams";

const SESSION: CalimeroSession = { accountId: "acct-me", sessionToken: "s", refreshToken: "r", expiresAt: 9e12 };
const DEV_ENV = { DEV: true, VITE_CALIMERO_BUNDLE: "bundle-hash" };
/** Hold `token` as the pending invite, as a captured link would. */
function hold(token: string, org: string | null = null) {
  invites.put({ token, org, team: null, doc: null, route: null, extra: {} });
}
const SLOW = { timeout: 10_000 };

function fakeClient(opts: { signedIn?: boolean } = {}) {
  let session: CalimeroSession | undefined = opts.signedIn ? SESSION : undefined;
  return {
    get session() {
      return session;
    },
    useSession: vi.fn((s: CalimeroSession) => {
      session = s;
    }),
    signIn: vi.fn(async () => (session = SESSION)),
    signUp: vi.fn(async () => (session = SESSION)),
    signOut: vi.fn(async () => {
      session = undefined;
    }),
    me: vi.fn(async () => ({ accountId: "acct-me", orgs: [{ orgId: "org-1", name: "Studio", role: "owner" }] })),
    getOrg: vi.fn(async () => ({ members: { "acct-me": "owner" }, memberMetadata: {}, capabilities: {}, defaultCapabilities: 3 })),
    listApps: vi.fn(async () => []),
    view: vi.fn(async () => ({ index: 1, result: null })),
    call: vi.fn(async () => ({ index: 1, result: null, events: [] })),
    events: vi.fn(async function* () {}),
    redeemInvite: vi.fn(async () => ({ org: "org-2" })),
  };
}

function renderApp(client: ReturnType<typeof fakeClient>) {
  const deps: SessionDeps = {
    env: DEV_ENV,
    makeClient: async () => client as unknown as CalimeroClient,
    passkey: () => ({}) as never,
  };
  return render(
    <SessionProvider deps={deps}>
      <BrowserRouter>
        <App />
      </BrowserRouter>
    </SessionProvider>,
  );
}

function storeSession() {
  new SessionStore(APP, resolveTarget(DEV_ENV), localStorage).save(SESSION);
}

beforeEach(() => {
  localStorage.clear();
  window.history.replaceState(null, "", "/");
  window.matchMedia ??= ((query: string) => ({
    matches: false,
    media: query,
    onchange: null,
    addListener: () => {},
    removeListener: () => {},
    addEventListener: () => {},
    removeEventListener: () => {},
    dispatchEvent: () => false,
  })) as typeof window.matchMedia;
});
afterEach(cleanup);

describe("an invite link", () => {
  it("labels the landing page action \"Sign in\" and offers no desktop app on a web-only app", async () => {
    renderApp(fakeClient());
    expect((await screen.findAllByRole("button", { name: "Sign in" }, SLOW)).length).toBeGreaterThan(0);
    expect(screen.queryByText(/get the desktop app/i)).toBeNull();
    expect(document.querySelector('a[href="https://calimero.network/download"]')).toBeNull();
  });

  it("shows an invitation page, not the landing page, to a signed-out visitor", async () => {
    hold("tok-xyz");
    renderApp(fakeClient());

    expect(await screen.findByTestId("invitation-page", {}, SLOW)).toBeTruthy();
    expect(screen.getByText(/You've been invited to join the team in Mero PixArt/)).toBeTruthy();
    expect(screen.getByTestId("signin-passkey")).toBeTruthy();
    expect(screen.queryByRole("dialog")).toBeNull();
    expect(document.querySelector(".cal-lp-root")).toBeNull();
  });

  it('"Not now" shows the landing page and keeps the invitation', async () => {
    hold("tok-xyz");
    renderApp(fakeClient());

    fireEvent.click(await screen.findByTestId("invitation-later", {}, SLOW));
    await waitFor(() => expect(document.querySelector(".cal-lp-root")).not.toBeNull(), SLOW);
    expect(invites.token()).toBe("tok-xyz");
  });

  it("asks to join right after signing in from the invitation page, then opens the team", async () => {
    const client = fakeClient();
    hold("tok-xyz");
    renderApp(client);

    fireEvent.click(await screen.findByTestId("signin-passkey", {}, SLOW));
    await waitFor(() => expect(client.signIn).toHaveBeenCalledTimes(1), SLOW);
    // No second click to reach the prompt, and nothing redeemed before it.
    expect(client.redeemInvite).not.toHaveBeenCalled();
    fireEvent.click(await screen.findByTestId("invitation-join", {}, SLOW));
    await waitFor(() => expect(client.redeemInvite).toHaveBeenCalledWith("tok-xyz"), SLOW);
    await waitFor(() => expect(window.location.pathname).toBe("/teams/org-2/projects"), SLOW);
    expect(invites.token()).toBeNull();
  });

  it("tells a member of the invited team they are already in it, without spending the invite", async () => {
    const client = fakeClient({ signedIn: true });
    storeSession();
    hold("tok-xyz", "org-1");
    renderApp(client);

    expect(await screen.findByText("You're already in this team", {}, SLOW)).toBeTruthy();
    expect(client.redeemInvite).not.toHaveBeenCalled();
    expect(invites.token()).toBeNull();
    fireEvent.click(screen.getByTestId("invitation-continue"));
    await waitFor(() => expect(window.location.pathname).toBe("/teams/org-1/projects"), SLOW);
  });

  it("says plainly when the invite was already used or has expired", async () => {
    const client = fakeClient({ signedIn: true });
    client.redeemInvite.mockRejectedValueOnce(new CalimeroError(404, "NOT_FOUND", "unknown invite"));
    storeSession();
    hold("tok-used");
    renderApp(client);

    fireEvent.click(await screen.findByTestId("invitation-join", {}, SLOW));
    expect(
      await screen.findByText(
        "This invite was already used or has expired. Ask the person who invited you for a new link.",
        {},
        SLOW,
      ),
    ).toBeTruthy();
    expect(invites.token()).toBeNull();
  });

  it("an invited newcomer who creates the account lands on the page the link named (B10)", async () => {
    const client = fakeClient();
    window.history.replaceState(null, "", "/teams/org-3/projects?invite=tok-xyz&org=org-3");
    invites.capture(window.location);
    renderApp(client);

    // "Not now", then create the account from the landing page: the sign-up joins.
    fireEvent.click(await screen.findByTestId("invitation-later", {}, SLOW));
    await waitFor(() => expect(window.location.pathname).toBe("/"), SLOW);
    fireEvent.click((await screen.findAllByRole("button", { name: "Sign in" }, SLOW))[0]);
    fireEvent.click(await screen.findByTestId("signup-passkey", {}, SLOW));
    await waitFor(() => expect(client.signUp).toHaveBeenCalledWith(expect.anything(), "", { invite: "tok-xyz" }), SLOW);
    await waitFor(() => expect(window.location.pathname).toBe("/teams/org-3/projects"), SLOW);
    await new Promise((r) => setTimeout(r, 300));
    expect(window.location.pathname).toBe("/teams/org-3/projects");
    expect(client.redeemInvite).not.toHaveBeenCalled();
    expect(invites.token()).toBeNull();
  });

  it.each([
    [429, "RATE_LIMITED", /Too many tries/],
    [401, "UNAUTHENTICATED", /sign in again/],
  ])("keeps the invite when redeeming answers %i, and says to try again (B6)", async (status, code, says) => {
    const client = fakeClient({ signedIn: true });
    client.redeemInvite.mockRejectedValueOnce(new CalimeroError(status, code, "not now"));
    storeSession();
    hold("tok-xyz");
    renderApp(client);

    fireEvent.click(await screen.findByTestId("invitation-join", {}, SLOW));
    expect((await screen.findByTestId("invitation-error", {}, SLOW)).textContent).toMatch(says);
    expect(invites.token()).toBe("tok-xyz");
  });
});
