/**
 * The teams page's destructive control on a NODE session: an Admin deletes a
 * team, anyone else leaves it, an Admin is never offered Leave, and a refused
 * delete keeps the card and says why instead of dropping it silently.
 */
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { resetAccountId } from "../../api/identity";

const NS = "a1".repeat(32);
const ME = "d4".repeat(32);

const stub = vi.hoisted(() => {
  const admin = {
    listApplications: vi.fn(async () => {
      throw new Error("unreachable");
    }),
    listNamespacesForApplication: vi.fn(),
    listNamespaces: vi.fn(async () => []),
    getNodeIdentity: vi.fn(),
    listGroupMembers: vi.fn(),
    deleteNamespace: vi.fn(),
    leaveNamespace: vi.fn(),
  };
  const showToast = vi.fn();
  return { admin, showToast };
});

vi.mock("@calimero-network/mero-react", async (importOriginal) => ({
  ...(await importOriginal<Record<string, unknown>>()),
  useMero: () => ({
    admin: stub.admin,
    isDelegated: false,
    applicationId: "app-1",
    isAuthenticated: true,
    isLoading: false,
    logout: vi.fn(),
  }),
  setApplicationId: vi.fn(),
  getApplicationId: () => "",
}));
vi.mock("../../contexts/ToastContext", () => ({
  useToast: () => ({ showToast: stub.showToast }),
}));
vi.mock("../../components/common/theme-toggle/ThemeToggle", () => ({
  default: () => null,
}));
import TeamsPage from "./TeamsPage";

function open() {
  return render(
    <MemoryRouter initialEntries={["/teams"]}>
      <TeamsPage />
    </MemoryRouter>,
  );
}

function role(r: string) {
  stub.admin.listGroupMembers.mockResolvedValue({ members: [{ identity: ME, role: r }] });
}

beforeEach(() => {
  vi.clearAllMocks();
  localStorage.clear();
  resetAccountId();
  stub.admin.listNamespacesForApplication.mockResolvedValue([
    { namespaceId: NS, targetApplicationId: "app-1", name: "Design" },
  ]);
  stub.admin.getNodeIdentity.mockResolvedValue({ accountId: ME });
  stub.admin.deleteNamespace.mockResolvedValue({ isDeleted: true });
  stub.admin.leaveNamespace.mockResolvedValue(undefined);
  role("Admin");
});

describe("deleting or leaving a team on a node", () => {
  it("offers an admin Delete, never Leave, and drops the card once deleted", async () => {
    open();
    fireEvent.click(await screen.findByTestId(`team-menu-${NS}`));
    fireEvent.click(await screen.findByTestId(`delete-team-${NS}`));
    expect(screen.queryByTestId(`leave-team-${NS}`)).toBeNull();
    await waitFor(() => expect(stub.admin.deleteNamespace).toHaveBeenCalledWith(NS));
    await waitFor(() => expect(screen.queryByTestId(`team-card-${NS}`)).toBeNull());
    expect(stub.admin.leaveNamespace).not.toHaveBeenCalled();
  });

  it("keeps the card and says why when the delete is refused", async () => {
    stub.admin.deleteNamespace.mockRejectedValue(new Error("permission denied"));
    open();
    fireEvent.click(await screen.findByTestId(`team-menu-${NS}`));
    fireEvent.click(await screen.findByTestId(`delete-team-${NS}`));
    await waitFor(() => expect(stub.showToast).toHaveBeenCalled());
    expect(String(stub.showToast.mock.calls[0][0])).toMatch(/permission denied/);
    expect(screen.getByTestId(`team-card-${NS}`)).toBeTruthy();
  });

  it("offers a member Leave, never Delete", async () => {
    role("Member");
    open();
    fireEvent.click(await screen.findByTestId(`team-menu-${NS}`));
    fireEvent.click(await screen.findByTestId(`leave-team-${NS}`));
    expect(screen.queryByTestId(`delete-team-${NS}`)).toBeNull();
    await waitFor(() => expect(stub.admin.leaveNamespace).toHaveBeenCalledWith(NS));
    await waitFor(() => expect(screen.queryByTestId(`team-card-${NS}`)).toBeNull());
    expect(stub.admin.deleteNamespace).not.toHaveBeenCalled();
  });
});
