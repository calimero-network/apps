import { styled } from "styled-components";
import Loader from "../loader/Loader";
import type { ActiveChat, GroupContextChannel } from "../../types/Common";
import { useCallback, useEffect, useState } from "react";
import { GroupApiDataSource } from "../../api/dataSource/groupApiDataSource";
import { ClientApiDataSource } from "../../api/dataSource/clientApiDataSource";
import type { ResponseData } from "../../api/types";
import {
  nodeApi as apiClientNode,
  type LegacyFetchContextIdentitiesResponse as FetchContextIdentitiesResponse,
} from "../../api/meroJsClient";
import {
  getGroupId,
  getGroupMemberIdentity,
  setContextMemberIdentity,
} from "../../constants/config";
import { Button, SearchInput } from "@calimero-network/mero-ui";
import { log } from "../../utils/logger";
import { useCurrentGroupPermissions } from "../../hooks/useCurrentGroupPermissions";
import { buildChannelEntryChat } from "../../utils/channelEntry";
import { isDmContextCandidate } from "../../utils/dmContext";
import {
  getIdentityDisplayName,
  getMessengerDisplayName,
} from "../../utils/messengerName";
import { useToast } from "../../contexts/ToastContext";

const SearchContainer = styled.div`
  padding: 24px;
  display: flex;
  flex-direction: column;
  @media (min-width: 1025px) {
    height: 100%;
  }
  @media (max-width: 1024px) {
    padding: 42px 0 0;
    background-color: #0e0e10;
  }
  .inputFieldWrapper {
    display: flex;
    align-items: center;
    width: 100%;
    position: relative;
    @media (max-width: 1024px) {
      margin-top: 24px;
      padding-left: 16px;
      padding-right: 16px;
    }
  }
  .channelListWrapper {
    padding-top: 24px;
    padding-left: 16px;
    padding-right: 16px;
    width: 100%;
    scrollbar-color: black transparent;
    ::-webkit-scrollbar {
      width: 0px;
    }
    @media (max-width: 1024px) {
      padding-top: 16px;
      overflow: scroll;
      padding-bottom: 16px;
    }
    @media (min-width: 1025px) {
      height: 100%;
      overflow: scroll;
    }
  }
  .listHeader {
    width: 100%;
    color: #777583;
    font-family: Helvetica Neue;
    font-size: 14px;
    font-style: normal;
    font-weight: 700;
    line-height: 150%;
  }
  .list {
    width: 100%;
    padding-top: 8px;
    display: flex;
    flex-direction: column;
    gap: 8px;
    @media (min-width: 1025px) {
      height: 100%;
    }
    @media (max-width: 1024px) {
      flex: 1;
    }
  }
  .listItem {
    padding: 8px 16px;
    display: flex;
    justify-content: space-between;
    align-items: center;
    background-color: #141418;
    border-radius: 4px;
  }
  .channelNameText {
    color: #777583;
    font-family: Helvetica Neue;
    font-size: 14px;
    font-style: normal;
    font-weight: 400;
    line-height: 150%;
    padding-left: 6px;
  }
  .creatorText {
    color: #777583;
    font-family: Helvetica Neue;
    font-size: 12px;
    font-style: normal;
    font-weight: 400;
    line-height: 150%;
    padding-left: 4px;
  }
  .listItemOptions {
    display: flex;
    gap: 8px;
    font-family: Helvetica Neue;
    font-size: 12px;
    font-style: normal;
    font-weight: 400;
    line-height: 150%;
  }
  .spinnerWrapper {
    margin-top: 4px;
  }
`;

const EmptyState = styled.div`
  margin-top: 12px;
  border: 1px solid rgba(255, 255, 255, 0.08);
  border-radius: 8px;
  background: #141418;
  padding: 20px 18px;
  display: flex;
  flex-direction: column;
  gap: 6px;
`;

const EmptyStateTitle = styled.div`
  color: #ffffff;
  font-size: 15px;
  font-weight: 600;
`;

const EmptyStateDescription = styled.div`
  color: #9a99a6;
  font-size: 13px;
  line-height: 1.5;
`;

interface BrowsableChannel extends GroupContextChannel {
  isJoined: boolean;
  visibility: "open" | "restricted";
  canJoin: boolean;
  blockedReason: string;
  joinedIdentity?: string;
}

interface SearchChannelsContainerProps {
  onChatSelected: (chat: ActiveChat) => void;
  fetchChannels: () => void;
  onChannelJoined?: (contextId: string) => void;
}

