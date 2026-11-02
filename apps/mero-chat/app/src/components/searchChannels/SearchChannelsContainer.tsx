import { useMemo, useState } from "react";
import Loader from "../loader/Loader";
import { styled } from "styled-components";
import { Button, SearchInput } from "@calimero-network/mero-ui";

import type { ActiveChat, GroupContextChannel } from "../../types/Common";
import { buildChannelEntryChat } from "../../utils/channelEntry";
import { useWorkspace } from "../../calimero/WorkspaceProvider";
import { selfAccount } from "../../calimero/connection";

const SearchContainer = styled.div`
  padding: 24px;
  display: flex;
  flex-direction: column;
  @media (min-width: 1025px) {
    margin: 12px 16px 12px 12px;
    height: calc(100vh - 109px);
    background-color: var(--glass-surface-solid);
    border: 1px solid var(--glass-edge);
    border-radius: var(--glass-radius-lg);
    box-shadow: var(--glass-shadow);
  }
  @media (max-width: 1024px) {
    padding: 42px 0 0;
    background-color: var(--glass-surface-solid);
  }
  /* mero-ui's SearchInput paints its label and typed text white inline. */
  .inputFieldWrapper label,
  .inputFieldWrapper input {
    color: var(--glass-ink) !important;
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
    scrollbar-color: var(--glass-line-strong) transparent;
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
    color: var(--glass-muted);
    font-family: var(--glass-font);
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
    background-color: var(--glass-sunken);
    border-radius: 12px;
  }
  .channelNameText {
    color: var(--glass-muted);
    font-family: var(--glass-font);
    font-size: 14px;
    font-style: normal;
    font-weight: 400;
    line-height: 150%;
    padding-left: 6px;
    /* The hash is an inline svg followed by bare text, so nothing separated
       them: the list read "#launch-planning" with the glyph on the name. */
    display: flex;
    align-items: center;
    gap: 6px;
  }
  .creatorText {
    color: var(--glass-muted);
    font-family: var(--glass-font);
    font-size: 12px;
    font-style: normal;
    font-weight: 400;
    line-height: 150%;
    padding-left: 4px;
  }
  .listItemOptions {
    display: flex;
    gap: 8px;
    font-family: var(--glass-font);
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
  border: 1px solid color-mix(in srgb, var(--glass-ink) 8%, transparent);
  border-radius: 12px;
  background: var(--glass-surface-solid);
  padding: 20px 18px;
  display: flex;
  flex-direction: column;
  gap: 6px;
`;

const EmptyStateTitle = styled.div`
  color: var(--glass-ink);
  font-size: 15px;
  font-weight: 600;
`;

const EmptyStateDescription = styled.div`
  color: var(--glass-muted);
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

/**
 * Browse the workspace's channels. In 1.0 there is no join step: a public
 * channel reaches every member, and a private one only the members its
 * creator added, so the list is the channels this account reaches.
 */
export default function SearchChannelsContainer({
  onChatSelected,
}: SearchChannelsContainerProps) {
  const ws = useWorkspace();
  const [inputValue, setInputValue] = useState("");
  const isLoadingId = "";
  const allChannels: BrowsableChannel[] = useMemo(
    () =>
      ws.conversations
        .filter((c) => c.kind !== "dm")
        .map((c) => ({
          contextId: c.appId,
          alias: c.name,
          info: { name: c.name, context_type: "Channel" as const, creator: c.owner },
          isJoined: true,
          visibility: c.kind === "private" ? ("restricted" as const) : ("open" as const),
          canJoin: false,
          blockedReason: "",
          joinedIdentity: selfAccount(),
        })),
    [ws.conversations],
  );
  const filteredChannels = allChannels.filter((c) =>
    getChannelListName(c).toLowerCase().includes(inputValue.trim().toLowerCase()),
  );
  const handleJoinChannel = (_contextId: string) => {};

  const onViewChannel = (channel: BrowsableChannel) => {
    onChatSelected(
      buildChannelEntryChat({
        contextId: channel.contextId,
        name: getActiveChannelName(channel),
        contextIdentity: channel.joinedIdentity ?? selfAccount(),
        username: "",
      }),
    );
  };

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
              <div key={channel.contextId} className="listItem" data-testid="browse-channel">
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
                        fill="var(--glass-muted)"
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
                      style={{ border: "none", backgroundColor: "transparent", color: "var(--glass-ink)" }}
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
