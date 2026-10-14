import styled from "styled-components";
import { useState } from "react";
import { IdentityAvatar } from "../IdentityAvatar";

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
    $counter
      ? "background-color: var(--glass-sunken); color: var(--glass-muted);"
      : "color: var(--glass-ink);"}
  text-align: center;
  /* Body/Small */
  font-family: var(--glass-font);
  font-size: 14px;
  font-style: normal;
  font-weight: 400;
  line-height: 150%; /* 21px */
  /* Each disc overlaps the one before it. At -8px the overlap reached the
     second initial of a 24px avatar (two letters span roughly x 5-19), so the
     header read "MC TE PN" for "MO TB PN". 4px keeps the stacked look without
     covering a letter. */
  margin-left: -4px;
  border: solid 1px
    ${({ $isHovered }) => ($isHovered ? "var(--glass-line-strong)" : "var(--glass-line)")};
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
      {Array.from(props.channelUserList.entries())
        .slice(0, 3)
        .map(([publicKey, userName]) => (
          <div key={publicKey}>
            <ProfileIconContainerGroup $isHovered={isHovered}>
              <IdentityAvatar size="xs" identity={publicKey} name={userName} />
            </ProfileIconContainerGroup>
          </div>
        ))}
      {props.channelUserList.size > 3 && (
        <ProfileIconContainerGroup $counter={true} $isHovered={isHovered}>
          {props.channelUserList.size}
        </ProfileIconContainerGroup>
      )}
    </AvatarContainer>
  );
}
