import { memo } from "react";
import { styled } from "styled-components";
import type { ActiveChat, ChannelMeta, ChatType } from "../../types/Common";
import UnreadMessagesBadge from "./UnreadMessageBadge";

const ChannelListContainer = styled.div`
  background-color: #0e0e10;
  @media (max-width: 1024px) {
    width: 100%;
  }
`;

const ScrollableChannelList = styled.div`
  max-height: 240px; /* Approximately 6 items * 40px height */
  overflow-y: auto;
  scrollbar-width: thin;
  scrollbar-color: #282933 transparent;
  
  &::-webkit-scrollbar {
    width: 4px;
  }
  
  &::-webkit-scrollbar-track {
    background: transparent;
  }
  
  &::-webkit-scrollbar-thumb {
    background-color: #282933;
    border-radius: 2px;
  }
  
  &::-webkit-scrollbar-thumb:hover {
    background-color: #404040;
  }
`;

const ChannelListItem = styled.div<{ selected: boolean; $isCollapsed?: boolean }>`
  display: flex;
  justify-content: ${props => props.$isCollapsed ? 'center' : 'space-between'};
  align-items: center;
  padding-top: 0.375rem;
  padding-bottom: 0.375rem;
  padding-left: 0.75rem;
  padding-right: 0.75rem;
  border-radius: 0.375rem;
  cursor: pointer;
  @media (min-width: 1024px) {
    &:hover {
      background-color: #25252a !important;
      color: #fff !important;
      fill: #fff !important;
    }
  }
  @media (max-width: 1024px) {
    &:active {
      background-color: #25252a !important;
      color: #fff !important;
      fill: #fff !important;
    }
  }
`;

const TextMedium = styled.div`
  font-family: Helvetica Neue;
  font-size: 14px;
  font-style: normal;
  font-weight: 400;
`;

const NameContainer = styled.div`
  display: flex;
  gap: 6px;
  justify-content: start;
  align-items: center;
  width: 100%;
`;

const IconWrapper = styled.div`
  height: 24px;
  width: 24px;
  display: flex;
  justify-content: center;
  align-items: center;
`;

interface ChannelListProps {
  channels: ChannelMeta[];
  selectedChannelId: string;
  selectChannel: (channel: ActiveChat) => void;
  isCollapsed?: boolean;
}

