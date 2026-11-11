/**
 * The front door with an invitation link: signed out, the invitation is the
 * page; signing in joins at once and opens the team.
 */
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { CalimeroError, type CalimeroSession } from "@calimero-network/mero-js";
import { MemoryRouter, Route, Routes, useLocation } from "react-router-dom";
import { beforeEach, describe, expect, it, vi } from "vitest";

import App from "./App";
import { SessionProvider } from "./api/sessionContext";
import type { SessionDeps } from "./api/session";
import { invites, migrateLegacyInvite } from "./api/teams";
import { withRoutes } from "@calimero-apps/connect/testing";

// The landing page is generated and tested on its own; here it is the door.
vi.mock("./pages/landing/LandingPage", () => ({
  default: ({ onConnect }: { onConnect?: () => void }) => (
    <button type="button" onClick={onConnect}>
      Landing sign in
    </button>
  ),
}));
// The signed-in screens: only where the app goes matters here.
function Where() {
  return <p data-testid="where">{useLocation().pathname}</p>;
}
vi.mock("./pages/teams/TeamsPage", () => ({ default: Where }));
vi.mock("./pages/teams/TeamCalendarsPage", () => ({ default: Where }));
vi.mock("./pages/calendar", () => ({ default: Where }));
vi.mock("./pages/book/BookPage", () => ({ default: Where }));

const ME = "acct-me";
const SESSION: CalimeroSession = { accountId: ME, sessionToken: "s", refreshToken: "r", expiresAt: 9e12 };
const PENDING = "mero-calendar:pending-invite";

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
    me: vi.fn(async () => ({ accountId: ME, orgs: [{ orgId: "org-1", name: "Team", role: "owner" }] })),
    getOrg: vi.fn(async () => ({ name: "Team", members: { [ME]: "owner" }, memberMetadata: {} })),
    redeemInvite: vi.fn(async (): Promise<Record<string, unknown>> => ({ org: "org-1" })),
    setMemberMetadata: vi.fn(async () => undefined),
  });
}

function deps(client: ReturnType<typeof fakeClient>): SessionDeps {
  return {
    env: { DEV: true, VITE_CALIMERO_BUNDLE: "bundle-hash" },
    makeClient: vi.fn(async () => withRoutes(client)),
    passkey: () => ({ create: vi.fn(), get: vi.fn() }),
  };
}

function renderApp(client: ReturnType<typeof fakeClient>, path = "/") {
  return render(
    <SessionProvider deps={deps(client)}>
      <MemoryRouter initialEntries={[path]}>
        <Routes>
          <Route path="*" element={<App />} />
        </Routes>
      </MemoryRouter>
    </SessionProvider>,
  );
}

beforeEach(() => {
  localStorage.clear();
  sessionStorage.clear();
  invites.drop();
});

