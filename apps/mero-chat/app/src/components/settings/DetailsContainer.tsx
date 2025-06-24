import React, { useState } from "react";
import styled from "styled-components";
import AboutDetails from "./AboutDetails";
import MemberDetails from "./MemberDetails";
import TabSwitch from "./TabSwitch";
import type { ChannelMeta, User } from "../../types/Common";

interface DetailsContainerProps {
  channelName: string;
  selectedTabIndex?: number;
  userList: User[];
  channelMeta: ChannelMeta;
  handleLeaveChannel: () => void;
  addMember: (user: string) => void;
  promoteModerator: (user: string) => void;
  removeUserFromChannel: (user: string) => void;
}

const DetailsContainer: React.FC<DetailsContainerProps> = (props) => {
  const channelName = props.channelName;
  const initialTabIndex = props.selectedTabIndex ? 0 : 1;
  const userCount = props.userList.length;
  const userList = props.userList;
  const channelMeta = props.channelMeta;
  const handleLeaveChannel = props.handleLeaveChannel;
  const promoteModerator = props.promoteModerator;
  const removeUserFromChannel = props.removeUserFromChannel;

  const [selectedTabIndex, setSelectedTabIndex] = useState(initialTabIndex);

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

  const ChannelName = () => {
    return (
      <ChannelTitle>
        <i className="bi bi-hash"></i>
        {channelName}
      </ChannelTitle>
    );
  };

  const addMember = (account: string, channel: string) => {
    console.log(account, channel);
  };
  const getNonInvitedUsers = (value: string, channelName: string) => {
    console.log(value, channelName);
  };
  const nonInvitedUserList: User[] = [];

  return (
    <>
      <ChannelName />
      <TabSwitch
        selectedTabIndex={selectedTabIndex}
        setSelectedTabIndex={setSelectedTabIndex}
        userCount={userCount}
      />
      {selectedTabIndex === 0 && (
        <AboutDetails
          dateCreated={channelMeta.createdAt}
          manager={channelMeta.createdBy}
          handleLeaveChannel={handleLeaveChannel}
        />
      )}
      {selectedTabIndex === 1 && (
        <MemberDetails
          id={0}
          user={userList[0]}
          
          promoteModerator={(userId: string, isModerator: boolean) => {
            if (!isModerator) {
              return;
            }
            const user = userList.find((u) => u.id === userId);
            if (user) {
              promoteModerator(user.id);
            }
          }}
          removeUserFromChannel={(userId: string) => {
            const user = userList.find((u) => u.id === userId);
            if (user) {
              removeUserFromChannel(user.id);
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
    </>
  );
};

export default DetailsContainer;
