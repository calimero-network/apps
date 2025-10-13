import { styled } from "styled-components";
import type { ActiveChat } from "../../types/Common";
import ChannelDetailsPopup from "../popups/ChannelDetailsPopup";
import { useState } from "react";
import type { UserId } from "../../api/clientApi";

const DropdownSelector = styled.div`
  display: flex;
  justify-content: center;
  align-items: center;
  column-gap: 0.375rem;
  cursor: pointer;

  @media (min-width: 1025px) {
    padding-left: 1rem;
  }
`;

const SelectedChannelName = styled.div`
  color: #fff;
  font-family: Helvetica Neue;
  font-size: 20px;
  font-style: normal;
  font-weight: 500;
  @media (max-width: 1024px) {
    font-size: 16px;
    font-weight: 400;
  }

  &.desktop {
    display: block;
  }

  &.mobile {
    display: none;
  }

  @media (max-width: 1024px) {
    &.desktop {
      display: none;
    }

    &.mobile {
      display: block;
    }
  }
`;

const MobileCogIcon = styled.i`
  color: #777583;
  display: none;
  @media (max-width: 1024px) {
    display: block;
  }
  cursor: pointer;

  font-size: 0.8rem;
`;

const ChevronIcon = styled.i`
  color: #777583;
  font-size: 1rem;
  margin-top: 0.2rem;
  transition: transform 0.2s ease;

  &.open {
    transform: rotate(180deg);
  }

  @media (max-width: 1024px) {
    display: none;
  }
`;

const PaddingContainer = styled.div`
  padding-left: 1.25rem;
`;

interface DetailsDropdownProps {
  activeChat: ActiveChat;
  isOpenSearchChannel: boolean;
  channelUserList: Map<string, string>;
  nonInvitedUserList: UserId[];
  reFetchChannelMembers: () => void;
  setActiveChat: (chat: ActiveChat) => void;
  fetchChannels: () => void;
}

const IconContainer = styled.div`
  display: flex;
  justify-content: center;
  align-items: center;
`;

const ChannelIconContainer = styled.div`
  display: flex;
  align-items: center;
  gap: 0.5rem;
`;

const ChannelTypeIcon = styled.div`
  display: flex;
  align-items: center;
  justify-content: center;
  color: #777583;
  svg {
    width: 12px;
    height: 12px;
    fill: currentColor;
  }
`;

export default function DetailsDropdown({
  activeChat,
  isOpenSearchChannel,
  channelUserList,
  nonInvitedUserList,
  reFetchChannelMembers,
  setActiveChat,
  fetchChannels,
}: DetailsDropdownProps) {
  const [isOpen, setIsOpen] = useState(false);

  if (activeChat.type === "channel") {
    // Use the actual channelType from the activeChat
    const isPrivateChannel = activeChat.channelType === "Private";
    
    const toggle = (
      <DropdownSelector>
        <ChannelIconContainer>
          <ChannelTypeIcon>
            {isPrivateChannel ? (
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
          </ChannelTypeIcon>
          <SelectedChannelName>{activeChat.name}</SelectedChannelName>
        </ChannelIconContainer>
        <IconContainer>
          <ChevronIcon
            className={`bi bi-chevron-down ${isOpen ? "open" : ""}`}
          />
          <MobileCogIcon className="bi bi-gear-fill" />
        </IconContainer>
      </DropdownSelector>
    );
    return (
      <ChannelDetailsPopup
        toggle={toggle}
        chat={activeChat}
        channelUserList={channelUserList}
        isOpen={isOpen}
        setIsOpen={setIsOpen}
        nonInvitedUserList={nonInvitedUserList}
        selectedTabIndex={1}
        reFetchChannelMembers={reFetchChannelMembers}
        setActiveChat={setActiveChat}
        fetchChannels={fetchChannels}
      />
    );
  }
  if (isOpenSearchChannel) {
    return <SelectedChannelName>Browse Channels</SelectedChannelName>;
  }
  const title =
    activeChat.type === "direct_message"
      ? activeChat.username || ""
      : activeChat.name;

  return (
    <PaddingContainer>
      <SelectedChannelName className="desktop">{title}</SelectedChannelName>
      <SelectedChannelName className="mobile">
        {title}
      </SelectedChannelName>
    </PaddingContainer>
  );
}
