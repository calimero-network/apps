import React, { useCallback, useState } from "react";
import styled from "styled-components";
import type { User } from "../../types/Common";
import MultipleInputPopup from "../common/popups/MultipleInputPopup";
import UserProfileIcon from "../profileIcon/UserProfileIcon";

const AddMemberButton = styled.div`
  display: flex;
  column-gap: 0.5rem;
  padding-left: 1rem;
  padding-top: 0.5rem;
  padding-bottom: 0.5rem;
  color: #fff;
  :hover {
    background-color: #5765f2;
  }
  border-radius: 4px;
  font-family: Helvetica Neue;
  font-size: 16px;
  font-style: normal;
  font-weight: 400;
  line-height: 150%;
  cursor: pointer;
`;

const UserListItem = styled.div`
  display: flex;
  justify-content: space-between;
  align-items: center;
  color: #777583;
  padding-top: 0.5rem;
  padding-bottom: 0.5rem;
  padding-left: 1rem;
  padding-right: 1rem;
  border-radius: 0.5rem;
  cursor: pointer;
`;

const UserList = styled.div`
  overflow-y: scroll;
  max-height: 24rem;
  @media (max-width: 1024px) {
    max-height: 12rem;
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

const UserInfo = styled.div`
  display: flex;
  column-gap: 0.5rem;
  :hover {
    background-color: transparent;
  }
`;

const Text = styled.div<{ isSelected?: boolean }>`
  display: flex;
  justify-content: start;
  align-items: center;
  width: 100%;
  color: ${({ isSelected }) => (isSelected ? "#5765F2" : "#fff")};
  :hover {
    background-color: transparent;
  }
`;

const RoleText = styled.div`
  color: #777583;
  font-family: Helvetica Neue;
  font-size: 12px;
  font-style: normal;
  font-weight: 700;
  line-height: 100%;
`;

const ModeratorOptions = styled.div`
  display: flex;
  justify-content: center;
  align-items: center;
  gap: 12px;
`;

const OptionsButton = ({ handleClick }: { handleClick: () => void }) => {
  return (
    <div onClick={handleClick}>
      <svg
        xmlns="http://www.w3.org/2000/svg"
        width="18"
        height="18"
        fill="white"
        className="bi bi-three-dots"
        viewBox="0 0 16 16"
      >
        <path d="M3 9.5a1.5 1.5 0 1 1 0-3 1.5 1.5 0 0 1 0 3zm5 0a1.5 1.5 0 1 1 0-3 1.5 1.5 0 0 1 0 3zm5 0a1.5 1.5 0 1 1 0-3 1.5 1.5 0 0 1 0 3z" />
      </svg>
    </div>
  );
};

const OptionsWindow = styled.div`
  width: 252px;
  display: flex;
  flex-direction: column;
  padding-top: 4px;
  padding-bottom: 4px;
  border-radius: 4px;
  background-color: #25252a;
  pointer-events: auto;
`;

const Option = styled.div`
  color: #fff;
  font-family: Helvetica Neue;
  font-size: 16px;
  font-style: normal;
  padding-left: 1rem;
  padding-right: 1rem;
  padding-top: 4px;
  padding-bottom: 4px;
  font-weight: 400;
  line-height: 150%;
  -webkit-font-smoothing: antialiased applied;
  cursor: pointer;

  :hover {
    background-color: #2a2b37;
  }
`;

const OverLay = styled.div`
  position: absolute;
  z-index: 10;
  top: 0;
  left: 0;
  bottom: 0;
  right: 0;
  display: flex;
  justify-content: center;
  align-items: center;
`;

const TopOverlay = styled.div<{ bottomPadding: boolean }>`
  position: fixed;
  z-index: 20;
  @media (max-width: 1024px) {
    position: absolute;
    right: 0;
    ${({ bottomPadding }) =>
      bottomPadding
        ? `
      bottom: 100%;
    `
        : `
      top: 100%;
    `}
  }
