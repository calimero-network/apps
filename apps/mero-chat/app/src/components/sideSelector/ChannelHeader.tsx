import { styled } from "styled-components";
import CreateChannelPopup from "../popups/CreateChannelPopup";
import { isValidChannelName } from "../../utils/validation";
import { ContextApiDataSource } from "../../api/dataSource/nodeApiDataSource";
import { GroupApiDataSource } from "../../api/dataSource/groupApiDataSource";
import { ClientApiDataSource } from "../../api/dataSource/clientApiDataSource";
import { getApplicationId, getGroupId, setContextMemberIdentity } from "../../constants/config";
import { memo, useCallback, useState } from "react";
import { usePersistentState } from "../../hooks/usePersistentState";
import { useCurrentGroupPermissions } from "../../hooks/useCurrentGroupPermissions";
import { log } from "../../utils/logger";
import {
  getChannelVisibilityOption,
} from "../../utils/channelVisibility";
import { buildChannelEntryChat } from "../../utils/channelEntry";
import { getMessengerDisplayName } from "../../utils/messengerName";
import type { ActiveChat } from "../../types/Common";

const Container = styled.div<{ $isCollapsed?: boolean }>`
  display: flex;
  justify-content: ${(props) => (props.$isCollapsed ? "center" : "space-between")};
  align-items: center;
  padding: 0.25rem 0.75rem 0.25rem ${(props) => (props.$isCollapsed ? "0.75rem" : "1rem")};
  margin-bottom: 0.125rem;
  @media (max-width: 1024px) {
    width: 100%;
    padding-top: 0.5rem;
  }
`;

const TextBold = styled.div`
  font-size: 11px;
  font-weight: 700;
  letter-spacing: 0.07em;
  text-transform: uppercase;
  color: rgba(255, 255, 255, 0.3);
`;

const PlusButton = styled.div`
  display: flex;
  cursor: pointer;
  justify-content: center;
  align-items: center;
  width: 20px;
  height: 20px;
  border-radius: 5px;
  color: rgba(255, 255, 255, 0.25);
  transition: all 0.15s ease;

  &:hover {
    color: #a5ff11;
    background: rgba(165, 255, 17, 0.1);
  }

  svg {
    stroke: currentColor;
  }
`;

interface ChannelHeaderProps {
  title: string;
  isCollapsed?: boolean;
  onChannelCreated?: () => void;
  onChannelSelected?: (chat: ActiveChat) => void;
  existingChannelNames?: string[];
  targetGroupId?: string;
}

