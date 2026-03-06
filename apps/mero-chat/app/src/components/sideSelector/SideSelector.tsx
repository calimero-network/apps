import React, { useState } from "react";
import styled from "styled-components";
import type { ActiveChat, ChannelMeta } from "../../types/Common";
import ChannelHeader from "./ChannelHeader";
import ChannelList from "./ChannelList";
import { CurbLogo } from "../navbar/CurbNavbar";
import DMSideSelector from "./DMSideSelector";
import type { DMChatInfo } from "../../api/clientApi";
import type { CreateContextResult } from "../popups/StartDMPopup";
import { scrollbarStyles } from "../../styles/scrollbar";

interface SideSelectorProps {
  channels: ChannelMeta[];
  activeChat: ActiveChat;
  onChatSelected: (chat: ActiveChat) => void;
  onDMSelected: (dm?: DMChatInfo, sc?: ActiveChat, refetch?: boolean) => void;
  isSidebarOpen: boolean;
  setIsSidebarOpen: (open: boolean) => void;
  setIsOpenSearchChannel: (open: boolean) => void;
  isOpenSearchChannel: boolean;
  chatMembers: Map<string, string>;
  createDM: (value: string) => Promise<CreateContextResult>;
  privateDMs: DMChatInfo[];
}

const HorizontalSeparatorLine = styled.div<{ $isMobile: boolean }>`
  height: 1px;
  background-color: rgba(255, 255, 255, 0.06);
  margin: 0.5rem 0.75rem;
  @media (max-width: 1024px) {
    width: calc(100% - 1.5rem);
    display: ${({ $isMobile }) => ($isMobile ? "flex" : "none")};
  }
`;

const SideMenu = styled.div<{ $isCollapsed: boolean }>`
  background-color: #0e0e10;
  padding-top: 0.5rem;
  width: ${(props) => (props.$isCollapsed ? "60px" : "244px")};
  display: flex;
  flex-direction: column;
  height: calc(100vh - 75px);
  overflow-y: scroll;
  transition: width 0.3s ease-in-out;
  border-right: 1px solid rgba(255, 255, 255, 0.05);

  @media (max-width: 1024px) {
    display: none;
  }

  ${scrollbarStyles}
`;

const SideMenuMobile = styled.div<{ $isOpen: boolean }>`
  display: none;
  background-color: #0e0e10;
  padding-top: 0.75rem;
  overflow-y: scroll;
  height: 100vh;

  @media (max-width: 1024px) {
    display: block;
    position: fixed;
    top: 0;
    left: 0;
    width: 100%;
    height: 100vh;
    z-index: 1000;
    padding-top: 12px;
    padding-bottom: 30px;
    transform: ${(props) =>
      props.$isOpen ? "translateX(0)" : "translateX(-100%)"};
    transition: transform 0.3s ease-in-out;
  }

  ${scrollbarStyles}
`;

const SearchChannelsWrapper = styled.div<{ $isCollapsed: boolean; $active: boolean }>`
  display: flex;
  align-items: center;
  gap: 6px;
  padding: 0.4rem 0.75rem;
  margin: 0 0.375rem 0.25rem;
  border-radius: 7px;
  cursor: pointer;
  justify-content: ${(props) => (props.$isCollapsed ? "center" : "flex-start")};
  color: ${(props) => (props.$active ? "#a5ff11" : "#777583")};
  fill: ${(props) => (props.$active ? "#a5ff11" : "#777583")};
  background: ${(props) => (props.$active ? "rgba(165,255,17,0.08)" : "transparent")};
  transition: all 0.15s ease;

  &:hover {
    background: rgba(165, 255, 17, 0.06);
    color: rgba(165, 255, 17, 0.85);
    fill: rgba(165, 255, 17, 0.85);
  }

  .searchTitle {
    font-size: 12px;
    font-weight: 600;
    letter-spacing: 0.02em;
  }
`;

interface SearchChannelsProps {
  isOpenSearchChannel: boolean;
  setIsOpenSearchChannel: () => void;
  isCollapsed: boolean;
  onToggleCollapse: () => void;
}

const CollapseButton = styled.button`
  background: none;
  border: none;
  color: inherit;
  cursor: pointer;
  padding: 0.2rem;
  border-radius: 4px;
  display: flex;
  align-items: center;
  justify-content: center;
  margin-left: auto;
  opacity: 0.6;
  transition: opacity 0.15s ease;

  &:hover {
    opacity: 1;
  }

  svg {
    width: 14px;
    height: 14px;
  }

  @media (max-width: 1024px) {
    display: none !important;
  }
`;

