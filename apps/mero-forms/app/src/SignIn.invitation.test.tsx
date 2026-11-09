/**
 * An invite link: the invitation page for a signed-out visitor, "Join this
 * workspace?" right after signing in, and the two ends that spend nothing
 * (already a member) or cannot (a spent invite). Runs `InvitationHost` around
 * a stand-in for the app on the real passkey session and a mocked
 * CalimeroClient; the landing page is generated and tested on its own.
 */
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { CalimeroError, type CalimeroClient, type CalimeroSession } from "@calimero-network/mero-js";
import { SessionStore, resolveTarget } from "@calimero-apps/connect";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { InvitationHost } from "./SignIn";
import { APP, type SessionDeps } from "./session";
import { SessionProvider } from "./sessionContext";
import { captureInvite, inviteLink, pendingInvite } from "./lib/orgs";
import { getActive } from "./lib/workspaceStore";

const SESSION: CalimeroSession = { accountId: "acct-me", sessionToken: "s", refreshToken: "r", expiresAt: 9e12 };
const DEV_ENV = { DEV: true, VITE_CALIMERO_BUNDLE: "bundle-hash" };
const PENDING = "mero-forms:pending-invite";
const pending = (token: string, org: string | null = null) => JSON.stringify({ token, workspace: "app-1", org });

function fakeClient(opts: { signedIn?: boolean; inviteOnly?: boolean } = {}) {
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
    me: vi.fn(async () => ({ accountId: "acct-me", orgs: [{ orgId: "org-1", name: "Acme", role: "owner" }] })),
    redeemInvite: vi.fn(async () => ({ org: "org-2" })),
    // What core's `GET /sign-up` answers on an invite-only cluster.
    ...(opts.inviteOnly
      ? {
          signUpPolicy: vi.fn(async () => ({
            policy: "invite",
            orgInvites: true,
            signUpInvites: true,
            inviteRequired: true,
          })),
        }
      : {}),
  };
}

function renderHost(client: ReturnType<typeof fakeClient>, onJoined = vi.fn()) {
  const deps: SessionDeps = {
    env: DEV_ENV,
    makeClient: async () => client as unknown as CalimeroClient,
    passkey: () => ({}) as never,
  };
  render(
    <SessionProvider deps={deps}>
      <InvitationHost onJoined={onJoined}>
        <p>the landing page</p>
      </InvitationHost>
    </SessionProvider>,
  );
  return onJoined;
}

function storeSession() {
  new SessionStore(APP, resolveTarget(DEV_ENV), localStorage).save(SESSION);
}

beforeEach(() => {
  localStorage.clear();
  window.history.replaceState(null, "", "/");
});
afterEach(cleanup);

describe("an invite link", () => {
  it("names the org beside the token and workspace, and is captured with it", () => {
    const link = inviteLink("inv_1", "app-1", { origin: "https://x.example", pathname: "/1.0.0/" }, "org-1");
    window.history.replaceState(null, "", new URL(link).pathname + new URL(link).search);
    captureInvite();
    expect(pendingInvite()).toEqual({ token: "inv_1", workspace: "app-1", org: "org-1" });
    expect(window.location.search).toBe("");
  });

  it("shows an invitation page, not the landing page, to a signed-out visitor", async () => {
    localStorage.setItem(PENDING, pending("tok-1"));
    renderHost(fakeClient());

    expect(await screen.findByTestId("invitation-page")).toBeTruthy();
    expect(screen.getByText(/You've been invited to join the workspace in Mero Forms/)).toBeTruthy();
    expect(screen.getByTestId("signin-passkey")).toBeTruthy();
    expect(screen.queryByText("the landing page")).toBeNull();
  });

  it("lets an invited visitor create an account on an invite-only cluster, with the link's token", async () => {
    const client = fakeClient({ inviteOnly: true });
    localStorage.setItem(PENDING, pending("tok-1"));
    renderHost(client);

    await waitFor(() => expect(client.signUpPolicy).toHaveBeenCalled());
    const signUp = (await screen.findByTestId("signup-passkey")) as HTMLButtonElement;
    expect(signUp.disabled).toBe(false);
    expect(screen.queryByTestId("signup-unavailable")).toBeNull();
    fireEvent.click(signUp);
    await waitFor(() => expect(client.signUp).toHaveBeenCalledWith(expect.anything(), "", { invite: "tok-1" }));
  });

  it("an invited newcomer creates the account and joins in one click, and lands in the workspace", async () => {
    const client = fakeClient();
    localStorage.setItem(PENDING, pending("tok-1", "org-2"));
    const onJoined = renderHost(client);

    const create = await screen.findByTestId("signup-passkey");
    expect(create.textContent).toBe("Create your account and join the workspace");
    fireEvent.click(create);
    await waitFor(() => expect(client.signUp).toHaveBeenCalledWith(expect.anything(), "", { invite: "tok-1" }));
    expect(await screen.findByText("the landing page")).toBeTruthy();
    expect(client.signIn).not.toHaveBeenCalled();
    expect(client.redeemInvite).not.toHaveBeenCalled();
    expect(onJoined).toHaveBeenCalled();
    expect(localStorage.getItem(PENDING)).toBeNull();
    expect(getActive()).toEqual({ appId: "app-1", org: "org-2" });
  });

  it('"Not now" shows the landing page and keeps the invitation', async () => {
    localStorage.setItem(PENDING, pending("tok-1"));
    renderHost(fakeClient());

    fireEvent.click(await screen.findByTestId("invitation-later"));
    expect(await screen.findByText("the landing page")).toBeTruthy();
    expect(localStorage.getItem(PENDING)).toBe(pending("tok-1"));
  });

  it("asks to join right after signing in from the invitation page", async () => {
    const client = fakeClient();
    localStorage.setItem(PENDING, pending("tok-1"));
    const onJoined = renderHost(client);

    fireEvent.click(await screen.findByTestId("signin-passkey"));
    await waitFor(() => expect(client.signIn).toHaveBeenCalled());
    expect(client.redeemInvite).not.toHaveBeenCalled();
    fireEvent.click(await screen.findByTestId("invitation-join"));
    await waitFor(() => expect(client.redeemInvite).toHaveBeenCalledWith("tok-1"));
    await waitFor(() => expect(onJoined).toHaveBeenCalled());
    expect(await screen.findByText("the landing page")).toBeTruthy();
    expect(localStorage.getItem(PENDING)).toBeNull();
  });

  it("tells a member of the invited org they are already in it, without spending the invite", async () => {
    storeSession();
    localStorage.setItem(PENDING, pending("tok-own", "org-1"));
    const client = fakeClient({ signedIn: true });
    renderHost(client);

    expect(await screen.findByText("You're already in this workspace")).toBeTruthy();
    expect(client.redeemInvite).not.toHaveBeenCalled();
    expect(localStorage.getItem(PENDING)).toBeNull();
  });

  it("says plainly when the invite was already used or has expired", async () => {
    storeSession();
    localStorage.setItem(PENDING, pending("tok-spent"));
    const client = fakeClient({ signedIn: true });
    client.redeemInvite.mockRejectedValueOnce(new CalimeroError(404, "NOT_FOUND", "unknown invite"));
    renderHost(client);

    fireEvent.click(await screen.findByTestId("invitation-join"));
    expect(
      await screen.findByText("This invite was already used or has expired. Ask the person who invited you for a new link."),
    ).toBeTruthy();
    expect(localStorage.getItem(PENDING)).toBeNull();
  });
});
