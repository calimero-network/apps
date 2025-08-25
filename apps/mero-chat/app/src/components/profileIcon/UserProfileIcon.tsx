import { styled } from "styled-components";
import UserImage from './Image';

interface UserProfileIconProps {
  accountId: string;
  showStatus?: boolean;
  width?: string;
  height?: string;
  active?: boolean;
}

const ProfileIconContainer = styled.div<{ width?: string; height?: string }>`
  position: relative;
  display: flex;
  justify-content: center;
  align-items: center;
  ${({ width }) => width && `width: ${width};`}
  ${({ height }) => height && `height: ${height};`}
`;

const ActiveStatusCricle = styled.div`
  position: absolute;
  bottom: -2px;
  right: -2px;
  width: 10px;
  height: 10px;
  border-radius: 50%;
  background-color: #00FF66;
  &:hover {
    background-color: #00FF66;
  }
  border: 1px solid #1A1A1D;
`;

export default function UserProfileIcon(props: UserProfileIconProps) {
  const accountId = props.accountId;
  const showStatus = props.showStatus ?? true;
  const width = props.width ?? '24px';
  const height = props.height ?? '24px';

  return (
    <ProfileIconContainer width={width} height={height}>
      <UserImage
        accountId={accountId}
        alt={`profile-icon-${accountId}`}
        className="rounded-circle"
        style={{ width: width, height: height, objectFit: "cover", borderRadius: "50%" }}
        fallbackUrl="https://i.imgur.com/e8buxpa.png"
      />
      {showStatus && <ActiveStatusCricle/>}
    </ProfileIconContainer>
  );
}
