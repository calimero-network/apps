import React, { useState } from "react";
import styled from "styled-components";
import AboutDetails from "./AboutDetails";
import MemberDetails from "./MemberDetails";
import TabSwitch from "./TabSwitch";
import type { ChannelMeta } from "../../types/Common";
import type { UserId } from "../../api/clientApi";
import { getContextIdentity } from "@calimero-network/mero-react";
import { GroupApiDataSource } from "../../api/dataSource/groupApiDataSource";
import { isRestrictedChannelType } from "../../utils/channelVisibility";
import { useToast } from "../../contexts/ToastContext";

const Wrapper = styled.div``;

const ChannelHeader = styled.div`
  display: flex;
  align-items: center;
  gap: 0.5rem;
  margin-bottom: 1.25rem;
  padding-bottom: 0.875rem;
  border-bottom: 1px solid rgba(255, 255, 255, 0.07);
`;

const ChannelIconWrap = styled.div`
  width: 28px;
  height: 28px;
  border-radius: 7px;
  background: rgba(165, 255, 17, 0.08);
  border: 1px solid rgba(165, 255, 17, 0.18);
  display: flex;
  align-items: center;
  justify-content: center;
  flex-shrink: 0;
  color: #a5ff11;
`;

const ChannelTitle = styled.h2`
  color: #fff;
  font-size: 14px;
  font-weight: 600;
  margin: 0;
  letter-spacing: 0.01em;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
`;

interface DetailsContainerProps {
  channelName: string;
  groupId?: string;
  contextId?: string;
  contextSubgroupId?: string;
  selectedTabIndex?: number;
  userList: Map<string, string>;
  nonInvitedUserList: UserId[];
  nonChannelMembers?: Map<string, string>;
  channelMeta: ChannelMeta;
  isOwner?: boolean;
  canManageMembers?: boolean;
  handleDeleteChannel?: () => void;
  isDeleting?: boolean;
  promoteModerator: (user: string) => void;
  reFetchChannelMembers: () => void;
}

