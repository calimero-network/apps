/**
 * The teams list and a team's calendars, on a mocked CalimeroClient: teams are
 * orgs, calendars are this app's instances in the org.
 */
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { MemoryRouter, Route, Routes } from "react-router-dom";
import { beforeEach, describe, expect, it, vi } from "vitest";

const ME = "acct-me";
const PKG = "com.calimero.mero-calendar";
const client = withRoutes({
  session: { accountId: ME },
  me: vi.fn(),
  createOrg: vi.fn(),
  setMemberMetadata: vi.fn(),
  setCapabilities: vi.fn(),
  deleteOrg: vi.fn(),
  removeMember: vi.fn(),
  listAppTeams: vi.fn(),
  listApps: vi.fn(),
  getOrg: vi.fn(),
  createApp: vi.fn(),
  deleteApp: vi.fn(),
});

// Stable, as the real hook's value is (memoized per session).
const signedIn = {
  client,
  accountId: ME,
  source: "bundle-hash" as unknown,
  passkey: () => ({}),
  after: () => {},
  targetKey: "local:test",
};

vi.mock("../../api/sessionContext", () => ({
  useSignedIn: () => signedIn,
  useSessionApi: () => ({ api: { session: { status: "signed-in" }, signOut: vi.fn() } }),
}));

// The shared dialog is mero-react's to test: here only what the app hands it and does after.
vi.mock("@calimero-network/mero-react", async (importOriginal) => {
  const { createElement } = await import("react");
  return {
    ...(await importOriginal<object>()),
    CreateWorkspaceDialog: (p: {
      open: boolean;
      defaultSelfName?: string;
      release: unknown;
      labels?: { title?: string };
      onCreated: (w: { orgId: string; name: string; selfName: string }) => void;
    }) =>
      p.open
        ? createElement(
            "div",
            { "data-testid": "create-dialog" },
            createElement("h2", { "data-testid": "create-title" }, p.labels?.title),
            createElement("p", { "data-testid": "create-self" }, p.defaultSelfName),
            createElement("pre", { "data-testid": "create-release" }, JSON.stringify(p.release)),
            createElement(
              "button",
              { "data-testid": "create-done", onClick: () => p.onCreated({ orgId: "org-new", name: "Design", selfName: "Ada" }) },
              "done",
            ),
          )
        : null,
    InviteDialog: (p: {
      open: boolean;
      org: string;
      teams?: string[];
      appName?: string;
      labels?: { title?: string };
      linkBase?: string;
    }) =>
      p.open
        ? createElement(
            "div",
            { "data-testid": "invite-dialog" },
            createElement("h2", { "data-testid": "invite-title" }, p.labels?.title),
            createElement("pre", { "data-testid": "invite-props" }, JSON.stringify({ org: p.org, teams: p.teams, appName: p.appName })),
            createElement("pre", { "data-testid": "invite-base" }, p.linkBase),
          )
        : null,
  };
});

import TeamsPage from "./TeamsPage";
import { ToastProvider } from "../../contexts/ToastContext";
import TeamCalendarsPage from "./TeamCalendarsPage";
import { MEMBER_DEFAULTS } from "../../api/teams";
import { CalimeroError } from "@calimero-network/mero-js";
import { askAnOwnerCopy } from "@calimero-apps/connect";
import { withRoutes } from "@calimero-apps/connect/testing";

function renderAt(path: string) {
  return render(
    <ToastProvider>
      <MemoryRouter initialEntries={[path]}>
        <Routes>
          <Route path="/teams" element={<TeamsPage />} />
          <Route path="/teams/:teamId" element={<TeamCalendarsPage />} />
          <Route path="/teams/:teamId/calendar/:contextId" element={<p>calendar open</p>} />
        </Routes>
      </MemoryRouter>
    </ToastProvider>,
  );
}

beforeEach(() => {
  for (const fn of Object.values(client)) if (typeof fn === "function") fn.mockReset();
  client.listApps.mockResolvedValue([]);
  signedIn.source = "bundle-hash";
  localStorage.clear();
});

