// The Teams page's destructive control on a node session: an Admin deletes a
// team, anyone else leaves it, and an admin is never offered Leave. A refused
// delete keeps the card and says why rather than dropping it silently.
import { afterEach, describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import TeamsPage from "./TeamsPage";
import { ToastProvider } from "../contexts/ToastContext";

const stub = vi.hoisted(() => {
  const admin = {
    deleteNamespace: vi.fn(async () => ({ isDeleted: true })),
    leaveNamespace: vi.fn(async () => {}),
    getNodeIdentity: vi.fn(async () => ({ accountId: "ab".repeat(32) })),
    listGroupMembers: vi.fn(async () => ({ members: [{ identity: "ab".repeat(32), role: "Admin" }] })),
    listNamespacesForApplication: vi.fn(async () => [{ namespaceId: "ns-1", name: "One" }]),
    listNamespaces: vi.fn(async () => []),
    listApplications: vi.fn(async () => []),
  };
  return {
    admin,
    mero: {
      mero: { admin, rpc: { execute: vi.fn() } },
      admin,
      isDelegated: false,
      applicationId: "app",
      nodeUrl: "http://node.example",
      isAuthenticated: true,
      isLoading: false,
      logout: vi.fn(),
    },
  };
});

vi.mock("@calimero-apps/cloud", async (importOriginal) => ({
  ...(await importOriginal<Record<string, unknown>>()),
  useMero: () => stub.mero,
  setApplicationId: vi.fn(),
}));

function renderPage() {
  return render(
    <MemoryRouter initialEntries={["/teams"]}>
      <ToastProvider>
        <TeamsPage />
      </ToastProvider>
    </MemoryRouter>,
  );
}

async function openMenu() {
  await screen.findByTestId("team-card-ns-1");
  await waitFor(() => expect(stub.admin.listGroupMembers).toHaveBeenCalledWith("ns-1"));
  fireEvent.click(screen.getByTitle("More options"));
}

afterEach(() => {
  localStorage.clear();
  vi.clearAllMocks();
  stub.admin.listGroupMembers.mockImplementation(async () => ({ members: [{ identity: "ab".repeat(32), role: "Admin" }] }));
  stub.admin.deleteNamespace.mockImplementation(async () => ({ isDeleted: true }));
});

describe("TeamsPage delete / leave on a node", () => {
  it("offers an admin Delete, never Leave, and drops the card once deleted", async () => {
    renderPage();
    await openMenu();
    expect(screen.queryByText("Leave")).toBeNull();
    fireEvent.click(await screen.findByText("Delete"));
    await waitFor(() => expect(stub.admin.deleteNamespace).toHaveBeenCalledWith("ns-1"));
    await waitFor(() => expect(screen.queryByTestId("team-card-ns-1")).toBeNull());
    expect(stub.admin.leaveNamespace).not.toHaveBeenCalled();
  });

  it("keeps the card and says why when the delete is refused", async () => {
    stub.admin.deleteNamespace.mockRejectedValue(new Error("permission denied"));
    renderPage();
    await openMenu();
    fireEvent.click(await screen.findByText("Delete"));
    await screen.findByText(/permission denied/);
    expect(screen.getByTestId("team-card-ns-1")).toBeInTheDocument();
  });

  it("offers a member Leave, never Delete", async () => {
    stub.admin.listGroupMembers.mockResolvedValue({ members: [{ identity: "ab".repeat(32), role: "Member" }] });
    renderPage();
    await openMenu();
    expect(screen.queryByText("Delete")).toBeNull();
    fireEvent.click(await screen.findByText("Leave"));
    await waitFor(() => expect(stub.admin.leaveNamespace).toHaveBeenCalledWith("ns-1"));
    await waitFor(() => expect(screen.queryByTestId("team-card-ns-1")).toBeNull());
    expect(stub.admin.deleteNamespace).not.toHaveBeenCalled();
  });
});
