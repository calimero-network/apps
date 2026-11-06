/**
 * An invite link opened while signed out: the invitation as a page, then the
 * join prompt once a passkey session exists. Runs App's invitation pieces
 * (`InvitationGate` around the landing page, `InvitationPrompt` above it) on
 * the real passkey session and a mocked CalimeroClient; the landing page is
 * generated and tested on its own, so here it is only the door.
 */
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import type { CalimeroClient, CalimeroSession } from "@calimero-network/mero-js";
import { SessionStore, resolveTarget } from "@calimero-apps/connect";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { InvitationGate, InvitationPrompt } from "./SignIn";
import { APP, type SessionDeps } from "./session";
import { SessionProvider } from "./sessionContext";
import { rememberMinted } from "./lib/orgs";

const SESSION: CalimeroSession = { accountId: "acct-me", sessionToken: "s", refreshToken: "r", expiresAt: 9e12 };
const DEV_ENV = { DEV: true, VITE_CALIMERO_BUNDLE: "bundle-hash" };
const PENDING = "mero-forms:pending-invite";
const pending = (token: string) => JSON.stringify({ token, workspace: "app-1" });

function fakeClient() {
  let session: CalimeroSession | undefined;
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
    me: vi.fn(async () => ({ accountId: "acct-me", orgs: [{ orgId: "org-1", name: "Acme", role: "owner" }] })),
    getOrg: vi.fn(async () => ({ members: { "acct-me": "owner" }, memberMetadata: {} })),
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
      <InvitationPrompt onJoined={() => {}} />
      <InvitationGate>
        <button type="button">Sign in</button>
      </InvitationGate>
    </SessionProvider>,
  );
}

function rememberSession() {
  new SessionStore(APP, resolveTarget(DEV_ENV), localStorage).save(SESSION);
}

beforeEach(() => {
  localStorage.clear();
  window.history.replaceState(null, "", "/");
});
afterEach(cleanup);

describe("an invite link", () => {
  it("signed out, lands on the invitation page, not the landing page", async () => {
    localStorage.setItem(PENDING, pending("tok-1"));
    renderApp(fakeClient());

    expect(await screen.findByTestId("invitation-page")).toBeTruthy();
    expect(screen.getByRole("heading", { name: "You're invited" })).toBeTruthy();
    expect(screen.getByText(/invited to join a workspace in Mero Forms/)).toBeTruthy();
    expect(screen.getByTestId("signin-passkey")).toBeTruthy();
    expect(screen.queryByRole("button", { name: "Sign in" })).toBeNull();
  });

  it("signing in on the invitation page goes straight to the join prompt", async () => {
    const client = fakeClient();
    localStorage.setItem(PENDING, pending("tok-1"));
    renderApp(client);

    fireEvent.click(await screen.findByTestId("signin-passkey"));
    await waitFor(() => expect(client.signIn).toHaveBeenCalled());
    fireEvent.click(await screen.findByTestId("invitation-join"));
    await waitFor(() => expect(client.redeemInvite).toHaveBeenCalledWith("tok-1"));
    await waitFor(() => expect(screen.queryByTestId("invitation-dialog")).toBeNull());
    expect(localStorage.getItem(PENDING)).toBeNull();
  });

  it('"Not now" shows the landing page and keeps the invite', async () => {
    localStorage.setItem(PENDING, pending("tok-1"));
    renderApp(fakeClient());

    fireEvent.click(await screen.findByTestId("invitation-not-now"));
    expect(await screen.findByRole("button", { name: "Sign in" })).toBeTruthy();
    expect(localStorage.getItem(PENDING)).toBe(pending("tok-1"));
  });

  it("says plainly when the invite was already used or has expired", async () => {
    rememberSession();
    localStorage.setItem(PENDING, pending("tok-spent"));
    const client = fakeClient();
    client.redeemInvite.mockRejectedValueOnce(Object.assign(new Error("unknown invite"), { status: 404 }));
    renderApp(client);

    fireEvent.click(await screen.findByTestId("invitation-join"));
    expect((await screen.findByTestId("invitation-error")).textContent).toBe(
      "This invite was already used or has expired. Ask the person who invited you for a new link.",
    );
    expect(localStorage.getItem(PENDING)).toBeNull();
  });

  it("is not spent on someone already in its organization", async () => {
    rememberSession();
    rememberMinted("tok-own", "org-1", localStorage);
    localStorage.setItem(PENDING, pending("tok-own"));
    const client = fakeClient();
    renderApp(client);

    expect(await screen.findByTestId("invitation-already-member")).toBeTruthy();
    expect(screen.getByText("You're already in this workspace")).toBeTruthy();
    expect(screen.queryByTestId("invitation-join")).toBeNull();
    expect(client.redeemInvite).not.toHaveBeenCalled();
    expect(localStorage.getItem(PENDING)).toBeNull();
  });
});
