import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { CalimeroError, type CalimeroClient, type CalimeroSession } from "@calimero-network/mero-js";
import { SessionStore, resolveTarget } from "@calimero-apps/connect";

import App from "./App";
import { APP_NAME } from "./lib/config";
import { SessionProvider } from "./lib/sessionContext";
import type { SessionDeps } from "./lib/session";
import { dropInvite, migrateLegacyInvite, pendingInvite } from "./lib/companies";

/** Hold an invite stored the way an earlier build stored it: it moves into the shared store. */
function hold(legacy: string) {
  localStorage.setItem("mero-updates:pending-invite", legacy);
  migrateLegacyInvite();
}

// An invitation link, end to end on the real passkey session over a fake
// client: the page a signed-out visitor sees, the join prompt the sign-in
// leads to, and the cases where joining must not (or cannot) happen.

vi.mock("./pages/landing/LandingPage", () => ({ default: () => <p>landing</p> }));
vi.mock("./pages/CompaniesPage", () => ({ default: () => <p>companies</p> }));
vi.mock("./pages/AudiencesPage", () => ({ default: () => <p>audiences</p> }));
vi.mock("./components/AudienceShell", () => ({ default: () => <p>updates</p> }));

const ME = "ana";
const SESSION: CalimeroSession = { accountId: ME, sessionToken: "s", refreshToken: "r", expiresAt: 9e12 };
const DEV_ENV = { DEV: true, VITE_CALIMERO_BUNDLE: "bundle-1" };

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
    me: vi.fn(async () => ({ orgs: [{ orgId: "org-1", name: "Acme", role: "owner" }] })),
    listApps: vi.fn(async () => []),
    getOrg: vi.fn(async () => ({ name: "Acme", members: { [ME]: "owner" } })),
    redeemInvite: vi.fn(async () => ({ org: "org-2" })),
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

function remember() {
  const store = new SessionStore(APP_NAME, resolveTarget(DEV_ENV));
  store.sync({ session: SESSION } as unknown as CalimeroClient);
}

function boot(client: ReturnType<typeof fakeClient>, path = "/") {
  render(
    <SessionProvider deps={deps(client)}>
      <MemoryRouter initialEntries={[path]}>
        <App />
      </MemoryRouter>
    </SessionProvider>,
  );
}

// jsdom has `<dialog>` but not `showModal()`/`close()`.
beforeAll(() => {
  const proto = window.HTMLDialogElement.prototype;
  proto.showModal = vi.fn(function (this: HTMLDialogElement) {
    this.open = true;
  });
  proto.close = vi.fn(function (this: HTMLDialogElement) {
    this.open = false;
    this.dispatchEvent(new Event("close"));
  });
});

beforeEach(() => {
  localStorage.clear();
  dropInvite();
});
afterEach(cleanup);

describe("an invitation link", () => {
  it("signed out, shows the invitation page in place of the landing page", async () => {
    hold(JSON.stringify({ token: "tok-1", audience: null }));
    boot(fakeClient());
    const page = await screen.findByTestId("invitation-page");
    expect(page).toHaveTextContent("You've been invited to join the company in Mero Updates");
    expect(screen.getByTestId("signin-passkey")).toBeInTheDocument();
    expect(screen.queryByText("landing")).toBeNull();
  });

  it("signing in on the invitation page goes straight to the join prompt, then into the company", async () => {
    hold(JSON.stringify({ token: "tok-1", audience: null }));
    const client = fakeClient();
    boot(client);
    fireEvent.click(await screen.findByTestId("signin-passkey"));
    fireEvent.click(await screen.findByTestId("invitation-join"));
    await waitFor(() => expect(client.redeemInvite).toHaveBeenCalledWith("tok-1"));
    // Joined: the company has no name for you yet, so it asks, once.
    const input = (await screen.findByTestId("invitation-name-input")) as HTMLInputElement;
    expect(screen.queryByText("audiences")).toBeNull();
    fireEvent.change(input, { target: { value: "Ana Lee" } });
    fireEvent.click(screen.getByTestId("invitation-name-save"));
    await waitFor(() => expect(client.setMemberMetadata).toHaveBeenCalledWith("org-2", ME, { name: "Ana Lee" }));
    expect(await screen.findByText("audiences")).toBeInTheDocument();
    expect(pendingInvite()).toBeNull();
  });

  it("joining a company that already has your name does not ask for it", async () => {
    hold(JSON.stringify({ token: "tok-1", audience: null }));
    const client = fakeClient();
    client.getOrg.mockImplementation(async () => ({
      name: "Acme",
      members: { [ME]: "member" },
      memberMetadata: { [ME]: { name: "Ana" } },
    }) as never);
    boot(client);
    fireEvent.click(await screen.findByTestId("signin-passkey"));
    fireEvent.click(await screen.findByTestId("invitation-join"));
    expect(await screen.findByText("audiences")).toBeInTheDocument();
    expect(screen.queryByTestId("invitation-name")).toBeNull();
    expect(client.setMemberMetadata).not.toHaveBeenCalled();
  });

  it("an invited newcomer creates the account and joins in one click, and lands in the company", async () => {
    hold(JSON.stringify({ token: "tok-1", audience: null, org: "org-2" }));
    const client = fakeClient();
    boot(client);
    const create = await screen.findByTestId("signup-passkey");
    expect(create).toHaveTextContent("Create your account and join the company");
    fireEvent.click(create);
    await waitFor(() => expect(client.signUp).toHaveBeenCalledWith(expect.anything(), "", { invite: "tok-1" }));
    expect(await screen.findByText("audiences")).toBeInTheDocument();
    expect(client.signIn).not.toHaveBeenCalled();
    expect(client.redeemInvite).not.toHaveBeenCalled();
    expect(screen.queryByTestId("invitation-dialog")).toBeNull();
    expect(pendingInvite()).toBeNull();
  });

  it("does not redeem an invite into a company the account is already in", async () => {
    remember();
    hold(JSON.stringify({ token: "tok-1", audience: null, org: "org-1" }));
    const client = fakeClient();
    boot(client);
    expect(await screen.findByTestId("invitation-member")).toBeInTheDocument();
    expect(screen.getByText("You're already in this company")).toBeInTheDocument();
    expect(client.redeemInvite).not.toHaveBeenCalled();
    expect(pendingInvite()).toBeNull();
  });

  it("says plainly when the invite was already used or has expired", async () => {
    remember();
    hold(JSON.stringify({ token: "tok-1", audience: null }));
    const client = fakeClient();
    client.redeemInvite.mockRejectedValueOnce(new CalimeroError(404, "NOT_FOUND", "unknown invite"));
    boot(client);
    fireEvent.click(await screen.findByTestId("invitation-join"));
    expect(await screen.findByTestId("invitation-error")).toHaveTextContent(
      "This invite was already used or has expired. Ask the person who invited you for a new link.",
    );
    expect(pendingInvite()).toBeNull();
  });

  it.each([
    [429, "RATE_LIMITED", /Too many tries/],
    [401, "UNAUTHENTICATED", /sign in again/],
  ])("keeps the invite when redeeming answers %i, and says to try again (B6)", async (status, code, says) => {
    remember();
    hold(JSON.stringify({ token: "tok-1", audience: null }));
    const client = fakeClient();
    client.redeemInvite.mockRejectedValueOnce(new CalimeroError(status, code, "not now"));
    boot(client);
    fireEvent.click(await screen.findByTestId("invitation-join"));
    expect((await screen.findByTestId("invitation-error")).textContent).toMatch(says);
    expect(pendingInvite()?.token).toBe("tok-1");
  });
});
