import styled from "styled-components";
import { useState } from "react";
import { Avatar } from "@calimero-network/mero-ui";

interface UsersButtonGroupProps {
  channelUserList: Map<string, string>;
  openMemberList: () => void;
}

const AvatarContainer = styled.div`
  padding-left: 1rem;
  display: flex;
  flex-direction: row;
  cursor: pointer;
  align-items: center;
`;

const ProfileIconContainerGroup = styled.div<{
  $counter?: boolean;
  $isHovered?: boolean;
}>`
  position: relative;
  display: flex;
  justify-content: center;
  align-items: center;
  width: 24px;
  height: 24px;
  border-radius: 50%;
  ${({ $counter }) =>
    $counter ? "background-color: #25252A; color: #6E6E78;" : "color: #FFF;"}
  text-align: center;
  /* Body/Small */
  font-family: Helvetica Neue;
  font-size: 14px;
  font-style: normal;
  font-weight: 400;
  line-height: 150%; /* 21px */
  margin-left: -8px;
  border: solid 1px ${({ $isHovered }) => ($isHovered ? "#fff" : "#0e0e10")};
`;

export default function UsersButtonGroup(props: UsersButtonGroupProps) {
  const [isHovered, setIsHovered] = useState(false);

  return (
    <AvatarContainer
      onClick={props.openMemberList}
      onMouseEnter={() => {
        setIsHovered(true);
      }}
      onMouseLeave={() => {
        setIsHovered(false);
      }}
    >
      {Object.entries(props.channelUserList)
        .slice(0, 3)
        .map(([publicKey, userName]) => (
          <div key={publicKey}>
            <ProfileIconContainerGroup $isHovered={isHovered}>
              <Avatar size="xs" name={userName} />
            </ProfileIconContainerGroup>
          </div>
        ))}
      {Object.keys(props.channelUserList).length > 3 && (
        <ProfileIconContainerGroup $counter={true} $isHovered={isHovered}>
          {Object.keys(props.channelUserList).length}
        </ProfileIconContainerGroup>
      )}
    </AvatarContainer>
  );
}
