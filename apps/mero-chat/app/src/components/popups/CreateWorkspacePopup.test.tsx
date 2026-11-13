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
  mockCreateChannel,
  mockSetGroupMetadata,
  mockSetStoredGroupAlias,
} = vi.hoisted(() => ({
  mockSetGroupMetadata: vi.fn(),
  mockSetStoredGroupAlias: vi.fn(),
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
  mockCreateChannel: vi.fn(),
}));

vi.mock("../../utils/createChannel", () => ({
  GENERAL_CHANNEL: "general",
  createChannel: mockCreateChannel,
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

vi.mock("../../api/meroJsClient", () => ({
  isDelegatedSession: () => session.isDelegated,
}));

// Calimero 1.0 has nothing to look up or install: channels come from chat's
// package. The workspace is founded under whatever the resolver answers.
vi.mock("../../utils/installedApps", () => ({
  AppNotInstalledError: class AppNotInstalledError extends Error {},
  resolveInstalledAppId: async (preferred: string) => preferred,
  installConfiguredApp: async () => "app-1",
}));

vi.mock("../../api/dataSource/groupApiDataSource", () => ({
  GroupApiDataSource: class MockGroupApiDataSource {
    createGroup = mockCreateGroup;
    resolveCurrentMemberIdentity = mockResolveCurrentMemberIdentity;
    setDefaultCapabilities = mockSetDefaultCapabilities;
    setMemberMetadata = mockSetMemberMetadata;
    setGroupMetadata = mockSetGroupMetadata;
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
  getGroupId: () => "",
  setGroupId: mockSetGroupId,
  setGroupMemberIdentity: mockSetGroupMemberIdentity,
  setStoredGroupAlias: mockSetStoredGroupAlias,
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
    // The name used in the last workspace: the next one offers it.
    localStorage.setItem("calimero-names:last", "Sandi");
    mockCreateInvitation.mockReset();
    mockCreateGroupContext.mockReset();
    mockSetGroupId.mockReset();
    mockSetGroupMemberIdentity.mockReset();
    mockSerializeGroupInvitationPayload.mockReset();
    mockGetRegistryVersions.mockReset();
    mockInstallApplication.mockReset();
    mockCreateChannel.mockReset();
    mockCreateChannel.mockResolvedValue({ contextId: "ctx-general", memberKey: "key-1" });
    mockSetGroupMetadata.mockReset().mockResolvedValue({ data: undefined, error: null });
    mockSetStoredGroupAlias.mockReset();

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

  it("says the workspace starts with #general", () => {
    render(<CreateWorkspacePopup onSuccess={vi.fn()} onCancel={vi.fn()} />);

    expect(screen.getByText(/#general/i)).toBeInTheDocument();
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
    localStorage.removeItem("calimero-names:last");
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
    expect(localStorage.getItem("chat-username:group-1")).toBe("Ana");
  });

  it("creates a public #general, after the name, before entering", async () => {
    const onSuccess = vi.fn();
    render(<CreateWorkspacePopup onSuccess={onSuccess} onCancel={vi.fn()} />);

    fireEvent.change(screen.getByRole("textbox", { name: /namespace name/i }), {
      target: { value: "Team Space" },
    });
    fireEvent.click(screen.getByRole("button", { name: /^create$/i }));

    await waitFor(() => {
      expect(onSuccess).toHaveBeenCalledWith("group-1");
    });
    expect(mockCreateChannel).toHaveBeenCalledWith("group-1", "general", true);
    // The channel profile takes the name chosen above.
    expect(mockSetMemberMetadata.mock.invocationCallOrder[0]).toBeLessThan(
      mockCreateChannel.mock.invocationCallOrder[0],
    );
    expect(mockCreateChannel.mock.invocationCallOrder[0]).toBeLessThan(
      onSuccess.mock.invocationCallOrder[0],
    );
    expect(mockAddToast).not.toHaveBeenCalled();
  });

  it.each([
    ["returns an error", () => mockCreateChannel.mockResolvedValue({ error: "exists" })],
    ["throws", () => mockCreateChannel.mockRejectedValue(new Error("exists"))],
  ])("still enters the workspace and says so when #general %s", async (_, arrange) => {
    arrange();
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
        title: "Workspace created without #general",
        message: expect.stringContaining("exists"),
      }),
    );
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

  // The sidebar's create used to make the new workspace the current one before
  // your name was saved: a step failing or declined after that left the app in
  // a workspace with no name for you. It now saves the name first and switches
  // last, as the workspace picker does.
  it("keeps your name, and does not switch to the workspace, when a later step fails", async () => {
    mockResolveCurrentMemberIdentity.mockRejectedValue(new Error("node unreachable"));
    const onSuccess = vi.fn();
    render(<CreateWorkspacePopup onSuccess={onSuccess} onCancel={vi.fn()} />);

    fireEvent.change(screen.getByRole("textbox", { name: /namespace name/i }), {
      target: { value: "Team Space" },
    });
    fireEvent.change(screen.getByRole("textbox", { name: /your display name/i }), {
      target: { value: "Bruno" },
    });
    fireEvent.click(screen.getByRole("button", { name: /^create$/i }));

    expect(await screen.findByText(/node unreachable/i)).toBeInTheDocument();
    expect(localStorage.getItem("chat-username:group-1")).toBe("Bruno");
    expect(mockSetGroupId).not.toHaveBeenCalled();
    expect(onSuccess).not.toHaveBeenCalled();
  });

  it("names the workspace as the picker does, and switches to it last", async () => {
    const onSuccess = vi.fn();
    render(<CreateWorkspacePopup onSuccess={onSuccess} onCancel={vi.fn()} />);

    fireEvent.change(screen.getByRole("textbox", { name: /namespace name/i }), {
      target: { value: "Team Space" },
    });
    fireEvent.click(screen.getByRole("button", { name: /^create$/i }));

    await waitFor(() => expect(onSuccess).toHaveBeenCalledWith("group-1"));
    expect(mockSetStoredGroupAlias).toHaveBeenCalledWith("group-1", "Team Space");
    // The organization is made under the name: nothing is renamed after.
    expect(mockSetGroupMetadata).not.toHaveBeenCalled();
    // Switched only once the name, the member record and #general are done.
    expect(mockSetGroupId.mock.invocationCallOrder[0]).toBeGreaterThan(
      mockCreateChannel.mock.invocationCallOrder[0],
    );
    expect(mockSetGroupId.mock.invocationCallOrder[0]).toBeGreaterThan(
      mockSetMemberMetadata.mock.invocationCallOrder[0],
    );
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
