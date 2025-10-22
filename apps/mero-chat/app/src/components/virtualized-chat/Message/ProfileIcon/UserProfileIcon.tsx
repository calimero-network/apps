import React, { useEffect, useState } from 'react';
import styled from 'styled-components';

const ProfileIconContainer = styled.div<{ $height: string; $width: string }>`
  position: relative;
  display: flex;
  justify-content: center;
  align-items: center;
  ${({ $width }: { $width: string }) => $width && `width: ${$width};`}
  ${({ $height }: { $height: string }) => $height && `height: ${$height};`}
`;

const ActiveStatusCricle = styled.div<{ $active: boolean }>`
  position: absolute;
  bottom: -2px;
  right: -2px;
  width: 10px;
  height: 10px;
  border-radius: 50%;
  ${({ $active }: { $active: boolean }) =>
    $active ? 'background-color: #00FF66;' : 'background-color: #777583;'}
  border: 1px solid #1A1A1D;
`;

interface UserProfileIconProps {
  accountId: string;
  showStatus: boolean;
  width: string;
  height: string;
  active: boolean;
  getIconFromCache: (accountId: string) => Promise<string | null>;
}

const UserProfileIcon: React.FC<UserProfileIconProps> = ({
  accountId,
  showStatus = true,
  width = '24px',
  height = '24px',
  active = false,
  getIconFromCache,
}) => {
  const [imageUrl, setImageUrl] = useState('https://i.imgur.com/e8buxpa.png');

  useEffect(() => {
    const setImage = async () => {
      const image = await getIconFromCache(accountId);
      if (image) {
        setImageUrl(image);
      }
    };
    setImage();
  }, []);

  return (
    <ProfileIconContainer $width={width} $height={height}>
      <img
        src={imageUrl}
        alt={`profile-icon-${accountId}`}
        className="rounded-circle"
        style={{ width: width, height: height, objectFit: 'cover' }}
      />
      {showStatus && <ActiveStatusCricle $active={active} />}
    </ProfileIconContainer>
  );
};

export default UserProfileIcon;
