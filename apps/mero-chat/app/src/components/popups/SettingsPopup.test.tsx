import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import SettingsPopup from "./SettingsPopup";

const {
  mockLogout,
  mockClearStoredSession,
  mockClearWorkspaceSelection,
  mockNavigate,
  mockDeleteNamespace,
  perms,
  session,
} = vi.hoisted(() => ({
  mockLogout: vi.fn(),
  mockClearStoredSession: vi.fn(),
  mockClearWorkspaceSelection: vi.fn(),
  mockNavigate: vi.fn(),
  mockDeleteNamespace: vi.fn(),
  perms: {
    current: { isAdmin: false, loading: false, error: null as string | null, memberIdentity: "me" },
  },
  session: { isDelegated: false },
}));

vi.mock("@calimero-apps/cloud", async (importOriginal) => ({
  ...(await importOriginal<Record<string, unknown>>()),
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
  isDelegatedSession: () => session.isDelegated,
}));

vi.mock("../../hooks/useCurrentGroupPermissions", () => ({
  useCurrentGroupPermissions: () => ({ ...perms.current, canCreateContext: false }),
}));

vi.mock("../../api/dataSource/groupApiDataSource", () => ({
  GroupApiDataSource: class {
    leaveGroup = vi.fn();
    leaveNamespace = vi.fn().mockResolvedValue({ data: null, error: null });
    deleteNamespace = mockDeleteNamespace;
    // `useWorkspaceName` reads the workspace's replicated name and backfills a
    // local-only one. An undefined method throws synchronously rather than
    // rejecting, so the hook's `.catch` does not cover it.
    getGroupMetadata = vi.fn().mockResolvedValue({ data: null, error: null });
    setGroupMetadata = vi.fn().mockResolvedValue({ data: undefined, error: null });
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
    mockClearWorkspaceSelection.mockReset();
    mockNavigate.mockReset();
    mockDeleteNamespace.mockReset().mockResolvedValue({ data: true, error: null });
    perms.current = { isAdmin: false, loading: false, error: null, memberIdentity: "me" };
    session.isDelegated = false;
    sessionStorage.clear();
  });

  const renderOpen = () =>
    render(<SettingsPopup isOpen={true} setIsOpen={vi.fn()} toggle={<button>Open</button>} />);

  it("offers a member Leave, never Delete", () => {
    renderOpen();
    expect(screen.getByRole("button", { name: /^leave workspace$/i })).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /delete workspace/i })).not.toBeInTheDocument();
  });

  it("offers an admin Delete, never Leave, and deletes the namespace on confirm", async () => {
    perms.current = { ...perms.current, isAdmin: true };
    renderOpen();
    expect(screen.queryByRole("button", { name: /leave workspace/i })).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: /^delete workspace$/i }));
    fireEvent.click(screen.getByRole("button", { name: /confirm delete/i }));
    await waitFor(() => expect(mockDeleteNamespace).toHaveBeenCalledWith("group-1"));
    await waitFor(() => expect(mockNavigate).toHaveBeenCalledWith("/login"));
  });

  it("offers neither while the role is unknown, so an admin is never shown Leave", () => {
    perms.current = { isAdmin: false, loading: false, error: "Could not read your role", memberIdentity: "" };
    renderOpen();
    expect(screen.queryByRole("button", { name: /leave workspace/i })).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /delete workspace/i })).not.toBeInTheDocument();
  });

  it("does not offer an account admin a namespace delete it has no form of", () => {
    perms.current = { ...perms.current, isAdmin: true };
    session.isDelegated = true;
    renderOpen();
    expect(screen.queryByRole("button", { name: /delete workspace/i })).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /leave workspace/i })).not.toBeInTheDocument();
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
    expect(mockLogout).toHaveBeenCalled();
    expect(mockNavigate).not.toHaveBeenCalled();
    expect(setIsOpen).toHaveBeenCalledWith(false);
  });

  it("switches the theme from the Appearance section", () => {
    localStorage.removeItem("mero-chat:theme");
    document.documentElement.removeAttribute("data-theme");
    render(
      <SettingsPopup
        isOpen={true}
        setIsOpen={vi.fn()}
        toggle={<button>Open</button>}
      />,
    );

    const light = screen.getByRole("button", { name: "Light" });
    const dark = screen.getByRole("button", { name: "Dark" });
    expect(light).toHaveAttribute("aria-pressed", "true");
    expect(dark).toHaveAttribute("aria-pressed", "false");

    fireEvent.click(dark);
    expect(document.documentElement).toHaveAttribute("data-theme", "dark");
    expect(localStorage.getItem("mero-chat:theme")).toBe("dark");
    expect(screen.getByRole("button", { name: "Dark" })).toHaveAttribute("aria-pressed", "true");

    fireEvent.click(screen.getByRole("button", { name: "Light" }));
    expect(document.documentElement).not.toHaveAttribute("data-theme");
    expect(localStorage.getItem("mero-chat:theme")).toBe("light");
  });
});
