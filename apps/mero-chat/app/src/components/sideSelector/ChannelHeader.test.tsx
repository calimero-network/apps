import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import ChannelHeader from "./ChannelHeader";

const {
  mockGetGroupId,
  mockUseCurrentGroupPermissions,
  mockCreateGroupContext,
  mockCreateSubgroup,
  mockSetSubgroupVisibility,
  mockGetGroup,
  mockListSubgroups,
  mockSetContextMemberIdentity,
  mockJoinChat,
} = vi.hoisted(() => ({
  mockGetGroupId: vi.fn(),
  mockUseCurrentGroupPermissions: vi.fn(),
  mockCreateGroupContext: vi.fn(),
  mockCreateSubgroup: vi.fn(),
  mockSetSubgroupVisibility: vi.fn(),
  mockGetGroup: vi.fn(),
  mockListSubgroups: vi.fn(),
  mockSetContextMemberIdentity: vi.fn(),
  mockJoinChat: vi.fn(),
}));

vi.mock("../../constants/config", () => ({
  getGroupId: mockGetGroupId,
  getApplicationId: () => "app-id",
  setContextMemberIdentity: mockSetContextMemberIdentity,
}));

vi.mock("../../hooks/useCurrentGroupPermissions", () => ({
  useCurrentGroupPermissions: mockUseCurrentGroupPermissions,
}));

vi.mock("../../hooks/usePersistentState", async () => {
  const React = await vi.importActual<typeof import("react")>("react");
  return {
    usePersistentState: (_key: string, initialValue: boolean | string) =>
      React.useState(initialValue),
  };
});

vi.mock("../../api/dataSource/nodeApiDataSource", () => ({
  ContextApiDataSource: class MockContextApiDataSource {
    createGroupContext = mockCreateGroupContext;
  },
}));

vi.mock("../../api/dataSource/groupApiDataSource", () => ({
  GroupApiDataSource: class MockGroupApiDataSource {
    createSubgroup = mockCreateSubgroup;
    setSubgroupVisibility = mockSetSubgroupVisibility;
    getGroup = mockGetGroup;
    listSubgroups = mockListSubgroups;
  },
}));

vi.mock("../../api/dataSource/clientApiDataSource", () => ({
  ClientApiDataSource: class MockClientApiDataSource {
    joinChat = mockJoinChat;
  },
}));

vi.mock("@calimero-network/mero-react", () => ({
  getNodeUrl: vi.fn(),
  getContextId: vi.fn(),
  getContextIdentity: vi.fn(),
  setContextIdentity: vi.fn(),
}));

vi.mock("../../api/meroJsClient", () => ({
  getAuthConfig: vi.fn(),
  nodeApi: {},
}));

vi.mock("../popups/CreateChannelPopup", () => ({
  default: ({
    toggle,
    createChannel,
  }: {
    toggle: React.ReactNode;
    createChannel: (
      channelName: string,
      isPublic: boolean,
      isReadOnly: boolean,
    ) => Promise<void>;
  }) => (
    <div>
      <div data-testid="create-channel-toggle">{toggle}</div>
      <button onClick={() => void createChannel("project-alpha", true, false)}>
        submit public channel
      </button>
      <button onClick={() => void createChannel("secret-room", false, false)}>
        submit private channel
      </button>
    </div>
  ),
}));

describe("ChannelHeader (1-group-per-context)", () => {
  beforeEach(() => {
    mockGetGroupId.mockReset();
    mockUseCurrentGroupPermissions.mockReset();
    mockCreateGroupContext.mockReset();
    mockCreateSubgroup.mockReset();
    mockSetSubgroupVisibility.mockReset();
    mockGetGroup.mockReset();
    mockListSubgroups.mockReset();
    mockSetContextMemberIdentity.mockReset();
    mockJoinChat.mockReset();

    mockGetGroupId.mockReturnValue("namespace-1");
    mockListSubgroups.mockResolvedValue({ data: [], error: null });
    mockGetGroup.mockResolvedValue({
      data: { subgroupVisibility: "open" },
      error: null,
    });
    mockCreateSubgroup.mockResolvedValue({
      data: { groupId: "channel-sg-1" },
      error: null,
    });
    mockSetSubgroupVisibility.mockResolvedValue({
      data: undefined,
      error: null,
    });
    mockCreateGroupContext.mockResolvedValue({
      data: {
        contextId: "context-1",
        memberPublicKey: "member-key-1",
      },
      error: null,
    });
    mockJoinChat.mockResolvedValue({ data: undefined, error: null });
  });

  it("renders the create-channel toggle while permissions are still loading", () => {
    mockUseCurrentGroupPermissions.mockReturnValue({
      loading: true,
      isAdmin: false,
      memberIdentity: "",
    });

    render(<ChannelHeader title="Channels" />);

    expect(screen.getByTestId("create-channel-toggle")).toBeInTheDocument();
  });

  it("hides the create-channel toggle for a resolved non-admin without CAN_CREATE_SUBGROUP", () => {
    mockUseCurrentGroupPermissions.mockReturnValue({
      loading: false,
      isAdmin: false,
      canCreateSubgroup: false,
      memberIdentity: "me",
    });

    render(<ChannelHeader title="Channels" />);

    expect(screen.queryByTestId("create-channel-toggle")).toBeNull();
  });

  it("shows the create-channel toggle for a non-admin member with CAN_CREATE_SUBGROUP", () => {
    mockUseCurrentGroupPermissions.mockReturnValue({
      loading: false,
      isAdmin: false,
      canCreateSubgroup: true,
      memberIdentity: "me",
    });

    render(<ChannelHeader title="Channels" />);

    expect(screen.getByTestId("create-channel-toggle")).toBeInTheDocument();
  });

  it("creates a new open subgroup + context for a public channel", async () => {
    mockUseCurrentGroupPermissions.mockReturnValue({
      loading: false,
      isAdmin: true,
      memberIdentity: "me",
    });

    render(<ChannelHeader title="Channels" />);
    fireEvent.click(screen.getByText("submit public channel"));

    await waitFor(() => {
      expect(mockCreateSubgroup).toHaveBeenCalledWith("namespace-1", {
        groupName: "project-alpha",
        name: "project-alpha",
      });
    });
    expect(mockSetSubgroupVisibility).toHaveBeenCalledWith("channel-sg-1", {
      subgroupVisibility: "open",
    });
    expect(mockCreateGroupContext).toHaveBeenCalledWith(
      expect.objectContaining({
        groupId: "channel-sg-1",
        alias: "project-alpha",
        initializationParams: expect.objectContaining({
          name: "project-alpha",
          context_type: "Channel",
        }),
      }),
    );
  });

  it("uses restricted subgroup visibility for a private channel", async () => {
    mockUseCurrentGroupPermissions.mockReturnValue({
      loading: false,
      isAdmin: true,
      memberIdentity: "me",
    });

    render(<ChannelHeader title="Channels" />);
    fireEvent.click(screen.getByText("submit private channel"));

    await waitFor(() => {
      expect(mockCreateSubgroup).toHaveBeenCalledWith("namespace-1", {
        groupName: "secret-room",
        name: "secret-room",
      });
    });
    expect(mockSetSubgroupVisibility).toHaveBeenCalledWith("channel-sg-1", {
      subgroupVisibility: "restricted",
    });
    expect(mockCreateGroupContext).toHaveBeenCalledWith(
      expect.objectContaining({
        groupId: "channel-sg-1",
        alias: "secret-room",
      }),
    );
  });
});
