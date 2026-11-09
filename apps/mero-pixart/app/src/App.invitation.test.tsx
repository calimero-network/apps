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

const SESSION: CalimeroSession = { accountId: "acct-me", sessionToken: "s", refreshToken: "r", expiresAt: 9e12 };
const DEV_ENV = { DEV: true, VITE_CALIMERO_BUNDLE: "bundle-hash" };
const PENDING = `${APP}:pending-invite`;
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
    localStorage.setItem(PENDING, "tok-xyz");
    renderApp(fakeClient());

    expect(await screen.findByTestId("invitation-page", {}, SLOW)).toBeTruthy();
    expect(screen.getByText(/You've been invited to join the team in Mero PixArt/)).toBeTruthy();
    expect(screen.getByTestId("signin-passkey")).toBeTruthy();
    expect(screen.queryByRole("dialog")).toBeNull();
    expect(document.querySelector(".cal-lp-root")).toBeNull();
  });

  it('"Not now" shows the landing page and keeps the invitation', async () => {
    localStorage.setItem(PENDING, "tok-xyz");
    renderApp(fakeClient());

    fireEvent.click(await screen.findByTestId("invitation-later", {}, SLOW));
    await waitFor(() => expect(document.querySelector(".cal-lp-root")).not.toBeNull(), SLOW);
    expect(localStorage.getItem(PENDING)).toBe("tok-xyz");
  });

  it("asks to join right after signing in from the invitation page, then opens the team", async () => {
    const client = fakeClient();
    localStorage.setItem(PENDING, "tok-xyz");
    renderApp(client);

    fireEvent.click(await screen.findByTestId("signin-passkey", {}, SLOW));
    await waitFor(() => expect(client.signIn).toHaveBeenCalledTimes(1), SLOW);
    // No second click to reach the prompt, and nothing redeemed before it.
    expect(client.redeemInvite).not.toHaveBeenCalled();
    fireEvent.click(await screen.findByTestId("invitation-join", {}, SLOW));
    await waitFor(() => expect(client.redeemInvite).toHaveBeenCalledWith("tok-xyz"), SLOW);
    await waitFor(() => expect(window.location.pathname).toBe("/teams/org-2/projects"), SLOW);
    expect(localStorage.getItem(PENDING)).toBeNull();
  });

  it("tells a member of the invited team they are already in it, without spending the invite", async () => {
    const client = fakeClient({ signedIn: true });
    storeSession();
    localStorage.setItem(PENDING, "tok-xyz");
    localStorage.setItem(`${APP}:pending-invite-org`, "org-1");
    renderApp(client);

    expect(await screen.findByText("You're already in this team", {}, SLOW)).toBeTruthy();
    expect(client.redeemInvite).not.toHaveBeenCalled();
    expect(localStorage.getItem(PENDING)).toBeNull();
    fireEvent.click(screen.getByTestId("invitation-continue"));
    await waitFor(() => expect(window.location.pathname).toBe("/teams/org-1/projects"), SLOW);
  });

  it("says plainly when the invite was already used or has expired", async () => {
    const client = fakeClient({ signedIn: true });
    client.redeemInvite.mockRejectedValueOnce(new CalimeroError(404, "NOT_FOUND", "unknown invite"));
    storeSession();
    localStorage.setItem(PENDING, "tok-used");
    renderApp(client);

    fireEvent.click(await screen.findByTestId("invitation-join", {}, SLOW));
    expect(
      await screen.findByText(
        "This invite was already used or has expired. Ask the person who invited you for a new link.",
        {},
        SLOW,
      ),
    ).toBeTruthy();
    expect(localStorage.getItem(PENDING)).toBeNull();
  });
});
