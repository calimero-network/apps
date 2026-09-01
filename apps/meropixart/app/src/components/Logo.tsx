interface Props {
  size?: number;
  color?: string;
}

/**
 * MeroPixArt mark — a stack of pixel tiles (layers/image motif). `color` tints
 * the outline + solid tile; the accent tile always uses the lime brand colour so
 * the mark reads on both dark and light surfaces.
 */
export default function Logo({ size = 28, color = "var(--text)" }: Props) {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 32 32"
      fill="none"
      xmlns="http://www.w3.org/2000/svg"
      aria-label="MeroPixArt"
    >
      {/* base tile */}
      <rect x="4" y="4" width="14" height="14" rx="2.5" fill={color} opacity="0.16" />
      {/* offset outlined tile — the "layer" */}
      <rect x="11" y="11" width="14" height="14" rx="2.5" stroke={color} strokeWidth="2" fill="none" />
      {/* pixel cluster accent */}
      <rect x="14.5" y="14.5" width="3.6" height="3.6" rx="0.8" fill="var(--accent, #A5FF11)" />
      <rect x="18.6" y="14.5" width="3.6" height="3.6" rx="0.8" fill="var(--accent, #A5FF11)" opacity="0.6" />
      <rect x="14.5" y="18.6" width="3.6" height="3.6" rx="0.8" fill="var(--accent, #A5FF11)" opacity="0.6" />
      <rect x="18.6" y="18.6" width="3.6" height="3.6" rx="0.8" fill="var(--accent, #A5FF11)" />
    </svg>
  );
}
