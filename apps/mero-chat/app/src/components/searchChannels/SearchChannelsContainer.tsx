import { styled } from "styled-components";
import Loader from "../loader/Loader";
import type { ActiveChat, ChannelMeta } from "../../types/Common";
import { useCallback, useEffect, useState } from "react";
import { ClientApiDataSource } from "../../api/dataSource/clientApiDataSource";
import {
  getExecutorPublicKey,
  type ResponseData,
} from "@calimero-network/calimero-client";
import type { Channels } from "../../api/clientApi";

const SearchContainer = styled.div`
  padding: 24px;
  display: flex;
  flex-direction: column;
  @media (min-width: 1025px) {
    height: 100%;
  }
  @media (max-width: 1024px) {
    padding: 42px 0 0;
    background-color: #0e0e10;
  }
  .inputFieldWrapper {
    display: flex;
    align-items: center;
    width: 100%;
    position: relative;
    @media (max-width: 1024px) {
      margin-top: 24px;
      padding-left: 16px;
      padding-right: 16px;
    }
  }
  .searchInput {
    width: 100%;
    background-color: #070707;
    border: none;
    outline: 0;
    color: #fff;
    font-family: Helvetica Neue;
    font-size: 16px;
    font-style: normal;
    font-weight: 400;
    line-height: 150%;
    padding: 8px 16px;
    border-radius: 4px;
  }
  .searchIcon {
    fill: #777583;
    position: absolute;
    z-index: 10;
    right: 16px;
    top: 10px;
    cursor: pointer;
    :hover {
      fill: #fff;
    }
    @media (max-width: 1024px) {
      right: 32px;
    }
  }
  .channelListWrapper {
    padding-top: 24px;
    padding-left: 16px;
    padding-right: 16px;
    width: 100%;
    scrollbar-color: black transparent;
    ::-webkit-scrollbar {
      width: 0px;
    }
    ::-webkit-scrollbar-thumb {
      background-color: black;
      border-radius: 6px;
    }
    ::-webkit-scrollbar-thumb:hover {
      background-color: black;
    }
    * {
      scrollbar-color: black transparent;
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
    @media (max-width: 1024px) {
      padding-top: 16px;
      overflow: scroll;
      padding-bottom: 16px;
    }
    @media (min-width: 1025px) {
      height: 100%;
      overflow: scroll;
    }
  }
  .listHeader {
    width: 100%;
    color: #777583;
    font-family: Helvetica Neue;
    font-size: 16px;
    font-style: normal;
    font-weight: 700;
    line-height: 150%;
  }
  .list {
    width: 100%;
    padding-top: 8px;
    display: flex;
    flex-direction: column;
    gap: 8px;
    @media (min-width: 1025px) {
      height: 100%;
    }
    @media (max-width: 1024px) {
      flex: 1;
    }
  }
  .listItem {
    padding: 8px 16px;
    display: flex;
    justify-content: space-between;
    align-items: center;
    background-color: #141418;
    border-radius: 4px;
  }
  .channelNameText {
    color: #777583;
    font-family: Helvetica Neue;
    font-size: 16px;
    font-style: normal;
    font-weight: 400;
    line-height: 150%;
    padding-left: 6px;
  }
  .creatorText {
    color: #777583;
    font-family: Helvetica Neue;
    font-size: 14px;
    font-style: normal;
    font-weight: 400;
    line-height: 150%;
    padding-left: 4px;
  }
  .listItemOptions {
    display: flex;
    gap: 8px;
    font-family: Helvetica Neue;
    font-size: 14px;
    font-style: normal;
    font-weight: 400;
    line-height: 150%;
  }
  .viewChannelButton,
  .joinChannelButton {
    padding: 4px 13px;
    border-radius: 4px;
    width: 64px;
    cursor: pointer;
    text-align: center;
  }
  .viewChannelButton {
    color: #777583;
    border: 1px solid #141418;
    :hover {
      color: #fff;
      background-color: #070707;
      border: 1px solid #070707;
    }
  }
  .joinChannelButton {
    color: #fff;
    border: 1px solid #1e1f28;
  }
  .spinnerWrapper {
    margin-top: 4px;
  }
`;

const ChannelOptionButton = styled.button<{ $canJoin: boolean }>`
  background-color: transparent;
  :hover {
    background-color: ${({ $canJoin }) => ($canJoin ? "#727EFA" : "#C03636")};
    border: 1px solid ${({ $canJoin }) => ($canJoin ? "#727EFA" : "#C03636")};
  }
`;

interface SearchChannelsContainerProps {
  onChatSelected: (chat: ActiveChat) => void;
  fetchChannels: () => void;
}

