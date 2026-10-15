import { styled } from "styled-components";
import CreateChannelPopup from "../popups/CreateChannelPopup";
import { isValidChannelName } from "../../utils/validation";
import { GroupApiDataSource } from "../../api/dataSource/groupApiDataSource";
import { getGroupId } from "../../constants/config";
import { createChannel as createChannelInWorkspace } from "../../utils/createChannel";
import { memo, useCallback, useState } from "react";
import { usePersistentState } from "../../hooks/usePersistentState";
import { useCurrentGroupPermissions } from "../../hooks/useCurrentGroupPermissions";
import { log } from "../../utils/logger";
import {
  getChannelVisibilityOption,
} from "../../utils/channelVisibility";
import { buildChannelEntryChat } from "../../utils/channelEntry";
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
  color: color-mix(in srgb, var(--glass-ink) 30%, transparent);
`;

const PlusButton = styled.div`
  display: flex;
  cursor: pointer;
  justify-content: center;
  align-items: center;
  width: 20px;
  height: 20px;
  border-radius: 5px;
  color: color-mix(in srgb, var(--glass-ink) 25%, transparent);
  transition: all 0.15s ease;

  &:hover {
    color: var(--glass-accent);
    background: color-mix(in srgb, var(--glass-accent) 10%, transparent);
  }

  svg {
    stroke: currentColor;
  }
`;

interface ChannelHeaderProps {
  title: string;
  isCollapsed?: boolean;
  onChannelCreated?: () => void;
  onFetchChannels?: () => void;
  onChannelSelected?: (chat: ActiveChat) => void;
  existingChannelNames?: string[];
  targetGroupId?: string;
}

const ChannelHeader = memo(function ChannelHeader(props: ChannelHeaderProps) {
  const [isOpen, setIsOpen] = usePersistentState("createChannelModalOpen", false);
  const [inputValue, setInputValue] = usePersistentState("createChannelInputValue", "");
  const [defaultVisibility, setDefaultVisibility] = useState<"public" | "private">("public");
  const [isLoadingDefaultVisibility, setIsLoadingDefaultVisibility] = useState(false);
  // Fresh subgroup names fetched from the server when the popup opens.
  // These take priority over the possibly-stale existingChannelNames prop.
  const [liveSubgroupNames, setLiveSubgroupNames] = useState<string[]>([]);
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
      // liveSubgroupNames is fresh from the server; existingChannelNames is a
      // fallback for before the popup has fetched.
      const allNames = liveSubgroupNames.length > 0
        ? liveSubgroupNames
        : (props.existingChannelNames ?? []);
      const isDuplicate = allNames.some((n) => n.toLowerCase() === lower);
      if (isDuplicate) return { isValid: false, error: "A group with this name already exists" };
      return { isValid: true, error: "" };
    },
    [liveSubgroupNames, props.existingChannelNames],
  );

  const createChannel = async (
    channelName: string,
    isPublic: boolean,
    _isReadOnly: boolean,
  ): Promise<{ error: string } | void> => {
    if (!groupId) {
      log.error("ChannelHeader", "No groupId configured — cannot create channel");
      return { error: "No workspace configured" };
    }

    const lower = channelName.toLowerCase();
    const allNames = liveSubgroupNames.length > 0
      ? liveSubgroupNames
      : (props.existingChannelNames ?? []);
    const isDuplicate = allNames.some((n) => n.toLowerCase() === lower);
    if (isDuplicate) {
      log.warn("ChannelHeader", `Channel name "${channelName}" already exists`);
      return { error: "A group with this name already exists" };
    }

    const namespaceId = props.targetGroupId ?? groupId;
    const created = await createChannelInWorkspace(namespaceId, channelName, isPublic);
    if ("error" in created) return created;
    const { contextId, memberKey } = created;

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

    try {
      // Fetch subgroups and group info in parallel so the validator has
      // fresh server-side names before the user starts typing.
      const [subgroupsResp, groupResp] = await Promise.all([
        groupApi.listSubgroups(targetGroupId),
        groupApi.getGroup(targetGroupId),
      ]);

      if (subgroupsResp.data) {
        setLiveSubgroupNames(
          subgroupsResp.data.map((sg) => sg.alias ?? "").filter(Boolean),
        );
      }

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

      setIsOpen(true);
    } finally {
      setIsLoadingDefaultVisibility(false);
    }
  }, [isLoadingDefaultVisibility, setIsOpen, groupId]);

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
            <PlusButton role="button" aria-label="Create channel" onClick={prepareCreateChannelModal}>
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