describe("TeamsPage", () => {
  it("lists the account's orgs holding calendars as teams, and offers Delete to the owner and Leave to others", async () => {
    client.me.mockResolvedValue({
      orgs: [
        { orgId: "org-b", name: "Beta", role: "member" },
        { orgId: "org-a", name: "Alpha", role: "owner" },
      ],
    });
    client.listApps.mockResolvedValue([
      { appId: "c1", name: "A", owner: ME, org: "org-a", bundle: "bundle-hash" },
      { appId: "c2", name: "B", owner: ME, org: "org-b", bundle: "bundle-hash" },
    ]);
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

  it("sets up the team the dialog made as an org whose members may create calendars and invite, with your name in it", async () => {
    client.me.mockResolvedValue({ orgs: [] });
    client.setCapabilities.mockResolvedValue(undefined);
    client.getOrg.mockResolvedValue({ memberMetadata: {} });
    client.setMemberMetadata.mockResolvedValue(undefined);
    renderAt("/teams");
    expect(await screen.findByTestId("empty-teams")).toBeTruthy();
    fireEvent.click(screen.getByTestId("create-team-btn"));
    fireEvent.click(await screen.findByTestId("create-done"));
    expect(await screen.findByText("Design")).toBeTruthy();
    expect(client.createOrg).not.toHaveBeenCalled();
    expect(client.setCapabilities).toHaveBeenCalledWith("org-new", expect.any(Number), expect.anything());
    expect(client.setMemberMetadata).toHaveBeenCalledWith("org-new", ME, { name: "Ada" });
    expect(screen.queryByTestId("create-dialog")).toBeNull();
  });

  it("says so when the member defaults are refused, and the team stays", async () => {
    client.me.mockResolvedValue({ orgs: [] });
    client.setCapabilities.mockRejectedValue(new Error("declined"));
    client.getOrg.mockResolvedValue({ memberMetadata: {} });
    client.setMemberMetadata.mockResolvedValue(undefined);
    renderAt("/teams");
    fireEvent.click(await screen.findByTestId("create-team-btn"));
    fireEvent.click(await screen.findByTestId("create-done"));
    expect(await screen.findByText("Design")).toBeTruthy();
    expect(await screen.findByText(/will not be able to create calendars/)).toBeTruthy();
  });

  it("opens the dialog with the team wording and the name you last used", async () => {
    localStorage.setItem("calimero-names:last", "Ada");
    client.me.mockResolvedValue({ orgs: [] });
    renderAt("/teams");
    fireEvent.click(await screen.findByTestId("create-team-btn"));
    expect((await screen.findByTestId("create-title")).textContent).toBe("New team");
    expect(screen.getByTestId("create-self").textContent).toBe("Ada");
    expect(JSON.parse(screen.getByTestId("create-release").textContent ?? "null")).toEqual({ package: "com.calimero.mero-calendar" });
  });

  // The account of the bug: in `overworld`, which holds only a Mero Blocks world.
  it("does not list an org made for another app; connects it on request with a calendar", async () => {
    client.me.mockResolvedValue({ orgs: [{ orgId: "ow", name: "overworld", role: "owner" }] });
    client.listApps.mockImplementation(async (f?: { bundle?: string }) =>
      [{ appId: "w1", name: "overworld", owner: ME, org: "ow", bundle: "blocks", package: "com.calimero.mero-blocks" }].filter(
        (a) => !f?.bundle || a.bundle === f.bundle,
      ),
    );
    client.getOrg.mockResolvedValue({ members: { [ME]: "owner" }, metadata: null });
    client.createApp.mockResolvedValue("cal-new");
    renderAt("/teams");
    expect(await screen.findByTestId("empty-teams")).toBeTruthy();
    expect(screen.queryByTestId("connect-org-ow")).toBeNull();
    fireEvent.click(screen.getByTestId("connect-existing-org"));
    const choice = await screen.findByTestId("connect-org-ow");
    expect(choice.textContent).toContain("Mero Blocks: overworld");
    fireEvent.click(choice);
    await waitFor(() => expect(client.createApp).toHaveBeenCalledWith("Calendar", "bundle-hash", { org: "ow" }));
    expect(client.createOrg).not.toHaveBeenCalled();
  });

  it("invites through the shared dialog with the team's wording, naming the team and the link's org", async () => {
    client.me.mockResolvedValue({ orgs: [{ orgId: "org-a", name: "Alpha", role: "owner" }] });
    client.listApps.mockResolvedValue([{ appId: "c1", name: "A", owner: ME, org: "org-a", bundle: "bundle-hash" }]);
    renderAt("/teams");
    fireEvent.click(await screen.findByTestId("team-menu-org-a"));
    fireEvent.click(screen.getByText("Invite"));
    expect((await screen.findByTestId("invite-title")).textContent).toBe("Invite to this team");
    expect(JSON.parse(screen.getByTestId("invite-props").textContent ?? "")).toEqual({ org: "org-a", appName: "Mero Calendar", teams: [] });
    expect(new URL(screen.getByTestId("invite-base").textContent ?? "").searchParams.get("org")).toBe("org-a");
    expect(screen.queryByTestId("invite-dialog")).toBeTruthy();
  });

  it("names Mero Calendar's own team in an org that has app teams", async () => {
    client.me.mockResolvedValue({ orgs: [{ orgId: "org-a", name: "Alpha", role: "owner" }] });
    client.listApps.mockResolvedValue([{ appId: "c1", name: "A", owner: ME, org: "org-a", package: PKG }]);
    client.listAppTeams.mockResolvedValue({ mode: "shared", appTeams: [{ package: PKG, teamId: "team-cal" }] });
    signedIn.source = { package: PKG };
    renderAt("/teams");
    fireEvent.click(await screen.findByTestId("team-menu-org-a"));
    fireEvent.click(screen.getByText("Invite"));
    expect(JSON.parse((await screen.findByTestId("invite-props")).textContent ?? "").teams).toEqual(["team-cal"]);
  });

  it("opens no dialog, and says why, when the org has app teams but none for Mero Calendar", async () => {
    client.me.mockResolvedValue({ orgs: [{ orgId: "org-a", name: "Alpha", role: "owner" }] });
    client.listApps.mockResolvedValue([{ appId: "c1", name: "A", owner: ME, org: "org-a", package: PKG }]);
    client.listAppTeams.mockResolvedValue({ mode: "shared", appTeams: [{ package: "com.calimero.other", teamId: "team-x" }] });
    signedIn.source = { package: PKG };
    renderAt("/teams");
    fireEvent.click(await screen.findByTestId("team-menu-org-a"));
    fireEvent.click(screen.getByText("Invite"));
    expect(await screen.findByText(/Failed to generate invitation/)).toBeTruthy();
    expect(screen.queryByTestId("invite-dialog")).toBeNull();
  });
});

describe("TeamCalendarsPage", () => {
  // A team made here lets its members add calendars (MEMBER_DEFAULTS); `caps` overrides that.
  const org = (role: string, caps: number = MEMBER_DEFAULTS) => ({
    name: "Alpha",
    members: { [ME]: role, "acct-x": "admin" },
    memberMetadata: {},
    defaultCapabilities: caps,
    capabilities: {},
  });

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
    await waitFor(() => expect(client.listApps).toHaveBeenCalledWith({ bundle: "bundle-hash" }));
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

  it("tells a member who may not add a calendar to ask an owner, instead of offering a create that fails (B8)", async () => {
    // The node's own default for a member: no CREATE_APP.
    client.getOrg.mockResolvedValue(org("member", 0));
    client.listApps.mockResolvedValue([]);
    renderAt("/teams/org-a");
    expect(await screen.findByText(askAnOwnerCopy("a calendar"))).toBeTruthy();
    expect(screen.queryByTestId("create-calendar-btn")).toBeNull();
    expect((await screen.findByTestId("empty-calendars")).textContent).toBe("No calendars in this team yet.");
  });

  it("tells someone not in the team to ask for an invite, not to create the first calendar (B9)", async () => {
    client.getOrg.mockRejectedValue(new CalimeroError(403, "FORBIDDEN", "not a member of this organization"));
    client.listApps.mockResolvedValue([]);
    renderAt("/teams/org-a");
    expect((await screen.findByTestId("team-not-member")).textContent).toMatch(/Ask someone in it for an invite/);
    expect(screen.queryByTestId("create-calendar-btn")).toBeNull();
    expect(screen.queryByText(/Create the first one/)).toBeNull();
  });
});
