import styled from "styled-components";
import type { ActiveChat } from "../../types/Common";
import DetailsDropdown from "./DetailsDropdown";
import ChannelDetailsPopup from "../popups/ChannelDetailsPopup";
import UsersButtonGroup from "./UsersButtonGroup";
import { useState } from "react";
import type { UserId } from "../../api/clientApi";

const NavigationBar = styled.div<{ $isSidebarOpen: boolean }>`
  display: flex;
  justify-content: space-between;
  align-items: center;
  background-color: #0e0e10;
  padding-left: 1rem;
  padding-right: 1rem;
  border-bottom: 1px solid #282933;
  @media (max-width: 1024px) {
    ${(props) => (props.$isSidebarOpen ? "display: none;" : "display: flex;")}
    position: fixed;
    left: 0;
    right: 0;
    z-index: 1000;
  }
`;

const CurbNameContainer = styled.div`
  display: flex;
  column-gap: 0.5rem;
  align-items: center;
  color: #fff;
  font-size: 20.923px;
  font-style: normal;
  font-weight: 700;
  line-height: 150%;
  padding-right: 0.875rem;
`;
const VerticalSeparatorFull = styled.div`
  width: 1px;
  height: 80px;
  background-color: #282933;
  @media (max-width: 1024px) {
    display: none;
  }
}
`;

const OrgNameContainer = styled.div`
  color: #777583;
  font-family: Helvetica Neue;
  font-size: 16px;
  font-style: normal;
  font-weight: 500;
  line-height: 120%;
  padding-left: 1rem;
  padding-right: 6rem;
  padding-top: 1rem;
  padding-bottom: 1rem;
  display: flex;
  justify-content: center;
  align-items: center;
  border-left: 1px solid #282933;
  @media (max-width: 1024px) {
    display: none;
  }
}
`;

const ItemsContainer = styled.div<{ $align: boolean }>`
  display: flex;
  ${(props) => props.$align && "align-items: center;"}
`;

const LogoContainer = styled.div<{ justify?: boolean }>`
  display: flex;
  gap: 0.5rem;
  @media (max-width: 1024px) {
      display: none;
    }
  }
  align-items: center;
  ${(props) => props.justify && "justify-content: center;"}
`;

const BackIcon = styled.svg`
  fill: #5765f2;
  display: none;
  @media (max-width: 1024px) {
    display: flex;
  }
  maring-right: 14px;
`;

const IconWrapper = styled.div`
  padding: 8px;
  display: none;
  justify-content: center;
  align-items: center;
  margin-right: 8px;
  @media (max-width: 1024px) {
    display: flex;
  }
`;

const CurbLogo = () => {
  return (
    <LogoContainer>
      <svg
        width="28"
        height="28"
        viewBox="0 0 28 28"
        fill="none"
        xmlns="http://www.w3.org/2000/svg"
      >
        <rect width="28" height="28" rx="6" fill="#5770F2" />
        <path
          fillRule="evenodd"
          clipRule="evenodd"
          d="M24.1568 14C24.1568 8.69358 19.8554 4.39215 14.549 4.39215C9.2426 4.39215 4.94117 8.69358 4.94117 14C4.93884 15.7503 5.41672 17.4677 6.32278 18.9653L5.46576 21.8784C5.41655 22.0457 5.41331 22.2231 5.45639 22.392C5.49946 22.561 5.58725 22.7152 5.71053 22.8385C5.83381 22.9618 5.98802 23.0495 6.15696 23.0926C6.3259 23.1357 6.50333 23.1324 6.67058 23.0832L9.58368 22.2262C11.0811 23.1326 12.7986 23.6105 14.549 23.6078C15.4677 23.6078 16.3564 23.4789 17.1977 23.2381C17.1509 22.8994 17.1267 22.5534 17.1267 22.2018C17.1267 18.2267 20.2197 14.974 24.1303 14.7191C24.1479 14.4817 24.1568 14.2419 24.1568 14ZM10.1672 12.9809C10.4375 12.7107 10.804 12.5588 11.1863 12.5588C11.5685 12.5588 11.9351 12.7107 12.2053 12.9809C12.4756 13.2512 12.6274 13.6178 12.6274 14C12.6274 14.3822 12.4756 14.7488 12.2053 15.0191C11.9351 15.2893 11.5685 15.4412 11.1863 15.4412C10.804 15.4412 10.4375 15.2893 10.1672 15.0191C9.89693 14.7488 9.74509 14.3822 9.74509 14C9.74509 13.6178 9.89693 13.2512 10.1672 12.9809ZM16.8927 12.9809C17.163 12.7107 17.5295 12.5588 17.9118 12.5588C18.294 12.5588 18.6605 12.7107 18.9308 12.9809C19.2011 13.2512 19.3529 13.6178 19.3529 14C19.3529 14.3822 19.2011 14.7488 18.9308 15.0191C18.6605 15.2893 18.294 15.4412 17.9118 15.4412C17.5295 15.4412 17.163 15.2893 16.8927 15.0191C16.6224 14.7488 16.4706 14.3822 16.4706 14C16.4706 13.6178 16.6224 13.2512 16.8927 12.9809Z"
          fill="white"
        />
      </svg>
      <CurbNameContainer>Chat</CurbNameContainer>
    </LogoContainer>
  );
};

