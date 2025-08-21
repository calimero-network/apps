import React, { useState } from "react";
import styled from "styled-components";
import AboutDetails from "./AboutDetails";
import MemberDetails from "./MemberDetails";
import TabSwitch from "./TabSwitch";
import type { ChannelMeta } from "../../types/Common";
import type { UserId } from "../../api/clientApi";
import { getExecutorPublicKey } from "@calimero-network/calimero-client";
import { ClientApiDataSource } from "../../api/dataSource/clientApiDataSource";

const Wrapper = styled.div``;

const ChannelTitle = styled.div`
  display: flex;
  column-gap: 0.5rem;
  align-items: center;
  color: #fff;
  font-family: Helvetica Neue;
  font-size: 24px;
  font-style: normal;
  font-weight: 500;
  line-height: 120%;
  margin-bottom: 1rem;
`;

interface DetailsContainerProps {
  channelName: string;
  selectedTabIndex?: number;
  userList: Map<string, string>;
  nonInvitedUserList: UserId[];
  channelMeta: ChannelMeta;
  handleLeaveChannel: () => void;
  addMember: (user: string) => void;
  promoteModerator: (user: string) => void;
  removeUserFromChannel: (user: string) => void;
  reFetchChannelMembers: () => void;
}

const DetailsContainer: React.FC<DetailsContainerProps> = (props) => {
  const channelName = props.channelName;
  const initialTabIndex = props.selectedTabIndex ? 0 : 1;
  const userCount = Object.keys(props.userList).length;
  const userList = props.userList;
  const channelMeta = props.channelMeta;
  const handleLeaveChannel = props.handleLeaveChannel;
  const promoteModerator = props.promoteModerator;
  const removeUserFromChannel = props.removeUserFromChannel;
  const nonInvitedUserList = props.nonInvitedUserList;
  const reFetchChannelMembers = props.reFetchChannelMembers;

  const [selectedTabIndex, setSelectedTabIndex] = useState(initialTabIndex);

  const ChannelName = () => {
    return (
      <ChannelTitle>
        <i className="bi bi-hash"></i>
        {channelName}
      </ChannelTitle>
    );
  };

  const addMember = async (account: string, channel: string) => {
    await new ClientApiDataSource().inviteToChannel({
      channel: { name: channel },
      user: account,
    });
    await reFetchChannelMembers();
  };

  const getNonInvitedUsers = (value: string): UserId[] => {
    return nonInvitedUserList
      ? Object.values(nonInvitedUserList).filter((u) => {
          return u.startsWith(value);
        })
      : [];
  };

  return (
    <Wrapper>
      <ChannelName />
      <TabSwitch
        selectedTabIndex={selectedTabIndex}
        setSelectedTabIndex={setSelectedTabIndex}
        userCount={userCount}
      />
      {selectedTabIndex === 0 && (
        <AboutDetails
          dateCreated={channelMeta.createdAt}
          manager={channelMeta.createdByUsername}
          handleLeaveChannel={handleLeaveChannel}
          channelName={channelName}
        />
      )}
      {selectedTabIndex === 1 && (
        <MemberDetails
          id={0}
          user={getExecutorPublicKey() as unknown as UserId}
          promoteModerator={(userId: string, isModerator: boolean) => {
            if (!isModerator) {
              return;
            }
            // @ts-expect-error - userList is a Map<string, string>
            const user = userList[userId];
            if (user) {
              promoteModerator(userId);
            }
          }}
          removeUserFromChannel={(userId: string) => {
            // @ts-expect-error - userList is a Map<string, string>
            const user = userList[userId];
            if (user) {
              removeUserFromChannel(userId);
            }
          }}
          channelOwner={channelMeta.createdBy}
          optionsOpen={0}
          setOptionsOpen={() => {}}
          selectedUser={null}
          setSelectedUser={() => {}}
          userList={userList}
          addMember={addMember}
          channelName={channelName}
          getNonInvitedUsers={getNonInvitedUsers}
          nonInvitedUserList={nonInvitedUserList}
        />
      )}
    </Wrapper>
  );
};

export default DetailsContainer;
