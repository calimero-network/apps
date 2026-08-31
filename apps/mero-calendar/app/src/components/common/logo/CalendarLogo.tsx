interface Props {
  size?: number;
  color?: string;
}

/**
 * Mero Calendar mark — a calendar page with a marked day. `color` tints the
 * outline; the marked day always uses the brand accent so the mark reads on
 * both light and dark surfaces.
 */
export default function CalendarLogo({ size = 28, color = "var(--mc-text)" }: Props) {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 32 32"
      fill="none"
      xmlns="http://www.w3.org/2000/svg"
      aria-label="Mero Calendar"
    >
      {/* page */}
      <rect x="5" y="6" width="22" height="21" rx="3" stroke={color} strokeWidth="2" fill="none" />
      {/* header band */}
      <rect x="5" y="6" width="22" height="6" rx="3" fill={color} opacity="0.16" />
      {/* binder rings */}
      <rect x="10" y="3.5" width="2.4" height="5" rx="1.2" fill={color} />
      <rect x="19.6" y="3.5" width="2.4" height="5" rx="1.2" fill={color} />
      {/* marked day */}
      <rect x="18.5" y="17.5" width="5" height="5" rx="1.2" fill="var(--mc-accent, #6c8cff)" />
      {/* day dots */}
      <circle cx="11" cy="17" r="1.1" fill={color} opacity="0.55" />
      <circle cx="16" cy="17" r="1.1" fill={color} opacity="0.55" />
      <circle cx="11" cy="22" r="1.1" fill={color} opacity="0.55" />
      <circle cx="16" cy="22" r="1.1" fill={color} opacity="0.55" />
    </svg>
  );
}
