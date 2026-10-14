/**
 * The app's own pictures: generated tiles for teams and projects, and the
 * illustrations its empty states carry. All inline SVG or CSS, never a network
 * image, and all decorative (`aria-hidden`), so nothing here is read out.
 */

import { initialsOf, paletteFor, seedOf } from "../utils/artwork";

/**
 * The picture a project card shows while its board has nothing to draw: a few
 * loose shapes in the project's colours around its initials, like a board
 * waiting for its first frame.
 */
export function BoardPlaceholder({ id, name }: { id: string; name: string }) {
  const [a, b] = paletteFor(id);
  const s = seedOf(id);
  const flip = s % 2 === 0;
  return (
    <svg
      viewBox="0 0 240 140"
      preserveAspectRatio="xMidYMid slice"
      width="100%"
      height="100%"
      aria-hidden="true"
      data-placeholder="board"
    >
      <defs>
        <pattern id={`dots-${s}`} width="14" height="14" patternUnits="userSpaceOnUse">
          <circle cx="7" cy="7" r="0.9" fill="currentColor" opacity="0.16" />
        </pattern>
      </defs>
      <rect width="240" height="140" fill={`url(#dots-${s})`} />
      <g transform={flip ? undefined : "translate(240 0) scale(-1 1)"}>
        <rect x="26" y="24" width="86" height="58" rx="10" fill={a} />
        <circle cx="186" cy="44" r="22" fill={b} />
        <path d="M150 112 L176 76 L202 112 Z" fill={a} opacity="0.75" />
        <path d="M44 104 C 72 82, 98 124, 128 100" fill="none" stroke={b} strokeWidth="5" strokeLinecap="round" />
      </g>
      <g>
        <rect x="96" y="52" width="48" height="36" rx="11" fill="#ffffff" stroke="rgba(14,18,34,0.08)" />
        <text
          x="120"
          y="75.5"
          textAnchor="middle"
          fontSize="15"
          fontWeight="700"
          fontFamily="'Figtree Variable', Figtree, system-ui, sans-serif"
          fill="#0e1222"
        >
          {initialsOf(name)}
        </text>
      </g>
    </svg>
  );
}

/** Empty state: a little board of shapes, a cursor and a sticky note. */
export function EmptyBoardsArt() {
  return (
    <svg viewBox="0 0 280 180" width="280" height="180" aria-hidden="true">
      <defs>
        <linearGradient id="md-empty-frame" x1="0" y1="0" x2="1" y2="1">
          <stop offset="0" stopColor="var(--md-art-a)" />
          <stop offset="1" stopColor="var(--md-art-b)" />
        </linearGradient>
      </defs>
      <rect x="20" y="16" width="200" height="140" rx="20" fill="var(--glass-surface-solid)" stroke="var(--glass-line-strong)" />
      <rect x="20" y="16" width="200" height="26" rx="13" fill="var(--glass-sunken)" />
      <circle cx="38" cy="29" r="4" fill="#fca5a5" />
      <circle cx="51" cy="29" r="4" fill="#fde68a" />
      <circle cx="64" cy="29" r="4" fill="#bbf7d0" />
      <rect x="40" y="58" width="78" height="54" rx="10" fill="url(#md-empty-frame)" />
      <circle cx="160" cy="84" r="24" fill="var(--md-art-c)" />
      <path d="M48 134 C 82 116, 116 148, 150 126" fill="none" stroke="var(--md-art-d)" strokeWidth="5" strokeLinecap="round" />
      <rect x="128" y="58" width="64" height="52" rx="8" fill="none" stroke="#0d99ff" strokeWidth="1.5" strokeDasharray="4 3" />
      <rect x="124" y="54" width="8" height="8" rx="2" fill="#fff" stroke="#0d99ff" strokeWidth="1.5" />
      <rect x="188" y="106" width="8" height="8" rx="2" fill="#fff" stroke="#0d99ff" strokeWidth="1.5" />
      <g transform="rotate(8 230 116)">
        <rect x="196" y="88" width="66" height="60" rx="6" fill="#fef08a" />
        <rect x="206" y="102" width="40" height="5" rx="2.5" fill="#a16207" opacity="0.35" />
        <rect x="206" y="114" width="30" height="5" rx="2.5" fill="#a16207" opacity="0.35" />
      </g>
      <path d="M178 120 l0 30 l8 -8 l6 12 l6 -3 l-6 -12 l11 0 z" fill="var(--glass-ink)" stroke="var(--glass-surface-solid)" strokeWidth="2" strokeLinejoin="round" />
    </svg>
  );
}