const SearchChannels: React.FC<SearchChannelsProps> = ({
  isOpenSearchChannel,
  setIsOpenSearchChannel,
  isCollapsed,
  onToggleCollapse,
}) => {
  return (
    <SearchChannelsWrapper
      $isCollapsed={isCollapsed}
      $active={isOpenSearchChannel}
      onClick={setIsOpenSearchChannel}
    >
      <svg xmlns="http://www.w3.org/2000/svg" width="13" height="13" viewBox="0 0 20 20">
        <g clipPath="url(#clip0_1877_27323)">
          <path d="M8.12498 5.6022C10.205 3.51095 15.4062 7.1697 8.12498 11.8747C0.843732 7.1697 6.04498 3.5122 8.12498 5.6022Z" />
          <path fillRule="evenodd" clipRule="evenodd" d="M14.6775 12.9295C15.7016 11.537 16.2527 9.85303 16.25 8.12448C16.2497 6.2979 15.6339 4.52471 14.502 3.09111C13.3701 1.6575 11.7881 0.647115 10.0115 0.223018C8.23481 -0.201079 6.36707 -0.0141442 4.70969 0.753653C3.05232 1.52145 1.70201 2.82532 0.876692 4.45481C0.051375 6.08431 -0.200796 7.94436 0.160879 9.73478C0.522553 11.5252 1.47697 13.1415 2.8701 14.3229C4.26322 15.5042 6.01377 16.1817 7.83923 16.246C9.66401 16.3102 11.4572 15.7579 12.9296 14.6782C12.9674 14.7287 13.0089 14.7764 13.0538 14.8207L17.8663 19.6332C18.1008 19.8676 18.4189 19.9992 18.7505 19.9991C19.082 19.999 19.4 19.8672 19.6344 19.6326C19.8688 19.3981 20.0004 19.08 20.0003 18.7484C20.0001 18.4168 19.8683 18.0989 19.6338 17.8645L14.8213 13.052C14.775 13.007 14.7275 12.967 14.6775 12.9295ZM10.756 14.4762C9.92185 14.8217 9.02785 14.9995 8.12501 14.9995C6.30165 14.9995 4.55296 14.2752 3.26365 12.9858C1.97434 11.6965 1.25001 9.94785 1.25001 8.12448C1.25001 6.30112 1.97434 4.55244 3.26365 3.26312C4.55296 1.97381 6.30165 1.24948 8.12501 1.24948C9.02785 1.24948 9.92185 1.42731 10.756 1.77281C11.5901 2.11831 12.348 2.62472 12.9864 3.26312C13.6248 3.90153 14.1312 4.65942 14.4767 5.49353C14.8222 6.32765 15 7.22164 15 8.12448C15 9.02732 14.8222 9.92132 14.4767 10.7554C14.1312 11.5895 13.6248 12.3474 12.9864 12.9858C12.348 13.6242 11.5901 14.1307 10.756 14.4762Z" />
        </g>
        <defs>
          <clipPath><rect width="20" height="20" /></clipPath>
        </defs>
      </svg>
      {!isCollapsed && <span className="searchTitle">Browse Channels</span>}
      <CollapseButton
        onClick={(e) => {
          e.stopPropagation();
          onToggleCollapse();
        }}
      >
        <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
          {isCollapsed ? <path d="m9 18 6-6-6-6" /> : <path d="m15 18-6-6 6-6" />}
        </svg>
      </CollapseButton>
    </SearchChannelsWrapper>
  );
};

const MobileHeaderWrapper = styled.div`
  display: flex;
  align-items: center;
  padding-left: 1rem;
  padding-bottom: 1rem;
  border-bottom: 1px solid rgba(255, 255, 255, 0.06);
  margin-bottom: 0.5rem;
`;

const SectionLabel = styled.div`
  color: rgba(165, 255, 17, 0.35);
  font-size: 9px;
  font-weight: 700;
  text-align: center;
  padding: 0.25rem 0;
  letter-spacing: 1px;
  text-transform: uppercase;
  @media (max-width: 1024px) {
    display: none;
  }
`;

const SideSelector: React.FC<SideSelectorProps> = (props) => {
  const channels = props.channels;
  const isSidebarOpen = props.isSidebarOpen;
  const setIsOpenSearchChannel = props.setIsOpenSearchChannel;
  const isOpenSearchChannel = props.isOpenSearchChannel;
  const [isCollapsed, setIsCollapsed] = useState(false);

  const SideMenuContent = () => {
    return (
      <>
        <SearchChannels
          isOpenSearchChannel={isOpenSearchChannel}
          setIsOpenSearchChannel={() =>
            setIsOpenSearchChannel(!isOpenSearchChannel)
          }
          isCollapsed={isCollapsed}
          onToggleCollapse={() => setIsCollapsed(!isCollapsed)}
        />
        <HorizontalSeparatorLine $isMobile={false} />
        {isCollapsed && <SectionLabel>CH</SectionLabel>}
        <ChannelHeader
          key="channels-header"
          title="Channels"
          isCollapsed={isCollapsed}
        />
        <ChannelList
          channels={channels}
          selectChannel={props.onChatSelected}
          selectedChannelId={
            props.activeChat.type === "channel"
              ? props.activeChat.name
              : props.activeChat.id
          }
          isCollapsed={isCollapsed}
        />
        <HorizontalSeparatorLine $isMobile={true} />
        {isCollapsed && <SectionLabel>DM</SectionLabel>}
        <DMSideSelector
          chatMembers={props.chatMembers}
          onDMSelected={props.onDMSelected}
          selectChannel={props.onChatSelected}
          selectedDM={
            props.activeChat.type === "direct_message"
              ? props.activeChat.id
              : ""
          }
          createDM={props.createDM}
          privateDMs={props.privateDMs}
          isCollapsed={isCollapsed}
        />
      </>
    );
  };

  return (
    <>
      {isSidebarOpen && (
        <SideMenuMobile $isOpen={isSidebarOpen}>
          <MobileHeaderWrapper>
            <CurbLogo isMobile={true} />
          </MobileHeaderWrapper>
          <SideMenuContent />
        </SideMenuMobile>
      )}
      <SideMenu $isCollapsed={isCollapsed}>
        <SideMenuContent />
      </SideMenu>
    </>
  );
};

export default SideSelector;
