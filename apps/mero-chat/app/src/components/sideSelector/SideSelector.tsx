import React from 'react';
import styled from 'styled-components';
import type { ActiveChat, User, ChannelMeta } from '../../types/Common';

interface SideSelectorProps {
  users: User[];
  channels: ChannelMeta[];
  activeChat: ActiveChat;
  onChatSelected: (chat: ActiveChat) => void;
  isSidebarOpen: boolean;
  setIsSidebarOpen: (open: boolean) => void;
  setIsOpenSearchChannel: (open: boolean) => void;
  isOpenSearchChannel: boolean;
}

const HorizontalSeparatorLine = styled.div<{ isMobile: boolean }>`
  background-color: '#BF4F74';
  height: 1px;
  background-color: #282933;
  margin-top: 1rem;
  margin-bottom: 1rem;
  @media (max-width: 1024px) {
    width: 100%;
    display: ${({ isMobile }) => (isMobile ? 'flex' : 'none')};
  }
`;

const SideMenu = styled.div`
  background-color: #0e0e10;
  padding-top: 1rem;
  width: 318px;
  overflow-y: scroll;
  height: calc(100vh - 169px);
  @media (max-width: 1024px) {
    display: none;
  }
  scrollbar-color: black black;
  ::-webkit-scrollbar {
    width: 6px;
  }
  ::-webkit-scrollbar-thumb {
    background-color: black;
    border-radius: 6px;
  }
  ::-webkit-scrollbar-thumb:hover {
    background-color: black;
  }
  * {
    scrollbar-color: black black;
  }
  html::-webkit-scrollbar {
    width: 12px;
  }
  html::-webkit-scrollbar-thumb {
    background-color: black;
    border-radius: 6px;
  }
  html::-webkit-scrollbar-thumb:hover {
    background-color: black;
  }
`;

const SideMenuMobile = styled.div`
  display: none;
  background-color: #0e0e10;
  padding-top: 1rem;
  overflow-y: scroll;
  height: 100vh;
  @media (max-width: 1024px) {
    display: block;
    position: relative;
    z-index: 10;
    padding-top: 64px;
    width: 100%;
    padding-bottom: 30px;
  }
  scrollbar-color: black black;
  ::-webkit-scrollbar {
    width: 6px;
  }
  ::-webkit-scrollbar-thumb {
    background-color: black;
    border-radius: 6px;
  }
  ::-webkit-scrollbar-thumb:hover {
    background-color: black;
  }
  * {
    scrollbar-color: black black;
  }
  html::-webkit-scrollbar {
    width: 12px;
  }
  html::-webkit-scrollbar-thumb {
    background-color: black;
    border-radius: 6px;
  }
  html::-webkit-scrollbar-thumb:hover {
    background-color: black;
  }
`;

const SearchChannelsWrapper = styled.div`
  padding: 8px 16px;
  color: #777583;
  fill: #777583;
  display: flex;
  align-items: center;
  gap: 4px;
  cursor: pointer;
  border-radius: 8px;
  :hover {
    background-color: #25252a;
    color: #fff;
    fill: #fff;
  }
  .searchTitle {
    font-family: Helvetica Neue;
    font-size: 16px;
    font-style: normal;
    font-weight: 700;
    line-height: 150%;
  }
`;

interface SearchChannelsProps {
  isOpenSearchChannel: boolean;
  setIsOpenSearchChannel: () => void;
}