const ChannelHeader = memo(function ChannelHeader(props: ChannelHeaderProps) {
  const [isOpen, setIsOpen] = usePersistentState("createChannelModalOpen", false);
  const [inputValue, setInputValue] = usePersistentState("createChannelInputValue", "");
  const [defaultVisibility, setDefaultVisibility] = useState<"public" | "private">("public");
  const [isLoadingDefaultVisibility, setIsLoadingDefaultVisibility] = useState(false);
  const groupId = getGroupId();
  const permissionsGroupId = props.targetGroupId ?? groupId;
  const permissions = useCurrentGroupPermissions(permissionsGroupId);
  // Optimistic gate: while loading, on API failure, or before memberIdentity
  // is known, show the button — the create API enforces the real check.
  // Once resolved, show for admins or members holding CAN_CREATE_SUBGROUP
  // (rc.37+: regular namespace members can start root-level channel-groups).
  const resolved = !permissions.loading && permissions.memberIdentity !== "";
  const canShowCreate =
    !resolved || permissions.isAdmin || permissions.canCreateSubgroup;

  const channelNameValidator = useCallback(
    (value: string) => {
      const base = isValidChannelName(value);
      if (!base.isValid) return base;
      const lower = value.toLowerCase();
      const isDuplicate = (props.existingChannelNames ?? []).some(
        (n) => n.toLowerCase() === lower,
      );
      if (isDuplicate) return { isValid: false, error: "A channel with this name already exists" };
      return { isValid: true, error: "" };
    },
    [props.existingChannelNames],
  );

  const createChannel = async (
    channelName: string,
    isPublic: boolean,
    _isReadOnly: boolean,
  ) => {
    if (!groupId) {
      log.error("ChannelHeader", "No groupId configured — cannot create channel");
      return;
    }

    const lower = channelName.toLowerCase();
    const isDuplicate = (props.existingChannelNames ?? []).some(
      (n) => n.toLowerCase() === lower,
    );
    if (isDuplicate) {
      log.warn("ChannelHeader", `Channel name "${channelName}" already exists`);
      return;
    }

    const nodeApi = new ContextApiDataSource();
    const groupApi = new GroupApiDataSource();
    const namespaceId = props.targetGroupId ?? groupId;

    // 1-group-per-context model (rc.37+): each channel is its own subgroup
    // under the namespace root, with one context inside. Subgroup visibility
    // (open|restricted) IS the channel's public/private flag, and is set
    // deterministically via the SubgroupVisibilitySet op (encrypted to the
    // subgroup's members). Non-admin members can create+manage their own
    // channel-groups thanks to the CAN_CREATE_SUBGROUP / CAN_MANAGE_VISIBILITY
    // namespace caps granted in dev-node.sh.

    // 1) Create the channel's subgroup under the namespace root. For
    //    user-created channels the alias and the display name are the
    //    same string (and short — UI input is constrained well under
    //    the 64-byte cap).
    const sgResp = await groupApi.createSubgroup(namespaceId, {
      groupName: channelName,
      name: channelName,
    });
    if (sgResp.error || !sgResp.data) {
      log.error("ChannelHeader", "Failed to create channel subgroup", sgResp.error);
      return;
    }
    const channelGroupId = sgResp.data.groupId;

    // 2) Set the subgroup's visibility from the popup choice.
    const visResp = await groupApi.setSubgroupVisibility(channelGroupId, {
      subgroupVisibility: isPublic ? "open" : "restricted",
    });
    if (visResp.error) {
      log.warn("ChannelHeader", "Failed to set subgroup visibility (non-fatal)", visResp.error);
    }

    // 3) Create the channel's single context inside the new subgroup.
    const createResp = await nodeApi.createGroupContext({
      applicationId: getApplicationId(),
      protocol: "near",
      groupId: channelGroupId,
      alias: channelName,
      name: channelName,
      initializationParams: {
        name: channelName,
        context_type: "Channel",
        description: "",
        created_at: Math.floor(Date.now() / 1000),
        creator_username: "",
      },
    });

    if (createResp.error || !createResp.data) {
      log.error("ChannelHeader", "Failed to create channel context", createResp.error);
      return;
    }

    const contextIdJustCreated = createResp.data.contextId;

    const contextId = contextIdJustCreated;
    const memberKey = createResp.data.memberPublicKey ?? "";
    if (memberKey) {
      setContextMemberIdentity(contextId, memberKey);
      const username = getMessengerDisplayName();
      if (username) {
        new ClientApiDataSource()
          .joinChat({ contextId, executorPublicKey: memberKey, username })
          .catch((e) => log.warn("ChannelHeader", "set_profile failed on new channel", e));
      }
    }

    setInputValue("");
    setIsOpen(false);

    if (memberKey) {
      props.onChannelSelected?.(
        buildChannelEntryChat({ contextId, name: channelName, contextIdentity: memberKey }),
      );
    }
    props.onChannelCreated?.();
  };

  const prepareCreateChannelModal = useCallback(async () => {
    const targetGroupId = props.targetGroupId ?? groupId;
    if (!targetGroupId || isLoadingDefaultVisibility) {
      return;
    }

    setIsLoadingDefaultVisibility(true);
    const groupApi = new GroupApiDataSource();
    const groupResp = await groupApi.getGroup(targetGroupId);

    if (groupResp.data?.subgroupVisibility) {
      setDefaultVisibility(getChannelVisibilityOption(groupResp.data.subgroupVisibility));
    } else {
      setDefaultVisibility("public");
      if (groupResp.error) {
        log.error(
          "ChannelHeader",
          "Failed to read group default visibility, falling back to public",
          groupResp.error,
        );
      }
    }

    setIsLoadingDefaultVisibility(false);
    setIsOpen(true);
  }, [isLoadingDefaultVisibility, setIsOpen]);

  return (
    <Container $isCollapsed={props.isCollapsed}>
      {!props.isCollapsed && <TextBold>{props.title}</TextBold>}
      {(props.targetGroupId ?? groupId) && canShowCreate && (
        <CreateChannelPopup
          title={"Create new Channel"}
          inputValue={inputValue}
          isOpen={isOpen}
          setIsOpen={setIsOpen}
          setInputValue={setInputValue}
          placeholder={"# channel name"}
          buttonText={"Create"}
          toggle={
            <PlusButton onClick={prepareCreateChannelModal}>
              <svg
                width="13"
                height="13"
                viewBox="0 0 24 24"
                fill="none"
                strokeWidth="2.5"
                strokeLinecap="round"
              >
                <path d="M12 5v14M5 12h14" />
              </svg>
            </PlusButton>
          }
          createChannel={createChannel}
          channelNameValidator={channelNameValidator}
          defaultVisibility={defaultVisibility}
        />
      )}
    </Container>
  );
});

export default ChannelHeader;
