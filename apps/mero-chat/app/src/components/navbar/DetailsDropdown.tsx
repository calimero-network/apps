import { styled } from "styled-components";
import type { ActiveChat, User } from "../../types/Common";
import ChannelDetailsPopup from "../popups/ChannelDetailsPopup";

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

const ChevronIcon = styled.i`
  font-size: 1rem;
  @media (max-width: 1024px) {
    display: none;
  }
  cursor: pointer;
  color: #777583;
`;

const MobileCogIcon = styled.i`
  display: none;
  @media (max-width: 1024px) {
    display: block;
  }
  cursor: pointer;
  color: #777583;
  font-size: 0.8rem;
  padding-bottom: 4px;
`;

interface DetailsDropdownProps {
  activeChat: ActiveChat;
  //todo create API properly
  curbApi: string;
  isOpenSearchChannel: boolean;
  channelUserList: User[];
}

export default function DetailsDropdown(props: DetailsDropdownProps) {
  const { activeChat, isOpenSearchChannel, channelUserList } = props;

  if (activeChat.type === "channel") {
    const toggle = (
      <DropdownSelector>
        <SelectedChannelName>{activeChat.name}</SelectedChannelName>
        <>
          <ChevronIcon className="bi bi-gear-fill" />
          <MobileCogIcon className="bi bi-info-circle-fill" />
        </>
      </DropdownSelector>
    );
    return (
      <ChannelDetailsPopup
        toggle={toggle}
        chat={activeChat}
        channelUserList={channelUserList}
      />
    );
  }
  if (isOpenSearchChannel) {
    return <SelectedChannelName>Browse Channels</SelectedChannelName>;
  }
  const title = activeChat.type === "dm" ? activeChat.id : activeChat.name;
  return <SelectedChannelName>{title}</SelectedChannelName>;
}
