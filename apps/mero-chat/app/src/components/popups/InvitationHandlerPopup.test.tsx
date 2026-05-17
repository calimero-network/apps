import { render, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import InvitationHandlerPopup from "./InvitationHandlerPopup";

const {
  mockClearInvitationFromStorage,
  mockGetInvitationFromStorage,
  mockJoinGroup,
  mockJoinGroupContext,
  mockListGroupContexts,
  mockParseGroupInvitationPayload,
  mockSetGroupId,
  mockSetGroupMemberIdentity,
  mockSetStoredGroupAlias,
  mockSetContextMemberIdentity,
  mockSyncGroup,
} = vi.hoisted(() => ({
  mockClearInvitationFromStorage: vi.fn(),
  mockGetInvitationFromStorage: vi.fn(),
  mockJoinGroup: vi.fn(),
  mockJoinGroupContext: vi.fn(),
  mockListGroupContexts: vi.fn(),
  mockParseGroupInvitationPayload: vi.fn(),
  mockSetGroupId: vi.fn(),
  mockSetGroupMemberIdentity: vi.fn(),
  mockSetStoredGroupAlias: vi.fn(),
  mockSetContextMemberIdentity: vi.fn(),
  mockSyncGroup: vi.fn(),
}));

vi.mock("@calimero-network/mero-ui", () => ({
  Button: ({
    children,
    onClick,
  }: {
    children: React.ReactNode;
    onClick?: () => void;
  }) => <button onClick={onClick}>{children}</button>,
}));

vi.mock("@calimero-network/mero-react", () => ({
  setContextId: vi.fn(),
  setContextIdentity: vi.fn(),
}));

vi.mock("../../api/meroJsClient", () => ({
  nodeApi: {
    createNewIdentity: vi.fn(),
    joinContextByOpenInvitation: vi.fn(),
    getContext: vi.fn(),
  },
}));

vi.mock("../../utils/invitation", () => ({
  clearInvitationFromStorage: mockClearInvitationFromStorage,
  getInvitationFromStorage: mockGetInvitationFromStorage,
  parseGroupInvitationPayload: mockParseGroupInvitationPayload,
}));

vi.mock("../../api/dataSource/groupApiDataSource", () => ({
  GroupApiDataSource: class MockGroupApiDataSource {
    joinGroup = mockJoinGroup;
    syncGroup = mockSyncGroup;
    listGroupContexts = mockListGroupContexts;
    joinGroupContext = mockJoinGroupContext;
  },
}));

vi.mock("../../constants/config", () => ({
  setGroupId: mockSetGroupId,
  setGroupMemberIdentity: mockSetGroupMemberIdentity,
  setStoredGroupAlias: mockSetStoredGroupAlias,
  setContextMemberIdentity: mockSetContextMemberIdentity,
}));

describe("InvitationHandlerPopup", () => {
  beforeEach(() => {
    mockClearInvitationFromStorage.mockReset();
    mockGetInvitationFromStorage.mockReset();
    mockJoinGroup.mockReset();
    mockJoinGroupContext.mockReset();
    mockListGroupContexts.mockReset();
    mockParseGroupInvitationPayload.mockReset();
    mockSetGroupId.mockReset();
    mockSetGroupMemberIdentity.mockReset();
    mockSetStoredGroupAlias.mockReset();
    mockSetContextMemberIdentity.mockReset();
    mockSyncGroup.mockReset();

    mockGetInvitationFromStorage.mockReturnValue("stored-invite");
    mockParseGroupInvitationPayload.mockReturnValue({
      invitation: {
        invitation: {
          inviter_identity: "admin",
          group_id: "group-1",
          expiration_height: 42,
          secret_salt: [1, 2, 3],
          protocol: "near",
          network: "testnet",
          contract_id: "contract.testnet",
        },
        inviter_signature: "signature",
      },
      groupAlias: "Team Space",
    });
    mockJoinGroup.mockResolvedValue({
      data: {
        groupId: "group-1",
        memberIdentity: "member-1",
      },
      error: null,
    });
    mockSyncGroup.mockResolvedValue({
      data: {
        groupId: "group-1",
      },
      error: null,
    });
    mockJoinGroupContext.mockResolvedValue({
      data: { contextId: "ctx-1", memberPublicKey: "pk-1" },
      error: null,
    });
    mockListGroupContexts.mockResolvedValue({
      data: [],
      error: null,
    });
  });

  it("joins each visible context after joining the workspace (onboarding sweep)", async () => {
    mockListGroupContexts.mockResolvedValue({
      data: [
        { contextId: "ctx-general" },
        { contextId: "ctx-random" },
      ],
      error: null,
    });
    mockJoinGroupContext.mockResolvedValue({
      data: { contextId: "ctx-general", memberPublicKey: "pk-general" },
      error: null,
    });

    render(<InvitationHandlerPopup onSuccess={vi.fn()} onError={vi.fn()} />);

    await waitFor(() => {
      expect(mockJoinGroupContext).toHaveBeenCalledTimes(2);
    });
    expect(mockJoinGroupContext).toHaveBeenCalledWith("group-1", {
      contextId: "ctx-general",
    });
    expect(mockJoinGroupContext).toHaveBeenCalledWith("group-1", {
      contextId: "ctx-random",
    });
    expect(mockSetContextMemberIdentity).toHaveBeenCalledWith(
      "ctx-general",
      "pk-general",
    );
  });

  it("stores the group alias locally when joining from a saved workspace invitation", async () => {
    const onSuccess = vi.fn();

    render(
      <InvitationHandlerPopup onSuccess={onSuccess} onError={vi.fn()} />,
    );

    await waitFor(() => {
      expect(mockJoinGroup).toHaveBeenCalledWith({
        invitation: {
          invitation: {
            inviter_identity: "admin",
            group_id: "group-1",
            expiration_height: 42,
            secret_salt: [1, 2, 3],
            protocol: "near",
            network: "testnet",
            contract_id: "contract.testnet",
          },
          inviter_signature: "signature",
        },
        groupAlias: "Team Space",
      });
    });

    expect(mockSetGroupId).toHaveBeenCalledWith("group-1");
    expect(mockSetGroupMemberIdentity).toHaveBeenCalledWith(
      "group-1",
      "member-1",
    );
    expect(mockSetStoredGroupAlias).toHaveBeenCalledWith(
      "group-1",
      "Team Space",
    );

    await waitFor(() => {
      expect(mockClearInvitationFromStorage).toHaveBeenCalled();
      expect(onSuccess).toHaveBeenCalled();
    });
  });
});
