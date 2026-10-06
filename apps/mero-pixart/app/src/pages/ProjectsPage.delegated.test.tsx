// The Projects page on a delegated (account) session.
//
// "New project" used to be two raw POSTs with the node JWT —
// `/admin-api/namespaces/{team}/groups` then `/admin-api/contexts` — both 403
// for an account. The subgroup, its visibility and the document context must
// be created through the session-aware `useMero().admin` (the account admin:
// governance ops signed by the account, delegated context creation), with the
// provider's registry-resolved application id, and the raw client's admin must
// never be reached. Deleting a project is a node's own operation and is hidden.
import { afterEach, describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { MemoryRouter, Route, Routes } from "react-router-dom";
import ProjectsPage from "./ProjectsPage";
import { ToastProvider } from "../contexts/ToastContext";

const TEAM = "cd".repeat(32);
const SUB = "ef".repeat(32);

const stub = vi.hoisted(() => {
  const admin = {
    listSubgroups: vi.fn(async () => [{ groupId: "ef".repeat(32), name: "Poster" }]),
    listGroupContexts: vi.fn(async () => [{ contextId: "ctx-existing", name: "Poster" }]),
    listGroupMembers: vi.fn(async () => ({ members: [{ identity: "a", role: "Admin" }] })),
    createGroupInNamespace: vi.fn(async () => ({ groupId: "sg-new" })),
    setSubgroupVisibility: vi.fn(async () => {}),
    createContext: vi.fn(async () => ({ contextId: "ctx-new", memberPublicKey: "" })),
    joinContext: vi.fn(async () => ({ contextId: "ctx-existing", memberPublicKey: "a" })),
    deleteContext: vi.fn(),
    listApplications: vi.fn(),
  };
  const rawAdmin = {
    listSubgroups: vi.fn(),
    listGroupContexts: vi.fn(),
    listGroupMembers: vi.fn(),
    createGroupInNamespace: vi.fn(),
    setSubgroupVisibility: vi.fn(),
    createContext: vi.fn(),
    joinContext: vi.fn(),
    deleteContext: vi.fn(),
    listApplications: vi.fn(),
  };
  const rpc = { execute: vi.fn(async () => null) };
  return {
    admin,
    rawAdmin,
    rpc,
    mero: {
      mero: { admin: rawAdmin, rpc },
      admin,
      isDelegated: true,
      applicationId: "app",
      nodeUrl: "https://relay.example",
      isAuthenticated: true,
      isLoading: false,
      logout: vi.fn(),
    },
  };
});

vi.mock("@calimero-network/mero-react", () => ({
  useMero: () => stub.mero,
  setApplicationId: vi.fn(),
}));

function renderPage() {
  return render(
    <MemoryRouter initialEntries={[`/teams/${TEAM}/projects`]}>
      <ToastProvider>
        <Routes>
          <Route path="/teams/:teamId/projects" element={<ProjectsPage />} />
          <Route path="/teams/:teamId/projects/:projectId" element={<output data-testid="editor" />} />
        </Routes>
      </ToastProvider>
    </MemoryRouter>,
  );
}

afterEach(() => {
  localStorage.clear();
  vi.clearAllMocks();
});

describe("ProjectsPage on a delegated session", () => {
  it("lists the team's projects through the account admin and reads documents over the session's rpc", async () => {
    renderPage();
    await screen.findByTestId("project-card-ctx-existing");
    expect(stub.admin.listSubgroups).toHaveBeenCalledWith(TEAM);
    expect(stub.admin.listGroupContexts).toHaveBeenCalledWith(SUB);
    expect(stub.admin.listGroupMembers).toHaveBeenCalledWith(SUB);
    expect(stub.rpc.execute).toHaveBeenCalledWith(
      expect.objectContaining({ contextId: "ctx-existing", method: "get_document" }),
    );
    expect(stub.rawAdmin.listSubgroups).not.toHaveBeenCalled();
    expect(stub.rawAdmin.listGroupContexts).not.toHaveBeenCalled();
  });

  it("creates the subgroup and the document context through admin.*, with the provider's app id, never the raw client", async () => {
    renderPage();
    await screen.findByTestId("project-card-ctx-existing");
    fireEvent.click(screen.getByTestId("open-create-modal"));
    fireEvent.change(screen.getByTestId("new-project-input"), { target: { value: "Poster 2" } });
    fireEvent.click(screen.getByTestId("create-project-btn"));

    await waitFor(() => expect(stub.admin.createContext).toHaveBeenCalledTimes(1));
    expect(stub.admin.createGroupInNamespace).toHaveBeenCalledWith(TEAM, {
      groupName: "Poster 2",
      visibility: "open",
    });
    expect(stub.admin.setSubgroupVisibility).toHaveBeenCalledWith("sg-new", { subgroupVisibility: "open" });
    expect(stub.admin.createContext).toHaveBeenCalledWith(
      expect.objectContaining({ applicationId: "app", groupId: "sg-new", name: "Poster 2" }),
    );
    const init = (stub.admin.createContext.mock.calls[0] as unknown as [{ initializationParams: number[] }])[0]
      .initializationParams;
    expect(JSON.parse(new TextDecoder().decode(new Uint8Array(init)))).toMatchObject({
      name: "Poster 2", width: 1280, height: 720,
    });
    expect(stub.admin.listApplications).not.toHaveBeenCalled();
    expect(stub.rawAdmin.createGroupInNamespace).not.toHaveBeenCalled();
    expect(stub.rawAdmin.createContext).not.toHaveBeenCalled();
    await screen.findByTestId("project-card-ctx-new");
  });

  it("opens a project by joining its context through the account admin", async () => {
    renderPage();
    fireEvent.click(await screen.findByTestId("project-card-ctx-existing"));
    await screen.findByTestId("editor");
    expect(stub.admin.joinContext).toHaveBeenCalledWith("ctx-existing");
    expect(stub.rawAdmin.joinContext).not.toHaveBeenCalled();
  });

  it("hides the node-only Delete control", async () => {
    renderPage();
    await screen.findByTestId("project-card-ctx-existing");
    fireEvent.click(screen.getByTitle("More options"));
    expect(screen.getByText("Settings")).toBeInTheDocument();
    expect(screen.queryByText("Delete")).toBeNull();
  });
});
