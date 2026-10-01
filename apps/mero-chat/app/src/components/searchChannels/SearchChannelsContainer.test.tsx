import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import SearchChannelsContainer from "./SearchChannelsContainer";

const {
  mockListGroupContexts,
  mockGetContextVisibility,
  mockListSubgroups,
  mockGetGroup,
  mockUseCurrentGroupPermissions,
  mockGetContextInfo,
  mockFetchContextIdentities,
} = vi.hoisted(() => ({
  mockListGroupContexts: vi.fn(),
  mockGetContextVisibility: vi.fn(),
  mockListSubgroups: vi.fn(),
  mockGetGroup: vi.fn(),
  mockUseCurrentGroupPermissions: vi.fn(),
  mockGetContextInfo: vi.fn(),
  mockFetchContextIdentities: vi.fn(),
}));

vi.mock("@calimero-network/mero-ui", () => ({
  Button: ({
    children,
    disabled,
    onClick,
  }: {
    children: React.ReactNode;
    disabled?: boolean;
    onClick?: () => void;
  }) => (
    <button disabled={disabled} onClick={onClick}>
      {children}
    </button>
  ),
  SearchInput: ({
    label,
    onChange,
    value,
  }: {
    label: string;
    onChange: (value: string) => void;
    value: string;
  }) => (
    <label>
      {label}
      <input
        aria-label={label}
        value={value}
        onChange={(event) => onChange(event.target.value)}
      />
    </label>
  ),
}));

vi.mock("../../constants/config", () => ({
  getGroupId: () => "group-1",
}));

vi.mock("../../hooks/useCurrentGroupPermissions", () => ({
  useCurrentGroupPermissions: mockUseCurrentGroupPermissions,
}));

vi.mock("../../api/dataSource/groupApiDataSource", () => ({
  GroupApiDataSource: class MockGroupApiDataSource {
    listGroupContexts = mockListGroupContexts;
    getContextVisibility = mockGetContextVisibility;
    listSubgroups = mockListSubgroups;
    getGroup = mockGetGroup;
  },
}));

vi.mock("../../api/dataSource/clientApiDataSource", () => ({
  ClientApiDataSource: class MockClientApiDataSource {
    getContextInfo = mockGetContextInfo;
  },
}));

vi.mock("../../api/meroJsClient", () => ({
  nodeApi: {
    fetchContextIdentities: mockFetchContextIdentities,
  },
}));

vi.mock("../../contexts/ToastContext", () => ({
  useToast: () => ({ addToast: vi.fn() }),
}));

describe("SearchChannelsContainer", () => {
  beforeEach(() => {
    mockListGroupContexts.mockReset();
    mockGetContextVisibility.mockReset();
    mockListSubgroups.mockReset();
    mockGetGroup.mockReset();
    mockUseCurrentGroupPermissions.mockReset();
    mockGetContextInfo.mockReset();
    mockFetchContextIdentities.mockReset();

    mockListGroupContexts.mockResolvedValue({
      data: [],
    });
    mockListSubgroups.mockResolvedValue({ data: [] });
    mockGetGroup.mockResolvedValue({ data: null, error: null });
    mockGetContextVisibility.mockResolvedValue({
      data: { mode: "open" },
      error: null,
    });
    mockUseCurrentGroupPermissions.mockReturnValue({
      loading: false,
      isAdmin: false,
      canJoinOpenSubgroups: false,
      memberIdentity: "member-1",
    });
    mockGetContextInfo.mockResolvedValue({
      data: null,
      error: null,
    });
    mockFetchContextIdentities.mockResolvedValue({
      data: { data: { identities: [] } },
    });
  });

  it("shows a first-class empty state when the workspace has no channels", async () => {
    render(
      <SearchChannelsContainer
        onChatSelected={vi.fn()}
        fetchChannels={vi.fn()}
      />,
    );

    // 1-group-per-context model: lists subgroups, not namespace-root contexts.
    await waitFor(() => {
      expect(mockListSubgroups).toHaveBeenCalledWith("group-1");
    });

    expect(await screen.findByText(/no channels yet/i)).toBeInTheDocument();
    expect(
      screen.getByText(/create your first channel from the channels panel/i),
    ).toBeInTheDocument();
  });

  it("shows alias-based channel labels and matches searches against the alias", async () => {
    mockListSubgroups.mockResolvedValue({
      data: [{ groupId: "channel-sg-1", alias: "Project Alpha" }],
      error: null,
    });
    mockGetGroup.mockResolvedValue({
      data: { subgroupVisibility: "open" },
      error: null,
    });
    mockListGroupContexts.mockImplementation(async (id: string) =>
      id === "channel-sg-1"
        ? {
            data: [{ contextId: "abcdefgh12345678", alias: "Project Alpha" }],
            error: null,
          }
        : { data: [], error: null },
    );
    mockFetchContextIdentities.mockResolvedValue({
      data: { data: { identities: ["member-key-1"] } },
    });

    render(
      <SearchChannelsContainer
        onChatSelected={vi.fn()}
        fetchChannels={vi.fn()}
      />,
    );

    expect(await screen.findByText("Project Alpha")).toBeInTheDocument();

    fireEvent.change(screen.getByLabelText("Search Channels"), {
      target: { value: "alpha" },
    });

    expect(await screen.findByText("Project Alpha")).toBeInTheDocument();
    expect(screen.queryByText(/no matching channels/i)).not.toBeInTheDocument();
  });

  it("does not list DM contexts in the channel browser", async () => {
    mockListSubgroups.mockResolvedValue({
      data: [
        { groupId: "dm-sg-1", alias: "DM_CONTEXT_member-1_member-2" },
        { groupId: "channel-sg-1", alias: "Project Alpha" },
      ],
      error: null,
    });
    mockGetGroup.mockResolvedValue({
      data: { subgroupVisibility: "open" },
      error: null,
    });
    mockListGroupContexts.mockImplementation(async (id: string) => {
      if (id === "dm-sg-1") {
        return {
          data: [{ contextId: "ctx-dm", alias: "DM_CONTEXT_member-1_member-2" }],
          error: null,
        };
      }
      if (id === "channel-sg-1") {
        return {
          data: [{ contextId: "ctx-channel", alias: "Project Alpha" }],
          error: null,
        };
      }
      return { data: [], error: null };
    });

    render(
      <SearchChannelsContainer
        onChatSelected={vi.fn()}
        fetchChannels={vi.fn()}
      />,
    );

    expect(await screen.findByText("Project Alpha")).toBeInTheDocument();
    expect(screen.queryByText("DM_CONTEXT_member-1_member-2")).not.toBeInTheDocument();
  });
});