const SearchChannels: React.FC<SearchChannelsProps> = ({ isOpenSearchChannel, setIsOpenSearchChannel }) => {
  const style = isOpenSearchChannel
    ? {
        color: '#fff',
        fill: '#fff',
        backgroundColor: '#1E1F28',
      }
    : {};
  return (
    <SearchChannelsWrapper onClick={setIsOpenSearchChannel} style={style}>
      <svg
        xmlns="http://www.w3.org/2000/svg"
        width="20"
        height="20"
        viewBox="0 0 20 20"
      >
        <g clipPath="url(#clip0_1877_27323)">
          <path d="M8.12498 5.6022C10.205 3.51095 15.4062 7.1697 8.12498 11.8747C0.843732 7.1697 6.04498 3.5122 8.12498 5.6022Z" />
          <path
            fillRule="evenodd"
            clipRule="evenodd"
            d="M14.6775 12.9295C15.7016 11.537 16.2527 9.85303 16.25 8.12448C16.2497 6.2979 15.6339 4.52471 14.502 3.09111C13.3701 1.6575 11.7881 0.647115 10.0115 0.223018C8.23481 -0.201079 6.36707 -0.0141442 4.70969 0.753653C3.05232 1.52145 1.70201 2.82532 0.876692 4.45481C0.051375 6.08431 -0.200796 7.94436 0.160879 9.73478C0.522553 11.5252 1.47697 13.1415 2.8701 14.3229C4.26322 15.5042 6.01377 16.1817 7.83923 16.246C9.66401 16.3102 11.4572 15.7579 12.9296 14.6782C12.9674 14.7287 13.0089 14.7764 13.0538 14.8207L17.8663 19.6332C18.1008 19.8676 18.4189 19.9992 18.7505 19.9991C19.082 19.999 19.4 19.8672 19.6344 19.6326C19.8688 19.3981 20.0004 19.08 20.0003 18.7484C20.0001 18.4168 19.8683 18.0989 19.6338 17.8645L14.8213 13.052C14.775 13.007 14.7275 12.967 14.6775 12.9295ZM10.756 14.4762C9.92185 14.8217 9.02785 14.9995 8.12501 14.9995C6.30165 14.9995 4.55296 14.2752 3.26365 12.9858C1.97434 11.6965 1.25001 9.94785 1.25001 8.12448C1.25001 6.30112 1.97434 4.55244 3.26365 3.26312C4.55296 1.97381 6.30165 1.24948 8.12501 1.24948C9.02785 1.24948 9.92185 1.42731 10.756 1.77281C11.5901 2.11831 12.348 2.62472 12.9864 3.26312C13.6248 3.90153 14.1312 4.65942 14.4767 5.49353C14.8222 6.32765 15 7.22164 15 8.12448C15 9.02732 14.8222 9.92132 14.4767 10.7554C14.1312 11.5895 13.6248 12.3474 12.9864 12.9858C12.348 13.6242 11.5901 14.1307 10.756 14.4762Z"
          />
        </g>
        <defs>
          <clipPath>
            <rect width="20" height="20" />
          </clipPath>
        </defs>
      </svg>
      <span id="searchTitle">Browse Channels</span>
    </SearchChannelsWrapper>
  );
};

const SideSelector: React.FC<SideSelectorProps> = (props) => {
  const users = props.users;
  const channels = props.channels;
  const isSidebarOpen = props.isSidebarOpen;
  const setIsOpenSearchChannel = props.setIsOpenSearchChannel;
  const isOpenSearchChannel = props.isOpenSearchChannel;

  const SideMenuContent = () => {
    return (
      <>
        <SearchChannels
          isOpenSearchChannel={isOpenSearchChannel}
          setIsOpenSearchChannel={() => setIsOpenSearchChannel(!isOpenSearchChannel)}
        />
        <HorizontalSeparatorLine isMobile={false} />
        <div>
          <h3>Channel</h3>
        </div>
        <div>
          {channels.map((channel) => (
            <div key={channel.name}>
              {channel.name}
            </div>
          ))}
        </div>
        <HorizontalSeparatorLine isMobile={true} />
        <div>
          {users.map((user) => (
            <div key={user.id}>
              {user.name || user.id}
            </div>
          ))}
        </div>
      </>
    );
  };

  return (
    <>
      {isSidebarOpen && (
        <SideMenuMobile>
          <SideMenuContent />
        </SideMenuMobile>
      )}
      <SideMenu>
        <SideMenuContent />
      </SideMenu>
    </>
  );
};

export default SideSelector;
