// The Teams page on a delegated (account) session.
//
// Measured on prod as an account: "Create team" was `POST /admin-api/namespaces`
// through the raw axios layer with the node JWT — a 403 ("Token does not carry
// the permissions this route requires"), and the 401 interceptor then looped the
// session back to `/`. It must go through the session-aware `useMero().admin` —
// the account admin, which founds through the relay — and the raw client's
// admin must never be reached. Founding on an account also reports whether the
// cloud agreed to host the team (`haError`), which is said right away rather
// than failing at invite time. (Joining is the invitation prompt's, and tested
// beside it in `components/InvitationPrompt.test.tsx`.)
import { afterEach, describe, expect, it, vi } from "vitest";
import { act, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import TeamsPage from "./TeamsPage";
import { ToastProvider } from "../contexts/ToastContext";

const stub = vi.hoisted(() => {
  const admin = {
    createNamespace: vi.fn(async () => ({ namespaceId: "ns-new", haEnabled: false, haError: "link this account to your cloud user in the wallet" })),
    deleteNamespace: vi.fn(),
    leaveNamespace: vi.fn(async () => {}),
    getNodeIdentity: vi.fn(async () => ({ accountId: "ab".repeat(32) })),
    listGroupMembers: vi.fn(async () => ({ members: [{ identity: "ab".repeat(32), role: "Member" }] })),
    listNamespacesForApplication: vi.fn(async () => [{ namespaceId: "ns-existing", name: "Existing" }]),
    listNamespaces: vi.fn(async () => []),
    listApplications: vi.fn(),
  };
  const rawAdmin = {
    createNamespace: vi.fn(),
    deleteNamespace: vi.fn(),
    listNamespacesForApplication: vi.fn(),
    listNamespaces: vi.fn(),
    listApplications: vi.fn(),
  };
  return {
    admin,
    rawAdmin,
    mero: {
      mero: { admin: rawAdmin, rpc: { execute: vi.fn() } },
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

vi.mock("@calimero-network/mero-react", async (importOriginal) => ({
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

afterEach(() => {
  localStorage.clear();
  vi.clearAllMocks();
  stub.admin.listGroupMembers.mockImplementation(async () => ({ members: [{ identity: "ab".repeat(32), role: "Member" }] }));
});

describe("TeamsPage on a delegated session", () => {
  it("lists teams through the account admin, scoped to the provider's application id", async () => {
    renderPage();
    await screen.findByTestId("team-card-ns-existing");
    expect(stub.admin.listNamespacesForApplication).toHaveBeenCalledWith("app");
    expect(stub.admin.listApplications).not.toHaveBeenCalled();
    expect(stub.rawAdmin.listNamespacesForApplication).not.toHaveBeenCalled();
  });

  it("creates a team through admin.createNamespace, never the raw client, and says when it is not hosted", async () => {
    renderPage();
    await screen.findByTestId("team-card-ns-existing");
    fireEvent.change(screen.getByTestId("new-team-input"), { target: { value: "Acme" } });
    fireEvent.click(screen.getByTestId("create-team-btn"));

    await waitFor(() => expect(stub.admin.createNamespace).toHaveBeenCalledTimes(1));
    expect(stub.admin.createNamespace).toHaveBeenCalledWith({ applicationId: "app", name: "Acme" });
    expect(stub.rawAdmin.createNamespace).not.toHaveBeenCalled();
    await screen.findByTestId("team-card-ns-new");
    await screen.findByText(/not hosted yet: link this account/);
  });

  it("offers a member Leave through the account admin, never Delete", async () => {
    renderPage();
    await screen.findByTestId("team-card-ns-existing");
    await waitFor(() => expect(stub.admin.listGroupMembers).toHaveBeenCalledWith("ns-existing"));
    fireEvent.click(screen.getByTitle("More options"));
    expect(screen.getByText("Settings")).toBeInTheDocument();
    expect(screen.queryByText("Delete")).toBeNull();
    fireEvent.click(await screen.findByText("Leave"));

    await waitFor(() => expect(stub.admin.leaveNamespace).toHaveBeenCalledWith("ns-existing"));
    await waitFor(() => expect(screen.queryByTestId("team-card-ns-existing")).toBeNull());
  });

  it("hides the node-only Delete from an admin, and never offers an admin Leave", async () => {
    stub.admin.listGroupMembers.mockResolvedValue({ members: [{ identity: "ab".repeat(32), role: "Admin" }] });
    renderPage();
    await screen.findByTestId("team-card-ns-existing");
    await waitFor(() => expect(stub.admin.listGroupMembers).toHaveBeenCalled());
    await act(async () => {}); // let the role land before asserting an absence
    fireEvent.click(screen.getByTitle("More options"));
    expect(screen.getByText("Settings")).toBeInTheDocument();
    expect(screen.queryByText("Delete")).toBeNull();
    expect(screen.queryByText("Leave")).toBeNull();
  });
});