`;

interface AddUserDialogProps {
  addMember: (account: string, channel: string) => void;
  channelName: string;
  getNonInvitedUsers: (value: string, channelName: string) => void;
  nonInvitedUserList: User[];
}

const AddUserDialog = (props: AddUserDialogProps) => {
  const { addMember, channelName, getNonInvitedUsers, nonInvitedUserList } =
    props;
  const [selectedUsers, setSelectedUsers] = useState<string[]>([]);
  const addUser = useCallback(() => {
    selectedUsers.forEach((account) => addMember(account, channelName));
  }, [addMember, channelName, channelName, selectedUsers]);

  const updateUsers = useCallback((value: string) => {
    getNonInvitedUsers(value, channelName);
  }, []);

  return (
    <MultipleInputPopup
      title={`Invite user to #${channelName}`}
      placeholder={"ex: 0x124abc..."}
      buttonText={"Invite"}
      functionLoader={addUser}
      colors={{
        base: "#5765f2",
        hover: "#717cf0",
        disabled: "#3B487A",
      }}
      toggle={
        <AddMemberButton>
          <i className="bi bi-plus-circle-fill" />
          Add new member
        </AddMemberButton>
      }
      updateUsers={updateUsers}
      isChild={true}
      autocomplete={true}
      nonInvitedUserList={nonInvitedUserList}
      selectedUsers={selectedUsers}
      setSelectedUsers={setSelectedUsers}
    />
  );
};

const OptionsWrapper = styled.div`
  position: relative;
`;

interface MemberDetailsProps {
  id: number;
  user: User;
  promoteModerator: (userId: string, isModerator: boolean) => void;
  removeUserFromChannel: (userId: string) => void;
  channelOwner: string;
  optionsOpen: number;
  setOptionsOpen: (id: number) => void;
  selectedUser: User | null;
  setSelectedUser: (user: User | null) => void;
  userList: User[];
  addMember: (account: string, channel: string) => void;
  channelName: string;
  getNonInvitedUsers: (value: string, channelName: string) => void;
  nonInvitedUserList: User[];
}

const MemberDetails: React.FC<MemberDetailsProps> = (props) => {
  const userList = props.userList;
  const promoteModerator = props.promoteModerator;
  const removeUserFromChannel = props.removeUserFromChannel;
  const channelOwner = props.channelOwner;

  const [optionsOpen, setOptionsOpen] = useState(-1);
  const [selectedUser, setSelectedUser] = useState<User | null>(null);

  const ModeratorOptionsPopup = ({ id, user, length }: { id: number; user: User, length: number }) => {
    return (
      <OptionsWrapper>
        <OptionsButton
          handleClick={() => {
            setOptionsOpen(id);
            setSelectedUser(user);
          }}
        />
        {optionsOpen === id && (
          <TopOverlay bottomPadding={length - 3 <= id}>
            <OptionsWindow>
              {selectedUser && selectedUser.id !== channelOwner && (
                <Option
                  onClick={() =>
                    promoteModerator(selectedUser.id, !selectedUser.moderator)
                  }
                >{`${
                  selectedUser.moderator ? "Remove moderator" : "Make moderator"
                }`}</Option>
              )}
              {selectedUser && (
                <Option onClick={() => removeUserFromChannel(selectedUser.id)}>
                  Remove from channel
                </Option>
              )}
            </OptionsWindow>
          </TopOverlay>
        )}
      </OptionsWrapper>
    );
  };

  return (
    <>
      <AddUserDialog {...props} />
      {optionsOpen !== -1 && <OverLay onClick={() => setOptionsOpen(-1)} />}
      <UserList>
        {userList.length > 0 &&
          userList.map((user, id) => (
            <UserListItem key={id}>
              <UserInfo>
                <UserProfileIcon accountId={user.name ?? ""} />
                <Text isSelected={optionsOpen === id}>{user.name}</Text>
              </UserInfo>
              <ModeratorOptions>
                {(user.moderator || channelOwner === user.id) && (
                  <RoleText>{`${
                    channelOwner === user.id
                      ? "Channel Owner"
                      : "Channel Moderator"
                  }`}</RoleText>
                )}
                {channelOwner !== user.id && (
                  <ModeratorOptionsPopup id={id} user={user} length={userList.length}/>
                )}
              </ModeratorOptions>
            </UserListItem>
          ))}
      </UserList>
    </>
  );
};

export default MemberDetails;
