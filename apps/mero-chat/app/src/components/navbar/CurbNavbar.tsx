import styled from "styled-components";
import type { ActiveChat } from "../../types/Common";
import DetailsDropdown from "./DetailsDropdown";
import ChannelDetailsPopup from "../popups/ChannelDetailsPopup";
import UsersButtonGroup from "./UsersButtonGroup";
import { useState } from "react";
import type { UserId } from "../../api/clientApi";
import SettingsIcon from "./SettingsIcon";
import CurbLogoIcon from "/logo.svg";

const NavigationBar = styled.div<{ $isSidebarOpen: boolean }>`
  display: flex;
  justify-content: space-between;
  align-items: center;
  background-color: #0e0e10;
  padding-left: 0.5rem;
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
  align-items: center;
  gap: 0.125rem;
  color: #fff;
  @media (min-width: 1025px) {
    padding-right: 8.375rem;
  }
  @media (max-width: 1024px) {
    padding-right: 0.875rem;
  }
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

export const OrgNameContainer = styled.div<{ $isMobile: boolean }>`
  color: #777583;
  font-family: Helvetica Neue;
  font-size: 16px;
  font-style: normal;
  font-weight: 500;
  line-height: 120%;
  padding-left: 1rem;
  padding-right: 5.5rem;
  padding-top: 1rem;
  padding-bottom: 1rem;
  display: flex;
  justify-content: center;
  align-items: center;
  border-left: 1px solid #282933;
  @media (max-width: 1024px) {
    display: ${(props) => (props.$isMobile ? "flex" : "none")};
  }
}
`;

const ItemsContainer = styled.div<{ $align: boolean }>`
  display: flex;
  ${(props) => props.$align && "align-items: center;"}
`;

const LogoContainer = styled.div<{ $isMobile: boolean; justify?: boolean }>`
  display: flex;
  gap: 0.5rem;
  @media (max-width: 1024px) {
      display: ${(props) => (props.$isMobile ? "flex" : "none")};
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

const FlexContainer = styled.div`
  display: flex;
  align-items: center;
  gap: 1rem;
`;

export const CurbLogo = ({ isMobile }: { isMobile: boolean }) => {
  return (
    <LogoContainer $isMobile={isMobile}>
      <img src={CurbLogoIcon} alt="Calimero Logo" height="40px" width="auto" />
      <CurbNameContainer></CurbNameContainer>
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
  channelUserList: Map<string, string>;
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
  fetchChannels,
}: CurbNavbarProps) {
  const [isOpen, setIsOpen] = useState(false);

  return (
    <NavigationBar $isSidebarOpen={isSidebarOpen}>
      <ItemsContainer $align={true}>
        <>
          <CurbLogo isMobile={false} />
        </>
        <VerticalSeparatorFull />
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
      <FlexContainer>
        {activeChat &&
          activeChat?.type === "channel" &&
          Object.keys(channelUserList).length > 0 && (
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
        <SettingsIcon />
      </FlexContainer>
    </NavigationBar>
  );
}
