/**
 * The teams list and a team's projects, on a mocked CalimeroClient: teams are
 * orgs, projects are this app's instances in the org.
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
  view: vi.fn(),
  call: vi.fn(),
};

// Stable, as the real hook's value is (memoized per session).
const signedIn = {
  client,
  accountId: ME,
  source: "bundle-hash",
  passkey: () => ({}),
  after: () => {},
  targetKey: "local:test",
  signOut: vi.fn(),
};

vi.mock("../api/sessionContext", () => ({
  useSignedIn: () => signedIn,
  useSessionApi: () => ({ api: { session: { status: "signed-in" }, signOut: vi.fn() } }),
}));

import TeamsPage from "./TeamsPage";
import ProjectsPage from "./ProjectsPage";
import { ToastProvider } from "../contexts/ToastContext";

function renderAt(path: string) {
  return render(
    <ToastProvider>
      <MemoryRouter initialEntries={[path]}>
        <Routes>
          <Route path="/teams" element={<TeamsPage />} />
          <Route path="/teams/:teamId/projects" element={<ProjectsPage />} />
          <Route path="/teams/:teamId/projects/:projectId" element={<p>editor open</p>} />
        </Routes>
      </MemoryRouter>
    </ToastProvider>,
  );
}

const doc = (name: string) => ({
  name, description: "", width: 800, height: 600, background: "#0000", layerCount: 2, memberCount: 3, owner: ME,
});

beforeEach(() => {
  for (const fn of Object.values(client)) fn.mockReset();
  localStorage.clear();
});

describe("TeamsPage", () => {
  it("lists the account's orgs as teams, with Delete for the owner and Leave for others", async () => {
    client.me.mockResolvedValue({
      orgs: [
        { orgId: "org-b", name: "Beta", role: "member" },
        { orgId: "org-a", name: "Alpha", role: "owner" },
      ],
    });
    renderAt("/teams");
    expect(await screen.findByText("Alpha")).toBeTruthy();
    const menus = screen.getAllByTitle("More options");
    // Sorted by name: Alpha first.
    fireEvent.click(menus[0]);
    expect(screen.getByText("Delete")).toBeTruthy();
    fireEvent.click(menus[1]);
    client.removeMember.mockResolvedValue({});
    fireEvent.click(screen.getByText("Leave"));
    await waitFor(() => expect(client.removeMember).toHaveBeenCalledWith("org-b", ME, expect.anything()));
    await waitFor(() => expect(screen.queryByText("Beta")).toBeNull());
  });

  it("creates a team as an org whose members may create projects and invite", async () => {
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
});

describe("ProjectsPage", () => {
  it("lists this app's instances in the org with their documents", async () => {
    client.getOrg.mockResolvedValue({ name: "Alpha", members: { [ME]: "member" }, memberMetadata: {} });
    client.listApps.mockResolvedValue([
      { appId: "p-1", name: "Poster", owner: "acct-x", org: "org-a" },
      { appId: "p-2", name: "Elsewhere", owner: ME, org: "org-z" },
    ]);
    client.view.mockImplementation((_app: string, method: string) =>
      Promise.resolve({ index: 1, result: method === "getDocument" ? doc("Launch poster") : null }),
    );
    renderAt("/teams/org-a/projects");
    expect(await screen.findByText("Launch poster")).toBeTruthy();
    expect(screen.getByText("800 × 600")).toBeTruthy();
    expect(screen.getByText("3 members")).toBeTruthy();
    expect(screen.queryByText("Elsewhere")).toBeNull();
    await waitFor(() => expect(client.listApps).toHaveBeenCalledWith({ bundle: "bundle-hash" }));
    expect(client.view).toHaveBeenCalledWith("p-1", "getDocument", {});
    expect(await screen.findByRole("heading", { name: "Alpha" })).toBeTruthy();
    // A member who did not create it is not offered Delete.
    fireEvent.click(screen.getByTitle("More options"));
    expect(screen.queryByText("Delete")).toBeNull();
  });

  it("creates a project as an instance whose init carries the document", async () => {
    client.getOrg.mockResolvedValue({ name: "Alpha", members: { [ME]: "owner" }, memberMetadata: {} });
    client.listApps.mockResolvedValue([]);
    client.createApp.mockResolvedValue("p-new");
    renderAt("/teams/org-a/projects");
    fireEvent.click(await screen.findByTestId("open-create-modal"));
    fireEvent.change(screen.getByTestId("new-project-input"), { target: { value: "Cover" } });
    fireEvent.click(screen.getByTestId("preset-1080x1080"));
    fireEvent.click(screen.getByTestId("create-project-btn"));
    await waitFor(() =>
      expect(client.createApp).toHaveBeenCalledWith("Cover", "bundle-hash", {
        org: "org-a",
        initArgs: { name: "Cover", description: "", width: 1080, height: 1080 },
      }),
    );
  });

  it("makes an invitation link carrying an org invite", async () => {
    client.getOrg.mockResolvedValue({ name: "Alpha", members: { [ME]: "owner" }, memberMetadata: {} });
    client.listApps.mockResolvedValue([]);
    client.invite.mockResolvedValue("tok-123");
    renderAt("/teams/org-a/projects");
    fireEvent.click(await screen.findByText("Invitations"));
    fireEvent.click(screen.getByTestId("generate-invite"));
    await waitFor(() => expect(client.invite).toHaveBeenCalledWith("org-a", "member", expect.anything()));
    expect((await screen.findByTestId("invite-token")).getAttribute("title")).toMatch(/[?&]invite=tok-123/);
  });
});
