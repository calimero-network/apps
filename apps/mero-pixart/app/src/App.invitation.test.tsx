/**
 * An invite link opened while signed out: the invitation as a page, then the
 * redemption once a passkey session exists. Runs the real App, router and
 * passkey session on a mocked CalimeroClient.
 */
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { BrowserRouter } from "react-router-dom";
import type { CalimeroClient, CalimeroSession } from "@calimero-network/mero-js";
import { SessionStore, resolveTarget } from "@calimero-apps/connect";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import App from "./App";
import { SessionProvider } from "./api/sessionContext";
import { APP, type SessionDeps } from "./api/session";
import { rememberMinted } from "./api/teams";

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
    redeemInvite: vi.fn(async () => ({ org: "org-1" })),
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
  it("signed out, lands on the invitation page, not the landing hero", async () => {
    localStorage.setItem(PENDING, "tok-xyz");
    renderApp(fakeClient());

    expect(await screen.findByTestId("invitation-page", {}, SLOW)).toBeTruthy();
    expect(screen.getByRole("heading", { name: "You're invited" })).toBeTruthy();
    expect(screen.getByText(/invited to join a team in Mero PixArt/)).toBeTruthy();
    expect(screen.queryByRole("heading", { level: 1, name: "Mero PixArt" })).toBeNull();
    expect(screen.getByTestId("signin-passkey")).toBeTruthy();
  });

  it("signing in from the invitation page redeems it and opens the team", async () => {
    const client = fakeClient();
    localStorage.setItem(PENDING, "tok-xyz");
    renderApp(client);

    fireEvent.click(await screen.findByTestId("signin-passkey", {}, SLOW));
    await waitFor(() => expect(client.redeemInvite).toHaveBeenCalledWith("tok-xyz"), SLOW);
    await waitFor(() => expect(window.location.pathname).toBe("/teams/org-1/projects"), SLOW);
    expect(localStorage.getItem(PENDING)).toBeNull();
  });

  it('"Not now" shows the landing page and keeps the invite', async () => {
    localStorage.setItem(PENDING, "tok-xyz");
    renderApp(fakeClient());

    fireEvent.click(await screen.findByTestId("invitation-not-now", {}, SLOW));
    expect(await screen.findByRole("heading", { level: 1, name: "Mero PixArt" }, SLOW)).toBeTruthy();
    expect(localStorage.getItem(PENDING)).toBe("tok-xyz");
    expect(screen.getAllByRole("button", { name: "Sign in" }).length).toBeGreaterThan(0);
  });

  it("says plainly when the invite was already used or has expired", async () => {
    const client = fakeClient({ signedIn: true });
    client.redeemInvite.mockRejectedValueOnce(Object.assign(new Error("unknown invite"), { status: 404 }));
    new SessionStore(APP, resolveTarget(DEV_ENV), localStorage).save(SESSION);
    localStorage.setItem(PENDING, "tok-spent");
    renderApp(client);

    expect((await screen.findByTestId("invitation-error", {}, SLOW)).textContent).toBe(
      "This invite was already used or has expired. Ask the person who invited you for a new link.",
    );
    expect(localStorage.getItem(PENDING)).toBeNull();
  });

  it("is not spent on someone already in its team", async () => {
    const client = fakeClient({ signedIn: true });
    new SessionStore(APP, resolveTarget(DEV_ENV), localStorage).save(SESSION);
    rememberMinted("tok-own", "org-1");
    localStorage.setItem(PENDING, "tok-own");
    renderApp(client);

    expect(await screen.findByTestId("invitation-already-member", {}, SLOW)).toBeTruthy();
    expect(screen.getByText("You're already in this team")).toBeTruthy();
    expect(client.redeemInvite).not.toHaveBeenCalled();
    expect(localStorage.getItem(PENDING)).toBeNull();
  });
});