const ChannelList = memo(function ChannelList(props: ChannelListProps) {
  const { channels, selectedChannelId, selectChannel, isCollapsed } = props;

  return (
    <ChannelListContainer>
      <ScrollableChannelList>
        {channels.map((channel) => (
        <ChannelListItem
          key={channel.name}
          selected={selectedChannelId === channel.name}
          $isCollapsed={isCollapsed}
          onClick={() =>
            selectChannel({
              type: channel.type as ChatType,
              name: channel.name,
              id: channel.name,
              readOnly: channel.readOnly,
              channelType: channel.channelType,
            })
          }
          style={{
            backgroundColor:
              selectedChannelId === channel.name ? "#25252a" : "#0E0E10",
            color:
              channel.unreadMessages.count > 0 ||
              selectedChannelId === channel.name
                ? "#fff"
                : "#777583",
            fill:
              channel.unreadMessages.count > 0 ||
              selectedChannelId === channel.name
                ? "#fff"
                : "#777583",
          }}
        >
          {isCollapsed ? (
            <IconWrapper>
              {channel.channelType === "Private" ? (
                <svg
                  width="12"
                  height="12"
                  viewBox="0 0 16 16"
                  xmlns="http://www.w3.org/2000/svg"
                >
                  <path d="M8 1C8.53043 1 9.03914 1.21071 9.41421 1.58579C9.78929 1.96086 10 2.46957 10 3V7H6V3C6 2.46957 6.21071 1.96086 6.58579 1.58579C6.96086 1.21071 7.46957 1 8 1ZM11 7V3C11 2.20435 10.6839 1.44129 10.1213 0.87868C9.55871 0.31607 8.79565 0 8 0C7.20435 0 6.44129 0.31607 5.87868 0.87868C5.31607 1.44129 5 2.20435 5 3V7C4.46957 7 3.96086 7.21071 3.58579 7.58579C3.21071 7.96086 3 8.46957 3 9V14C3 14.5304 3.21071 15.0391 3.58579 15.4142C3.96086 15.7893 4.46957 16 5 16H11C11.5304 16 12.0391 15.7893 12.4142 15.4142C12.7893 15.0391 13 14.5304 13 14V9C13 8.46957 12.7893 7.96086 12.4142 7.58579C12.0391 7.21071 11.5304 7 11 7Z" />
                </svg>
              ) : (
                <svg
                  width="10"
                  height="13"
                  viewBox="0 0 13 17"
                  xmlns="http://www.w3.org/2000/svg"
                >
                  <path d="M6.585 15.972C6.57134 16.0614 6.56383 16.1516 6.5625 16.242C6.5625 16.6995 6.8775 17.004 7.3125 17.004C7.7115 17.004 8.0505 16.746 8.145 16.2885L8.976 12.234H10.782C11.4135 12.234 11.7075 11.883 11.7075 11.4135C11.7075 10.9455 11.4255 10.6185 10.782 10.6185H9.3045L10.0785 6.83249H11.976C12.621 6.83249 12.903 6.49199 12.903 6.01199C12.903 5.54249 12.621 5.22599 11.976 5.22599H10.407L11.121 1.76999C11.1354 1.68874 11.1434 1.60649 11.145 1.52399C11.1462 1.42202 11.127 1.32083 11.0885 1.22638C11.0501 1.13192 10.9931 1.04612 10.921 0.974005C10.8489 0.90189 10.7631 0.844923 10.6686 0.806453C10.5742 0.767984 10.473 0.748788 10.371 0.749995C10.1822 0.746392 9.99804 0.80888 9.8504 0.926656C9.70277 1.04443 9.60094 1.21009 9.5625 1.39499L8.778 5.22599H5.4255L6.141 1.76999C6.153 1.70999 6.1635 1.59299 6.1635 1.52399C6.16433 1.42123 6.14452 1.31935 6.10526 1.22438C6.06599 1.12941 6.00807 1.04329 5.93491 0.971112C5.86176 0.898937 5.77486 0.842178 5.67937 0.804196C5.58388 0.766214 5.48174 0.747784 5.379 0.749995C5.19215 0.748908 5.0107 0.812572 4.86549 0.930161C4.72028 1.04775 4.62028 1.212 4.5825 1.39499L3.795 5.22599H2.121C1.476 5.22599 1.1955 5.55599 1.1955 6.02399C1.1955 6.49199 1.476 6.83249 2.121 6.83249H3.48L2.7075 10.617H0.9135C0.282 10.617 0 10.9455 0 11.4135C0 11.883 0.282 12.234 0.915 12.234H2.379L1.605 15.972C1.593 16.032 1.5825 16.1595 1.5825 16.242C1.5825 16.6995 1.8975 17.004 2.3325 17.004C2.73 17.004 3.0705 16.746 3.1635 16.2885L3.996 12.234H7.359L6.5865 15.972H6.585ZM5.085 6.80849H8.484L7.7115 10.653H4.2885L5.0865 6.80849H5.085Z" />
                </svg>
              )}
            </IconWrapper>
          ) : (
            <>
              <div>
                <NameContainer>
                  <IconWrapper>
                    {channel.channelType === "Private" ? (
                      <svg
                        width="12"
                        height="12"
                        viewBox="0 0 16 16"
                        xmlns="http://www.w3.org/2000/svg"
                      >
                        <path d="M8 1C8.53043 1 9.03914 1.21071 9.41421 1.58579C9.78929 1.96086 10 2.46957 10 3V7H6V3C6 2.46957 6.21071 1.96086 6.58579 1.58579C6.96086 1.21071 7.46957 1 8 1ZM11 7V3C11 2.20435 10.6839 1.44129 10.1213 0.87868C9.55871 0.31607 8.79565 0 8 0C7.20435 0 6.44129 0.31607 5.87868 0.87868C5.31607 1.44129 5 2.20435 5 3V7C4.46957 7 3.96086 7.21071 3.58579 7.58579C3.21071 7.96086 3 8.46957 3 9V14C3 14.5304 3.21071 15.0391 3.58579 15.4142C3.96086 15.7893 4.46957 16 5 16H11C11.5304 16 12.0391 15.7893 12.4142 15.4142C12.7893 15.0391 13 14.5304 13 14V9C13 8.46957 12.7893 7.96086 12.4142 7.58579C12.0391 7.21071 11.5304 7 11 7Z" />
                      </svg>
                    ) : (
                      <svg
                        width="10"
                        height="13"
                        viewBox="0 0 13 17"
                        xmlns="http://www.w3.org/2000/svg"
                      >
                        <path d="M6.585 15.972C6.57134 16.0614 6.56383 16.1516 6.5625 16.242C6.5625 16.6995 6.8775 17.004 7.3125 17.004C7.7115 17.004 8.0505 16.746 8.145 16.2885L8.976 12.234H10.782C11.4135 12.234 11.7075 11.883 11.7075 11.4135C11.7075 10.9455 11.4255 10.6185 10.782 10.6185H9.3045L10.0785 6.83249H11.976C12.621 6.83249 12.903 6.49199 12.903 6.01199C12.903 5.54249 12.621 5.22599 11.976 5.22599H10.407L11.121 1.76999C11.1354 1.68874 11.1434 1.60649 11.145 1.52399C11.1462 1.42202 11.127 1.32083 11.0885 1.22638C11.0501 1.13192 10.9931 1.04612 10.921 0.974005C10.8489 0.90189 10.7631 0.844923 10.6686 0.806453C10.5742 0.767984 10.473 0.748788 10.371 0.749995C10.1822 0.746392 9.99804 0.80888 9.8504 0.926656C9.70277 1.04443 9.60094 1.21009 9.5625 1.39499L8.778 5.22599H5.4255L6.141 1.76999C6.153 1.70999 6.1635 1.59299 6.1635 1.52399C6.16433 1.42123 6.14452 1.31935 6.10526 1.22438C6.06599 1.12941 6.00807 1.04329 5.93491 0.971112C5.86176 0.898937 5.77486 0.842178 5.67937 0.804196C5.58388 0.766214 5.48174 0.747784 5.379 0.749995C5.19215 0.748908 5.0107 0.812572 4.86549 0.930161C4.72028 1.04775 4.62028 1.212 4.5825 1.39499L3.795 5.22599H2.121C1.476 5.22599 1.1955 5.55599 1.1955 6.02399C1.1955 6.49199 1.476 6.83249 2.121 6.83249H3.48L2.7075 10.617H0.9135C0.282 10.617 0 10.9455 0 11.4135C0 11.883 0.282 12.234 0.915 12.234H2.379L1.605 15.972C1.593 16.032 1.5825 16.1595 1.5825 16.242C1.5825 16.6995 1.8975 17.004 2.3325 17.004C2.73 17.004 3.0705 16.746 3.1635 16.2885L3.996 12.234H7.359L6.5865 15.972H6.585ZM5.085 6.80849H8.484L7.7115 10.653H4.2885L5.0865 6.80849H5.085Z" />
                      </svg>
                    )}
                  </IconWrapper>
                  <TextMedium>{channel.name}</TextMedium>
                </NameContainer>
              </div>
              {channel.unreadMessages.mentions > 0 && (
                <UnreadMessagesBadge
                  messageCount={channel.unreadMessages.mentions}
                  backgroundColor="#FF5E5E"
                />
              )}
            </>
          )}
        </ChannelListItem>
        ))}
      </ScrollableChannelList>
    </ChannelListContainer>
  );
});

export default ChannelList;
