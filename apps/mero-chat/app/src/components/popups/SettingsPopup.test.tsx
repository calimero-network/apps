import { fireEvent, render, screen } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import SettingsPopup from "./SettingsPopup";

const {
  mockLogout,
  mockClearStoredSession,
  mockClearSessionActivity,
  mockClearWorkspaceSelection,
  mockNavigate,
} = vi.hoisted(() => ({
  mockLogout: vi.fn(),
  mockClearStoredSession: vi.fn(),
  mockClearSessionActivity: vi.fn(),
  mockClearWorkspaceSelection: vi.fn(),
  mockNavigate: vi.fn(),
}));

vi.mock("@calimero-network/mero-react", () => ({
  useMero: () => ({ logout: mockLogout }),
  getNodeUrl: vi.fn(),
  getContextId: vi.fn(),
  getContextIdentity: vi.fn(),
}));

vi.mock("react-router-dom", () => ({
  useNavigate: () => mockNavigate,
}));

vi.mock("../../utils/session", () => ({
  clearStoredSession: mockClearStoredSession,
  clearSessionActivity: mockClearSessionActivity,
  clearNamespaceReady: vi.fn(),
}));

vi.mock("../../constants/config", () => ({
  clearWorkspaceSelection: mockClearWorkspaceSelection,
  getGroupId: () => "group-1",
  getStoredGroupAlias: () => "Test Workspace",
}));

vi.mock("../../api/meroJsClient", () => ({
  getAuthConfig: vi.fn(),
  nodeApi: {},
}));

vi.mock("../../hooks/useCurrentGroupPermissions", () => ({
  useCurrentGroupPermissions: () => ({ isAdmin: false, canCreateContext: false }),
}));

vi.mock("../../api/dataSource/groupApiDataSource", () => ({
  GroupApiDataSource: class {
    leaveGroup = vi.fn();
    leaveNamespace = vi.fn().mockResolvedValue({ data: null, error: null });
  },
}));

vi.mock("../../contexts/ToastContext", () => ({
  useToast: () => ({ addToast: vi.fn() }),
}));

vi.mock("../common/popups/BaseModal", () => ({
  default: ({
    content,
    open,
  }: {
    content: React.ReactNode;
    open: boolean;
  }) => (open ? <div>{content}</div> : null),
}));

vi.mock("../contextOperations/TabbedInterface", () => ({
  default: () => <div>Tabbed Interface</div>,
}));

describe("SettingsPopup", () => {
  beforeEach(() => {
    mockLogout.mockReset();
    mockClearStoredSession.mockReset();
    mockClearSessionActivity.mockReset();
    mockClearWorkspaceSelection.mockReset();
    mockNavigate.mockReset();
    sessionStorage.clear();
  });

  it("shows separate actions for changing workspace and full logout", () => {
    render(
      <SettingsPopup
        isOpen={true}
        setIsOpen={vi.fn()}
        toggle={<button>Open</button>}
      />,
    );

    expect(
      screen.getByRole("button", { name: /change workspace/i }),
    ).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /^logout$/i })).toBeInTheDocument();
  });

  it("changes workspace without performing a full logout", () => {
    const setIsOpen = vi.fn();

    render(
      <SettingsPopup
        isOpen={true}
        setIsOpen={setIsOpen}
        toggle={<button>Open</button>}
      />,
    );

    fireEvent.click(screen.getByRole("button", { name: /change workspace/i }));

    expect(mockClearWorkspaceSelection).toHaveBeenCalled();
    expect(mockLogout).not.toHaveBeenCalled();
    expect(mockClearStoredSession).not.toHaveBeenCalled();
    expect(mockNavigate).toHaveBeenCalledWith("/login");
    expect(setIsOpen).toHaveBeenCalledWith(false);
  });

  it("keeps full logout behavior on the logout action", () => {
    const setIsOpen = vi.fn();

    render(
      <SettingsPopup
        isOpen={true}
        setIsOpen={setIsOpen}
        toggle={<button>Open</button>}
      />,
    );

    fireEvent.click(screen.getByRole("button", { name: /^logout$/i }));

    expect(mockClearStoredSession).toHaveBeenCalled();
    expect(mockClearSessionActivity).toHaveBeenCalled();
    expect(mockLogout).toHaveBeenCalled();
    expect(mockNavigate).not.toHaveBeenCalled();
    expect(setIsOpen).toHaveBeenCalledWith(false);
  });
});