const BackIconContainer = ({ onClick }: { onClick: () => void }) => {
  return (
    <IconWrapper onClick={onClick}>
      <BackIcon
        xmlns="http://www.w3.org/2000/svg"
        width="20"
        height="20"
        fill="white"
        className="bi bi-chevron-left"
        viewBox="0 0 16 16"
      >
        <path
          fillRule="evenodd"
          d="M11.354 1.646a.5.5 0 0 1 0 .708L5.707 8l5.647 5.646a.5.5 0 0 1-.708.708l-6-6a.5.5 0 0 1 0-.708l6-6a.5.5 0 0 1 .708 0z"
        />
      </BackIcon>
    </IconWrapper>
  );
};

interface CurbNavbarProps {
  activeChat: ActiveChat | null;
  isSidebarOpen: boolean;
  setIsSidebarOpen: (isOpen: boolean) => void;
  isOpenSearchChannel: boolean;
  setIsOpenSearchChannel: (isOpen: boolean) => void;
  channelUserList: UserId[];
  nonInvitedUserList: UserId[];
  reFetchChannelMembers: () => void;
  setActiveChat: (chat: ActiveChat) => void;
  fetchChannels: () => void;
}

export default function CurbNavbar({
  activeChat,
  isSidebarOpen,
  setIsSidebarOpen,
  isOpenSearchChannel,
  channelUserList,
  nonInvitedUserList,
  reFetchChannelMembers,
  setActiveChat,
  fetchChannels
}: CurbNavbarProps) {
  const [isOpen, setIsOpen] = useState(false);
  return (
    <NavigationBar $isSidebarOpen={isSidebarOpen}>
      <ItemsContainer $align={true}>
        <>
          <CurbLogo />
          <OrgNameContainer>Calimero P2P</OrgNameContainer>
        </>
        <VerticalSeparatorFull/>
        <BackIconContainer
          onClick={() => {
            setIsSidebarOpen(!isSidebarOpen);
          }}
        />
        {activeChat && (
          <DetailsDropdown
            activeChat={activeChat}
            isOpenSearchChannel={isOpenSearchChannel}
            channelUserList={channelUserList}
            nonInvitedUserList={nonInvitedUserList}
            reFetchChannelMembers={reFetchChannelMembers}
            setActiveChat={setActiveChat}
            fetchChannels={fetchChannels}
          />
        )}
      </ItemsContainer>
      {channelUserList.length > 0 && activeChat && (
        <ItemsContainer $align={false}>
          <ChannelDetailsPopup
            toggle={
              <div>
                <UsersButtonGroup
                  channelUserList={channelUserList}
                  openMemberList={() => {}}
                />
              </div>
            }
            chat={activeChat}
            channelUserList={channelUserList}
            nonInvitedUserList={nonInvitedUserList}
            isOpen={isOpen}
            setIsOpen={setIsOpen}
            selectedTabIndex={0}
            reFetchChannelMembers={reFetchChannelMembers}
            setActiveChat={setActiveChat}
            fetchChannels={fetchChannels}
          />
        </ItemsContainer>
      )}
    </NavigationBar>
  );
}