describe("an invitation link opened while signed out", () => {
  it("shows the invitation as the page, not the landing hero", async () => {
    localStorage.setItem(PENDING, "tok-1");
    migrateLegacyInvite();
    renderApp(fakeClient());
    expect(await screen.findByTestId("invitation-page")).toBeTruthy();
    expect(screen.getByText("You're invited")).toBeTruthy();
    expect(screen.getByTestId("signin-desc").textContent).toContain(
      "You've been invited to join the team in Mero Calendar.",
    );
    expect(screen.getByTestId("signin-passkey")).toBeTruthy();
    expect(screen.getByTestId("signup-passkey")).toBeTruthy();
    expect(screen.queryByText("Landing sign in")).toBeNull();
  });

  it("signing in asks before joining (B5): nothing is redeemed until Join, which asks your name in the team once and opens it", async () => {
    localStorage.setItem(PENDING, "tok-1");
    migrateLegacyInvite();
    localStorage.setItem("calimero-names:last", "Ada");
    const client = fakeClient();
    renderApp(client);
    fireEvent.click(await screen.findByTestId("signin-passkey"));
    expect(await screen.findByTestId("invitation-prompt")).toBeTruthy();
    expect(screen.getByText("Join the team?")).toBeTruthy();
    await new Promise((r) => setTimeout(r, 50));
    expect(client.redeemInvite).not.toHaveBeenCalled();
    fireEvent.click(screen.getByTestId("invitation-join"));
    await waitFor(() => expect(client.redeemInvite).toHaveBeenCalledWith("tok-1"));
    const input = (await screen.findByTestId("username-input")) as HTMLInputElement;
    expect(input.value).toBe("Ada");
    fireEvent.change(input, { target: { value: "Ada L" } });
    fireEvent.click(screen.getByTestId("username-submit"));
    await waitFor(() => expect(screen.getByTestId("where").textContent).toBe("/teams/org-1"));
    expect(client.setMemberMetadata).toHaveBeenCalledWith("org-1", ME, { name: "Ada L" });
    expect(invites.token()).toBeNull();
  });

  it("does not ask for a name the team already has for you", async () => {
    localStorage.setItem(PENDING, "tok-1");
    migrateLegacyInvite();
    const client = fakeClient();
    client.getOrg.mockResolvedValue({ name: "Team", members: { [ME]: "member" }, memberMetadata: { [ME]: { name: "Ada" } } });
    renderApp(client);
    fireEvent.click(await screen.findByTestId("signin-passkey"));
    fireEvent.click(await screen.findByTestId("invitation-join"));
    await waitFor(() => expect(screen.getByTestId("where").textContent).toBe("/teams/org-1"));
    expect(screen.queryByTestId("username-modal")).toBeNull();
    expect(client.setMemberMetadata).not.toHaveBeenCalled();
  });

  it("Not now shows the landing page and keeps the token", async () => {
    localStorage.setItem(PENDING, "tok-1");
    migrateLegacyInvite();
    renderApp(fakeClient());
    fireEvent.click(await screen.findByTestId("invitation-not-now"));
    fireEvent.click(await screen.findByText("Landing sign in"));
    expect((await screen.findByTestId("signin-desc")).textContent).toContain("You've been invited");
    expect(invites.token()).toBe("tok-1");
  });

  it("does not spend the link of a team this account is already in", async () => {
    localStorage.setItem(PENDING, "tok-1");
    localStorage.setItem(`${PENDING}-org`, "org-1");
    migrateLegacyInvite();
    const client = fakeClient();
    renderApp(client);
    fireEvent.click(await screen.findByTestId("signin-passkey"));
    expect(await screen.findByText("You're already in the team")).toBeTruthy();
    expect(client.redeemInvite).not.toHaveBeenCalled();
    expect(invites.token()).toBeNull();
    fireEvent.click(screen.getByTestId("invitation-continue"));
    expect((await screen.findByTestId("where")).textContent).toBe("/teams/org-1");
  });

  it("says plainly when the invite was already used or has expired", async () => {
    localStorage.setItem(PENDING, "tok-1");
    migrateLegacyInvite();
    const client = fakeClient();
    client.redeemInvite.mockRejectedValueOnce(new CalimeroError(404, "NOT_FOUND", "unknown invite"));
    renderApp(client);
    fireEvent.click(await screen.findByTestId("signin-passkey"));
    fireEvent.click(await screen.findByTestId("invitation-join"));
    expect((await screen.findByTestId("invitation-outcome")).textContent).toContain(
      "This invite was already used or has expired. Ask the person who invited you for a new link.",
    );
    expect(invites.token()).toBeNull();
  });

  it("creating the account joins in that step and opens the page the link named (B10)", async () => {
    window.history.replaceState(null, "", "/?invite=tok-1&to=%2Fteams%2Forg-2");
    invites.capture(window.location);
    window.history.replaceState(null, "", "/");
    const client = fakeClient();
    renderApp(client);
    fireEvent.click(await screen.findByTestId("signup-passkey"));
    await waitFor(() => expect(client.signUp).toHaveBeenCalledWith(expect.anything(), "", { invite: "tok-1" }));
    await waitFor(() => expect(screen.getByTestId("where").textContent).toBe("/teams/org-2"));
    expect(client.redeemInvite).not.toHaveBeenCalled();
    expect(invites.token()).toBeNull();
  });

  it.each([
    [429, "RATE_LIMITED", /Too many tries/],
    [401, "UNAUTHENTICATED", /sign in again/],
  ])("keeps the invite when redeeming answers %i (B6)", async (status, code, says) => {
    invites.put({ token: "tok-1", org: null, team: null, doc: null, route: null, extra: {} });
    const client = fakeClient();
    client.redeemInvite.mockRejectedValueOnce(new CalimeroError(status, code, "not now"));
    renderApp(client);
    fireEvent.click(await screen.findByTestId("signin-passkey"));
    fireEvent.click(await screen.findByTestId("invitation-join"));
    expect((await screen.findByTestId("invitation-error")).textContent).toMatch(says);
    expect(invites.token()).toBe("tok-1");
  });

  it("Not now at the join prompt drops the invite and joins nothing (B5)", async () => {
    invites.put({ token: "tok-1", org: null, team: null, doc: null, route: null, extra: {} });
    const client = fakeClient();
    renderApp(client);
    fireEvent.click(await screen.findByTestId("signin-passkey"));
    fireEvent.click(await screen.findByTestId("invitation-dismiss"));
    await waitFor(() => expect(screen.queryByTestId("invitation-prompt")).toBeNull());
    expect(client.redeemInvite).not.toHaveBeenCalled();
    expect(invites.token()).toBeNull();
  });
});