function getChannelListName(channel: Pick<GroupContextChannel, "contextId" | "alias" | "info">) {
  return channel.info?.name ?? channel.alias ?? `${channel.contextId.substring(0, 12)}...`;
}

function getActiveChannelName(
  channel: Pick<GroupContextChannel, "contextId" | "alias" | "info">,
) {
  return channel.info?.name ?? channel.alias ?? channel.contextId.substring(0, 8);
}

export default function SearchChannelsContainer({
  onChatSelected,
  fetchChannels,
  onChannelJoined,
}: SearchChannelsContainerProps) {
  const groupId = getGroupId();
  const currentGroupPermissions = useCurrentGroupPermissions(groupId);
  const { addToast } = useToast();
  const [allChannels, setAllChannels] = useState<BrowsableChannel[]>([]);
  const [inputValue, setInputValue] = useState("");
  const [isLoadingId, setIsLoadingId] = useState("");

  const filteredChannels = inputValue
    ? allChannels.filter((ch) => {
        const query = inputValue.toLowerCase();
        return [ch.alias, ch.info?.name, ch.contextId].some(
          (value) => value?.toLowerCase().includes(query),
        );
      })
    : allChannels;

  useEffect(() => {
    const loadChannels = async () => {
      if (!groupId) return;
      // Wait for the namespace member identity to resolve, otherwise canJoin
      // races to false and the Join button looks permanently disabled.
      if (currentGroupPermissions.loading) return;

      const groupApi = new GroupApiDataSource();
      const clientApi = new ClientApiDataSource();

      const enrichContext = async (
        ctxId: string,
        alias: string | undefined,
        visibility: "open" | "restricted",
      ): Promise<BrowsableChannel | null> => {
        const entry = { contextId: ctxId, alias };
        if (isDmContextCandidate({ entry })) return null;

        let isJoined = false;
        let info = null;
        let joinedIdentity = "";

        try {
          const idResp: ResponseData<FetchContextIdentitiesResponse> =
            await apiClientNode.fetchContextIdentities(ctxId);
          const identities = idResp.data?.data?.identities;
          if (identities && identities.length > 0) {
            isJoined = true;
            joinedIdentity = identities[0];
            const infoResp = await clientApi.getContextInfo(ctxId, identities[0]);
            if (infoResp.data) info = infoResp.data;
          }
        } catch {
          log.debug("SearchChannels", `Could not fetch info for ${ctxId}`);
        }

        if (isDmContextCandidate({ entry, info })) return null;
        if (info && info.context_type !== "Channel") return null;

        // Restricted channel the user is not in → hide completely
        if (!isJoined && visibility === "restricted") return null;

        const memberIdentity = currentGroupPermissions.memberIdentity;
        let canJoin = isJoined;
        let blockedReason = "";

        if (!canJoin) {
          if (!memberIdentity) {
            blockedReason = "This node's workspace identity could not be resolved.";
          } else {
            canJoin = true;
          }
        }

        return { contextId: ctxId, alias, info, isJoined, visibility, canJoin, blockedReason, joinedIdentity };
      };

      const collected: (BrowsableChannel | null)[] = [];

      // 1-group-per-context model: each channel-group is a subgroup under the
      // namespace, its VisibilityMode (open|restricted) IS the channel's
      // public/private flag. DMs are also subgroups; filter them out by the
      // context's info.context_type === "Dm" in enrichContext below.
      const sgResp = await groupApi.listSubgroups(groupId);
      if (sgResp.data && sgResp.data.length > 0) {
        await Promise.all(
          sgResp.data.map(async (sg) => {
            const groupInfoResp = await groupApi.getGroup(sg.groupId);
            // Fail closed if we can't read the subgroup info.
            const sgVisibility: "open" | "restricted" =
              groupInfoResp.data?.subgroupVisibility === "open" ? "open" : "restricted";

            const sgListResp = await groupApi.listGroupContexts(sg.groupId);
            if (!sgListResp.data) return;

            const results = await Promise.all(
              sgListResp.data.map((entry) =>
                enrichContext(entry.contextId, entry.alias, sgVisibility),
              ),
            );
            collected.push(...results);
          }),
        );
      }

      setAllChannels(collected.filter((ch): ch is BrowsableChannel => ch !== null));
    };

    void loadChannels();
  }, [
    currentGroupPermissions.canJoinOpenSubgroups,
    currentGroupPermissions.isAdmin,
    currentGroupPermissions.loading,
    currentGroupPermissions.memberIdentity,
    groupId,
  ]);

  const handleJoinChannel = useCallback(
    async (contextId: string) => {
      if (!groupId) return;

      const channel = allChannels.find((entry) => entry.contextId === contextId);
      if (channel && !channel.canJoin && !channel.isJoined) {
        return;
      }

      setIsLoadingId(contextId);
      try {
        const groupApi = new GroupApiDataSource();
        const joinResponse = await groupApi.joinGroupContext(groupId, { contextId });
        if (joinResponse.error || !joinResponse.data) {
          const message = joinResponse.error?.message || "Failed to join channel";
          log.error("SearchChannels", "joinGroupContext failed", joinResponse.error);
          addToast({ title: "Join channel", message, type: "channel", duration: 4000 });
          return;
        }

        const memberKey = joinResponse.data.memberPublicKey;
        setContextMemberIdentity(contextId, memberKey);
        // Seed server-side member alias so other members see a display name
        // instead of a raw identity hash on rc.35.
        const namespaceIdentity = getGroupMemberIdentity(groupId);
        const seedAlias =
          (namespaceIdentity ? getIdentityDisplayName(namespaceIdentity) : "") ||
          getMessengerDisplayName() ||
          "";
        if (seedAlias) {
          groupApi
            .setMemberMetadata(contextId, memberKey, { name: seedAlias })
            .catch(() => {/* non-fatal — alias is best-effort */});
          // Register the WASM-level `profile` for this context too — without
          // this, `get_profiles` on the channel never returns us, and
          // channel-members / mention / DM-invite UIs all fall through to
          // displaying our raw identity hash. The auto-join path in
          // `useGroupContexts` does this for restricted (admin-added)
          // channels; this is the equivalent for the public/browse "Join"
          // flow which routes here.
          new ClientApiDataSource()
            .joinChat({
              contextId,
              executorPublicKey: memberKey,
              username: seedAlias,
              isDM: false,
            })
            .catch(() => {/* non-fatal — set_profile is best-effort */});
        }

        setAllChannels((prev) =>
          prev.map((ch) =>
            ch.contextId === contextId
              ? {
                  ...ch,
                  isJoined: true,
                  canJoin: true,
                  blockedReason: "",
                  joinedIdentity: joinResponse.data.memberPublicKey,
                }
              : ch,
          ),
        );
        onChannelJoined?.(contextId);
        fetchChannels();
        if (channel) {
          onChatSelected(
            buildChannelEntryChat({
              contextId,
              name: getActiveChannelName(channel),
              contextIdentity: joinResponse.data.memberPublicKey,
              username: "",
            }),
          );
        }
      } catch (err) {
        log.error("SearchChannels", "Failed to join channel", err);
        addToast({
          title: "Join channel",
          message: err instanceof Error ? err.message : "Failed to join channel",
          type: "channel",
          duration: 4000,
        });
      } finally {
        setIsLoadingId("");
      }
    },
    [addToast, allChannels, fetchChannels, groupId, onChatSelected],
  );

  const onViewChannel = useCallback(
    (channel: BrowsableChannel) => {
      if (!channel.joinedIdentity) {
        return;
      }

      onChatSelected(
        buildChannelEntryChat({
          contextId: channel.contextId,
          name: getActiveChannelName(channel),
          contextIdentity: channel.joinedIdentity,
          username: "",
        }),
      );
    },
    [onChatSelected],
  );

  return (
    <SearchContainer>
      <div className="inputFieldWrapper">
        <SearchInput
          label="Search Channels"
          style={{ width: "100%" }}
          onChange={(e) => setInputValue(e)}
          value={inputValue}
          placeholder="Search channels..."
          clearable={false}
          showSuggestions={false}
          showCategories={false}
        />
      </div>
      <div className="channelListWrapper">
        <div className="listHeader">Channel List</div>
        <div className="list">
          {allChannels.length === 0 && (
            <EmptyState>
              <EmptyStateTitle>No channels yet</EmptyStateTitle>
              <EmptyStateDescription>
                This workspace does not have any channels yet. Create your first
                channel from the Channels panel in the sidebar.
              </EmptyStateDescription>
            </EmptyState>
          )}
          {allChannels.length > 0 && filteredChannels.length === 0 && (
            <EmptyState>
              <EmptyStateTitle>No matching channels</EmptyStateTitle>
              <EmptyStateDescription>
                Try a different search or browse the full channel list.
              </EmptyStateDescription>
            </EmptyState>
          )}
          {filteredChannels.map((channel) => {
            const displayName = getChannelListName(channel);
            return (
              <div key={channel.contextId} className="listItem">
                <div>
                  <div className="channelNameText">
                    <svg
                      xmlns="http://www.w3.org/2000/svg"
                      width="13"
                      height="17"
                      viewBox="0 0 13 17"
                      fill="none"
                    >
                      <path
                        d="M6.585 15.972C6.57134 16.0614 6.56383 16.1516 6.5625 16.242C6.5625 16.6995 6.8775 17.004 7.3125 17.004C7.7115 17.004 8.0505 16.746 8.145 16.2885L8.976 12.234H10.782C11.4135 12.234 11.7075 11.883 11.7075 11.4135C11.7075 10.9455 11.4255 10.6185 10.782 10.6185H9.3045L10.0785 6.83249H11.976C12.621 6.83249 12.903 6.49199 12.903 6.01199C12.903 5.54249 12.621 5.22599 11.976 5.22599H10.407L11.121 1.76999C11.1354 1.68874 11.1434 1.60649 11.145 1.52399C11.1462 1.42202 11.127 1.32083 11.0885 1.22638C11.0501 1.13192 10.9931 1.04612 10.921 0.974005C10.8489 0.90189 10.7631 0.844923 10.6686 0.806453C10.5742 0.767984 10.473 0.748788 10.371 0.749995C10.1822 0.746392 9.99804 0.80888 9.8504 0.926656C9.70277 1.04443 9.60094 1.21009 9.5625 1.39499L8.778 5.22599H5.4255L6.141 1.76999C6.153 1.70999 6.1635 1.59299 6.1635 1.52399C6.16433 1.42123 6.14452 1.31935 6.10526 1.22438C6.06599 1.12941 6.00807 1.04329 5.93491 0.971112C5.86176 0.898937 5.77486 0.842178 5.67937 0.804196C5.58388 0.766214 5.48174 0.747784 5.379 0.749995C5.19215 0.748908 5.0107 0.812572 4.86549 0.930161C4.72028 1.04775 4.62028 1.212 4.5825 1.39499L3.795 5.22599H2.121C1.476 5.22599 1.1955 5.55599 1.1955 6.02399C1.1955 6.49199 1.476 6.83249 2.121 6.83249H3.48L2.7075 10.617H0.9135C0.282 10.617 0 10.9455 0 11.4135C0 11.883 0.282 12.234 0.915 12.234H2.379L1.605 15.972C1.593 16.032 1.5825 16.1595 1.5825 16.242C1.5825 16.6995 1.8975 17.004 2.3325 17.004C2.73 17.004 3.0705 16.746 3.1635 16.2885L3.996 12.234H7.359L6.5865 15.972H6.585ZM5.085 6.80849H8.484L7.7115 10.653H4.2885L5.0865 6.80849H5.085Z"
                        fill="#3B3B40"
                      />
                    </svg>
                    {displayName}
                  </div>
                  <div className="creatorText">
                    {channel.visibility === "open"
                      ? "Open channel"
                      : "Restricted channel"}
                    {!channel.isJoined && !channel.canJoin && channel.blockedReason
                      ? ` • ${channel.blockedReason}`
                      : ""}
                  </div>
                  {channel.info?.description && (
                    <div className="creatorText">{channel.info.description}</div>
                  )}
                </div>
                <div className="listItemOptions">
                  {channel.contextId === isLoadingId && (
                    <div className="spinnerWrapper">
                      <Loader size={20} />
                    </div>
                  )}
                  {channel.isJoined && (
                    <Button
                      onClick={() => onViewChannel(channel)}
                      variant="secondary"
                      style={{ border: "none", backgroundColor: "transparent" }}
                    >
                      View
                    </Button>
                  )}
                  {!channel.isJoined && (
                    <Button
                      disabled={
                        channel.contextId === isLoadingId || !channel.canJoin
                      }
                      variant="primary"
                      onClick={() => handleJoinChannel(channel.contextId)}
                      style={{ width: "74px" }}
                    >
                      Join
                    </Button>
                  )}
                </div>
              </div>
            );
          })}
        </div>
      </div>
    </SearchContainer>
  );
}
