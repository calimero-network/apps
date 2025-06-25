import styled from "styled-components";
import UserProfileIcon from "../profileIcon/UserProfileIcon";
import type { User } from "../../types/Common";
import { useState } from "react";

interface UsersButtonGroupProps {
  channelUserList: User[];
  openMemberList: () => void;
}

const AvatarContainer = styled.div`
  padding-left: 1rem;
  display: flex;
  flex-direction: row;
  cursor: pointer;
  align-items: center;
`;

const ProfileIconContainerGroup = styled.div<{ counter?: boolean, isHovered?: boolean }>`
  position: relative;
  display: flex;
  justify-content: center;
  align-items: center;
  width: 24px;
  height: 24px;
  border-radius: 50%;
  ${({ counter }) =>
    counter ? "background-color: #25252A; color: #6E6E78;" : "color: #FFF;"}
  text-align: center;
  /* Body/Small */
  font-family: Helvetica Neue;
  font-size: 14px;
  font-style: normal;
  font-weight: 400;
  line-height: 150%; /* 21px */
  margin-left: -8px;
  border: solid 1px ${({ isHovered }) => isHovered ? "#fff" : "#0e0e10"};
`;

export default function UsersButtonGroup(props: UsersButtonGroupProps) {
  const [isHovered, setIsHovered] = useState(false);
  return (
    <AvatarContainer onClick={props.openMemberList} onMouseEnter={() => {
      setIsHovered(true);
    }} onMouseLeave={() => {
      setIsHovered(false);
    }}>
      {props.channelUserList.slice(0, 3).map((user, id) => {
        return (
          <div key={id}>
            <ProfileIconContainerGroup isHovered={isHovered}>
              <UserProfileIcon accountId={user.id} showStatus={false} />
            </ProfileIconContainerGroup>
          </div>
        );
      })}
      {props.channelUserList.length > 3 && (
        <ProfileIconContainerGroup counter={true} isHovered={isHovered}>
          {props.channelUserList.length}
        </ProfileIconContainerGroup>
      )}
    </AvatarContainer>
  );
}
