import { styled } from "styled-components";
import type { ActiveChat } from "../../types/Common";
import ChannelDetailsPopup from "../popups/ChannelDetailsPopup";
import { useState } from "react";
import type { UserId } from "../../api/clientApi";

const DropdownSelector = styled.div`
  display: flex;
  justify-content: center;
  align-items: center;
  column-gap: 0.5rem;
  cursor: pointer;

  @media (min-width: 1025px) {
    padding-left: 1.25rem;
  }
`;

const SelectedChannelName = styled.div`
  color: #fff;
  font-family: Helvetica Neue;
  font-size: 24px;
  font-style: normal;
  font-weight: 500;
  @media (max-width: 1024px) {
    font-size: 18px;
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
  channelUserList: UserId[];
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

export default function DetailsDropdown({
  activeChat,
  isOpenSearchChannel,
  channelUserList,
  nonInvitedUserList,
  reFetchChannelMembers,
  setActiveChat,
  fetchChannels
}: DetailsDropdownProps) {
  const [isOpen, setIsOpen] = useState(false);

  if (activeChat.type === "channel") {
    const toggle = (
      <DropdownSelector>
        <SelectedChannelName>{activeChat.name}</SelectedChannelName>
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
    activeChat.type === "direct_message" ? activeChat.id.toLowerCase() : activeChat.name;
  
  // Truncate title on mobile screens: first 6 chars + "..." + last 4 chars
  const truncatedTitle = title.length > 10 ? `${title.slice(0, 6)}...${title.slice(-4)}` : title;
  
  return (
    <PaddingContainer>
      <SelectedChannelName className="desktop">{title}</SelectedChannelName>
      <SelectedChannelName className="mobile">{truncatedTitle}</SelectedChannelName>
    </PaddingContainer>
  );
}
