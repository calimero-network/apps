import styled from "styled-components";
import type { ActiveChat } from "../../types/Common";
import DetailsDropdown from "./DetailsDropdown";
import ChannelDetailsPopup from "../popups/ChannelDetailsPopup";
import UsersButtonGroup from "./UsersButtonGroup";
import { useState } from "react";
import type { UserId } from "../../api/clientApi";
import SettingsIcon from "./SettingsIcon";
import NotificationCenterWidget from "./NotificationCenterWidget";
import { WebSocketStatus } from "../WebSocketStatus";
import CurbLogoIcon from "/logo.svg";

const NavigationBar = styled.div<{ $isSidebarOpen: boolean }>`
  display: flex;
  justify-content: space-between;
  align-items: center;
  background-color: #0e0e10;
  padding-left: 0.375rem;
  padding-right: 0.75rem;
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
    padding-right: 6rem;
  }
  @media (max-width: 1024px) {
    padding-right: 0.625rem;
  }
`;
const VerticalSeparatorFull = styled.div`
  width: 1px;
  height: 60px;
  background-color: #282933;
  @media (max-width: 1024px) {
    display: none;
  }
}
`;

export const OrgNameContainer = styled.div<{ $isMobile: boolean }>`
  color: #777583;
  font-family: Helvetica Neue;
  font-size: 14px;
  font-style: normal;
  font-weight: 500;
  line-height: 120%;
  padding-left: 0.75rem;
  padding-right: 4rem;
  padding-top: 0.75rem;
  padding-bottom: 0.75rem;
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
  gap: 0.375rem;
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
  padding: 6px;
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
  gap: 0.75rem;
`;

const SearchButton = styled.button<{ $active: boolean }>`
  border: none;
  background: ${(props) =>
    props.$active ? "rgba(87, 101, 242, 0.2)" : "transparent"};
  color: ${(props) => (props.$active ? "#ffffff" : "#c8c7d1")};
  width: 36px;
  height: 36px;
  border-radius: 4px;
  display: inline-flex;
  align-items: center;
  justify-content: center;
  fill: #777583;
  cursor: pointer;
  transition:
    color 0.2s ease,
    background 0.2s ease;
  &:hover {
    color: #ffffff;
    fill: #ffffff;
    background-color: rgba(255, 255, 255, 0.1);
  }
    transition: background-color 0.2s;
`;

const SearchIcon = () => (
  <svg
    xmlns="http://www.w3.org/2000/svg"
    width="18"
    height="18"
    viewBox="0 0 18 18"
  >
    <path d="M12.5 11h-.79l-.28-.27a6 6 0 1 0-.71.71l.27.28v.79l4.25 4.24L16.74 15.5 12.5 11zm-5.5 0a4.5 4.5 0 1 1 0-9 4.5 4.5 0 0 1 0 9z" />
  </svg>
);

export const CurbLogo = ({ isMobile }: { isMobile: boolean }) => {
  return (
    <LogoContainer $isMobile={isMobile} role="banner">
      <img
        src={CurbLogoIcon}
        alt="Curb Chat Application Logo"
        height="32px"
        width="auto"
      />
      <CurbNameContainer></CurbNameContainer>
    </LogoContainer>
  );
};

const BackIconContainer = ({ onClick }: { onClick: () => void }) => {
  return (
    <IconWrapper
      onClick={onClick}
      role="button"
      aria-label="Toggle sidebar"
      tabIndex={0}
      onKeyDown={(e) => {
        if (e.key === "Enter" || e.key === " ") {
          e.preventDefault();
          onClick();
        }
      }}
    >
      <BackIcon
        xmlns="http://www.w3.org/2000/svg"
        width="16"
        height="16"
        fill="white"
        className="bi bi-chevron-left"
        viewBox="0 0 16 16"
        aria-hidden="true"
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
  wsIsSubscribed?: boolean;
  wsContextId?: string | null;
  wsSubscriptionCount?: number;
  onToggleSearchOverlay: () => void;
  isSearchOverlayOpen: boolean;
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
  wsIsSubscribed = false,
  wsContextId = null,
  wsSubscriptionCount = 0,
  onToggleSearchOverlay,
  isSearchOverlayOpen,
}: CurbNavbarProps) {
  const [isOpen, setIsOpen] = useState(false);

  return (
    <NavigationBar
      $isSidebarOpen={isSidebarOpen}
      role="navigation"
      aria-label="Main navigation"
    >
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
        <WebSocketStatus
          isSubscribed={wsIsSubscribed}
          contextId={wsContextId}
          subscriptionCount={wsSubscriptionCount}
        />
        <SearchButton
          type="button"
          onClick={onToggleSearchOverlay}
          aria-label="Toggle message search"
          $active={isSearchOverlayOpen}
        >
          <SearchIcon />
        </SearchButton>
        <NotificationCenterWidget />
        <SettingsIcon />
      </FlexContainer>
    </NavigationBar>
  );
}
