import React, { memo } from "react";
import { getContextId } from "@calimero-network/mero-react";
import { useAvatarUrl } from "../hooks/useAvatarUrl";
import { Avatar } from "./virtualized-chat/Message/Avatar";

interface IdentityAvatarProps {
  identity: string | undefined;
  contextId?: string;
  name?: string;
  size?: "xs" | "sm" | "md" | "lg" | "xl" | "2xl";
  className?: string;
  style?: React.CSSProperties;
}

/** Renders an avatar circle with an async-loaded profile image.
 *  Falls back to the initials circle if no avatar is set or while loading. */
export const IdentityAvatar = memo(function IdentityAvatar({
  identity,
  contextId,
  name,
  size = "md",
  className,
  style,
}: IdentityAvatarProps) {
  const resolvedContextId = contextId ?? getContextId() ?? undefined;
  const avatarUrl = useAvatarUrl(identity, resolvedContextId);

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
