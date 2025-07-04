import { styled } from "styled-components";
import type { ActiveChat } from "../../types/Common";
import ChannelDetailsPopup from "../popups/ChannelDetailsPopup";
import { useState } from "react";
import type { UserId } from "../../api/clientApi";

const DropdownSelector = styled.div`
  display: flex;
  column-gap: 0.5rem;
  align-items: center;
  cursor: pointer;
  padding-left: 0.875rem;
  padding-top: 0.5rem;
`;

const SelectedChannelName = styled.h4`
  color: #fff;
  font-family: Helvetica Neue;
  font-size: 24px;
  font-style: normal;
  font-weight: 500;
  line-height: 120%;
  @media (max-width: 1024px) {
    font-size: 18px;
    font-weight: 400;
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
  margin-top: 0.2rem;
  font-size: 1rem;
  transition: transform 0.2s ease;

  &.open {
    transform: rotate(180deg);
  }

  @media (max-width: 1024px) {
    display: none;
  }
`;

interface DetailsDropdownProps {
  activeChat: ActiveChat;
  isOpenSearchChannel: boolean;
  channelUserList: UserId[];
}

export default function DetailsDropdown(props: DetailsDropdownProps) {
  const { activeChat, isOpenSearchChannel, channelUserList } = props;
  const [isOpen, setIsOpen] = useState(false);

  if (activeChat.type === "channel") {
    const toggle = (
      <DropdownSelector>
        <SelectedChannelName>{activeChat.name}</SelectedChannelName>
        <>
          <ChevronIcon
            className={`bi bi-chevron-down ${isOpen ? "open" : ""}`}
          />
          <MobileCogIcon className="bi bi-gear-fill" />
        </>
      </DropdownSelector>
    );
    return (
      <ChannelDetailsPopup
        toggle={toggle}
        chat={activeChat}
        channelUserList={channelUserList}
        isOpen={isOpen}
        setIsOpen={setIsOpen}
      />
    );
  }
  if (isOpenSearchChannel) {
    return <SelectedChannelName>Browse Channels</SelectedChannelName>;
  }
  const title =
    activeChat.type === "direct_message" ? activeChat.id : activeChat.name;
  return <SelectedChannelName>{title}</SelectedChannelName>;
}
