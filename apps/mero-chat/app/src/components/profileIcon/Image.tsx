import React, { useState, useEffect } from 'react';

interface ImageProps {
  accountId: string;
  className?: string;
  style?: React.CSSProperties;
  alt?: string;
  fallbackUrl?: string;
}

export default function UserImage(props: ImageProps) {
  const {
    accountId,
    className,
    style,
    alt,
    fallbackUrl = 'https://i.imgur.com/e8buxpa.png'
  } = props;

  const [imageUrl, setImageUrl] = useState<string>(fallbackUrl);

  useEffect(() => {
    const getProfileImage = async () => {
      try {
        setImageUrl(fallbackUrl);
      } catch (error) {
        console.error('Error fetching profile image:', error);
        setImageUrl(fallbackUrl);
      }
    };

    getProfileImage();
  }, [accountId, fallbackUrl]);

  return (
    <img 
      className={className} 
      style={style} 
      src={imageUrl} 
      alt={alt || `Profile image for ${accountId}`}
      onError={() => setImageUrl(fallbackUrl)}
    />
  );
}
