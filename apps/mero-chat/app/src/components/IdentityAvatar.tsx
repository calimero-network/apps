import React, { memo } from "react";
import { useAvatarUrl } from "../hooks/useAvatarUrl";
import { Avatar } from "./virtualized-chat/Message/Avatar";

interface IdentityAvatarProps {
  identity: string | undefined;
  /** Unused: a picture is the person's, the same in every conversation. */
  contextId?: string;
  name?: string;
  size?: "xs" | "sm" | "md" | "lg" | "xl" | "2xl";
  className?: string;
  style?: React.CSSProperties;
}

/** Renders an avatar circle with the person's workspace picture.
 *  Falls back to the initials circle if no avatar is set or while loading. */
export const IdentityAvatar = memo(function IdentityAvatar({
  identity,
  name,
  size = "md",
  className,
  style,
}: IdentityAvatarProps) {
  const avatarUrl = useAvatarUrl(identity);

  return (
    <Avatar
      src={avatarUrl}
      name={name}
      size={size}
      className={className}
      style={style}
    />
  );
});