export default function SearchChannelsContainer({
  onChatSelected,
  fetchChannels,
}: SearchChannelsContainerProps) {
  const [allChannels, setAllChannels] = useState<ChannelMeta[]>([]);
  const [inputValue, setInputValue] = useState("");
  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  const [allChannelsCreators, setAllChannelsCreators] = useState<{
    [key: string]: string;
  }>({});
  const [isLoadingNameId, setIsLoadingNameId] = useState("");

  const channelsStartingWithPrefix = inputValue
    ? allChannels.filter((channel) => channel.name.startsWith(inputValue)) || []
    : allChannels || [];

  useEffect(() => {
    const fetchChannels = async () => {
      const channels: ResponseData<Channels> =
        await new ClientApiDataSource().getAllChannelsSearch();
      if (channels.data) {
        const channelsArray: ChannelMeta[] = await Promise.all(
          Object.entries(channels.data).map(async ([name, channelInfo]) => {
            const channelMembers: ResponseData<Map<string, string>> =
              await new ClientApiDataSource().getChannelMembers({
                channel: { name: name },
              });
            let isMember = false;
            if (channelMembers.data) {
              isMember = Object.keys(channelMembers.data).includes(
                getExecutorPublicKey() || ""
              );
            } else {
              isMember = false;
            }
            return {
              name,
              type: "channel" as const,
              channelType: channelInfo.channel_type,
              description: "",
              owner: channelInfo.created_by,
              members: [],
              createdBy: channelInfo.created_by,
              createdByUsername: channelInfo.created_by_username,
              inviteOnly: false,
              unreadMessages: {
                count: 0,
                mentions: 0,
              },
              isMember: isMember,
              readOnly: channelInfo.read_only,
              createdAt: new Date(channelInfo.created_at * 1000).toISOString(),
            };
          })
        );
        setAllChannels(channelsArray);
      }
    };
    fetchChannels();
  }, []);

  const clickChannelOption = useCallback(
    async (isMember: boolean, channelName: string) => {
      setIsLoadingNameId(channelName);
      if (isMember) {
        await new ClientApiDataSource().leaveChannel({
          channel: { name: channelName },
        });
      } else {
        await new ClientApiDataSource().joinChannel({
          channel: { name: channelName },
        });
      }
      const updatedChannel = allChannels.map((c) => {
        if (c.name === channelName) {
          return { ...c, isMember: !isMember };
        } else {
          return { ...c };
        }
      });
      setAllChannels(updatedChannel);
      setIsLoadingNameId("");
      fetchChannels();
    },
    [setAllChannels, allChannels]
  );

  const onViewChannel = useCallback((chatSelected: ChannelMeta) => {
    const chat: ActiveChat = {
      type: chatSelected.type,
      id: chatSelected.name,
      name: chatSelected.name,
      readOnly: chatSelected.readOnly,
      account: chatSelected.owner,
      canJoin: chatSelected.isMember === false,
    };
    onChatSelected(chat);
  }, []);

  return (
    <SearchContainer>
      <div className="inputFieldWrapper">
        <input
          className="searchInput"
          placeholder="Search Channels"
          onChange={(e) => setInputValue(e.target.value)}
          value={inputValue}
        />
        <svg
          className="searchIcon"
          xmlns="http://www.w3.org/2000/svg"
          width="20"
          height="20"
          viewBox="0 0 20 20"
        >
          <path
            d="M14.6799 12.9311C15.8903 11.2795 16.4324 9.23171 16.1978 7.19754C15.9632 5.16336 14.9692 3.29278 13.4146 1.96001C11.8601 0.627253 9.85963 -0.0693934 7.81349 0.00944807C5.76735 0.0882895 3.82642 0.936805 2.37903 2.38524C0.931631 3.83367 0.0845053 5.7752 0.00712805 7.82139C-0.0702492 9.86759 0.627829 11.8676 1.9617 13.4212C3.29557 14.9748 5.16687 15.9674 7.20122 16.2006C9.23556 16.4337 11.2829 15.8902 12.9337 14.6786H12.9324C12.9699 14.7286 13.0099 14.7761 13.0549 14.8224L17.8674 19.6349C18.1018 19.8694 18.4198 20.0012 18.7514 20.0014C19.083 20.0015 19.401 19.8699 19.6356 19.6355C19.8701 19.4011 20.002 19.0831 20.0021 18.7515C20.0022 18.42 19.8706 18.1019 19.6362 17.8674L14.8237 13.0549C14.779 13.0096 14.7309 12.9678 14.6799 12.9299V12.9311ZM15.0024 8.1261C15.0024 9.02894 14.8246 9.92294 14.4791 10.7571C14.1336 11.5912 13.6272 12.3491 12.9888 12.9875C12.3504 13.6259 11.5925 14.1323 10.7584 14.4778C9.92428 14.8233 9.03028 15.0011 8.12744 15.0011C7.2246 15.0011 6.33061 14.8233 5.49649 14.4778C4.66238 14.1323 3.90449 13.6259 3.26608 12.9875C2.62768 12.3491 2.12127 11.5912 1.77577 10.7571C1.43027 9.92294 1.25244 9.02894 1.25244 8.1261C1.25244 6.30274 1.97677 4.55406 3.26608 3.26474C4.5554 1.97543 6.30408 1.2511 8.12744 1.2511C9.9508 1.2511 11.6995 1.97543 12.9888 3.26474C14.2781 4.55406 15.0024 6.30274 15.0024 8.1261V8.1261Z"
            fill="#777583"
          />
        </svg>
      </div>
      <div className="channelListWrapper">
        <div className="listHeader">Channel List</div>
        <div className="list">
          {channelsStartingWithPrefix.map(
            (channel: ChannelMeta, id: number) => (
              <div key={id} className="listItem">
                <div>
                  <div className="channelNameText">
                    <svg
                      xmlns="http://www.w3.org/2000/svg"
                      width="13"
                      height="17"
                      viewBox="0 0 13 17"
                      fill="none"
                    >
                      <path
                        d="M6.585 15.972C6.57134 16.0614 6.56383 16.1516 6.5625 16.242C6.5625 16.6995 6.8775 17.004 7.3125 17.004C7.7115 17.004 8.0505 16.746 8.145 16.2885L8.976 12.234H10.782C11.4135 12.234 11.7075 11.883 11.7075 11.4135C11.7075 10.9455 11.4255 10.6185 10.782 10.6185H9.3045L10.0785 6.83249H11.976C12.621 6.83249 12.903 6.49199 12.903 6.01199C12.903 5.54249 12.621 5.22599 11.976 5.22599H10.407L11.121 1.76999C11.1354 1.68874 11.1434 1.60649 11.145 1.52399C11.1462 1.42202 11.127 1.32083 11.0885 1.22638C11.0501 1.13192 10.9931 1.04612 10.921 0.974005C10.8489 0.90189 10.7631 0.844923 10.6686 0.806453C10.5742 0.767984 10.473 0.748788 10.371 0.749995C10.1822 0.746392 9.99804 0.80888 9.8504 0.926656C9.70277 1.04443 9.60094 1.21009 9.5625 1.39499L8.778 5.22599H5.4255L6.141 1.76999C6.153 1.70999 6.1635 1.59299 6.1635 1.52399C6.16433 1.42123 6.14452 1.31935 6.10526 1.22438C6.06599 1.12941 6.00807 1.04329 5.93491 0.971112C5.86176 0.898937 5.77486 0.842178 5.67937 0.804196C5.58388 0.766214 5.48174 0.747784 5.379 0.749995C5.19215 0.748908 5.0107 0.812572 4.86549 0.930161C4.72028 1.04775 4.62028 1.212 4.5825 1.39499L3.795 5.22599H2.121C1.476 5.22599 1.1955 5.55599 1.1955 6.02399C1.1955 6.49199 1.476 6.83249 2.121 6.83249H3.48L2.7075 10.617H0.9135C0.282 10.617 0 10.9455 0 11.4135C0 11.883 0.282 12.234 0.915 12.234H2.379L1.605 15.972C1.593 16.032 1.5825 16.1595 1.5825 16.242C1.5825 16.6995 1.8975 17.004 2.3325 17.004C2.73 17.004 3.0705 16.746 3.1635 16.2885L3.996 12.234H7.359L6.5865 15.972H6.585ZM5.085 6.80849H8.484L7.7115 10.653H4.2885L5.0865 6.80849H5.085Z"
                        fill="#3B3B40"
                      />
                    </svg>
                    {channel.name}
                  </div>
                  <div className="creatorText">
                    Created by: {channel.createdBy.slice(0, 6)}...
                    {channel.createdBy.slice(-4)}
                  </div>
                </div>
                <div className="listItemOptions">
                  {channel.name === isLoadingNameId && (
                    <div className="spinnerWrapper">
                      <Loader size={20} />
                    </div>
                  )}
                  <div
                    className="viewChannelButton"
                    onClick={() => onViewChannel(channel)}
                  >
                    View
                  </div>
                  <ChannelOptionButton
                    className="joinChannelButton"
                    $canJoin={!channel.isMember}
                    disabled={
                      channel.name === isLoadingNameId ||
                      channel.createdBy === localStorage.getItem("accountId") ||
                      channel.channelType === "Default"
                    }
                    onClick={() =>
                      clickChannelOption(channel.isMember, channel.name)
                    }
                  >
                    {channel.isMember ? "Leave" : "Join"}
                  </ChannelOptionButton>
                </div>
              </div>
            )
          )}
        </div>
      </div>
    </SearchContainer>
  );
}