const DetailsContainer: React.FC<DetailsContainerProps> = (props) => {
  const channelName = props.channelName;
  const initialTabIndex = props.selectedTabIndex ? 0 : 1;
  const userList = props.userList;
  const channelMeta = props.channelMeta;
  const isOwner = props.isOwner ?? false;
  const canManageMembers = props.canManageMembers ?? isOwner;
  const handleDeleteChannel = props.handleDeleteChannel;
  const nonInvitedUserList = props.nonInvitedUserList;
  const reFetchChannelMembers = props.reFetchChannelMembers;
  const userCount = userList.size;

  const [selectedTabIndex, setSelectedTabIndex] = useState(initialTabIndex);
  const { addToast } = useToast();

  const ChannelName = () => {
    const isPrivateChannel = isRestrictedChannelType(channelMeta.channelType);

    return (
      <ChannelHeader>
        <ChannelIconWrap>
          {isPrivateChannel ? (
            <svg width="11" height="11" viewBox="0 0 16 16" fill="currentColor">
              <path d="M8 1C8.53043 1 9.03914 1.21071 9.41421 1.58579C9.78929 1.96086 10 2.46957 10 3V7H6V3C6 2.46957 6.21071 1.96086 6.58579 1.58579C6.96086 1.21071 7.46957 1 8 1ZM11 7V3C11 2.20435 10.6839 1.44129 10.1213 0.87868C9.55871 0.31607 8.79565 0 8 0C7.20435 0 6.44129 0.31607 5.87868 0.87868C5.31607 1.44129 5 2.20435 5 3V7C4.46957 7 3.96086 7.21071 3.58579 7.58579C3.21071 7.96086 3 8.46957 3 9V14C3 14.5304 3.21071 15.0391 3.58579 15.4142C3.96086 15.7893 4.46957 16 5 16H11C11.5304 16 12.0391 15.7893 12.4142 15.4142C12.7893 15.0391 13 14.5304 13 14V9C13 8.46957 12.7893 7.96086 12.4142 7.58579C12.0391 7.21071 11.5304 7 11 7Z" />
            </svg>
          ) : (
            <svg width="9" height="11" viewBox="0 0 13 17" fill="currentColor">
              <path d="M6.585 15.972C6.57134 16.0614 6.56383 16.1516 6.5625 16.242C6.5625 16.6995 6.8775 17.004 7.3125 17.004C7.7115 17.004 8.0505 16.746 8.145 16.2885L8.976 12.234H10.782C11.4135 12.234 11.7075 11.883 11.7075 11.4135C11.7075 10.9455 11.4255 10.6185 10.782 10.6185H9.3045L10.0785 6.83249H11.976C12.621 6.83249 12.903 6.49199 12.903 6.01199C12.903 5.54249 12.621 5.22599 11.976 5.22599H10.407L11.121 1.76999C11.1354 1.68874 11.1434 1.60649 11.145 1.52399C11.1462 1.42202 11.127 1.32083 11.0885 1.22638C11.0501 1.13192 10.9931 1.04612 10.921 0.974005C10.8489 0.90189 10.7631 0.844923 10.6686 0.806453C10.5742 0.767984 10.473 0.748788 10.371 0.749995C10.1822 0.746392 9.99804 0.80888 9.8504 0.926656C9.70277 1.04443 9.60094 1.21009 9.5625 1.39499L8.778 5.22599H5.4255L6.141 1.76999C6.153 1.70999 6.1635 1.59299 6.1635 1.52399C6.16433 1.42123 6.14452 1.31935 6.10526 1.22438C6.06599 1.12941 6.00807 1.04329 5.93491 0.971112C5.86176 0.898937 5.77486 0.842178 5.67937 0.804196C5.58388 0.766214 5.48174 0.747784 5.379 0.749995C5.19215 0.748908 5.0107 0.812572 4.86549 0.930161C4.72028 1.04775 4.62028 1.212 4.5825 1.39499L3.795 5.22599H2.121C1.476 5.22599 1.1955 5.55599 1.1955 6.02399C1.1955 6.49199 1.476 6.83249 2.121 6.83249H3.48L2.7075 10.617H0.9135C0.282 10.617 0 10.9455 0 11.4135C0 11.883 0.282 12.234 0.915 12.234H2.379L1.605 15.972C1.593 16.032 1.5825 16.1595 1.5825 16.242C1.5825 16.6995 1.8975 17.004 2.3325 17.004C2.73 17.004 3.0705 16.746 3.1635 16.2885L3.996 12.234H7.359L6.5865 15.972H6.585ZM5.085 6.80849H8.484L7.7115 10.653H4.2885L5.0865 6.80849H5.085Z" />
            </svg>
          )}
        </ChannelIconWrap>
        <ChannelTitle>{channelName}</ChannelTitle>
      </ChannelHeader>
    );
  };

  const targetGroupId = props.contextSubgroupId ?? props.groupId;

  const addMember = async (account: string, _channel: string) => {
    if (!targetGroupId) return;
    const result = await new GroupApiDataSource().addGroupMember(targetGroupId, account);
    if (result.error) {
      addToast({ title: "Add member", message: result.error.message || "Failed to add member", type: "channel", duration: 4000 });
      return;
    }
    addToast({ title: "Add member", message: "Member added", type: "channel", duration: 2500 });
    await reFetchChannelMembers();
  };

  const removeUserFromChannel = async (identity: string) => {
    if (!targetGroupId) return;
    const result = await new GroupApiDataSource().removeMember(targetGroupId, identity);
    if (result.error) {
      addToast({ title: "Remove member", message: result.error.message || "Failed to remove member", type: "channel", duration: 4000 });
      return;
    }
    addToast({ title: "Remove member", message: "Member removed", type: "channel", duration: 2500 });
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
          manager={
            channelMeta.createdByUsername ||
            userList.get(channelMeta.createdBy) ||
            channelMeta.createdBy
          }
          isOwner={isOwner}
          handleDeleteChannel={handleDeleteChannel}
          isDeleting={props.isDeleting}
          channelName={channelName}
        />
      )}
      {selectedTabIndex === 1 && (
        <MemberDetails
          id={0}
          user={getContextIdentity() as unknown as UserId}
          promoteModerator={() => {}}
          removeUserFromChannel={removeUserFromChannel}
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
          nonChannelMembers={props.nonChannelMembers}
          isOwner={canManageMembers}
          contextId={props.contextId}
          myContextIdentity={getContextIdentity() ?? undefined}
        />
      )}
    </Wrapper>
  );
};

export default DetailsContainer;
