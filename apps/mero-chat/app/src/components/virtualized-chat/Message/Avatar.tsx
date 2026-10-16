import React, { useMemo, memo } from "react";
import { isPlaceholderName } from "../../../utils/placeholderName";

export interface AvatarProps {
  src?: string;
  alt?: string;
  name?: string;
  size?: "xs" | "sm" | "md" | "lg" | "xl" | "2xl";
  shape?: "circle" | "square";
  fallback?: React.ReactNode;
  className?: string;
  style?: React.CSSProperties;
}

// Define size map outside component to avoid recreating
const sizeMap = {
  xs: 24,
  sm: 32,
  md: 40,
  lg: 48,
  xl: 64,
  "2xl": 80,
} as const;

// Initials sit on a colour of their own, picked from the name so a person
// keeps the same one everywhere. All of these carry white text in both themes.
const INITIALS_COLORS = [
  "#e0637a",
  "#3e63f5",
  "#8b5cf6",
  "#0f9b8e",
  "#d97706",
  "#db2777",
  "#2563eb",
  "#16a34a",
] as const;

function initialsColor(name: string): string {
  let hash = 0;
  for (let i = 0; i < name.length; i++) {
    hash = (hash * 31 + name.charCodeAt(i)) | 0;
  }
  return INITIALS_COLORS[Math.abs(hash) % INITIALS_COLORS.length];
}

// Define static image style outside component
const imageStyle = {
  width: "100%",
  height: "100%",
  objectFit: "cover" as const,
};

export const Avatar: React.FC<AvatarProps> = ({
  src,
  alt,
  name,
  size = "md",
  shape = "circle",
  fallback,
  className = "",
  style = {},
}) => {
  const avatarSize = sizeMap[size];
  // A shortened account is not a name: its first character ("3") reads as a
  // count. Such members get the person glyph, still on their own colour so two
  // nameless members stay apart.
  const hasRealName = !!name && !isPlaceholderName(name);

  // Memoize styles to prevent object recreation on every render
  const baseStyle = useMemo(
    () => ({
      width: avatarSize,
      height: avatarSize,
      borderRadius: shape === "circle" ? "50%" : "12px",
      backgroundColor:
        !src && name?.trim() && !fallback ? initialsColor(name) : "var(--glass-sunken)",
      display: "flex",
      alignItems: "center",
      justifyContent: "center",
      overflow: "hidden",
      flexShrink: 0,
      ...style,
    }),
    [avatarSize, shape, style, src, name, fallback],
  );

  const fallbackStyle = useMemo(
    () => ({
      fontSize: avatarSize * 0.36,
      fontWeight: 700,
      color: "#ffffff",
      textTransform: "uppercase" as const,
    }),
    [avatarSize],
  );

  // Memoize initials calculation
  const initials = useMemo(() => {
    if (!name || !hasRealName) return "";
    return name
      .split(" ")
      .map((word) => word.charAt(0))
      .join("")
      .slice(0, 2);
  }, [name, hasRealName]);

  const renderFallback = () => {
    if (fallback) {
      return fallback;
    }

    if (hasRealName) {
      return <span style={fallbackStyle}>{initials}</span>;
    }

    return (
      <svg
        width={avatarSize * 0.5}
        height={avatarSize * 0.5}
        viewBox="0 0 24 24"
        fill="none"
        aria-hidden="true"
        style={{ color: name?.trim() ? "#ffffff" : "var(--glass-ink-2)" }}
      >
        <path
          d="M12 12c2.21 0 4-1.79 4-4s-1.79-4-4-4-4 1.79-4 4 1.79 4 4 4zm0 2c-2.67 0-8 1.34-8 4v2h16v-2c0-2.66-5.33-4-8-4z"
          fill="currentColor"
        />
      </svg>
    );
  };

  return (
    <div className={className} style={baseStyle}>
      {src ? (
        <img
          src={src}
          alt={alt || name || "Avatar"}
          style={imageStyle}
          onError={(e) => {
            // Hide image on error and show fallback
            e.currentTarget.style.display = "none";
          }}
        />
      ) : null}
      {!src && renderFallback()}
    </div>
  );
};

// Memoize Avatar component to prevent unnecessary re-renders
export default memo(Avatar);
