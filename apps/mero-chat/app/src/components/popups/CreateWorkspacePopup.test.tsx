import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import CreateWorkspacePopup from "./CreateWorkspacePopup";

const {
  session,
  mockAddToast,
  mockListApplications,
  mockCreateGroup,
  mockResolveCurrentMemberIdentity,
  mockSetDefaultCapabilities,
  mockSetMemberMetadata,
  mockCreateInvitation,
  mockCreateGroupContext,
  mockSetGroupId,
  mockSetGroupMemberIdentity,
  mockSerializeGroupInvitationPayload,
  mockGetRegistryVersions,
  mockInstallApplication,
} = vi.hoisted(() => ({
  // What `MeroJsBridge` records about the session; flipped per test.
  session: { isDelegated: false, applicationId: null as string | null },
  mockAddToast: vi.fn(),
  mockListApplications: vi.fn(),
  mockCreateGroup: vi.fn(),
  mockResolveCurrentMemberIdentity: vi.fn(),
  mockSetDefaultCapabilities: vi.fn(),
  mockSetMemberMetadata: vi.fn(),
  mockCreateInvitation: vi.fn(),
  mockCreateGroupContext: vi.fn(),
  mockSetGroupId: vi.fn(),
  mockSetGroupMemberIdentity: vi.fn(),
  mockSerializeGroupInvitationPayload: vi.fn(),
  mockGetRegistryVersions: vi.fn(),
  mockInstallApplication: vi.fn(),
}));

vi.mock("../../contexts/ToastContext", () => ({
  useToast: () => ({ addToast: mockAddToast }),
}));

vi.mock("@calimero-network/mero-ui", () => ({
  Button: ({
    children,
    onClick,
    disabled,
    type,
  }: {
    children: React.ReactNode;
    onClick?: () => void;
    disabled?: boolean;
    type?: "button" | "submit";
  }) => (
    <button type={type ?? "button"} onClick={onClick} disabled={disabled}>
      {children}
    </button>
  ),
  Input: (props: React.InputHTMLAttributes<HTMLInputElement>) => (
    <input {...props} />
  ),
}));

vi.mock("@calimero-network/mero-react", async (importOriginal) => ({
  ...(await importOriginal<Record<string, unknown>>()),
  getNodeUrl: () => "http://localhost:2428",
}));

// The session admin, as `MeroJsBridge` hands it out: the "is chat installed"
// listing and the install both go through it, never a raw node route.
vi.mock("../../api/meroJsClient", () => ({
  getMeroJs: () => ({
    isDelegated: session.isDelegated,
    applicationId: session.applicationId,
    admin: {
      listApplications: mockListApplications,
      getRegistryVersions: mockGetRegistryVersions,
      installApplication: mockInstallApplication,
    },
  }),
  isDelegatedSession: () => session.isDelegated,
}));

vi.mock("../../api/dataSource/groupApiDataSource", () => ({
  GroupApiDataSource: class MockGroupApiDataSource {
    createGroup = mockCreateGroup;
    resolveCurrentMemberIdentity = mockResolveCurrentMemberIdentity;
    setDefaultCapabilities = mockSetDefaultCapabilities;
    setMemberMetadata = mockSetMemberMetadata;
    createInvitation = mockCreateInvitation;
  },
}));

vi.mock("../../api/dataSource/nodeApiDataSource", () => ({
  ContextApiDataSource: class MockContextApiDataSource {
    createGroupContext = mockCreateGroupContext;
  },
}));

vi.mock("../../constants/config", () => ({
  getApplicationId: () => "app-1",
  setGroupId: mockSetGroupId,
  setGroupMemberIdentity: mockSetGroupMemberIdentity,
}));

vi.mock("../../utils/invitation", () => ({
  APP_SLUG: "com.calimero.chat",
  serializeGroupInvitationPayload: mockSerializeGroupInvitationPayload,
}));