/** Empty state: three overlapping avatars around a lime team tile. */
export function EmptyTeamsArt() {
  return (
    <svg viewBox="0 0 280 180" width="280" height="180" aria-hidden="true">
      <rect x="70" y="30" width="140" height="120" rx="28" fill="var(--glass-surface-solid)" stroke="var(--glass-line-strong)" />
      <rect x="92" y="52" width="96" height="44" rx="14" fill="var(--md-art-a)" />
      <rect x="92" y="106" width="64" height="9" rx="4.5" fill="var(--glass-line-strong)" />
      <rect x="92" y="122" width="44" height="9" rx="4.5" fill="var(--glass-line)" />
      <g stroke="var(--glass-surface-solid)" strokeWidth="4">
        <circle cx="54" cy="70" r="22" fill="var(--md-art-c)" />
        <circle cx="226" cy="62" r="20" fill="var(--md-art-b)" />
        <circle cx="232" cy="126" r="16" fill="var(--md-art-d)" />
      </g>
      <circle cx="54" cy="64" r="7" fill="#fff" opacity="0.85" />
      <path d="M40 84 a14 10 0 0 1 28 0" fill="#fff" opacity="0.85" />
      <circle cx="226" cy="57" r="6" fill="#fff" opacity="0.85" />
      <path d="M213 75 a13 9 0 0 1 26 0" fill="#fff" opacity="0.85" />
      <path d="M118 74 h44 M140 63 v22" stroke="#365314" strokeWidth="5" strokeLinecap="round" />
    </svg>
  );
}

/** Invitations: a link card flying out of an envelope. */
export function InviteArt() {
  return (
    <svg viewBox="0 0 220 140" width="220" height="140" aria-hidden="true">
      <rect x="40" y="56" width="140" height="74" rx="16" fill="var(--md-art-a)" />
      <g transform="rotate(-6 110 52)">
        <rect x="58" y="16" width="104" height="70" rx="12" fill="var(--glass-surface-solid)" stroke="var(--glass-line-strong)" />
        <rect x="72" y="32" width="56" height="8" rx="4" fill="var(--glass-line-strong)" />
        <rect x="72" y="48" width="76" height="8" rx="4" fill="var(--glass-line)" />
        <rect x="72" y="62" width="36" height="12" rx="6" fill="var(--glass-ink)" />
      </g>
      <path d="M40 72 L110 108 L180 72 V114 a16 16 0 0 1 -16 16 H56 a16 16 0 0 1 -16 -16 Z" fill="var(--md-art-b)" />
      <circle cx="186" cy="34" r="12" fill="var(--md-art-c)" />
      <circle cx="30" cy="40" r="7" fill="var(--md-art-d)" />
    </svg>
  );
}

/** Inspector, nothing selected: a pointer about to pick a shape. */
export function SelectArt() {
  return (
    <svg viewBox="0 0 160 110" width="160" height="110" aria-hidden="true">
      <rect x="18" y="14" width="70" height="50" rx="10" fill="var(--md-art-a)" />
      <circle cx="116" cy="40" r="22" fill="var(--md-art-c)" />
      <path d="M38 92 C 62 76, 92 104, 128 86" fill="none" stroke="var(--md-art-d)" strokeWidth="4" strokeLinecap="round" />
      <rect x="92" y="16" width="48" height="48" rx="4" fill="none" stroke="#0d99ff" strokeWidth="1.5" strokeDasharray="4 3" />
      <path d="M96 56 l0 30 l8 -8 l6 12 l6 -3 l-6 -12 l11 0 z" fill="var(--glass-ink)" stroke="var(--glass-surface-solid)" strokeWidth="2" strokeLinejoin="round" />
    </svg>
  );
}
