/**
 * The front door with an invitation link: signed out, the invitation is the
 * page; signing in joins at once and opens the team.
 */
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { CalimeroError, type CalimeroClient, type CalimeroSession } from "@calimero-network/mero-js";
import { MemoryRouter, Route, Routes, useLocation } from "react-router-dom";
import { beforeEach, describe, expect, it, vi } from "vitest";

import App from "./App";
import { SessionProvider } from "./api/sessionContext";
import type { SessionDeps } from "./api/session";

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
    getOrg: vi.fn(async () => ({ name: "Team", members: { [ME]: "owner" }, memberMetadata: {} })),
    redeemInvite: vi.fn(async (): Promise<Record<string, unknown>> => ({ org: "org-1" })),
  };
}

function deps(client: ReturnType<typeof fakeClient>): SessionDeps {
  return {
    env: { DEV: true, VITE_CALIMERO_BUNDLE: "bundle-hash" },
    makeClient: vi.fn(async () => client as unknown as CalimeroClient),
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
});

describe("an invitation link opened while signed out", () => {
  it("shows the invitation as the page, not the landing hero", async () => {
    localStorage.setItem(PENDING, "tok-1");
    renderApp(fakeClient());
    expect(await screen.findByTestId("invitation-page")).toBeTruthy();
    expect(screen.getByText("You're invited")).toBeTruthy();
    expect(screen.getByTestId("signin-desc").textContent).toContain(
      "You've been invited to join a team in Mero Calendar. Sign in or create an account to accept.",
    );
    expect(screen.getByTestId("signin-passkey")).toBeTruthy();
    expect(screen.getByTestId("signup-passkey")).toBeTruthy();
    expect(screen.queryByText("Landing sign in")).toBeNull();
  });

  it("signing in joins straight away and opens the team", async () => {
    localStorage.setItem(PENDING, "tok-1");
    const client = fakeClient();
    renderApp(client);
    fireEvent.click(await screen.findByTestId("signin-passkey"));
    await waitFor(() => expect(client.redeemInvite).toHaveBeenCalledWith("tok-1"));
    expect((await screen.findByTestId("where")).textContent).toBe("/teams/org-1");
    expect(localStorage.getItem(PENDING)).toBeNull();
  });

  it("Not now shows the landing page and keeps the token", async () => {
    localStorage.setItem(PENDING, "tok-1");
    renderApp(fakeClient());
    fireEvent.click(await screen.findByTestId("invitation-not-now"));
    fireEvent.click(await screen.findByText("Landing sign in"));
    expect((await screen.findByTestId("signin-desc")).textContent).toContain("You've been invited");
    expect(localStorage.getItem(PENDING)).toBe("tok-1");
  });

  it("does not spend the link of a team this account is already in", async () => {
    localStorage.setItem(PENDING, "tok-1");
    localStorage.setItem(`${PENDING}-org`, "org-1");
    const client = fakeClient();
    renderApp(client);
    fireEvent.click(await screen.findByTestId("signin-passkey"));
    expect(await screen.findByText("You're already in this team")).toBeTruthy();
    expect(client.redeemInvite).not.toHaveBeenCalled();
    expect(localStorage.getItem(PENDING)).toBeNull();
  });

  it("says plainly when the invite was already used or has expired", async () => {
    localStorage.setItem(PENDING, "tok-1");
    const client = fakeClient();
    client.redeemInvite.mockRejectedValueOnce(new CalimeroError(404, "NOT_FOUND", "unknown invite"));
    renderApp(client);
    fireEvent.click(await screen.findByTestId("signin-passkey"));
    expect((await screen.findByTestId("invitation-message")).textContent).toBe(
      "This invite was already used or has expired. Ask the person who invited you for a new link.",
    );
    expect(localStorage.getItem(PENDING)).toBeNull();
  });
});
