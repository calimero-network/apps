import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { CalimeroError, type CalimeroClient, type CalimeroSession } from "@calimero-network/mero-js";
import { SessionStore, resolveTarget } from "@calimero-apps/connect";

import App from "./App";
import { APP_NAME } from "./lib/config";
import { SessionProvider } from "./lib/sessionContext";
import type { SessionDeps } from "./lib/session";
import { getActiveNamespaceId, getContextId } from "./lib/active";
import { dropInvite, migrateLegacyInvite, pendingInvite } from "./lib/companies";
import { withRoutes } from "@calimero-apps/connect/testing";

/** Hold an invite stored the way an earlier build stored it: it moves into the shared store. */
function hold(legacy: string) {
  localStorage.setItem("mero-updates:pending-invite", legacy);
  migrateLegacyInvite();
}

// An invitation link, end to end on the real passkey session over a fake
// client: the page a signed-out visitor sees, the join prompt the sign-in
// leads to, and the cases where joining must not (or cannot) happen.

// The shared dialog is mero-react's to test: here only what the app hands it and does after.
vi.mock("@calimero-network/mero-react", async (importOriginal) => {
  const { createElement } = await import("react");
  return {
    ...(await importOriginal<object>()),
    AcceptInviteDialog: (p: { open: boolean; token: string; org?: string; appName?: string; labels?: { noun?: string; body?: string }; onClose: () => void; onError?: (e: unknown) => void; onJoined: (j: { org: string }) => void }) =>
      p.open
        ? createElement(
            "div",
            { "data-testid": "accept-dialog" },
            createElement("p", { "data-testid": "accept-token" }, `${p.token} ${p.appName}`),
            createElement("p", { "data-testid": "accept-extra" }, JSON.stringify({ org: p.org, noun: p.labels?.noun, body: p.labels?.body })),
            createElement("button", { "data-testid": "accept-join", onClick: () => p.onJoined({ org: "org-2" }) }, "join"),
            createElement("button", { "data-testid": "accept-close", onClick: p.onClose }, "close"),
            createElement("button", { "data-testid": "accept-spent", onClick: () => p.onError?.(new CalimeroError(400, "REJECTED", "unknown invite")) }, "spent"),
            createElement("button", { "data-testid": "accept-offline", onClick: () => p.onError?.(new CalimeroError(503, "UNAVAILABLE", "node unreachable")) }, "offline"),
          )
        : null,
  };
});

vi.mock("./pages/landing/LandingPage", () => ({ default: () => <p>landing</p> }));
vi.mock("./pages/CompaniesPage", () => ({ default: () => <p>companies</p> }));
vi.mock("./pages/AudiencesPage", () => ({ default: () => <p>audiences</p> }));
vi.mock("./components/AudienceShell", () => ({ default: () => <p>updates</p> }));

const ME = "ana";
const SESSION: CalimeroSession = { accountId: ME, sessionToken: "s", refreshToken: "r", expiresAt: 9e12 };
const DEV_ENV = { DEV: true, VITE_CALIMERO_BUNDLE: "bundle-1" };

function fakeClient() {
  let session: CalimeroSession | undefined;
  return withRoutes({
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
  });
}

function deps(client: ReturnType<typeof fakeClient>): SessionDeps {
  return {
    env: DEV_ENV,
    makeClient: vi.fn(async () => withRoutes(client)),
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
    expect(page).toHaveTextContent("You've been invited to join the company in Hyperfeed Updates");
    expect(screen.getByTestId("signin-passkey")).toBeInTheDocument();
    expect(screen.queryByText("landing")).toBeNull();
  });

  it("signing in on the invitation page goes straight to the join prompt, then into the company", async () => {
    hold(JSON.stringify({ token: "tok-1", audience: null }));
    const client = fakeClient();
    boot(client);
    fireEvent.click(await screen.findByTestId("signin-passkey"));
    expect((await screen.findByTestId("accept-token")).textContent).toBe("tok-1 Hyperfeed Updates");
    fireEvent.click(screen.getByTestId("accept-join"));
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
    fireEvent.click(await screen.findByTestId("accept-join"));
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
    fireEvent.click(await screen.findByTestId("signup-create"));
    await waitFor(() => expect(client.signUp).toHaveBeenCalledWith(expect.anything(), "", { invite: "tok-1" }));
    expect(await screen.findByText("audiences")).toBeInTheDocument();
    expect(client.signIn).not.toHaveBeenCalled();
    expect(screen.queryByTestId("invitation-dialog")).toBeNull();
    expect(screen.queryByTestId("accept-dialog")).toBeNull();
    expect(pendingInvite()).toBeNull();
  });

  it("hands the dialog the invite's company, so a member is told so; continuing opens the company", async () => {
    remember();
    hold(JSON.stringify({ token: "tok-1", audience: null, org: "org-1" }));
    const client = fakeClient();
    client.getOrg.mockImplementation(async () => ({ name: "Acme", members: { [ME]: "owner" }, memberMetadata: { [ME]: { name: "Ana" } } }) as never);
    boot(client);
    const extra = JSON.parse((await screen.findByTestId("accept-extra")).textContent ?? "null");
    expect(extra).toMatchObject({ org: "org-1", noun: "company" });
    expect(client.redeemInvite).not.toHaveBeenCalled();
    fireEvent.click(screen.getByTestId("accept-join"));
    expect(await screen.findByText("audiences")).toBeInTheDocument();
    expect(pendingInvite()).toBeNull();
  });

  it("drops a stored token the node says is spent, and keeps it for a network failure", async () => {
    remember();
    hold(JSON.stringify({ token: "tok-1", audience: null }));
    boot(fakeClient());
    fireEvent.click(await screen.findByTestId("accept-offline"));
    expect(pendingInvite()?.token).toBe("tok-1");
    fireEvent.click(screen.getByTestId("accept-spent"));
    expect(pendingInvite()).toBeNull();
  });

  it("Close on the join dialog drops the invite and joins nothing", async () => {
    remember();
    hold(JSON.stringify({ token: "tok-1", audience: null }));
    boot(fakeClient());
    fireEvent.click(await screen.findByTestId("accept-close"));
    expect(screen.queryByTestId("accept-dialog")).toBeNull();
    expect(pendingInvite()).toBeNull();
  });

  it("an audience link opens that audience once joined", async () => {
    remember();
    hold(JSON.stringify({ token: "tok-1", audience: "aud-9" }));
    const client = fakeClient();
    client.getOrg.mockImplementation(async () => ({ name: "Acme", members: { [ME]: "member" }, memberMetadata: { [ME]: { name: "Ana" } } }) as never);
    boot(client);
    fireEvent.click(await screen.findByTestId("accept-join"));
    await waitFor(() => expect([getContextId(), getActiveNamespaceId()]).toEqual(["aud-9", "org-2"]));
  });

  it("takes an invitation link the shared dialog made (token in the fragment) off the address bar", async () => {
    const { captureInvite } = await import("./lib/companies");
    window.history.replaceState(null, "", "/?org=org-3&audience=aud-9#invite=tok-3");
    captureInvite();
    expect(pendingInvite()).toEqual({ token: "tok-3", audience: "aud-9", org: "org-3" });
    expect(window.location.search + window.location.hash).toBe("");
  });
});
