import { render, screen } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import AdminIcon from "./AdminIcon";

const { mockGetGroupId, mockUseCurrentGroupPermissions } = vi.hoisted(() => ({
  mockGetGroupId: vi.fn(),
  mockUseCurrentGroupPermissions: vi.fn(),
}));

vi.mock("../../constants/config", () => ({
  getGroupId: mockGetGroupId,
}));

vi.mock("../../hooks/useCurrentGroupPermissions", () => ({
  useCurrentGroupPermissions: mockUseCurrentGroupPermissions,
}));

vi.mock("../admin/AdminPanel", () => ({
  default: ({
    toggle,
  }: {
    isOpen: boolean;
    setIsOpen: (open: boolean) => void;
    toggle: React.ReactNode;
  }) => <div data-testid="admin-panel-toggle">{toggle}</div>,
}));

describe("AdminIcon", () => {
  beforeEach(() => {
    mockGetGroupId.mockReset();
    mockUseCurrentGroupPermissions.mockReset();
    mockGetGroupId.mockReturnValue("group-1");
  });

  it("shows non-admins the entry to the read-only member list", () => {
    mockUseCurrentGroupPermissions.mockReturnValue({
      loading: false,
      isAdmin: false,
      error: null,
    });

    render(<AdminIcon />);

    expect(screen.getByTestId("admin-panel-toggle")).toBeInTheDocument();
    expect(screen.getByLabelText("Workspace members")).toBeInTheDocument();
  });

  it("keeps the entry, marked, when the role lookup failed", () => {
    // `isAdmin` is false both for a member and for an admin whose lookup
    // failed. The entry used to vanish in both cases, silently.
    mockUseCurrentGroupPermissions.mockReturnValue({
      loading: false,
      isAdmin: false,
      error: "HTTP 502",
    });

    render(<AdminIcon />);

    expect(screen.getByTestId("workspace-admin-error")).toBeInTheDocument();
    expect(screen.getByLabelText(/couldn't check your workspace role/i)).toBeInTheDocument();
  });

  it("renders nothing outside a workspace", () => {
    mockGetGroupId.mockReturnValue("");
    mockUseCurrentGroupPermissions.mockReturnValue({ loading: false, isAdmin: false, error: null });

    render(<AdminIcon />);

    expect(screen.queryByTestId("admin-panel-toggle")).not.toBeInTheDocument();
  });

  it("shows the admin entry for admins", () => {
    mockUseCurrentGroupPermissions.mockReturnValue({
      loading: false,
      isAdmin: true,
    });

    render(<AdminIcon />);

    expect(screen.getByTestId("admin-panel-toggle")).toBeInTheDocument();
  });
});
