import { render, screen } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import AdminPanel from "./AdminPanel";

const {
  mockGetGroupId,
  mockUseCurrentGroupPermissions,
  mockUseGroupAdmin,
} = vi.hoisted(() => ({
  mockGetGroupId: vi.fn(),
  mockUseCurrentGroupPermissions: vi.fn(),
  mockUseGroupAdmin: vi.fn(),
}));

vi.mock("../../constants/config", () => ({
  getGroupId: mockGetGroupId,
}));

vi.mock("../../hooks/useCurrentGroupPermissions", () => ({
  useCurrentGroupPermissions: mockUseCurrentGroupPermissions,
}));

vi.mock("../../hooks/useGroupAdmin", () => ({
  useGroupAdmin: mockUseGroupAdmin,
}));

vi.mock("../common/popups/BaseModal", () => ({
  default: ({
    content,
    open,
  }: {
    toggle: React.ReactNode;
    content: React.ReactNode;
    open: boolean;
    onOpenChange: (open: boolean) => void;
  }) => (open ? <div>{content}</div> : null),
}));

vi.mock("./MembersTab", () => ({
  default: () => <div>Members Tab</div>,
}));

vi.mock("./ChannelsTab", () => ({
  default: () => <div>Channels Tab</div>,
}));

vi.mock("./SettingsTab", () => ({
  default: () => <div>Settings Tab</div>,
}));

vi.mock("./UpgradeTab", () => ({
  default: () => <div>Upgrade Tab</div>,
}));

describe("AdminPanel", () => {
  beforeEach(() => {
    mockGetGroupId.mockReset();
    mockUseCurrentGroupPermissions.mockReset();
    mockUseGroupAdmin.mockReset();

    mockGetGroupId.mockReturnValue("group-1");
    mockUseGroupAdmin.mockReturnValue({
      group: null,
      members: [],
      upgradeStatus: null,
      loading: false,
      actionLoading: false,
      error: null,
      fetchAll: vi.fn(),
      clearError: vi.fn(),
      removeMember: vi.fn(),
      setMemberCapabilities: vi.fn(),
      getMemberCapabilities: vi.fn(),
      getContextVisibility: vi.fn(),
      setContextVisibility: vi.fn(),
      getContextAllowlist: vi.fn(),
      manageAllowlist: vi.fn(),
      setDefaultCapabilities: vi.fn(),
      setSubgroupVisibility: vi.fn(),
      triggerUpgrade: vi.fn(),
      refreshUpgradeStatus: vi.fn(),
    });
  });

  it("does not render admin content for non-admin members", () => {
    mockUseCurrentGroupPermissions.mockReturnValue({
      loading: false,
      isAdmin: false,
    });

    render(
      <AdminPanel
        isOpen={true}
        setIsOpen={vi.fn()}
        toggle={<button>toggle</button>}
      />,
    );

    expect(screen.queryByText("Workspace Admin")).not.toBeInTheDocument();
  });

  it("renders admin content for admins", () => {
    mockUseCurrentGroupPermissions.mockReturnValue({
      loading: false,
      isAdmin: true,
    });

    render(
      <AdminPanel
        isOpen={true}
        setIsOpen={vi.fn()}
        toggle={<button>toggle</button>}
      />,
    );

    expect(screen.getByText("Workspace Admin")).toBeInTheDocument();
  });

  it("does not refetch admin data on rerender when hook object identity changes", () => {
    const fetchAll = vi.fn();

    mockUseCurrentGroupPermissions.mockReturnValue({
      loading: false,
      isAdmin: true,
    });

    mockUseGroupAdmin.mockImplementation(() => ({
      group: null,
      members: [],
      upgradeStatus: null,
      loading: false,
      actionLoading: false,
      error: null,
      fetchAll,
      clearError: vi.fn(),
      removeMember: vi.fn(),
      setMemberCapabilities: vi.fn(),
      getMemberCapabilities: vi.fn(),
      getContextVisibility: vi.fn(),
      setContextVisibility: vi.fn(),
      getContextAllowlist: vi.fn(),
      manageAllowlist: vi.fn(),
      setDefaultCapabilities: vi.fn(),
      setSubgroupVisibility: vi.fn(),
      triggerUpgrade: vi.fn(),
      refreshUpgradeStatus: vi.fn(),
    }));

    const view = render(
      <AdminPanel
        isOpen={true}
        setIsOpen={vi.fn()}
        toggle={<button>toggle</button>}
      />,
    );

    expect(fetchAll).toHaveBeenCalledTimes(1);

    view.rerender(
      <AdminPanel
        isOpen={true}
        setIsOpen={vi.fn()}
        toggle={<button>toggle</button>}
      />,
    );

    expect(fetchAll).toHaveBeenCalledTimes(1);
  });
});