vi.mock("./GroupInviteModal", () => ({
  default: ({
    groupId,
    title,
    subtitle,
    successMessage,
  }: {
    groupId: string;
    title: string;
    subtitle: string;
    successMessage: string;
  }) => (
    <div>
      <div>{title}</div>
      <div>{subtitle}</div>
      <div>{successMessage}</div>
      <div>Workspace ID: {groupId}</div>
    </div>
  ),
}));

describe("CreateWorkspacePopup", () => {
  beforeEach(() => {
    session.isDelegated = false;
    session.applicationId = null;
    mockAddToast.mockReset();
    mockListApplications.mockReset();
    mockCreateGroup.mockReset();
    mockResolveCurrentMemberIdentity.mockReset();
    mockSetDefaultCapabilities.mockReset();
    mockSetMemberMetadata.mockReset();
    mockSetMemberMetadata.mockResolvedValue({ data: undefined, error: null });
    // The name chosen in another workspace prefills this one's name field.
    localStorage.setItem("chat-username", "Sandi");
    mockCreateInvitation.mockReset();
    mockCreateGroupContext.mockReset();
    mockSetGroupId.mockReset();
    mockSetGroupMemberIdentity.mockReset();
    mockSerializeGroupInvitationPayload.mockReset();
    mockGetRegistryVersions.mockReset();
    mockInstallApplication.mockReset();

    mockListApplications.mockResolvedValue({ apps: [{ id: "app-1" }] });
    mockCreateGroup.mockResolvedValue({
      data: {
        groupId: "group-1",
      },
    });
    mockSetDefaultCapabilities.mockResolvedValue({ data: undefined, error: null });
    mockResolveCurrentMemberIdentity.mockResolvedValue({
      data: {
        memberIdentity: "member-1",
      },
    });
    mockCreateInvitation.mockResolvedValue({
      data: {
        invitation: {
          invitation: "payload",
        },
        groupAlias: "Team Space",
      },
    });
    mockSerializeGroupInvitationPayload.mockReturnValue("serialized-invite");
  });

  it("describes workspace-only creation without a default general channel", () => {
    render(<CreateWorkspacePopup onSuccess={vi.fn()} onCancel={vi.fn()} />);

    expect(screen.queryByText(/#general/i)).not.toBeInTheDocument();
    expect(
      screen.getByRole("textbox", { name: /namespace name/i }),
    ).toBeInTheDocument();
  });

  it("requires a workspace name before creation is enabled", () => {
    render(<CreateWorkspacePopup onSuccess={vi.fn()} onCancel={vi.fn()} />);

    const createButton = screen.getByRole("button", { name: /^create$/i });
    const nameInput = screen.getByRole("textbox", { name: /namespace name/i });

    expect(createButton).toBeDisabled();

    fireEvent.change(nameInput, { target: { value: "   " } });
    expect(createButton).toBeDisabled();

    fireEvent.change(nameInput, { target: { value: "Team Space" } });
    expect(createButton).toBeEnabled();
  });

  it("asks for a display name, prefilled with the one used elsewhere", () => {
    render(<CreateWorkspacePopup onSuccess={vi.fn()} onCancel={vi.fn()} />);

    const createButton = screen.getByRole("button", { name: /^create$/i });
    const displayName = screen.getByRole("textbox", { name: /your display name/i });
    fireEvent.change(screen.getByRole("textbox", { name: /namespace name/i }), {
      target: { value: "Team Space" },
    });

    expect(displayName).toHaveValue("Sandi");
    expect(createButton).toBeEnabled();

    fireEvent.change(displayName, { target: { value: "   " } });
    expect(createButton).toBeDisabled();
  });

  it("starts with an empty display name when none was ever chosen", () => {
    localStorage.removeItem("chat-username");
    render(<CreateWorkspacePopup onSuccess={vi.fn()} onCancel={vi.fn()} />);

    fireEvent.change(screen.getByRole("textbox", { name: /namespace name/i }), {
      target: { value: "Team Space" },
    });

    expect(screen.getByRole("textbox", { name: /your display name/i })).toHaveValue("");
    expect(screen.getByRole("button", { name: /^create$/i })).toBeDisabled();
  });

  it("publishes the display name as the new member's name before entering", async () => {
    const onSuccess = vi.fn();
    render(<CreateWorkspacePopup onSuccess={onSuccess} onCancel={vi.fn()} />);

    fireEvent.change(screen.getByRole("textbox", { name: /namespace name/i }), {
      target: { value: "Team Space" },
    });
    fireEvent.change(screen.getByRole("textbox", { name: /your display name/i }), {
      target: { value: "  Ana  " },
    });
    fireEvent.click(screen.getByRole("button", { name: /^create$/i }));

    await waitFor(() => {
      expect(onSuccess).toHaveBeenCalledWith("group-1");
    });
    expect(mockSetMemberMetadata).toHaveBeenCalledWith("group-1", "member-1", {
      name: "Ana",
    });
    // Published before `onSuccess` reloads the page and would abort it.
    expect(mockSetMemberMetadata.mock.invocationCallOrder[0]).toBeLessThan(
      onSuccess.mock.invocationCallOrder[0],
    );
    expect(localStorage.getItem("chat-username")).toBe("Ana");
  });

  it("still enters the workspace when publishing the name fails", async () => {
    mockSetMemberMetadata.mockResolvedValue({
      data: null,
      error: { code: 500, message: "boom" },
    });
    const onSuccess = vi.fn();
    render(<CreateWorkspacePopup onSuccess={onSuccess} onCancel={vi.fn()} />);

    fireEvent.change(screen.getByRole("textbox", { name: /namespace name/i }), {
      target: { value: "Team Space" },
    });
    fireEvent.click(screen.getByRole("button", { name: /^create$/i }));

    await waitFor(() => {
      expect(onSuccess).toHaveBeenCalledWith("group-1");
    });
  });

  it("creates the workspace and calls onSuccess with the group id", async () => {
    const onSuccess = vi.fn();
    render(<CreateWorkspacePopup onSuccess={onSuccess} onCancel={vi.fn()} />);

    fireEvent.change(screen.getByRole("textbox", { name: /namespace name/i }), {
      target: { value: "  Team Space  " },
    });
    fireEvent.click(screen.getByRole("button", { name: /^create$/i }));

    await waitFor(() => {
      expect(mockCreateGroup).toHaveBeenCalledWith({
        applicationId: "app-1",
        name: "Team Space",
      });
    });

    expect(mockCreateGroupContext).not.toHaveBeenCalled();
    expect(mockSetGroupId).toHaveBeenCalledWith("group-1");
    expect(mockSetGroupMemberIdentity).toHaveBeenCalledWith("group-1", "member-1");

    await waitFor(() => {
      expect(onSuccess).toHaveBeenCalledWith("group-1");
    });
  });

  it("offers to install instead of falling back to another installed app", async () => {
    // Node has a different app installed. The old code returned appIds[0]
    // here and created the workspace against mero-meet et al.
    mockListApplications.mockResolvedValue({ apps: [{ id: "some-other-app" }] });

    render(<CreateWorkspacePopup onSuccess={vi.fn()} onCancel={vi.fn()} />);
    fireEvent.change(screen.getByRole("textbox", { name: /namespace name/i }), {
      target: { value: "Team Space" },
    });
    fireEvent.click(screen.getByRole("button", { name: /^create$/i }));

    await waitFor(() => {
      expect(screen.getByRole("button", { name: /^install$/i })).toBeInTheDocument();
    });
    expect(mockCreateGroup).not.toHaveBeenCalled();
  });

  it("installs the configured app and then creates the workspace", async () => {
    mockListApplications
      .mockResolvedValueOnce({ apps: [] })
      .mockResolvedValue({ apps: [{ id: "app-1" }] });
    mockGetRegistryVersions.mockResolvedValue(["3.1.2", "3.1.1"]);
    mockInstallApplication.mockResolvedValue({ applicationId: "app-1" });

    const onSuccess = vi.fn();
    render(<CreateWorkspacePopup onSuccess={onSuccess} onCancel={vi.fn()} />);
    fireEvent.change(screen.getByRole("textbox", { name: /namespace name/i }), {
      target: { value: "Team Space" },
    });
    fireEvent.click(screen.getByRole("button", { name: /^create$/i }));

    await waitFor(() => {
      expect(screen.getByRole("button", { name: /^install$/i })).toBeInTheDocument();
    });
    fireEvent.click(screen.getByRole("button", { name: /^install$/i }));

    await waitFor(() => {
      // By registry coordinates — the newest published version. The node
      // refuses the old `{ url, metadata }` body (deny_unknown_fields).
      expect(mockInstallApplication).toHaveBeenCalledWith({
        package: "com.calimero.chat",
        version: "3.1.2",
      });
    });
    await waitFor(() => {
      expect(onSuccess).toHaveBeenCalledWith("group-1");
    });
  });

  it("reports a mismatch when the installed app id is not the configured one", async () => {
    mockListApplications.mockResolvedValue({ apps: [] });
    mockGetRegistryVersions.mockResolvedValue(["3.1.2"]);
    mockInstallApplication.mockResolvedValue({ applicationId: "different-app" });

    render(<CreateWorkspacePopup onSuccess={vi.fn()} onCancel={vi.fn()} />);
    fireEvent.change(screen.getByRole("textbox", { name: /namespace name/i }), {
      target: { value: "Team Space" },
    });
    fireEvent.click(screen.getByRole("button", { name: /^create$/i }));

    await waitFor(() => {
      expect(screen.getByRole("button", { name: /^install$/i })).toBeInTheDocument();
    });
    fireEvent.click(screen.getByRole("button", { name: /^install$/i }));

    await waitFor(() => {
      expect(screen.getByText(/expects app-1/i)).toBeInTheDocument();
    });
    expect(mockCreateGroup).not.toHaveBeenCalled();
  });

  it("on an account, founds under the registry id without listing the node's applications", async () => {
    // An account has no "installed" set: a relay's `/admin-api/applications`
    // is not its to read (403) and its contexts are created under the id the
    // registry derives for chat's package, which mero-react resolved.
    session.isDelegated = true;
    session.applicationId = "registry-app-id";
    mockListApplications.mockRejectedValue(new Error("HTTP 403"));

    const onSuccess = vi.fn();
    render(<CreateWorkspacePopup onSuccess={onSuccess} onCancel={vi.fn()} />);
    fireEvent.change(screen.getByRole("textbox", { name: /namespace name/i }), {
      target: { value: "Team Space" },
    });
    fireEvent.click(screen.getByRole("button", { name: /^create$/i }));

    await waitFor(() => {
      expect(mockCreateGroup).toHaveBeenCalledWith({
        applicationId: "registry-app-id",
        name: "Team Space",
      });
    });
    expect(mockListApplications).not.toHaveBeenCalled();
    expect(screen.queryByRole("button", { name: /^install$/i })).not.toBeInTheDocument();
    await waitFor(() => {
      expect(onSuccess).toHaveBeenCalledWith("group-1");
    });
    expect(mockAddToast).not.toHaveBeenCalled();
  });

  it("on an account, says so when the cloud refused to host the new workspace", async () => {
    // The workspace exists; what is lost is inviting anyone until the account
    // is linked. Surfaced right away, not as a failed Invite later.
    session.isDelegated = true;
    session.applicationId = "registry-app-id";
    mockCreateGroup.mockResolvedValue({
      data: {
        groupId: "group-1",
        haEnabled: false,
        haError: "link this account to your cloud user in the wallet so invitees can find this namespace",
      },
    });

    const onSuccess = vi.fn();
    render(<CreateWorkspacePopup onSuccess={onSuccess} onCancel={vi.fn()} />);
    fireEvent.change(screen.getByRole("textbox", { name: /namespace name/i }), {
      target: { value: "Team Space" },
    });
    fireEvent.click(screen.getByRole("button", { name: /^create$/i }));

    await waitFor(() => {
      expect(onSuccess).toHaveBeenCalledWith("group-1");
    });
    expect(mockAddToast).toHaveBeenCalledWith(
      expect.objectContaining({
        title: expect.stringMatching(/not hosted/i),
        message: expect.stringContaining("link this account to your cloud user"),
      }),
    );
  });
});
