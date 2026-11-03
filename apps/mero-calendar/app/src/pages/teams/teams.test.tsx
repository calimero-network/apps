/**
 * The teams list and a team's calendars, on a mocked CalimeroClient: teams are
 * orgs, calendars are this app's instances in the org.
 */
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { MemoryRouter, Route, Routes } from "react-router-dom";
import { beforeEach, describe, expect, it, vi } from "vitest";

const ME = "acct-me";
const client = {
  me: vi.fn(),
  createOrg: vi.fn(),
  setCapabilities: vi.fn(),
  deleteOrg: vi.fn(),
  removeMember: vi.fn(),
  invite: vi.fn(),
  listApps: vi.fn(),
  getOrg: vi.fn(),
  createApp: vi.fn(),
  deleteApp: vi.fn(),
};

// Stable, as the real hook's value is (memoized per session).
const signedIn = {
  client,
  accountId: ME,
  source: "bundle-hash",
  passkey: () => ({}),
  after: () => {},
  targetKey: "local:test",
};

vi.mock("../../api/sessionContext", () => ({
  useSignedIn: () => signedIn,
  useSessionApi: () => ({ api: { session: { status: "signed-in" }, signOut: vi.fn() } }),
}));

import TeamsPage from "./TeamsPage";
import TeamCalendarsPage from "./TeamCalendarsPage";

function renderAt(path: string) {
  return render(
    <MemoryRouter initialEntries={[path]}>
      <Routes>
        <Route path="/teams" element={<TeamsPage />} />
        <Route path="/teams/:teamId" element={<TeamCalendarsPage />} />
        <Route path="/teams/:teamId/calendar/:contextId" element={<p>calendar open</p>} />
      </Routes>
    </MemoryRouter>,
  );
}

beforeEach(() => {
  for (const fn of Object.values(client)) fn.mockReset();
  localStorage.clear();
});

describe("TeamsPage", () => {
  it("lists the account's orgs as teams, and offers Delete to the owner and Leave to others", async () => {
    client.me.mockResolvedValue({
      orgs: [
        { orgId: "org-b", name: "Beta", role: "member" },
        { orgId: "org-a", name: "Alpha", role: "owner" },
      ],
    });
    renderAt("/teams");
    expect(await screen.findByText("Alpha")).toBeTruthy();
    expect(screen.getByText("Beta")).toBeTruthy();

    fireEvent.click(screen.getByTestId("team-menu-org-a"));
    expect(screen.getByTestId("delete-team-org-a")).toBeTruthy();
    fireEvent.click(screen.getByTestId("team-menu-org-b"));
    expect(screen.getByTestId("leave-team-org-b")).toBeTruthy();

    client.removeMember.mockResolvedValue({});
    fireEvent.click(screen.getByTestId("leave-team-org-b"));
    await waitFor(() => expect(client.removeMember).toHaveBeenCalledWith("org-b", ME, expect.anything()));
    await waitFor(() => expect(screen.queryByText("Beta")).toBeNull());
  });

  it("creates a team as an org whose members may create calendars and invite", async () => {
    client.me.mockResolvedValue({ orgs: [] });
    client.createOrg.mockResolvedValue("org-new");
    client.setCapabilities.mockResolvedValue(undefined);
    renderAt("/teams");
    expect(await screen.findByTestId("empty-teams")).toBeTruthy();
    fireEvent.change(screen.getByTestId("new-team-input"), { target: { value: "Design" } });
    fireEvent.click(screen.getByTestId("create-team-btn"));
    expect(await screen.findByText("Design")).toBeTruthy();
    expect(client.createOrg).toHaveBeenCalledWith("Design");
    expect(client.setCapabilities).toHaveBeenCalledWith("org-new", expect.any(Number), expect.anything());
  });

  it("makes an invitation link carrying an org invite", async () => {
    client.me.mockResolvedValue({ orgs: [{ orgId: "org-a", name: "Alpha", role: "owner" }] });
    client.invite.mockResolvedValue("tok-123");
    renderAt("/teams");
    fireEvent.click(await screen.findByTestId("team-menu-org-a"));
    fireEvent.click(screen.getByText("Invite"));
    await waitFor(() => expect(client.invite).toHaveBeenCalledWith("org-a", "member", expect.anything()));
    const code = await screen.findByTitle(/invite=tok-123/);
    expect(code).toBeTruthy();
  });
});

describe("TeamCalendarsPage", () => {
  const org = (role: string) => ({ name: "Alpha", members: { [ME]: role, "acct-x": "admin" }, memberMetadata: {} });

  it("lists this app's instances in the org, and creates one", async () => {
    client.getOrg.mockResolvedValue(org("member"));
    client.listApps.mockResolvedValue([
      { appId: "cal-1", name: "Roadmap", owner: "acct-x", org: "org-a" },
      { appId: "cal-2", name: "Elsewhere", owner: ME, org: "org-z" },
    ]);
    client.createApp.mockResolvedValue("cal-3");
    renderAt("/teams/org-a");
    expect(await screen.findByText("Roadmap")).toBeTruthy();
    expect(screen.queryByText("Elsewhere")).toBeNull();
    expect(client.listApps).toHaveBeenCalledWith({ bundle: "bundle-hash" });
    expect(await screen.findByRole("heading", { name: "Alpha" })).toBeTruthy();
    // A member who did not create it cannot delete it.
    expect(screen.queryByTestId("calendar-menu-cal-1")).toBeNull();

    fireEvent.change(screen.getByTestId("new-calendar-input"), { target: { value: "Sprints" } });
    fireEvent.click(screen.getByTestId("create-calendar-btn"));
    expect(await screen.findByText("calendar open")).toBeTruthy();
    expect(client.createApp).toHaveBeenCalledWith("Sprints", "bundle-hash", { org: "org-a" });
  });

  it("lets an admin delete a calendar for everyone", async () => {
    client.getOrg.mockResolvedValue(org("admin"));
    client.listApps.mockResolvedValue([{ appId: "cal-1", name: "Roadmap", owner: "acct-x", org: "org-a" }]);
    client.deleteApp.mockResolvedValue(undefined);
    renderAt("/teams/org-a");
    fireEvent.click(await screen.findByTestId("calendar-menu-cal-1"));
    fireEvent.click(screen.getByTestId("delete-calendar-cal-1"));
    fireEvent.click(screen.getByTestId("confirm-delete-btn"));
    await waitFor(() => expect(client.deleteApp).toHaveBeenCalledWith("cal-1"));
  });
});
