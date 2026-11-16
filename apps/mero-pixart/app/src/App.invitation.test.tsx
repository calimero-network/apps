/**
 * An invite link: the invitation page for a signed-out visitor, "Join the
 * team?" right after signing in, and the end that spends nothing (already a
 * member). Runs the real App, router and passkey
 * session on a mocked CalimeroClient.
 */
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { BrowserRouter } from "react-router-dom";
import { CalimeroError, type CalimeroSession } from "@calimero-network/mero-js";
import { SessionStore, resolveTarget } from "@calimero-apps/connect";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import App from "./App";
import { SessionProvider } from "./api/sessionContext";
import { APP, type SessionDeps } from "./api/session";
import { invites } from "./api/teams";
import { withRoutes } from "@calimero-apps/connect/testing";

// The shared dialog is mero-react's to test: here only what the app hands it and does after.
vi.mock("@calimero-network/mero-react", async (importOriginal) => {
  const { createElement } = await import("react");
  return {
    ...(await importOriginal<object>()),
    AcceptInviteDialog: (p: {
      open: boolean;
      token: string;
      org?: string;
      appName?: string;
      labels?: { noun?: string };
      onClose: () => void;
      onError?: (e: unknown) => void;
      onJoined: (j: { org: string }) => void;
    }) =>
      p.open
        ? createElement(
            "div",
            { "data-testid": "accept-dialog" },
            createElement("p", { "data-testid": "accept-token" }, `${p.token}|${p.appName}|${p.org}|${p.labels?.noun}`),
            createElement("button", { "data-testid": "accept-done", onClick: () => p.onJoined({ org: "org-2" }) }, "join"),
            createElement("button", { "data-testid": "accept-close", onClick: p.onClose }, "not now"),
            createElement(
              "button",
              {
                "data-testid": "accept-spent",
                onClick: () => p.onError?.(new CalimeroError(400, "REJECTED", "this invite was used up, revoked or never existed")),
              },
              "spent",
            ),
            createElement(
              "button",
              { "data-testid": "accept-lapsed", onClick: () => p.onError?.(new CalimeroError(401, "UNAUTHORIZED", "session ended")) },
              "lapsed",
            ),
          )
        : null,
  };
});

const SESSION: CalimeroSession = { accountId: "acct-me", sessionToken: "s", refreshToken: "r", expiresAt: 9e12 };
const DEV_ENV = { DEV: true, VITE_CALIMERO_BUNDLE: "bundle-hash" };
/** Hold `token` as the pending invite, as a captured link would. */
function hold(token: string, org: string | null = null) {
  invites.put({ token, org, team: null, doc: null, route: null, extra: {} });
}
const SLOW = { timeout: 10_000 };
const TEST_TIMEOUT = 15_000; // above SLOW, so a cold first render fails on the finder, not the test

function fakeClient(opts: { signedIn?: boolean } = {}) {
  let session: CalimeroSession | undefined = opts.signedIn ? SESSION : undefined;
  return withRoutes({
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
    setMemberMetadata: vi.fn(async () => undefined),
  });
}

function renderApp(client: ReturnType<typeof fakeClient>) {
  const deps: SessionDeps = {
    env: DEV_ENV,
    makeClient: async () => withRoutes(client),
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

describe("an invite link", { timeout: TEST_TIMEOUT }, () => {
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
    expect((await screen.findByTestId("accept-token", {}, SLOW)).textContent).toBe("tok-xyz|Mero Pixart|undefined|team");
    fireEvent.click(screen.getByTestId("accept-done"));
    // The team has no name for you: asked once, here, then on to the team.
    fireEvent.change(await screen.findByTestId("username-input", {}, SLOW), { target: { value: "Sandi" } });
    fireEvent.click(screen.getByTestId("username-submit"));
    await waitFor(() => expect(client.setMemberMetadata).toHaveBeenCalledWith("org-2", "acct-me", { name: "Sandi" }), SLOW);
    await waitFor(() => expect(window.location.pathname).toBe("/teams/org-2/projects"), SLOW);
    expect(invites.token()).toBeNull();
  });

  it("does not ask for a name on joining a team that already has yours", async () => {
    const client = fakeClient({ signedIn: true });
    client.getOrg.mockResolvedValue({
      members: { "acct-me": "member" },
      memberMetadata: { "acct-me": { name: "Sandi" } },
      capabilities: {},
      defaultCapabilities: 3,
    });
    storeSession();
    hold("tok-xyz");
    renderApp(client);

    fireEvent.click(await screen.findByTestId("accept-done", {}, SLOW));
    await waitFor(() => expect(window.location.pathname).toBe("/teams/org-2/projects"), SLOW);
    expect(screen.queryByTestId("username-input")).toBeNull();
    expect(client.setMemberMetadata).not.toHaveBeenCalled();
  });

  it("hands the link's team to the dialog, which tells a member without spending the invite", async () => {
    const client = fakeClient({ signedIn: true });
    storeSession();
    hold("tok-xyz", "org-1");
    renderApp(client);

    expect((await screen.findByTestId("accept-token", {}, SLOW)).textContent).toBe("tok-xyz|Mero Pixart|org-1|team");
    expect(client.redeemInvite).not.toHaveBeenCalled();
  });

  it("a member who continues drops the invite and opens the team", async () => {
    const client = fakeClient({ signedIn: true });
    client.getOrg.mockResolvedValue({
      members: { "acct-me": "owner" },
      memberMetadata: { "acct-me": { name: "Sandi" } },
      capabilities: {},
      defaultCapabilities: 3,
    });
    storeSession();
    hold("tok-xyz", "org-1");
    renderApp(client);

    fireEvent.click(await screen.findByTestId("accept-done", {}, SLOW));
    await waitFor(() => expect(window.location.pathname).toBe("/teams/org-2/projects"), SLOW);
    expect(invites.token()).toBeNull();
  });

  it("a spent invite is dropped from storage but stays on screen until Not now", async () => {
    storeSession();
    hold("tok-xyz", "org-1");
    renderApp(fakeClient({ signedIn: true }));

    fireEvent.click(await screen.findByTestId("accept-spent", {}, SLOW));
    expect(invites.token()).toBeNull();
    expect(screen.getByTestId("accept-token").textContent).toBe("tok-xyz|Mero Pixart|org-1|team");
    fireEvent.click(screen.getByTestId("accept-close"));
    await waitFor(() => expect(screen.queryByTestId("accept-dialog")).toBeNull(), SLOW);
  });

  it("keeps the invite when the failure is a lapsed session, not the invite", async () => {
    storeSession();
    hold("tok-xyz");
    renderApp(fakeClient({ signedIn: true }));

    fireEvent.click(await screen.findByTestId("accept-lapsed", {}, SLOW));
    expect(invites.token()).toBe("tok-xyz");
  });

  it("drops the invitation on Not now and shows the app", async () => {
    const client = fakeClient({ signedIn: true });
    storeSession();
    hold("tok-xyz");
    renderApp(client);

    fireEvent.click(await screen.findByTestId("accept-close", {}, SLOW));
    await waitFor(() => expect(screen.queryByTestId("accept-dialog")).toBeNull(), SLOW);
    expect(invites.token()).toBeNull();
    expect(client.redeemInvite).not.toHaveBeenCalled();
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
});
