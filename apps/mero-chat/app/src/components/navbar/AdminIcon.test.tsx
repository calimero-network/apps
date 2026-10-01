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

  it("hides the admin entry for non-admin members", () => {
    mockUseCurrentGroupPermissions.mockReturnValue({
      loading: false,
      isAdmin: false,
    });

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
