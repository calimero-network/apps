import { render, screen, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

// Which group the permission hook is asked about IS the behaviour under test,
// so capture the argument rather than the rendered output.
const permissionCalls: string[] = [];
const roleByGroup = new Map<string, boolean>();

vi.mock("../../hooks/useCurrentGroupPermissions", () => ({
  useCurrentGroupPermissions: (groupId: string) => {
    permissionCalls.push(groupId);
    return {
      loading: false,
      memberIdentity: "self",
      isAdmin: roleByGroup.get(groupId) ?? false,
      isModerator: false,
      capabilities: null,
      canCreateContext: false,
      canInviteMembers: false,
      canJoinOpenSubgroups: false,
      canCreateSubgroup: false,
      canDeleteSubgroup: false,
      canManageVisibility: false,
    };
  },
}));

let capturedCanManageMembers: boolean | undefined;
vi.mock("../settings/DetailsContainer", () => ({
  default: (props: { canManageMembers?: boolean }) => {
    capturedCanManageMembers = props.canManageMembers;
    return <div data-testid="details" />;
  },
}));

vi.mock("../common/popups/BaseModal", () => ({
  default: (props: { content: React.ReactNode }) => <div>{props.content}</div>,
}));

vi.mock("../../constants/config", () => ({
  getGroupId: () => ROOT_GROUP,
  getGroupMemberIdentity: () => "",
  setGroupMemberIdentity: () => {},
}));

vi.mock("@calimero-network/mero-react", () => ({
  getContextIdentity: () => "self-device-key",
}));

vi.mock("../../hooks/useGroupAdmin", () => ({
  useGroupAdmin: () => ({ members: [], fetchAll: vi.fn() }),
}));

vi.mock("../../contexts/ToastContext", () => ({
  useToast: () => ({ addToast: vi.fn() }),
}));

vi.mock("../../api/dataSource/clientApiDataSource", () => ({
  ClientApiDataSource: class {
    getChannelInfo() {
      return Promise.resolve({ data: null, error: null });
    }
  },
}));
vi.mock("../../api/dataSource/nodeApiDataSource", () => ({
  ContextApiDataSource: class {},
}));
vi.mock("../../api/dataSource/groupApiDataSource", () => ({
  GroupApiDataSource: class {},
}));

const ROOT_GROUP = "root-namespace-group";
const CHANNEL_SUBGROUP = "private-channel-subgroup";

import ChannelDetailsPopup from "./ChannelDetailsPopup";

function renderPopup() {
  return render(
    <ChannelDetailsPopup
      toggle={null}
      chat={{ id: "c", name: "private_channel", type: "channel", contextId: "ctx-1" } as never}
      channelUserList={new Map()}
      nonInvitedUserList={[]}
      isOpen
      setIsOpen={() => {}}
      selectedTabIndex={1}
      reFetchChannelMembers={() => {}}
      setActiveChat={() => {}}
      fetchChannels={() => {}}
      getSubgroupForContext={() => CHANNEL_SUBGROUP}
    />,
  );
}

describe("ChannelDetailsPopup member management", () => {
  beforeEach(() => {
    permissionCalls.length = 0;
    roleByGroup.clear();
    capturedCanManageMembers = undefined;
  });

  it("asks about the channel's own group, not the namespace root", async () => {
    // The server checks `require_admin` on the CHANNEL's subgroup
    // (add_group_members, core). Asking the root instead is what made the UI
    // and the node disagree in both directions.
    renderPopup();
    await waitFor(() => expect(screen.getByTestId("details")).toBeTruthy());

    expect(permissionCalls).toContain(CHANNEL_SUBGROUP);
    expect(permissionCalls).not.toContain(ROOT_GROUP);
  });

  it("grants management to the channel's admin", async () => {
    // The person who created the private channel is Admin OF THAT SUBGROUP but
    // only a Member at the root — previously the controls were hidden from
    // them, inside a channel they own.
    roleByGroup.set(CHANNEL_SUBGROUP, true);
    roleByGroup.set(ROOT_GROUP, false);

    renderPopup();
    await waitFor(() => expect(capturedCanManageMembers).toBe(true));
  });

  it("withholds it from a namespace admin who is not in the channel", async () => {
    // The mirror case, and the one that produced a 500. A namespace admin does
    // NOT inherit admin over a restricted subgroup — `is_inherited_admin` stops
    // walking as soon as visibility is not Open — so the node refuses. Offering
    // the control anyway turns a correct refusal into an apparent server fault.
    roleByGroup.set(CHANNEL_SUBGROUP, false);
    roleByGroup.set(ROOT_GROUP, true);

    renderPopup();
    await waitFor(() => expect(screen.getByTestId("details")).toBeTruthy());
    expect(capturedCanManageMembers).toBe(false);
  });

  it("falls back to the root group for a channel with no subgroup", async () => {
    // Legacy channels created before the 1-group-per-context model have no
    // subgroup to check, and DetailsContainer already targets the root for
    // them. The gate must agree with whatever the write will actually hit.
    roleByGroup.set(ROOT_GROUP, true);

    render(
      <ChannelDetailsPopup
        toggle={null}
        chat={{ id: "c", name: "legacy", type: "channel", contextId: "ctx-1" } as never}
        channelUserList={new Map()}
        nonInvitedUserList={[]}
        isOpen
        setIsOpen={() => {}}
        selectedTabIndex={1}
        reFetchChannelMembers={() => {}}
        setActiveChat={() => {}}
        fetchChannels={() => {}}
        getSubgroupForContext={() => undefined}
      />,
    );

    await waitFor(() => expect(capturedCanManageMembers).toBe(true));
    expect(permissionCalls).toContain(ROOT_GROUP);
  });
});
