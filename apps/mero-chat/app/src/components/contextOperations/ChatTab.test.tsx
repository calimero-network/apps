import { render, screen, waitFor } from "@testing-library/react";
import type { ComponentProps } from "react";
import { MemoryRouter } from "react-router-dom";
import { beforeEach, describe, expect, it, vi } from "vitest";
import ChatTab from "./ChatTab";

const {
  mockNavigate,
  mockListGroups,
  mockJoinGroup,
  mockResolveCurrentMemberIdentity,
  mockSetMemberAlias,
  mockSetGroupMemberIdentity,
  mockSetGroupId,
  mockGetGroupId,
  mockGetGroupMemberIdentity,
  mockGetStoredGroupAlias,
  mockGetMessengerDisplayName,
  mockSetStoredGroupAlias,
  mockSetMessengerDisplayName,
  mockClearStoredSession,
  mockParseInvitationInput,
  mockParseGroupInvitationPayload,
} = vi.hoisted(() => ({
  mockNavigate: vi.fn(),
  mockListGroups: vi.fn(),
  mockJoinGroup: vi.fn(),
  mockResolveCurrentMemberIdentity: vi.fn(),
  mockSetMemberAlias: vi.fn(),
  mockSetGroupMemberIdentity: vi.fn(),
  mockSetGroupId: vi.fn(),
  mockGetGroupId: vi.fn(),
  mockGetGroupMemberIdentity: vi.fn(),
  mockGetStoredGroupAlias: vi.fn(),
  mockGetMessengerDisplayName: vi.fn(),
  mockSetStoredGroupAlias: vi.fn(),
  mockSetMessengerDisplayName: vi.fn(),
  mockClearStoredSession: vi.fn(),
  mockParseInvitationInput: vi.fn(),
  mockParseGroupInvitationPayload: vi.fn(),
}));

vi.mock("react-router-dom", async () => {
  const actual = await vi.importActual<typeof import("react-router-dom")>(
    "react-router-dom",
  );

  return {
    ...actual,
    useNavigate: () => mockNavigate,
  };
});

vi.mock("@calimero-network/mero-react", () => ({
  getNodeUrl: () => "test-app-endpoint",
}));

vi.mock("../../api/dataSource/groupApiDataSource", () => ({
  GroupApiDataSource: class MockGroupApiDataSource {
    listGroups = mockListGroups;
    joinGroup = mockJoinGroup;
    resolveCurrentMemberIdentity = mockResolveCurrentMemberIdentity;
    setMemberMetadata = mockSetMemberAlias;
  },
}));

vi.mock("../../constants/config", () => ({
  getGroupId: mockGetGroupId,
  getGroupMemberIdentity: mockGetGroupMemberIdentity,
  getStoredGroupAlias: mockGetStoredGroupAlias,
  setGroupId: mockSetGroupId,
  setGroupMemberIdentity: mockSetGroupMemberIdentity,
  setStoredGroupAlias: mockSetStoredGroupAlias,
}));

vi.mock("../../utils/messengerName", () => ({
  getMessengerDisplayName: mockGetMessengerDisplayName,
  setMessengerDisplayName: mockSetMessengerDisplayName,
}));

vi.mock("../../utils/session", () => ({
  clearStoredSession: mockClearStoredSession,
}));

vi.mock("../../utils/invitation", () => ({
  parseInvitationInput: mockParseInvitationInput,
  parseGroupInvitationPayload: mockParseGroupInvitationPayload,
}));

function makeGroup(groupId: string, alias?: string) {
  return {
    groupId,
    alias,
    appKey: "test-app",
    targetApplicationId: "test-target",
    upgradePolicy: "Automatic" as const,
    createdAt: 0,
  };
}

function renderChatTab(props?: Partial<ComponentProps<typeof ChatTab>>) {
  return render(
    <MemoryRouter>
      <ChatTab
        isAuthenticated={true}
        isConfigSet={true}
        {...props}
      />
    </MemoryRouter>,
  );
}

describe("ChatTab", () => {
  beforeEach(() => {
    mockNavigate.mockReset();
    mockListGroups.mockReset();
    mockJoinGroup.mockReset();
    mockResolveCurrentMemberIdentity.mockReset();
    mockSetMemberAlias.mockReset();
    mockSetGroupMemberIdentity.mockReset();
    mockSetGroupId.mockReset();
    mockGetGroupId.mockReset();
    mockGetGroupMemberIdentity.mockReset();
    mockGetStoredGroupAlias.mockReset();
    mockGetMessengerDisplayName.mockReset();
    mockSetStoredGroupAlias.mockReset();
    mockSetMessengerDisplayName.mockReset();
    mockClearStoredSession.mockReset();
    mockParseInvitationInput.mockReset();
    mockParseGroupInvitationPayload.mockReset();

    mockGetGroupId.mockReturnValue("");
    mockGetGroupMemberIdentity.mockReturnValue("");
    mockGetStoredGroupAlias.mockReturnValue("");
    mockGetMessengerDisplayName.mockReturnValue("Ronit");
    mockSetMemberAlias.mockResolvedValue({
      data: undefined,
      error: null,
    });
    mockListGroups.mockResolvedValue({
      data: [makeGroup("group-1")],
    });
  });

  it("shows the group alias in the workspace picker when available", async () => {
    mockListGroups.mockResolvedValue({
      data: [makeGroup("group-1", "Product Team")],
    });

    renderChatTab();

    expect(
      await screen.findByRole("option", { name: "Product Team" }),
    ).toBeInTheDocument();
  });

  it("uses the locally stored group alias when the refreshed list is still unnamed", async () => {
    mockGetStoredGroupAlias.mockImplementation((groupId: string) =>
      groupId === "group-1" ? "Locally Named Workspace" : "",
    );
    mockListGroups.mockResolvedValue({
      data: [makeGroup("group-1")],
    });

    renderChatTab();

    expect(
      await screen.findByRole("option", { name: "Locally Named Workspace" }),
    ).toBeInTheDocument();
  });

  it("falls back to a truncated group ID when the workspace alias is missing", async () => {
    mockListGroups.mockResolvedValue({
      data: [makeGroup("abcdefghijklmnop")],
    });

    renderChatTab();

    expect(
      await screen.findByRole("option", { name: "abcdefghijkl..." }),
    ).toBeInTheDocument();
  });

  it("loads the selected workspace member alias into the name field", async () => {
    mockResolveCurrentMemberIdentity.mockResolvedValue({
      data: {
        memberIdentity: "member-1",
        members: [
          {
            identity: "member-1",
            alias: "Product Ronit",
            role: "Member",
          },
        ],
      },
      error: null,
    });

    renderChatTab();

    await waitFor(() => {
      expect(mockResolveCurrentMemberIdentity).toHaveBeenCalledWith("group-1", "");
    });

    expect(screen.getByPlaceholderText(/enter your name/i)).toHaveValue(
      "Product Ronit",
    );
  });

  it("keeps the messenger name when the selected workspace member has no alias", async () => {
    mockResolveCurrentMemberIdentity.mockResolvedValue({
      data: {
        memberIdentity: "member-1",
        members: [
          {
            identity: "member-1",
            role: "Member",
          },
        ],
      },
      error: null,
    });

    renderChatTab();

    await waitFor(() => {
      expect(mockResolveCurrentMemberIdentity).toHaveBeenCalledWith("group-1", "");
    });

    expect(screen.getByPlaceholderText(/enter your name/i)).toHaveValue("Ronit");
  });
});
