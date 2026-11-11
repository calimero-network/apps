/**
 * The teams list and a team's projects, on a mocked CalimeroClient: teams are
 * orgs, projects are this app's instances in the org.
 */
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { MemoryRouter, Route, Routes } from "react-router-dom";
import { beforeEach, describe, expect, it, vi } from "vitest";

const ME = "acct-me";
const client = withRoutes({
  me: vi.fn(),
  createOrg: vi.fn(),
  setCapabilities: vi.fn(),
  deleteOrg: vi.fn(),
  removeMember: vi.fn(),
  invite: vi.fn(),
  listApps: vi.fn(),
  getOrg: vi.fn(),
  setMemberMetadata: vi.fn(),
  createApp: vi.fn(),
  deleteApp: vi.fn(),
  view: vi.fn(),
  call: vi.fn(),
});

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
import { withRoutes } from "@calimero-apps/connect/testing";

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
  client.listApps.mockResolvedValue([]);
  localStorage.clear();
});

describe("TeamsPage", () => {
  it("lists the account's orgs holding projects as teams, with Delete for the owner and Leave for others", async () => {
    client.me.mockResolvedValue({
      orgs: [
        { orgId: "org-b", name: "Beta", role: "member" },
        { orgId: "org-a", name: "Alpha", role: "owner" },
      ],
    });
    client.listApps.mockResolvedValue([
      { appId: "p1", name: "A", owner: ME, org: "org-a", bundle: "bundle-hash" },
      { appId: "p2", name: "B", owner: ME, org: "org-b", bundle: "bundle-hash" },
    ]);
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

  // The account of the bug: in `overworld`, which holds only a Mero Blocks world.
  it("does not list an org made for another app; connects it on request with a project", async () => {
    client.me.mockResolvedValue({ orgs: [{ orgId: "ow", name: "overworld", role: "owner" }] });
    client.listApps.mockImplementation(async (f?: { bundle?: string }) =>
      [{ appId: "w1", name: "overworld", owner: ME, org: "ow", bundle: "blocks", package: "com.calimero.mero-blocks" }].filter(
        (a) => !f?.bundle || a.bundle === f.bundle,
      ),
    );
    client.getOrg.mockResolvedValue({ members: { [ME]: "owner" }, metadata: null });
    client.createApp.mockResolvedValue("p-new");
    renderAt("/teams");
    expect(await screen.findByTestId("empty-teams")).toBeTruthy();
    fireEvent.click(screen.getByTestId("connect-existing-org"));
    const choice = await screen.findByTestId("connect-org-ow");
    expect(choice.textContent).toContain("Mero Blocks: overworld");
    fireEvent.click(choice);
    await waitFor(() =>
      expect(client.createApp).toHaveBeenCalledWith("Untitled", "bundle-hash", expect.objectContaining({ org: "ow" })),
    );
    expect(client.createOrg).not.toHaveBeenCalled();
  });

  it("creates a team as an org whose members may create projects and invite", async () => {
    client.me.mockResolvedValue({ orgs: [] });
    client.createOrg.mockResolvedValue("org-new");
    client.setCapabilities.mockResolvedValue(undefined);
    renderAt("/teams");
    expect(await screen.findByTestId("empty-teams")).toBeTruthy();
    fireEvent.change(screen.getByTestId("new-team-input"), { target: { value: "Design" } });
    fireEvent.change(screen.getByTestId("new-team-my-name"), { target: { value: "Sandi" } });
    fireEvent.click(screen.getByTestId("create-team-btn"));
    expect(await screen.findByText("Design")).toBeTruthy();
    expect(client.createOrg).toHaveBeenCalledWith("Design");
    expect(client.setCapabilities).toHaveBeenCalledWith("org-new", expect.any(Number), expect.anything());
  });

  it("asks your name in the new team in the same step, and writes it to the org", async () => {
    client.me.mockResolvedValue({ orgs: [] });
    client.createOrg.mockResolvedValue("org-new");
    client.setCapabilities.mockResolvedValue(undefined);
    client.getOrg.mockResolvedValue({ name: "Design", members: { [ME]: "owner" }, memberMetadata: {} });
    client.setMemberMetadata.mockResolvedValue(undefined);
    localStorage.setItem("calimero-names:last", "Sandi");
    renderAt("/teams");
    expect(await screen.findByTestId("empty-teams")).toBeTruthy();
    // Offered the name used last, and required.
    const mine = screen.getByTestId("new-team-my-name") as HTMLInputElement;
    expect(mine.value).toBe("Sandi");
    fireEvent.change(screen.getByTestId("new-team-input"), { target: { value: "Design" } });
    fireEvent.change(mine, { target: { value: " " } });
    expect((screen.getByTestId("create-team-btn") as HTMLButtonElement).disabled).toBe(true);
    fireEvent.change(mine, { target: { value: "Ana" } });
    fireEvent.click(screen.getByTestId("create-team-btn"));
    await waitFor(() => expect(client.setMemberMetadata).toHaveBeenCalledWith("org-new", ME, { name: "Ana" }));
    expect(localStorage.getItem("calimero-names:last")).toBe("Ana");
  });

  it("still creates the team when writing the name fails", async () => {
    client.me.mockResolvedValue({ orgs: [] });
    client.createOrg.mockResolvedValue("org-new");
    client.setCapabilities.mockResolvedValue(undefined);
    client.getOrg.mockResolvedValue({ members: {}, memberMetadata: {} });
    client.setMemberMetadata.mockRejectedValue(new Error("offline"));
    renderAt("/teams");
    expect(await screen.findByTestId("empty-teams")).toBeTruthy();
    fireEvent.change(screen.getByTestId("new-team-input"), { target: { value: "Design" } });
    fireEvent.change(screen.getByTestId("new-team-my-name"), { target: { value: "Ana" } });
    fireEvent.click(screen.getByTestId("create-team-btn"));
    expect(await screen.findByText("Design")).toBeTruthy();
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

  it("tells a member who may not add a project to ask an owner, instead of offering New project (B8)", async () => {
    // A member whose team defaults were never set (the step-up refused): no CREATE_APP.
    client.getOrg.mockResolvedValue({ name: "Alpha", members: { [ME]: "member", "acct-o": "owner" }, memberMetadata: {} });
    client.listApps.mockResolvedValue([]);
    Object.assign(client, { session: { accountId: ME } });
    try {
      renderAt("/teams/org-a/projects");
      expect((await screen.findByTestId("create-project-ask")).textContent).toMatch(/Only an owner or admin/);
      expect(screen.queryByTestId("open-create-modal")).toBeNull();
      expect(screen.queryByText("Create your first project")).toBeNull();
    } finally {
      delete (client as { session?: unknown }).session;
    }
  });
});
