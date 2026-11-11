/**
 * An invite link: the invitation page for a signed-out visitor, "Join this
 * workspace?" right after signing in, and the two ends that spend nothing
 * (already a member) or cannot (a spent invite). Runs `InvitationHost` around
 * a stand-in for the app on the real passkey session and a mocked
 * CalimeroClient; the landing page is generated and tested on its own.
 */
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { CalimeroError, type CalimeroSession } from "@calimero-network/mero-js";
import { SessionStore, resolveTarget } from "@calimero-apps/connect";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { InvitationHost } from "./SignIn";
import { APP, type SessionDeps } from "./session";
import { SessionProvider } from "./sessionContext";
import { inviteLink, invites, migrateLegacyInvite } from "./lib/orgs";
import { getActive } from "./lib/workspaceStore";
import { withRoutes } from "@calimero-apps/connect/testing";

const SESSION: CalimeroSession = { accountId: "acct-me", sessionToken: "s", refreshToken: "r", expiresAt: 9e12 };
const DEV_ENV = { DEV: true, VITE_CALIMERO_BUNDLE: "bundle-hash" };
/** Hold `token` as the pending invite, as a captured link to workspace `app-1` would. */
const hold = (token: string, org: string | null = null) =>
  invites.put({ token, org, team: null, doc: null, route: null, extra: { workspace: "app-1" } });

function fakeClient(opts: { signedIn?: boolean; inviteOnly?: boolean } = {}) {
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
    me: vi.fn(async () => ({ accountId: "acct-me", orgs: [{ orgId: "org-1", name: "Acme", role: "owner" }] })),
    redeemInvite: vi.fn(async () => ({ org: "org-2" })),
    // What core's `GET /sign-up` answers on an invite-only cluster.
    ...(opts.inviteOnly
      ? withRoutes({
          signUpPolicy: vi.fn(async () => ({
            policy: "invite",
            orgInvites: true,
            signUpInvites: true,
            inviteRequired: true,
          })),
        })
      : {}),
  });
}

function renderHost(client: ReturnType<typeof fakeClient>, onJoined = vi.fn()) {
  const deps: SessionDeps = {
    env: DEV_ENV,
    makeClient: async () => withRoutes(client),
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
  invites.drop();
  window.history.replaceState(null, "", "/");
});
afterEach(cleanup);

describe("an invite link", () => {
  it("names the org beside the token and workspace, and is captured with it", () => {
    const link = inviteLink("inv_1", "app-1", { href: "https://x.example/#/team" }, "org-1");
    window.history.replaceState(null, "", new URL(link).pathname + new URL(link).search);
    invites.capture(window.location);
    expect(invites.token()).toBe("inv_1");
    expect(invites.pending()?.org).toBe("org-1");
    expect(invites.pending()?.extra).toEqual({ workspace: "app-1" });
    expect(window.location.search).toBe("");
  });

  it("moves an invite an earlier build stored under its own key into the shared store", () => {
    localStorage.setItem("mero-forms:pending-invite", JSON.stringify({ token: "inv_old", workspace: "app-1", org: "org-1" }));
    migrateLegacyInvite();
    expect(invites.token()).toBe("inv_old");
    expect(invites.pending()?.extra).toEqual({ workspace: "app-1" });
    expect(localStorage.getItem("mero-forms:pending-invite")).toBeNull();
  });

  it("shows an invitation page, not the landing page, to a signed-out visitor", async () => {
    hold("tok-1");
    renderHost(fakeClient());

    expect(await screen.findByTestId("invitation-page")).toBeTruthy();
    expect(screen.getByText(/You've been invited to join the workspace in Mero Forms/)).toBeTruthy();
    expect(screen.getByTestId("signin-passkey")).toBeTruthy();
    expect(screen.queryByText("the landing page")).toBeNull();
  });

  it("lets an invited visitor create an account on an invite-only cluster, with the link's token", async () => {
    const client = fakeClient({ inviteOnly: true });
    hold("tok-1");
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
    // The node names the org the invite joined in the sign-up's answer.
    client.signUp.mockImplementationOnce(async () => ({ ...SESSION, org: "org-2" }) as CalimeroSession);
    hold("tok-1", "org-2");
    const onJoined = renderHost(client);

    const create = await screen.findByTestId("signup-passkey");
    expect(create.textContent).toBe("Create your account and join the workspace");
    fireEvent.click(create);
    await waitFor(() => expect(client.signUp).toHaveBeenCalledWith(expect.anything(), "", { invite: "tok-1" }));
    expect(await screen.findByText("the landing page")).toBeTruthy();
    expect(client.signIn).not.toHaveBeenCalled();
    expect(client.redeemInvite).not.toHaveBeenCalled();
    expect(onJoined).toHaveBeenCalled();
    expect(invites.token()).toBeNull();
    expect(getActive()).toEqual({ appId: "app-1", org: "org-2" });
  });

  it('"Not now" shows the landing page and keeps the invitation', async () => {
    hold("tok-1");
    renderHost(fakeClient());

    fireEvent.click(await screen.findByTestId("invitation-later"));
    expect(await screen.findByText("the landing page")).toBeTruthy();
    expect(invites.token()).toBe("tok-1");
  });

  it("asks to join right after signing in from the invitation page", async () => {
    const client = fakeClient();
    hold("tok-1");
    const onJoined = renderHost(client);

    fireEvent.click(await screen.findByTestId("signin-passkey"));
    await waitFor(() => expect(client.signIn).toHaveBeenCalled());
    expect(client.redeemInvite).not.toHaveBeenCalled();
    fireEvent.click(await screen.findByTestId("invitation-join"));
    await waitFor(() => expect(client.redeemInvite).toHaveBeenCalledWith("tok-1"));
    await waitFor(() => expect(onJoined).toHaveBeenCalled());
    expect(await screen.findByText("the landing page")).toBeTruthy();
    expect(invites.token()).toBeNull();
  });

  it("tells a member of the invited org they are already in it, without spending the invite", async () => {
    storeSession();
    hold("tok-own", "org-1");
    const client = fakeClient({ signedIn: true });
    renderHost(client);

    expect(await screen.findByText("You're already in this workspace")).toBeTruthy();
    expect(client.redeemInvite).not.toHaveBeenCalled();
    expect(invites.token()).toBeNull();
  });

  it("says plainly when the invite was already used or has expired", async () => {
    storeSession();
    hold("tok-spent");
    const client = fakeClient({ signedIn: true });
    client.redeemInvite.mockRejectedValueOnce(new CalimeroError(404, "NOT_FOUND", "unknown invite"));
    renderHost(client);

    fireEvent.click(await screen.findByTestId("invitation-join"));
    expect(
      await screen.findByText("This invite was already used or has expired. Ask the person who invited you for a new link."),
    ).toBeTruthy();
    expect(invites.token()).toBeNull();
  });

  it.each([
    [429, "RATE_LIMITED", /Too many tries/],
    [401, "UNAUTHENTICATED", /sign in again/],
  ])("keeps the invite when redeeming answers %i, and says to try again (B6)", async (status, code, says) => {
    storeSession();
    hold("tok-1");
    const client = fakeClient({ signedIn: true });
    client.redeemInvite.mockRejectedValueOnce(new CalimeroError(status, code, "not now"));
    renderHost(client);

    fireEvent.click(await screen.findByTestId("invitation-join"));
    expect((await screen.findByTestId("invitation-error")).textContent).toMatch(says);
    expect(invites.token()).toBe("tok-1");
  });
});
